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

// Package transport defines the interface for communication between
// the backend handlers and frontend clients. This package contains
// only the interface - implementations are in separate packages to
// avoid build dependencies (e.g., Wails should not be compiled into
// the WebSocket server).
package transport

// Transport abstracts the communication layer between backend handlers
// and frontend clients. Implementations include Wails events (for desktop)
// and WebSocket (for browser-based access).
type Transport interface {
	// Send sends a message to the connected client.
	// The message will be JSON-marshaled before sending.
	Send(message any) error

	// OnMessage sets the handler function that will be called
	// when a message is received from the client.
	OnMessage(handler func(message string))

	// Start begins listening for incoming messages.
	// This is typically a blocking call that runs in its own goroutine.
	Start() error

	// Close closes the transport connection and releases resources.
	Close() error
}
