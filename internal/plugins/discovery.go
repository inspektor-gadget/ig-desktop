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

// Package plugins provides plugin discovery and management for local plugins.
package plugins

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/inspektor-gadget/ig-desktop/internal/config"
)

// PluginType represents the type of plugin
type PluginType string

const (
	PluginTypeVisualizer    PluginType = "visualizer"
	PluginTypeDataProcessor PluginType = "data-processor"
	PluginTypeParamInput    PluginType = "param-input"
)

// VisualizerConditions defines when a visualizer applies
type VisualizerConditions struct {
	HasAnnotation      map[string]string            `json:"hasAnnotation,omitempty"`
	HasField           []string                     `json:"hasField,omitempty"`
	HasFieldAnnotation map[string]map[string]string `json:"hasFieldAnnotation,omitempty"`
	HasFieldTag        map[string]string            `json:"hasFieldTag,omitempty"`
	DatasourceType     string                       `json:"datasourceType,omitempty"`
}

// VisualizerManifest contains visualizer-specific configuration
type VisualizerManifest struct {
	DisplayName    string                `json:"displayName"`
	Icon           string                `json:"icon"`
	ApplicableWhen *VisualizerConditions `json:"applicableWhen,omitempty"`
	Priority       int                   `json:"priority,omitempty"`
}

// DataProcessorManifest contains data processor-specific configuration
type DataProcessorManifest struct {
	Stage     string   `json:"stage"` // "pre-buffer" or "post-buffer"
	Order     int      `json:"order,omitempty"`
	AppliesTo []string `json:"appliesTo,omitempty"`
}

// ParamInputManifest contains param input-specific configuration
type ParamInputManifest struct {
	MatchTypeHint  []string `json:"matchTypeHint,omitempty"`
	MatchValueHint []string `json:"matchValueHint,omitempty"`
	MatchKey       []string `json:"matchKey,omitempty"`
}

// PluginSetting defines a configurable setting for a plugin
type PluginSetting struct {
	Key         string            `json:"key"`
	Title       string            `json:"title"`
	Description string            `json:"description,omitempty"`
	Type        string            `json:"type"` // "toggle", "select", "text", "number", "range"
	Default     interface{}       `json:"default"`
	Options     map[string]string `json:"options,omitempty"`
	Min         *float64          `json:"min,omitempty"`
	Max         *float64          `json:"max,omitempty"`
	Step        *float64          `json:"step,omitempty"`
}

// PluginManifest represents a plugin's manifest.json
type PluginManifest struct {
	ID            string                 `json:"id"`
	Name          string                 `json:"name"`
	Version       string                 `json:"version"`
	Type          PluginType             `json:"type"`
	Main          string                 `json:"main"`
	Description   string                 `json:"description,omitempty"`
	Author        string                 `json:"author,omitempty"`
	Icon          string                 `json:"icon,omitempty"`
	Visualizer    *VisualizerManifest    `json:"visualizer,omitempty"`
	DataProcessor *DataProcessorManifest `json:"dataProcessor,omitempty"`
	ParamInput    *ParamInputManifest    `json:"paramInput,omitempty"`
	Settings      []PluginSetting        `json:"settings,omitempty"`
}

// DiscoveredPlugin represents a plugin found in the plugins directory
type DiscoveredPlugin struct {
	Manifest PluginManifest    `json:"manifest"`
	Path     string            `json:"path"`
	Files    map[string]string `json:"files"`
}

// Service handles plugin discovery and file loading
type Service struct {
	pluginsDir string
}

// NewService creates a new plugin discovery service
func NewService() (*Service, error) {
	pluginsDir, err := config.GetDir("plugins")
	if err != nil {
		return nil, fmt.Errorf("failed to get plugins directory: %w", err)
	}

	return &Service{
		pluginsDir: pluginsDir,
	}, nil
}

// PluginsDir returns the path to the plugins directory
func (s *Service) PluginsDir() string {
	return s.pluginsDir
}

// DiscoverPlugins scans the plugins directory for valid plugins
func (s *Service) DiscoverPlugins() ([]DiscoveredPlugin, error) {
	// Initialize as empty slice (not nil) so JSON marshals to [] not null
	plugins := []DiscoveredPlugin{}

	// Check if plugins directory exists
	if _, err := os.Stat(s.pluginsDir); os.IsNotExist(err) {
		// Create directory and return empty list
		if err := os.MkdirAll(s.pluginsDir, 0755); err != nil {
			return nil, fmt.Errorf("failed to create plugins directory: %w", err)
		}
		return plugins, nil
	}

	// Read all entries in plugins directory
	entries, err := os.ReadDir(s.pluginsDir)
	if err != nil {
		return nil, fmt.Errorf("failed to read plugins directory: %w", err)
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}

		pluginPath := filepath.Join(s.pluginsDir, entry.Name())
		plugin, err := s.loadPlugin(pluginPath)
		if err != nil {
			// Log but don't fail on individual plugin errors
			fmt.Printf("Skipping plugin %s: %v\n", entry.Name(), err)
			continue
		}

		plugins = append(plugins, *plugin)
	}

	return plugins, nil
}

// loadPlugin loads a single plugin from a directory
func (s *Service) loadPlugin(pluginPath string) (*DiscoveredPlugin, error) {
	manifestPath := filepath.Join(pluginPath, "manifest.json")

	// Read manifest
	manifestData, err := os.ReadFile(manifestPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read manifest: %w", err)
	}

	var manifest PluginManifest
	if err := json.Unmarshal(manifestData, &manifest); err != nil {
		return nil, fmt.Errorf("failed to parse manifest: %w", err)
	}

	// Validate manifest
	if manifest.ID == "" {
		return nil, fmt.Errorf("manifest missing id")
	}
	if manifest.Name == "" {
		return nil, fmt.Errorf("manifest missing name")
	}
	if manifest.Type == "" {
		return nil, fmt.Errorf("manifest missing type")
	}
	if manifest.Main == "" {
		return nil, fmt.Errorf("manifest missing main")
	}

	// Load source files
	files, err := s.loadPluginFiles(pluginPath)
	if err != nil {
		return nil, fmt.Errorf("failed to load plugin files: %w", err)
	}

	// Verify main file exists
	if _, ok := files[manifest.Main]; !ok {
		return nil, fmt.Errorf("main file %s not found", manifest.Main)
	}

	return &DiscoveredPlugin{
		Manifest: manifest,
		Path:     pluginPath,
		Files:    files,
	}, nil
}

// loadPluginFiles loads all source files from a plugin directory
func (s *Service) loadPluginFiles(pluginPath string) (map[string]string, error) {
	files := make(map[string]string)

	// Walk the plugin directory
	err := filepath.Walk(pluginPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		// Skip directories
		if info.IsDir() {
			return nil
		}

		// Skip non-source files
		ext := strings.ToLower(filepath.Ext(path))
		if ext != ".svelte" && ext != ".ts" && ext != ".js" {
			return nil
		}

		// Skip manifest.json
		if info.Name() == "manifest.json" {
			return nil
		}

		// Read file content
		content, err := os.ReadFile(path)
		if err != nil {
			return fmt.Errorf("failed to read %s: %w", path, err)
		}

		// Get relative path from plugin root
		relPath, err := filepath.Rel(pluginPath, path)
		if err != nil {
			return err
		}

		files[relPath] = string(content)
		return nil
	})

	if err != nil {
		return nil, err
	}

	return files, nil
}

// GetPlugin loads a single plugin by ID
func (s *Service) GetPlugin(id string) (*DiscoveredPlugin, error) {
	plugins, err := s.DiscoverPlugins()
	if err != nil {
		return nil, err
	}

	for _, plugin := range plugins {
		if plugin.Manifest.ID == id {
			return &plugin, nil
		}
	}

	return nil, fmt.Errorf("plugin not found: %s", id)
}
