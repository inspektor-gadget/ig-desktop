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

// Package server provides HTTP and WebSocket server functionality
// for browser-based access to Inspektor Gadget. This package has
// no Wails dependencies.
package server

import (
	"context"
	"encoding/json"
	"log"
	"sync"

	"github.com/coder/websocket"

	"ig-frontend/internal/api/transport"
)

// WebSocketTransport implements transport.Transport using WebSocket
// for communication between the Go backend and browser-based frontend.
type WebSocketTransport struct {
	conn           *websocket.Conn
	ctx            context.Context
	cancel         context.CancelFunc
	messageHandler func(string)
	mu             sync.Mutex
	closed         bool
}

// NewWebSocketTransport creates a new WebSocket transport wrapping the given connection.
func NewWebSocketTransport(ctx context.Context, conn *websocket.Conn) transport.Transport {
	ctx, cancel := context.WithCancel(ctx)
	return &WebSocketTransport{
		conn:   conn,
		ctx:    ctx,
		cancel: cancel,
	}
}

// Send sends a message to the browser client via WebSocket.
// The message is JSON-marshaled before sending.
func (t *WebSocketTransport) Send(message any) error {
	t.mu.Lock()
	defer t.mu.Unlock()

	if t.closed {
		return nil
	}

	data, err := json.Marshal(message)
	if err != nil {
		return err
	}

	return t.conn.Write(t.ctx, websocket.MessageText, data)
}

// OnMessage sets the handler function that will be called
// when messages are received from the browser client.
func (t *WebSocketTransport) OnMessage(handler func(message string)) {
	t.messageHandler = handler
}

// Start begins listening for messages from the browser client.
// This is a blocking call that runs until the connection is closed.
func (t *WebSocketTransport) Start() error {
	for {
		msgType, data, err := t.conn.Read(t.ctx)
		if err != nil {
			// Check if context was cancelled (normal shutdown)
			if t.ctx.Err() != nil {
				return nil
			}
			log.Printf("websocket transport: read error: %v", err)
			return err
		}

		if msgType != websocket.MessageText {
			log.Printf("websocket transport: ignoring non-text message type: %v", msgType)
			continue
		}

		message := string(data)
		log.Printf("websocket transport: received message: %s", message)

		if t.messageHandler != nil {
			t.messageHandler(message)
		}
	}
}

// Close closes the WebSocket connection.
func (t *WebSocketTransport) Close() error {
	t.mu.Lock()
	defer t.mu.Unlock()

	if t.closed {
		return nil
	}
	t.closed = true

	t.cancel()
	return t.conn.Close(websocket.StatusNormalClosure, "server shutdown")
}
