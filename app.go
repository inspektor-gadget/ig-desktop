package main

import (
	"context"
	"log"

	"github.com/wailsapp/wails/v3/pkg/application"

	"ig-frontend/internal/api/handlers"
	"ig-frontend/internal/artifacthub"
	"ig-frontend/internal/config"
	"ig-frontend/internal/environment"
	"ig-frontend/internal/gadget"
	"ig-frontend/internal/session"
)

// App struct
type App struct {
	ctx     context.Context
	handler *handlers.Handler
}

// NewApp creates a new App application struct
func NewApp() *App {
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

	return &App{
		ctx:     ctx,
		handler: handler,
	}
}

// Run initializes the event handlers with the Wails application
func (a *App) Run(app *application.App) {
	// Register all handlers
	a.handler.Register(app)
}
