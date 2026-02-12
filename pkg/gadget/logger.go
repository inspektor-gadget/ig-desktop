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
	"log"
	"time"

	"github.com/inspektor-gadget/inspektor-gadget/pkg/logger"

	"github.com/inspektor-gadget/ig-desktop/pkg/api"
)

// GenericLogger implements logger.GenericLogger for gadget instances
type GenericLogger struct {
	send            func(any)
	instanceID      string
	level           logger.Level
	sessionRecorder SessionRecorder
}

// NewLogger creates a new GenericLogger
func NewLogger(send func(any), instanceID string, level logger.Level) *GenericLogger {
	return &GenericLogger{
		send:       send,
		instanceID: instanceID,
		level:      level,
	}
}

// SetSessionRecorder sets the session recorder for recording logs
func (l *GenericLogger) SetSessionRecorder(sr SessionRecorder) {
	l.sessionRecorder = sr
}

// SetLevel sets the logging level
func (l *GenericLogger) SetLevel(level logger.Level) {
	l.level = level
}

// GetLevel returns the current logging level
func (l *GenericLogger) GetLevel() logger.Level {
	return l.level
}

// sendLogEvent sends a log event and records it to session if active.
func (l *GenericLogger) sendLogEvent(data []byte) {
	l.send(&api.GadgetEvent{
		InstanceID: l.instanceID,
		Type:       api.TypeGadgetLog,
		Data:       data,
	})
	if l.sessionRecorder != nil {
		if err := l.sessionRecorder.WriteEvent(l.instanceID, api.TypeGadgetLog, "", data); err != nil {
			log.Printf("failed to write log to session: %v", err)
		}
	}
}

// Log logs a message with the given severity
func (l *GenericLogger) Log(severity logger.Level, params ...any) {
	d, _ := json.Marshal(map[string]any{
		"severity":  severity,
		"msg":       fmt.Sprint(params...),
		"timestamp": time.Now().Format("2006-01-02 15:04:05"),
	})
	l.sendLogEvent(d)
}

// Logf logs a formatted message with the given severity
func (l *GenericLogger) Logf(severity logger.Level, format string, params ...any) {
	d, _ := json.Marshal(map[string]any{
		"severity":  severity,
		"msg":       fmt.Sprintf(format, params...),
		"timestamp": time.Now().Format("2006-01-02 15:04:05"),
	})
	l.sendLogEvent(d)
}
