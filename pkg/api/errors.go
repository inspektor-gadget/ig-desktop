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

import "fmt"

// Error types for better error handling throughout the application

// ErrEnvironmentNotFound indicates the requested environment does not exist
type ErrEnvironmentNotFound struct {
	ID string
}

func (e *ErrEnvironmentNotFound) Error() string {
	return fmt.Sprintf("environment not found: %s", e.ID)
}

// ErrInvalidEnvironmentID indicates an invalid environment ID format
type ErrInvalidEnvironmentID struct {
	ID string
}

func (e *ErrInvalidEnvironmentID) Error() string {
	return fmt.Sprintf("invalid environment ID: %s", e.ID)
}

// ErrInstanceNotFound indicates the requested gadget instance does not exist
type ErrInstanceNotFound struct {
	ID string
}

func (e *ErrInstanceNotFound) Error() string {
	return fmt.Sprintf("instance not found: %s", e.ID)
}

// ErrInvalidRuntime indicates an unsupported runtime type
type ErrInvalidRuntime struct {
	Runtime string
}

func (e *ErrInvalidRuntime) Error() string {
	return fmt.Sprintf("invalid runtime: %s", e.Runtime)
}

// ErrInvalidRequest indicates malformed request data
type ErrInvalidRequest struct {
	Reason string
}

func (e *ErrInvalidRequest) Error() string {
	return fmt.Sprintf("invalid request: %s", e.Reason)
}
