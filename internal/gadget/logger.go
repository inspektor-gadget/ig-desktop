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
	"encoding/json"
	"fmt"

	"github.com/inspektor-gadget/inspektor-gadget/pkg/logger"

	"ig-frontend/internal/api"
)

// GenericLogger implements logger.GenericLogger for gadget instances
type GenericLogger struct {
	send       func(any)
	instanceID string
	level      logger.Level
}

// NewLogger creates a new GenericLogger
func NewLogger(send func(any), instanceID string, level logger.Level) *GenericLogger {
	return &GenericLogger{
		send:       send,
		instanceID: instanceID,
		level:      level,
	}
}

// SetLevel sets the logging level
func (l *GenericLogger) SetLevel(level logger.Level) {
	l.level = level
}

// GetLevel returns the current logging level
func (l *GenericLogger) GetLevel() logger.Level {
	return l.level
}

// Log logs a message with the given severity
func (l *GenericLogger) Log(severity logger.Level, params ...any) {
	d, _ := json.Marshal(map[string]any{
		"severity": severity,
		"msg":      fmt.Sprint(params...),
	})
	l.send(&api.GadgetEvent{
		InstanceID: l.instanceID,
		Type:       api.TypeGadgetLog,
		Data:       d,
	})
}

// Logf logs a formatted message with the given severity
func (l *GenericLogger) Logf(severity logger.Level, format string, params ...any) {
	d, _ := json.Marshal(map[string]any{
		"severity": severity,
		"msg":      fmt.Sprintf(format, params...),
	})
	l.send(&api.GadgetEvent{
		InstanceID: l.instanceID,
		Type:       api.TypeGadgetLog,
		Data:       d,
	})
}
