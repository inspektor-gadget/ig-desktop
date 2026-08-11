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

// Package main provides the HTTP/WebSocket server entrypoint for
// browser-based access to Inspektor Gadget. This binary has no
// Wails dependencies and can be deployed as a standalone web server.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	webfrontend "github.com/inspektor-gadget/ig-desktop/frontend"
	"github.com/inspektor-gadget/ig-desktop/internal/config"
	"github.com/inspektor-gadget/ig-desktop/internal/environment"
	"github.com/inspektor-gadget/ig-desktop/internal/server"
)

type singleEnvConfig struct {
	Environment *environment.Environment `json:"environment"`
	Settings    json.RawMessage          `json:"settings,omitempty"`
}

func main() {
	listenAddr := flag.String("listen", ":8080", "Address to listen on (e.g., :8080 or 127.0.0.1:8080)")
	assetsDir := flag.String("assets", "", "Override the embedded frontend with a build directory")
	configFile := flag.String("config", "", "Single-environment JSON configuration")
	flag.Parse()

	var frontendFS fs.FS
	if *assetsDir != "" {
		frontendFS = os.DirFS(*assetsDir)
	} else {
		var err error
		frontendFS, err = webfrontend.BuildFS()
		if err != nil {
			log.Fatalf("loading embedded frontend: %v", err)
		}
	}

	if _, err := fs.Stat(frontendFS, "index.html"); err != nil {
		log.Fatalf("invalid frontend assets: %v (expected index.html)", err)
	}

	var frontendConfig []byte
	if *configFile != "" {
		envDir, err := config.GetDir("env")
		if err != nil {
			log.Fatalf("getting environment directory: %v", err)
		}
		frontendConfig, err = prepareSingleEnvConfig(*configFile, environment.NewStorage(envDir))
		if err != nil {
			log.Fatalf("loading single-environment config: %v", err)
		}
	}

	srv := server.New(server.Config{
		ListenAddr:      *listenAddr,
		Assets:          frontendFS,
		SingleEnvConfig: frontendConfig,
	})

	// Handle shutdown signals
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		<-sigChan
		log.Println("Shutting down server...")

		// Give connections 5 seconds to close gracefully
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		if err := srv.Shutdown(ctx); err != nil {
			log.Printf("shutdown error: %v", err)
		}
		os.Exit(0)
	}()

	// Start the server
	log.Printf("Starting Inspektor Gadget web server on %s", *listenAddr)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("server error: %v", err)
	}
}

func prepareSingleEnvConfig(path string, storage *environment.Storage) ([]byte, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var cfg singleEnvConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}
	if cfg.Environment == nil || cfg.Environment.Name == "" {
		return nil, fmt.Errorf("environment name is required")
	}
	switch cfg.Environment.Runtime {
	case "grpc-k8s", "grpc-ig":
	default:
		return nil, fmt.Errorf("unsupported environment runtime %q", cfg.Environment.Runtime)
	}

	if err := storage.Set(cfg.Environment); err != nil {
		return nil, err
	}
	return json.Marshal(cfg)
}
