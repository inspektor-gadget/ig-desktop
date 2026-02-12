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

package gadget

import (
	"context"
	"sync"

	"github.com/inspektor-gadget/ig-desktop/pkg/api"
)

// InstanceManager manages lifecycle of running gadget instances
type InstanceManager struct {
	mu         sync.Mutex
	cancellers map[string]context.CancelFunc
}

// NewInstanceManager creates a new InstanceManager
func NewInstanceManager() *InstanceManager {
	return &InstanceManager{
		cancellers: make(map[string]context.CancelFunc),
	}
}

// Register adds a new instance with its cancel function
func (m *InstanceManager) Register(instanceID string, cancel context.CancelFunc) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.cancellers[instanceID] = cancel
}

// Stop stops a running instance by calling its cancel function
func (m *InstanceManager) Stop(instanceID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	cancel, ok := m.cancellers[instanceID]
	if !ok {
		return &api.ErrInstanceNotFound{ID: instanceID}
	}

	cancel()
	return nil
}

// Unregister removes an instance from tracking (typically when it completes)
func (m *InstanceManager) Unregister(instanceID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.cancellers, instanceID)
}
