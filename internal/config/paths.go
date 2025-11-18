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

package config

import (
	"os"
	"path/filepath"
	"runtime"
)

// GetDir returns the application directory path with an optional suffix.
// On Windows: ~/Inspektor Gadget Desktop
// On Unix-like: ~/.inspektor-gadget-desktop
// Creates the directory if it doesn't exist.
func GetDir(suffix string) (string, error) {
	dirname, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	switch runtime.GOOS {
	case "windows":
		dirname = filepath.Join(dirname, "Inspektor Gadget Desktop")
	default:
		dirname = filepath.Join(dirname, ".inspektor-gadget-desktop")
	}
	if suffix != "" {
		dirname = filepath.Join(dirname, suffix)
	}
	err = os.MkdirAll(dirname, 0o755)
	if err != nil && !os.IsExist(err) {
		return "", err
	}
	return dirname, nil
}
