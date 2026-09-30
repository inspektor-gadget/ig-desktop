// Copyright 2026 The Inspektor Gadget authors
// SPDX-License-Identifier: Apache-2.0

package environment

import (
	"context"
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/google/uuid"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
)

const (
	transientLease = 5 * time.Minute
	transientLimit = 64
)

type KubeconfigSource struct {
	Kind string `json:"kind"`
	Path string `json:"path,omitempty"`
}

type KubernetesContext struct {
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
}

type KubernetesContexts struct {
	Contexts       []KubernetesContext `json:"contexts"`
	CurrentContext string              `json:"currentContext"`
}

type KubernetesTarget struct {
	ID                string                       `json:"id"`
	Name              string                       `json:"name"`
	Runtime           string                       `json:"runtime"`
	Namespace         string                       `json:"namespace"`
	ExpiresAt         int64                        `json:"expiresAt"`
	SavedEnvironments []SavedKubernetesEnvironment `json:"savedEnvironments,omitempty"`
}

type transientTarget struct {
	KubernetesTarget
	config *rest.Config
	saved  map[string]*Environment
}

// TransientKubernetes holds process-local registrations, not running runtimes.
type TransientKubernetes struct {
	ctx     context.Context
	mu      sync.Mutex
	targets map[string]transientTarget
}

func NewTransientKubernetes(ctx context.Context) *TransientKubernetes {
	r := &TransientKubernetes{ctx: ctx, targets: make(map[string]transientTarget)}
	go func() {
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				r.mu.Lock()
				clear(r.targets)
				r.mu.Unlock()
				return
			case now := <-ticker.C:
				r.mu.Lock()
				r.sweep(now)
				r.mu.Unlock()
			}
		}
	}()
	return r
}

func IsTransientID(id string) bool { return strings.HasPrefix(id, "adhoc-") }

func validateTransientID(id string) error {
	if !IsTransientID(id) {
		return fmt.Errorf("invalid transient Kubernetes target ID")
	}
	value := strings.TrimPrefix(id, "adhoc-")
	parsed, err := uuid.Parse(value)
	if err != nil || parsed.String() != value {
		return fmt.Errorf("invalid transient Kubernetes target ID")
	}
	return nil
}

func loadKubeconfig(source KubeconfigSource) (*clientcmdapi.Config, error) {
	rules := clientcmd.NewDefaultClientConfigLoadingRules()
	switch source.Kind {
	case "default":
		if source.Path != "" {
			return nil, fmt.Errorf("default kubeconfig must not specify a path")
		}
	case "file":
		if !filepath.IsAbs(source.Path) {
			return nil, fmt.Errorf("kubeconfig file path must be absolute")
		}
		rules.ExplicitPath = source.Path
	default:
		return nil, fmt.Errorf("invalid kubeconfig source kind")
	}
	config, err := rules.Load()
	if err != nil {
		// Parser errors can contain raw kubeconfig input, including credentials.
		return nil, fmt.Errorf("could not load selected kubeconfig")
	}
	return config, nil
}

func ListKubernetesContexts(source KubeconfigSource) (*KubernetesContexts, error) {
	config, err := loadKubeconfig(source)
	if err != nil {
		return nil, err
	}
	result := &KubernetesContexts{
		Contexts: make([]KubernetesContext, 0, len(config.Contexts)),
	}
	for name, ctx := range config.Contexts {
		if name == "" || ctx == nil || !safeContextText(name) || !safeContextText(ctx.Namespace) {
			continue
		}
		namespace := ctx.Namespace
		if namespace == "" {
			namespace = "default"
		}
		result.Contexts = append(result.Contexts, KubernetesContext{name, namespace})
		if name == config.CurrentContext {
			result.CurrentContext = name
		}
	}
	sort.Slice(result.Contexts, func(i, j int) bool { return result.Contexts[i].Name < result.Contexts[j].Name })
	return result, nil
}

func safeContextText(value string) bool {
	return strings.IndexFunc(value, func(r rune) bool { return !unicode.IsPrint(r) }) == -1
}

func ResolveKubernetesConfig(source KubeconfigSource, name string) (*rest.Config, string, error) {
	config, err := loadKubeconfig(source)
	if err != nil {
		return nil, "", err
	}
	return resolveKubernetesConfig(config, name)
}

func resolveKubernetesConfig(config *clientcmdapi.Config, name string) (*rest.Config, string, error) {
	selected := config.Contexts[name]
	if name == "" || selected == nil {
		return nil, "", fmt.Errorf("selected Kubernetes context does not exist")
	}
	if !safeContextText(name) || !safeContextText(selected.Namespace) {
		return nil, "", fmt.Errorf("selected Kubernetes context has unsafe display text")
	}
	// Loading rules resolve relative certificate and exec paths. Direct loading
	// avoids in-cluster fallback and never executes credential plugins here.
	client := clientcmd.NewNonInteractiveClientConfig(*config, name, &clientcmd.ConfigOverrides{CurrentContext: name}, nil)
	resolved, err := client.ClientConfig()
	if err != nil {
		return nil, "", fmt.Errorf("could not resolve selected Kubernetes context")
	}
	resolved.AuthConfigPersister = nil
	namespace, _, err := client.Namespace()
	if err != nil {
		return nil, "", fmt.Errorf("could not resolve selected Kubernetes namespace")
	}
	return resolved, namespace, nil
}

func (r *TransientKubernetes) Create(source KubeconfigSource, name string, requireCurrentContext bool) (*KubernetesTarget, error) {
	return r.create(source, name, requireCurrentContext, nil)
}

// CreateMatching binds eligible saved identities to the same snapshot as Create.
func (r *TransientKubernetes) CreateMatching(source KubeconfigSource, name string, requireCurrentContext bool, storage *Storage) (*KubernetesTarget, error) {
	if storage == nil {
		return nil, fmt.Errorf("saved environment storage is unavailable")
	}
	return r.create(source, name, requireCurrentContext, storage)
}

func (r *TransientKubernetes) create(source KubeconfigSource, name string, requireCurrentContext bool, storage *Storage) (*KubernetesTarget, error) {
	if err := r.ctx.Err(); err != nil {
		return nil, err
	}
	config, err := loadKubeconfig(source)
	if err != nil {
		return nil, err
	}
	if requireCurrentContext && (name == "" || config.CurrentContext != name) {
		return nil, fmt.Errorf("active Kubernetes context changed while preparing the target; retry from the Kubernetes explorer")
	}
	resolved, namespace, err := resolveKubernetesConfig(config, name)
	if err != nil {
		return nil, err
	}
	var saved map[string]*Environment
	if storage != nil {
		saved, err = matchSavedKubernetes(storage, source, config, name, namespace)
		if err != nil {
			return nil, err
		}
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := r.ctx.Err(); err != nil {
		clear(r.targets)
		return nil, err
	}
	now := time.Now()
	r.sweep(now)
	if len(r.targets) >= transientLimit {
		return nil, fmt.Errorf("transient Kubernetes target limit reached")
	}
	target := KubernetesTarget{
		ID: "adhoc-" + uuid.NewString(), Name: name, Runtime: "grpc-k8s",
		Namespace: namespace, ExpiresAt: now.Add(transientLease).UnixMilli(),
	}
	for _, env := range saved {
		target.SavedEnvironments = append(target.SavedEnvironments, SavedKubernetesEnvironment{ID: env.ID, Name: env.Name})
	}
	sort.Slice(target.SavedEnvironments, func(i, j int) bool {
		if target.SavedEnvironments[i].Name == target.SavedEnvironments[j].Name {
			return target.SavedEnvironments[i].ID < target.SavedEnvironments[j].ID
		}
		return target.SavedEnvironments[i].Name < target.SavedEnvironments[j].Name
	})
	r.targets[target.ID] = transientTarget{KubernetesTarget: target, config: resolved, saved: saved}
	target.SavedEnvironments = append([]SavedKubernetesEnvironment(nil), target.SavedEnvironments...)
	return &target, nil
}

func (r *TransientKubernetes) sweep(now time.Time) {
	for id, target := range r.targets {
		if target.ExpiresAt <= now.UnixMilli() {
			delete(r.targets, id)
		}
	}
}

// Describe returns an owned copy of safe display metadata, without credentials
// or source paths. It does not reload the kubeconfig used to freeze the target.
func (r *TransientKubernetes) Describe(id string) (*KubernetesTarget, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	target, err := r.lookup(id)
	if err != nil {
		return nil, err
	}
	description := target.KubernetesTarget
	description.SavedEnvironments = append([]SavedKubernetesEnvironment(nil), description.SavedEnvironments...)
	return &description, nil
}

// Lookup returns an owned config snapshot. Expiry/release does not affect it.
func (r *TransientKubernetes) Lookup(id string) (*rest.Config, string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	target, err := r.lookup(id)
	if err != nil {
		return nil, "", err
	}
	return copyTransientConfig(target.config), target.Namespace, nil
}

func (r *TransientKubernetes) lookup(id string) (transientTarget, error) {
	if err := validateTransientID(id); err != nil {
		return transientTarget{}, err
	}
	if err := r.ctx.Err(); err != nil {
		clear(r.targets)
		return transientTarget{}, err
	}
	r.sweep(time.Now())
	target, ok := r.targets[id]
	if !ok {
		return transientTarget{}, fmt.Errorf("unknown or expired transient Kubernetes target")
	}
	return target, nil
}

func (r *TransientKubernetes) Touch(id string) (int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	target, err := r.lookup(id)
	if err != nil {
		return 0, err
	}
	target.ExpiresAt = time.Now().Add(transientLease).UnixMilli()
	r.targets[id] = target
	return target.ExpiresAt, nil
}

func (r *TransientKubernetes) Release(id string) (bool, error) {
	if err := validateTransientID(id); err != nil {
		return false, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.ctx.Err() != nil {
		clear(r.targets)
	}
	r.sweep(time.Now())
	_, found := r.targets[id]
	delete(r.targets, id)
	return found, nil
}

func copyTransientConfig(config *rest.Config) *rest.Config {
	// rest.CopyConfig shares credential slices and exec/auth provider pointers.
	owned := *config
	owned.ExecProvider = config.ExecProvider.DeepCopy()
	owned.AuthProvider = config.AuthProvider.DeepCopy()
	result := rest.CopyConfig(&owned)
	result.CAData = append([]byte(nil), config.CAData...)
	result.CertData = append([]byte(nil), config.CertData...)
	result.KeyData = append([]byte(nil), config.KeyData...)
	result.NextProtos = append([]string(nil), config.NextProtos...)
	result.Impersonate.Groups = append([]string(nil), config.Impersonate.Groups...)
	if config.Impersonate.Extra != nil {
		result.Impersonate.Extra = make(map[string][]string, len(config.Impersonate.Extra))
		for key, values := range config.Impersonate.Extra {
			result.Impersonate.Extra[key] = append([]string(nil), values...)
		}
	}
	return result
}
