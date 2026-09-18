// Copyright 2026 The Inspektor Gadget authors
// SPDX-License-Identifier: Apache-2.0

// ig-vscode-client is the private, headless IG Desktop backend for VS Code.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/inspektor-gadget/ig-desktop/internal/app"
	"github.com/inspektor-gadget/ig-desktop/internal/stdio"
	"github.com/inspektor-gadget/ig-desktop/internal/version"
	"github.com/inspektor-gadget/ig-desktop/pkg/fileoutput"
)

func main() {
	log.SetOutput(os.Stderr)
	if err := run(); err != nil {
		log.Printf("ig-vscode-client: %v", err)
		os.Exit(1)
	}
}

func run() error {
	flags := flag.NewFlagSet("ig-vscode-client", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	root := flags.String("data-dir", "", "required absolute application data root (separate from Desktop)")
	if err := flags.Parse(os.Args[1:]); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return err
	}
	if flags.NArg() != 0 {
		return fmt.Errorf("unexpected positional arguments")
	}
	input, output, err := stdio.StdStreams()
	if err != nil {
		return fmt.Errorf("preparing stdio: %w", err)
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	hello := map[string]any{}
	transport := stdio.New(ctx, input, output, hello)
	defer transport.Close()
	services, err := app.NewServicesWithDataDir(transport.Context(), *root)
	if err != nil {
		return err
	}
	environments, err := services.EnvStorage.List()
	if err != nil {
		if services.SessionService != nil {
			services.SessionService.Close()
		}
		return fmt.Errorf("listing environments: %w", err)
	}
	commands := []string{"clientHello", "shutdown"}
	services.Handler.EnableTransientKubernetes()
	host, _ := os.Hostname()
	outputs := fileoutput.NewManager(host)
	defer outputs.Close()
	services.Handler.EnableFileOutput(outputs, true, nil)
	shutdownWaited := false
	transport.SetShutdown(func() error {
		shutdownWaited = true
		drainCtx, stopDrain := context.WithTimeout(context.Background(), 35*time.Second)
		defer stopDrain()
		return services.InstanceManager.Wait(drainCtx)
	})
	for _, handler := range services.Handler.Handlers() {
		commands = append(commands, handler.Command())
	}
	for key, value := range map[string]any{
		"protocolVersion":    stdio.ProtocolVersion,
		"version":            version.Get(),
		"maxFrameBytes":      stdio.MaxFrameBytes,
		"maxPendingRequests": stdio.MaxPending,
		"commands":           commands,
		"environments":       environments,
		"capabilities": map[string]any{
			"fileOutput":                 outputs.Capabilities(),
			"transientKubernetesTargets": true,
			"sessions":                   services.SessionService != nil,
			"recording":                  services.SessionService != nil,
			"sessionPagination":          services.SessionService != nil,
			"sessionError":               services.SessionError,
			"duration":                   true,
			"detachedDuration":           false,
			"remoteLease":                false,
		},
	} {
		hello[key] = value
	}
	err = services.Handler.Register(transport)
	cancel()
	// The runtime allows 30s to drain final profile results after a stop request.
	drainCtx, stopDrain := context.WithTimeout(context.Background(), 35*time.Second)
	defer stopDrain()
	if !shutdownWaited {
		if waitErr := services.InstanceManager.Wait(drainCtx); waitErr != nil {
			err = errors.Join(err, fmt.Errorf("waiting for owned streams: %w", waitErr))
		}
	}
	if services.SessionService != nil {
		err = errors.Join(err, services.SessionService.Close())
	}
	return err
}
