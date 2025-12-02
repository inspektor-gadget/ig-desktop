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

// Package app provides shared application initialization logic.
// This package contains no Wails dependencies and can be used by
// both the desktop application and the web server.
package app

import (
	"context"
	"log"

	"ig-frontend/internal/api/handlers"
	"ig-frontend/internal/artifacthub"
	"ig-frontend/internal/config"
	"ig-frontend/internal/environment"
	"ig-frontend/internal/gadget"
	"ig-frontend/internal/session"
)

// Services holds the shared backend services used by the application.
// For multi-client scenarios (WebSocket server), use NewConnectionServices()
// to create per-connection service instances.
type Services struct {
	Ctx             context.Context
	EnvStorage      *environment.Storage
	RuntimeFactory  *environment.RuntimeFactory
	InstanceManager *gadget.InstanceManager
	GadgetService   *gadget.Service
	ArtifactHub     *artifacthub.Client
	SessionService  *session.Service
	Handler         *handlers.Handler
}

// NewServices creates and initializes all backend services.
// This factory function is used by the Wails desktop app where
// there is only a single client connection.
func NewServices() *Services {
	ctx := context.Background()

	// Initialize storage and services
	envStorage := environment.NewStorage()
	runtimeFactory := environment.NewRuntimeFactory(envStorage)
	instanceManager := gadget.NewInstanceManager()
	gadgetService := gadget.NewService(runtimeFactory, instanceManager)
	artifactHubClient := artifacthub.NewClient()

	// Initialize session service
	var sessionService *session.Service
	sessionsDir, err := config.GetDir("sessions")
	if err != nil {
		log.Printf("failed to get sessions directory: %v (session recording will be disabled)", err)
	} else {
		sessionService, err = session.NewService(sessionsDir)
		if err != nil {
			log.Printf("failed to initialize session service: %v (session recording will be disabled)", err)
			sessionService = nil
		} else {
			gadgetService.SetSessionService(sessionService)
		}
	}

	// Create handler with all dependencies (send function will be set in Register)
	handler := handlers.New(
		ctx,
		envStorage,
		runtimeFactory,
		gadgetService,
		instanceManager,
		artifactHubClient,
		sessionService,
	)

	return &Services{
		Ctx:             ctx,
		EnvStorage:      envStorage,
		RuntimeFactory:  runtimeFactory,
		InstanceManager: instanceManager,
		GadgetService:   gadgetService,
		ArtifactHub:     artifactHubClient,
		SessionService:  sessionService,
		Handler:         handler,
	}
}

// SharedServices holds services that can be safely shared across multiple
// client connections. Used by the WebSocket server.
type SharedServices struct {
	ctx            context.Context
	envStorage     *environment.Storage
	runtimeFactory *environment.RuntimeFactory
	artifactHub    *artifacthub.Client
	sessionService *session.Service
}

// NewSharedServices creates shared services for multi-client scenarios.
// Call NewConnectionServices() to create per-connection instances.
func NewSharedServices() *SharedServices {
	ctx := context.Background()

	// Initialize shared storage and services
	envStorage := environment.NewStorage()
	runtimeFactory := environment.NewRuntimeFactory(envStorage)
	artifactHubClient := artifacthub.NewClient()

	// Initialize session service
	var sessionService *session.Service
	sessionsDir, err := config.GetDir("sessions")
	if err != nil {
		log.Printf("failed to get sessions directory: %v (session recording will be disabled)", err)
	} else {
		sessionService, err = session.NewService(sessionsDir)
		if err != nil {
			log.Printf("failed to initialize session service: %v (session recording will be disabled)", err)
			sessionService = nil
		}
	}

	return &SharedServices{
		ctx:            ctx,
		envStorage:     envStorage,
		runtimeFactory: runtimeFactory,
		artifactHub:    artifactHubClient,
		sessionService: sessionService,
	}
}

// ConnectionServices holds per-connection service instances.
// Each WebSocket connection gets its own ConnectionServices to ensure
// messages are routed to the correct client.
type ConnectionServices struct {
	InstanceManager *gadget.InstanceManager
	GadgetService   *gadget.Service
	Handler         *handlers.Handler
}

// NewConnectionServices creates per-connection service instances.
// The gadget service and handler are unique per connection to ensure
// gadget output is sent to the correct client.
func (s *SharedServices) NewConnectionServices() *ConnectionServices {
	// Each connection gets its own instance manager and gadget service
	// so that gadget output goes to the correct client
	instanceManager := gadget.NewInstanceManager()
	gadgetService := gadget.NewService(s.runtimeFactory, instanceManager)

	if s.sessionService != nil {
		gadgetService.SetSessionService(s.sessionService)
	}

	// Create handler with per-connection gadget service
	handler := handlers.New(
		s.ctx,
		s.envStorage,
		s.runtimeFactory,
		gadgetService,
		instanceManager,
		s.artifactHub,
		s.sessionService,
	)

	return &ConnectionServices{
		InstanceManager: instanceManager,
		GadgetService:   gadgetService,
		Handler:         handler,
	}
}
