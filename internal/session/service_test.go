// Copyright 2026 The Inspektor Gadget authors
// SPDX-License-Identifier: Apache-2.0

package session

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestSessionIDsCannotEscapeBaseDir(t *testing.T) {
	root := t.TempDir()
	base := filepath.Join(root, "sessions")
	if err := os.Mkdir(base, 0o755); err != nil {
		t.Fatal(err)
	}
	s, err := NewService(base)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	for _, id := range []string{
		"../escaped",
		"../" + uuid.NewString(),
		"/abs/path",
		"",
		strings.ToUpper(uuid.NewString()),
		"{" + uuid.NewString() + "}",
	} {
		if _, err := s.GetSession(id); err == nil {
			t.Errorf("GetSession(%q) accepted", id)
		}
		if _, err := s.GetGadgetRun(id, "run"); err == nil {
			t.Errorf("GetGadgetRun(%q) accepted", id)
		}
		if _, err := s.GetRunEvents(id, "run"); err == nil {
			t.Errorf("GetRunEvents(%q) accepted", id)
		}
		if _, err := s.GetRunEventsPage(id, "run", 0, 10); err == nil {
			t.Errorf("GetRunEventsPage(%q) accepted", id)
		}
		if err := s.DeleteSession(id); err == nil {
			t.Errorf("DeleteSession(%q) accepted", id)
		}
		if _, err := CreateSessionDB(base, &Session{ID: id}); err == nil {
			t.Errorf("CreateSessionDB(%q) accepted", id)
		}
	}

	entries, err := os.ReadDir(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Fatalf("files created outside the session dir: %v", entries)
	}
}

func TestValidSessionRoundTrip(t *testing.T) {
	s, err := NewService(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	id, err := s.CreateSession("demo", "env")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetSession(id); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteSession(id); err != nil {
		t.Fatal(err)
	}
}
