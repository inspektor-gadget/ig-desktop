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
	"k8s.io/client-go/rest"
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
		Kubeconfig             environment.KubeconfigSource `json:"kubeconfig"`
		Context                string                       `json:"context"`
		RequireCurrentContext  bool                         `json:"requireCurrentContext"`
		MatchSavedEnvironments bool                         `json:"matchSavedEnvironments"`
	}
	if err := json.Unmarshal(ev.Data, &req); err != nil {
		h.send(ev.SetError(err))
		return
	}
	var target *environment.KubernetesTarget
	var err error
	if req.MatchSavedEnvironments {
		target, err = h.transientKubernetes.CreateMatching(req.Kubeconfig, req.Context, req.RequireCurrentContext, h.envStorage)
	} else {
		target, err = h.transientKubernetes.Create(req.Kubeconfig, req.Context, req.RequireCurrentContext)
	}
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

func (h *Handler) getRuntime(id, targetID string) (*grpcruntime.Runtime, error) {
	if targetID == "" && !environment.IsTransientID(id) {
		return h.runtimeFactory.GetRuntime(id)
	}
	config, namespace, err := h.frozenKubernetesConfig(id, targetID)
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

func (h *Handler) frozenKubernetesConfig(id, targetID string) (*rest.Config, string, error) {
	if h.transientKubernetes == nil {
		return nil, "", fmt.Errorf("transient Kubernetes targets are disabled")
	}
	if environment.IsTransientID(id) {
		if targetID != "" && targetID != id {
			return nil, "", fmt.Errorf("environment does not match this Kubernetes target")
		}
		return h.transientKubernetes.Lookup(id)
	}
	return h.transientKubernetes.LookupSaved(targetID, id, h.envStorage)
}

// validateTransientRun checks the decoded run request. encoding/json matches
// field names case-insensitively, so these are exactly the values the run
// would act on, whatever casing the client used.
func validateTransientRun(record, detached bool, sessionID, sessionName string) error {
	if record || sessionID != "" || sessionName != "" {
		return fmt.Errorf("recording and session fields are unsupported for transient Kubernetes targets")
	}
	if detached {
		return fmt.Errorf("detached runs are unsupported for transient Kubernetes targets")
	}
	return nil
}

// Management requests must not discard an unrecognized target and fall back to
// the current kubeconfig (deployment requests historically have no environmentID).
func (h *Handler) rejectTransientManagement(ev *api.Event) bool {
	if h.rejectTransientIdentity(ev) {
		return true
	}
	var fields map[string]json.RawMessage
	if json.Unmarshal(ev.Data, &fields) != nil {
		return false
	}
	for key, value := range fields {
		if !strings.EqualFold(key, "kubernetesTargetID") {
			continue
		}
		var id string
		if json.Unmarshal(value, &id) != nil || id != "" {
			h.send(ev.SetError(fmt.Errorf("operation is unsupported for frozen Kubernetes targets")))
			return true
		}
	}
	return false
}

func (h *Handler) rejectTransientIdentity(ev *api.Event) bool {
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
