// Copyright 2026 The Inspektor Gadget authors
// SPDX-License-Identifier: Apache-2.0

package handlers

import (
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/inspektor-gadget/ig-desktop/internal/environment"
)

func TestFileOutputTargetUsesFrozenSafeDisplayMetadata(t *testing.T) {
	h := transientHandler(t)
	source := handlerSource(t, "https://synthetic.invalid")
	target, err := h.transientKubernetes.Create(source, "second", false)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(source.Path, []byte("changed kubeconfig with synthetic-secret"), 0600); err != nil {
		t.Fatal(err)
	}
	description, err := h.fileOutputTarget(target.ID)
	if err != nil {
		t.Fatal(err)
	}
	data, err := json.Marshal(description)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != `{"name":"second","runtime":"grpc-k8s","context":"second","defaultNamespace":"second-ns","transient":true}` {
		t.Fatalf("unsafe or unfrozen target description: %s", data)
	}
	metadata, err := h.transientKubernetes.Describe(target.ID)
	if err != nil {
		t.Fatal(err)
	}
	metadata.Name = "mutated by caller"
	again, err := h.transientKubernetes.Describe(target.ID)
	if err != nil || again.Name != "second" {
		t.Fatal("display lookup leaked mutable registry state")
	}
	h.transientKubernetes.Release(target.ID)
	if description.Context != "second" {
		t.Fatal("release changed owned provenance")
	}
	if _, err := h.fileOutputTarget(target.ID); err == nil {
		t.Fatal("released target fell back to another environment")
	}
}

func TestFileOutputSavedTargetDoesNotIncludeConnectionOptions(t *testing.T) {
	storage := environment.NewStorage(t.TempDir())
	env := &environment.Environment{ID: uuid.NewString(), Name: "saved target", Runtime: "grpc-k8s", Params: map[string]string{"kubeconfig": "/synthetic-secret/path", "token": "synthetic-secret"}}
	if err := storage.Set(env); err != nil {
		t.Fatal(err)
	}
	h := &Handler{envStorage: storage}
	target, err := h.fileOutputTarget(env.ID)
	if err != nil {
		t.Fatal(err)
	}
	data, err := json.Marshal(target)
	if err != nil {
		t.Fatal(err)
	}
	if target.Name != "saved target" || target.Runtime != "grpc-k8s" || strings.Contains(string(data), "secret") || strings.Contains(string(data), "params") {
		t.Fatalf("unsafe saved target: %s", data)
	}
}
