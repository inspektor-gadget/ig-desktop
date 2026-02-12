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
	"flag"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/inspektor-gadget/ig-desktop/internal/server"
)

func main() {
	// Parse command line flags
	listenAddr := flag.String("listen", ":8080", "Address to listen on (e.g., :8080 or 127.0.0.1:8080)")
	assetsDir := flag.String("assets", "", "Path to frontend build directory (required)")
	flag.Parse()

	if *assetsDir == "" {
		log.Fatal("--assets flag is required: path to frontend build directory")
	}

	// Use the filesystem directory for assets
	frontendFS := os.DirFS(*assetsDir)

	// Verify the assets directory exists and has index.html
	if _, err := fs.Stat(frontendFS, "index.html"); err != nil {
		log.Fatalf("invalid assets directory %q: %v (expected index.html)", *assetsDir, err)
	}

	// Create and configure the server
	srv := server.New(server.Config{
		ListenAddr: *listenAddr,
		Assets:     frontendFS,
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
	log.Printf("Serving frontend from %s", *assetsDir)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("server error: %v", err)
	}
}
