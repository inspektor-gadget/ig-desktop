// Copyright 2026 The Inspektor Gadget authors
// SPDX-License-Identifier: Apache-2.0

package handlers

import (
	"encoding/json"
	"errors"

	"github.com/inspektor-gadget/ig-desktop/internal/environment"
	"github.com/inspektor-gadget/ig-desktop/pkg/api"
	"github.com/inspektor-gadget/ig-desktop/pkg/fileoutput"
)

func (h *Handler) fileOutputTarget(id, targetID string) (*fileoutput.Target, error) {
	if targetID != "" || environment.IsTransientID(id) {
		if h.transientKubernetes == nil {
			return nil, errors.New("transient Kubernetes targets are disabled")
		}
		if _, _, err := h.frozenKubernetesConfig(id, targetID); err != nil {
			return nil, err
		}
		if targetID == "" {
			targetID = id
		}
		target, err := h.transientKubernetes.Describe(targetID)
		if err != nil {
			return nil, err
		}
		name := target.Name
		for _, saved := range target.SavedEnvironments {
			if saved.ID == id {
				name = saved.Name
				break
			}
		}
		return &fileoutput.Target{Name: name, Context: target.Name, Runtime: target.Runtime, DefaultNamespace: target.Namespace, Transient: environment.IsTransientID(id)}, nil
	}
	if h.envStorage == nil {
		return nil, errors.New("environment display metadata is unavailable")
	}
	env, err := h.envStorage.Get(id)
	if err != nil {
		return nil, err
	}
	return &fileoutput.Target{Name: env.Name, Runtime: env.Runtime}, nil
}

// EnableFileOutput is called only by the private stdio or native Wails host.
// A picker opts into selection, never arbitrary path preparation over Wails.
func (h *Handler) EnableFileOutput(manager *fileoutput.Manager, prepare bool, picker func(string) (*fileoutput.Selection, error)) {
	h.fileOutputs, h.prepareFileOutput, h.filePicker = manager, prepare, picker
	h.gadgetService.SetFileOutputs(manager)
}

func (h *Handler) HandleGetFileOutputCapabilities(ev *api.Event) {
	if h.fileOutputs == nil {
		h.send(ev.SetError(errors.New("file output is unavailable on this host")))
		return
	}
	h.send(ev.SetData(h.fileOutputs.Capabilities()))
}

func (h *Handler) HandlePrepareFileOutput(ev *api.Event) {
	if h.fileOutputs == nil || !h.prepareFileOutput {
		h.send(ev.SetError(errors.New("path preparation is unavailable on this host")))
		return
	}
	var req struct {
		Path      string `json:"path"`
		Format    string `json:"format"`
		Overwrite bool   `json:"overwrite"`
	}
	if err := json.Unmarshal(ev.Data, &req); err != nil {
		h.send(ev.SetError(err))
		return
	}
	selection, err := h.fileOutputs.Prepare(req.Path, req.Format, req.Overwrite)
	if err != nil {
		h.send(ev.SetError(err))
		return
	}
	h.send(ev.SetData(selection))
}

func (h *Handler) HandleSelectFileOutput(ev *api.Event) {
	if h.fileOutputs == nil || h.filePicker == nil {
		h.send(ev.SetError(errors.New("native file picker is unavailable on this host")))
		return
	}
	var req struct {
		Format string `json:"format"`
	}
	if err := json.Unmarshal(ev.Data, &req); err != nil {
		h.send(ev.SetError(err))
		return
	}
	if err := fileoutput.ValidateFormat(req.Format); err != nil {
		h.send(ev.SetError(err))
		return
	}
	selection, err := h.filePicker(req.Format)
	if err != nil {
		h.send(ev.SetError(err))
		return
	}
	h.send(ev.SetData(selection))
}

func (h *Handler) HandleReleaseFileOutput(ev *api.Event) {
	if h.fileOutputs == nil {
		h.send(ev.SetError(errors.New("file output is unavailable on this host")))
		return
	}
	var req struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(ev.Data, &req); err != nil {
		h.send(ev.SetError(err))
		return
	}
	h.fileOutputs.Release(req.Token)
	h.send(ev.SetData(nil))
}
