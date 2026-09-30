// Copyright 2026 The Inspektor Gadget authors
// SPDX-License-Identifier: Apache-2.0

package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/inspektor-gadget/ig-desktop/internal/environment"
	"github.com/inspektor-gadget/inspektor-gadget/pkg/gadgets"
)

func TestImportedKubernetesEnvironmentPersistsSourceAcrossOperations(t *testing.T) {
	var mu sync.Mutex
	var paths []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		paths = append(paths, r.URL.Path)
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		kind, version := "PodList", "v1"
		switch {
		case strings.HasSuffix(r.URL.Path, "/nodes"):
			kind = "NodeList"
		case strings.HasSuffix(r.URL.Path, "/daemonsets"):
			kind, version = "DaemonSetList", "apps/v1"
		case strings.HasSuffix(r.URL.Path, "/deployments"):
			kind, version = "DeploymentList", "apps/v1"
		}
		fmt.Fprintf(w, `{"apiVersion":%q,"kind":%q,"items":[]}`, version, kind)
	}))
	defer server.Close()
	h, tr, _, _, _ := matchedHandler(t, "http://127.0.0.1:1")
	source := handlerSource(t, server.URL)
	importData := map[string]any{"kubeconfig": source, "context": "second"}
	reply := tr.call(t, "importKubernetesEnvironment", importData)
	var env environment.Environment
	if err := json.Unmarshal(reply.Data, &env); err != nil || !reply.Success {
		t.Fatalf("import: %+v %v", reply, err)
	}
	if env.Runtime != "grpc-k8s" || env.Name != "second" || env.Params["context"] != "second" ||
		env.Kubeconfig == nil || *env.Kubeconfig != source {
		t.Fatalf("wrong saved environment: %+v", env)
	}
	mu.Lock()
	count := len(paths)
	mu.Unlock()
	if count != 0 {
		t.Fatal("import contacted the cluster")
	}
	repeated := tr.call(t, "importKubernetesEnvironment", importData)
	var existing environment.Environment
	if err := json.Unmarshal(repeated.Data, &existing); err != nil || !repeated.Success || existing.ID != env.ID {
		t.Fatalf("repeat import duplicated the connection: %+v %v", repeated, err)
	}
	// Reload from persistent storage with a different default kubeconfig/current context.
	h.runtimeFactory = environment.NewRuntimeFactory(h.envStorage)
	runtime, err := h.getRuntime(env.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	if namespace, ok := runtime.GetDefaultValue(gadgets.K8SNamespace); !ok || namespace != "second-ns" {
		t.Fatalf("wrong runtime namespace: %s", namespace)
	}
	reply = tr.call(t, "listInstances", map[string]any{"environmentID": env.ID})
	if reply.Success || !strings.Contains(string(reply.Data), "deploymentMissing") {
		t.Fatalf("expected missing deployment on the imported cluster: %+v", reply)
	}
	reply = tr.call(t, "getK8sNodes", map[string]any{"environmentID": env.ID})
	if !reply.Success || strings.Contains(string(reply.Data), `"error"`) {
		t.Fatalf("completion: %+v", reply)
	}
	mu.Lock()
	for _, path := range paths {
		if !strings.HasPrefix(path, "/second/") {
			t.Errorf("operation used the wrong context: %s", path)
		}
	}
	if len(paths) == 0 {
		t.Error("runtime did not use the synthetic cluster")
	}
	mu.Unlock()
	for _, mode := range []string{"deploy", "redeploy", "undeploy"} {
		req := &DeployIGRequest{EnvironmentID: env.ID, KubeConfig: "/wrong", KubeContext: "first", Namespace: "wrong",
			Redeploy: mode == "redeploy", Undeploy: mode == "undeploy"}
		if err := h.resolveDeploymentEnvironment(req); err != nil || req.KubeConfig != source.Path || req.KubeContext != "second" || req.Namespace != "gadget" {
			t.Fatalf("deployment target: %+v %v", req, err)
		}
	}
	if err := os.Remove(source.Path); err != nil {
		t.Fatal(err)
	}
	if _, err := h.getRuntime(env.ID, ""); err == nil {
		t.Fatal("missing imported source fell back to default kubeconfig")
	}
	if _, err := h.getK8sClientFromEnvironment(env.ID, ""); err == nil {
		t.Fatal("completion fell back to default kubeconfig")
	}
	if err := h.resolveDeploymentEnvironment(&DeployIGRequest{EnvironmentID: env.ID}); err == nil {
		t.Fatal("deployment fell back to default kubeconfig")
	}
}

func TestKubernetesImportRejectsInvalidSourceWithoutPersistence(t *testing.T) {
	h, tr, _, _, _ := matchedHandler(t, "http://127.0.0.1:1")
	before, _ := h.envStorage.List()
	for _, input := range []map[string]any{
		{"kubeconfig": environment.KubeconfigSource{Kind: "default"}, "context": "missing"},
		{"kubeconfig": environment.KubeconfigSource{Kind: "file", Path: "relative"}, "context": "first"},
		{"kubeconfig": environment.KubeconfigSource{Kind: "file", Path: filepath.Join(t.TempDir(), "absent")}, "context": "first"},
	} {
		if reply := tr.call(t, "importKubernetesEnvironment", input); reply.Success {
			t.Fatalf("invalid import accepted: %+v", reply)
		}
	}
	after, _ := h.envStorage.List()
	if len(before) != len(after) {
		t.Fatal("failed import created an environment")
	}
}
