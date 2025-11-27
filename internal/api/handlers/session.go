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
	"log"

	"ig-frontend/internal/api"
)

// HandleListSessions lists all sessions for an environment
func (h *Handler) HandleListSessions(ev *api.Event) {
	var req struct {
		EnvironmentID string `json:"environmentId"`
	}
	err := json.Unmarshal(ev.Data, &req)
	if err != nil {
		h.send(ev.SetError(err))
		return
	}

	log.Printf("[listSessions] Requested environment ID: %q", req.EnvironmentID)

	// Get session service from handler dependencies
	sessionService := h.sessionService
	if sessionService == nil {
		h.send(ev.SetError(fmt.Errorf("session service not available")))
		return
	}

	// List sessions for environment
	sessions, err := sessionService.ListSessions(req.EnvironmentID)
	if err != nil {
		h.send(ev.SetError(err))
		return
	}

	log.Printf("[listSessions] Found %d sessions for environment %q", len(sessions), req.EnvironmentID)

	h.send(ev.SetData(sessions))
}

// HandleGetSession retrieves a session with all its gadget runs
func (h *Handler) HandleGetSession(ev *api.Event) {
	var req struct {
		SessionID string `json:"sessionId"`
	}
	err := json.Unmarshal(ev.Data, &req)
	if err != nil {
		h.send(ev.SetError(err))
		return
	}

	// Get session service from handler dependencies
	sessionService := h.sessionService
	if sessionService == nil {
		h.send(ev.SetError(fmt.Errorf("session service not available")))
		return
	}

	// Get session with runs
	sessionWithRuns, err := sessionService.GetSession(req.SessionID)
	if err != nil {
		h.send(ev.SetError(err))
		return
	}

	// Convert runs to include gadgetInfo as JSON
	type runResponse struct {
		ID          string            `json:"id"`
		SessionID   string            `json:"sessionId"`
		GadgetImage string            `json:"gadgetImage"`
		Params      map[string]string `json:"params"`
		GadgetInfo  json.RawMessage   `json:"gadgetInfo,omitempty"`
		StartedAt   int64             `json:"startedAt"`
		StoppedAt   int64             `json:"stoppedAt"`
		EventCount  int               `json:"eventCount"`
	}

	runs := make([]runResponse, 0, len(sessionWithRuns.Runs))
	for _, run := range sessionWithRuns.Runs {
		var gadgetInfoJSON json.RawMessage
		if len(run.GadgetInfo) > 0 {
			// GadgetInfo is stored as protojson, so we can use it directly
			gadgetInfoJSON = run.GadgetInfo
		}
		runs = append(runs, runResponse{
			ID:          run.ID,
			SessionID:   run.SessionID,
			GadgetImage: run.GadgetImage,
			Params:      run.Params,
			GadgetInfo:  gadgetInfoJSON,
			StartedAt:   run.StartedAt,
			StoppedAt:   run.StoppedAt,
			EventCount:  run.EventCount,
		})
	}

	// Build response
	response := struct {
		ID            string        `json:"id"`
		Name          string        `json:"name"`
		EnvironmentID string        `json:"environmentId"`
		CreatedAt     int64         `json:"createdAt"`
		UpdatedAt     int64         `json:"updatedAt"`
		RunCount      int           `json:"runCount"`
		Runs          []runResponse `json:"runs"`
	}{
		ID:            sessionWithRuns.ID,
		Name:          sessionWithRuns.Name,
		EnvironmentID: sessionWithRuns.EnvironmentID,
		CreatedAt:     sessionWithRuns.CreatedAt,
		UpdatedAt:     sessionWithRuns.UpdatedAt,
		RunCount:      sessionWithRuns.RunCount,
		Runs:          runs,
	}

	h.send(ev.SetData(response))
}

// HandleGetGadgetRun retrieves a single gadget run with GadgetInfo as JSON
func (h *Handler) HandleGetGadgetRun(ev *api.Event) {
	var req struct {
		SessionID string `json:"sessionId"`
		RunID     string `json:"runId"`
	}
	err := json.Unmarshal(ev.Data, &req)
	if err != nil {
		h.send(ev.SetError(err))
		return
	}

	// Get session service from handler dependencies
	sessionService := h.sessionService
	if sessionService == nil {
		h.send(ev.SetError(fmt.Errorf("session service not available")))
		return
	}

	// Get gadget run
	run, err := sessionService.GetGadgetRun(req.SessionID, req.RunID)
	if err != nil {
		h.send(ev.SetError(err))
		return
	}

	// GadgetInfo is stored as protojson (JSON format), so we can use it directly
	var gadgetInfoJSON json.RawMessage
	if len(run.GadgetInfo) > 0 {
		gadgetInfoJSON = run.GadgetInfo
	}

	// Build response with GadgetInfo as JSON
	response := struct {
		ID          string            `json:"id"`
		SessionID   string            `json:"sessionId"`
		GadgetImage string            `json:"gadgetImage"`
		Params      map[string]string `json:"params"`
		GadgetInfo  json.RawMessage   `json:"gadgetInfo,omitempty"`
		StartedAt   int64             `json:"startedAt"`
		StoppedAt   int64             `json:"stoppedAt"`
		EventCount  int               `json:"eventCount"`
	}{
		ID:          run.ID,
		SessionID:   run.SessionID,
		GadgetImage: run.GadgetImage,
		Params:      run.Params,
		GadgetInfo:  gadgetInfoJSON,
		StartedAt:   run.StartedAt,
		StoppedAt:   run.StoppedAt,
		EventCount:  run.EventCount,
	}

	h.send(ev.SetData(response))
}

// HandleGetRunEvents retrieves all events for a gadget run
func (h *Handler) HandleGetRunEvents(ev *api.Event) {
	var req struct {
		SessionID string `json:"sessionId"`
		RunID     string `json:"runId"`
	}
	err := json.Unmarshal(ev.Data, &req)
	if err != nil {
		h.send(ev.SetError(err))
		return
	}

	// Get session service from handler dependencies
	sessionService := h.sessionService
	if sessionService == nil {
		h.send(ev.SetError(fmt.Errorf("session service not available")))
		return
	}

	// Get events for run
	events, err := sessionService.GetRunEvents(req.SessionID, req.RunID)
	if err != nil {
		h.send(ev.SetError(err))
		return
	}

	// Convert events to response format
	// Events are already stored as JSON, so we just need to wrap them
	type eventResponse struct {
		ID           int64           `json:"id"`
		RunID        string          `json:"runId"`
		Timestamp    int64           `json:"timestamp"`
		Type         int             `json:"type"`
		DatasourceID string          `json:"datasourceId,omitempty"`
		Data         json.RawMessage `json:"data"`
	}

	responses := make([]eventResponse, 0, len(events))
	for _, event := range events {
		responses = append(responses, eventResponse{
			ID:           event.ID,
			RunID:        event.RunID,
			Timestamp:    event.Timestamp,
			Type:         event.Type,
			DatasourceID: event.DatasourceID,
			Data:         event.Data, // Already JSON
		})
	}

	h.send(ev.SetData(responses))
}

// HandleDeleteSession deletes a session and its file
func (h *Handler) HandleDeleteSession(ev *api.Event) {
	var req struct {
		SessionID string `json:"sessionId"`
	}
	err := json.Unmarshal(ev.Data, &req)
	if err != nil {
		h.send(ev.SetError(err))
		return
	}

	// Get session service from handler dependencies
	sessionService := h.sessionService
	if sessionService == nil {
		h.send(ev.SetError(fmt.Errorf("session service not available")))
		return
	}

	// Delete session
	err = sessionService.DeleteSession(req.SessionID)
	if err != nil {
		h.send(ev.SetError(err))
		return
	}

	// Send success response
	h.send(ev.SetData(map[string]bool{"success": true}))
}
