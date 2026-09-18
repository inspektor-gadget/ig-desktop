// Copyright 2026 The Inspektor Gadget authors
// SPDX-License-Identifier: Apache-2.0

package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestListInstancesDeploymentMissing(t *testing.T) {
	for _, scenario := range []string{
		"missing", "pod forbidden", "daemonset forbidden", "deployment forbidden",
		"unauthorized", "unreachable", "pending daemonset", "scaled zero deployment",
		"other namespace", "alternative label pod",
	} {
		t.Run(scenario, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				resource := r.URL.Path[strings.LastIndex(r.URL.Path, "/")+1:]
				code := 0
				if scenario == "unauthorized" {
					code = 401
				}
				if scenario == "unreachable" {
					code = 503
				}
				if (scenario == "pod forbidden" && resource == "pods") ||
					(scenario == "daemonset forbidden" && resource == "daemonsets") ||
					(scenario == "deployment forbidden" && resource == "deployments") {
					code = 403
				}
				if code != 0 {
					w.WriteHeader(code)
					fmt.Fprintf(w, `{"kind":"Status","apiVersion":"v1","status":"Failure","reason":"Forbidden","message":"fixture denied","code":%d}`, code)
					return
				}
				kind, version := "PodList", "v1"
				if resource == "daemonsets" {
					kind, version = "DaemonSetList", "apps/v1"
				}
				if resource == "deployments" {
					kind, version = "DeploymentList", "apps/v1"
				}
				items := "[]"
				if (scenario == "pending daemonset" && resource == "daemonsets") ||
					(scenario == "scaled zero deployment" && resource == "deployments") ||
					(scenario == "other namespace" && resource == "daemonsets" && !strings.Contains(r.URL.Path, "/namespaces/")) ||
					(scenario == "alternative label pod" && resource == "pods" && r.URL.Query().Get("labelSelector") == "app.kubernetes.io/name=gadget") {
					items = `[{"metadata":{"name":"gadget","namespace":"other"},"spec":{},"status":{}}]`
				}
				fmt.Fprintf(w, `{"kind":%q,"apiVersion":%q,"items":%s}`, kind, version, items)
			}))
			defer server.Close()
			_, tr, env, _, _ := matchedHandler(t, server.URL)
			reply := tr.call(t, "listInstances", map[string]any{"environmentID": env.ID})
			if reply.Success {
				t.Fatalf("unconnected fixture succeeded: %+v", reply)
			}
			var data struct {
				DeploymentMissing bool `json:"deploymentMissing"`
			}
			if len(reply.Data) > 0 {
				if err := json.Unmarshal(reply.Data, &data); err != nil {
					t.Fatal(err)
				}
			}
			if data.DeploymentMissing != (scenario == "missing") {
				t.Fatalf("incorrect absence signal: %+v", reply)
			}
			// The same discovery used by Create Environment must not turn errors
			// or unready installations into an offer to deploy.
			reply = tr.call(t, "checkIGDeployment", map[string]any{"kubeContext": "first", "namespace": "gadget"})
			var status struct {
				Missing, Deployed bool
				Error             string
			}
			if err := json.Unmarshal(reply.Data, &status); err != nil {
				t.Fatal(err)
			}
			if status.Missing != (scenario == "missing") {
				t.Fatalf("incorrect check status: %+v", status)
			}
			installed := scenario == "pending daemonset" || scenario == "scaled zero deployment" ||
				scenario == "other namespace" || scenario == "alternative label pod"
			if status.Deployed != installed || (status.Error != "") != (!installed && scenario != "missing") {
				t.Fatalf("discovery must distinguish installed, missing and failed: %+v", status)
			}
		})
	}
}

func TestSavedDeploymentUsesEnvironmentConnection(t *testing.T) {
	h, tr, env, _, _ := matchedHandler(t, "https://unused.invalid")
	for _, context := range []string{"second", ""} {
		env.Params = map[string]string{"context": context, "gadget-namespace": "custom-gadget"}
		if err := h.envStorage.Set(env); err != nil {
			t.Fatal(err)
		}
		req := &DeployIGRequest{EnvironmentID: env.ID, KubeContext: "untrusted", KubeConfig: "/untrusted/config", Namespace: "untrusted"}
		if err := h.resolveDeploymentEnvironment(req); err != nil {
			t.Fatal(err)
		}
		expectedContext := context
		if expectedContext == "" {
			expectedContext = "first"
		}
		if req.KubeContext != expectedContext || req.KubeConfig != "" || req.Namespace != "custom-gadget" {
			t.Fatalf("saved connection was overridden: %+v", req)
		}
	}
	env.Params["context"] = "deleted"
	if err := h.envStorage.Set(env); err != nil {
		t.Fatal(err)
	}
	reply := tr.call(t, "deployIG", map[string]string{"environmentID": env.ID, "namespace": "gadget", "releaseName": "gadget"})
	if reply.Success || !strings.Contains(reply.Error, "context does not exist") {
		t.Fatalf("deleted context silently fell back: %+v", reply)
	}
	env.Runtime = "grpc-ig"
	if err := h.envStorage.Set(env); err != nil {
		t.Fatal(err)
	}
	reply = tr.call(t, "deployIG", map[string]string{"environmentID": env.ID, "namespace": "gadget", "releaseName": "gadget"})
	if reply.Success || !strings.Contains(reply.Error, "requires a Kubernetes environment") {
		t.Fatalf("non-Kubernetes environment accepted deployment: %+v", reply)
	}
	legacy := &DeployIGRequest{KubeContext: "explicit", KubeConfig: "/explicit/config", Namespace: "explicit"}
	if err := h.resolveDeploymentEnvironment(legacy); err != nil || legacy.KubeContext != "explicit" || legacy.KubeConfig != "/explicit/config" || legacy.Namespace != "explicit" {
		t.Fatalf("Create Environment defaults changed: %+v %v", legacy, err)
	}
}
