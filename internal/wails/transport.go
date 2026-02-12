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

// Package wails provides the Wails-based transport implementation
// for desktop application communication. This package imports the
// Wails SDK and should only be used by the desktop entrypoint.
package wails

import (
	"encoding/json"
	"log"

	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/inspektor-gadget/ig-desktop/pkg/api/transport"
)

// Transport implements transport.Transport using Wails events
// for communication between the Go backend and the SvelteKit frontend
// in a desktop application context.
type Transport struct {
	app            *application.App
	messageHandler func(string)
}

// NewTransport creates a new Wails transport wrapping the given application.
func NewTransport(app *application.App) transport.Transport {
	return &Transport{
		app: app,
	}
}

// Send sends a message to the frontend via Wails events.
// The message is JSON-marshaled and emitted on the "client" channel.
// Note: Wails event emission is thread-safe internally.
func (t *Transport) Send(message any) error {
	data, err := json.Marshal(message)
	if err != nil {
		return err
	}

	t.app.Event.Emit("client", string(data))
	return nil
}

// OnMessage sets the handler function that will be called
// when messages are received from the frontend.
func (t *Transport) OnMessage(handler func(message string)) {
	t.messageHandler = handler
}

// Start begins listening for messages from the frontend on the "server" channel.
// This sets up the Wails event listener and is non-blocking.
func (t *Transport) Start() error {
	t.app.Event.On("server", func(event *application.CustomEvent) {
		str, ok := event.Data.(string)
		if !ok {
			log.Printf("wails transport: message not of type string: %T", event.Data)
			return
		}

		log.Printf("wails transport: received message: %s", str)

		if t.messageHandler != nil {
			t.messageHandler(str)
		}
	})

	return nil
}

// Close is a no-op for Wails transport as the event system is managed
// by the Wails application lifecycle.
func (t *Transport) Close() error {
	return nil
}
