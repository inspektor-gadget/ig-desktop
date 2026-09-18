package main

import (
	"context"
	"github.com/wailsapp/wails/v3/pkg/application"
	"log"
	"os"
	"time"

	"github.com/inspektor-gadget/ig-desktop/internal/app"
	"github.com/inspektor-gadget/ig-desktop/internal/wails"
	"github.com/inspektor-gadget/ig-desktop/pkg/fileoutput"
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
	if nativeFileOutput {
		a.configureFileOutput(wailsApp)
	}
	// Create Wails transport and register handlers
	transport := wails.NewTransport(wailsApp)
	a.services.Handler.Register(transport)
}

func (a *App) configureFileOutput(wailsApp *application.App) {
	host, _ := os.Hostname()
	outputs := fileoutput.NewManager(host)
	a.services.Handler.EnableFileOutput(outputs, false, func(format string) (*fileoutput.Selection, error) {
		extension, label := ".jsonl", "JSON Lines"
		if format == "pcap-ng" {
			extension, label = ".pcapng", "PCAP-NG"
		}
		path, err := wailsApp.Dialog.SaveFile().
			SetMessage("Save gadget capture").
			SetFilename("capture"+extension).
			AddFilter(label, "*"+extension).
			PromptForSingleSelection()
		if err != nil || path == "" {
			return nil, err
		}
		selection, err := outputs.Prepare(path, format, true)
		if err != nil || !selection.Overwrite {
			return selection, err
		}
		// Bind confirmation to the prepared fingerprint, not to whichever file
		// happens to occupy the picker pathname when Start is eventually pressed.
		answer := make(chan bool, 1)
		dialog := wailsApp.Dialog.Question().
			SetTitle("Replace existing capture file?").
			SetMessage("Replace " + selection.Path + " after this capture completes? The previous file is kept until the new capture is saved, and restored if the capture fails.")
		dialog.AddButton("Cancel").SetAsDefault().SetAsCancel().OnClick(func() { answer <- false })
		dialog.AddButton("Replace").OnClick(func() { answer <- true })
		dialog.Show()
		select {
		case approved := <-answer:
			if approved {
				return selection, nil
			}
		case <-wailsApp.Context().Done():
		}
		outputs.Release(selection.Token)
		return nil, nil
	})
	wailsApp.OnShutdown(func() {
		outputs.Close()
		a.services.InstanceManager.StopAll()
		ctx, cancel := context.WithTimeout(context.Background(), 35*time.Second)
		defer cancel()
		if err := a.services.InstanceManager.Wait(ctx); err != nil {
			log.Printf("waiting for capture finalization: %v", err)
		}
	})
}
