// Copyright 2026 The Inspektor Gadget authors
// SPDX-License-Identifier: Apache-2.0

package fileoutput

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"math"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/gopacket/gopacket/pcapgo"
	"github.com/inspektor-gadget/inspektor-gadget/pkg/datasource"
	"github.com/inspektor-gadget/inspektor-gadget/pkg/gadget-service/api"
)

func testDirectory(t *testing.T) string {
	t.Helper()
	path, err := filepath.Abs(filepath.Join(".test-output", uuid.NewString()))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(path, 0700); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(path); os.Remove(filepath.Dir(path)) })
	return path
}

func source(t *testing.T, typ datasource.Type, name string) datasource.DataSource {
	t.Helper()
	ds, err := datasource.New(typ, name)
	if err != nil {
		t.Fatal(err)
	}
	return ds
}

func addField(t *testing.T, ds datasource.DataSource, name string, kind api.Kind, annotations map[string]string) datasource.FieldAccessor {
	t.Helper()
	f, err := ds.AddField(name, kind, datasource.WithAnnotations(annotations))
	if err != nil {
		t.Fatal(err)
	}
	return f
}

func openSink(t *testing.T, format string, ids ...string) *Sink {
	t.Helper()
	m := NewManager("test-host")
	t.Cleanup(m.Close)
	selected, err := m.Prepare(filepath.Join(testDirectory(t), "capture"), format, false)
	if err != nil {
		t.Fatal(err)
	}
	s, err := m.Open(Request{Token: selected.Token, Format: format, DatasourceIDs: ids})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Finalize(errors.New("test cleanup")) })
	return s
}

func readJSONL(t *testing.T, path string) []map[string]any {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	scanner := bufio.NewScanner(bytes.NewReader(b))
	var rows []map[string]any
	for scanner.Scan() {
		var row map[string]any
		if err := json.Unmarshal(scanner.Bytes(), &row); err != nil {
			t.Fatal(err)
		}
		rows = append(rows, row)
	}
	if err := scanner.Err(); err != nil {
		t.Fatal(err)
	}
	return rows
}

func TestJSONLExactValuesSchemasAndSnapshots(t *testing.T) {
	single, array := source(t, datasource.TypeSingle, "events"), source(t, datasource.TypeArray, "snapshots")
	u := addField(t, single, "big", api.Kind_Uint64, nil)
	i := addField(t, single, "negative", api.Kind_Int64, nil)
	a := addField(t, single, "uints", api.ArrayOf(api.Kind_Uint64), nil)
	name := addField(t, array, "name", api.Kind_String, nil)
	s := openSink(t, "jsonl")
	if err := s.Subscribe(map[string]datasource.DataSource{"events": single, "snapshots": array}, map[string]any{"image": "test"}, func() {}); err != nil {
		t.Fatal(err)
	}
	p, _ := single.NewPacketSingle()
	u.PutUint64(p, math.MaxUint64)
	i.PutInt64(p, math.MinInt64)
	arrayBytes := make([]byte, 16)
	single.ByteOrder().PutUint64(arrayBytes, math.MaxUint64)
	single.ByteOrder().PutUint64(arrayBytes[8:], 1)
	a.Set(p, arrayBytes)
	if err := single.EmitAndRelease(p); err != nil {
		t.Fatal(err)
	}
	empty, _ := array.NewPacketArray()
	if err := array.EmitAndRelease(empty); err != nil {
		t.Fatal(err)
	}
	nonempty, _ := array.NewPacketArray()
	row := nonempty.New()
	name.PutString(row, "snapshot")
	nonempty.Append(row)
	if err := array.EmitAndRelease(nonempty); err != nil {
		t.Fatal(err)
	}
	// Buffered lines reach the partial within the flush interval, before
	// finalization.
	deadline := time.Now().Add(3 * flushInterval)
	for len(readJSONL(t, s.Status().PartialPath)) != 6 {
		if time.Now().After(deadline) {
			t.Fatalf("lines before finalization = %d", len(readJSONL(t, s.Status().PartialPath)))
		}
		time.Sleep(20 * time.Millisecond)
	}
	status := s.Finalize(nil)
	if status.State != "completed" || status.Records != 3 || status.PartialPath != "" {
		t.Fatalf("%+v", status)
	}
	info, _ := os.Stat(status.Path)
	if status.Bytes != uint64(info.Size()) {
		t.Fatalf("bytes %d size %d", status.Bytes, info.Size())
	}
	rows := readJSONL(t, status.Path)
	if rows[0]["type"] != "capture" || rows[0]["version"] != float64(1) || rows[1]["type"] != "schema" || rows[2]["type"] != "schema" {
		t.Fatalf("ordering: %+v", rows)
	}
	data := rows[3]["data"].(map[string]any)
	if data["big"] != "18446744073709551615" || data["negative"] != "-9223372036854775808" || data["uints"].([]any)[0] != "18446744073709551615" {
		t.Fatalf("precision: %+v", data)
	}
	if rows[4]["type"] != "snapshot" || len(rows[4]["data"].([]any)) != 0 || rows[5]["datasourceId"] != "snapshots" {
		t.Fatal("snapshot boundary lost")
	}
}

func TestJSONLFilteringAndInvalidSelection(t *testing.T) {
	for _, selection := range [][]string{{"one"}, {"missing"}, {"one", "one"}} {
		t.Run(strings.Join(selection, ","), func(t *testing.T) {
			s := openSink(t, "jsonl", selection...)
			one, two := source(t, datasource.TypeSingle, "one"), source(t, datasource.TypeSingle, "two")
			err := s.Subscribe(map[string]datasource.DataSource{"one": one, "two": two}, nil, func() {})
			if len(selection) != 1 || selection[0] != "one" {
				if err == nil {
					t.Fatal("invalid selection accepted")
				}
				if s.Finalize(err).State != "failed" {
					t.Fatal("invalid source published")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			p, _ := two.NewPacketSingle()
			two.EmitAndRelease(p)
			p, _ = one.NewPacketSingle()
			one.EmitAndRelease(p)
			status := s.Finalize(nil)
			if status.Records != 1 || len(readJSONL(t, status.Path)) != 3 {
				t.Fatalf("%+v", status)
			}
		})
	}
}

func packetSource(t *testing.T, name string) datasource.DataSource {
	ds := source(t, datasource.TypeSingle, name)
	ds.AddAnnotation("cli.supported-output-modes", "columns, pcap-ng, json")
	ds.AddAnnotation("pcap.payload", "body")
	ds.AddAnnotation("pcap.timestamp", "time")
	ds.AddAnnotation("pcap.packet-length", "length")
	addField(t, ds, "body", api.Kind_Bytes, nil)
	addField(t, ds, "time", api.Kind_String, nil)
	addField(t, ds, "length", api.Kind_Uint32, nil)
	addField(t, ds, "interface", api.Kind_Uint32, map[string]string{"pcap.interface-key": "true"})
	addField(t, ds, "node", api.Kind_String, map[string]string{"pcap.interface-var": "k8s.node"})
	addField(t, ds, "proc.comm", api.Kind_String, nil)
	return ds
}

func emitPacket(t *testing.T, ds datasource.DataSource, index uint32) {
	t.Helper()
	p, _ := ds.NewPacketSingle()
	ds.GetField("body").Set(p, []byte{0, 1, 2, 3})
	ds.GetField("time").PutString(p, "2026-09-18T11:00:00.123456789Z")
	ds.GetField("length").PutUint32(p, 100)
	ds.GetField("interface").PutUint32(p, index)
	ds.GetField("node").PutString(p, "node & one")
	ds.GetField("proc.comm").PutString(p, "curl")
	if err := ds.EmitAndRelease(p); err != nil {
		t.Fatal(err)
	}
}

func TestPCAPReaderMetadataTimestampLengthsAndZeroPackets(t *testing.T) {
	for _, count := range []int{0, 3} {
		t.Run(string(rune('0'+count)), func(t *testing.T) {
			s := openSink(t, "pcap-ng")
			ds := packetSource(t, "not-hardcoded-packets")
			if err := s.Subscribe(map[string]datasource.DataSource{ds.Name(): ds}, nil, func() {}); err != nil {
				t.Fatal(err)
			}
			for i := 0; i < count; i++ {
				emitPacket(t, ds, uint32(i%2))
			}
			status := s.Finalize(nil)
			if status.State != "completed" || status.Records != uint64(count) {
				t.Fatalf("%+v", status)
			}
			b, err := os.ReadFile(status.Path)
			if err != nil {
				t.Fatal(err)
			}
			if status.Bytes != uint64(len(b)) {
				t.Fatal("incorrect file bytes")
			}
			reader, err := pcapgo.NewNgReader(bytes.NewReader(b), pcapgo.DefaultNgReaderOptions)
			if err != nil {
				t.Fatal(err)
			}
			var section map[string]any
			if err := json.Unmarshal([]byte(reader.SectionInfo().Comment), &section); err != nil || section["datasourceId"] != "not-hardcoded-packets" {
				t.Fatalf("section provenance: %+v %v", section, err)
			}
			for i := 0; i < count; i++ {
				packet, ci, options, err := reader.ReadPacketDataWithOptions()
				if err != nil {
					t.Fatal(err)
				}
				if len(options.Comments) != 1 || options.Comments[0] != "proc.comm=curl" {
					t.Fatalf("packet comments: %+v", options)
				}
				want, _ := time.Parse(time.RFC3339Nano, "2026-09-18T11:00:00.123456789Z")
				if !ci.Timestamp.Equal(want) || ci.Length != 100 || ci.CaptureLength != 4 || !bytes.Equal(packet, []byte{0, 1, 2, 3}) {
					t.Fatalf("packet %v %+v", packet, ci)
				}
				intf, err := reader.Interface(ci.InterfaceIndex)
				if err != nil || intf.Description != "k8s.node=node+%26+one" {
					t.Fatalf("interface %+v %v", intf, err)
				}
			}
			if _, _, err := reader.ReadPacketData(); err != io.EOF {
				t.Fatalf("expected EOF: %v", err)
			}
			if count > 0 && reader.NInterfaces() != 3 {
				t.Fatal("missing process comment or interfaces")
			}
		})
	}
}

func TestPCAPMetadataValidation(t *testing.T) {
	for _, fault := range []string{"missing", "multiple", "timestamp", "payload", "length", "not-token", "filter"} {
		t.Run(fault, func(t *testing.T) {
			ds := packetSource(t, "packets")
			sources := map[string]datasource.DataSource{"packets": ds}
			var ids []string
			switch fault {
			case "missing":
				ds.AddAnnotation("pcap.payload", "missing")
			case "multiple":
				sources["second"] = packetSource(t, "second")
			case "timestamp":
				ds.AddAnnotation("pcap.timestamp", "interface")
			case "payload":
				ds.AddAnnotation("pcap.payload", "node")
			case "length":
				ds.AddAnnotation("pcap.packet-length", "node")
			case "not-token":
				ds.AddAnnotation("cli.supported-output-modes", "not-pcap-ng")
			case "filter":
				sources["other"] = source(t, datasource.TypeSingle, "other")
				ids = []string{"packets", "other"}
			}
			s := openSink(t, "pcap-ng", ids...)
			err := s.Subscribe(sources, nil, func() {})
			if err == nil {
				t.Fatal("invalid packet metadata accepted")
			}
			if status := s.Finalize(err); status.State != "failed" {
				t.Fatalf("%+v", status)
			}
		})
	}
}

func TestDestinationAuthorizationAndPublicationConflict(t *testing.T) {
	dir := testDirectory(t)
	m := NewManager("host")
	defer m.Close()
	path := filepath.Join(dir, "result.jsonl")
	selection, err := m.Prepare(path, "jsonl", false)
	if err != nil {
		t.Fatal(err)
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 0 {
		t.Fatal("preparation created files")
	}
	if _, err := m.Prepare(path, "jsonl", false); err == nil {
		t.Fatal("duplicate reservation allowed")
	}
	m.Release(selection.Token)
	if _, err := m.Open(Request{Token: selection.Token, Format: "jsonl"}); err == nil {
		t.Fatal("released token allowed")
	}
	selection, _ = m.Prepare(path, "jsonl", false)
	os.WriteFile(path, []byte("external"), 0600)
	if _, err := m.Open(Request{Token: selection.Token, Format: "jsonl"}); err == nil {
		t.Fatal("changed destination allowed")
	}
	if _, err := m.Prepare(path, "jsonl", false); err == nil {
		t.Fatal("unconfirmed overwrite allowed")
	}
	approved, err := m.Prepare(path, "jsonl", true)
	if err != nil || !approved.Overwrite {
		t.Fatalf("confirmed replacement selection: %+v %v", approved, err)
	}
	m.Release(approved.Token)
	os.Remove(path)
	selection, _ = m.Prepare(path, "jsonl", false)
	s, err := m.Open(Request{Token: selection.Token, Format: "jsonl"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := m.Open(Request{Token: selection.Token, Format: "jsonl"}); err == nil {
		t.Fatal("token reused")
	}
	ds := source(t, datasource.TypeSingle, "events")
	if err := s.Subscribe(map[string]datasource.DataSource{"events": ds}, nil, func() {}); err != nil {
		t.Fatal(err)
	}
	p, _ := ds.NewPacketSingle()
	ds.EmitAndRelease(p)
	os.WriteFile(path, []byte("new unrelated data"), 0600)
	status := s.Finalize(nil)
	if status.State != "failed" || status.PartialPath == "" {
		t.Fatalf("%+v", status)
	}
	b, _ := os.ReadFile(path)
	if string(b) != "new unrelated data" {
		t.Fatal("unrelated destination overwritten")
	}
	if _, err := os.Stat(status.PartialPath); err != nil {
		t.Fatal("partial lost")
	}
}

type failingFile struct {
	outputFile
	writeErr, syncErr, closeErr error
	calls                       *[]string
}

func (f failingFile) Write(p []byte) (int, error) {
	if f.writeErr != nil {
		return 0, f.writeErr
	}
	return f.outputFile.Write(p)
}
func (f failingFile) Sync() error {
	if f.calls != nil {
		*f.calls = append(*f.calls, "sync")
	}
	return errors.Join(f.outputFile.Sync(), f.syncErr)
}
func (f failingFile) Close() error {
	if f.calls != nil {
		*f.calls = append(*f.calls, "close")
	}
	return errors.Join(f.outputFile.Close(), f.closeErr)
}

func TestSuccessfulCaptureIsSyncedBeforeClose(t *testing.T) {
	s := openSink(t, "jsonl")
	ds := source(t, datasource.TypeSingle, "events")
	if err := s.Subscribe(map[string]datasource.DataSource{"events": ds}, nil, func() {}); err != nil {
		t.Fatal(err)
	}
	var calls []string
	s.file = failingFile{outputFile: s.file, calls: &calls}
	if status := s.Finalize(nil); status.State != "completed" {
		t.Fatalf("%+v", status)
	}
	if strings.Join(calls, ",") != "sync,close" {
		t.Fatalf("file not synced before close: %v", calls)
	}
	root, err := os.OpenRoot(filepath.Dir(s.Status().Path))
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	if err := syncDir(root); err != nil {
		t.Fatalf("directory sync: %v", err)
	}
}

// unbuffered makes every encoder write reach s.file immediately, so tests can
// inject file faults at a specific record.
func unbuffered(t *testing.T, s *Sink) {
	t.Helper()
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.flushLocked(); err != nil {
		t.Fatal(err)
	}
	s.out = bufio.NewWriterSize(fileWriter{s}, 1)
}

type countingFile struct {
	outputFile
	writes *atomic.Int64
}

func (f countingFile) Write(p []byte) (int, error) { f.writes.Add(1); return f.outputFile.Write(p) }

func TestOutputIsBufferedNotWrittenPerEvent(t *testing.T) {
	for _, format := range []string{"jsonl", "pcap-ng"} {
		t.Run(format, func(t *testing.T) {
			s := openSink(t, format)
			var writes atomic.Int64
			s.file = countingFile{s.file, &writes}
			ds := source(t, datasource.TypeSingle, "events")
			if format == "pcap-ng" {
				ds = packetSource(t, "events")
			}
			if err := s.Subscribe(map[string]datasource.DataSource{"events": ds}, nil, func() {}); err != nil {
				t.Fatal(err)
			}
			for i := 0; i < 200; i++ {
				if format == "pcap-ng" {
					emitPacket(t, ds, 0)
				} else {
					p, _ := ds.NewPacketSingle()
					ds.EmitAndRelease(p)
				}
			}
			if n := writes.Load(); n > 2 {
				t.Fatalf("%d file writes for 200 events", n)
			}
			if status := s.Finalize(nil); status.State != "completed" || status.Records != 200 {
				t.Fatalf("%+v", status)
			}
		})
	}
}

func TestWriteFlushCloseFailuresAndCallbackFence(t *testing.T) {
	for _, fault := range []string{"write", "flush", "sync", "close", "runtime"} {
		t.Run(fault, func(t *testing.T) {
			s := openSink(t, "jsonl")
			ds := source(t, datasource.TypeSingle, "events")
			var cancelled atomic.Bool
			if err := s.Subscribe(map[string]datasource.DataSource{"events": ds}, nil, func() { cancelled.Store(true) }); err != nil {
				t.Fatal(err)
			}
			unbuffered(t, s)
			failure := errors.New("injected " + fault)
			var runErr error
			switch fault {
			case "write":
				s.file = failingFile{outputFile: s.file, writeErr: failure}
			case "flush":
				s.flush = func() error { return failure }
			case "sync":
				s.file = failingFile{outputFile: s.file, syncErr: failure}
			case "close":
				s.file = failingFile{outputFile: s.file, closeErr: failure}
			case "runtime":
				runErr = failure
			}
			p, _ := ds.NewPacketSingle()
			ds.EmitAndRelease(p)
			status := s.Finalize(runErr)
			if status.State != "failed" || !strings.Contains(status.Error, "injected") {
				t.Fatalf("%+v", status)
			}
			if fault == "write" && (!cancelled.Load() || status.Records != 0) {
				t.Fatal("write error did not stop/count correctly")
			}
			if _, err := os.Stat(status.Path); !errors.Is(err, os.ErrNotExist) {
				t.Fatal("failed capture published")
			}
			if fault == "write" {
				// Nothing was recorded, so the partial is removed.
				if status.PartialPath != "" {
					t.Fatalf("empty partial kept: %+v", status)
				}
			} else if _, err := os.Stat(status.PartialPath); err != nil {
				t.Fatal("partial not preserved")
			}
			before := s.Status()
			p, _ = ds.NewPacketSingle()
			ds.EmitAndRelease(p)
			if after := s.Status(); before.Bytes != after.Bytes || before.Records != after.Records {
				t.Fatal("late callback wrote finalized file")
			}
		})
	}
}

func TestConcurrentCallbacksAndFinalization(t *testing.T) {
	s := openSink(t, "jsonl")
	ds := source(t, datasource.TypeSingle, "events")
	if err := s.Subscribe(map[string]datasource.DataSource{"events": ds}, nil, func() {}); err != nil {
		t.Fatal(err)
	}

	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 100; j++ {
				p, _ := ds.NewPacketSingle()
				ds.EmitAndRelease(p)
			}
		}()
	}
	wg.Wait()
	status := s.Finalize(nil)
	if status.State != "completed" || status.Records != 800 || len(readJSONL(t, status.Path)) != 802 {
		t.Fatalf("%+v", status)
	}
}

type blockedFile struct {
	outputFile
	entered chan struct{}
	release chan struct{}
	closed  atomic.Bool
}

type shortFile struct{ outputFile }

func (f shortFile) Write(p []byte) (int, error) { return f.outputFile.Write(p[:len(p)/2]) }

func TestInterruptedJSONLRetainsCompletePrefix(t *testing.T) {
	s := openSink(t, "jsonl")
	ds := source(t, datasource.TypeSingle, "events")
	if err := s.Subscribe(map[string]datasource.DataSource{"events": ds}, nil, func() {}); err != nil {
		t.Fatal(err)
	}
	p, _ := ds.NewPacketSingle()
	ds.EmitAndRelease(p)
	unbuffered(t, s)
	s.file = shortFile{s.file}
	p, _ = ds.NewPacketSingle()
	ds.EmitAndRelease(p)
	status := s.Finalize(nil)
	if status.State != "failed" || status.Records != 1 || !strings.Contains(status.Error, io.ErrShortWrite.Error()) {
		t.Fatalf("%+v", status)
	}
	b, err := os.ReadFile(status.PartialPath)
	if err != nil {
		t.Fatal(err)
	}
	if uint64(len(b)) != status.Bytes {
		t.Fatal("partial byte counter")
	}
	lines := bytes.Split(b, []byte("\n"))
	if len(lines) != 4 || !json.Valid(lines[0]) || !json.Valid(lines[1]) || !json.Valid(lines[2]) || json.Valid(lines[3]) {
		t.Fatalf("interrupted stream lost its parseable prefix")
	}
}

func (f *blockedFile) Write(p []byte) (int, error) {
	close(f.entered)
	<-f.release
	return f.outputFile.Write(p)
}
func (f *blockedFile) Close() error { f.closed.Store(true); return f.outputFile.Close() }

func TestFinalizationWaitsForSlowCallback(t *testing.T) {
	s := openSink(t, "jsonl")
	ds := source(t, datasource.TypeSingle, "events")
	if err := s.Subscribe(map[string]datasource.DataSource{"events": ds}, nil, func() {}); err != nil {
		t.Fatal(err)
	}
	unbuffered(t, s)
	f := &blockedFile{outputFile: s.file, entered: make(chan struct{}), release: make(chan struct{})}
	s.file = f
	callbackDone := make(chan struct{})
	go func() { defer close(callbackDone); p, _ := ds.NewPacketSingle(); ds.EmitAndRelease(p) }()
	<-f.entered
	finalized := make(chan Status, 1)
	go func() { finalized <- s.Finalize(nil) }()
	select {
	case <-finalized:
		t.Fatal("finalized with a callback in flight")
	case <-time.After(30 * time.Millisecond):
	}
	if f.closed.Load() {
		t.Fatal("closed under callback")
	}
	close(f.release)
	<-callbackDone
	status := <-finalized
	if !f.closed.Load() || status.State != "completed" || status.Records != 1 {
		t.Fatalf("%+v", status)
	}
}

func TestFailedRunWithoutRecordsRemovesPartial(t *testing.T) {
	for _, subscribed := range []bool{false, true} {
		t.Run(map[bool]string{false: "unstarted", true: "headers-only"}[subscribed], func(t *testing.T) {
			s := openSink(t, "jsonl")
			if subscribed {
				ds := source(t, datasource.TypeSingle, "events")
				if err := s.Subscribe(map[string]datasource.DataSource{"events": ds}, nil, func() {}); err != nil {
					t.Fatal(err)
				}
			}
			status := s.Finalize(errors.New("connection refused"))
			if status.State != "failed" || status.PartialPath != "" {
				t.Fatalf("%+v", status)
			}
			if entries, _ := os.ReadDir(filepath.Dir(status.Path)); len(entries) != 0 {
				t.Fatalf("partial left behind: %v", entries)
			}
		})
	}
}

func TestPCAPPrefersRawTimestampSibling(t *testing.T) {
	s := openSink(t, "pcap-ng")
	ds := packetSource(t, "packets")
	raw := addField(t, ds, "time_raw", api.Kind_Uint64, nil)
	if err := s.Subscribe(map[string]datasource.DataSource{"packets": ds}, nil, func() {}); err != nil {
		t.Fatal(err)
	}
	want := time.Date(2026, 9, 18, 11, 0, 0, 987654321, time.UTC)
	p, _ := ds.NewPacketSingle()
	ds.GetField("body").Set(p, []byte{0, 1})
	// A gadget-specific display layout that is not RFC3339Nano.
	ds.GetField("time").PutString(p, "18 Sep 26 11:00 UTC")
	raw.PutUint64(p, uint64(want.UnixNano()))
	ds.GetField("length").PutUint32(p, 2)
	if err := ds.EmitAndRelease(p); err != nil {
		t.Fatal(err)
	}
	status := s.Finalize(nil)
	if status.State != "completed" || status.Records != 1 {
		t.Fatalf("%+v", status)
	}
	b, _ := os.ReadFile(status.Path)
	reader, err := pcapgo.NewNgReader(bytes.NewReader(b), pcapgo.DefaultNgReaderOptions)
	if err != nil {
		t.Fatal(err)
	}
	_, ci, err := reader.ReadPacketData()
	if err != nil || !ci.Timestamp.Equal(want) {
		t.Fatalf("timestamp %v %v", ci.Timestamp, err)
	}
}
