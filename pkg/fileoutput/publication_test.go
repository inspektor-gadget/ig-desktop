// Copyright 2026 The Inspektor Gadget authors
// SPDX-License-Identifier: Apache-2.0

package fileoutput

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/inspektor-gadget/inspektor-gadget/pkg/datasource"
)

func replacementSink(t *testing.T) *Sink {
	t.Helper()
	m := NewManager("host")
	t.Cleanup(m.Close)
	path := filepath.Join(testDirectory(t), "capture.jsonl")
	if err := os.WriteFile(path, []byte("approved old data"), 0600); err != nil {
		t.Fatal(err)
	}
	selection, err := m.Prepare(path, "jsonl", true)
	if err != nil {
		t.Fatal(err)
	}
	s, err := m.Open(Request{Token: selection.Token, Format: "jsonl"})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Finalize(errors.New("test cleanup")) })
	return s
}

func TestConfirmedReplacementAndFailedCapture(t *testing.T) {
	for _, fail := range []bool{false, true} {
		t.Run(map[bool]string{false: "success", true: "failure"}[fail], func(t *testing.T) {
			s := replacementSink(t)
			ds := source(t, datasource.TypeSingle, "events")
			if err := s.Subscribe(map[string]datasource.DataSource{"events": ds}, nil, func() {}); err != nil {
				t.Fatal(err)
			}
			p, _ := ds.NewPacketSingle()
			ds.EmitAndRelease(p)
			var runErr error
			if fail {
				runErr = errors.New("capture failed")
			}
			status := s.Finalize(runErr)
			b, err := os.ReadFile(status.Path)
			if err != nil {
				t.Fatal(err)
			}
			if fail {
				if status.State != "failed" || string(b) != "approved old data" || status.RecoveryPath != "" {
					t.Fatalf("%+v data=%s", status, b)
				}
			} else if status.State != "completed" || status.RecoveryPath != "" || status.PartialPath != "" || !strings.Contains(string(b), `"type":"capture"`) {
				t.Fatalf("%+v", status)
			}
			if !fail {
				if entries, _ := os.ReadDir(filepath.Dir(status.Path)); len(entries) != 1 {
					t.Fatalf("recovery or partial kept after replacement: %v", entries)
				}
			}
		})
	}
}

func TestFingerprintDetectsPreservedSizeAndMtimeChanges(t *testing.T) {
	m := NewManager("host")
	defer m.Close()
	path := filepath.Join(testDirectory(t), "capture")
	os.WriteFile(path, []byte("original"), 0600)
	before, _ := os.Stat(path)
	selected, err := m.Prepare(path, "jsonl", true)
	if err != nil {
		t.Fatal(err)
	}
	os.WriteFile(path, []byte("modified"), 0600)
	os.Chtimes(path, before.ModTime(), before.ModTime())
	// Start checks identity only; the content digest at publication catches it.
	s, err := m.Open(Request{Token: selected.Token, Format: "jsonl"})
	if err != nil {
		t.Fatal(err)
	}
	ds := source(t, datasource.TypeSingle, "events")
	if err := s.Subscribe(map[string]datasource.DataSource{"events": ds}, nil, func() {}); err != nil {
		t.Fatal(err)
	}
	p, _ := ds.NewPacketSingle()
	ds.EmitAndRelease(p)
	status := s.Finalize(nil)
	if status.State != "failed" || !strings.Contains(status.Error, "changed since approval") {
		t.Fatalf("content change with restored mtime was replaced: %+v", status)
	}
	if b, _ := os.ReadFile(path); string(b) != "modified" || status.RecoveryPath != "" {
		t.Fatalf("changed file not restored in place: %q %+v", b, status)
	}
	if _, err := os.Stat(status.PartialPath); err != nil {
		t.Fatal("partial lost")
	}
}

func TestNoReplaceRenameNeverClobbersExistingName(t *testing.T) {
	path := testDirectory(t)
	root, err := os.OpenRoot(path)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	root.WriteFile("source", []byte("source"), 0600)
	root.WriteFile("target", []byte("target"), 0600)
	if err := renameNoReplace(root, "source", "target"); err == nil {
		t.Fatal("no-replace rename overwrote target")
	}
	for _, name := range []string{"source", "target"} {
		b, err := root.ReadFile(name)
		if err != nil || string(b) != name {
			t.Fatalf("%s changed: %s %v", name, b, err)
		}
	}
}

func TestRecoveryPublicationRaces(t *testing.T) {
	for _, scenario := range []string{"changed-before-move", "competing-after-move", "restore-conflict", "recovery-name-collision", "unsupported"} {
		t.Run(scenario, func(t *testing.T) {
			s := replacementSink(t)
			s.file.Write([]byte("new capture"))
			s.file.Close()
			// Exercise the publication transaction after writer finalization,
			// injecting a real filesystem change at its native rename seam.
			s.closed = true
			defer s.destination.root.Close()
			calls := 0
			move := func(root *os.Root, from, to string) error {
				calls++
				if calls == 1 {
					switch scenario {
					case "unsupported":
						return errors.New("no-replace primitive unsupported")
					case "changed-before-move", "restore-conflict":
						root.WriteFile(from, []byte("raced-in data"), 0600)
					case "recovery-name-collision":
						root.WriteFile(to, []byte("unrelated recovery name"), 0600)
					}
				}
				err := renameNoReplace(root, from, to)
				if calls == 1 && err == nil && (scenario == "competing-after-move" || scenario == "restore-conflict") {
					root.WriteFile(from, []byte("competing file"), 0600)
				}
				return err
			}
			err := publishOutput(s.destination, s.partial, &s.status, fileOps{move: move, link: (*os.Root).Link})
			if err == nil {
				t.Fatal("publication race accepted")
			}
			final, readErr := os.ReadFile(s.status.Path)
			if readErr != nil {
				t.Fatal(readErr)
			}
			switch scenario {
			case "changed-before-move":
				// Rollback renames the displaced object back; nothing is left
				// at a recovery name.
				if string(final) != "raced-in data" || s.status.RecoveryPath != "" {
					t.Fatalf("changed file not restored: %s %+v", final, s.status)
				}
			case "competing-after-move", "restore-conflict":
				if string(final) != "competing file" || s.status.RecoveryPath == "" {
					t.Fatalf("competitor overwritten: %s %+v", final, s.status)
				}
				old, err := os.ReadFile(s.status.RecoveryPath)
				wantOld := "approved old data"
				if scenario == "restore-conflict" {
					wantOld = "raced-in data"
				}
				if err != nil || string(old) != wantOld {
					t.Fatalf("old data lost: %s %v", old, err)
				}
			default:
				if string(final) != "approved old data" {
					t.Fatalf("failed move disturbed original: %s", final)
				}
			}
			partial, readErr := os.ReadFile(s.status.PartialPath)
			if readErr != nil || string(partial) != "new capture" {
				t.Fatal("partial capture lost")
			}
		})
	}
}

func publishSink(t *testing.T) *Sink {
	t.Helper()
	s := openSink(t, "jsonl")
	s.file.Write([]byte("new capture"))
	s.file.Close()
	s.closed = true
	t.Cleanup(func() { s.destination.root.Close() })
	return s
}

func TestPublicationWithoutHardLinks(t *testing.T) {
	s := publishSink(t)
	noLinks := func(*os.Root, string, string) error { return errors.New("hard links unsupported") }
	if err := publishOutput(s.destination, s.partial, &s.status, fileOps{move: renameNoReplace, link: noLinks}); err != nil {
		t.Fatalf("publication required hard links: %v", err)
	}
	b, err := os.ReadFile(s.status.Path)
	if err != nil || string(b) != "new capture" || s.status.PartialPath != "" {
		t.Fatalf("published %q %v %+v", b, err, s.status)
	}
	entries, _ := os.ReadDir(filepath.Dir(s.status.Path))
	if len(entries) != 1 {
		t.Fatalf("leftover files: %v", entries)
	}
}

func TestPublicationFallsBackToLinkWithoutNoReplaceRename(t *testing.T) {
	for _, existing := range []bool{false, true} {
		t.Run(map[bool]string{false: "free", true: "competing"}[existing], func(t *testing.T) {
			s := publishSink(t)
			unsupported := func(root *os.Root, _, to string) error {
				if existing {
					// A competitor appears after the approval check.
					root.WriteFile(to, []byte("competing file"), 0600)
				}
				return errors.ErrUnsupported
			}
			err := publishOutput(s.destination, s.partial, &s.status, fileOps{move: unsupported, link: (*os.Root).Link})
			b, _ := os.ReadFile(s.status.Path)
			if existing {
				if err == nil || string(b) != "competing file" || s.status.PartialPath == "" {
					t.Fatalf("link fallback clobbered: %q %v %+v", b, err, s.status)
				}
				return
			}
			if err != nil || string(b) != "new capture" || s.status.PartialPath != "" {
				t.Fatalf("link fallback: %q %v %+v", b, err, s.status)
			}
		})
	}
}

func TestPrepareRefusesOverwriteWithoutNoReplaceRename(t *testing.T) {
	m := NewManager("host")
	defer m.Close()
	m.ops.move = func(*os.Root, string, string) error { return errors.ErrUnsupported }
	dir := testDirectory(t)
	path := filepath.Join(dir, "capture.jsonl")
	os.WriteFile(path, []byte("old"), 0600)
	if _, err := m.Prepare(path, "jsonl", true); err == nil || !strings.Contains(err.Error(), "not supported") {
		t.Fatalf("unsupported replacement accepted up front: %v", err)
	}
	if entries, _ := os.ReadDir(dir); len(entries) != 1 {
		t.Fatalf("probe left files: %v", entries)
	}
	// New files can still be published (hard-link fallback).
	if _, err := m.Prepare(filepath.Join(dir, "new.jsonl"), "jsonl", false); err != nil {
		t.Fatal(err)
	}
}
