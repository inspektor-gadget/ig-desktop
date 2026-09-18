// Copyright 2026 The Inspektor Gadget authors
// SPDX-License-Identifier: Apache-2.0

package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/inspektor-gadget/ig-desktop/pkg/helm"
)

func TestDeploymentErrorConflictPayload(t *testing.T) {
	conflict := helm.ResourceConflict{ResourceIdentity: helm.ResourceIdentity{
		APIVersion: "v1", Kind: "ConfigMap", Namespace: "gadget", Name: "gadget",
		UID: "fixture-uid", ResourceVersion: "17",
	}, BlockedReason: "Resource has Kubernetes owner references"}
	err := fmt.Errorf("install failed: %w", &helm.OwnershipConflictError{
		Err: errors.New("ownership validation failed"), Conflicts: []helm.ResourceConflict{conflict},
	})
	for _, data := range []map[string]interface{}{
		{"deploymentId": "fixture", "step": "install_chart", "progress": 70, "message": "Failed to install chart"},
		{"deploymentId": "fixture", "progress": 0},
	} {
		// Both progress and terminal type-202 paths use this same wire decorator.
		setDeploymentError(data, err)
		encoded, marshalErr := json.Marshal(data)
		if marshalErr != nil {
			t.Fatal(marshalErr)
		}
		var decoded struct {
			OwnershipConflict bool                    `json:"ownershipConflict"`
			ResourceConflicts []helm.ResourceConflict `json:"resourceConflicts"`
		}
		if err := json.Unmarshal(encoded, &decoded); err != nil {
			t.Fatal(err)
		}
		if !decoded.OwnershipConflict || len(decoded.ResourceConflicts) != 1 || decoded.ResourceConflicts[0] != conflict {
			t.Fatalf("conflict metadata lost in type-202 payload: %s", encoded)
		}
	}
}

func TestDeploymentErrorWithoutInspectionDoesNotInventResources(t *testing.T) {
	for _, test := range []struct {
		err    error
		manual bool
	}{
		// Helm's text matched, but inspection failed: nothing can be approved.
		{errors.New(`ConfigMap "gadget" exists and cannot be imported into the current release: invalid ownership metadata; conflict inspection failed: denied`), true},
		{&helm.OwnershipConflictError{Err: errors.New("ownership validation failed")}, true},
		{errors.New("fixture access denied"), false},
	} {
		data := map[string]interface{}{}
		setDeploymentError(data, test.err)
		encoded, err := json.Marshal(data)
		if err != nil {
			t.Fatal(err)
		}
		if data["ownershipConflict"] != false || data["resourceConflicts"] != nil {
			t.Fatalf("conflict recovery offered without concrete resources: %s", encoded)
		}
		if manual := strings.Contains(data["error"].(string), "Inspect the namespace manually"); manual != test.manual {
			t.Fatalf("unexpected manual-inspection guidance: %s", encoded)
		}
	}
}

func TestDeployRejectsConcurrentOperationOnSameTarget(t *testing.T) {
	_, transport, _, _, _ := matchedHandler(t, "https://unused.invalid")
	release, err := acquireDeploymentTarget("/fixture/config", "fixture", "gadget")
	if err != nil {
		t.Fatal(err)
	}
	for _, mode := range []string{"deploy", "redeploy", "undeploy"} {
		reply := transport.call(t, "deployIG", map[string]any{
			"namespace": "gadget", "releaseName": "gadget", "kubeConfig": "/fixture/config", "kubeContext": "fixture",
			"redeploy": mode == "redeploy", "undeploy": mode == "undeploy",
		})
		if reply.Success || !strings.Contains(reply.Error, "already running for namespace gadget") {
			t.Fatalf("%s overlapped a running operation: %+v", mode, reply)
		}
	}
	other, err := acquireDeploymentTarget("/fixture/config", "fixture", "other")
	if err != nil {
		t.Fatalf("a different namespace must not be blocked: %v", err)
	}
	other()
	release()
	release() // idempotent
	again, err := acquireDeploymentTarget("/fixture/config", "fixture", "gadget")
	if err != nil {
		t.Fatalf("released target stayed reserved: %v", err)
	}
	again()
}

func TestDeployRequestRequiresExplicitRedeployForCleanup(t *testing.T) {
	_, transport, _, _, _ := matchedHandler(t, "https://unused.invalid")
	for _, flags := range []struct{ redeploy, undeploy bool }{{false, false}, {false, true}, {true, true}} {
		reply := transport.call(t, "deployIG", map[string]any{
			"namespace": "gadget", "releaseName": "gadget",
			"redeploy": flags.redeploy, "undeploy": flags.undeploy,
			"cleanupResources": []helm.ResourceIdentity{{
				APIVersion: "v1", Kind: "ConfigMap", Namespace: "gadget", Name: "gadget",
				UID: "fixture-uid", ResourceVersion: "17",
			}},
		})
		if reply.Success || !strings.Contains(reply.Error, "cleanupResources requires redeploy:true") {
			t.Fatalf("cleanup accepted outside explicit redeploy: %+v", reply)
		}
	}

}

func TestDeployRequestRejectsPresentInvalidCleanupResources(t *testing.T) {
	_, transport, _, _, _ := matchedHandler(t, "https://unused.invalid")
	for _, raw := range []string{
		`[]`, `null`, `{}`, `"invalid"`, `[null]`, `[{}]`,
		`[{"apiVersion":"v1","kind":"ConfigMap","namespace":"gadget","name":"gadget","uid":"","resourceVersion":"17"}]`,
		`[{"apiVersion":"v1","kind":"ConfigMap","namespace":"gadget","name":"gadget","uid":"fixture-uid","resourceVersion":17}]`,
		`[{"apiVersion":"v1","kind":"ConfigMap","namespace":"gadget","name":"gadget","uid":"fixture-uid","resourceVersion":"17"},{"apiVersion":"v1","kind":"ConfigMap","namespace":"gadget","name":"gadget","uid":"fixture-uid","resourceVersion":"17"}]`,
	} {
		reply := transport.call(t, "deployIG", map[string]any{
			"namespace": "gadget", "releaseName": "gadget", "redeploy": true,
			"cleanupResources": json.RawMessage(raw),
		})
		if reply.Success || !strings.Contains(reply.Error, "cleanupResources") {
			t.Fatalf("malformed exact approval fell back to legacy mode (%s): %+v", raw, reply)
		}
	}
	var omitted DeployIGRequest
	if err := json.Unmarshal([]byte(`{"redeploy":true,"namespace":"gadget","releaseName":"gadget"}`), &omitted); err != nil ||
		omitted.CleanupResources != nil || !omitted.Redeploy || omitted.Namespace != "gadget" || omitted.ReleaseName != "gadget" {
		t.Fatalf("omitted approvals changed legacy request: %+v %v", omitted, err)
	}
}
