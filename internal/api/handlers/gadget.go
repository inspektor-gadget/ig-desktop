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
	"errors"
	"log"

	"google.golang.org/protobuf/encoding/protojson"

	"github.com/inspektor-gadget/ig-desktop/internal/environment"
	"github.com/inspektor-gadget/ig-desktop/pkg/api"
	"github.com/inspektor-gadget/ig-desktop/pkg/fileoutput"
	"github.com/inspektor-gadget/ig-desktop/pkg/gadget"
	grpcruntime "github.com/inspektor-gadget/ig-desktop/pkg/grpc-runtime"
	igApi "github.com/inspektor-gadget/inspektor-gadget/pkg/gadget-service/api"
)

// HandleRunGadget handles running a new gadget instance
func (h *Handler) HandleRunGadget(ev *api.Event) {
	var req struct {
		ID                 string              `json:"id"`
		Image              string              `json:"image"`
		EnvironmentID      string              `json:"environmentID"`
		KubernetesTargetID string              `json:"kubernetesTargetID,omitempty"`
		Params             map[string]string   `json:"params"`
		Detached           bool                `json:"detached"`
		InstanceName       string              `json:"instanceName"`
		Record             bool                `json:"record"`
		SessionID          string              `json:"sessionId"`
		SessionName        string              `json:"sessionName"`
		DurationSeconds    int64               `json:"durationSeconds"`
		RemoteInstanceID   string              `json:"remoteInstanceID,omitempty"`
		Output             *fileoutput.Request `json:"output,omitempty"`
	}
	err := json.Unmarshal(ev.Data, &req)
	if err != nil {
		h.send(ev.SetError(err))
		return
	}
	if environment.IsTransientID(req.EnvironmentID) {
		if err := validateTransientRun(req.Record, req.Detached, req.SessionID, req.SessionName); err != nil {
			h.send(ev.SetError(err))
			return
		}
	}
	// Reject invalid option combinations before resolving a runtime; the
	// service owns these rules and re-applies them in Run.
	if err := h.gadgetService.ValidateRun(gadget.RunRequest{
		Output: req.Output, Detached: req.Detached, Record: req.Record,
		SessionID: req.SessionID, SessionName: req.SessionName, DurationSeconds: req.DurationSeconds,
	}); err != nil {
		h.send(ev.SetError(err))
		return
	}
	// The connection-local stream ID and the persistent remote ID are distinct.
	req.RemoteInstanceID = ""
	if req.Detached {
		req.RemoteInstanceID, err = igApi.NewInstanceID()
		if err != nil {
			h.send(ev.SetError(err))
			return
		}
	}

	runtime, err := h.getRuntime(req.EnvironmentID, req.KubernetesTargetID)
	if err != nil {
		h.send(ev.SetError(err))
		return
	}

	var outputTarget *fileoutput.Target
	if req.Output != nil {
		outputTarget, err = h.fileOutputTarget(req.EnvironmentID, req.KubernetesTargetID)
		if err != nil {
			h.send(ev.SetError(err))
			return
		}
	}
	var outputStatus fileoutput.Status
	runReq := gadget.RunRequest{
		Output:           req.Output,
		OutputStatus:     &outputStatus,
		OutputTarget:     outputTarget,
		ID:               req.ID,
		Image:            req.Image,
		EnvironmentID:    req.EnvironmentID,
		Params:           req.Params,
		Detached:         req.Detached,
		InstanceName:     req.InstanceName,
		Record:           req.Record,
		SessionID:        req.SessionID,
		SessionName:      req.SessionName,
		DurationSeconds:  req.DurationSeconds,
		RemoteInstanceID: req.RemoteInstanceID,
	}

	instanceID, err := h.gadgetService.Run(h.ctx, runtime, runReq)
	if err != nil {
		h.send(ev.SetError(err))
		return
	}

	// Send acknowledgment with the instance ID
	req.ID = instanceID
	if req.Output != nil {
		response, _ := json.Marshal(req)
		var fields map[string]json.RawMessage
		json.Unmarshal(response, &fields)
		fields["output"], _ = json.Marshal(outputStatus)
		h.send(ev.SetData(fields))
	} else {
		h.send(ev.SetData(req))
	}

}

// HandleAttachInstance handles attaching to an existing gadget instance
func (h *Handler) HandleAttachInstance(ev *api.Event) {
	if h.rejectTransientIdentity(ev) {
		return
	}
	var req struct {
		ID                 string            `json:"id"`
		Image              string            `json:"image"`
		EnvironmentID      string            `json:"environmentID"`
		KubernetesTargetID string            `json:"kubernetesTargetID,omitempty"`
		Params             map[string]string `json:"params"`
		InstanceName       string            `json:"instanceName"`
	}
	err := json.Unmarshal(ev.Data, &req)
	if err != nil {
		h.send(ev.SetError(err))
		return
	}

	runtime, err := h.getRuntime(req.EnvironmentID, req.KubernetesTargetID)
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

	instanceID, err := h.gadgetService.Attach(h.ctx, runtime, attachReq)
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
		URL                string `json:"url"`
		EnvironmentID      string `json:"environmentID"`
		KubernetesTargetID string `json:"kubernetesTargetID,omitempty"`
	}
	err := json.Unmarshal(ev.Data, &req)
	if err != nil {
		h.send(ev.SetError(err))
		return
	}

	runtime, err := h.getRuntime(req.EnvironmentID, req.KubernetesTargetID)
	if err != nil {
		h.send(ev.SetError(err))
		return
	}

	go func() {
		info, err := h.gadgetService.GetInfo(h.ctx, runtime, req.URL)
		if err != nil {
			h.send(ev.SetError(err))
			return
		}
		h.send(ev.SetData(info))
	}()
}

// HandleListInstances handles listing all gadget instances in an environment
func (h *Handler) HandleListInstances(ev *api.Event) {
	if h.rejectTransientIdentity(ev) {
		return
	}
	var req struct {
		EnvironmentID      string `json:"environmentID"`
		KubernetesTargetID string `json:"kubernetesTargetID,omitempty"`
	}
	err := json.Unmarshal(ev.Data, &req)
	if err != nil {
		h.send(ev.SetError(err))
		return
	}

	runtime, err := h.getRuntime(req.EnvironmentID, req.KubernetesTargetID)
	if err != nil {
		h.send(ev.SetError(err))
		return
	}

	go func() {
		instances, err := h.gadgetService.ListInstances(h.ctx, runtime)
		if err != nil {
			log.Println(err)
			ev.SetError(err)
			if errors.Is(err, grpcruntime.ErrDeploymentMissing) {
				env, loadErr := h.envStorage.Get(req.EnvironmentID)
				if loadErr != nil {
					h.send(ev.SetError(loadErr))
					return
				}
				namespace := env.Params[grpcruntime.ParamGadgetNamespace]
				if namespace == "" {
					namespace = grpcruntime.DefaultGadgetNamespace
				}
				ev.Data, _ = json.Marshal(map[string]any{"deploymentMissing": true, "gadgetNamespace": namespace})
			}
			h.send(ev)
			return
		}

		tmp, _ := protojson.Marshal(&igApi.ListGadgetInstanceResponse{GadgetInstances: instances})
		ev.Data = tmp
		ev.Success = true
		h.send(ev)
	}()
}
