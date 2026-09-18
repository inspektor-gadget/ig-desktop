// Copyright 2026 The Inspektor Gadget authors
// SPDX-License-Identifier: Apache-2.0

package stdio

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/inspektor-gadget/ig-desktop/pkg/api"
)

func TestHandshakeMalformedAndShutdown(t *testing.T) {
	input := "not-json\n" +
		`{"type":1,"cmd":"clientHello","reqID":"bad","data":{"protocolVersion":2}}` + "\n" +
		`{"type":1,"cmd":"clientHello","reqID":"hello","data":{"protocolVersion":1}}` + "\n" +
		`{"type":1,"cmd":"unknown","reqID":"unknown","data":{}}` + "\n" +
		`{"type":1,"cmd":"shutdown","reqID":"bye","data":{}}` + "\n" +
		`{"type":1,"cmd":"ignored","reqID":"ignored","data":{}}` + "\n"
	var output bytes.Buffer
	tr := New(context.Background(), io.NopCloser(strings.NewReader(input)), &output, map[string]int{"protocolVersion": 1})
	calls := 0
	tr.OnMessage(func(line string) {
		calls++
		var ev api.Event
		json.Unmarshal([]byte(line), &ev)
		tr.Send(ev.SetError(errors.New("unknown command")))
	})
	if err := tr.Start(); err != nil {
		t.Fatal(err)
	}

	if calls != 1 {
		t.Fatalf("dispatch count %d", calls)
	}
	lines := strings.Split(strings.TrimSpace(output.String()), "\n")
	if len(lines) != 5 {
		t.Fatalf("expected five replies, got %d", len(lines))
	}
	for i, line := range lines {
		var ev api.Event
		if err := json.Unmarshal([]byte(line), &ev); err != nil {
			t.Fatal(err)
		}
		wantSuccess := ev.RequestID == "hello" || ev.RequestID == "bye"
		if ev.Type != 1 || ev.Success != wantSuccess {
			t.Fatalf("unexpected reply %d: %+v", i, ev)
		}
	}
}

func TestShutdownFinalizesBeforeAcknowledgement(t *testing.T) {
	var output bytes.Buffer
	tr := New(context.Background(), io.NopCloser(strings.NewReader(`{"cmd":"shutdown","reqID":"bye","data":{}}`+"\n")), &output, nil)
	tr.OnMessage(func(string) {})
	tr.SetShutdown(func() error {
		if tr.Context().Err() != context.Canceled {
			t.Fatal("shutdown did not cancel runs")
		}
		return tr.Send(map[string]any{"type": 5, "data": map[string]string{"state": "completed"}})
	})
	if err := tr.Start(); err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSpace(output.String()), "\n")
	if len(lines) != 2 || !strings.Contains(lines[0], `"type":5`) || !strings.Contains(lines[1], `"reqID":"bye"`) {
		t.Fatalf("wrong shutdown ordering: %s", output.String())
	}
}

func TestFrameBounds(t *testing.T) {
	for _, size := range []int{MaxFrameBytes, MaxFrameBytes + 1} {
		t.Run(fmt.Sprint(size), func(t *testing.T) {
			base := `{"type":1,"cmd":"test","reqID":"1","data":""}`
			line := strings.Replace(base, `"data":""`, `"data":"`+strings.Repeat("x", size-len(base))+`"`, 1)
			tr := New(context.Background(), io.NopCloser(strings.NewReader(line+"\n")), io.Discard, nil)
			called := false
			tr.OnMessage(func(string) { called = true })
			err := tr.Start()
			if size == MaxFrameBytes && (err != nil || !called) {
				t.Fatalf("boundary frame rejected: %v", err)
			}
			if size > MaxFrameBytes && (err == nil || called) {
				t.Fatalf("oversized frame accepted: %v", err)
			}
		})
	}
	tr := New(context.Background(), io.NopCloser(strings.NewReader("")), io.Discard, nil)
	if err := tr.Send(strings.Repeat("x", MaxFrameBytes)); !errors.Is(err, ErrFrameTooLarge) {
		t.Fatal("oversized output accepted")
	}
}

func TestHandlerPanicRepliesWithError(t *testing.T) {
	input := `{"cmd":"boom","reqID":"1","data":{}}` + "\n" + `{"cmd":"after","reqID":"2","data":{}}` + "\n"
	var output bytes.Buffer
	tr := New(context.Background(), io.NopCloser(strings.NewReader(input)), &output, nil)
	tr.OnMessage(func(message string) {
		var ev api.Event
		json.Unmarshal([]byte(message), &ev)
		if ev.Command == "boom" {
			panic("handler bug")
		}
		ev.Type = api.TypeCommandResponse
		tr.Send(ev.SetData(nil))
	})
	if err := tr.Start(); err != nil {
		t.Fatal(err)
	}
	replies := map[string]api.Event{}
	for _, line := range strings.Split(strings.TrimSpace(output.String()), "\n") {
		var ev api.Event
		if err := json.Unmarshal([]byte(line), &ev); err != nil {
			t.Fatal(err)
		}
		replies[ev.RequestID] = ev
	}
	if r := replies["1"]; r.Success || r.Error != "internal error handling boom" {
		t.Fatalf("panicking command reply: %+v", r)
	}
	if r := replies["2"]; !r.Success {
		t.Fatalf("later command reply: %+v", r)
	}
}

func TestOversizedOutputKeepsConnection(t *testing.T) {
	var output bytes.Buffer
	tr := New(context.Background(), io.NopCloser(strings.NewReader("")), &output, nil)
	huge := strings.Repeat("x", MaxFrameBytes)

	// An unsolicited stream event is dropped.
	if err := tr.Send(map[string]any{"type": 2, "data": huge}); !errors.Is(err, ErrFrameTooLarge) {
		t.Fatalf("stream event: got %v", err)
	}
	if output.Len() != 0 {
		t.Fatal("oversized stream event was written")
	}

	// A response is replaced by an error reply to the same request.
	tr.pending["big"] = "getRunEvents"
	response := (&api.Event{Type: api.TypeCommandResponse, Command: "getRunEvents", RequestID: "big"}).SetData(huge)
	if err := tr.Send(response); !errors.Is(err, ErrFrameTooLarge) {
		t.Fatalf("response: got %v", err)
	}
	var reply api.Event
	if err := json.Unmarshal(output.Bytes(), &reply); err != nil {
		t.Fatal(err)
	}
	if reply.RequestID != "big" || reply.Success || reply.Error != "response exceeds frame limit" {
		t.Fatalf("unexpected reply %+v", reply)
	}
	if _, ok := tr.pending["big"]; ok {
		t.Fatal("replaced response left the request pending")
	}

	if tr.Context().Err() != nil {
		t.Fatal("oversized output ended the connection")
	}
	if err := tr.Send(map[string]int{"ok": 1}); err != nil {
		t.Fatalf("connection unusable after oversized output: %v", err)
	}
}

func TestConcurrentWrites(t *testing.T) {
	var output bytes.Buffer
	tr := New(context.Background(), io.NopCloser(strings.NewReader("")), &output, nil)
	defer tr.Close()
	var wg sync.WaitGroup
	for i := range 32 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := range 20 {
				if err := tr.Send(map[string]int{"i": i, "j": j}); err != nil {
					t.Error(err)
				}
			}
		}()
	}
	wg.Wait()
	lines := strings.Split(strings.TrimSpace(output.String()), "\n")
	if len(lines) != 640 {
		t.Fatalf("got %d frames", len(lines))
	}
	for _, line := range lines {
		if !json.Valid([]byte(line)) {
			t.Fatal("interleaved frame")
		}
	}
}

func TestEOFAndCancellation(t *testing.T) {
	for _, eof := range []bool{true, false} {
		t.Run(fmt.Sprint(eof), func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			reader, writer := io.Pipe()
			defer writer.Close()
			tr := New(ctx, reader, io.Discard, nil)
			tr.OnMessage(func(string) {})
			done := make(chan error, 1)
			go func() { done <- tr.Start() }()
			if eof {
				writer.Close()
			} else {
				cancel()
			}
			select {
			case err := <-done:
				if err != nil {
					t.Fatal(err)
				}
			case <-time.After(time.Second):
				t.Fatal("reader did not stop")
			}
		})
	}
}

func TestPendingBoundsAndDuplicate(t *testing.T) {
	var input strings.Builder
	for i := range MaxPending + 1 {
		fmt.Fprintf(&input, "{\"type\":1,\"cmd\":\"slow\",\"reqID\":\"%d\",\"data\":{}}\n", i)
	}
	var output bytes.Buffer
	tr := New(context.Background(), io.NopCloser(strings.NewReader(input.String())), &output, nil)
	var count atomic.Int32
	tr.OnMessage(func(string) { count.Add(1) })
	if err := tr.Start(); err != nil {
		t.Fatal(err)
	}
	if count.Load() != MaxPending || !strings.Contains(output.String(), "too many pending") {
		t.Fatal("pending request bound was not enforced")
	}

	line := "{\"type\":1,\"cmd\":\"slow\",\"reqID\":\"duplicate\",\"data\":{}}\n"
	tr = New(context.Background(), io.NopCloser(strings.NewReader(line+line)), io.Discard, nil)
	tr.OnMessage(func(string) {})
	if err := tr.Start(); err == nil {
		t.Fatal("duplicate in-flight ID accepted")
	}
}

type shortWriter struct{}

func TestEOFCancelsInFlightHandler(t *testing.T) {
	input := "{\"type\":1,\"cmd\":\"blocked\",\"reqID\":\"1\",\"data\":{}}\n"
	tr := New(context.Background(), io.NopCloser(strings.NewReader(input)), io.Discard, nil)
	cancelled := make(chan struct{})
	tr.OnMessage(func(string) {
		<-tr.Context().Done()
		close(cancelled)
	})
	if err := tr.Start(); err != nil {
		t.Fatal(err)
	}

	select {
	case <-cancelled:
	default:
		t.Fatal("EOF did not cancel the in-flight command")
	}
}

func TestDesktopRequestCompatibility(t *testing.T) {
	input := "{\"cmd\":\"helo\"}\n{\"cmd\":\"getVersion\",\"reqID\":\"1\"}\n"
	var output bytes.Buffer
	tr := New(context.Background(), io.NopCloser(strings.NewReader(input)), &output, nil)
	var count atomic.Int32
	tr.OnMessage(func(message string) {
		count.Add(1)
		var ev api.Event
		if err := json.Unmarshal([]byte(message), &ev); err != nil {
			t.Error(err)
			return
		}
		ev.Type = 1
		if err := tr.Send(ev.SetData(nil)); err != nil {
			t.Error(err)
		}
	})
	if err := tr.Start(); err != nil {
		t.Fatal(err)
	}
	if count.Load() != 2 || strings.Contains(output.String(), `"success":false`) {
		t.Fatal("legacy Desktop requests were rejected")
	}
}

func (shortWriter) Write([]byte) (int, error) { return 0, nil }

func TestWriteFailure(t *testing.T) {
	tr := New(context.Background(), io.NopCloser(strings.NewReader("")), shortWriter{}, nil)
	if err := tr.Send(map[string]string{}); !errors.Is(err, io.ErrShortWrite) {
		t.Fatalf("got %v", err)
	}
}
