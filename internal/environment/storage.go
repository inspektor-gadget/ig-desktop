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

package environment

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/google/uuid"

	"github.com/inspektor-gadget/ig-desktop/pkg/api"
)

// Storage handles persistence of environment configurations
type Storage struct {
	dir string
}

// NewStorage creates a new Storage instance that persists environments
// to the given directory.
func NewStorage(dir string) *Storage {
	return &Storage{dir: dir}
}

// Add creates a new environment and persists it to disk
func (s *Storage) Add(environment *Environment) error {
	environment.ID = uuid.New().String()
	filename := filepath.Join(s.dir, environment.ID+".json")
	d, _ := json.Marshal(environment)
	return os.WriteFile(filename, d, 0o644)
}

// Delete removes an environment from disk
func (s *Storage) Delete(environment *Environment) error {
	if err := uuid.Validate(environment.ID); err != nil {
		return &api.ErrInvalidEnvironmentID{ID: environment.ID}
	}
	return os.Remove(filepath.Join(s.dir, environment.ID+".json"))
}

// Get retrieves a single environment by ID
func (s *Storage) Get(id string) (*Environment, error) {
	if err := uuid.Validate(id); err != nil {
		return nil, &api.ErrInvalidEnvironmentID{ID: id}
	}
	b, err := os.ReadFile(filepath.Join(s.dir, id+".json"))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, &api.ErrEnvironmentNotFound{ID: id}
		}
		return nil, fmt.Errorf("reading environment file: %w", err)
	}
	var environment Environment
	err = json.Unmarshal(b, &environment)
	if err != nil {
		return nil, fmt.Errorf("parsing environment file: %w", err)
	}
	return &environment, nil
}

// List returns all persisted environments
func (s *Storage) List() ([]*Environment, error) {
	files, err := os.ReadDir(s.dir)
	if err != nil {
		return nil, err
	}
	environments := make([]*Environment, 0, len(files))
	for _, file := range files {
		b, err := os.ReadFile(filepath.Join(s.dir, file.Name()))
		if err != nil {
			continue
		}
		var environment Environment
		err = json.Unmarshal(b, &environment)
		if err != nil {
			// Skip invalid files
			continue
		}
		environments = append(environments, &environment)
	}
	return environments, nil
}
