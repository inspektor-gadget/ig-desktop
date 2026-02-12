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

// Event type constants for frontend-backend communication
const (
	TypeCommandResponse    = 1
	TypeGadgetInfo         = 2
	TypeGadgetEvent        = 3
	TypeGadgetLog          = 4
	TypeGadgetStop         = 5
	TypeGadgetEventArray   = 6
	TypeEnvironmentCreate  = 100
	TypeEnvironmentDelete  = 101
	TypeEnvironmentUpdate  = 102
	TypeDeploymentProgress = 200
	TypeDeploymentComplete = 201
	TypeDeploymentError    = 202
)
