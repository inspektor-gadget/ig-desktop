// Copyright 2026 The Inspektor Gadget authors
// SPDX-License-Identifier: Apache-2.0

package environment

import (
	"fmt"
	"maps"
	"reflect"

	"github.com/google/uuid"
	grpcruntime "github.com/inspektor-gadget/ig-desktop/pkg/grpc-runtime"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
)

type SavedKubernetesEnvironment struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// ImportKubernetes persists only a source reference and explicit context, never
// copied credentials. Repeated imports reuse the same saved connection.
func (s *Storage) ImportKubernetes(source KubeconfigSource, name string) (*Environment, error) {
	if _, _, err := ResolveKubernetesConfig(source, name); err != nil {
		return nil, err
	}
	s.importMu.Lock()
	defer s.importMu.Unlock()
	environments, err := s.List()
	if err != nil {
		return nil, fmt.Errorf("could not list saved environments")
	}
	for _, env := range environments {
		if env.Runtime != "grpc-k8s" || env.Params["context"] != name || uuid.Validate(env.ID) != nil {
			continue
		}
		if env.Kubeconfig != nil && *env.Kubeconfig == source {
			return env, nil
		}
	}
	env := &Environment{
		Name: name, Runtime: "grpc-k8s", Params: map[string]string{"context": name}, Kubeconfig: &source,
	}
	if err := s.Add(env); err != nil {
		return nil, err
	}
	return env, nil
}

// Compare declarative, locally resolved configuration, not rest.Config: its
// proxy function is not comparable. Loading rules resolve file/exec paths; no
// credential plugin is run and no external credential contents are compared.
func sameKubernetesContext(a, b *clientcmdapi.Config, name string) bool {
	ac, bc := a.Contexts[name], b.Contexts[name]
	if ac == nil || bc == nil {
		return false
	}
	ac, bc = ac.DeepCopy(), bc.DeepCopy()
	ac.LocationOfOrigin, bc.LocationOfOrigin = "", ""
	if ac.Namespace == "" {
		ac.Namespace = "default"
	}
	if bc.Namespace == "" {
		bc.Namespace = "default"
	}
	if !reflect.DeepEqual(ac, bc) {
		return false
	}
	acl, bcl := a.Clusters[ac.Cluster], b.Clusters[bc.Cluster]
	if acl == nil || bcl == nil {
		return false
	}
	acl, bcl = acl.DeepCopy(), bcl.DeepCopy()
	acl.LocationOfOrigin, bcl.LocationOfOrigin = "", ""
	if !reflect.DeepEqual(acl, bcl) {
		return false
	}
	aa, ba := a.AuthInfos[ac.AuthInfo], b.AuthInfos[bc.AuthInfo]
	if aa == nil || ba == nil {
		return aa == nil && ba == nil && ac.AuthInfo == ""
	}
	aa, ba = aa.DeepCopy(), ba.DeepCopy()
	aa.LocationOfOrigin, ba.LocationOfOrigin = "", ""
	return reflect.DeepEqual(aa, ba)
}

func matchSavedKubernetes(storage *Storage, source KubeconfigSource, frozen *clientcmdapi.Config, name, namespace string) (map[string]*Environment, error) {
	environments, err := storage.List()
	if err != nil {
		return nil, fmt.Errorf("could not list saved environments")
	}
	matches := make(map[string]*Environment)
	// Legacy saved runtimes use default loading rules. Imported connections
	// explicitly retain their source and use their selected context's namespace.
	savedConfig := frozen
	if source.Kind != "default" {
		savedConfig, err = loadKubeconfig(KubeconfigSource{Kind: "default"})
	}
	// RuntimeFactory currently gets its gadget namespace default from the
	// active context, even for an explicit saved context. Do not silently change
	// that default when reusing a saved identity through the selected snapshot.
	var savedNamespace string
	if err == nil {
		defaultClient := clientcmd.NewNonInteractiveClientConfig(*savedConfig, "", &clientcmd.ConfigOverrides{}, nil)
		savedNamespace, _, _ = defaultClient.Namespace()
	}
	defaults := grpcruntime.New(grpcruntime.WithConnectUsingK8SProxy).GlobalParamDescs()
	for _, env := range environments {
		if env.Runtime != "grpc-k8s" || uuid.Validate(env.ID) != nil || !safeContextText(env.Name) {
			continue
		}
		candidateConfig, candidateNamespace := savedConfig, savedNamespace
		if env.Kubeconfig != nil {
			if *env.Kubeconfig == source {
				candidateConfig = frozen
			} else {
				candidateConfig, err = loadKubeconfig(*env.Kubeconfig)
				if err != nil {
					continue
				}
			}
			selected := candidateConfig.Contexts[env.Params["context"]]
			if selected == nil {
				continue
			}
			candidateNamespace = selected.Namespace
			if candidateNamespace == "" {
				candidateNamespace = "default"
			}
		}
		if candidateConfig == nil || candidateNamespace != namespace {
			continue
		}
		supported := true
		for key, value := range env.Params {
			switch key {
			case "context":
			case "kubeconfig":
				// RuntimeFactory currently ignores this while completions use it.
				supported = supported && value == ""
			default:
				found := false
				for _, desc := range defaults {
					if key == desc.Key && value == desc.DefaultValue {
						found = true
						break
					}
				}
				supported = supported && found
			}
		}
		contextName := env.Params["context"]
		if contextName == "" {
			contextName = candidateConfig.CurrentContext
		}
		if !supported || contextName != name || !sameKubernetesContext(frozen, candidateConfig, name) {
			continue
		}
		owned := *env
		owned.Params = maps.Clone(env.Params)
		if env.Kubeconfig != nil {
			sourceCopy := *env.Kubeconfig
			owned.Kubeconfig = &sourceCopy
		}
		matches[env.ID] = &owned
	}
	return matches, nil
}

// LookupSaved validates the identity/handle pair and saved connection params,
// then returns an owned frozen config. It never reloads kubeconfig.
func (r *TransientKubernetes) LookupSaved(targetID, environmentID string, storage *Storage) (*rest.Config, string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	target, err := r.lookup(targetID)
	if err != nil {
		return nil, "", err
	}
	snapshot, ok := target.saved[environmentID]
	if !ok {
		return nil, "", fmt.Errorf("saved environment does not match this Kubernetes target")
	}
	if storage == nil {
		return nil, "", fmt.Errorf("saved environment storage is unavailable")
	}
	current, err := storage.Get(environmentID)
	if err != nil {
		return nil, "", fmt.Errorf("matched saved environment is unavailable; prepare the Kubernetes target again")
	}
	if current.ID != snapshot.ID || current.Runtime != snapshot.Runtime || !maps.Equal(current.Params, snapshot.Params) ||
		!reflect.DeepEqual(current.Kubeconfig, snapshot.Kubeconfig) {
		return nil, "", fmt.Errorf("matched saved environment connection changed; prepare the Kubernetes target again")
	}
	return copyTransientConfig(target.config), target.Namespace, nil
}
