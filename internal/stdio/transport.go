// Copyright 2026 The Inspektor Gadget authors
// SPDX-License-Identifier: Apache-2.0

// Package stdio implements the private, newline-delimited JSON client transport.
package stdio

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sync"
	"time"

	"github.com/inspektor-gadget/ig-desktop/pkg/api"
	apitransport "github.com/inspektor-gadget/ig-desktop/pkg/api/transport"
)

const (
	ProtocolVersion = 1
	MaxFrameBytes   = 8 * 1024 * 1024 // JSON bytes, excluding the newline.
	MaxPending      = 128
)

type Transport struct {
	ctx      context.Context
	cancel   context.CancelFunc
	input    io.ReadCloser
	output   io.Writer
	hello    any
	handler  func(string)
	mu       sync.Mutex
	pending  map[string]string
	err      error
	once     sync.Once
	dispatch sync.WaitGroup
}

var _ apitransport.Transport = (*Transport)(nil)

// New creates a single-connection transport. hello is the clientHello reply data.
func New(ctx context.Context, input io.ReadCloser, output io.Writer, hello any) *Transport {
	ctx, cancel := context.WithCancel(ctx)
	return &Transport{
		ctx: ctx, cancel: cancel, input: input, output: output, hello: hello,
		pending: make(map[string]string),
	}
}

func (t *Transport) OnMessage(handler func(string)) { t.handler = handler }
func (t *Transport) Context() context.Context       { return t.ctx }

// Send serializes complete frames; a failed or oversized write ends the connection.
func (t *Transport) Send(message any) error {
	data, err := json.Marshal(message)
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.err != nil {
		return t.err
	}
	if err == nil && len(data) > MaxFrameBytes {
		err = fmt.Errorf("outgoing frame exceeds %d bytes", MaxFrameBytes)
	}
	if err == nil {
		if deadlineWriter, ok := t.output.(interface{ SetWriteDeadline(time.Time) error }); ok {
			// Pipes support deadlines. Regular files may not.
			_ = deadlineWriter.SetWriteDeadline(time.Now().Add(5 * time.Second))
		}
		data = append(data, '\n')
		var n int
		n, err = t.output.Write(data)
		if err == nil && n != len(data) {
			err = io.ErrShortWrite
		}
	}
	if err != nil {
		t.err = err
		t.Close()
		return err
	}
	if ev, ok := message.(*api.Event); ok && ev.RequestID != "" {
		delete(t.pending, ev.RequestID)
	}
	return nil
}

func (t *Transport) Start() (result error) {
	if t.handler == nil {
		return errors.New("stdio: no command handler")
	}
	go func() {
		<-t.ctx.Done()
		t.input.Close()
	}()
	defer func() {
		t.Close()
		done := make(chan struct{})
		go func() {
			t.dispatch.Wait()
			close(done)
		}()
		select {
		case <-done:
		case <-time.After(5 * time.Second):
			result = errors.Join(result, errors.New("timed out draining command handlers"))
		}
		t.mu.Lock()
		result = errors.Join(result, t.err)
		t.mu.Unlock()
	}()
	scanner := bufio.NewScanner(t.input)
	scanner.Buffer(make([]byte, 64*1024), MaxFrameBytes+2)
	for scanner.Scan() {
		if t.ctx.Err() != nil {
			break
		}
		line := scanner.Bytes()
		if len(line) > MaxFrameBytes {
			return fmt.Errorf("incoming frame exceeds %d bytes", MaxFrameBytes)
		}
		var ev api.Event
		if err := json.Unmarshal(line, &ev); err != nil {
			if err := t.Send((&api.Event{Type: 1}).SetError(errors.New("invalid command JSON"))); err != nil {
				return err
			}
			continue
		}
		legacyHello := ev.Command == "helo" && ev.RequestID == ""
		if (ev.Type != 0 && ev.Type != api.TypeCommandResponse) || ev.Command == "" || (ev.RequestID == "" && !legacyHello) {
			ev.Type = api.TypeCommandResponse
			if err := t.Send(ev.SetError(errors.New("type must be omitted or 1; cmd and reqID must be non-empty strings"))); err != nil {
				return err
			}
			continue
		}
		ev.Type = api.TypeCommandResponse
		if legacyHello {
			t.handler(string(line))
			continue
		}
		t.mu.Lock()
		_, duplicate := t.pending[ev.RequestID]
		full := len(t.pending) >= MaxPending && ev.Command != "shutdown"
		if !duplicate && !full {
			t.pending[ev.RequestID] = ev.Command
		}
		t.mu.Unlock()
		if duplicate {
			return errors.New("duplicate in-flight reqID")
		}
		if full {
			if err := t.Send(ev.SetError(errors.New("too many pending requests"))); err != nil {
				return err
			}
			continue
		}
		switch ev.Command {
		case "clientHello":
			var req struct {
				ProtocolVersion int `json:"protocolVersion"`
			}
			if err := json.Unmarshal(ev.Data, &req); err != nil || req.ProtocolVersion != ProtocolVersion {
				ev.SetError(fmt.Errorf("clientHello requires protocolVersion %d", ProtocolVersion))
			} else {
				ev.SetData(t.hello)
			}
			if err := t.Send(&ev); err != nil {
				return err
			}
		case "shutdown":
			return t.Send(ev.SetData(nil))
		default:
			message := string(line)
			t.dispatch.Add(1)
			go func() {
				defer t.dispatch.Done()
				t.handler(message)
			}()
		}
	}
	t.mu.Lock()
	err := t.err
	t.mu.Unlock()
	if err != nil {
		return err
	}
	if t.ctx.Err() != nil {
		return nil
	}
	if err := scanner.Err(); err != nil {
		return fmt.Errorf("reading stdio frame (maximum %d bytes): %w", MaxFrameBytes, err)
	}
	return nil
}

func (t *Transport) Close() error {
	var err error
	t.once.Do(func() {
		t.cancel()
		err = t.input.Close()
	})
	return err
}
