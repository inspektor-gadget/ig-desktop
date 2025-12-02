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
	"context"
	"encoding/json"
	"log"
	"sync"

	"ig-frontend/internal/api"
	"ig-frontend/internal/api/transport"
	"ig-frontend/internal/artifacthub"
	"ig-frontend/internal/environment"
	"ig-frontend/internal/gadget"
	"ig-frontend/internal/session"
)

// Handler coordinates all command handlers
type Handler struct {
	ctx             context.Context
	envStorage      *environment.Storage
	runtimeFactory  *environment.RuntimeFactory
	gadgetService   *gadget.Service
	instanceManager *gadget.InstanceManager
	artifactHub     *artifacthub.Client
	sessionService  *session.Service

	mu   sync.Mutex
	send func(any)
}

// commandHandler wraps a command name and handler function to implement CommandHandler
type commandHandler struct {
	cmd string
	fn  func(*api.Event)
}

func (ch commandHandler) Command() string {
	return ch.cmd
}

func (ch commandHandler) Handle(ev *api.Event) {
	ch.fn(ev)
}

// New creates a new handler with all dependencies
func New(
	ctx context.Context,
	envStorage *environment.Storage,
	runtimeFactory *environment.RuntimeFactory,
	gadgetService *gadget.Service,
	instanceManager *gadget.InstanceManager,
	artifactHub *artifacthub.Client,
	sessionService *session.Service,
) *Handler {
	return &Handler{
		ctx:             ctx,
		envStorage:      envStorage,
		runtimeFactory:  runtimeFactory,
		gadgetService:   gadgetService,
		instanceManager: instanceManager,
		artifactHub:     artifactHub,
		sessionService:  sessionService,
	}
}

// Handlers returns all registered command handlers
func (h *Handler) Handlers() []api.CommandHandler {
	return []api.CommandHandler{
		commandHandler{"helo", h.HandleHelo},
		commandHandler{"removeInstance", h.HandleRemoveInstance},
		commandHandler{"stopInstance", h.HandleStopInstance},
		commandHandler{"runGadget", h.HandleRunGadget},
		commandHandler{"attachInstance", h.HandleAttachInstance},
		commandHandler{"getRuntimes", h.HandleGetRuntimes},
		commandHandler{"getRuntimeParams", h.HandleGetRuntimeParams},
		commandHandler{"listInstances", h.HandleListInstances},
		commandHandler{"getGadgetInfo", h.HandleGetGadgetInfo},
		commandHandler{"createEnvironment", h.HandleCreateEnvironment},
		commandHandler{"deleteEnvironment", h.HandleDeleteEnvironment},
		commandHandler{"getArtifactHubPackage", h.HandleGetArtifactHubPackage},
		commandHandler{"checkIGDeployment", h.HandleCheckIGDeployment},
		commandHandler{"deployIG", h.HandleDeployIG},
		commandHandler{"getK8sNodes", h.HandleGetK8sNodes},
		commandHandler{"getK8sPods", h.HandleGetK8sPods},
		commandHandler{"getK8sNamespaces", h.HandleGetK8sNamespaces},
		commandHandler{"getK8sContainers", h.HandleGetK8sContainers},
		commandHandler{"getK8sLabels", h.HandleGetK8sLabels},
		commandHandler{"getVersion", h.HandleGetVersion},
		commandHandler{"checkForUpdates", h.HandleCheckForUpdates},
		commandHandler{"listSessions", h.HandleListSessions},
		commandHandler{"getSession", h.HandleGetSession},
		commandHandler{"getGadgetRun", h.HandleGetGadgetRun},
		commandHandler{"getRunEvents", h.HandleGetRunEvents},
		commandHandler{"deleteSession", h.HandleDeleteSession},
	}
}

// Register registers all event handlers with the given transport.
// The transport abstracts the communication layer (Wails events, WebSocket, etc.)
func (h *Handler) Register(t transport.Transport) {
	h.send = func(ev any) {
		h.mu.Lock()
		defer h.mu.Unlock()
		if err := t.Send(ev); err != nil {
			log.Printf("handler: failed to send message: %v", err)
		}
	}

	// Set the send function on the gadget service
	if h.gadgetService != nil {
		h.gadgetService.SetSendFunc(h.send)
	}

	// Build handler map from registered handlers
	handlerMap := make(map[string]api.CommandHandler)
	for _, handler := range h.Handlers() {
		handlerMap[handler.Command()] = handler
	}

	// Set up message handler for incoming commands
	t.OnMessage(func(message string) {
		ev := &api.Event{}

		log.Printf("handler: received message: %s", message)

		err := json.Unmarshal([]byte(message), &ev)
		if err != nil {
			log.Printf("handler: failed to unmarshal message: %v", err)
			return
		}
		log.Printf("handler: parsed event: %+v", ev)

		ev.Type = api.TypeCommandResponse

		// Route to appropriate handler
		if handler, ok := handlerMap[ev.Command]; ok {
			handler.Handle(ev)
		} else {
			log.Printf("handler: unknown command: %s", ev.Command)
		}
	})

	// Start listening for messages
	if err := t.Start(); err != nil {
		log.Printf("handler: failed to start transport: %v", err)
	}
}
