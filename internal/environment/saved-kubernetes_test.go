// Copyright 2026 The Inspektor Gadget authors
// SPDX-License-Identifier: Apache-2.0

package environment

import (
	"encoding/json"
	"maps"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	grpcruntime "github.com/inspektor-gadget/ig-desktop/pkg/grpc-runtime"
	"k8s.io/client-go/tools/clientcmd"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
)

func TestImportedKubernetesSourcePersistenceAndMatching(t *testing.T) {
	source := syntheticSource(t)
	t.Setenv("KUBECONFIG", filepath.Join(t.TempDir(), "missing-default"))
	dir := t.TempDir()
	storage := NewStorage(dir)
	var wg sync.WaitGroup
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := storage.ImportKubernetes(source, "second"); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	storage = NewStorage(dir)
	saved, err := storage.List()
	if err != nil || len(saved) != 1 {
		t.Fatalf("import must persist one connection: %v %v", saved, err)
	}
	env := saved[0]
	data, err := os.ReadFile(filepath.Join(dir, env.ID+".json"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), "secret") || strings.Contains(string(data), "https://") {
		t.Fatal("import copied kubeconfig credentials into environment storage")
	}
	if env.Kubeconfig == nil || *env.Kubeconfig != source || env.Params["context"] != "second" {
		t.Fatalf("import lost its source: %+v", env)
	}
	config, ns, err := ResolveKubernetesConfig(*env.Kubeconfig, env.Params["context"])
	if err != nil || config.Host != "https://second.invalid" || ns != "second-ns" {
		t.Fatalf("import used default or current context: %v %v", config, err)
	}
	registry := newTestRegistry(t)
	target, err := registry.CreateMatching(source, "second", false, storage)
	if err != nil || len(target.SavedEnvironments) != 1 || target.SavedEnvironments[0].ID != env.ID {
		t.Fatalf("imported source should match without a usable default config: %+v %v", target, err)
	}
	env.Kubeconfig = &KubeconfigSource{Kind: "default"}
	if err := storage.Set(env); err != nil {
		t.Fatal(err)
	}
	if _, _, err := registry.LookupSaved(target.ID, env.ID, storage); err == nil {
		t.Fatal("changed source did not invalidate the frozen saved pairing")
	}
}

func savedEnvironment(t *testing.T, storage *Storage, params map[string]string) *Environment {
	t.Helper()
	env := &Environment{ID: uuid.NewString(), Name: "Saved cluster", Runtime: "grpc-k8s", Params: maps.Clone(params)}
	if err := storage.Set(env); err != nil {
		t.Fatal(err)
	}
	return env
}

func TestKubernetesImportReusesOnlyUnambiguousSourceIdentity(t *testing.T) {
	source := syntheticSource(t)
	t.Setenv("KUBECONFIG", source.Path)
	storage := NewStorage(t.TempDir())
	legacy := savedEnvironment(t, storage, map[string]string{"context": "first", "gadget-namespace": "custom"})
	reused, err := storage.ImportKubernetes(KubeconfigSource{Kind: "default"}, "first")
	if err != nil || reused.ID != legacy.ID {
		t.Fatalf("same default connection not reused: %+v %v", reused, err)
	}
	explicit, err := storage.ImportKubernetes(source, "first")
	if err != nil || explicit.ID == legacy.ID {
		t.Fatalf("different source reference merged: %+v %v", explicit, err)
	}
	savedEnvironment(t, storage, map[string]string{"context": "first"})
	created, err := storage.ImportKubernetes(KubeconfigSource{Kind: "default"}, "first")
	if err != nil || created.ID == legacy.ID || created.Kubeconfig == nil {
		t.Fatalf("ambiguous legacy connection chosen: %+v %v", created, err)
	}
	found, err := storage.FindKubernetes(KubeconfigSource{Kind: "default"}, "first")
	if err != nil || found.ID != created.ID {
		t.Fatalf("explicit import did not take precedence: %+v %v", found, err)
	}
}

func TestKubeconfigPathSpellingsShareIdentity(t *testing.T) {
	source := syntheticSource(t)
	t.Setenv("KUBECONFIG", filepath.Join(t.TempDir(), "missing-default"))
	dir, file := filepath.Split(source.Path)
	unclean := KubeconfigSource{Kind: "file", Path: dir + "." + string(filepath.Separator) + string(filepath.Separator) + file}
	if unclean.Path == source.Path {
		t.Fatal("test path is already clean")
	}
	storage := NewStorage(t.TempDir())
	imported, err := storage.ImportKubernetes(unclean, "second")
	if err != nil {
		t.Fatal(err)
	}
	if imported.Kubeconfig.Path != source.Path {
		t.Fatalf("stored path not normalized: %q", imported.Kubeconfig.Path)
	}
	again, err := storage.ImportKubernetes(source, "second")
	if err != nil || again.ID != imported.ID {
		t.Fatalf("clean spelling did not reuse the import: %+v %v", again, err)
	}

	// Environments saved before normalization still match.
	legacy := &Environment{ID: uuid.NewString(), Name: "Legacy", Runtime: "grpc-k8s", Params: map[string]string{"context": "first"}, Kubeconfig: &unclean}
	if err := storage.Set(legacy); err != nil {
		t.Fatal(err)
	}
	found, err := storage.FindKubernetes(source, "first")
	if err != nil || found == nil || found.ID != legacy.ID {
		t.Fatalf("unclean saved path not matched: %+v %v", found, err)
	}
	target, err := newTestRegistry(t).CreateMatching(source, "first", false, storage)
	if err != nil || len(target.SavedEnvironments) != 1 || target.SavedEnvironments[0].ID != legacy.ID {
		t.Fatalf("unclean saved path not paired: %+v %v", target, err)
	}
}

func TestSavedKubernetesMatchCountsAndOptOut(t *testing.T) {
	for _, sourceKind := range []string{"default", "file"} {
		for _, count := range []int{0, 1, 2} {
			t.Run(sourceKind+"/"+string(rune('0'+count)), func(t *testing.T) {
				source := syntheticSource(t)
				t.Setenv("KUBECONFIG", source.Path)
				if sourceKind == "default" {
					source = KubeconfigSource{Kind: "default"}
				}
				storage := NewStorage(t.TempDir())
				for range count {
					savedEnvironment(t, storage, map[string]string{"context": "first"})
				}
				// An unusable individual storage entry is not a storage-wide failure.
				if err := os.WriteFile(filepath.Join(storage.dir, "invalid.json"), []byte("synthetic-secret"), 0600); err != nil {
					t.Fatal(err)
				}
				registry := newTestRegistry(t)
				target, err := registry.CreateMatching(source, "first", true, storage)
				if err != nil || len(target.SavedEnvironments) != count {
					t.Fatalf("match count: %+v %v", target, err)
				}
				data, err := json.Marshal(target)
				if err != nil {
					t.Fatal(err)
				}
				for _, secret := range []string{"secret", "token", "params", "https", storage.dir} {
					if strings.Contains(string(data), secret) {
						t.Fatalf("target leaks %q: %s", secret, data)
					}
				}
				if count > 0 {
					id := target.SavedEnvironments[0].ID
					target.SavedEnvironments[0].ID = "caller mutation"
					description, err := registry.Describe(target.ID)
					if err != nil || description.SavedEnvironments[0].ID != id {
						t.Fatal("registration shares returned candidate slice")
					}
					config, namespace, err := registry.LookupSaved(target.ID, id, storage)
					if err != nil || config.Host != "https://first.invalid" || namespace != "first-ns" {
						t.Fatalf("saved lookup: %v", err)
					}
				}
				plain, err := registry.Create(source, "first", true)
				if err != nil || len(plain.SavedEnvironments) != 0 {
					t.Fatalf("opt-out changed: %+v %v", plain, err)
				}
			})
		}
	}
}

func TestSavedKubernetesConnectionMatching(t *testing.T) {
	tests := []struct {
		name   string
		params map[string]string
		change func(*clientcmdapi.Config)
		match  bool
	}{
		{name: "explicit context", params: map[string]string{"context": "first"}, match: true},
		{name: "current context", match: true},
		{name: "empty overrides", params: map[string]string{"context": "", "kubeconfig": ""}, match: true},
		{name: "other current context", change: func(c *clientcmdapi.Config) { c.CurrentContext = "second" }},
		{name: "explicit despite different current namespace", params: map[string]string{"context": "first"}, change: func(c *clientcmdapi.Config) { c.CurrentContext = "second" }},
		{name: "explicit despite different current with same namespace", params: map[string]string{"context": "first"}, change: func(c *clientcmdapi.Config) {
			c.CurrentContext = "second"
			c.Contexts["second"].Namespace = "first-ns"
		}, match: true},
		{name: "other explicit context", params: map[string]string{"context": "second"}},
		{name: "server", change: func(c *clientcmdapi.Config) { c.Clusters["first"].Server = "https://other.invalid" }},
		{name: "namespace", change: func(c *clientcmdapi.Config) { c.Contexts["first"].Namespace = "other" }},
		{name: "token", change: func(c *clientcmdapi.Config) { c.AuthInfos["first"].Token = "other-secret" }},
		{name: "token file", change: func(c *clientcmdapi.Config) { c.AuthInfos["first"].TokenFile = "/synthetic/nonexistent/token" }},
		{name: "basic auth", change: func(c *clientcmdapi.Config) { c.AuthInfos["first"].Username = "other" }},
		{name: "certificate", change: func(c *clientcmdapi.Config) { c.AuthInfos["first"].ClientCertificateData = []byte("other") }},
		{name: "key", change: func(c *clientcmdapi.Config) { c.AuthInfos["first"].ClientKeyData = []byte("other") }},
		{name: "CA", change: func(c *clientcmdapi.Config) { c.Clusters["first"].CertificateAuthorityData = []byte("other") }},
		{name: "TLS name", change: func(c *clientcmdapi.Config) { c.Clusters["first"].TLSServerName = "other.invalid" }},
		{name: "TLS verification", change: func(c *clientcmdapi.Config) { c.Clusters["first"].InsecureSkipTLSVerify = true }},
		{name: "proxy", change: func(c *clientcmdapi.Config) { c.Clusters["first"].ProxyURL = "http://localhost:1234" }},
		{name: "compression", change: func(c *clientcmdapi.Config) { c.Clusters["first"].DisableCompression = true }},
		{name: "impersonation", change: func(c *clientcmdapi.Config) { c.AuthInfos["first"].Impersonate = "other" }},
		{name: "impersonation UID", change: func(c *clientcmdapi.Config) { c.AuthInfos["first"].ImpersonateUID = "other" }},
		{name: "impersonation groups", change: func(c *clientcmdapi.Config) { c.AuthInfos["first"].ImpersonateGroups = []string{"other"} }},
		{name: "impersonation extras", change: func(c *clientcmdapi.Config) {
			c.AuthInfos["first"].ImpersonateUserExtra = map[string][]string{"group": {"other"}}
		}},
		{name: "exec", change: func(c *clientcmdapi.Config) {
			c.AuthInfos["first"].Exec = &clientcmdapi.ExecConfig{Command: "never-execute-this", APIVersion: "client.authentication.k8s.io/v1", InteractiveMode: clientcmdapi.NeverExecInteractiveMode}
		}},
		{name: "auth provider", change: func(c *clientcmdapi.Config) {
			c.AuthInfos["first"].AuthProvider = &clientcmdapi.AuthProviderConfig{Name: "other"}
		}},
		{name: "gadget namespace", params: map[string]string{"gadget-namespace": "other"}},
		{name: "port", params: map[string]string{"tcp-port": "1234"}},
		{name: "timeout", params: map[string]string{"connection-timeout": "123"}},
		{name: "invalid timeout", params: map[string]string{"connection-timeout": "secret-invalid"}},
		{name: "unknown option", params: map[string]string{"unrecognized": ""}},
		{name: "kubeconfig override", params: map[string]string{"kubeconfig": "/synthetic/ignored"}},
	}
	defaults := map[string]string{}
	for _, desc := range grpcruntime.New(grpcruntime.WithConnectUsingK8SProxy).GlobalParamDescs() {
		defaults[desc.Key] = desc.DefaultValue
	}
	tests = append(tests, struct {
		name   string
		params map[string]string
		change func(*clientcmdapi.Config)
		match  bool
	}{name: "explicit defaults", params: defaults, match: true})
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			source := syntheticSource(t)
			savedSource := syntheticSource(t)
			t.Setenv("KUBECONFIG", savedSource.Path)
			config, err := loadKubeconfig(savedSource)
			if err != nil {
				t.Fatal(err)
			}
			if test.change != nil {
				test.change(config)
			}
			if err := clientcmd.WriteToFile(*config, savedSource.Path); err != nil {
				t.Fatal(err)
			}
			storage := NewStorage(t.TempDir())
			savedEnvironment(t, storage, test.params)
			target, err := newTestRegistry(t).CreateMatching(source, "first", true, storage)
			if err != nil || (len(target.SavedEnvironments) == 1) != test.match {
				t.Fatalf("matching %s: %+v %v", test.name, target, err)
			}
		})
	}
}

func TestSavedKubernetesPluginsAreNotExecuted(t *testing.T) {
	source := syntheticSource(t)
	config, err := loadKubeconfig(source)
	if err != nil {
		t.Fatal(err)
	}
	config.AuthInfos["first"].Token = ""
	config.AuthInfos["first"].Exec = &clientcmdapi.ExecConfig{
		Command: "/synthetic/nonexistent/credential-plugin", Args: []string{"synthetic-secret"},
		APIVersion: "client.authentication.k8s.io/v1", InteractiveMode: clientcmdapi.NeverExecInteractiveMode,
	}
	config.Clusters["first"].ProxyURL = "http://localhost:1234"
	if err := clientcmd.WriteToFile(*config, source.Path); err != nil {
		t.Fatal(err)
	}
	t.Setenv("KUBECONFIG", source.Path)
	storage := NewStorage(t.TempDir())
	savedEnvironment(t, storage, nil)
	target, err := newTestRegistry(t).CreateMatching(source, "first", true, storage)
	if err != nil || len(target.SavedEnvironments) != 1 {
		t.Fatalf("equal exec and proxy declarations should match without executing: %+v %v", target, err)
	}
}

func TestSavedKubernetesSnapshotAndPairValidation(t *testing.T) {
	source := syntheticSource(t)
	t.Setenv("KUBECONFIG", source.Path)
	storage := NewStorage(t.TempDir())
	env := savedEnvironment(t, storage, nil)
	registry := newTestRegistry(t)
	target, err := registry.CreateMatching(KubeconfigSource{Kind: "default"}, "first", true, storage)
	if err != nil {
		t.Fatal(err)
	}
	// Neither changing the current context nor the config file redirects lookup.
	if err := os.WriteFile(source.Path, []byte(strings.ReplaceAll(syntheticKubeconfig, "first", "changed")), 0600); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		config, ns, err := registry.LookupSaved(target.ID, env.ID, storage)
		if err != nil || config.Host != "https://first.invalid" || config.BearerToken != "first-secret" || ns != "first-ns" {
			t.Fatalf("frozen saved connection changed: %v", err)
		}
		config.BearerToken = "caller-mutation"
	}
	for _, pair := range [][2]string{{target.ID, uuid.NewString()}, {"adhoc-" + uuid.NewString(), env.ID}, {env.ID, env.ID}} {
		if _, _, err := registry.LookupSaved(pair[0], pair[1], storage); err == nil {
			t.Fatal("invalid identity/handle pair accepted")
		}
	}
	env.Name = "renamed"
	if err := storage.Set(env); err != nil {
		t.Fatal(err)
	}
	if _, _, err := registry.LookupSaved(target.ID, env.ID, storage); err != nil {
		t.Fatal("display-only edit invalidated connection")
	}
	env.Params = map[string]string{"context": "first"}
	if err := storage.Set(env); err != nil {
		t.Fatal(err)
	}
	if _, _, err := registry.LookupSaved(target.ID, env.ID, storage); err == nil {
		t.Fatal("edited connection params accepted")
	}
	env.Params = nil
	env.Runtime = "grpc-ig"
	if err := storage.Set(env); err != nil {
		t.Fatal(err)
	}
	if _, _, err := registry.LookupSaved(target.ID, env.ID, storage); err == nil {
		t.Fatal("edited runtime accepted")
	}
	if err := storage.Delete(env); err != nil {
		t.Fatal(err)
	}
	if _, _, err := registry.LookupSaved(target.ID, env.ID, storage); err == nil {
		t.Fatal("deleted environment accepted")
	}
	env.Runtime = "grpc-k8s"
	if err := storage.Set(env); err != nil {
		t.Fatal(err)
	}
	registry.mu.Lock()
	expired := registry.targets[target.ID]
	expired.ExpiresAt = time.Now().Add(-time.Second).UnixMilli()
	registry.targets[target.ID] = expired
	registry.mu.Unlock()
	if _, _, err := registry.LookupSaved(target.ID, env.ID, storage); err == nil {
		t.Fatal("expired registration accepted")
	}
}

func TestSavedKubernetesStorageFailuresAndCurrentContextGuard(t *testing.T) {
	source := syntheticSource(t)
	t.Setenv("KUBECONFIG", source.Path)
	registry := newTestRegistry(t)
	storage := NewStorage(filepath.Join(t.TempDir(), "missing-secret-directory"))
	if _, err := registry.CreateMatching(source, "first", true, storage); err == nil || strings.Contains(err.Error(), "secret") {
		t.Fatalf("storage-wide failure ignored or leaked: %v", err)
	}
	if len(registry.targets) != 0 {
		t.Fatal("failed matching left a registration")
	}
	if _, err := registry.CreateMatching(source, "first", true, nil); err == nil {
		t.Fatal("missing storage accepted")
	}
	storage = NewStorage(t.TempDir())
	env := savedEnvironment(t, storage, map[string]string{"context": "second"})
	if _, err := registry.CreateMatching(source, "second", true, storage); err == nil || !strings.Contains(err.Error(), "context changed") {
		t.Fatal("matching bypassed active-context guard")
	}
	env.Runtime = "grpc-ig"
	if err := storage.Set(env); err != nil {
		t.Fatal(err)
	}
	target, err := registry.CreateMatching(source, "second", false, storage)
	if err != nil || len(target.SavedEnvironments) != 0 {
		t.Fatalf("different runtime matched: %+v %v", target, err)
	}
}
