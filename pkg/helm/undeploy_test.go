// Copyright 2026 The Inspektor Gadget authors
// SPDX-License-Identifier: Apache-2.0

package helm

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	openapiv2 "github.com/google/gnostic-models/openapiv2"
	"google.golang.org/protobuf/proto"
	"helm.sh/helm/v3/pkg/chart"
	"helm.sh/helm/v3/pkg/release"
	"helm.sh/helm/v3/pkg/storage/driver"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes/fake"
	"k8s.io/client-go/kubernetes/scheme"
)

// Exercise the real Helm/Kubernetes HTTP path, using only a synthetic kubeconfig.
type uninstallCluster struct {
	mu                        sync.Mutex
	objects                   map[string]unstructured.Unstructured
	deleted                   []string
	deny                      string
	denyStatus                int
	stuck                     bool
	beforeRequest             func(*http.Request)
	requireExactPreconditions bool
	mutations                 []string
	deleteOptions             map[string]metav1.DeleteOptions
	// unavailableGroup is advertised in discovery but its resources fail.
	unavailableGroup string
}

func newUninstallCluster(t *testing.T) (*uninstallCluster, *Deployer) {
	t.Helper()
	cluster := &uninstallCluster{objects: make(map[string]unstructured.Unstructured), deleteOptions: make(map[string]metav1.DeleteOptions)}
	resources := map[string]metav1.APIResourceList{
		"/api/v1": {GroupVersion: "v1", APIResources: []metav1.APIResource{
			{Name: "namespaces", Kind: "Namespace", Verbs: []string{"get", "list", "delete"}},
			{Name: "secrets", Kind: "Secret", Namespaced: true, Verbs: []string{"get", "list", "create", "update", "delete"}},
			{Name: "configmaps", Kind: "ConfigMap", Namespaced: true, Verbs: []string{"get", "list", "delete"}},
			{Name: "serviceaccounts", Kind: "ServiceAccount", Namespaced: true, Verbs: []string{"get", "list", "delete"}},
			{Name: "pods", Kind: "Pod", Namespaced: true, Verbs: []string{"get", "list", "delete"}},
		}},
		"/apis/apps/v1": {GroupVersion: "apps/v1", APIResources: []metav1.APIResource{
			{Name: "daemonsets", Kind: "DaemonSet", Namespaced: true, Verbs: []string{"get", "list", "delete"}},
			{Name: "deployments", Kind: "Deployment", Namespaced: true, Verbs: []string{"get", "list", "delete"}},
			{Name: "replicasets", Kind: "ReplicaSet", Namespaced: true, Verbs: []string{"get", "list", "delete"}},
		}},
		"/apis/rbac.authorization.k8s.io/v1": {GroupVersion: "rbac.authorization.k8s.io/v1", APIResources: []metav1.APIResource{
			{Name: "clusterroles", Kind: "ClusterRole", Verbs: []string{"get", "list", "delete"}},
			{Name: "clusterrolebindings", Kind: "ClusterRoleBinding", Verbs: []string{"get", "list", "delete"}},
			{Name: "roles", Kind: "Role", Namespaced: true, Verbs: []string{"get", "list", "delete"}},
			{Name: "rolebindings", Kind: "RoleBinding", Namespaced: true, Verbs: []string{"get", "list", "delete"}},
		}},
		"/apis/apiextensions.k8s.io/v1": {GroupVersion: "apiextensions.k8s.io/v1", APIResources: []metav1.APIResource{
			{Name: "customresourcedefinitions", Kind: "CustomResourceDefinition", Verbs: []string{"get", "list", "delete"}},
		}},
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cluster.mu.Lock()
		defer cluster.mu.Unlock()
		if cluster.beforeRequest != nil {
			cluster.beforeRequest(r)
		}
		w.Header().Set("Content-Type", "application/json")
		write := func(v any) {
			if status, ok := v.(metav1.Status); ok {
				status.TypeMeta = metav1.TypeMeta{APIVersion: "v1", Kind: "Status"}
				v = status
			}
			if err := json.NewEncoder(w).Encode(v); err != nil {
				t.Errorf("encoding fixture response: %v", err)
			}
		}
		if r.URL.Path == cluster.deny {
			if cluster.denyStatus == http.StatusTooManyRequests {
				w.Header().Set("Retry-After", "1")
				w.WriteHeader(http.StatusTooManyRequests)
				write(metav1.Status{Status: metav1.StatusFailure, Reason: metav1.StatusReasonTooManyRequests, Code: 429, Message: "fixture throttled"})
				return
			}
			w.WriteHeader(http.StatusForbidden)
			write(metav1.Status{Status: metav1.StatusFailure, Reason: metav1.StatusReasonForbidden, Code: 403, Message: "fixture access denied"})
			return
		}
		switch r.URL.Path {
		case "/openapi/v2":
			doc, err := openapiv2.ParseDocument([]byte(`{
				"swagger":"2.0","info":{"title":"fixture","version":"v1"},"paths":{},
				"definitions":{
					"io.k8s.api.core.v1.ConfigMap":{"type":"object","x-kubernetes-group-version-kind":[{"group":"","version":"v1","kind":"ConfigMap"}],"properties":{"apiVersion":{"type":"string"},"kind":{"type":"string"},"metadata":{"type":"object"},"data":{"type":"object","additionalProperties":{"type":"string"}}}},
					"io.k8s.api.core.v1.Namespace":{"type":"object","x-kubernetes-group-version-kind":[{"group":"","version":"v1","kind":"Namespace"}],"properties":{"apiVersion":{"type":"string"},"kind":{"type":"string"},"metadata":{"type":"object"},"spec":{"type":"object"},"status":{"type":"object"}}}
				}}`))
			if err != nil {
				t.Errorf("fixture OpenAPI: %v", err)
				return
			}
			data, err := proto.Marshal(doc)
			if err != nil {
				t.Errorf("fixture OpenAPI protobuf: %v", err)
				return
			}
			w.Header().Set("Content-Type", "application/octet-stream")
			_, _ = w.Write(data)
			return
		case "/version":
			write(map[string]string{"gitVersion": "v1.32.0", "major": "1", "minor": "32"})
			return
		case "/api":
			write(metav1.APIVersions{Versions: []string{"v1"}})
			return
		case "/apis/" + cluster.unavailableGroup + "/v1":
			w.WriteHeader(http.StatusServiceUnavailable)
			write(metav1.Status{Status: metav1.StatusFailure, Reason: metav1.StatusReasonServiceUnavailable, Code: 503})
			return
		case "/apis":
			groups := metav1.APIGroupList{Groups: []metav1.APIGroup{
				{Name: "apps", Versions: []metav1.GroupVersionForDiscovery{{GroupVersion: "apps/v1", Version: "v1"}}, PreferredVersion: metav1.GroupVersionForDiscovery{GroupVersion: "apps/v1", Version: "v1"}},
				{Name: "rbac.authorization.k8s.io", Versions: []metav1.GroupVersionForDiscovery{{GroupVersion: "rbac.authorization.k8s.io/v1", Version: "v1"}}, PreferredVersion: metav1.GroupVersionForDiscovery{GroupVersion: "rbac.authorization.k8s.io/v1", Version: "v1"}},
				{Name: "apiextensions.k8s.io", Versions: []metav1.GroupVersionForDiscovery{{GroupVersion: "apiextensions.k8s.io/v1", Version: "v1"}}, PreferredVersion: metav1.GroupVersionForDiscovery{GroupVersion: "apiextensions.k8s.io/v1", Version: "v1"}},
			}}
			if group := cluster.unavailableGroup; group != "" {
				version := metav1.GroupVersionForDiscovery{GroupVersion: group + "/v1", Version: "v1"}
				groups.Groups = append(groups.Groups, metav1.APIGroup{Name: group, Versions: []metav1.GroupVersionForDiscovery{version}, PreferredVersion: version})
			}
			write(groups)
			return
		}
		if resourceList, ok := resources[r.URL.Path]; ok {
			write(resourceList)
			return
		}
		if r.Method == http.MethodDelete {
			if object, ok := cluster.objects[r.URL.Path]; ok {
				var options metav1.DeleteOptions
				data, err := io.ReadAll(r.Body)
				if err != nil {
					t.Errorf("reading delete options: %v", err)
				}
				if len(data) != 0 {
					if strings.Contains(r.Header.Get("Content-Type"), "protobuf") {
						_, _, err = scheme.Codecs.UniversalDeserializer().Decode(data, nil, &options)
					} else {
						err = json.Unmarshal(data, &options)
					}
					if err != nil {
						t.Errorf("invalid delete options: %v", err)
					}
				}
				if strings.Contains(r.URL.Path, "/daemonsets/") || strings.Contains(r.URL.Path, "/clusterrole") {
					if options.Preconditions == nil || options.Preconditions.UID == nil || *options.Preconditions.UID != object.GetUID() {
						t.Errorf("missing UID precondition deleting %s", r.URL.Path)
					}
				}
				if cluster.requireExactPreconditions && (options.Preconditions == nil || options.Preconditions.UID == nil || options.Preconditions.ResourceVersion == nil) {
					t.Errorf("missing exact delete preconditions for %s", r.URL.Path)
				}
				if p := options.Preconditions; p != nil && (p.UID != nil && *p.UID != object.GetUID() || p.ResourceVersion != nil && *p.ResourceVersion != object.GetResourceVersion()) {
					w.WriteHeader(http.StatusConflict)
					write(metav1.Status{Status: metav1.StatusFailure, Reason: metav1.StatusReasonConflict, Code: 409})
					return
				}
				if len(options.DryRun) != 0 || r.URL.Query().Get("dryRun") != "" {
					write(metav1.Status{Status: metav1.StatusSuccess})
					return
				}
				if !cluster.stuck {
					delete(cluster.objects, r.URL.Path)
				}
				cluster.deleted = append(cluster.deleted, r.URL.Path)
				cluster.deleteOptions[r.URL.Path] = options
				cluster.mutations = append(cluster.mutations, r.Method+" "+r.URL.Path)
				write(metav1.Status{Status: metav1.StatusSuccess})
				return
			}
		}
		if r.Method == http.MethodPut || r.Method == http.MethodPost {
			cluster.mutations = append(cluster.mutations, r.Method+" "+r.URL.Path)
			data, err := io.ReadAll(r.Body)
			if err != nil {
				t.Errorf("reading update: %v", err)
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			value, _, err := scheme.Codecs.UniversalDeserializer().Decode(data, nil, nil)
			if err != nil {
				t.Errorf("invalid update: %v", err)
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			fields, err := runtime.DefaultUnstructuredConverter.ToUnstructured(value)
			if err != nil {
				t.Errorf("converting update: %v", err)
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			object := unstructured.Unstructured{Object: fields}
			path := r.URL.Path
			if r.Method == http.MethodPost {
				path += "/" + object.GetName()
				if _, exists := cluster.objects[path]; exists {
					w.WriteHeader(http.StatusConflict)
					write(metav1.Status{Status: metav1.StatusFailure, Reason: metav1.StatusReasonAlreadyExists, Code: 409})
					return
				}
			}
			cluster.objects[path] = object
			write(&object)
			return
		}
		if r.Method == http.MethodGet {
			if object, ok := cluster.objects[r.URL.Path]; ok {
				write(&object)
				return
			}
			for prefix, resourceList := range resources {
				for _, resource := range resourceList.APIResources {
					collection := prefix + "/" + resource.Name
					if resource.Namespaced {
						collection = prefix + "/namespaces/gadget/" + resource.Name
					}
					if r.URL.Path != collection && !(resource.Namespaced && r.URL.Path == prefix+"/"+resource.Name) {
						continue
					}
					selector, err := labels.Parse(r.URL.Query().Get("labelSelector"))
					if err != nil {
						t.Errorf("invalid selector: %v", err)
					}
					items := []unstructured.Unstructured{}
					for path, object := range cluster.objects {
						inScope := strings.HasPrefix(path, collection+"/")
						if r.URL.Path == prefix+"/"+resource.Name && resource.Namespaced {
							inScope = strings.HasPrefix(path, prefix+"/namespaces/") && strings.Contains(path, "/"+resource.Name+"/")
						}
						if inScope && selector.Matches(labels.Set(object.GetLabels())) {
							items = append(items, object)
						}
					}
					write(map[string]any{"apiVersion": resourceList.GroupVersion, "kind": resource.Kind + "List", "items": items})
					return
				}
			}
		}
		w.WriteHeader(http.StatusNotFound)
		write(metav1.Status{Status: metav1.StatusFailure, Reason: metav1.StatusReasonNotFound, Code: 404})
	}))
	t.Cleanup(server.Close)
	t.Setenv("HELM_DRIVER", "secret")
	dir := t.TempDir()
	kubeconfig := filepath.Join(dir, "config")
	if err := os.WriteFile(kubeconfig, []byte(fmt.Sprintf(`apiVersion: v1
kind: Config
current-context: fixture
clusters:
- name: fixture
  cluster:
    server: %s
contexts:
- name: fixture
  context:
    cluster: fixture
users: []
`, server.URL)), 0600); err != nil {
		t.Fatal(err)
	}
	deployer, err := NewDeployer(&DeployConfig{Namespace: "gadget", ReleaseName: "gadget", KubeConfig: kubeconfig, KubeContext: "fixture", HelmDir: dir})
	if err != nil {
		t.Fatal(err)
	}
	return cluster, deployer
}

// fixtureUID is unique per kind, namespace and name, like real UIDs, so
// same-named objects of different kinds cannot satisfy each other's
// preconditions.
func fixtureUID(kind, namespace, name string) string {
	return strings.ToLower(kind) + "-" + namespace + "-" + name + "-uid"
}

func (c *uninstallCluster) add(path, kind, namespace, name string) {
	version := "v1"
	if strings.HasPrefix(path, "/apis/apps/") {
		version = "apps/v1"
	} else if strings.HasPrefix(path, "/apis/rbac.") {
		version = "rbac.authorization.k8s.io/v1"
	} else if strings.HasPrefix(path, "/apis/apiextensions.") {
		version = "apiextensions.k8s.io/v1"
	}
	c.objects[path] = unstructured.Unstructured{Object: map[string]any{
		"apiVersion": version, "kind": kind,
		"metadata": map[string]any{"name": name, "namespace": namespace, "uid": fixtureUID(kind, namespace, name), "resourceVersion": "1", "labels": map[string]any{"k8s-app": "gadget"}},
	}}
}

func (c *uninstallCluster) addRelease(t *testing.T, name, chartName string) {
	t.Helper()
	client := fake.NewSimpleClientset()
	secrets := client.CoreV1().Secrets("gadget")
	if err := driver.NewSecrets(secrets).Create("sh.helm.release.v1."+name+".v1", &release.Release{
		Name: name, Namespace: "gadget", Version: 1,
		Info:     &release.Info{Status: release.StatusDeployed},
		Chart:    &chart.Chart{Metadata: &chart.Metadata{Name: chartName, Version: "1.0.0"}},
		Manifest: "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: helm-owned\n  namespace: gadget\n",
	}); err != nil {
		t.Fatal(err)
	}
	list, err := secrets.List(context.Background(), metav1.ListOptions{})
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range list.Items {
		object, err := runtime.DefaultUnstructuredConverter.ToUnstructured(&secret)
		if err != nil {
			t.Fatal(err)
		}
		object["apiVersion"], object["kind"] = "v1", "Secret"
		c.objects["/api/v1/namespaces/gadget/secrets/"+secret.Name] = unstructured.Unstructured{Object: object}
	}
	c.add("/api/v1/namespaces/gadget/configmaps/helm-owned", "ConfigMap", "gadget", "helm-owned")
}

func TestUndeployFindsHelmOwner(t *testing.T) {
	cluster, deployer := newUninstallCluster(t)
	path := "/apis/apps/v1/namespaces/gadget/daemonsets/gadget"
	cluster.add(path, "DaemonSet", "gadget", "gadget")
	object := cluster.objects[path]
	object.SetAnnotations(map[string]string{"meta.helm.sh/release-name": "custom-ig", "meta.helm.sh/release-namespace": "gadget"})
	cluster.objects[path] = object
	cluster.addRelease(t, "custom-ig", "gadget")
	// Exercise Helm manifest deletion and storage purge. The full Undeploy
	// check separately rejects workloads left behind by any installer.
	if err := deployer.uninstall(context.Background()); err != nil {
		t.Fatal(err)
	}
	cluster.mu.Lock()
	defer cluster.mu.Unlock()
	if _, exists := cluster.objects["/api/v1/namespaces/gadget/secrets/sh.helm.release.v1.custom-ig.v1"]; exists {
		t.Fatal("actual Helm release was not purged")
	}
	if len(cluster.deleted) != 2 {
		t.Fatalf("expected Helm manifest deletion and release purge: %v", cluster.deleted)
	}
	if _, exists := cluster.objects[path]; !exists {
		t.Fatal("Helm uninstall fell back to deleting resources outside its manifest")
	}
}

func TestUndeployDefaultHelmRelease(t *testing.T) {
	cluster, deployer := newUninstallCluster(t)
	cluster.addRelease(t, "gadget", "gadget")
	if err := deployer.Undeploy(context.Background()); err != nil {
		t.Fatal(err)
	}
	cluster.mu.Lock()
	defer cluster.mu.Unlock()
	if len(cluster.objects) != 0 {
		t.Fatalf("default Helm release left resources: %v", cluster.objects)
	}
}

func TestUndeployPreservesNamespaceAndOtherInstallations(t *testing.T) {
	cluster, deployer := newUninstallCluster(t)
	cluster.add("/api/v1/namespaces/gadget", "Namespace", "", "gadget")
	cluster.add("/api/v1/namespaces/gadget/configmaps/unrelated", "ConfigMap", "gadget", "unrelated")
	object := cluster.objects["/api/v1/namespaces/gadget/configmaps/unrelated"]
	object.SetLabels(nil)
	cluster.objects["/api/v1/namespaces/gadget/configmaps/unrelated"] = object
	cluster.add("/apis/apps/v1/namespaces/other/daemonsets/gadget", "DaemonSet", "other", "gadget")
	cluster.add("/apis/apps/v1/namespaces/gadget/deployments/gadget", "Deployment", "gadget", "gadget")
	rbac := "/apis/rbac.authorization.k8s.io/v1/"
	for _, namespace := range []string{"gadget", "other"} {
		bindingPath := rbac + "clusterrolebindings/" + namespace
		cluster.add(bindingPath, "ClusterRoleBinding", "", namespace)
		binding := cluster.objects[bindingPath]
		binding.Object["subjects"] = []any{map[string]any{"kind": "ServiceAccount", "namespace": namespace, "name": "gadget"}}
		binding.Object["roleRef"] = map[string]any{"kind": "ClusterRole", "name": namespace}
		cluster.objects[bindingPath] = binding
		cluster.add(rbac+"clusterroles/"+namespace, "ClusterRole", "", namespace)
	}
	if err := deployer.Undeploy(context.Background()); err != nil {
		t.Fatal(err)
	}
	cluster.mu.Lock()
	defer cluster.mu.Unlock()
	if len(cluster.deleted) != 3 || len(cluster.objects) != 5 {
		t.Fatalf("incorrect removal scope: deleted %v, remaining %v", cluster.deleted, cluster.objects)
	}
}

func TestUndeployFailsClosed(t *testing.T) {
	for _, scenario := range []string{"forbidden Helm lookup", "forbidden discovery", "unrelated release", "mixed binding"} {
		t.Run(scenario, func(t *testing.T) {
			cluster, deployer := newUninstallCluster(t)
			cluster.add("/apis/apps/v1/namespaces/gadget/daemonsets/gadget", "DaemonSet", "gadget", "gadget")
			switch scenario {
			case "forbidden Helm lookup":
				cluster.deny = "/api/v1/namespaces/gadget/secrets"
			case "forbidden discovery":
				cluster.deny = "/api/v1/namespaces/gadget/configmaps"
			case "unrelated release":
				cluster.addRelease(t, "gadget", "unrelated")
			case "mixed binding":
				path := "/apis/rbac.authorization.k8s.io/v1/clusterrolebindings/shared"
				cluster.add(path, "ClusterRoleBinding", "", "shared")
				binding := cluster.objects[path]
				binding.Object["roleRef"] = map[string]any{"kind": "ClusterRole", "name": "shared"}
				binding.Object["subjects"] = []any{
					map[string]any{"kind": "ServiceAccount", "namespace": "gadget", "name": "gadget"},
					map[string]any{"kind": "ServiceAccount", "namespace": "other", "name": "gadget"},
				}
				cluster.objects[path] = binding
			}
			if err := deployer.Undeploy(context.Background()); err == nil {
				t.Fatal("expected an explicit removal error")
			}
			cluster.mu.Lock()
			defer cluster.mu.Unlock()
			if len(cluster.deleted) != 0 {
				t.Fatalf("deleted resources despite failed preflight: %v", cluster.deleted)
			}
			for progress := range deployer.GetProgressChan() {
				if progress.Progress == 100 {
					t.Fatal("reported completion after failure")
				}
			}
		})
	}
}

func TestUndeployDoesNotReportStuckDeletionAsSuccess(t *testing.T) {
	cluster, deployer := newUninstallCluster(t)
	cluster.add("/apis/apps/v1/namespaces/gadget/daemonsets/gadget", "DaemonSet", "gadget", "gadget")
	cluster.stuck = true
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	if err := deployer.Undeploy(ctx); err == nil {
		t.Fatal("reported successful removal while IG still exists")
	}
	cluster.mu.Lock()
	defer cluster.mu.Unlock()
	if len(cluster.deleted) != 1 {
		t.Fatalf("did not exercise stuck deletion: %v", cluster.deleted)
	}
}

func TestRemovalVerificationUsesSelectedContext(t *testing.T) {
	_, deployer := newUninstallCluster(t)
	contents, err := os.ReadFile(deployer.config.KubeConfig)
	if err != nil {
		t.Fatal(err)
	}
	contents = []byte(strings.Replace(string(contents), "current-context: fixture", "current-context: missing", 1))
	if err := os.WriteFile(deployer.config.KubeConfig, contents, 0600); err != nil {
		t.Fatal(err)
	}
	if err := deployer.waitForWorkloadRemoval(context.Background(), time.Second); err != nil {
		t.Fatalf("verification ignored the explicit context: %v", err)
	}
}

func TestRemovalVerificationDoesNotIgnorePermissionErrors(t *testing.T) {
	cluster, deployer := newUninstallCluster(t)
	cluster.deny = "/apis/apps/v1/namespaces/gadget/daemonsets"
	if err := deployer.waitForWorkloadRemoval(context.Background(), time.Second); err == nil {
		t.Fatal("permission denial was treated as proof of removal")
	}
}

func TestUndeployPreservesSharedClusterRole(t *testing.T) {
	cluster, deployer := newUninstallCluster(t)
	rbac := "/apis/rbac.authorization.k8s.io/v1/"
	cluster.add(rbac+"clusterroles/shared", "ClusterRole", "", "shared")
	for _, namespace := range []string{"gadget", "other"} {
		path := rbac + "clusterrolebindings/" + namespace
		cluster.add(path, "ClusterRoleBinding", "", namespace)
		object := cluster.objects[path]
		object.Object["subjects"] = []any{map[string]any{"kind": "ServiceAccount", "namespace": namespace, "name": "gadget"}}
		object.Object["roleRef"] = map[string]any{"kind": "ClusterRole", "name": "shared"}
		cluster.objects[path] = object
	}
	if err := deployer.Undeploy(context.Background()); err != nil {
		t.Fatal(err)
	}
	cluster.mu.Lock()
	defer cluster.mu.Unlock()
	if len(cluster.deleted) != 1 || cluster.deleted[0] != rbac+"clusterrolebindings/gadget" || len(cluster.objects) != 2 {
		t.Fatalf("shared RBAC was not preserved: %v", cluster.deleted)
	}
}

func TestUndeployWithoutHelmRelease(t *testing.T) {
	cluster, deployer := newUninstallCluster(t)
	path := "/apis/apps/v1/namespaces/gadget/daemonsets/gadget"
	cluster.add(path, "DaemonSet", "gadget", "gadget")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := deployer.Undeploy(ctx); err != nil {
		t.Fatalf("IG without a Helm release must be removable: %v", err)
	}
	cluster.mu.Lock()
	defer cluster.mu.Unlock()
	if _, remains := cluster.objects[path]; remains {
		t.Fatal("Undeploy reported success but left the IG DaemonSet")
	}
}

func TestLabelRemovalAppliesExactApprovalPolicy(t *testing.T) {
	const daemonSet = "/apis/apps/v1/namespaces/gadget/daemonsets/gadget"
	const configMap = "/api/v1/namespaces/gadget/configmaps/gadget"
	for _, test := range []struct {
		name    string
		change  func(*unstructured.Unstructured)
		blocked string
	}{
		{"foreign installer", func(o *unstructured.Unstructured) {
			o.SetLabels(map[string]string{"k8s-app": "gadget", "app.kubernetes.io/managed-by": "operator"})
		}, blockedForeignManager},
		{"other release", func(o *unstructured.Unstructured) {
			o.SetAnnotations(map[string]string{"meta.helm.sh/release-name": "other", "meta.helm.sh/release-namespace": "gadget"})
		}, blockedOtherRelease},
		{"foreign owner", func(o *unstructured.Unstructured) {
			o.SetOwnerReferences([]metav1.OwnerReference{{APIVersion: "v1", Kind: "ConfigMap", Name: "owner", UID: "foreign-uid"}})
		}, blockedOwnerReferences},
	} {
		t.Run(test.name, func(t *testing.T) {
			cluster, deployer := newUninstallCluster(t)
			cluster.add(daemonSet, "DaemonSet", "gadget", "gadget")
			cluster.add(configMap, "ConfigMap", "gadget", "gadget")
			object := cluster.objects[configMap]
			test.change(&object)
			cluster.objects[configMap] = object
			err := deployer.uninstall(context.Background())
			if err == nil || !strings.Contains(err.Error(), "ConfigMap gadget ("+test.blocked+")") {
				t.Fatalf("blocked object not reported: %v", err)
			}
			cluster.mu.Lock()
			defer cluster.mu.Unlock()
			if len(cluster.deleted) != 0 {
				t.Fatalf("label removal deleted resources despite a blocked object: %v", cluster.deleted)
			}
		})
	}
}

func TestLabelRemovalNamesUnavailableAPIGroups(t *testing.T) {
	cluster, deployer := newUninstallCluster(t)
	cluster.add("/apis/apps/v1/namespaces/gadget/daemonsets/gadget", "DaemonSet", "gadget", "gadget")
	cluster.unavailableGroup = "metrics.example.test"
	err := deployer.uninstall(context.Background())
	if err == nil || !strings.Contains(err.Error(), "failed for API groups metrics.example.test/v1") {
		t.Fatalf("discovery failure did not name the unavailable group: %v", err)
	}
	cluster.mu.Lock()
	defer cluster.mu.Unlock()
	if len(cluster.deleted) != 0 {
		t.Fatalf("removal proceeded with incomplete discovery: %v", cluster.deleted)
	}
}

func TestLabelRemovalPreservesKeepPolicyAndDefersOwnedObjects(t *testing.T) {
	cluster, deployer := newUninstallCluster(t)
	daemonSet := "/apis/apps/v1/namespaces/gadget/daemonsets/gadget"
	kept := "/api/v1/namespaces/gadget/configmaps/kept"
	pod := "/api/v1/namespaces/gadget/pods/gadget-abc"
	cluster.add(daemonSet, "DaemonSet", "gadget", "gadget")
	cluster.add(kept, "ConfigMap", "gadget", "kept")
	object := cluster.objects[kept]
	object.SetAnnotations(map[string]string{"helm.sh/resource-policy": "keep"})
	cluster.objects[kept] = object
	owner := cluster.objects[daemonSet]
	cluster.add(pod, "Pod", "gadget", "gadget-abc")
	object = cluster.objects[pod]
	object.SetOwnerReferences([]metav1.OwnerReference{{APIVersion: "apps/v1", Kind: "DaemonSet", Name: "gadget", UID: owner.GetUID()}})
	cluster.objects[pod] = object
	if err := deployer.uninstall(context.Background()); err != nil {
		t.Fatal(err)
	}
	cluster.mu.Lock()
	defer cluster.mu.Unlock()
	if len(cluster.deleted) != 1 || cluster.deleted[0] != daemonSet {
		t.Fatalf("expected only the owning DaemonSet to be deleted: %v", cluster.deleted)
	}
	preserved := false
	for drained := false; !drained; {
		select {
		case progress := <-deployer.GetProgressChan():
			preserved = preserved || strings.Contains(progress.Message, "Preserving ConfigMap kept")
		default:
			drained = true
		}
	}
	if !preserved {
		t.Fatal("preserved keep-policy object was not reported")
	}
}
