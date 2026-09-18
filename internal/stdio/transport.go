// Copyright 2026 The Inspektor Gadget authors
// SPDX-License-Identifier: Apache-2.0

// Package stdio implements the private, newline-delimited JSON client transport.
package stdio

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"runtime/debug"
	"sync"
	"time"

	"github.com/inspektor-gadget/ig-desktop/pkg/api"
	apitransport "github.com/inspektor-gadget/ig-desktop/pkg/api/transport"
)

const (
	ProtocolVersion = 1
	MaxFrameBytes   = 8 * 1024 * 1024 // JSON bytes, excluding the newline.
	MaxPending      = 128

	// WriteTimeout bounds a single frame write to a host that stopped reading.
	WriteTimeout = 5 * time.Second
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
	shutdown func() error

	writeTimeout time.Duration
}

var _ apitransport.Transport = (*Transport)(nil)

// New creates a single-connection transport. hello is the clientHello reply data.
func New(ctx context.Context, input io.ReadCloser, output io.Writer, hello any) *Transport {
	ctx, cancel := context.WithCancel(ctx)
	return &Transport{
		ctx: ctx, cancel: cancel, input: input, output: output, hello: hello,
		pending: make(map[string]string), writeTimeout: WriteTimeout,
	}
}

func (t *Transport) OnMessage(handler func(string))    { t.handler = handler }
func (t *Transport) Context() context.Context          { return t.ctx }
func (t *Transport) SetShutdown(shutdown func() error) { t.shutdown = shutdown }

// ErrFrameTooLarge reports an outgoing message that was not sent as-is
// because it exceeds MaxFrameBytes. The connection stays usable.
var ErrFrameTooLarge = fmt.Errorf("outgoing frame exceeds %d bytes", MaxFrameBytes)

// Send serializes complete frames; a failed write ends the connection.
//
// A message that cannot be encoded or exceeds MaxFrameBytes is not fatal: a
// response (an *api.Event with a reqID) is replaced by an error reply to that
// request, and any other message is dropped. Both return an error.
func (t *Transport) Send(message any) error {
	data, err := json.Marshal(message)
	ev, isResponse := message.(*api.Event)
	isResponse = isResponse && ev.RequestID != ""
	var notSent error
	switch {
	case err != nil:
		notSent = fmt.Errorf("encoding outgoing message: %w", err)
	case len(data) > MaxFrameBytes:
		notSent = fmt.Errorf("%w (%d bytes)", ErrFrameTooLarge, len(data))
	}
	if notSent != nil {
		if !isResponse {
			log.Printf("stdio: dropping outgoing message: %v", notSent)
			return notSent
		}
		log.Printf("stdio: replacing %q response %q with an error: %v", ev.Command, ev.RequestID, notSent)
		reply := &api.Event{Type: ev.Type, Command: ev.Command, RequestID: ev.RequestID}
		if errors.Is(notSent, ErrFrameTooLarge) {
			reply.SetError(errors.New("response exceeds frame limit"))
		} else {
			reply.SetError(errors.New("response could not be encoded"))
		}
		if data, err = json.Marshal(reply); err != nil {
			return err
		}
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.err != nil {
		return t.err
	}
	if err := t.write(append(data, '\n')); err != nil {
		t.err = err
		t.Close()
		return err
	}
	if isResponse {
		delete(t.pending, ev.RequestID)
	}
	return notSent
}

// reply sends a transport-generated reply and reports only errors that ended
// the connection.
func (t *Transport) reply(message any) error {
	if t.Send(message) == nil {
		return nil
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.err
}

// write writes one frame within t.writeTimeout. Pollable files and pipes use a
// write deadline; other writers (blocking fds, Windows pipes) are bounded by a
// timer, after which the abandoned write goroutine can only fail because the
// connection is torn down.
func (t *Transport) write(data []byte) error {
	if dw, ok := t.output.(interface{ SetWriteDeadline(time.Time) error }); ok {
		if dw.SetWriteDeadline(time.Now().Add(t.writeTimeout)) == nil {
			return writeFull(t.output, data)
		}
	}
	done := make(chan error, 1)
	go func() { done <- writeFull(t.output, data) }()
	timer := time.NewTimer(t.writeTimeout)
	defer timer.Stop()
	select {
	case err := <-done:
		return err
	case <-timer.C:
		return fmt.Errorf("stdio: write timed out after %s: %w", t.writeTimeout, os.ErrDeadlineExceeded)
	}
}

func writeFull(w io.Writer, data []byte) error {
	n, err := w.Write(data)
	if err == nil && n != len(data) {
		err = io.ErrShortWrite
	}
	return err
}

type readResult struct {
	line []byte
	err  error
	eof  bool
}

// readLines scans frames on its own goroutine so Start can stop waiting once
// the context is cancelled even if Read never returns (blocking fds ignore
// Close on most platforms).
func (t *Transport) readLines() <-chan readResult {
	results := make(chan readResult)
	go func() {
		scanner := bufio.NewScanner(t.input)
		scanner.Buffer(make([]byte, 64*1024), MaxFrameBytes+2)
		for scanner.Scan() {
			select {
			case results <- readResult{line: bytes.Clone(scanner.Bytes())}:
			case <-t.ctx.Done():
				return
			}
		}
		select {
		case results <- readResult{err: scanner.Err(), eof: true}:
		case <-t.ctx.Done():
		}
	}()
	return results
}

// invoke runs the command handler and turns a panic into an error reply, so
// one faulty handler cannot crash the process and every other session.
func (t *Transport) invoke(ev api.Event, message string) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("stdio: command %q (reqID %q) panicked: %v\n%s", ev.Command, ev.RequestID, r, debug.Stack())
			t.mu.Lock()
			_, pending := t.pending[ev.RequestID]
			t.mu.Unlock()
			if pending || ev.RequestID == "" {
				t.Send(ev.SetError(fmt.Errorf("internal error handling %s", ev.Command)))
			}
		}
	}()
	t.handler(message)
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
	lines := t.readLines()
	var readErr error
loop:
	for {
		var next readResult
		select {
		case <-t.ctx.Done():
			break loop
		case next = <-lines:
		}
		if next.eof {
			readErr = next.err
			break loop
		}
		if t.ctx.Err() != nil {
			break loop
		}
		line := next.line
		if len(line) > MaxFrameBytes {
			return fmt.Errorf("incoming frame exceeds %d bytes", MaxFrameBytes)
		}
		var ev api.Event
		if err := json.Unmarshal(line, &ev); err != nil {
			if err := t.reply((&api.Event{Type: 1}).SetError(errors.New("invalid command JSON"))); err != nil {
				return err
			}
			continue
		}
		legacyHello := ev.Command == "helo" && ev.RequestID == ""
		if (ev.Type != 0 && ev.Type != api.TypeCommandResponse) || ev.Command == "" || (ev.RequestID == "" && !legacyHello) {
			ev.Type = api.TypeCommandResponse
			if err := t.reply(ev.SetError(errors.New("type must be omitted or 1; cmd and reqID must be non-empty strings"))); err != nil {
				return err
			}
			continue
		}
		ev.Type = api.TypeCommandResponse
		if legacyHello {
			t.invoke(ev, string(line))
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
			if err := t.reply(ev.SetError(errors.New("too many pending requests"))); err != nil {
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
			if err := t.reply(&ev); err != nil {
				return err
			}
		case "shutdown":
			t.cancel()
			handlersDone := make(chan struct{})
			go func() { t.dispatch.Wait(); close(handlersDone) }()
			var shutdownErr error
			select {
			case <-handlersDone:
			case <-time.After(5 * time.Second):
				shutdownErr = errors.New("timed out draining command handlers")
			}
			if t.shutdown != nil {
				shutdownErr = errors.Join(shutdownErr, t.shutdown())
			}
			if shutdownErr != nil {
				return t.reply(ev.SetError(shutdownErr))
			}
			return t.reply(ev.SetData(nil))
		default:
			message := string(line)
			t.dispatch.Add(1)
			go func() {
				defer t.dispatch.Done()
				t.invoke(ev, message)
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
	if err := readErr; err != nil {
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
