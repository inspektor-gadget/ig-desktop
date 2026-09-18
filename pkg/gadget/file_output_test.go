// Copyright 2026 The Inspektor Gadget authors
// SPDX-License-Identifier: Apache-2.0

package gadget

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	apiTypes "github.com/inspektor-gadget/ig-desktop/pkg/api"
	"github.com/inspektor-gadget/ig-desktop/pkg/fileoutput"
	grpcruntime "github.com/inspektor-gadget/ig-desktop/pkg/grpc-runtime"
	"github.com/inspektor-gadget/inspektor-gadget/pkg/datasource"
	"github.com/inspektor-gadget/inspektor-gadget/pkg/gadget-service/api"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/proto"
)

type fileGadgetServer struct {
	api.UnimplementedGadgetManagerServer
	count          int
	wait           bool
	failBeforeInfo bool
}

func (s *fileGadgetServer) RunGadget(stream api.GadgetManager_RunGadgetServer) error {
	if _, err := stream.Recv(); err != nil {
		return err
	}
	if s.failBeforeInfo {
		return errors.New("synthetic startup failure")
	}
	ds, _ := datasource.New(datasource.TypeSingle, "events")
	value, _ := ds.AddField("value", api.Kind_Uint64)
	info, _ := proto.Marshal(&api.GadgetInfo{ImageName: "test", DataSources: []*api.DataSource{{Id: 1, Name: ds.Name(), Type: uint32(ds.Type()), Fields: ds.Fields()}}})
	if err := stream.Send(&api.GadgetEvent{Type: api.EventTypeGadgetInfo, Payload: info}); err != nil {
		return err
	}
	for i := 0; i < s.count; i++ {
		p, _ := ds.NewPacketSingle()
		value.PutUint64(p, uint64(i))
		data, _ := proto.Marshal(p.Raw())
		ds.Release(p)
		if err := stream.Send(&api.GadgetEvent{Type: api.EventTypeGadgetPayload, DataSourceID: 1, Payload: data, Seq: uint32(i + 1)}); err != nil {
			return err
		}
	}
	if s.wait {
		_, err := stream.Recv()
		return err
	}
	return nil
}

func TestFileRunThroughRuntimeNoFrontendPayload(t *testing.T) {
	for _, test := range []struct {
		name                       string
		manualStop, failBeforeInfo bool
		replace                    bool
	}{
		{name: "natural"}, {name: "stop", manualStop: true}, {name: "startup-failure", failBeforeInfo: true}, {name: "replacement", replace: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			listener, err := net.Listen("tcp", "127.0.0.1:0")
			if err != nil {
				t.Fatal(err)
			}
			server := grpc.NewServer()
			api.RegisterGadgetManagerServer(server, &fileGadgetServer{count: 2000, wait: test.manualStop, failBeforeInfo: test.failBeforeInfo})
			go server.Serve(listener)
			defer server.Stop()
			runtime := grpcruntime.New()
			params := runtime.GlobalParamDescs().ToParams()
			params.Set(grpcruntime.ParamRemoteAddress, "tcp://"+listener.Addr().String())
			if err := runtime.Init(params); err != nil {
				t.Fatal(err)
			}
			dir, err := filepath.Abs(filepath.Join(".test-output", uuid.NewString()))
			if err != nil {
				t.Fatal(err)
			}
			if err := os.MkdirAll(dir, 0700); err != nil {
				t.Fatal(err)
			}
			defer func() { os.RemoveAll(dir); os.Remove(filepath.Dir(dir)) }()
			outputs := fileoutput.NewManager("host")
			defer outputs.Close()
			path := filepath.Join(dir, "capture.jsonl")
			if test.replace {
				if err := os.WriteFile(path, []byte("old capture"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			selection, err := outputs.Prepare(path, "jsonl", test.replace)
			if err != nil {
				t.Fatal(err)
			}
			manager := NewInstanceManager()
			service := NewService(manager)
			service.SetFileOutputs(outputs)
			var mu sync.Mutex
			var events []*apiTypes.GadgetEvent
			terminal := make(chan *apiTypes.GadgetEvent, 1)
			running := make(chan struct{}, 1)
			service.SetSendFunc(func(message any) {
				ev, ok := message.(*apiTypes.GadgetEvent)
				if !ok {
					return
				}
				mu.Lock()
				events = append(events, ev)
				mu.Unlock()
				if ev.Type == apiTypes.TypeGadgetOutput {
					select {
					case running <- struct{}{}:
					default:
					}
				}
				if ev.Type == apiTypes.TypeGadgetStop {
					terminal <- ev
				}
			})
			var ack fileoutput.Status
			safeTarget := &fileoutput.Target{Name: "selected target", Runtime: "grpc-k8s", Context: "frozen-context", DefaultNamespace: "selected-ns", Transient: true}
			id, err := service.Run(context.Background(), runtime, RunRequest{Image: "test", EnvironmentID: "env", Output: &fileoutput.Request{Token: selection.Token, Format: "jsonl"}, OutputStatus: &ack, OutputTarget: safeTarget})
			if err != nil {
				t.Fatal(err)
			}
			if ack.State != "starting" || ack.Path != selection.Path || ack.PartialPath == "" {
				t.Fatalf("ack %+v", ack)
			}
			if test.manualStop {
				select {
				case <-running:
				case <-time.After(5 * time.Second):
					t.Fatal("no progress")
				}
				if err := manager.Stop(id); err != nil {
					t.Fatal(err)
				}
			}
			var end *apiTypes.GadgetEvent
			select {
			case end = <-terminal:
			case <-time.After(10 * time.Second):
				t.Fatal("no terminal result")
			}
			var data struct {
				Error  string            `json:"error"`
				Output fileoutput.Status `json:"output"`
			}
			if err := json.Unmarshal(end.Data, &data); err != nil {
				t.Fatal(err)
			}
			if test.failBeforeInfo {
				if data.Error == "" || data.Output.State != "failed" || data.Output.Path != selection.Path || data.Output.PartialPath != "" || data.Output.Records != 0 || data.Output.Bytes != 0 {
					t.Fatalf("missing complete early failure status: %+v", data)
				}
				if entries, _ := os.ReadDir(filepath.Dir(selection.Path)); len(entries) != 0 {
					t.Fatalf("early failure left an empty partial: %v", entries)
				}
				if _, err := os.Stat(data.Output.Path); !errors.Is(err, os.ErrNotExist) {
					t.Fatal("early failure published")
				}
				mu.Lock()
				defer mu.Unlock()
				for _, ev := range events {
					if ev.Type == apiTypes.TypeGadgetInfo || ev.Type == apiTypes.TypeGadgetOutput || ev.Type == apiTypes.TypeGadgetEvent || ev.Type == apiTypes.TypeGadgetEventArray {
						t.Fatalf("unexpected event before startup metadata: %+v", ev)
					}
				}
				return
			}
			if data.Error != "" || data.Output.State != "completed" || data.Output.Records != 2000 {
				t.Fatalf("terminal %+v", data)
			}
			if test.replace {
				if entries, _ := os.ReadDir(dir); data.Output.RecoveryPath != "" || len(entries) != 1 {
					t.Fatalf("replaced file kept after success: %+v %v", data, entries)
				}
			}
			b, err := os.ReadFile(data.Output.Path)
			if err != nil {
				t.Fatal("terminal before publication:", err)
			}
			if bytes.Count(b, []byte("\n")) != 2002 || data.Output.Bytes != uint64(len(b)) {
				t.Fatal("missing records/bytes")
			}
			var header struct {
				Provenance struct {
					Target fileoutput.Target `json:"target"`
				} `json:"provenance"`
			}
			if err := json.Unmarshal(bytes.SplitN(b, []byte("\n"), 2)[0], &header); err != nil || header.Provenance.Target != *safeTarget {
				t.Fatalf("offline target provenance lost: %+v %v", header, err)
			}
			mu.Lock()
			defer mu.Unlock()
			infoSeen := false
			progress := 0
			for _, ev := range events {
				if ev.Type == apiTypes.TypeGadgetInfo {
					infoSeen = true
				}
				if ev.Type == apiTypes.TypeGadgetEvent || ev.Type == apiTypes.TypeGadgetEventArray {
					t.Fatal("file payload leaked to frontend")
				}
				if ev.Type == apiTypes.TypeGadgetOutput {
					if !infoSeen {
						t.Fatal("progress before metadata")
					}
					progress++
				}
			}
			if progress > 5 {
				t.Fatalf("unbounded progress: %d", progress)
			}
		})
	}
}

func TestFileOutputHostAndModeDenial(t *testing.T) {
	service := NewService(NewInstanceManager())
	req := RunRequest{Output: &fileoutput.Request{Token: "untrusted", Format: "jsonl"}}
	if _, err := service.Run(context.Background(), nil, req); err == nil {
		t.Fatal("default service supports filesystem output")
	}
	service.SetFileOutputs(fileoutput.NewManager("host"))
	for _, field := range []string{"detach", "record", "session"} {
		r := req
		switch field {
		case "detach":
			r.Detached = true
		case "record":
			r.Record = true
		case "session":
			r.SessionID = "session"
		}
		if _, err := service.Run(context.Background(), nil, r); err == nil {
			t.Fatal("incompatible file mode accepted")
		}
	}

}

func TestFileAuthorizationErrorsAreSynchronous(t *testing.T) {
	dir, err := filepath.Abs(filepath.Join(".test-output", uuid.NewString()))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	defer func() { os.RemoveAll(dir); os.Remove(filepath.Dir(dir)) }()
	outputs := fileoutput.NewManager("host")
	defer outputs.Close()
	service := NewService(NewInstanceManager())
	service.SetFileOutputs(outputs)
	service.SetSendFunc(func(any) { t.Error("rejected authorization emitted a gadget event") })
	for _, name := range []string{"unknown-token", "format-mismatch", "changed-destination"} {
		t.Run(name, func(t *testing.T) {
			path := filepath.Join(dir, name)
			selected, err := outputs.Prepare(path, "jsonl", false)
			if err != nil {
				t.Fatal(err)
			}
			request := fileoutput.Request{Token: selected.Token, Format: "jsonl"}
			switch name {
			case "unknown-token":
				request.Token = "unknown"
			case "format-mismatch":
				request.Format = "pcap-ng"
			case "changed-destination":
				if err := os.WriteFile(path, []byte("competing data"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			var ack fileoutput.Status
			// A nil runtime also proves rejected authorization cannot reach
			// runtime setup or launch before returning its command error.
			id, err := service.Run(context.Background(), nil, RunRequest{Output: &request, OutputStatus: &ack})
			if err == nil || id != "" || ack.State != "" {
				t.Fatalf("accepted invalid output: id=%s ack=%+v err=%v", id, ack, err)
			}
			partials, _ := filepath.Glob(filepath.Join(dir, "*.partial"))
			if len(partials) != 0 {
				t.Fatal("known pre-start failure created a partial")
			}
		})
	}
}

func TestValidateRunRejectsInvalidCombinations(t *testing.T) {
	service := NewService(NewInstanceManager())
	output := &fileoutput.Request{Token: "t", Format: "jsonl"}
	for name, req := range map[string]RunRequest{
		"output-without-host":     {Output: output},
		"record-without-recorder": {Record: true},
		"negative-duration":       {DurationSeconds: -1},
		"detached-duration":       {DurationSeconds: 1, Detached: true},
	} {
		if err := service.ValidateRun(req); err == nil {
			t.Errorf("%s accepted", name)
		}
	}
	service.SetFileOutputs(fileoutput.NewManager("host"))
	for name, req := range map[string]RunRequest{
		"output-detached": {Output: output, Detached: true},
		"output-session":  {Output: output, SessionName: "s"},
	} {
		if err := service.ValidateRun(req); err == nil {
			t.Errorf("%s accepted", name)
		}
	}
	if err := service.ValidateRun(RunRequest{Output: output, DurationSeconds: 5}); err != nil {
		t.Fatal(err)
	}
}
