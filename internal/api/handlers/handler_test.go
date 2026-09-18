// Copyright 2026 The Inspektor Gadget authors
// SPDX-License-Identifier: Apache-2.0

package handlers

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/inspektor-gadget/ig-desktop/pkg/api"
	"github.com/inspektor-gadget/ig-desktop/pkg/fileoutput"
	"github.com/inspektor-gadget/ig-desktop/pkg/gadget"
)

type testTransport struct {
	mu      sync.Mutex
	handler func(string)
	lines   []string
	replies []*api.Event
}

// Hosts expose different file output commands: Desktop (native) only lets the
// webview pick through a native dialog, never submit a path; the stdio host
// accepts paths but the manager denies unsafe ones; without a manager nothing
// is available.
func TestFileOutputCommandsAndPathDenialPerHost(t *testing.T) {
	dir := t.TempDir()
	existing := filepath.Join(dir, "existing.jsonl")
	if err := os.WriteFile(existing, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	prepare := func(reqID, path string) string {
		return string(requestData(t, map[string]any{"cmd": "prepareFileOutput", "reqID": reqID, "data": map[string]string{"path": path, "format": "jsonl"}}))
	}
	type want struct {
		success bool
		error   string
	}
	for _, host := range []struct {
		name    string
		prepare bool
		picker  bool
		manager bool
		want    map[string]want
	}{
		{name: "none", want: map[string]want{
			"cap":      {error: "unknown command"},
			"relative": {error: "unknown command"},
			"select":   {error: "unknown command"},
			"run":      {error: "file output is unavailable"},
		}},
		{name: "native", manager: true, picker: true, want: map[string]want{
			"cap":      {success: true},
			"relative": {error: "unknown command: prepareFileOutput"},
			"select":   {success: true},
		}},
		{name: "stdio", manager: true, prepare: true, want: map[string]want{
			"cap":      {success: true},
			"relative": {error: "must be an absolute"},
			"existing": {error: "explicit replacement confirmation required"},
			"fresh":    {success: true},
			"select":   {error: "unknown command: selectFileOutput"},
		}},
	} {
		t.Run(host.name, func(t *testing.T) {
			manager := gadget.NewInstanceManager()
			handler := New(context.Background(), nil, nil, gadget.NewService(manager), manager, nil, nil, nil, "")
			if host.manager {
				outputs := fileoutput.NewManager("host")
				defer outputs.Close()
				var picker func(string) (*fileoutput.Selection, error)
				if host.picker {
					picker = func(string) (*fileoutput.Selection, error) { return nil, nil }
				}
				handler.EnableFileOutput(outputs, host.prepare, picker)
			}
			transport := &testTransport{lines: []string{
				`{"cmd":"getFileOutputCapabilities","reqID":"cap","data":{}}`,
				prepare("relative", "untrusted.jsonl"),
				prepare("existing", existing),
				prepare("fresh", filepath.Join(dir, host.name+".jsonl")),
				`{"cmd":"selectFileOutput","reqID":"select","data":{"format":"jsonl"}}`,
			}}
			if !host.manager {
				// With a manager, runGadget would go on to resolve a runtime.
				transport.lines = append(transport.lines, `{"cmd":"runGadget","reqID":"run","data":{"output":{"token":"untrusted","format":"jsonl"}}}`)
			}
			if err := handler.Register(transport); err != nil {
				t.Fatal(err)
			}
			if len(transport.replies) != len(transport.lines) {
				t.Fatalf("got %d replies for %d requests", len(transport.replies), len(transport.lines))
			}
			for _, ev := range transport.replies {
				w, ok := host.want[ev.RequestID]
				if !ok {
					continue
				}
				if ev.Success != w.success || !strings.Contains(ev.Error, w.error) {
					t.Errorf("%s: want %+v, got %+v", ev.RequestID, w, ev)
				}
				if host.picker && ev.RequestID == "select" && string(ev.Data) != "null" {
					t.Error("picker cancellation must be null")
				}
			}
		})
	}
}

func (t *testTransport) OnMessage(fn func(string)) { t.handler = fn }
func (t *testTransport) Close() error              { return nil }
func (t *testTransport) Start() error {
	for _, line := range t.lines {
		t.handler(line)
	}
	return nil
}
func (t *testTransport) Send(value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	var ev api.Event
	if err := json.Unmarshal(data, &ev); err != nil {
		return err
	}
	t.mu.Lock()
	t.replies = append(t.replies, &ev)
	t.mu.Unlock()
	return nil
}

func TestCommandErrorsAndStop(t *testing.T) {
	manager := gadget.NewInstanceManager()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	manager.Register("owned", cancel)
	defer manager.Unregister("owned")
	handler := New(context.Background(), nil, nil, gadget.NewService(manager), manager, nil, nil, nil, "")
	transport := &testTransport{lines: []string{
		`{"type":1,"cmd":"unknown","reqID":"1","success":true}`,
		`{"type":1,"cmd":"stopInstance","reqID":"2","data":{"id":"missing"}}`,
		`{"type":1,"cmd":"runGadget","reqID":"3","data":{"record":true}}`,
		`{"type":1,"cmd":"runGadget","reqID":"4","data":{"durationSeconds":-1}}`,
		`{"type":1,"cmd":"runGadget","reqID":"5","data":{"durationSeconds":1,"detached":true}}`,
		`{"type":1,"cmd":"stopInstance","reqID":"6","error":"injected","data":{"id":"owned"}}`,
	}}
	if err := handler.Register(transport); err != nil {
		t.Fatal(err)
	}
	if len(transport.replies) != len(transport.lines) {
		t.Fatal("missing or duplicate reply")
	}
	for i, ev := range transport.replies {
		if i < 5 && (ev.Success || ev.Error == "") {
			t.Fatalf("expected error: %+v", ev)
		}
		if i == 5 && (!ev.Success || ev.Error != "") {
			t.Fatalf("expected clean ACK: %+v", ev)
		}
	}
	if ctx.Err() != context.Canceled {
		t.Fatal("owned context was not cancelled")
	}
}
