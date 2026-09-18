// Copyright 2026 The Inspektor Gadget authors
// SPDX-License-Identifier: Apache-2.0

package plugins

import (
	"bytes"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The stdio client speaks its protocol on stdout, so discovery diagnostics
// must go to the logger, never to stdout.
func TestDiscoveryWarningsAvoidStdout(t *testing.T) {
	dir := t.TempDir()
	if err := os.Mkdir(filepath.Join(dir, "broken"), 0o755); err != nil {
		t.Fatal(err)
	}
	service, err := NewServiceAt(dir)
	if err != nil {
		t.Fatal(err)
	}

	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	stdout := os.Stdout
	os.Stdout = w
	var logs bytes.Buffer
	log.SetOutput(&logs)
	defer log.SetOutput(os.Stderr)
	_, discoverErr := service.DiscoverPlugins()
	os.Stdout = stdout
	w.Close()
	written, _ := io.ReadAll(r)

	if discoverErr != nil {
		t.Fatal(discoverErr)
	}
	if len(written) != 0 {
		t.Fatalf("discovery wrote to stdout: %q", written)
	}
	if !strings.Contains(logs.String(), "skipping plugin broken") {
		t.Fatalf("missing diagnostic: %q", logs.String())
	}
}
