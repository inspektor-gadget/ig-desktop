// Copyright 2026 The Inspektor Gadget authors
// SPDX-License-Identifier: Apache-2.0

//go:build unix

package stdio

import (
	"context"
	"errors"
	"io"
	"os"
	"strings"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

// blockingPipe mimics the fds a host such as Node's child_process.spawn hands
// the client: os.NewFile on a blocking fd is not managed by the poller, so
// Close does not interrupt Read and write deadlines are unsupported.
func blockingPipe(t *testing.T) (r, w *os.File) {
	t.Helper()
	var fds [2]int
	if err := unix.Pipe(fds[:]); err != nil {
		t.Fatal(err)
	}
	r, w = os.NewFile(uintptr(fds[0]), "r"), os.NewFile(uintptr(fds[1]), "w")
	if err := w.SetWriteDeadline(time.Now()); err == nil {
		t.Fatal("test pipe unexpectedly supports deadlines")
	}
	return r, w
}

func TestBlockingStdinCancellationExits(t *testing.T) {
	r, w := blockingPipe(t)
	defer w.Close() // The host keeps stdin open.
	ctx, cancel := context.WithCancel(context.Background())
	tr := New(ctx, r, io.Discard, nil)
	tr.OnMessage(func(string) {})
	done := make(chan error, 1)
	go func() { done <- tr.Start() }()
	time.Sleep(50 * time.Millisecond)
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Start blocked on a read that Close cannot interrupt")
	}
}

func TestStalledHostWriteTimesOut(t *testing.T) {
	r, w := blockingPipe(t)
	defer r.Close() // Open but never read.
	tr := New(context.Background(), io.NopCloser(strings.NewReader("")), w, nil)
	tr.writeTimeout = 100 * time.Millisecond
	done := make(chan error, 1)
	go func() { done <- tr.Send(strings.Repeat("x", 1<<20)) }()
	select {
	case err := <-done:
		if !errors.Is(err, os.ErrDeadlineExceeded) {
			t.Fatalf("got %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Send blocked on a host that stopped reading")
	}
	if tr.Context().Err() == nil {
		t.Fatal("write timeout did not end the connection")
	}
}

func TestPollableDupSupportsDeadlinesAndClose(t *testing.T) {
	r, w := blockingPipe(t)
	defer r.Close()
	defer w.Close()
	pr, err := pollableDup(int(r.Fd()), "pr")
	if err != nil {
		t.Fatal(err)
	}
	pw, err := pollableDup(int(w.Fd()), "pw")
	if err != nil {
		t.Fatal(err)
	}
	defer pw.Close()
	if err := pw.SetWriteDeadline(time.Now().Add(time.Second)); err != nil {
		t.Fatalf("pollable copy rejects deadlines: %v", err)
	}
	readDone := make(chan error, 1)
	go func() {
		_, err := pr.Read(make([]byte, 1))
		readDone <- err
	}()
	time.Sleep(50 * time.Millisecond)
	pr.Close()
	select {
	case err := <-readDone:
		if !errors.Is(err, os.ErrClosed) {
			t.Fatalf("got %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Close did not interrupt Read")
	}
}
