// Copyright 2025 The Inspektor Gadget authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package handlers

import (
	"encoding/json"
	"fmt"

	"github.com/inspektor-gadget/ig-desktop/internal/environment"
	"github.com/inspektor-gadget/ig-desktop/pkg/api"
)

func (h *Handler) HandleImportKubernetesEnvironment(ev *api.Event) {
	if h.transientKubernetes == nil {
		h.send(ev.SetError(fmt.Errorf("Kubernetes environment import is disabled")))
		return
	}
	var req struct {
		Kubeconfig environment.KubeconfigSource `json:"kubeconfig"`
		Context    string                       `json:"context"`
	}
	if err := json.Unmarshal(ev.Data, &req); err != nil {
		h.send(ev.SetError(err))
		return
	}
	env, err := h.envStorage.ImportKubernetes(req.Kubeconfig, req.Context)
	if err != nil {
		h.send(ev.SetError(err))
		return
	}
	data, _ := json.Marshal(env)
	h.send(&api.GadgetEvent{Type: api.TypeEnvironmentCreate, Data: data})
	h.send(ev.SetData(env))
}

// HandleCreateEnvironment handles creating a new environment
func (h *Handler) HandleCreateEnvironment(ev *api.Event) {
	if h.rejectTransientManagement(ev) {
		return
	}
	env := &environment.Environment{}
	err := json.Unmarshal(ev.Data, env)
	if err != nil {
		h.send(ev.SetError(err))
		return
	}

	err = h.envStorage.Add(env)
	if err != nil {
		h.send(ev.SetError(err))
		return
	}

	// Emit new environment first
	d, _ := json.Marshal(env)
	cmd := &api.GadgetEvent{
		Type: api.TypeEnvironmentCreate,
		Data: d,
	}
	h.send(cmd)

	// Then acknowledge create action
	h.send(ev.SetData(env))
}

// HandleDeleteEnvironment handles deleting an environment
func (h *Handler) HandleDeleteEnvironment(ev *api.Event) {
	if h.rejectTransientManagement(ev) {
		return
	}
	env := &environment.Environment{}
	err := json.Unmarshal(ev.Data, env)
	if err != nil {
		h.send(ev.SetError(err))
		return
	}

	err = h.envStorage.Delete(env)
	if err != nil {
		h.send(ev.SetError(err))
		return
	}

	// Emit deletion of environment first
	d, _ := json.Marshal(env)
	cmd := &api.GadgetEvent{
		Type: api.TypeEnvironmentDelete,
		Data: d,
	}
	h.send(cmd)

	// Then acknowledge delete action
	h.send(ev.SetData(env))
}
