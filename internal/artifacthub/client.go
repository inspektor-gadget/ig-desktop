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

package artifacthub

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

// Client handles interactions with ArtifactHub API
type Client struct {
	baseURL    string
	httpClient *http.Client
}

// NewClient creates a new ArtifactHub client
func NewClient() *Client {
	return &Client{
		baseURL:    "https://artifacthub.io/api/v1",
		httpClient: http.DefaultClient,
	}
}

// PackageResponse represents the response from ArtifactHub
type PackageResponse struct {
	Code int             `json:"code"`
	Data json.RawMessage `json:"data"`
}

// GetPackage retrieves a package from ArtifactHub
func (c *Client) GetPackage(ctx context.Context, repository, packageName, version string) (*PackageResponse, error) {
	url := fmt.Sprintf("%s/packages/inspektor-gadget/%s/%s/%s", c.baseURL, repository, packageName, version)

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("creating request: %w", err)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("executing request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("reading response: %w", err)
	}

	return &PackageResponse{
		Code: resp.StatusCode,
		Data: body,
	}, nil
}
