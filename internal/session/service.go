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

package session

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/google/uuid"
)

// Service manages session recording operations
type Service struct {
	baseDir    string
	indexDB    *IndexDB
	activeRuns map[string]*activeRun // instanceID -> active gadget run
	mu         sync.RWMutex
}

// activeRun tracks an in-progress gadget run
type activeRun struct {
	run        *GadgetRun
	sessionDB  *SessionDB
	insertStmt *sql.Stmt
	eventCount int
}

// NewService creates a new session service
func NewService(baseDir string) (*Service, error) {
	// Initialize index database
	indexDB, err := NewIndexDB(baseDir)
	if err != nil {
		return nil, fmt.Errorf("initializing index database: %w", err)
	}

	return &Service{
		baseDir:    baseDir,
		indexDB:    indexDB,
		activeRuns: make(map[string]*activeRun),
	}, nil
}

// Close closes the service and all active sessions
func (s *Service) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Close all active runs
	for _, ar := range s.activeRuns {
		if ar.insertStmt != nil {
			ar.insertStmt.Close()
		}
		if ar.sessionDB != nil {
			ar.sessionDB.Close()
		}
	}

	// Clear active runs
	s.activeRuns = make(map[string]*activeRun)

	// Close index database
	if s.indexDB != nil {
		return s.indexDB.Close()
	}

	return nil
}

// getActiveSessionDB returns the SessionDB for a session if it's actively recording, nil otherwise.
// Caller must hold s.mu (read or write lock).
func (s *Service) getActiveSessionDB(sessionID string) *SessionDB {
	for _, ar := range s.activeRuns {
		if ar.run.SessionID == sessionID {
			return ar.sessionDB
		}
	}
	return nil
}

// withSessionDB executes fn with an open SessionDB, handling opening/closing as needed.
// If the session is actively recording, uses the existing connection.
// Otherwise opens temporarily and closes after fn completes.
func withSessionDB[T any](s *Service, sessionID string, fn func(*SessionDB) (T, error)) (T, error) {
	var zero T

	s.mu.RLock()
	activeSessionDB := s.getActiveSessionDB(sessionID)
	s.mu.RUnlock()

	if activeSessionDB != nil {
		return fn(activeSessionDB)
	}

	sessionDB, err := OpenSessionDB(s.baseDir, sessionID)
	if err != nil {
		return zero, fmt.Errorf("opening session database: %w", err)
	}
	defer sessionDB.Close()

	return fn(sessionDB)
}

// CreateSession creates a new session file and index entry
func (s *Service) CreateSession(name string, environmentID string) (string, error) {
	// Generate UUID for sessionID
	sessionID := uuid.New().String()

	// Generate default name if not provided
	if name == "" {
		name = time.Now().Format("2006-01-02_15-04-05")
	}

	// Create Session struct with timestamps
	now := time.Now().UnixMilli()
	sess := &Session{
		ID:            sessionID,
		Name:          name,
		EnvironmentID: environmentID,
		CreatedAt:     now,
		UpdatedAt:     now,
		RunCount:      0,
	}

	// Create session DB file
	sessionDB, err := CreateSessionDB(s.baseDir, sess)
	if err != nil {
		return "", fmt.Errorf("creating session database: %w", err)
	}

	// Close the session DB immediately (will be reopened when needed)
	if err := sessionDB.Close(); err != nil {
		return "", fmt.Errorf("closing session database: %w", err)
	}

	// Add entry to index DB
	if err := s.indexDB.AddSession(sess); err != nil {
		return "", fmt.Errorf("adding session to index: %w", err)
	}

	return sessionID, nil
}

// StartGadgetRun starts a new gadget run in an existing session
func (s *Service) StartGadgetRun(
	instanceID string,
	sessionID string,
	gadgetImage string,
	params map[string]string,
	gadgetInfo []byte,
) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	runID := uuid.New().String()

	// Reuse existing SessionDB or open new one
	sessionDB := s.getActiveSessionDB(sessionID)
	isNewConnection := sessionDB == nil
	if isNewConnection {
		var err error
		sessionDB, err = OpenSessionDB(s.baseDir, sessionID)
		if err != nil {
			return "", fmt.Errorf("opening session database: %w", err)
		}
	}

	now := time.Now().UnixMilli()
	run := &GadgetRun{
		ID:          runID,
		SessionID:   sessionID,
		GadgetImage: gadgetImage,
		Params:      params,
		GadgetInfo:  gadgetInfo,
		StartedAt:   now,
		StoppedAt:   0,
		EventCount:  0,
	}

	if err := sessionDB.CreateGadgetRun(run); err != nil {
		if isNewConnection {
			sessionDB.Close()
		}
		return "", fmt.Errorf("creating gadget run: %w", err)
	}

	insertStmt, err := sessionDB.PrepareEventInsert()
	if err != nil {
		if isNewConnection {
			sessionDB.Close()
		}
		return "", fmt.Errorf("preparing event insert statement: %w", err)
	}

	// Store in activeRuns[instanceID]
	s.activeRuns[instanceID] = &activeRun{
		run:        run,
		sessionDB:  sessionDB,
		insertStmt: insertStmt,
		eventCount: 0,
	}

	// Update index: run_count++, updated_at = now
	indexSess, err := s.indexDB.GetSession(sessionID)
	if err != nil {
		return "", fmt.Errorf("getting session from index: %w", err)
	}

	indexSess.RunCount++
	indexSess.UpdatedAt = now

	if err := s.indexDB.UpdateSession(indexSess); err != nil {
		return "", fmt.Errorf("updating session in index: %w", err)
	}

	return runID, nil
}

// WriteEvent writes an event to an active gadget run.
// Returns nil if instanceID is not recording (no-op).
func (s *Service) WriteEvent(instanceID string, eventType int, datasourceID string, data []byte) error {
	s.mu.RLock()
	ar, exists := s.activeRuns[instanceID]
	s.mu.RUnlock()

	if !exists {
		return nil
	}

	now := time.Now().UnixMilli()
	if _, err := ar.insertStmt.Exec(ar.run.ID, now, eventType, datasourceID, data); err != nil {
		return fmt.Errorf("inserting event: %w", err)
	}

	s.mu.Lock()
	ar.eventCount++
	s.mu.Unlock()

	return nil
}

// StopGadgetRun finalizes a gadget run and potentially closes the session DB.
// Returns nil if instanceID is not recording (no-op).
func (s *Service) StopGadgetRun(instanceID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	ar, exists := s.activeRuns[instanceID]
	if !exists {
		return nil
	}

	now := time.Now().UnixMilli()
	if err := ar.sessionDB.FinalizeGadgetRun(ar.run.ID, now, ar.eventCount); err != nil {
		return fmt.Errorf("finalizing gadget run: %w", err)
	}

	if ar.insertStmt != nil {
		if err := ar.insertStmt.Close(); err != nil {
			return fmt.Errorf("closing prepared statement: %w", err)
		}
	}

	indexSess, err := s.indexDB.GetSession(ar.run.SessionID)
	if err != nil {
		return fmt.Errorf("getting session from index: %w", err)
	}
	indexSess.UpdatedAt = now
	if err := s.indexDB.UpdateSession(indexSess); err != nil {
		return fmt.Errorf("updating session in index: %w", err)
	}

	sessionID := ar.run.SessionID
	delete(s.activeRuns, instanceID)

	// Close session DB if no other active runs using it
	if s.getActiveSessionDB(sessionID) == nil {
		if err := ar.sessionDB.Close(); err != nil {
			return fmt.Errorf("closing session database: %w", err)
		}
	}

	return nil
}

// IsRecording returns true if the given instance is currently recording
func (s *Service) IsRecording(instanceID string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()

	_, exists := s.activeRuns[instanceID]
	return exists
}

// GetRunID returns the run ID for the given instance, or empty string if not recording
func (s *Service) GetRunID(instanceID string) string {
	s.mu.RLock()
	defer s.mu.RUnlock()

	ar, exists := s.activeRuns[instanceID]
	if !exists {
		return ""
	}

	return ar.run.ID
}

// GetSessionID returns the session ID for the given instance, or empty string if not recording
func (s *Service) GetSessionID(instanceID string) string {
	s.mu.RLock()
	defer s.mu.RUnlock()

	ar, exists := s.activeRuns[instanceID]
	if !exists {
		return ""
	}

	return ar.run.SessionID
}

// ListSessionsForEnvironment returns all sessions for a given environment
func (s *Service) ListSessionsForEnvironment(envID string) ([]Session, error) {
	return s.indexDB.ListByEnvironment(envID)
}

// SessionWithRuns includes full gadget run list for replay
type SessionWithRuns struct {
	Session
	Runs []GadgetRun `json:"runs"`
}

// GetSession retrieves a session with all its gadget runs
func (s *Service) GetSession(sessionID string) (*SessionWithRuns, error) {
	return withSessionDB(s, sessionID, func(db *SessionDB) (*SessionWithRuns, error) {
		sess, err := db.GetSession()
		if err != nil {
			return nil, fmt.Errorf("getting session metadata: %w", err)
		}

		runs, err := db.ListGadgetRuns()
		if err != nil {
			return nil, fmt.Errorf("listing gadget runs: %w", err)
		}

		return &SessionWithRuns{Session: *sess, Runs: runs}, nil
	})
}

// GetGadgetRun retrieves a single gadget run including GadgetInfo bytes
func (s *Service) GetGadgetRun(sessionID, runID string) (*GadgetRun, error) {
	return withSessionDB(s, sessionID, func(db *SessionDB) (*GadgetRun, error) {
		run, err := db.GetGadgetRun(runID)
		if err != nil {
			return nil, fmt.Errorf("getting gadget run: %w", err)
		}
		return run, nil
	})
}

// GetRunEvents retrieves all events for a gadget run (for replay)
func (s *Service) GetRunEvents(sessionID, runID string) ([]RecordedEvent, error) {
	return withSessionDB(s, sessionID, func(db *SessionDB) ([]RecordedEvent, error) {
		events, err := db.GetRunEvents(runID)
		if err != nil {
			return nil, fmt.Errorf("getting run events: %w", err)
		}
		return events, nil
	})
}

// DeleteSession removes a session file and index entry
func (s *Service) DeleteSession(sessionID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.getActiveSessionDB(sessionID) != nil {
		return fmt.Errorf("cannot delete session: gadget run is currently active")
	}

	// Delete from index database first
	if err := s.indexDB.DeleteSession(sessionID); err != nil {
		return fmt.Errorf("deleting from index: %w", err)
	}

	// Delete the session .db file from filesystem
	dbPath := filepath.Join(s.baseDir, fmt.Sprintf("%s.db", sessionID))
	if err := os.Remove(dbPath); err != nil {
		// If file doesn't exist, that's okay (index might be out of sync)
		if !os.IsNotExist(err) {
			return fmt.Errorf("deleting session file: %w", err)
		}
	}

	return nil
}

// ListSessions returns all sessions for a given environment, sorted by update time
func (s *Service) ListSessions(environmentID string) ([]Session, error) {
	return s.indexDB.ListByEnvironment(environmentID)
}

// VerifyIndex checks index consistency with actual files and fixes discrepancies
func (s *Service) VerifyIndex() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// List all .db files in sessions directory (excluding index.db)
	entries, err := os.ReadDir(s.baseDir)
	if err != nil {
		return fmt.Errorf("reading sessions directory: %w", err)
	}

	// Build set of session IDs from files
	filesOnDisk := make(map[string]bool)
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		// Skip index.db
		if name == "index.db" {
			continue
		}
		// Check if it's a session file (.db extension)
		if filepath.Ext(name) == ".db" {
			sessionID := name[:len(name)-3] // Remove .db extension
			filesOnDisk[sessionID] = true
		}
	}

	// Get all sessions from index (query across all environments)
	// We need to add a method to get all sessions from index
	indexSessions, err := s.indexDB.ListAll()
	if err != nil {
		return fmt.Errorf("listing all sessions from index: %w", err)
	}

	// Build set of session IDs from index
	inIndex := make(map[string]*Session)
	for i := range indexSessions {
		inIndex[indexSessions[i].ID] = &indexSessions[i]
	}

	// Remove orphaned index entries (file deleted externally)
	for sessionID := range inIndex {
		if !filesOnDisk[sessionID] {
			if err := s.indexDB.DeleteSession(sessionID); err != nil {
				return fmt.Errorf("removing orphaned index entry %s: %w", sessionID, err)
			}
		}
	}

	// Add missing entries (file added externally)
	for sessionID := range filesOnDisk {
		if _, exists := inIndex[sessionID]; !exists {
			// Open the session DB to read metadata
			sessionDB, err := OpenSessionDB(s.baseDir, sessionID)
			if err != nil {
				// Skip files that can't be opened
				continue
			}

			sess, err := sessionDB.GetSession()
			sessionDB.Close()

			if err != nil {
				// Skip files with invalid metadata
				continue
			}

			// Add to index
			if err := s.indexDB.AddSession(sess); err != nil {
				return fmt.Errorf("adding missing index entry %s: %w", sessionID, err)
			}
		}
	}

	return nil
}
