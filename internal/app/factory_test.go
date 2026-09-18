// Copyright 2026 The Inspektor Gadget authors
// SPDX-License-Identifier: Apache-2.0

package app

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/uuid"
	"github.com/inspektor-gadget/ig-desktop/internal/environment"
)

func TestIsolatedServicesAndRecording(t *testing.T) {
	root, err := filepath.Abs(".test-data-" + uuid.NewString())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(root) })
	t.Setenv("HOME", filepath.Join(root, "unused-home"))
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	services, err := NewServicesWithDataDir(ctx, root)
	if err != nil {
		t.Fatal(err)
	}
	if services.SessionService == nil {
		t.Fatalf("SQLite sessions unavailable: %s", services.SessionError)
	}
	defer services.SessionService.Close()
	if services.PluginService.PluginsDir() != filepath.Join(root, "plugins") {
		t.Fatal("plugins escaped data root")
	}
	env := &environment.Environment{Name: "isolated", Runtime: "grpc-ig", Params: map[string]string{}}
	if err := services.EnvStorage.Add(env); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "env", env.ID+".json")); err != nil {
		t.Fatal(err)
	}
	sessionID, err := services.SessionService.CreateSession("test", env.ID)
	if err != nil {
		t.Fatal(err)
	}
	runID, err := services.SessionService.StartGadgetRun("local", sessionID, "example/image", nil, []byte(`{"name":"schema"}`))
	if err != nil {
		t.Fatal(err)
	}
	for range 3 {
		if err := services.SessionService.WriteEvent("local", 3, "events", []byte(`{"value":42}`)); err != nil {
			t.Fatal(err)
		}
	}
	if err := services.SessionService.StopGadgetRun("local"); err != nil {
		t.Fatal(err)
	}
	first, err := services.SessionService.GetRunEventsPage(sessionID, runID, 0, 2)
	if err != nil || len(first) != 2 {
		t.Fatalf("first page: %v %v", first, err)
	}
	last, err := services.SessionService.GetRunEventsPage(sessionID, runID, first[1].ID, 2)
	if err != nil || len(last) != 1 || last[0].ID <= first[1].ID {
		t.Fatalf("last page: %v %v", last, err)
	}
	legacy, err := services.SessionService.GetRunEvents(sessionID, runID)
	if err != nil || len(legacy) != 3 {
		t.Fatalf("legacy replay: %v %v", legacy, err)
	}
	if _, err := os.Stat(filepath.Join(root, "unused-home")); !os.IsNotExist(err) {
		t.Fatalf("touched Desktop home: %v", err)
	}
}

func TestServiceRootValidationAndUnavailableSessions(t *testing.T) {
	if _, err := NewServicesWithDataDir(context.Background(), "relative"); err == nil {
		t.Fatal("relative data root accepted")
	}
	root, err := filepath.Abs(".test-data-" + uuid.NewString())
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(root) })
	if err := os.WriteFile(filepath.Join(root, "sessions"), []byte("not a directory"), 0o600); err != nil {
		t.Fatal(err)
	}
	services, err := NewServicesWithDataDir(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if services.SessionService != nil || services.SessionError == "" {
		t.Fatal("missing session support must be explicit")
	}
}
