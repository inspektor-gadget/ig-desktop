// Copyright 2026 The Inspektor Gadget authors
// SPDX-License-Identifier: Apache-2.0

package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

func TestSavedKubernetesResolutionIsShared(t *testing.T) {
	h, tr, env, _, _ := matchedHandler(t, "http://127.0.0.1:1")
	// The default source with no saved context follows the current context.
	conn, err := resolveSavedKubernetes(env)
	if err != nil || conn.Context != "first" || conn.Source.Kind != "default" || conn.GadgetNamespace != "gadget" {
		t.Fatalf("saved connection: %+v %v", conn, err)
	}
	// RuntimeFactory ignores the legacy parameter, so every management path
	// must refuse it rather than reach a different cluster.
	env.Params["kubeconfig"] = "/legacy/config"
	if err := h.envStorage.Set(env); err != nil {
		t.Fatal(err)
	}
	if _, err := h.getK8sClientFromEnvironment(env.ID, ""); err == nil || !strings.Contains(err.Error(), "legacy kubeconfig") {
		t.Fatalf("completion used the legacy kubeconfig parameter: %v", err)
	}
	if err := h.resolveDeploymentEnvironment(&DeployIGRequest{EnvironmentID: env.ID}); err == nil || !strings.Contains(err.Error(), "legacy kubeconfig") {
		t.Fatalf("deployment used the legacy kubeconfig parameter: %v", err)
	}
	reply := tr.call(t, "getKubernetesMenuState", map[string]any{"environmentID": env.ID})
	if !reply.Success || !strings.Contains(string(reply.Data), "legacy kubeconfig") {
		t.Fatalf("menu state used the legacy kubeconfig parameter: %s", reply.Data)
	}
}

func TestKubernetesMenuStateReportsDeploymentNamespace(t *testing.T) {
	var mu sync.Mutex
	foundIn := ""
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		kind, version, items := "PodList", "v1", "[]"
		if strings.HasSuffix(r.URL.Path, "/daemonsets") {
			kind, version = "DaemonSetList", "apps/v1"
			// The configured namespace is searched first, then all namespaces.
			if r.URL.Path == "/second/apis/apps/v1/daemonsets" || strings.Contains(r.URL.Path, "/namespaces/"+foundIn+"/") {
				items = fmt.Sprintf(`[{"metadata":{"name":"gadget","namespace":%q}}]`, foundIn)
			}
		} else if strings.HasSuffix(r.URL.Path, "/deployments") {
			kind, version = "DeploymentList", "apps/v1"
		}
		fmt.Fprintf(w, `{"apiVersion":%q,"kind":%q,"items":%s}`, version, kind, items)
	}))
	defer server.Close()
	_, tr, _, _, _ := matchedHandler(t, "http://127.0.0.1:1")
	input := map[string]any{"kubeconfig": handlerSource(t, server.URL), "context": "second"}
	for _, test := range []struct {
		foundIn  string
		mismatch bool
	}{{"gadget", false}, {"other", true}} {
		mu.Lock()
		foundIn = test.foundIn
		mu.Unlock()
		reply := tr.call(t, "getKubernetesMenuState", input)
		var state struct {
			Deployment        string `json:"deployment"`
			Namespace         string `json:"namespace"`
			NamespaceMismatch bool   `json:"namespaceMismatch"`
			Error             string `json:"error"`
		}
		if err := json.Unmarshal(reply.Data, &state); err != nil || !reply.Success || state.Error != "" ||
			state.Deployment != "deployed" || state.Namespace != test.foundIn || state.NamespaceMismatch != test.mismatch {
			t.Fatalf("menu state for IG in %s: %s %v", test.foundIn, reply.Data, err)
		}
	}
}
