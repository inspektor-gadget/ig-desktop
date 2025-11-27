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
	"path/filepath"

	_ "modernc.org/sqlite"
)

// IndexDB manages the global index database for session metadata
type IndexDB struct {
	db     *sql.DB
	dbPath string
}

// NewIndexDB creates or opens the global session index database
func NewIndexDB(baseDir string) (*IndexDB, error) {
	dbPath := filepath.Join(baseDir, "index.db")

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("opening index database: %w", err)
	}

	idx := &IndexDB{
		db:     db,
		dbPath: dbPath,
	}

	if err := idx.initSchema(); err != nil {
		db.Close()
		return nil, err
	}

	return idx, nil
}

// Close closes the database connection
func (idx *IndexDB) Close() error {
	if idx.db != nil {
		return idx.db.Close()
	}
	return nil
}

// initSchema creates the sessions table and index
func (idx *IndexDB) initSchema() error {
	schema := `
		CREATE TABLE IF NOT EXISTS sessions (
			id TEXT PRIMARY KEY,
			name TEXT,
			environment_id TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL,
			run_count INTEGER DEFAULT 0
		);

		CREATE INDEX IF NOT EXISTS idx_sessions_env ON sessions(environment_id, updated_at DESC);
	`

	_, err := idx.db.Exec(schema)
	if err != nil {
		return fmt.Errorf("initializing schema: %w", err)
	}

	return nil
}

// AddSession adds a new session to the index
func (idx *IndexDB) AddSession(sess *Session) error {
	query := `
		INSERT INTO sessions (id, name, environment_id, created_at, updated_at, run_count)
		VALUES (?, ?, ?, ?, ?, ?)
	`

	_, err := idx.db.Exec(query, sess.ID, sess.Name, sess.EnvironmentID, sess.CreatedAt, sess.UpdatedAt, sess.RunCount)
	if err != nil {
		return fmt.Errorf("adding session to index: %w", err)
	}

	return nil
}

// UpdateSession updates an existing session in the index
func (idx *IndexDB) UpdateSession(sess *Session) error {
	query := `
		UPDATE sessions
		SET name = ?, updated_at = ?, run_count = ?
		WHERE id = ?
	`

	result, err := idx.db.Exec(query, sess.Name, sess.UpdatedAt, sess.RunCount, sess.ID)
	if err != nil {
		return fmt.Errorf("updating session in index: %w", err)
	}

	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("checking update result: %w", err)
	}

	if rows == 0 {
		return fmt.Errorf("session not found: %s", sess.ID)
	}

	return nil
}

// DeleteSession removes a session from the index
func (idx *IndexDB) DeleteSession(id string) error {
	query := `DELETE FROM sessions WHERE id = ?`

	result, err := idx.db.Exec(query, id)
	if err != nil {
		return fmt.Errorf("deleting session from index: %w", err)
	}

	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("checking delete result: %w", err)
	}

	if rows == 0 {
		return fmt.Errorf("session not found: %s", id)
	}

	return nil
}

// GetSession retrieves a single session by ID
func (idx *IndexDB) GetSession(id string) (*Session, error) {
	query := `
		SELECT id, name, environment_id, created_at, updated_at, run_count
		FROM sessions
		WHERE id = ?
	`

	var sess Session
	err := idx.db.QueryRow(query, id).Scan(
		&sess.ID,
		&sess.Name,
		&sess.EnvironmentID,
		&sess.CreatedAt,
		&sess.UpdatedAt,
		&sess.RunCount,
	)

	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("session not found: %s", id)
	}

	if err != nil {
		return nil, fmt.Errorf("querying session: %w", err)
	}

	return &sess, nil
}

// ListByEnvironment returns all sessions for a given environment, sorted by update time
func (idx *IndexDB) ListByEnvironment(envID string) ([]Session, error) {
	query := `
		SELECT id, name, environment_id, created_at, updated_at, run_count
		FROM sessions
		WHERE environment_id = ?
		ORDER BY updated_at DESC
	`

	rows, err := idx.db.Query(query, envID)
	if err != nil {
		return nil, fmt.Errorf("querying sessions for environment: %w", err)
	}
	defer rows.Close()

	var sessions []Session
	for rows.Next() {
		var sess Session
		err := rows.Scan(
			&sess.ID,
			&sess.Name,
			&sess.EnvironmentID,
			&sess.CreatedAt,
			&sess.UpdatedAt,
			&sess.RunCount,
		)
		if err != nil {
			return nil, fmt.Errorf("scanning session row: %w", err)
		}
		sessions = append(sessions, sess)
	}

	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("iterating session rows: %w", err)
	}

	return sessions, nil
}

// ListAll returns all sessions across all environments
func (idx *IndexDB) ListAll() ([]Session, error) {
	query := `
		SELECT id, name, environment_id, created_at, updated_at, run_count
		FROM sessions
		ORDER BY updated_at DESC
	`

	rows, err := idx.db.Query(query)
	if err != nil {
		return nil, fmt.Errorf("querying all sessions: %w", err)
	}
	defer rows.Close()

	var sessions []Session
	for rows.Next() {
		var sess Session
		err := rows.Scan(
			&sess.ID,
			&sess.Name,
			&sess.EnvironmentID,
			&sess.CreatedAt,
			&sess.UpdatedAt,
			&sess.RunCount,
		)
		if err != nil {
			return nil, fmt.Errorf("scanning session row: %w", err)
		}
		sessions = append(sessions, sess)
	}

	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("iterating session rows: %w", err)
	}

	return sessions, nil
}
