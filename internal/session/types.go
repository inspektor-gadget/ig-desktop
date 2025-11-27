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

package session

// Session represents a debug session file (can contain multiple gadget runs)
type Session struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	EnvironmentID string `json:"environmentId"`
	CreatedAt     int64  `json:"createdAt"` // unix ms
	UpdatedAt     int64  `json:"updatedAt"` // unix ms
	RunCount      int    `json:"runCount"`  // number of gadget runs
}

// GadgetRun represents a single gadget execution within a session
type GadgetRun struct {
	ID          string            `json:"id"`
	SessionID   string            `json:"sessionId"`
	GadgetImage string            `json:"gadgetImage"`
	Params      map[string]string `json:"params"`
	GadgetInfo  []byte            `json:"-"`         // protobuf binary
	StartedAt   int64             `json:"startedAt"` // unix ms
	StoppedAt   int64             `json:"stoppedAt"` // unix ms
	EventCount  int               `json:"eventCount"`
}

// RecordedEvent represents a single event in a gadget run
type RecordedEvent struct {
	ID           int64  `json:"id"`
	RunID        string `json:"runId"`
	Timestamp    int64  `json:"timestamp"` // unix ms
	Type         int    `json:"type"`      // event type constant
	DatasourceID string `json:"datasourceId,omitempty"`
	Data         []byte `json:"-"` // protobuf binary
}
