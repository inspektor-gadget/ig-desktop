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
	"encoding/json"
	"fmt"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite"
)

// SessionDB manages a single session database file
type SessionDB struct {
	db        *sql.DB
	dbPath    string
	sessionID string
}

// OpenSessionDB opens an existing session database file
func OpenSessionDB(baseDir, sessionID string) (*SessionDB, error) {
	dbPath := filepath.Join(baseDir, fmt.Sprintf("%s.db", sessionID))

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("opening session database: %w", err)
	}

	sdb := &SessionDB{
		db:        db,
		dbPath:    dbPath,
		sessionID: sessionID,
	}

	return sdb, nil
}

// CreateSessionDB creates a new session database file and initializes it
func CreateSessionDB(baseDir string, sess *Session) (*SessionDB, error) {
	dbPath := filepath.Join(baseDir, fmt.Sprintf("%s.db", sess.ID))

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("creating session database: %w", err)
	}

	sdb := &SessionDB{
		db:        db,
		dbPath:    dbPath,
		sessionID: sess.ID,
	}

	// Initialize schema
	if err := sdb.initSchema(); err != nil {
		db.Close()
		return nil, err
	}

	// Insert session metadata
	query := `
		INSERT INTO session (id, name, environment_id, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?)
	`

	_, err = db.Exec(query, sess.ID, sess.Name, sess.EnvironmentID, sess.CreatedAt, sess.UpdatedAt)
	if err != nil {
		db.Close()
		return nil, fmt.Errorf("inserting session metadata: %w", err)
	}

	return sdb, nil
}

// Close closes the database connection
func (sdb *SessionDB) Close() error {
	if sdb.db != nil {
		return sdb.db.Close()
	}
	return nil
}

// GetPath returns the file path of the session database
func (sdb *SessionDB) GetPath() string {
	return sdb.dbPath
}

// initSchema creates all tables and indexes for the session file
func (sdb *SessionDB) initSchema() error {
	schema := `
		-- Session metadata (one row per file)
		CREATE TABLE IF NOT EXISTS session (
			id TEXT PRIMARY KEY,
			name TEXT,
			environment_id TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		);

		-- Multiple gadget runs per session
		CREATE TABLE IF NOT EXISTS gadget_runs (
			id TEXT PRIMARY KEY,
			session_id TEXT NOT NULL,
			gadget_image TEXT NOT NULL,
			params TEXT,
			gadget_info BLOB,
			started_at INTEGER,
			stopped_at INTEGER,
			event_count INTEGER DEFAULT 0,
			FOREIGN KEY (session_id) REFERENCES session(id)
		);

		-- Events stream (linked to gadget run)
		CREATE TABLE IF NOT EXISTS events (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			run_id TEXT NOT NULL,
			timestamp INTEGER NOT NULL,
			type INTEGER NOT NULL,
			datasource_id TEXT,
			data BLOB NOT NULL,
			FOREIGN KEY (run_id) REFERENCES gadget_runs(id)
		);

		CREATE INDEX IF NOT EXISTS idx_events_run ON events(run_id, timestamp);
		CREATE INDEX IF NOT EXISTS idx_runs_session ON gadget_runs(session_id, started_at);
	`

	_, err := sdb.db.Exec(schema)
	if err != nil {
		return fmt.Errorf("initializing session schema: %w", err)
	}

	return nil
}

// GetSession retrieves the session metadata
func (sdb *SessionDB) GetSession() (*Session, error) {
	query := `
		SELECT id, name, environment_id, created_at, updated_at
		FROM session
		WHERE id = ?
	`

	var sess Session
	err := sdb.db.QueryRow(query, sdb.sessionID).Scan(
		&sess.ID,
		&sess.Name,
		&sess.EnvironmentID,
		&sess.CreatedAt,
		&sess.UpdatedAt,
	)

	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("session not found: %s", sdb.sessionID)
	}

	if err != nil {
		return nil, fmt.Errorf("querying session: %w", err)
	}

	// Get run count
	runCount, err := sdb.GetRunCount()
	if err != nil {
		return nil, err
	}
	sess.RunCount = runCount

	return &sess, nil
}

// UpdateName updates the session name
func (sdb *SessionDB) UpdateName(name string) error {
	query := `
		UPDATE session
		SET name = ?, updated_at = ?
		WHERE id = ?
	`

	now := time.Now().UnixMilli()
	result, err := sdb.db.Exec(query, name, now, sdb.sessionID)
	if err != nil {
		return fmt.Errorf("updating session name: %w", err)
	}

	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("checking update result: %w", err)
	}

	if rows == 0 {
		return fmt.Errorf("session not found: %s", sdb.sessionID)
	}

	return nil
}

// UpdateTimestamp updates the session's updated_at timestamp to current time
func (sdb *SessionDB) UpdateTimestamp() error {
	query := `
		UPDATE session
		SET updated_at = ?
		WHERE id = ?
	`

	now := time.Now().UnixMilli()
	result, err := sdb.db.Exec(query, now, sdb.sessionID)
	if err != nil {
		return fmt.Errorf("updating session timestamp: %w", err)
	}

	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("checking update result: %w", err)
	}

	if rows == 0 {
		return fmt.Errorf("session not found: %s", sdb.sessionID)
	}

	return nil
}

// CreateGadgetRun creates a new gadget run entry in the session
func (sdb *SessionDB) CreateGadgetRun(run *GadgetRun) error {
	// Convert params to JSON
	paramsJSON, err := json.Marshal(run.Params)
	if err != nil {
		return fmt.Errorf("marshaling params: %w", err)
	}

	query := `
		INSERT INTO gadget_runs (id, session_id, gadget_image, params, gadget_info, started_at, stopped_at, event_count)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`

	_, err = sdb.db.Exec(query,
		run.ID,
		run.SessionID,
		run.GadgetImage,
		string(paramsJSON),
		run.GadgetInfo,
		run.StartedAt,
		run.StoppedAt,
		run.EventCount,
	)

	if err != nil {
		return fmt.Errorf("creating gadget run: %w", err)
	}

	// Update session timestamp
	if err := sdb.UpdateTimestamp(); err != nil {
		return err
	}

	return nil
}

// GetGadgetRun retrieves a single gadget run by ID
func (sdb *SessionDB) GetGadgetRun(runID string) (*GadgetRun, error) {
	query := `
		SELECT id, session_id, gadget_image, params, gadget_info, started_at, stopped_at, event_count
		FROM gadget_runs
		WHERE id = ?
	`

	var run GadgetRun
	var paramsJSON string

	err := sdb.db.QueryRow(query, runID).Scan(
		&run.ID,
		&run.SessionID,
		&run.GadgetImage,
		&paramsJSON,
		&run.GadgetInfo,
		&run.StartedAt,
		&run.StoppedAt,
		&run.EventCount,
	)

	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("gadget run not found: %s", runID)
	}

	if err != nil {
		return nil, fmt.Errorf("querying gadget run: %w", err)
	}

	// Unmarshal params
	if paramsJSON != "" {
		if err := json.Unmarshal([]byte(paramsJSON), &run.Params); err != nil {
			return nil, fmt.Errorf("unmarshaling params: %w", err)
		}
	}

	return &run, nil
}

// ListGadgetRuns returns all gadget runs in the session, ordered by start time
func (sdb *SessionDB) ListGadgetRuns() ([]GadgetRun, error) {
	query := `
		SELECT id, session_id, gadget_image, params, gadget_info, started_at, stopped_at, event_count
		FROM gadget_runs
		WHERE session_id = ?
		ORDER BY started_at ASC
	`

	rows, err := sdb.db.Query(query, sdb.sessionID)
	if err != nil {
		return nil, fmt.Errorf("querying gadget runs: %w", err)
	}
	defer rows.Close()

	var runs []GadgetRun
	for rows.Next() {
		var run GadgetRun
		var paramsJSON string

		err := rows.Scan(
			&run.ID,
			&run.SessionID,
			&run.GadgetImage,
			&paramsJSON,
			&run.GadgetInfo,
			&run.StartedAt,
			&run.StoppedAt,
			&run.EventCount,
		)
		if err != nil {
			return nil, fmt.Errorf("scanning gadget run row: %w", err)
		}

		// Unmarshal params
		if paramsJSON != "" {
			if err := json.Unmarshal([]byte(paramsJSON), &run.Params); err != nil {
				return nil, fmt.Errorf("unmarshaling params: %w", err)
			}
		}

		runs = append(runs, run)
	}

	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("iterating gadget run rows: %w", err)
	}

	return runs, nil
}

// FinalizeGadgetRun updates a gadget run when it stops
func (sdb *SessionDB) FinalizeGadgetRun(runID string, stoppedAt int64, eventCount int) error {
	query := `
		UPDATE gadget_runs
		SET stopped_at = ?, event_count = ?
		WHERE id = ?
	`

	result, err := sdb.db.Exec(query, stoppedAt, eventCount, runID)
	if err != nil {
		return fmt.Errorf("finalizing gadget run: %w", err)
	}

	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("checking update result: %w", err)
	}

	if rows == 0 {
		return fmt.Errorf("gadget run not found: %s", runID)
	}

	// Update session timestamp
	if err := sdb.UpdateTimestamp(); err != nil {
		return err
	}

	return nil
}

// GetRunCount returns the number of gadget runs in the session
func (sdb *SessionDB) GetRunCount() (int, error) {
	query := `
		SELECT COUNT(*)
		FROM gadget_runs
		WHERE session_id = ?
	`

	var count int
	err := sdb.db.QueryRow(query, sdb.sessionID).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("counting gadget runs: %w", err)
	}

	return count, nil
}

// InsertEvent inserts a single event into the session
func (sdb *SessionDB) InsertEvent(evt *RecordedEvent) error {
	query := `
		INSERT INTO events (run_id, timestamp, type, datasource_id, data)
		VALUES (?, ?, ?, ?, ?)
	`

	result, err := sdb.db.Exec(query,
		evt.RunID,
		evt.Timestamp,
		evt.Type,
		evt.DatasourceID,
		evt.Data,
	)

	if err != nil {
		return fmt.Errorf("inserting event: %w", err)
	}

	// Get the auto-incremented ID
	id, err := result.LastInsertId()
	if err != nil {
		return fmt.Errorf("getting event ID: %w", err)
	}

	evt.ID = id

	return nil
}

// GetRunEvents retrieves all events for a given gadget run, ordered by timestamp
func (sdb *SessionDB) GetRunEvents(runID string) ([]RecordedEvent, error) {
	query := `
		SELECT id, run_id, timestamp, type, datasource_id, data
		FROM events
		WHERE run_id = ?
		ORDER BY timestamp ASC
	`

	rows, err := sdb.db.Query(query, runID)
	if err != nil {
		return nil, fmt.Errorf("querying events: %w", err)
	}
	defer rows.Close()

	var events []RecordedEvent
	for rows.Next() {
		var evt RecordedEvent
		var datasourceID sql.NullString

		err := rows.Scan(
			&evt.ID,
			&evt.RunID,
			&evt.Timestamp,
			&evt.Type,
			&datasourceID,
			&evt.Data,
		)
		if err != nil {
			return nil, fmt.Errorf("scanning event row: %w", err)
		}

		if datasourceID.Valid {
			evt.DatasourceID = datasourceID.String
		}

		events = append(events, evt)
	}

	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("iterating event rows: %w", err)
	}

	return events, nil
}

// PrepareEventInsert prepares a statement for batch event inserts
func (sdb *SessionDB) PrepareEventInsert() (*sql.Stmt, error) {
	query := `
		INSERT INTO events (run_id, timestamp, type, datasource_id, data)
		VALUES (?, ?, ?, ?, ?)
	`

	stmt, err := sdb.db.Prepare(query)
	if err != nil {
		return nil, fmt.Errorf("preparing event insert statement: %w", err)
	}

	return stmt, nil
}
