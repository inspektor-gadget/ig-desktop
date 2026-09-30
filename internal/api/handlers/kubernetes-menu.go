// Copyright 2026 The Inspektor Gadget authors
// SPDX-License-Identifier: Apache-2.0

package handlers

import (
	"context"
	"encoding/json"
	"time"

	"github.com/inspektor-gadget/ig-desktop/internal/environment"
	"github.com/inspektor-gadget/ig-desktop/pkg/api"
	"github.com/inspektor-gadget/ig-desktop/pkg/k8s"
	"k8s.io/client-go/rest"
)

// HandleKubernetesMenuState is private to the opt-in Kubernetes host bridge.
// It never imports an environment or changes cluster resources.
func (h *Handler) HandleKubernetesMenuState(ev *api.Event) {
	var req struct {
		EnvironmentID string                       `json:"environmentID"`
		Kubeconfig    environment.KubeconfigSource `json:"kubeconfig"`
		Context       string                       `json:"context"`
	}
	if err := json.Unmarshal(ev.Data, &req); err != nil {
		h.send(ev.SetError(err))
		return
	}
	state := struct {
		EnvironmentID string `json:"environmentId,omitempty"`
		Deployment    string `json:"deployment"`
		// Namespace is where IG was found; NamespaceMismatch reports that it
		// is not the gadget namespace this environment manages.
		Namespace         string `json:"namespace,omitempty"`
		NamespaceMismatch bool   `json:"namespaceMismatch,omitempty"`
		Error             string `json:"error,omitempty"`
	}{Deployment: "unknown"}
	check := func() error {
		var env *environment.Environment
		var err error
		if req.EnvironmentID != "" {
			env, err = h.envStorage.Get(req.EnvironmentID)
		} else {
			env, err = h.envStorage.FindKubernetes(req.Kubeconfig, req.Context)
		}
		if err != nil {
			return err
		}
		namespace := "gadget"
		var config *rest.Config
		if env != nil {
			state.EnvironmentID = env.ID
			conn, err := resolveSavedKubernetes(env)
			if err != nil {
				return err
			}
			config, namespace = conn.Config, conn.GadgetNamespace
		} else if config, _, err = environment.ResolveKubernetesConfig(req.Kubeconfig, req.Context); err != nil {
			return err
		}
		ctx, cancel := context.WithTimeout(h.ctx, 5*time.Second)
		defer cancel()
		status, err := k8s.CheckIGDeployment(ctx, config, namespace)
		if err != nil {
			return err
		}
		if status.Deployed {
			state.Deployment = "deployed"
			state.Namespace = status.Namespace
			state.NamespaceMismatch = status.Namespace != namespace
		} else if status.Missing {
			state.Deployment = "missing"
		}
		return nil
	}
	if err := check(); err != nil {
		state.Error = err.Error()
	}
	h.send(ev.SetData(state))
}
