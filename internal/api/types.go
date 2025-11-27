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

package api

import "encoding/json"

// Event represents a command-response message between frontend and backend
type Event struct {
	Type      int             `json:"type"`
	Command   string          `json:"cmd"`
	RequestID string          `json:"reqID"`
	Data      json.RawMessage `json:"data"`
	Success   bool            `json:"success"`
	Error     string          `json:"error"`
}

// SetError sets an error on the event response
func (ev *Event) SetError(err error) *Event {
	ev.Data = nil
	ev.Success = false
	ev.Error = err.Error()
	return ev
}

// SetData sets the successful response data on the event
func (ev *Event) SetData(data any) *Event {
	ev.Data, _ = json.Marshal(data)
	ev.Success = true
	return ev
}

// CommandHandler defines the interface for command handlers
type CommandHandler interface {
	Command() string
	Handle(*Event)
}

// GadgetEvent represents an event from a gadget instance
type GadgetEvent struct {
	EnvironmentID string          `json:"environmentID,omitempty"`
	InstanceID    string          `json:"instanceID,omitempty"`
	Type          int             `json:"type"`
	Data          json.RawMessage `json:"data"`
	DatasourceID  string          `json:"datasourceID,omitempty"`
	SessionInfo   *SessionInfo    `json:"sessionInfo,omitempty"`
}

// SessionInfo sent to frontend when recording is enabled
type SessionInfo struct {
	SessionID string `json:"sessionId"`
	RunID     string `json:"runId"`
	IsNew     bool   `json:"isNew"` // true if new session was created
}
