// Copyright 2026 The Inspektor Gadget authors
// SPDX-License-Identifier: Apache-2.0

package helm

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/chart"
)

func TestInstallWithExistingConfigMap(t *testing.T) {
	cluster, deployer := newUninstallCluster(t)
	path := "/api/v1/namespaces/gadget/configmaps/gadget"
	cluster.add(path, "ConfigMap", "gadget", "gadget")
	// A mixed installation can leave non-Helm resources outside the release's
	// manifest after a successful Helm-based Undeploy.
	cluster.addRelease(t, "gadget", "gadget")
	if err := deployer.uninstall(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, exists := cluster.objects[path]; !exists {
		t.Fatal("fixture did not retain the non-Helm ConfigMap")
	}
	config, err := deployer.newActionConfig()
	if err != nil {
		t.Fatal(err)
	}
	client := action.NewInstall(config)
	client.Namespace = "gadget"
	client.ReleaseName = "gadget"
	client.DisableOpenAPIValidation = true
	fixture := &chart.Chart{
		Metadata: &chart.Metadata{Name: "gadget", Version: "1.0.0", APIVersion: "v2"},
		Templates: []*chart.File{{
			Name: "templates/configmap.yaml",
			Data: []byte("apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: gadget\n  namespace: gadget\n"),
		}},
	}
	err = deployer.runInstall(context.Background(), config, client, fixture)
	if err == nil || !strings.Contains(err.Error(), `ConfigMap "gadget"`) ||
		!strings.Contains(err.Error(), "invalid ownership metadata") {
		t.Fatalf("expected the reported ownership conflict, got %v", err)
	}
	conflicts := ResourceConflicts(err)
	if !IsOwnershipConflict(err) || len(conflicts) != 1 || conflicts[0].BlockedReason != "" {
		t.Fatalf("ownership conflict must offer exact recovery: %v %+v", err, conflicts)
	}
	cluster.mu.Lock()
	before := cluster.objects[path]
	mutations := len(cluster.mutations)
	cluster.mu.Unlock()
	if before.GetLabels()["app.kubernetes.io/managed-by"] != "" {
		t.Fatal("failed install silently adopted the existing ConfigMap")
	}
	// Recovery deletes only the exact approved object, never via a label sweep.
	cluster.requireExactPreconditions = true
	deployer.config.CleanupResources = []ResourceIdentity{conflicts[0].ResourceIdentity}
	if err := deployer.runInstall(context.Background(), config, client, fixture); err != nil {
		t.Fatalf("installation after confirmed cleanup failed: %v", err)
	}
	cluster.mu.Lock()
	defer cluster.mu.Unlock()
	if deletes := cluster.mutations[mutations:]; len(deletes) == 0 || deletes[0] != "DELETE "+path {
		t.Fatalf("recovery did not delete exactly the approved object: %v", deletes)
	}
	installed := cluster.objects[path]
	if installed.GetLabels()["app.kubernetes.io/managed-by"] != "Helm" {
		t.Fatal("replacement was not installed by Helm")
	}
}

func TestCleanupPreservesUnidentifiedConfigMap(t *testing.T) {
	cluster, deployer := newUninstallCluster(t)
	path := "/api/v1/namespaces/gadget/configmaps/gadget"
	cluster.add(path, "ConfigMap", "gadget", "gadget")
	object := cluster.objects[path]
	object.SetLabels(nil)
	cluster.objects[path] = object
	if err := deployer.uninstall(context.Background()); err != nil {
		t.Fatal(err)
	}

	cluster.mu.Lock()
	_, exists := cluster.objects[path]
	deleted := len(cluster.deleted)
	cluster.mu.Unlock()
	if !exists || deleted != 0 {
		t.Fatal("cleanup removed an unidentified ConfigMap based only on its name")
	}
	config, err := deployer.newActionConfig()
	if err != nil {
		t.Fatal(err)
	}
	client := action.NewInstall(config)
	client.Namespace, client.ReleaseName = "gadget", "gadget"
	client.DisableOpenAPIValidation = true
	_, err = client.RunWithContext(context.Background(), &chart.Chart{
		Metadata: &chart.Metadata{Name: "gadget", Version: "1.0.0", APIVersion: "v2"},
		Templates: []*chart.File{{
			Name: "templates/configmap.yaml",
			Data: []byte("apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: gadget\n"),
		}},
	}, nil)
	if !IsOwnershipConflict(err) {
		t.Fatalf("unidentified ConfigMap must still block real Helm install after cleanup: %v", err)
	}
}

func TestOwnershipConflictDoesNotIncludeOtherInstallFailures(t *testing.T) {
	for _, err := range []error{
		nil,
		fmt.Errorf("configmaps is forbidden: fixture access denied"),
		fmt.Errorf("dial tcp: connection refused"),
		fmt.Errorf("cannot re-use a name that is still in use"),
		fmt.Errorf("invalid ownership metadata in custom values"),
	} {
		if IsOwnershipConflict(err) {
			t.Fatalf("ordinary failure must not offer cleanup: %v", err)
		}
	}
}
