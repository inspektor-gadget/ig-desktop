// Copyright 2026 The Inspektor Gadget authors
// SPDX-License-Identifier: Apache-2.0

package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/inspektor-gadget/ig-desktop/internal/environment"
	"github.com/inspektor-gadget/ig-desktop/pkg/api"
	"github.com/inspektor-gadget/ig-desktop/pkg/gadget"
	"github.com/inspektor-gadget/inspektor-gadget/pkg/gadgets"
)

func transientHandler(t *testing.T) *Handler {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	manager := gadget.NewInstanceManager()
	h := New(ctx, nil, nil, gadget.NewService(manager), manager, nil, nil, nil, "")
	h.EnableTransientKubernetes()
	return h
}

func requestData(t *testing.T, data any) json.RawMessage {
	t.Helper()
	result, err := json.Marshal(data)
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func handlerSource(t *testing.T, host string) environment.KubeconfigSource {
	t.Helper()
	path := filepath.Join(t.TempDir(), "config")
	config := fmt.Sprintf(`apiVersion: v1
kind: Config
current-context: first
clusters:
- name: first
  cluster:
    server: %s/first
- name: second
  cluster:
    server: %s/second
contexts:
- name: first
  context:
    cluster: first
    namespace: first-ns
- name: second
  context:
    cluster: second
    namespace: second-ns
`, host, host)
	if err := os.WriteFile(path, []byte(config), 0o600); err != nil {
		t.Fatal(err)
	}
	return environment.KubeconfigSource{Kind: "file", Path: path}
}

func TestTransientHandlersOptInAndProtocol(t *testing.T) {
	defaultHandler := New(context.Background(), nil, nil, nil, nil, nil, nil, nil, "")
	commands := []string{"getKubernetesContexts", "createKubernetesTarget", "touchKubernetesTarget", "releaseKubernetesTarget"}
	for _, handler := range defaultHandler.Handlers() {
		for _, command := range commands {
			if handler.Command() == command {
				t.Fatalf("Desktop exposes %s", command)
			}
		}
	}
	transport := &testTransport{}
	for _, command := range commands {
		transport.lines = append(transport.lines, fmt.Sprintf(`{"cmd":%q,"data":{}}`, command))
	}
	if err := defaultHandler.Register(transport); err != nil {
		t.Fatal(err)
	}
	for _, reply := range transport.replies {
		if reply.Success || !strings.Contains(reply.Error, "unknown command") {
			t.Fatalf("Desktop accepted transient command: %+v", reply)
		}
	}
	h := transientHandler(t)
	trans := &testTransport{}
	if err := h.Register(trans); err != nil {
		t.Fatal(err)
	}
	source := handlerSource(t, "http://unused.invalid")
	call := func(command string, data any) *api.Event {
		t.Helper()
		trans.handler(string(requestData(t, map[string]any{"cmd": command, "reqID": command, "data": data})))
		reply := trans.replies[len(trans.replies)-1]
		if reply.RequestID != command || !reply.Success {
			t.Fatalf("command %s: %+v", command, reply)
		}
		return reply
	}
	list := call(commands[0], map[string]any{"kubeconfig": source})
	var contexts environment.KubernetesContexts
	if err := json.Unmarshal(list.Data, &contexts); err != nil || contexts.CurrentContext != "first" || len(contexts.Contexts) != 2 {
		t.Fatalf("context protocol: %s %v", list.Data, err)
	}
	create := call(commands[1], map[string]any{"kubeconfig": source, "context": "second"})
	var target environment.KubernetesTarget
	if err := json.Unmarshal(create.Data, &target); err != nil || target.Name != "second" ||
		target.Namespace != "second-ns" || target.Runtime != "grpc-k8s" || !environment.IsTransientID(target.ID) {
		t.Fatalf("target protocol: %s %v", create.Data, err)
	}
	runtime, err := h.getRuntime(target.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	if value, ok := runtime.GetDefaultValue(gadgets.K8SNamespace); !ok || value != "second-ns" {
		t.Fatalf("runtime namespace default: %q %t", value, ok)
	}
	touch := call(commands[2], map[string]any{"id": target.ID})
	var lease struct {
		ExpiresAt int64 `json:"expiresAt"`
	}
	if err := json.Unmarshal(touch.Data, &lease); err != nil || lease.ExpiresAt < target.ExpiresAt {
		t.Fatalf("touch protocol: %s %v", touch.Data, err)
	}
	for i := range 2 {
		release := call(commands[3], map[string]any{"id": target.ID})
		var result struct {
			Released bool `json:"released"`
		}
		if err := json.Unmarshal(release.Data, &result); err != nil || result.Released != (i == 0) {
			t.Fatalf("release protocol: %s %v", release.Data, err)
		}
	}
	if _, err := h.getRuntime(target.ID, ""); err == nil {
		t.Fatal("released runtime accepted")
	}
	if value, _ := runtime.GetDefaultValue(gadgets.K8SNamespace); value != "second-ns" {
		t.Fatal("release changed the owned runtime")
	}
	files, err := os.ReadDir(filepath.Dir(source.Path))
	if err != nil || len(files) != 1 {
		t.Fatalf("protocol persisted files: %v %v", files, err)
	}
}

func TestTransientRejectsUnsupportedOperationsBeforeExecution(t *testing.T) {
	h := transientHandler(t)
	var reply *api.Event
	h.send = func(value any) { reply = value.(*api.Event) }
	id := "adhoc-" + uuid.NewString()
	for _, field := range []map[string]any{
		{"detached": true}, {"record": true},
		{"sessionId": "session"}, {"sessionName": "name"},
		{"SessionID": "case-insensitive"}, {"DETACHED": true}, {"Record": true},
	} {
		field["environmentID"] = id
		h.HandleRunGadget(&api.Event{Data: requestData(t, field)})
		if reply == nil || reply.Success || !strings.Contains(reply.Error, "unsupported") {
			t.Fatalf("unsupported run was not rejected before lookup/execution: %+v", reply)
		}
	}
	for _, field := range []map[string]any{
		{"record": false}, {"record": nil}, {"sessionId": ""}, {"sessionName": ""},
		{"detached": false, "params": map[string]string{}, "durationSeconds": 10},
		{"sessionId": nil, "sessionName": nil},
		{"Record": false, "SessionID": "", "SessionName": ""},
	} {
		field["environmentID"] = id
		h.HandleRunGadget(&api.Event{Data: requestData(t, field)})
		if reply.Success || !strings.Contains(reply.Error, "unknown or expired") {
			t.Fatalf("absent optional field rejected before target lookup: %+v", reply)
		}
	}
	for _, handler := range []func(*api.Event){
		h.HandleAttachInstance, h.HandleRemoveInstance, h.HandleListInstances,
		h.HandleCreateEnvironment, h.HandleDeleteEnvironment,
		h.HandleCheckIGDeployment, h.HandleDeployIG, h.HandleGetChartValues,
	} {
		for _, field := range []string{"id", "environmentID"} {
			reply = nil
			handler(&api.Event{Data: requestData(t, map[string]string{field: id})})
			if reply == nil || reply.Success || !strings.Contains(reply.Error, "unsupported") {
				t.Fatalf("management request was not rejected: %+v", reply)
			}
		}
		handler(&api.Event{Data: requestData(t, map[string]any{"id": 123, "environmentID": id})})
		if reply.Success || !strings.Contains(reply.Error, "unsupported") {
			t.Fatalf("unrelated malformed field bypassed transient guard: %+v", reply)
		}
	}
}

func TestTransientProtocolRequiresCurrentContext(t *testing.T) {
	h := transientHandler(t)
	source := handlerSource(t, "http://unused.invalid")
	var reply *api.Event
	h.send = func(value any) { reply = value.(*api.Event) }
	for _, name := range []string{"second", "first"} {
		h.HandleCreateKubernetesTarget(&api.Event{Data: requestData(t, map[string]any{
			"kubeconfig": source, "context": name, "requireCurrentContext": true,
		})})
		if name == "second" {
			if reply.Success || !strings.Contains(reply.Error, "context changed") {
				t.Fatalf("inactive target accepted: %+v", reply)
			}
		} else {
			var target environment.KubernetesTarget
			if !reply.Success || json.Unmarshal(reply.Data, &target) != nil || target.Name != "first" {
				t.Fatalf("active target rejected: %+v", reply)
			}
		}
	}
}

func TestTransientUnknownHandlesNeverFallBack(t *testing.T) {
	h := transientHandler(t)
	var reply *api.Event
	h.send = func(value any) { reply = value.(*api.Event) }
	for _, id := range []string{"adhoc-" + uuid.NewString(), "adhoc-malformed"} {
		for _, handler := range []func(*api.Event){h.HandleRunGadget, h.HandleGetGadgetInfo} {
			handler(&api.Event{Data: requestData(t, map[string]string{"environmentID": id})})
			if reply.Success || !strings.Contains(reply.Error, "transient") {
				t.Fatalf("unknown runtime accepted: %+v", reply)
			}
		}
		for _, handler := range []func(*api.Event){
			h.HandleGetK8sNodes, h.HandleGetK8sNamespaces, h.HandleGetK8sPods,
			h.HandleGetK8sContainers, h.HandleGetK8sLabels,
		} {
			handler(&api.Event{Data: requestData(t, map[string]string{"environmentID": id})})
			var result K8sResourceResponse
			if err := json.Unmarshal(reply.Data, &result); err != nil || !strings.Contains(result.Error, "transient") {
				t.Fatalf("unknown resource target accepted: %+v %v", reply, err)
			}
		}
	}
}

func TestTransientResourceDiscoveryUsesFrozenConfig(t *testing.T) {
	var requested []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		requested = append(requested, req.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		switch {
		case strings.HasSuffix(req.URL.Path, "/nodes"):
			fmt.Fprint(w, `{"apiVersion":"v1","kind":"NodeList","items":[{"metadata":{"name":"node"}}]}`)
		case strings.HasSuffix(req.URL.Path, "/namespaces"):
			fmt.Fprint(w, `{"apiVersion":"v1","kind":"NamespaceList","items":[{"metadata":{"name":"second-ns"}}]}`)
		case strings.HasSuffix(req.URL.Path, "/pods/pod"):
			fmt.Fprint(w, `{"apiVersion":"v1","kind":"Pod","metadata":{"name":"pod"},"spec":{"containers":[{"name":"container"}]}}`)
		default:
			fmt.Fprint(w, `{"apiVersion":"v1","kind":"PodList","items":[{"metadata":{"name":"pod","namespace":"second-ns","labels":{"app":"test"}}}]}`)
		}
	}))
	defer server.Close()
	h := transientHandler(t)
	source := handlerSource(t, server.URL)
	first, err := h.transientKubernetes.Create(source, "first", true)
	if err != nil {
		t.Fatal(err)
	}
	second, err := h.transientKubernetes.Create(source, "second", false)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(source.Path, []byte("invalid after registration"), 0o600); err != nil {
		t.Fatal(err)
	}
	var reply *api.Event
	h.send = func(value any) { reply = value.(*api.Event) }
	for _, target := range []*environment.KubernetesTarget{first, second} {
		for _, handler := range []func(*api.Event){
			h.HandleGetK8sNodes, h.HandleGetK8sNamespaces, h.HandleGetK8sPods,
			h.HandleGetK8sContainers, h.HandleGetK8sLabels,
		} {
			handler(&api.Event{Data: requestData(t, K8sResourceRequest{
				EnvironmentID: target.ID, Namespace: target.Namespace, Pod: "pod",
			})})
			var result K8sResourceResponse
			if err := json.Unmarshal(reply.Data, &result); err != nil || result.Error != "" || len(result.Items) == 0 {
				t.Fatalf("discovery failed: %+v %v", reply, err)
			}
			if path := requested[len(requested)-1]; !strings.HasPrefix(path, "/"+target.Name+"/") {
				t.Fatalf("wrong selected context: %s", path)
			}
		}
	}
	if len(requested) != 10 {
		t.Fatalf("unexpected requests: %v", requested)
	}
}
