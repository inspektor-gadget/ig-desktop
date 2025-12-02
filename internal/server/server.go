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

package server

import (
	"context"
	"io/fs"
	"log"
	"net/http"
	"sync"

	"github.com/coder/websocket"

	"ig-frontend/internal/api/transport"
	"ig-frontend/internal/app"
)

// Server provides HTTP and WebSocket server functionality for
// browser-based access to Inspektor Gadget.
type Server struct {
	shared     *app.SharedServices
	assets     fs.FS
	mux        *http.ServeMux
	httpServer *http.Server
	clients    map[transport.Transport]struct{}
	clientsMu  sync.Mutex
	listenAddr string

	// AllowedOrigins specifies which origins are allowed for WebSocket connections.
	// If empty, all origins are allowed (not recommended for production).
	AllowedOrigins []string
}

// Config holds server configuration options.
type Config struct {
	// ListenAddr is the address to listen on (e.g., ":8080" or "127.0.0.1:8080")
	ListenAddr string

	// Assets is the filesystem containing the static frontend files
	Assets fs.FS

	// AllowedOrigins specifies which origins are allowed for WebSocket connections.
	// If empty, all origins are allowed (not recommended for production).
	AllowedOrigins []string
}

// New creates a new HTTP server with the given configuration.
func New(cfg Config) *Server {
	s := &Server{
		shared:         app.NewSharedServices(),
		assets:         cfg.Assets,
		mux:            http.NewServeMux(),
		clients:        make(map[transport.Transport]struct{}),
		listenAddr:     cfg.ListenAddr,
		AllowedOrigins: cfg.AllowedOrigins,
	}

	// Set up routes
	s.setupRoutes()

	return s
}

// setupRoutes configures the HTTP routes.
func (s *Server) setupRoutes() {
	// WebSocket endpoint
	s.mux.HandleFunc("/api/v1/ws", s.handleWebSocket)

	// Static file server for the frontend
	// Use a custom handler to serve index.html for SPA routing
	s.mux.Handle("/", s.spaHandler())
}

// spaHandler returns an HTTP handler that serves static files and falls back
// to index.html for SPA routing.
func (s *Server) spaHandler() http.Handler {
	fileServer := http.FileServer(http.FS(s.assets))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Try to serve the file directly
		path := r.URL.Path
		if path == "/" {
			path = "/index.html"
		}

		// Check if file exists
		f, err := s.assets.Open(path[1:]) // Remove leading slash
		if err != nil {
			// File doesn't exist, serve index.html for SPA routing
			r.URL.Path = "/"
			fileServer.ServeHTTP(w, r)
			return
		}
		f.Close()

		// File exists, serve it
		fileServer.ServeHTTP(w, r)
	})
}

// handleWebSocket handles WebSocket upgrade requests.
func (s *Server) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	// Configure WebSocket accept options
	acceptOpts := &websocket.AcceptOptions{}
	if len(s.AllowedOrigins) > 0 {
		acceptOpts.OriginPatterns = s.AllowedOrigins
	} else {
		// Allow all origins if none specified (development mode)
		acceptOpts.InsecureSkipVerify = true
	}

	conn, err := websocket.Accept(w, r, acceptOpts)
	if err != nil {
		log.Printf("server: failed to accept websocket: %v", err)
		return
	}

	log.Printf("server: new websocket connection from %s", r.RemoteAddr)

	// Create transport for this connection
	ctx := r.Context()
	wsTransport := NewWebSocketTransport(ctx, conn)

	// Track the client
	s.clientsMu.Lock()
	s.clients[wsTransport] = struct{}{}
	s.clientsMu.Unlock()

	// Clean up when done
	defer func() {
		s.clientsMu.Lock()
		delete(s.clients, wsTransport)
		s.clientsMu.Unlock()
		wsTransport.Close()
		log.Printf("server: websocket connection closed from %s", r.RemoteAddr)
	}()

	// Create per-connection services to ensure messages go to the correct client
	connServices := s.shared.NewConnectionServices()

	// Register handlers with this transport
	connServices.Handler.Register(wsTransport)

	// Start blocks until the connection is closed
	if err := wsTransport.Start(); err != nil {
		log.Printf("server: websocket error from %s: %v", r.RemoteAddr, err)
	}
}

// ListenAndServe starts the HTTP server.
func (s *Server) ListenAndServe() error {
	log.Printf("server: starting on %s", s.listenAddr)
	s.httpServer = &http.Server{
		Addr:    s.listenAddr,
		Handler: s.mux,
	}
	return s.httpServer.ListenAndServe()
}

// Shutdown gracefully shuts down the server.
func (s *Server) Shutdown(ctx context.Context) error {
	// Use background context if none provided
	if ctx == nil {
		ctx = context.Background()
	}

	// Close all WebSocket client connections first
	s.clientsMu.Lock()
	for client := range s.clients {
		client.Close()
	}
	s.clientsMu.Unlock()

	// Shutdown the HTTP server
	if s.httpServer != nil {
		return s.httpServer.Shutdown(ctx)
	}
	return nil
}
