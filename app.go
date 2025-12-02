package main

import (
	"github.com/wailsapp/wails/v3/pkg/application"

	"ig-frontend/internal/app"
	"ig-frontend/internal/wails"
)

// App struct wraps the shared services for the Wails desktop application.
type App struct {
	services *app.Services
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{
		services: app.NewServices(),
	}
}

// Run initializes the event handlers with the Wails application
func (a *App) Run(wailsApp *application.App) {
	// Create Wails transport and register handlers
	transport := wails.NewTransport(wailsApp)
	a.services.Handler.Register(transport)
}
