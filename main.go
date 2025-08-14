package main

import (
	"embed"

	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:frontend/build
var assets embed.FS

func main() {
	igApp := NewApp()

	app := application.New(application.Options{
		Name: "Inspektor Gadget Desktop",
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Services: []application.Service{
			application.NewService(igApp),
		},
	})

	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:     "Inspektor Gadget Desktop",
		Width:     1024,
		Height:    768,
		Frameless: true,
	})

	igApp.Run(app)

	err := app.Run()
	if err != nil {
		println("Error:", err.Error())
	}
}
