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

	"google.golang.org/protobuf/encoding/protojson"

	igApi "github.com/inspektor-gadget/inspektor-gadget/pkg/gadget-service/api"
	"ig-frontend/internal/api"
	"ig-frontend/internal/gadget"
)

// HandleRunGadget handles running a new gadget instance
func (h *Handler) HandleRunGadget(ev *api.Event) {
	var req struct {
		ID            string            `json:"id"`
		Image         string            `json:"image"`
		EnvironmentID string            `json:"environmentID"`
		Params        map[string]string `json:"params"`
		Detached      bool              `json:"detached"`
		InstanceName  string            `json:"instanceName"`
		Record        bool              `json:"record"`
		SessionID     string            `json:"sessionId"`
		SessionName   string            `json:"sessionName"`
	}
	err := json.Unmarshal(ev.Data, &req)
	if err != nil {
		h.send(ev.SetError(err))
		return
	}

	runReq := gadget.RunRequest{
		ID:            req.ID,
		Image:         req.Image,
		EnvironmentID: req.EnvironmentID,
		Params:        req.Params,
		Detached:      req.Detached,
		InstanceName:  req.InstanceName,
		Record:        req.Record,
		SessionID:     req.SessionID,
		SessionName:   req.SessionName,
	}

	instanceID, err := h.gadgetService.Run(h.ctx, runReq)
	if err != nil {
		h.send(ev.SetError(err))
		return
	}

	// Send acknowledgment with the instance ID
	req.ID = instanceID
	h.send(ev.SetData(req))

	// If detached, send additional acknowledgment
	if req.Detached {
		h.send(ev.SetData(nil))
	}
}

// HandleAttachInstance handles attaching to an existing gadget instance
func (h *Handler) HandleAttachInstance(ev *api.Event) {
	var req struct {
		ID            string            `json:"id"`
		Image         string            `json:"image"`
		EnvironmentID string            `json:"environmentID"`
		Params        map[string]string `json:"params"`
		InstanceName  string            `json:"instanceName"`
	}
	err := json.Unmarshal(ev.Data, &req)
	if err != nil {
		h.send(ev.SetError(err))
		return
	}

	attachReq := gadget.AttachRequest{
		ID:            req.ID,
		Image:         req.Image,
		EnvironmentID: req.EnvironmentID,
		Params:        req.Params,
		InstanceName:  req.InstanceName,
	}

	instanceID, err := h.gadgetService.Attach(h.ctx, attachReq)
	if err != nil {
		h.send(ev.SetError(err))
		return
	}

	// Send acknowledgment with the instance ID
	req.ID = instanceID
	h.send(ev.SetData(req))
}

// HandleGetGadgetInfo handles retrieving information about a gadget
func (h *Handler) HandleGetGadgetInfo(ev *api.Event) {
	var req struct {
		URL           string `json:"url"`
		EnvironmentID string `json:"environmentID"`
	}
	err := json.Unmarshal(ev.Data, &req)
	if err != nil {
		h.send(ev.SetError(err))
		return
	}

	go func() {
		info, err := h.gadgetService.GetInfo(h.ctx, req.EnvironmentID, req.URL)
		if err != nil {
			h.send(ev.SetError(err))
			return
		}
		h.send(ev.SetData(info))
	}()
}

// HandleListInstances handles listing all gadget instances in an environment
func (h *Handler) HandleListInstances(ev *api.Event) {
	var req struct {
		EnvironmentID string `json:"environmentID"`
	}
	err := json.Unmarshal(ev.Data, &req)
	if err != nil {
		h.send(ev.SetError(err))
		return
	}

	go func() {
		instances, err := h.gadgetService.ListInstances(h.ctx, req.EnvironmentID)
		if err != nil {
			log.Println(err)
			h.send(ev.SetError(err))
			return
		}

		tmp, _ := protojson.Marshal(&igApi.ListGadgetInstanceResponse{GadgetInstances: instances})
		ev.Data = tmp
		ev.Success = true
		h.send(ev)
	}()
}
