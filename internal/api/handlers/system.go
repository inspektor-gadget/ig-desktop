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

	"github.com/inspektor-gadget/ig-desktop/pkg/api"
)

// HandleHelo handles the initial handshake and sends all environments
func (h *Handler) HandleHelo(ev *api.Event) {
	environments, err := h.envStorage.List()
	if err != nil {
		log.Printf("failed to get environments: %v", err)
		return
	}

	for _, env := range environments {
		d, _ := json.Marshal(env)
		cmd := &api.GadgetEvent{
			Type: api.TypeEnvironmentCreate,
			Data: d,
		}
		h.send(cmd)
	}
}

// HandleRemoveInstance handles removal of a gadget instance
func (h *Handler) HandleRemoveInstance(ev *api.Event) {
	var req struct {
		ID            string `json:"id"`
		EnvironmentID string `json:"environmentID"`
	}
	err := json.Unmarshal(ev.Data, &req)
	if err != nil {
		h.send(ev.SetError(err))
		return
	}

	runtime, err := h.runtimeFactory.GetRuntime(req.EnvironmentID)
	if err != nil {
		h.send(ev.SetError(err))
		return
	}

	go func() {
		err := h.gadgetService.RemoveInstance(h.ctx, runtime, req.ID)
		if err != nil {
			h.send(ev.SetError(err))
			return
		}
		h.send(ev.SetData(nil))
	}()
}

// HandleStopInstance handles stopping a running gadget instance
func (h *Handler) HandleStopInstance(ev *api.Event) {
	var req struct {
		ID string `json:"id"`
	}
	err := json.Unmarshal(ev.Data, &req)
	if err != nil {
		h.send(ev.SetError(err))
		return
	}

	err = h.instanceManager.Stop(req.ID)
	if err != nil {
		log.Printf("instance %s not found or already stopped", req.ID)
	} else {
		log.Printf("stopping instance %s", req.ID)
	}

	h.send(ev.SetData(nil))
}
