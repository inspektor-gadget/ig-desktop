package main

import (
	"embed"
	"runtime"

	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:frontend/build
var assets embed.FS

//go:embed build/appicon.png
var appIcon []byte

func main() {
	igApp := NewApp()

	app := application.New(application.Options{
		Name: "Inspektor Gadget Desktop",
		Icon: appIcon,
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Services: []application.Service{
			application.NewService(igApp),
		},
	})

	// macOS: Use native titlebar with transparent appearance (native traffic lights work)
	// Windows/Linux: Use frameless with custom window controls in frontend
	windowOptions := application.WebviewWindowOptions{
		Title:     "Inspektor Gadget Desktop",
		Width:     1280,
		Height:    900,
		Frameless: runtime.GOOS != "darwin", // Frameless on Windows/Linux only
		Mac: application.MacWindow{
			TitleBar: application.MacTitleBar{
				AppearsTransparent: true,
				HideTitle:          true,
				FullSizeContent:    true,
			},
			InvisibleTitleBarHeight: 52,
		},
	}

	app.Window.NewWithOptions(windowOptions)

	igApp.Run(app)

	err := app.Run()
	if err != nil {
		println("Error:", err.Error())
	}
}
