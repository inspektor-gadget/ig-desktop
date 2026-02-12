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

	"github.com/inspektor-gadget/ig-desktop/pkg/api"
)

// HandleGetArtifactHubPackage retrieves package information from ArtifactHub
func (h *Handler) HandleGetArtifactHubPackage(ev *api.Event) {
	var req struct {
		Repository string `json:"repository"`
		Package    string `json:"package"`
		Version    string `json:"version"`
	}
	err := json.Unmarshal(ev.Data, &req)
	if err != nil {
		h.send(ev.SetError(err))
		return
	}

	go func() {
		response, err := h.artifactHub.GetPackage(h.ctx, req.Repository, req.Package, req.Version)
		if err != nil {
			h.send(ev.SetError(err))
			return
		}
		h.send(ev.SetData(response))
	}()
}
