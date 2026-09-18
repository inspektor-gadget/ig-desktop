// Copyright 2026 The Inspektor Gadget authors
// SPDX-License-Identifier: Apache-2.0

//go:build unix

package stdio

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"
)

const streamsChildEnv = "IG_STDIO_STREAMS_CHILD"

// TestStdStreamsIsolateProtocolStdout runs a child that calls StdStreams with
// blocking pipe fds (as Node's spawn provides) and then writes stray output.
func TestStdStreamsIsolateProtocolStdout(t *testing.T) {
	if os.Getenv(streamsChildEnv) == "1" {
		streamsChild()
		return
	}
	stdinR, stdinW := blockingPipe(t)
	defer stdinW.Close()
	cmd := exec.Command(os.Args[0], "-test.run=^TestStdStreamsIsolateProtocolStdout$")
	cmd.Env = append(os.Environ(), streamsChildEnv+"=1")
	cmd.Stdin = stdinR
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	if err := cmd.Run(); err != nil {
		t.Fatalf("child failed: %v\n%s", err, stderr.String())
	}
	if got := stdout.String(); got != "frame\n" {
		t.Fatalf("protocol stdout polluted: %q (stderr %q)", got, stderr.String())
	}
	if !strings.Contains(stderr.String(), "stray") {
		t.Fatalf("stray output lost: %q", stderr.String())
	}
}

func streamsChild() {
	input, output, err := StdStreams()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
	fmt.Println("stray")
	os.Stdout.WriteString("stray\n")
	if err := output.SetWriteDeadline(time.Now().Add(time.Second)); err != nil {
		fmt.Fprintln(os.Stderr, "deadline unsupported:", err)
		os.Exit(3)
	}
	output.WriteString("frame\n")
	// The parent keeps stdin open; Close must still interrupt the read.
	done := make(chan struct{})
	go func() {
		input.Read(make([]byte, 1))
		close(done)
	}()
	time.Sleep(20 * time.Millisecond)
	input.Close()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		fmt.Fprintln(os.Stderr, "stdin read not interrupted")
		os.Exit(4)
	}
	os.Exit(0)
}
