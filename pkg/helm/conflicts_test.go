// Copyright 2026 The Inspektor Gadget authors
// SPDX-License-Identifier: Apache-2.0

package helm

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
	"time"

	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/chart"
	"helm.sh/helm/v3/pkg/chartutil"
	"helm.sh/helm/v3/pkg/repo"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

const conflictPath = "/api/v1/namespaces/gadget/configmaps/gadget"

func conflictChart(names ...string) *chart.Chart {
	chrt := &chart.Chart{Metadata: &chart.Metadata{Name: "gadget", Version: "1.0.0", APIVersion: "v2"}}
	for _, name := range names {
		chrt.Templates = append(chrt.Templates, &chart.File{
			Name: "templates/" + name + ".yaml",
			Data: []byte(fmt.Sprintf("apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: %s\n  namespace: {{ .Release.Namespace }}\ndata:\n  fixture: replacement\n", name)),
		})
	}
	return chrt
}

func unlabeledConflict(t *testing.T) (*uninstallCluster, *Deployer) {
	t.Helper()
	cluster, deployer := newUninstallCluster(t)
	cluster.requireExactPreconditions = true
	cluster.add(conflictPath, "ConfigMap", "gadget", "gadget")
	obj := cluster.objects[conflictPath]
	obj.SetLabels(nil)
	obj.Object["data"] = map[string]any{"private": "must not leave backend"}
	cluster.objects[conflictPath] = obj
	return cluster, deployer
}

func fixtureInstall(t *testing.T, deployer *Deployer, chrt *chart.Chart) error {
	t.Helper()
	config, err := deployer.newActionConfig()
	if err != nil {
		t.Fatal(err)
	}
	client := action.NewInstall(config)
	client.Namespace, client.ReleaseName = "gadget", "gadget"
	// Production validation stays enabled against the synthetic OpenAPI endpoint.
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return deployer.runInstall(ctx, config, client, chrt)
}

func fixtureApproval() ResourceIdentity {
	return ResourceIdentity{APIVersion: "v1", Kind: "ConfigMap", Namespace: "gadget",
		Name: "gadget", UID: fixtureUID("ConfigMap", "gadget", "gadget"), ResourceVersion: "1"}
}

func serveFixtureChart(t *testing.T, deployer *Deployer, chrt *chart.Chart) {
	t.Helper()
	dir := t.TempDir()
	path, err := chartutil.Save(chrt, dir)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.FileServer(http.Dir(dir)))
	t.Cleanup(server.Close)
	index := repo.NewIndexFile()
	if err := index.MustAdd(chrt.Metadata, filepath.Base(path), server.URL, ""); err != nil {
		t.Fatal(err)
	}
	if err := index.WriteFile(filepath.Join(dir, "index.yaml"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(deployer.settings.RepositoryCache, 0700); err != nil {
		t.Fatal(err)
	}
	repositories := repo.NewFile()
	repositories.Update(&repo.Entry{Name: inspektorGadgetRepoName, URL: server.URL})
	if err := repositories.WriteFile(deployer.settings.RepositoryConfig, 0600); err != nil {
		t.Fatal(err)
	}
}

func TestExactConflictRecoveryRealRedeploy(t *testing.T) {
	cluster, deployer := unlabeledConflict(t)
	chrt := conflictChart("gadget")
	if err := deployer.uninstall(context.Background()); err != nil {
		t.Fatal(err)
	}
	cluster.mu.Lock()
	preserved, exists := cluster.objects[conflictPath]
	cluster.mu.Unlock()
	if !exists || len(preserved.GetLabels()) != 0 || len(cluster.mutations) != 0 {
		t.Fatal("ordinary cleanup must preserve the unlabeled ConfigMap without mutations")
	}
	err := fixtureInstall(t, deployer, chrt)
	conflicts := ResourceConflicts(err)
	if !IsOwnershipConflict(err) || len(conflicts) != 1 || conflicts[0].ResourceIdentity != fixtureApproval() || conflicts[0].BlockedReason != "" {
		t.Fatalf("missing exact eligible conflict: %v, %+v", err, conflicts)
	}
	encoded, marshalErr := json.Marshal(conflicts)
	if marshalErr != nil || strings.Contains(string(encoded), "private") || strings.Contains(string(encoded), `"data"`) {
		t.Fatalf("object contents leaked in approval metadata: %s %v", encoded, marshalErr)
	}
	if len(cluster.mutations) != 0 {
		t.Fatalf("inspection mutated cluster: %v", cluster.mutations)
	}
	// A no-approval retry must remain non-destructive.
	if err := fixtureInstall(t, deployer, chrt); !IsOwnershipConflict(err) || len(cluster.mutations) != 0 {
		t.Fatalf("ordinary retry mutated or adopted existing object: %v", err)
	}
	deployer.config.CleanupResources = []ResourceIdentity{conflicts[0].ResourceIdentity}
	cluster.add("/api/v1/namespaces/gadget", "Namespace", "", "gadget")
	cluster.add("/api/v1/namespaces/gadget/configmaps/unrelated", "ConfigMap", "gadget", "unrelated")
	cluster.add("/apis/apps/v1/namespaces/gadget/daemonsets/ready", "DaemonSet", "gadget", "ready")
	ds := cluster.objects["/apis/apps/v1/namespaces/gadget/daemonsets/ready"]
	ds.Object["status"] = map[string]any{"desiredNumberScheduled": int64(1), "numberReady": int64(1)}
	cluster.objects["/apis/apps/v1/namespaces/gadget/daemonsets/ready"] = ds
	serveFixtureChart(t, deployer, chrt)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := deployer.Redeploy(ctx); err != nil {
		t.Fatalf("real production redeploy failed: %v", err)
	}
	cluster.mu.Lock()
	defer cluster.mu.Unlock()
	if len(cluster.deleted) != 1 || cluster.deleted[0] != conflictPath {
		t.Fatalf("exact mode ran broader deletion: %v", cluster.deleted)
	}
	for _, path := range []string{"/api/v1/namespaces/gadget", "/api/v1/namespaces/gadget/configmaps/unrelated", "/apis/apps/v1/namespaces/gadget/daemonsets/ready"} {
		if _, ok := cluster.objects[path]; !ok {
			t.Fatalf("unapproved resource removed: %s", path)
		}
	}
	replacement := cluster.objects[conflictPath]
	if replacement.GetLabels()["app.kubernetes.io/managed-by"] != "Helm" || replacement.GetAnnotations()["meta.helm.sh/release-name"] != "gadget" {
		t.Fatalf("replacement was not installed by real Helm: %v", replacement.Object)
	}
}

func TestExactCleanupRejectsUnapprovedOrChangedObjects(t *testing.T) {
	tests := []struct {
		name   string
		change func(*uninstallCluster, *Deployer)
	}{
		{"uid changed", func(c *uninstallCluster, d *Deployer) {
			obj := c.objects[conflictPath]
			obj.SetUID("replacement")
			c.objects[conflictPath] = obj
		}},
		{"version changed", func(c *uninstallCluster, d *Deployer) {
			obj := c.objects[conflictPath]
			obj.SetResourceVersion("2")
			c.objects[conflictPath] = obj
		}},
		{"owner reference", func(c *uninstallCluster, d *Deployer) {
			obj := c.objects[conflictPath]
			obj.SetOwnerReferences([]metav1.OwnerReference{{APIVersion: "v1", Kind: "ConfigMap", Name: "owner", UID: "owner-uid"}})
			c.objects[conflictPath] = obj
		}},
		{"other release", func(c *uninstallCluster, d *Deployer) {
			obj := c.objects[conflictPath]
			obj.SetAnnotations(map[string]string{"meta.helm.sh/release-name": "foreign"})
			c.objects[conflictPath] = obj
		}},
		{"other release namespace", func(c *uninstallCluster, d *Deployer) {
			obj := c.objects[conflictPath]
			obj.SetAnnotations(map[string]string{"meta.helm.sh/release-namespace": "foreign"})
			c.objects[conflictPath] = obj
		}},
		{"foreign installer", func(c *uninstallCluster, d *Deployer) {
			obj := c.objects[conflictPath]
			obj.SetLabels(map[string]string{"app.kubernetes.io/managed-by": "operator"})
			c.objects[conflictPath] = obj
		}},
		{"helm storage", func(c *uninstallCluster, d *Deployer) {
			obj := c.objects[conflictPath]
			obj.SetLabels(map[string]string{"owner": "helm"})
			c.objects[conflictPath] = obj
		}},
		{"missing identity", func(c *uninstallCluster, d *Deployer) { d.config.CleanupResources[0].UID = "" }},
		{"uid of same-named object of another kind", func(c *uninstallCluster, d *Deployer) {
			c.add("/apis/apps/v1/namespaces/gadget/daemonsets/gadget", "DaemonSet", "gadget", "gadget")
			d.config.CleanupResources[0].UID = fixtureUID("DaemonSet", "gadget", "gadget")
		}},
		{"extra approval", func(c *uninstallCluster, d *Deployer) {
			extra := fixtureApproval()
			extra.Name = "extra"
			d.config.CleanupResources = append(d.config.CleanupResources, extra)
		}},
		{"duplicate approval", func(c *uninstallCluster, d *Deployer) {
			d.config.CleanupResources = append(d.config.CleanupResources, fixtureApproval())
		}},
		{"wrong chart object", func(c *uninstallCluster, d *Deployer) { d.config.CleanupResources[0].Name = "unrelated" }},
		{"api forbidden", func(c *uninstallCluster, d *Deployer) { c.deny = conflictPath }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			cluster, deployer := unlabeledConflict(t)
			deployer.config.CleanupResources = []ResourceIdentity{fixtureApproval()}
			test.change(cluster, deployer)
			if err := fixtureInstall(t, deployer, conflictChart("gadget")); err == nil {
				t.Fatal("unsafe cleanup accepted")
			}
			cluster.mu.Lock()
			defer cluster.mu.Unlock()
			if len(cluster.mutations) != 0 {
				t.Fatalf("rejected cleanup mutated cluster: %v", cluster.mutations)
			}
		})
	}
}

func TestExactCleanupPreflightsWholeSet(t *testing.T) {
	for _, mode := range []string{"missing approval", "duplicate approval", "read failure", "delete forbidden", "changed after preflight", "additional conflict", "delete race", "preflight race", "partial delete error", "delete throttled"} {
		t.Run(mode, func(t *testing.T) {
			cluster, deployer := unlabeledConflict(t)
			secondPath := "/api/v1/namespaces/gadget/configmaps/second"
			cluster.add(secondPath, "ConfigMap", "gadget", "second")
			second := fixtureApproval()
			second.Name, second.UID = "second", fixtureUID("ConfigMap", "gadget", "second")
			deployer.config.CleanupResources = []ResourceIdentity{fixtureApproval(), second}
			chrt := conflictChart("gadget", "second", "third")
			deletes := 0
			switch mode {
			case "missing approval":
				deployer.config.CleanupResources = deployer.config.CleanupResources[:1]
			case "duplicate approval":
				deployer.config.CleanupResources[1] = fixtureApproval()
			case "read failure":
				cluster.deny = secondPath
			default:
				cluster.beforeRequest = func(r *http.Request) {
					if r.Method != http.MethodDelete {
						return
					}
					deletes++
					switch mode {
					case "delete forbidden":
						cluster.deny = secondPath
					case "changed after preflight":
						if deletes == 2 {
							obj := cluster.objects[conflictPath]
							obj.SetResourceVersion("2")
							cluster.objects[conflictPath] = obj
						}
					case "additional conflict":
						if deletes == 2 {
							cluster.add("/api/v1/namespaces/gadget/configmaps/third", "ConfigMap", "gadget", "third")
						}
					case "delete race":
						if deletes == 3 {
							obj := cluster.objects[r.URL.Path]
							obj.SetResourceVersion("2")
							cluster.objects[r.URL.Path] = obj
						}
					case "preflight race":
						if deletes == 1 {
							obj := cluster.objects[r.URL.Path]
							obj.SetResourceVersion("2")
							cluster.objects[r.URL.Path] = obj
						}
					case "partial delete error":
						if deletes == 4 {
							cluster.deny = r.URL.Path
						}
					case "delete throttled":
						if deletes == 3 {
							cluster.deny, cluster.denyStatus = r.URL.Path, http.StatusTooManyRequests
						}
					}
				}
			}
			err := fixtureInstall(t, deployer, chrt)
			if err == nil {
				t.Fatal("unsafe cleanup accepted")
			}
			if mode == "delete race" || mode == "preflight race" || mode == "changed after preflight" {
				foundChanged := false
				for _, conflict := range ResourceConflicts(err) {
					foundChanged = foundChanged || conflict.ResourceVersion == "2"
				}
				if !IsOwnershipConflict(err) || !foundChanged {
					t.Fatalf("changed resource requires fresh descriptors: %v %+v", err, ResourceConflicts(err))
				}
			}
			cluster.mu.Lock()
			defer cluster.mu.Unlock()
			if mode == "delete throttled" && deletes != 3 {
				t.Fatalf("DELETE was automatically retried: %d requests", deletes)
			}
			if mode == "partial delete error" {
				if len(cluster.deleted) != 1 || !strings.Contains(err.Error(), "after 1 deletion requests") {
					t.Fatalf("partial failure not explicit: deleted=%v err=%v", cluster.deleted, err)
				}
			} else if len(cluster.mutations) != 0 {
				t.Fatalf("preflight failure partially mutated cluster: %v", cluster.mutations)
			}
		})
	}
}

func TestExactCleanupBlocksClusterScopedResources(t *testing.T) {
	for _, fixture := range []struct{ kind, version, path string }{
		{"Namespace", "v1", "/api/v1/namespaces/gadget"},
		{"ClusterRole", "rbac.authorization.k8s.io/v1", "/apis/rbac.authorization.k8s.io/v1/clusterroles/gadget"},
		{"CustomResourceDefinition", "apiextensions.k8s.io/v1", "/apis/apiextensions.k8s.io/v1/customresourcedefinitions/gadget"},
	} {
		t.Run(fixture.kind, func(t *testing.T) {
			cluster, deployer := newUninstallCluster(t)
			cluster.add(fixture.path, fixture.kind, "", "gadget")
			chrt := &chart.Chart{Metadata: &chart.Metadata{Name: "gadget", Version: "1.0.0", APIVersion: "v2"},
				Templates: []*chart.File{{Name: "templates/shared.yaml", Data: []byte(fmt.Sprintf("apiVersion: %s\nkind: %s\nmetadata:\n  name: gadget\n", fixture.version, fixture.kind))}}}
			config, err := deployer.newActionConfig()
			if err != nil {
				t.Fatal(err)
			}
			client := action.NewInstall(config)
			client.Namespace, client.ReleaseName = "gadget", "gadget"
			client.DisableOpenAPIValidation = true
			err = deployer.runInstall(context.Background(), config, client, chrt)
			conflicts := ResourceConflicts(err)
			if len(conflicts) != 1 || conflicts[0].BlockedReason == "" {
				t.Fatalf("shared resource not blocked: %v %+v", err, conflicts)
			}
			deployer.config.CleanupResources = []ResourceIdentity{conflicts[0].ResourceIdentity}
			if err := deployer.runInstall(context.Background(), config, client, chrt); err == nil || len(cluster.mutations) != 0 {
				t.Fatalf("shared resource deleted: %v %v", err, cluster.mutations)
			}
		})
	}
}

func TestExactRecoveryRequestsFreshApprovalForNewInstallConflict(t *testing.T) {
	cluster, deployer := unlabeledConflict(t)
	deployer.config.CleanupResources = []ResourceIdentity{fixtureApproval()}
	secondPath := "/api/v1/namespaces/gadget/configmaps/second"
	cluster.beforeRequest = func(r *http.Request) {
		if len(cluster.deleted) != 0 && r.Method == http.MethodGet {
			cluster.add(secondPath, "ConfigMap", "gadget", "second")
		}
	}
	err := fixtureInstall(t, deployer, conflictChart("gadget", "second"))
	conflicts := ResourceConflicts(err)
	if !IsOwnershipConflict(err) || len(conflicts) != 1 || conflicts[0].Name != "second" {
		t.Fatalf("new installation conflict did not request fresh approval: %v %+v", err, conflicts)
	}
	cluster.mu.Lock()
	defer cluster.mu.Unlock()
	if len(cluster.mutations) != 1 || len(cluster.deleted) != 1 || cluster.deleted[0] != conflictPath {
		t.Fatalf("new conflict was deleted or install continued: %v", cluster.mutations)
	}
}

func TestConflictInspectionDoesNotExecuteHooksOrInstallCRDs(t *testing.T) {
	cluster, deployer := unlabeledConflict(t)
	chrt := conflictChart("gadget")
	chrt.Templates = append(chrt.Templates, &chart.File{Name: "templates/hook.yaml", Data: []byte("apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: hook\n  annotations:\n    helm.sh/hook: pre-install\n")})
	chrt.Files = append(chrt.Files, &chart.File{Name: "crds/fixture.yaml", Data: []byte("apiVersion: apiextensions.k8s.io/v1\nkind: CustomResourceDefinition\nmetadata:\n  name: fixture.example.test\n")})
	config, err := deployer.newActionConfig()
	if err != nil {
		t.Fatal(err)
	}
	client := action.NewInstall(config)
	client.Namespace, client.ReleaseName = "gadget", "gadget"
	if _, err := deployer.renderConflictResources(context.Background(), config, client, chrt); err != nil {
		t.Fatal(err)
	}
	if len(cluster.mutations) != 0 {
		t.Fatalf("read-only inspection executed hooks or CRDs: %v", cluster.mutations)
	}
}

func TestExactRecoveryReturnsRecreatedObjectForFreshApproval(t *testing.T) {
	cluster, deployer := unlabeledConflict(t)
	deployer.config.CleanupResources = []ResourceIdentity{fixtureApproval()}
	cluster.beforeRequest = func(r *http.Request) {
		if len(cluster.deleted) != 0 && r.Method == http.MethodGet && r.URL.Path == conflictPath {
			cluster.add(conflictPath, "ConfigMap", "gadget", "gadget")
			object := cluster.objects[conflictPath]
			object.SetUID("recreated-uid")
			object.SetResourceVersion("20")
			cluster.objects[conflictPath] = object
		}
	}
	err := fixtureInstall(t, deployer, conflictChart("gadget"))
	conflicts := ResourceConflicts(err)
	if !IsOwnershipConflict(err) || len(conflicts) != 1 || conflicts[0].UID != "recreated-uid" || conflicts[0].ResourceVersion != "20" {
		t.Fatalf("recreated object missing fresh descriptors: %v %+v", err, conflicts)
	}
	cluster.mu.Lock()
	defer cluster.mu.Unlock()
	if len(cluster.mutations) != 1 || len(cluster.deleted) != 1 {
		t.Fatalf("recreated object deleted or install continued: %v", cluster.mutations)
	}
}

func TestExplicitEmptyApprovalsNeverUseLabelCleanup(t *testing.T) {
	if _, err := NewDeployer(&DeployConfig{CleanupResources: []ResourceIdentity{}}); err == nil {
		t.Fatal("deployer accepted explicit empty approvals")
	}
	cluster, deployer := unlabeledConflict(t)
	cluster.add("/api/v1/namespaces/gadget/configmaps/labeled", "ConfigMap", "gadget", "labeled")
	deployer.config.CleanupResources = []ResourceIdentity{}
	serveFixtureChart(t, deployer, conflictChart("gadget"))
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := deployer.Redeploy(ctx); err == nil {
		t.Fatal("redeploy accepted explicit empty approvals")
	}
	if len(cluster.mutations) != 0 {
		t.Fatalf("empty approvals invoked legacy cleanup: %v", cluster.mutations)
	}
}

func TestExactCleanupRemovesWorkloadPods(t *testing.T) {
	const daemonSet = "/apis/apps/v1/namespaces/gadget/daemonsets/gadget"
	const pod = "/api/v1/namespaces/gadget/pods/gadget-x"
	chrt := &chart.Chart{Metadata: &chart.Metadata{Name: "gadget", Version: "1.0.0", APIVersion: "v2"},
		Templates: []*chart.File{{Name: "templates/daemonset.yaml", Data: []byte(`apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: gadget
  namespace: {{ .Release.Namespace }}
spec:
  selector:
    matchLabels:
      k8s-app: gadget
  template:
    metadata:
      labels:
        k8s-app: gadget
    spec:
      containers:
      - name: gadget
        image: fixture
`)}}}
	for _, garbageCollected := range []bool{false, true} {
		t.Run(fmt.Sprintf("garbage collected %v", garbageCollected), func(t *testing.T) {
			cluster, deployer := newUninstallCluster(t)
			cluster.requireExactPreconditions = true
			cluster.add(daemonSet, "DaemonSet", "gadget", "gadget")
			ds := cluster.objects[daemonSet]
			ds.Object["spec"] = map[string]any{"selector": map[string]any{"matchLabels": map[string]any{"k8s-app": "gadget"}}}
			cluster.objects[daemonSet] = ds
			cluster.add(pod, "Pod", "gadget", "gadget-x")
			if garbageCollected {
				cluster.beforeRequest = func(r *http.Request) {
					if _, exists := cluster.objects[daemonSet]; !exists {
						delete(cluster.objects, pod)
					}
				}
			}
			deployer.config.CleanupResources = []ResourceIdentity{{APIVersion: "apps/v1", Kind: "DaemonSet",
				Namespace: "gadget", Name: "gadget", UID: string(ds.GetUID()), ResourceVersion: "1"}}
			config, err := deployer.newActionConfig()
			if err != nil {
				t.Fatal(err)
			}
			client := action.NewInstall(config)
			client.Namespace, client.ReleaseName = "gadget", "gadget"
			client.DisableOpenAPIValidation = true
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			err = deployer.runInstall(ctx, config, client, chrt)
			cluster.mu.Lock()
			defer cluster.mu.Unlock()
			options := cluster.deleteOptions[daemonSet]
			if options.PropagationPolicy == nil || *options.PropagationPolicy != metav1.DeletePropagationBackground {
				t.Fatalf("workload deleted without cascading to its pods: %+v", options.PropagationPolicy)
			}
			installed := false
			for _, mutation := range cluster.mutations {
				installed = installed || mutation == "POST /apis/apps/v1/namespaces/gadget/daemonsets"
			}
			if garbageCollected {
				if err != nil || !installed {
					t.Fatalf("install after pod removal failed: %v %v", err, cluster.mutations)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), "pods controlled by gadget/gadget") || installed {
				t.Fatalf("install proceeded while old IG pods were still running: %v %v", err, cluster.mutations)
			}
		})
	}
}
