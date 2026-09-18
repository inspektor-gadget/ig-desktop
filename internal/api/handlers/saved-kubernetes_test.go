// Copyright 2026 The Inspektor Gadget authors
// SPDX-License-Identifier: Apache-2.0

package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/inspektor-gadget/ig-desktop/internal/environment"
	"github.com/inspektor-gadget/ig-desktop/internal/session"
	"github.com/inspektor-gadget/ig-desktop/pkg/api"
	"github.com/inspektor-gadget/ig-desktop/pkg/gadget"
	igapi "github.com/inspektor-gadget/inspektor-gadget/pkg/gadget-service/api"
	"github.com/inspektor-gadget/inspektor-gadget/pkg/gadgets"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/proto"
	"k8s.io/apimachinery/pkg/util/httpstream"
	streamspdy "k8s.io/apimachinery/pkg/util/httpstream/spdy"
	"k8s.io/client-go/tools/portforward"
)

type savedTargetTransport struct {
	testTransport
	messages chan json.RawMessage
}

func (t *savedTargetTransport) Send(value any) error {
	data, err := json.Marshal(value)
	if err == nil {
		t.messages <- data
	}
	return err
}

func (tr *savedTargetTransport) call(t *testing.T, command string, data any) *api.Event {
	t.Helper()
	tr.handler(string(requestData(t, map[string]any{"cmd": command, "reqID": command, "data": data})))
	for {
		select {
		case raw := <-tr.messages:
			var reply api.Event
			if err := json.Unmarshal(raw, &reply); err != nil {
				t.Fatal(err)
			}
			if reply.RequestID == command {
				return &reply
			}
		case <-time.After(5 * time.Second):
			t.Fatalf("no reply to %s", command)
		}
	}
}

func matchedHandler(t *testing.T, host string) (*Handler, *savedTargetTransport, *environment.Environment, environment.KubeconfigSource, *environment.KubernetesTarget) {
	t.Helper()
	h := transientHandler(t)
	source := handlerSource(t, host)
	t.Setenv("KUBECONFIG", source.Path)
	h.envStorage = environment.NewStorage(t.TempDir())
	env := &environment.Environment{ID: uuid.NewString(), Name: "Saved first", Runtime: "grpc-k8s", Params: map[string]string{"context": "first"}}
	if err := h.envStorage.Set(env); err != nil {
		t.Fatal(err)
	}
	h.runtimeFactory = environment.NewRuntimeFactory(h.envStorage)
	h.instanceManager = gadget.NewInstanceManager()
	h.gadgetService = gadget.NewService(h.instanceManager)
	tr := &savedTargetTransport{messages: make(chan json.RawMessage, 100)}
	if err := h.Register(tr); err != nil {
		t.Fatal(err)
	}
	reply := tr.call(t, "createKubernetesTarget", map[string]any{
		"kubeconfig": source, "context": "first", "requireCurrentContext": true, "matchSavedEnvironments": true,
	})
	var target environment.KubernetesTarget
	if err := json.Unmarshal(reply.Data, &target); err != nil || !reply.Success || len(target.SavedEnvironments) != 1 || target.SavedEnvironments[0].ID != env.ID {
		t.Fatalf("matching protocol: %+v %v", reply, err)
	}
	t.Cleanup(func() {
		h.instanceManager.StopAll()
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := h.instanceManager.Wait(ctx); err != nil {
			t.Error(err)
		}
	})
	return h, tr, env, source, &target
}

func TestSavedKubernetesProtocolFreezesAllRuntimeOperations(t *testing.T) {
	paths := make(chan string, 100)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		paths <- req.URL.Path
		w.Header().Set("Content-Type", "application/json")
		// Runtime operations fail locally at empty gadget discovery, proving which
		// Kubernetes connection they used without any real cluster or port forward.
		switch {
		case strings.HasSuffix(req.URL.Path, "/nodes"):
			fmt.Fprint(w, `{"apiVersion":"v1","kind":"NodeList","items":[{"metadata":{"name":"node"}}]}`)
		case strings.HasSuffix(req.URL.Path, "/namespaces"):
			fmt.Fprint(w, `{"apiVersion":"v1","kind":"NamespaceList","items":[{"metadata":{"name":"first-ns"}}]}`)
		case strings.HasSuffix(req.URL.Path, "/pods/pod"):
			fmt.Fprint(w, `{"apiVersion":"v1","kind":"Pod","spec":{"containers":[{"name":"container"}]}}`)
		default:
			fmt.Fprint(w, `{"apiVersion":"v1","kind":"PodList","items":[]}`)
		}
	}))
	defer server.Close()
	h, tr, env, source, target := matchedHandler(t, server.URL)
	config, err := os.ReadFile(source.Path)
	if err != nil {
		t.Fatal(err)
	}
	config = []byte(strings.ReplaceAll(string(config), server.URL+"/first", server.URL+"/mutated"))
	if err := os.WriteFile(source.Path, config, 0600); err != nil {
		t.Fatal(err)
	}
	runtime, err := h.getRuntime(env.ID, target.ID)
	if err != nil {
		t.Fatal(err)
	}
	if namespace, _ := runtime.GetDefaultValue(gadgets.K8SNamespace); namespace != "first-ns" {
		t.Fatalf("saved runtime lost frozen namespace: %q", namespace)
	}
	provenance, err := h.fileOutputTarget(env.ID, target.ID)
	if err != nil || provenance.Name != env.Name || provenance.Context != "first" || provenance.Transient || provenance.DefaultNamespace != "first-ns" {
		t.Fatalf("saved file provenance: %+v %v", provenance, err)
	}
	request := map[string]any{
		"environmentID": env.ID, "kubernetesTargetID": target.ID, "image": "synthetic/gadget", "url": "synthetic/gadget",
		"id": "0123456789abcdef0123456789abcdef", "pod": "pod", "namespace": "first-ns",
	}
	assertPaths := func(prefix string) {
		t.Helper()
		if len(paths) == 0 {
			t.Fatal("operation did not use Kubernetes")
		}
		for len(paths) > 0 {
			if path := <-paths; !strings.HasPrefix(path, prefix) {
				t.Fatalf("operation retargeted: %s (expected %s)", path, prefix)
			}
		}
	}
	for _, command := range []string{
		"getGadgetInfo", "listInstances", "removeInstance",
		"getK8sNodes", "getK8sNamespaces", "getK8sPods", "getK8sContainers", "getK8sLabels",
	} {
		reply := tr.call(t, command, request)
		if strings.HasPrefix(command, "getK8s") && !reply.Success {
			t.Fatalf("%s: %+v", command, reply)
		}
		assertPaths("/first/")
	}
	for _, command := range []string{"runGadget", "attachInstance"} {
		// Read both ACK and terminal even if the runtime fails before the ACK.
		tr.handler(string(requestData(t, map[string]any{"cmd": command, "reqID": command, "data": request})))
		ack, terminal := false, false
		for !ack || !terminal {
			select {
			case raw := <-tr.messages:
				var ev struct {
					Type          int    `json:"type"`
					RequestID     string `json:"reqID"`
					EnvironmentID string `json:"environmentID"`
					Success       bool   `json:"success"`
					Data          struct {
						EnvironmentID      string `json:"environmentID"`
						KubernetesTargetID string `json:"kubernetesTargetID"`
					} `json:"data"`
				}
				// Logs carry a string, not object data.
				if json.Unmarshal(raw, &ev) != nil {
					continue
				}
				if ev.RequestID == command {
					ack = true
					if !ev.Success || ev.Data.EnvironmentID != env.ID || ev.Data.KubernetesTargetID != target.ID {
						t.Fatalf("saved identity lost in ACK: %s", raw)
					}
				}
				if ev.Type == api.TypeGadgetStop {
					terminal = true
					if ev.EnvironmentID != env.ID {
						t.Fatalf("saved identity lost in stream: %s", raw)
					}
				}
			case <-time.After(5 * time.Second):
				t.Fatalf("missing ACK/terminal for %s", command)
			}
		}
		assertPaths("/first/")
	}
	// An unrelated saved operation without the handle retains normal behavior.
	reply := tr.call(t, "getGadgetInfo", map[string]string{"environmentID": env.ID, "url": "synthetic/gadget"})
	if reply.Success {
		t.Fatal("unexpected success from empty gadget discovery")
	}
	assertPaths("/mutated/")
}

func TestSavedKubernetesProtocolRejectsInvalidPairsAndManagement(t *testing.T) {
	h, tr, env, _, target := matchedHandler(t, "https://unused.invalid")
	for _, command := range []string{
		"runGadget", "getGadgetInfo", "attachInstance", "listInstances", "removeInstance",
		"getK8sNodes", "getK8sNamespaces", "getK8sPods", "getK8sContainers", "getK8sLabels",
	} {
		reply := tr.call(t, command, map[string]string{"environmentID": uuid.NewString(), "kubernetesTargetID": target.ID})
		errorText := reply.Error
		if strings.HasPrefix(command, "getK8s") {
			var resources K8sResourceResponse
			if err := json.Unmarshal(reply.Data, &resources); err != nil {
				t.Fatal(err)
			}
			errorText = resources.Error
		}
		if !strings.Contains(errorText, "does not match") {
			t.Fatalf("%s ignored invalid pair: %+v", command, reply)
		}
	}
	for _, command := range []string{"checkIGDeployment", "deployIG", "getChartValues", "createEnvironment", "deleteEnvironment"} {
		for _, undeploy := range []bool{false, true} {
			reply := tr.call(t, command, map[string]any{"environmentID": env.ID, "kubernetesTargetID": target.ID, "undeploy": undeploy})
			if reply.Success || !strings.Contains(reply.Error, "unsupported") {
				t.Fatalf("%s ignored frozen handle: %+v", command, reply)
			}
		}
	}
	if _, err := h.transientKubernetes.Release(target.ID); err != nil {
		t.Fatal(err)
	}
	reply := tr.call(t, "getGadgetInfo", map[string]string{"environmentID": env.ID, "kubernetesTargetID": target.ID})
	if reply.Success || !strings.Contains(reply.Error, "unknown or expired") {
		t.Fatalf("released handle fell back: %+v", reply)
	}
	defaultHandler := New(context.Background(), h.envStorage, h.runtimeFactory, nil, nil, nil, nil, nil, "")
	if _, err := defaultHandler.getRuntime(env.ID, target.ID); err == nil || !strings.Contains(err.Error(), "disabled") {
		t.Fatalf("non-opt-in host accepted saved-target binding: %v", err)
	}
}

type savedRecordingServer struct {
	igapi.UnimplementedGadgetManagerServer
}

func (*savedRecordingServer) RunGadget(stream igapi.GadgetManager_RunGadgetServer) error {
	if _, err := stream.Recv(); err != nil {
		return err
	}
	info, err := proto.Marshal(&igapi.GadgetInfo{ImageName: "synthetic/gadget"})
	if err != nil {
		return err
	}
	return stream.Send(&igapi.GadgetEvent{Type: igapi.EventTypeGadgetInfo, Payload: info})
}

func TestSavedKubernetesRecordingThroughFrozenRuntime(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	grpcServer := grpc.NewServer()
	igapi.RegisterGadgetManagerServer(grpcServer, &savedRecordingServer{})
	go grpcServer.Serve(listener)
	defer grpcServer.Stop()
	// Synthetic Kubernetes port-forward endpoint tunnels real gRPC streams.
	// This exercises the actual handler/runtime/recording path, not a run mock.
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/portforward") {
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprint(w, `{"apiVersion":"v1","kind":"PodList","items":[{"metadata":{"name":"gadget"},"spec":{"nodeName":"synthetic-node"}}]}`)
			return
		}
		if _, err := httpstream.Handshake(r, w, []string{portforward.PortForwardProtocolV1Name}); err != nil {
			t.Error(err)
			return
		}
		conn := streamspdy.NewResponseUpgrader().UpgradeResponse(w, r, func(stream httpstream.Stream, replySent <-chan struct{}) error {
			go func() {
				<-replySent
				defer stream.Close()
				if stream.Headers().Get("streamType") != "data" {
					return
				}
				remote, err := net.Dial("tcp", listener.Addr().String())
				if err != nil {
					t.Error(err)
					return
				}
				defer remote.Close()
				done := make(chan struct{})
				go func() {
					io.Copy(remote, stream)
					remote.Close()
					close(done)
				}()
				io.Copy(stream, remote)
				stream.Close()
				<-done
			}()
			return nil
		})
		if conn != nil {
			<-conn.CloseChan()
		}
	}))
	defer server.Close()
	h, tr, env, source, target := matchedHandler(t, server.URL)
	sessions, err := session.NewService(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer sessions.Close()
	h.sessionService = sessions
	h.gadgetService.SetSessionRecorder(sessions)
	if err := os.WriteFile(source.Path, []byte("invalid after preparation"), 0600); err != nil {
		t.Fatal(err)
	}
	tr.handler(string(requestData(t, map[string]any{"cmd": "runGadget", "reqID": "record", "data": map[string]any{
		"environmentID": env.ID, "kubernetesTargetID": target.ID, "image": "synthetic/gadget", "record": true,
	}})))
	ack, terminal, sessionID := false, false, ""
	for !ack || !terminal {
		select {
		case raw := <-tr.messages:
			var message struct {
				Type          int              `json:"type"`
				RequestID     string           `json:"reqID"`
				EnvironmentID string           `json:"environmentID"`
				SessionInfo   *api.SessionInfo `json:"sessionInfo"`
				Success       bool             `json:"success"`
				Data          json.RawMessage  `json:"data"`
			}
			if err := json.Unmarshal(raw, &message); err != nil {
				t.Fatal(err)
			}
			if message.RequestID == "record" {
				ack = true
				var result struct {
					EnvironmentID      string `json:"environmentID"`
					KubernetesTargetID string `json:"kubernetesTargetID"`
					Record             bool   `json:"record"`
				}
				if json.Unmarshal(message.Data, &result) != nil || !message.Success || !result.Record || result.EnvironmentID != env.ID || result.KubernetesTargetID != target.ID {
					t.Fatalf("recording identity lost: %s", raw)
				}
			}
			if message.Type == api.TypeGadgetInfo {
				if message.EnvironmentID != env.ID || message.SessionInfo == nil {
					t.Fatalf("recording metadata missing saved identity: %s", raw)
				}
				sessionID = message.SessionInfo.SessionID
			}
			if message.Type == api.TypeGadgetStop {
				terminal = true
				var result struct {
					Error string `json:"error"`
				}
				if json.Unmarshal(message.Data, &result) != nil || result.Error != "" || message.EnvironmentID != env.ID {
					t.Fatalf("recording failed: %s", raw)
				}
			}
		case <-time.After(10 * time.Second):
			t.Fatal("recording did not complete")
		}
	}
	if sessionID == "" {
		t.Fatal("no recorded session")
	}
	recording, err := sessions.GetSession(sessionID)
	if err != nil || recording.EnvironmentID != env.ID || len(recording.Runs) != 1 {
		t.Fatalf("recording did not persist saved identity: %+v %v", recording, err)
	}
}
