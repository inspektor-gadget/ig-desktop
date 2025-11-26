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

package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"runtime/debug"
	"strings"
	"time"

	"ig-frontend/internal/api"
	"ig-frontend/internal/version"
)

const (
	githubReleasesAPI = "https://api.github.com/repos/inspektor-gadget/ig-desktop/releases/latest"
	githubReleasesURL = "https://github.com/inspektor-gadget/ig-desktop/releases"
)

// GitHubRelease represents the GitHub API response for a release
type GitHubRelease struct {
	TagName     string `json:"tag_name"`
	Name        string `json:"name"`
	HTMLURL     string `json:"html_url"`
	PublishedAt string `json:"published_at"`
	Prerelease  bool   `json:"prerelease"`
	Draft       bool   `json:"draft"`
}

// UpdateCheckResponse is the response sent to the frontend
type UpdateCheckResponse struct {
	CurrentVersion   string `json:"currentVersion"`
	LatestVersion    string `json:"latestVersion,omitempty"`
	IGLibraryVersion string `json:"igLibraryVersion,omitempty"`
	UpdateAvailable  bool   `json:"updateAvailable"`
	ReleasesURL      string `json:"releasesUrl"`
	Error            string `json:"error,omitempty"`
}

// getIGLibraryVersion returns the version of the inspektor-gadget library
func getIGLibraryVersion() string {
	info, ok := debug.ReadBuildInfo()
	if !ok {
		return "unknown"
	}
	for _, dep := range info.Deps {
		if dep.Path == "github.com/inspektor-gadget/inspektor-gadget" {
			return dep.Version
		}
	}
	return "unknown"
}

// HandleCheckForUpdates checks GitHub for the latest release
func (h *Handler) HandleCheckForUpdates(ev *api.Event) {
	response := UpdateCheckResponse{
		CurrentVersion:   version.Get(),
		IGLibraryVersion: getIGLibraryVersion(),
		ReleasesURL:      githubReleasesURL,
	}

	// Create a fresh context with timeout for the HTTP request
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Create HTTP client
	client := &http.Client{}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, githubReleasesAPI, nil)
	if err != nil {
		log.Printf("Failed to create request: %v", err)
		response.Error = "Failed to check for updates"
		h.send(ev.SetData(response))
		return
	}

	// Set User-Agent as required by GitHub API
	req.Header.Set("User-Agent", "ig-desktop/"+version.Get())
	req.Header.Set("Accept", "application/vnd.github.v3+json")

	resp, err := client.Do(req)
	if err != nil {
		log.Printf("Failed to fetch releases: %v", err)
		response.Error = "Failed to connect to GitHub"
		h.send(ev.SetData(response))
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		log.Printf("GitHub API returned status: %d", resp.StatusCode)
		response.Error = fmt.Sprintf("GitHub API error: %d", resp.StatusCode)
		h.send(ev.SetData(response))
		return
	}

	var release GitHubRelease
	if err := json.NewDecoder(resp.Body).Decode(&release); err != nil {
		log.Printf("Failed to parse release response: %v", err)
		response.Error = "Failed to parse update information"
		h.send(ev.SetData(response))
		return
	}

	response.LatestVersion = release.TagName

	// Compare versions (simple string comparison, assumes semver with 'v' prefix)
	currentVersion := normalizeVersion(version.Get())
	latestVersion := normalizeVersion(release.TagName)

	response.UpdateAvailable = isNewerVersion(latestVersion, currentVersion)

	h.send(ev.SetData(response))
}

// normalizeVersion removes the 'v' prefix if present
func normalizeVersion(v string) string {
	return strings.TrimPrefix(v, "v")
}

// isNewerVersion compares two semver strings and returns true if latest > current
// Handles versions like "1.0.0", "1.0.0-beta", etc.
func isNewerVersion(latest, current string) bool {
	// Handle development versions
	if current == "dev" || strings.HasPrefix(current, "dev-") {
		return false // Don't show updates for dev builds
	}

	// Simple semver comparison
	latestParts := strings.Split(strings.Split(latest, "-")[0], ".")
	currentParts := strings.Split(strings.Split(current, "-")[0], ".")

	// Pad with zeros if needed
	for len(latestParts) < 3 {
		latestParts = append(latestParts, "0")
	}
	for len(currentParts) < 3 {
		currentParts = append(currentParts, "0")
	}

	for i := 0; i < 3; i++ {
		var latestNum, currentNum int
		fmt.Sscanf(latestParts[i], "%d", &latestNum)
		fmt.Sscanf(currentParts[i], "%d", &currentNum)

		if latestNum > currentNum {
			return true
		}
		if latestNum < currentNum {
			return false
		}
	}

	return false // Versions are equal
}
