// Copyright 2026 The Inspektor Gadget authors
// SPDX-License-Identifier: Apache-2.0

package handlers

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/inspektor-gadget/ig-desktop/internal/environment"
	"github.com/inspektor-gadget/ig-desktop/pkg/api"
	grpcruntime "github.com/inspektor-gadget/ig-desktop/pkg/grpc-runtime"
	"github.com/inspektor-gadget/inspektor-gadget/pkg/gadgets"
)

// EnableTransientKubernetes must be called before Register, only by the private
// VS Code stdio entrypoint. Desktop and WebSocket handlers remain unchanged.
func (h *Handler) EnableTransientKubernetes() {
	if h.transientKubernetes == nil {
		h.transientKubernetes = environment.NewTransientKubernetes(h.ctx)
	}
}

func (h *Handler) HandleGetKubernetesContexts(ev *api.Event) {
	if h.transientKubernetes == nil {
		h.send(ev.SetError(fmt.Errorf("transient Kubernetes targets are disabled")))
		return
	}
	if err := h.ctx.Err(); err != nil {
		h.send(ev.SetError(err))
		return
	}
	var req struct {
		Kubeconfig environment.KubeconfigSource `json:"kubeconfig"`
	}
	if err := json.Unmarshal(ev.Data, &req); err != nil {
		h.send(ev.SetError(err))
		return
	}
	result, err := environment.ListKubernetesContexts(req.Kubeconfig)
	if err != nil {
		h.send(ev.SetError(err))
		return
	}
	h.send(ev.SetData(result))
}

func (h *Handler) HandleCreateKubernetesTarget(ev *api.Event) {
	if h.transientKubernetes == nil {
		h.send(ev.SetError(fmt.Errorf("transient Kubernetes targets are disabled")))
		return
	}
	var req struct {
		Kubeconfig            environment.KubeconfigSource `json:"kubeconfig"`
		Context               string                       `json:"context"`
		RequireCurrentContext bool                         `json:"requireCurrentContext"`
	}
	if err := json.Unmarshal(ev.Data, &req); err != nil {
		h.send(ev.SetError(err))
		return
	}
	target, err := h.transientKubernetes.Create(req.Kubeconfig, req.Context, req.RequireCurrentContext)
	if err != nil {
		h.send(ev.SetError(err))
		return
	}
	h.send(ev.SetData(target))
}

func (h *Handler) HandleTouchKubernetesTarget(ev *api.Event) {
	if h.transientKubernetes == nil {
		h.send(ev.SetError(fmt.Errorf("transient Kubernetes targets are disabled")))
		return
	}
	var req struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(ev.Data, &req); err != nil {
		h.send(ev.SetError(err))
		return
	}
	expiresAt, err := h.transientKubernetes.Touch(req.ID)
	if err != nil {
		h.send(ev.SetError(err))
		return
	}
	h.send(ev.SetData(map[string]int64{"expiresAt": expiresAt}))
}

func (h *Handler) HandleReleaseKubernetesTarget(ev *api.Event) {
	if h.transientKubernetes == nil {
		h.send(ev.SetError(fmt.Errorf("transient Kubernetes targets are disabled")))
		return
	}
	var req struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(ev.Data, &req); err != nil {
		h.send(ev.SetError(err))
		return
	}
	released, err := h.transientKubernetes.Release(req.ID)
	if err != nil {
		h.send(ev.SetError(err))
		return
	}
	h.send(ev.SetData(map[string]bool{"released": released}))
}

func (h *Handler) getRuntime(id string) (*grpcruntime.Runtime, error) {
	if !environment.IsTransientID(id) {
		return h.runtimeFactory.GetRuntime(id)
	}
	if h.transientKubernetes == nil {
		return nil, fmt.Errorf("transient Kubernetes targets are disabled")
	}
	config, namespace, err := h.transientKubernetes.Lookup(id)
	if err != nil {
		return nil, err
	}
	runtime := grpcruntime.New(grpcruntime.WithConnectUsingK8SProxy)
	runtime.SetRestConfig(config)
	runtime.SetDefaultValue(gadgets.K8SNamespace, namespace)
	if err := runtime.Init(nil); err != nil {
		return nil, err
	}
	return runtime, nil
}

func validateTransientRun(data json.RawMessage) error {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	for key, value := range fields {
		key = strings.ToLower(key)
		switch {
		case key == "sessionid" || key == "sessionname":
			var session string
			if err := json.Unmarshal(value, &session); err != nil {
				return err
			}
			if session != "" {
				return fmt.Errorf("recording and session fields are unsupported for transient Kubernetes targets")
			}
		case key == "record":
			var record bool
			if err := json.Unmarshal(value, &record); err != nil {
				return err
			}
			if record {
				return fmt.Errorf("recording and session fields are unsupported for transient Kubernetes targets")
			}
		case strings.HasPrefix(key, "record"), strings.HasPrefix(key, "session"):
			return fmt.Errorf("recording and session fields are unsupported for transient Kubernetes targets")
		case key == "detached":
			var detached bool
			if err := json.Unmarshal(value, &detached); err != nil {
				return err
			}
			if detached {
				return fmt.Errorf("detached runs are unsupported for transient Kubernetes targets")
			}
		}
	}
	return nil
}

// Management requests must not discard an unrecognized target and fall back to
// the current kubeconfig (deployment requests historically have no environmentID).
func (h *Handler) rejectTransientManagement(ev *api.Event) bool {
	var fields map[string]json.RawMessage
	if json.Unmarshal(ev.Data, &fields) != nil {
		return false
	}
	for key, value := range fields {
		if !strings.EqualFold(key, "id") && !strings.EqualFold(key, "environmentID") {
			continue
		}
		var id string
		if json.Unmarshal(value, &id) == nil && environment.IsTransientID(id) {
			h.send(ev.SetError(fmt.Errorf("operation is unsupported for transient Kubernetes targets")))
			return true
		}
	}
	return false
}
