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

package version

// Version is set at build time via ldflags
// For release builds: -ldflags="-X ig-frontend/internal/version.Version=v1.0.0"
// For dev builds: -ldflags="-X ig-frontend/internal/version.Version=dev-abc1234"
var Version = "dev"

// Get returns the current version string
func Get() string {
	return Version
}
