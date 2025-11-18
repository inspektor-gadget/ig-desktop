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
	"log"

	"ig-frontend/internal/api"
	"ig-frontend/internal/environment"
)

// HandleGetRuntimes returns available runtime types
func (h *Handler) HandleGetRuntimes(ev *api.Event) {
	type RuntimeInfo struct {
		Key         string   `json:"key"`
		Title       string   `json:"title"`
		Description string   `json:"description"`
		Contexts    []string `json:"contexts,omitempty"`
	}

	// Get available Kubernetes contexts
	contexts, err := environment.GetKubernetesContexts()
	if err != nil {
		log.Printf("Warning: failed to get Kubernetes contexts: %v", err)
		contexts = []string{}
	}

	runtimes := []RuntimeInfo{
		{Key: "grpc-ig", Title: "IG Daemon", Description: "Connect to Inspektor Gadget running as Daemon"},
		{Key: "grpc-k8s", Title: "IG on Kubernetes", Description: "Connect to Inspektor Gadget running on a Kubernetes cluster", Contexts: contexts},
	}
	h.send(ev.SetData(runtimes))
}

// HandleGetRuntimeParams returns parameters for a specific runtime type
func (h *Handler) HandleGetRuntimeParams(ev *api.Event) {
	var req struct {
		Runtime string `json:"runtime"`
	}
	err := json.Unmarshal(ev.Data, &req)
	if err != nil {
		h.send(ev.SetError(err))
		return
	}

	params, err := h.runtimeFactory.GetRuntimeParams(req.Runtime)
	if err != nil {
		h.send(ev.SetError(err))
		return
	}

	h.send(ev.SetData(params))
}
