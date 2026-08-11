// Copyright 2026 The Inspektor Gadget authors
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

package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/inspektor-gadget/ig-desktop/internal/environment"
)

func TestPrepareSingleEnvConfig(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")
	if err := os.WriteFile(path, []byte(`{"environment":{"id":"3847213b-5fe7-4b2f-998c-c27425067e39","name":"Kubernetes","runtime":"grpc-k8s","params":{}}}`), 0o600); err != nil {
		t.Fatal(err)
	}

	data, err := prepareSingleEnvConfig(path, environment.NewStorage(dir))
	if err != nil {
		t.Fatal(err)
	}

	var cfg singleEnvConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, cfg.Environment.ID+".json")); err != nil {
		t.Fatal(err)
	}
}
