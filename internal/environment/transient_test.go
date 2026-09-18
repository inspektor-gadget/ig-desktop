// Copyright 2026 The Inspektor Gadget authors
// SPDX-License-Identifier: Apache-2.0

package environment

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"k8s.io/client-go/rest"
)

const syntheticKubeconfig = `apiVersion: v1
kind: Config
current-context: first
clusters:
- name: first
  cluster:
    server: https://first.invalid
- name: second
  cluster:
    server: https://second.invalid
contexts:
- name: first
  context:
    cluster: first
    user: first
    namespace: first-ns
- name: second
  context:
    cluster: second
    user: second
    namespace: second-ns
- name: empty-namespace
  context:
    cluster: first
users:
- name: first
  user:
    token: first-secret
- name: second
  user:
    token: second-secret
`

func syntheticSource(t *testing.T) KubeconfigSource {
	t.Helper()
	path := filepath.Join(t.TempDir(), "config")
	if err := os.WriteFile(path, []byte(syntheticKubeconfig), 0o600); err != nil {
		t.Fatal(err)
	}
	return KubeconfigSource{Kind: "file", Path: path}
}

func newTestRegistry(t *testing.T) *TransientKubernetes {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	return NewTransientKubernetes(ctx)
}

func TestTransientContextSelectionAndFreeze(t *testing.T) {
	source := syntheticSource(t)
	t.Setenv("KUBECONFIG", filepath.Join(t.TempDir(), "not-the-selected-config"))
	r := newTestRegistry(t)
	first, err := r.Create(source, "first", false)
	if err != nil {
		t.Fatal(err)
	}
	second, err := r.Create(source, "second", false)
	if err != nil {
		t.Fatal(err)
	}
	fallback, err := r.Create(source, "empty-namespace", false)
	if err != nil || fallback.Namespace != "default" {
		t.Fatalf("empty namespace: %+v %v", fallback, err)
	}
	if first.ID == second.ID || !IsTransientID(first.ID) || first.Runtime != "grpc-k8s" ||
		first.Namespace != "first-ns" || second.Namespace != "second-ns" ||
		second.Name != "second" || second.ExpiresAt <= time.Now().UnixMilli() {
		t.Fatalf("incorrect metadata: %+v %+v", first, second)
	}
	// Existing registrations never reload kubeconfig after selection.
	if err := os.WriteFile(source.Path, []byte("not a kubeconfig"), 0o600); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		id, host, token, namespace string
	}{
		{first.ID, "https://first.invalid", "first-secret", "first-ns"},
		{second.ID, "https://second.invalid", "second-secret", "second-ns"},
	} {
		config, namespace, err := r.Lookup(tc.id)
		if err != nil || config.Host != tc.host || config.BearerToken != tc.token || namespace != tc.namespace {
			t.Fatalf("wrong frozen config for %s: %v", tc.id, err)
		}
		config.Host = "https://mutated.invalid"
		again, _, err := r.Lookup(tc.id)
		if err != nil || again.Host != tc.host {
			t.Fatal("caller changed registration")
		}
	}
	releasedConfig, _, err := r.Lookup(first.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := r.Release(first.ID); err != nil {
		t.Fatal(err)
	}
	if releasedConfig.Host != "https://first.invalid" {
		t.Fatal("release modified caller-owned config")
	}
	files, err := os.ReadDir(filepath.Dir(source.Path))
	if err != nil || len(files) != 1 || files[0].Name() != "config" {
		t.Fatalf("registration persisted files: %v %v", files, err)
	}
}

func TestTransientContextDiscoveryAndStrictSources(t *testing.T) {
	source := syntheticSource(t)
	t.Setenv("KUBECONFIG", source.Path)
	contexts, err := ListKubernetesContexts(KubeconfigSource{Kind: "default"})
	if err != nil || contexts.CurrentContext != "first" || len(contexts.Contexts) != 3 {
		t.Fatalf("contexts: %+v %v", contexts, err)
	}
	if contexts.Contexts[0].Namespace != "default" || contexts.Contexts[2].Namespace != "second-ns" {
		t.Fatalf("wrong namespace defaults: %+v", contexts.Contexts)
	}
	data, err := json.Marshal(contexts)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"token", "secret", "cluster", "user", "certificate", "https"} {
		if bytes.Contains(data, []byte(forbidden)) {
			t.Fatalf("discovery leaked %s", forbidden)
		}
	}
	r := newTestRegistry(t)
	if _, err := r.Create(KubeconfigSource{Kind: "default"}, "second", false); err != nil {
		t.Fatal(err)
	}
	for _, invalid := range []KubeconfigSource{
		{}, {Kind: "file", Path: "relative"},
		{Kind: "file", Path: filepath.Join(filepath.Dir(source.Path), "missing")},
		{Kind: "default", Path: source.Path},
		{Kind: "unexpected", Path: source.Path},
	} {
		if _, err := r.Create(invalid, "second", false); err == nil {
			t.Fatalf("invalid source fell back to defaults: %+v", invalid)
		}
	}
	for _, invalid := range []string{"", "missing"} {
		if _, err := r.Create(source, invalid, false); err == nil {
			t.Fatalf("invalid context fell back to current context: %q", invalid)
		}
	}
	contents, err := os.ReadFile(source.Path)
	if err != nil || string(contents) != syntheticKubeconfig {
		t.Fatal("kubeconfig was rewritten")
	}
	if os.Getenv("KUBECONFIG") != source.Path {
		t.Fatal("KUBECONFIG was mutated")
	}
}

func TestTransientRequiresCurrentContextAndKeepsSnapshot(t *testing.T) {
	source := syntheticSource(t)
	r := newTestRegistry(t)
	contexts, err := ListKubernetesContexts(source)
	if err != nil {
		t.Fatal(err)
	}
	target, err := r.Create(source, contexts.CurrentContext, true)
	if err != nil {
		t.Fatal(err)
	}
	changed := strings.Replace(syntheticKubeconfig, "current-context: first", "current-context: second", 1)
	if err := os.WriteFile(source.Path, []byte(changed), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := r.Create(source, contexts.CurrentContext, true); err == nil || !strings.Contains(err.Error(), "context changed") {
		t.Fatalf("stale current context accepted: %v", err)
	}
	if len(r.targets) != 1 {
		t.Fatal("rejected selection created a registration")
	}
	config, namespace, err := r.Lookup(target.ID)
	if err != nil || config.Host != "https://first.invalid" || namespace != "first-ns" {
		t.Fatalf("current-context switch retargeted registration: %v", err)
	}
	second, err := r.Create(source, "second", true)
	if err != nil || second.Name != "second" {
		t.Fatalf("new active context rejected: %+v %v", second, err)
	}
	for _, invalid := range []string{"", "missing"} {
		changed := strings.Replace(syntheticKubeconfig, "current-context: first", "current-context: "+invalid, 1)
		if err := os.WriteFile(source.Path, []byte(changed), 0o600); err != nil {
			t.Fatal(err)
		}
		if _, err := r.Create(source, invalid, true); err == nil {
			t.Fatalf("invalid active context accepted: %q", invalid)
		}
	}
}

func TestTransientRelativeCredentialPaths(t *testing.T) {
	source := syntheticSource(t)
	dir := filepath.Dir(source.Path)
	config := `apiVersion: v1
kind: Config
clusters:
- name: cluster
  cluster:
    server: https://unused.invalid
    certificate-authority: ca.pem
contexts:
- name: selected
  context:
    cluster: cluster
    user: selected
users:
- name: selected
  user:
    client-certificate: cert.pem
    client-key: key.pem
    exec:
      apiVersion: client.authentication.k8s.io/v1
      command: ./never-execute
      interactiveMode: Never
`
	for _, file := range []string{"ca.pem", "cert.pem", "key.pem"} {
		if err := os.WriteFile(filepath.Join(dir, file), []byte("synthetic"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(source.Path, []byte(config), 0o600); err != nil {
		t.Fatal(err)
	}
	r := newTestRegistry(t)
	target, err := r.Create(source, "selected", false)
	if err != nil {
		t.Fatal(err)
	}
	resolved, _, err := r.Lookup(target.ID)
	if err != nil {
		t.Fatal(err)
	}
	if resolved.CAFile != filepath.Join(dir, "ca.pem") ||
		resolved.CertFile != filepath.Join(dir, "cert.pem") ||
		resolved.KeyFile != filepath.Join(dir, "key.pem") ||
		resolved.ExecProvider.Command != filepath.Join(dir, "never-execute") {
		t.Fatal("credential paths did not resolve relative to their source")
	}
	resolved.ExecProvider.Command = "mutated"
	again, _, err := r.Lookup(target.ID)
	if err != nil || again.ExecProvider.Command != filepath.Join(dir, "never-execute") {
		t.Fatal("exec config was shared")
	}
	// Neither registration nor discovery may run the (nonexistent) plugin.
	if _, err := ListKubernetesContexts(source); err != nil {
		t.Fatal(err)
	}
}

func TestTransientDiscoverySanitizesMalformedInput(t *testing.T) {
	source := syntheticSource(t)
	r := newTestRegistry(t)
	bad := strings.ReplaceAll(syntheticKubeconfig, "second-ns", `"unsafe\nnamespace"`)
	if err := os.WriteFile(source.Path, []byte(bad), 0o600); err != nil {
		t.Fatal(err)
	}
	contexts, err := ListKubernetesContexts(source)
	if err != nil || len(contexts.Contexts) != 2 {
		t.Fatalf("unsafe context included: %+v %v", contexts, err)
	}
	if _, err := r.Create(source, "second", false); err == nil {
		t.Fatal("unsafe metadata accepted")
	}
	if err := os.WriteFile(source.Path, []byte("users: [secret-token"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := ListKubernetesContexts(source); err == nil || strings.Contains(err.Error(), "secret-token") {
		t.Fatalf("parser diagnostics must not expose kubeconfig: %v", err)
	}
}

type refreshingTransientAuthProvider struct {
	config    map[string]string
	persister rest.AuthProviderConfigPersister
}

func (p *refreshingTransientAuthProvider) WrapTransport(rt http.RoundTripper) http.RoundTripper {
	return rt
}

func (p *refreshingTransientAuthProvider) Login() error {
	p.config["access-token"] = "synthetic-refreshed-token"
	return p.persister.Persist(p.config)
}

func TestTransientAuthProviderRefreshDoesNotPersist(t *testing.T) {
	source := syntheticSource(t)
	providerName := "synthetic-refresh-" + uuid.NewString()
	config := strings.Replace(syntheticKubeconfig, "token: first-secret", `auth-provider:
      name: `+providerName+`
      config:
        access-token: synthetic-original-token`, 1)
	if err := os.WriteFile(source.Path, []byte(config), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("KUBECONFIG", source.Path)
	if err := rest.RegisterAuthProviderPlugin(providerName, func(_ string, config map[string]string, persister rest.AuthProviderConfigPersister) (rest.AuthProvider, error) {
		return &refreshingTransientAuthProvider{config: config, persister: persister}, nil
	}); err != nil {
		t.Fatal(err)
	}
	r := newTestRegistry(t)
	for _, selectedSource := range []KubeconfigSource{source, {Kind: "default"}} {
		target, err := r.Create(selectedSource, "first", false)
		if err != nil {
			t.Fatal(err)
		}
		resolved, _, err := r.Lookup(target.ID)
		if err != nil {
			t.Fatal(err)
		}
		if resolved.AuthConfigPersister != nil {
			t.Fatal("transient config retained a persistent auth-provider writer")
		}
		// Exercise client-go's nil-to-no-op behavior, with an in-process fake
		// provider only: no credential helper, server, or cluster is contacted.
		provider, err := rest.GetAuthProvider(resolved.Host, resolved.AuthProvider, resolved.AuthConfigPersister)
		if err != nil {
			t.Fatal(err)
		}
		if err := provider.Login(); err != nil {
			t.Fatalf("in-memory refresh failed: %v", err)
		}
		if resolved.AuthProvider.Config["access-token"] != "synthetic-refreshed-token" {
			t.Fatal("refresh was not retained in the client's in-memory config")
		}
		frozen, _, err := r.Lookup(target.ID)
		if err != nil {
			t.Fatal(err)
		}
		if frozen.AuthProvider.Config["access-token"] != "synthetic-original-token" {
			t.Fatal("refresh mutated the frozen registration")
		}
		contents, err := os.ReadFile(source.Path)
		if err != nil || string(contents) != config {
			t.Fatal("auth refresh rewrote the kubeconfig")
		}
		files, err := os.ReadDir(filepath.Dir(source.Path))
		if err != nil || len(files) != 1 || files[0].Name() != "config" {
			t.Fatalf("auth refresh persisted additional files: %v %v", files, err)
		}
	}
}

func TestTransientLeaseAndCleanup(t *testing.T) {
	source := syntheticSource(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	r := NewTransientKubernetes(ctx)
	target, err := r.Create(source, "second", false)
	if err != nil {
		t.Fatal(err)
	}
	r.mu.Lock()
	entry := r.targets[target.ID]
	entry.ExpiresAt = time.Now().Add(time.Second).UnixMilli()
	r.targets[target.ID] = entry
	r.mu.Unlock()
	if expiry, err := r.Touch(target.ID); err != nil || expiry < time.Now().Add(4*time.Minute).UnixMilli() {
		t.Fatalf("lease not renewed: %d %v", expiry, err)
	}
	for _, id := range []string{"adhoc-" + uuid.NewString(), "adhoc-invalid", "saved-id"} {
		if _, _, err := r.Lookup(id); err == nil {
			t.Fatalf("unknown target accepted: %s", id)
		}
		if _, err := r.Touch(id); err == nil {
			t.Fatalf("unknown touch accepted: %s", id)
		}
	}
	if _, err := r.Release("adhoc-invalid"); err == nil {
		t.Fatal("invalid release accepted")
	}
	if released, err := r.Release(target.ID); err != nil || !released {
		t.Fatalf("release: %t %v", released, err)
	}
	if released, err := r.Release(target.ID); err != nil || released {
		t.Fatalf("second release: %t %v", released, err)
	}
	if _, _, err := r.Lookup(target.ID); err == nil {
		t.Fatal("released target accepted")
	}
	target, err = r.Create(source, "first", false)
	if err != nil {
		t.Fatal(err)
	}
	r.mu.Lock()
	entry = r.targets[target.ID]
	entry.ExpiresAt = time.Now().Add(-time.Second).UnixMilli()
	r.targets[target.ID] = entry
	r.mu.Unlock()
	if _, _, err := r.Lookup(target.ID); err == nil {
		t.Fatal("expired target accepted")
	}
	if _, err := r.Touch(target.ID); err == nil {
		t.Fatal("expired target renewed")
	}
	if released, err := r.Release(target.ID); err != nil || released {
		t.Fatalf("expired release: %t %v", released, err)
	}
	for range transientLimit {
		if _, err := r.Create(source, "first", false); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := r.Create(source, "first", false); err == nil || !strings.Contains(err.Error(), "limit") {
		t.Fatalf("limit not enforced: %v", err)
	}
	r.mu.Lock()
	r.sweep(time.Now().Add(transientLease + time.Second))
	if len(r.targets) != 0 {
		t.Fatal("expiry sweep retained registrations")
	}
	r.mu.Unlock()
	target, err = r.Create(source, "first", false)
	if err != nil {
		t.Fatal(err)
	}
	cancel()
	deadline := time.Now().Add(time.Second)
	for {
		r.mu.Lock()
		count := len(r.targets)
		r.mu.Unlock()
		if count == 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("cancellation did not clear registrations")
		}
		time.Sleep(time.Millisecond)
	}
	if _, _, err := r.Lookup(target.ID); err == nil {
		t.Fatal("lookup after cancellation accepted")
	}
	if _, err := r.Create(source, "first", false); err == nil {
		t.Fatal("registration after cancellation accepted")
	}
}
