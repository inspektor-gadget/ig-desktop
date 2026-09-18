// Copyright 2026 The Inspektor Gadget authors
// SPDX-License-Identifier: Apache-2.0

package handlers

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/inspektor-gadget/ig-desktop/pkg/api"
	"github.com/inspektor-gadget/ig-desktop/pkg/gadget"
)

type testTransport struct {
	handler func(string)
	lines   []string
	replies []*api.Event
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
	t.replies = append(t.replies, &ev)
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
