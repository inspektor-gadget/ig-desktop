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
	"encoding/json"
	"fmt"
	"log"
	"math"
	"time"

	"github.com/google/uuid"
	gadgetcontext "github.com/inspektor-gadget/inspektor-gadget/pkg/gadget-context"
	"github.com/inspektor-gadget/inspektor-gadget/pkg/gadget-service/api"
	"github.com/inspektor-gadget/inspektor-gadget/pkg/logger"
	"github.com/inspektor-gadget/inspektor-gadget/pkg/operators"
	"github.com/inspektor-gadget/inspektor-gadget/pkg/operators/simple"
	"google.golang.org/protobuf/encoding/protojson"

	apiTypes "github.com/inspektor-gadget/ig-desktop/pkg/api"
	"github.com/inspektor-gadget/ig-desktop/pkg/fileoutput"
	grpcruntime "github.com/inspektor-gadget/ig-desktop/pkg/grpc-runtime"
	json2 "github.com/inspektor-gadget/ig-desktop/pkg/json"
	"github.com/inspektor-gadget/ig-desktop/pkg/operators/virtual"
	"github.com/inspektor-gadget/inspektor-gadget/pkg/datasource"
)

// SessionRecorder is the interface for optional session recording.
// Implementations can record gadget runs and their events for later replay.
type SessionRecorder interface {
	CreateSession(name, envID string) (string, error)
	StartGadgetRun(instanceID, sessionID, image string, params map[string]string, gadgetInfo []byte) (string, error)
	WriteEvent(instanceID string, eventType int, dsName string, data []byte) error
	StopGadgetRun(instanceID string) error
}

// Service handles gadget operations
type Service struct {
	instanceManager *InstanceManager
	sessionRecorder SessionRecorder
	send            func(any)
	fileOutputs     *fileoutput.Manager
}

// SetFileOutputs opts this service into host-authorized filesystem output.
// Ordinary web/socket services deliberately never call it.
func (s *Service) SetFileOutputs(outputs *fileoutput.Manager) { s.fileOutputs = outputs }

// NewService creates a new gadget service
func NewService(instanceManager *InstanceManager) *Service {
	return &Service{
		instanceManager: instanceManager,
	}
}

// SetSendFunc sets the send function for the service
func (s *Service) SetSendFunc(send func(any)) {
	s.send = send
}

// SetSessionRecorder sets the session recorder for the service
func (s *Service) SetSessionRecorder(sr SessionRecorder) {
	s.sessionRecorder = sr
}

// setupSessionRecording creates or uses an existing session for recording.
func (s *Service) setupSessionRecording(instanceID string, req RunRequest, gi *api.GadgetInfo) (*apiTypes.SessionInfo, error) {
	sessionID := req.SessionID
	isNew := false

	if sessionID == "" {
		var err error
		sessionID, err = s.sessionRecorder.CreateSession(req.SessionName, req.EnvironmentID)
		if err != nil {
			return nil, fmt.Errorf("creating recording session: %w", err)
		}
		isNew = true
	}

	gadgetInfoBytes, err := protojson.Marshal(gi)
	if err != nil {
		return nil, fmt.Errorf("marshaling recording metadata: %w", err)
	}

	runID, err := s.sessionRecorder.StartGadgetRun(instanceID, sessionID, req.Image, req.Params, gadgetInfoBytes)
	if err != nil {
		return nil, fmt.Errorf("starting recording: %w", err)
	}

	return &apiTypes.SessionInfo{
		SessionID: sessionID,
		RunID:     runID,
		IsNew:     isNew,
	}, nil
}

// subscribeToDataSources subscribes to all data sources and sends events to the frontend.
// If withRecording is true, events are also written to the session recorder.
func (s *Service) subscribeToDataSources(gadgetCtx operators.GadgetContext, instanceID string, withRecording bool) error {
	for _, ds := range gadgetCtx.GetDataSources() {
		formatter, err := json2.New(ds, json2.WithFlatten(true), json2.WithShowAll(true))
		if err != nil {
			return err
		}
		dsName := ds.Name()

		switch ds.Type() {
		case datasource.TypeSingle:
			ds.Subscribe(func(ds datasource.DataSource, data datasource.Data) error {
				jsonData := formatter.Marshal(data)
				s.send(&apiTypes.GadgetEvent{
					Type:         apiTypes.TypeGadgetEvent,
					InstanceID:   instanceID,
					Data:         jsonData,
					DatasourceID: dsName,
				})
				if withRecording && s.sessionRecorder != nil {
					if err := s.sessionRecorder.WriteEvent(instanceID, apiTypes.TypeGadgetEvent, dsName, jsonData); err != nil {
						log.Printf("failed to write event to session: %v", err)
					}
				}
				return nil
			}, 1000)
		case datasource.TypeArray:
			ds.SubscribeArray(func(ds datasource.DataSource, data datasource.DataArray) error {
				jsonData := formatter.MarshalArray(data)
				s.send(&apiTypes.GadgetEvent{
					Type:         apiTypes.TypeGadgetEventArray,
					InstanceID:   instanceID,
					Data:         jsonData,
					DatasourceID: dsName,
				})
				if withRecording && s.sessionRecorder != nil {
					if err := s.sessionRecorder.WriteEvent(instanceID, apiTypes.TypeGadgetEventArray, dsName, jsonData); err != nil {
						log.Printf("failed to write event to session: %v", err)
					}
				}
				return nil
			}, 1000)
		}
	}
	return nil
}

// RunRequest contains parameters for running a gadget
type RunRequest struct {
	Output           *fileoutput.Request
	OutputStatus     *fileoutput.Status
	OutputTarget     *fileoutput.Target
	ID               string
	Image            string
	EnvironmentID    string
	Params           map[string]string
	Detached         bool
	InstanceName     string
	Record           bool   `json:"record"`      // enable recording
	SessionID        string `json:"sessionId"`   // existing session (empty = new)
	SessionName      string `json:"sessionName"` // name for new session
	DurationSeconds  int64
	RemoteInstanceID string
}

// ValidateDuration rejects overflow and detached deadlines, which this client
// cannot enforce once the detached creation request has completed.
func ValidateDuration(seconds int64, detached bool) error {
	if seconds < 0 || seconds > math.MaxInt64/int64(time.Second) {
		return fmt.Errorf("durationSeconds must be a non-negative integer no greater than %d", math.MaxInt64/int64(time.Second))
	}
	if detached && seconds > 0 {
		return fmt.Errorf("durationSeconds is not supported for detached instances; remove them explicitly")
	}
	return nil
}

func runContext(ctx context.Context, seconds int64) (context.Context, context.CancelFunc) {
	if seconds > 0 {
		return context.WithTimeout(ctx, time.Duration(seconds)*time.Second)
	}
	return context.WithCancel(ctx)
}

// AttachRequest contains parameters for attaching to an instance
type AttachRequest struct {
	ID            string
	Image         string
	EnvironmentID string
	Params        map[string]string
	InstanceName  string
}

// Run starts a new gadget instance
func (s *Service) Run(ctx context.Context, runtime *grpcruntime.Runtime, req RunRequest) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	if err := ValidateDuration(req.DurationSeconds, req.Detached); err != nil {
		return "", err
	}
	if req.Output != nil {
		if s.fileOutputs == nil {
			return "", fmt.Errorf("file output is unavailable on this host")
		}
		if req.Detached || req.Record || req.SessionID != "" || req.SessionName != "" {
			return "", fmt.Errorf("file output requires foreground execution without session recording")
		}
	}
	if req.Record && s.sessionRecorder == nil {
		return "", fmt.Errorf("session recording is unavailable")
	}
	if req.Record && req.Detached {
		return "", fmt.Errorf("recording requires a foreground capture; detached creation has no event stream")
	}
	instanceID := uuid.New().String()
	nctx, cancel := runContext(ctx, req.DurationSeconds)
	var output *fileoutput.Sink
	if req.Output != nil {
		var err error
		output, err = s.fileOutputs.Open(*req.Output)
		if err != nil {
			cancel()
			return "", err
		}
		if req.OutputStatus != nil {
			*req.OutputStatus = output.Status()
		}
	}
	ready := make(chan struct{})
	sendOutput := func(status fileoutput.Status) {
		data, _ := json.Marshal(status)
		s.send(&apiTypes.GadgetEvent{Type: apiTypes.TypeGadgetOutput, EnvironmentID: req.EnvironmentID, InstanceID: instanceID, Data: data})
	}

	xop := simple.New("exp", simple.WithPriority(1000), simple.OnPreStart(func(gadgetCtx operators.GadgetContext) error {
		gi, err := gadgetCtx.SerializeGadgetInfo(false)
		if err != nil {
			log.Printf("failed to serialize gadget info: %v", err)
			return err
		}
		gid, err := protojson.Marshal(gi)
		if err != nil {
			log.Printf("failed to marshal gadget info: %v", err)
			return err
		}

		var sessionInfo *apiTypes.SessionInfo
		if req.Record && s.sessionRecorder != nil {
			sessionInfo, err = s.setupSessionRecording(instanceID, req, gi)
			if err != nil {
				return err
			}
		}

		s.send(&apiTypes.GadgetEvent{
			Type:          apiTypes.TypeGadgetInfo,
			EnvironmentID: req.EnvironmentID,
			InstanceID:    instanceID,
			Data:          gid,
			SessionInfo:   sessionInfo,
		})

		if output != nil {
			err := output.Subscribe(gadgetCtx.GetDataSources(), map[string]any{
				"image": req.Image, "environmentID": req.EnvironmentID, "instanceID": instanceID,
				"params": req.Params, "durationSeconds": req.DurationSeconds,
				"host":      output.Status().Host,
				"target":    req.OutputTarget,
				"startedAt": time.Now().UTC().Format(time.RFC3339Nano),
			}, cancel)
			close(ready)
			if err != nil {
				return err
			}
			sendOutput(output.Status())
			return nil
		}
		return s.subscribeToDataSources(gadgetCtx, instanceID, req.Record)
	}))

	// Create logger and set session recorder if available
	logSend, logLevel := s.send, logger.DebugLevel
	if output != nil {
		// Gadget log strings may contain observed data; file runs expose only
		// bounded status and terminal errors, never runtime log payloads.
		logSend, logLevel = func(any) {}, logger.ErrorLevel
	}
	gadgetLogger := NewLogger(logSend, instanceID, logLevel)
	if s.sessionRecorder != nil && output == nil {
		gadgetLogger.SetSessionRecorder(s.sessionRecorder)
	}

	options := []gadgetcontext.Option{
		gadgetcontext.WithDataOperators(virtual.New(), xop),
		gadgetcontext.WithLogger(logger.NewFromGenericLogger(gadgetLogger)),
		gadgetcontext.WithUseInstance(false),
		gadgetcontext.WithTimeout(time.Duration(req.DurationSeconds) * time.Second),
	}

	rtParams := runtime.ParamDescs().ToParams()
	if req.Detached {
		rtParams.Set("detach", "true")
		if req.RemoteInstanceID != "" {
			rtParams.Set(grpcruntime.ParamID, req.RemoteInstanceID)
		}
		if req.InstanceName != "" {
			rtParams.Set("name", req.InstanceName)
		}
	}

	s.instanceManager.Register(instanceID, cancel)

	gadgetCtx := gadgetcontext.New(nctx, req.Image, options...)
	if output != nil {
		// A partial capture file is worse than a stopped run.
		grpcruntime.SetFailFast(gadgetCtx)
	}

	go func() {
		progressDone, progressStopped := make(chan struct{}), make(chan struct{})
		if output != nil {
			go func() {
				defer close(progressStopped)
				select {
				case <-ready:
				case <-progressDone:
					return
				}
				ticker := time.NewTicker(time.Second)
				defer ticker.Stop()
				stopped := nctx.Done()
				for {
					select {
					case <-ticker.C:
						sendOutput(output.Status())
					case <-stopped:
						output.Stopping()
						sendOutput(output.Status())
						stopped = nil
					case <-progressDone:
						return
					}
				}
			}()
		}
		err := runtime.RunGadget(gadgetCtx, rtParams, req.Params)
		gadgetCtx.StopLocalOperators()
		if err != nil && output == nil {
			log.Printf("gadget error: %v", err)
		}

		// Stop session recording if active
		if s.sessionRecorder != nil && output == nil {
			if err := s.sessionRecorder.StopGadgetRun(instanceID); err != nil {
				log.Printf("failed to stop gadget run: %v", err)
			}
		}

		defer s.instanceManager.Unregister(instanceID)
		reason := stopReason(nctx)
		cancel()

		terminal := map[string]any{"error": errorString(err), "reason": reason}
		if output != nil {
			close(progressDone)
			<-progressStopped
			// The runtime has joined its receive callbacks before returning.
			status := output.Finalize(err)
			terminal["output"] = status
			terminal["error"] = status.Error
			select {
			case <-ready:
				sendOutput(status)
			default:
			}
		}
		data, _ := json.Marshal(terminal)
		s.send(&apiTypes.GadgetEvent{
			Type:          apiTypes.TypeGadgetStop,
			EnvironmentID: req.EnvironmentID,
			InstanceID:    instanceID,
			Data:          data,
		})
	}()

	return instanceID, nil
}

// Attach attaches to an existing gadget instance
func (s *Service) Attach(ctx context.Context, runtime *grpcruntime.Runtime, req AttachRequest) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	instanceID := uuid.New().String()

	xop := simple.New("exp", simple.WithPriority(1000), simple.OnPreStart(func(gadgetCtx operators.GadgetContext) error {
		gi, err := gadgetCtx.SerializeGadgetInfo(false)
		if err != nil {
			log.Printf("failed to serialize gadget info: %v", err)
			return err
		}
		gid, err := protojson.Marshal(gi)
		if err != nil {
			log.Printf("failed to marshal gadget info: %v", err)
			return err
		}

		s.send(&apiTypes.GadgetEvent{
			Type:          apiTypes.TypeGadgetInfo,
			EnvironmentID: req.EnvironmentID,
			InstanceID:    instanceID,
			Data:          gid,
			Attached:      true,
			InstanceName:  req.InstanceName,
		})

		return s.subscribeToDataSources(gadgetCtx, instanceID, false)
	}))

	options := []gadgetcontext.Option{
		gadgetcontext.WithDataOperators(virtual.New(), xop),
		gadgetcontext.WithLogger(logger.NewFromGenericLogger(NewLogger(s.send, instanceID, logger.DebugLevel))),
		gadgetcontext.WithUseInstance(true),
	}

	rtParams := runtime.ParamDescs().ToParams()

	nctx, cancel := context.WithCancel(ctx)
	s.instanceManager.Register(instanceID, cancel)

	remoteID := req.ID
	if remoteID == "" {
		remoteID = req.Image // Older Desktop callers pass the remote ID as image.
	}
	gadgetCtx := gadgetcontext.New(nctx, remoteID, options...)

	go func() {
		err := runtime.RunGadget(gadgetCtx, rtParams, req.Params)
		if err != nil {
			log.Printf("gadget error: %v", err)
		}

		defer s.instanceManager.Unregister(instanceID)
		reason := stopReason(nctx)
		cancel()

		data, _ := json.Marshal(map[string]any{"error": errorString(err), "reason": reason})
		s.send(&apiTypes.GadgetEvent{
			Type:          apiTypes.TypeGadgetStop,
			EnvironmentID: req.EnvironmentID,
			InstanceID:    instanceID,
			Data:          data,
		})
	}()

	return instanceID, nil
}

func errorString(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

func stopReason(ctx context.Context) string {
	switch ctx.Err() {
	case context.DeadlineExceeded:
		return "duration"
	case context.Canceled:
		return "cancelled"
	default:
		return "completed"
	}
}

// GetInfo retrieves information about a gadget
func (s *Service) GetInfo(ctx context.Context, runtime *grpcruntime.Runtime, url string) (*api.GadgetInfo, error) {
	gadgetCtx := gadgetcontext.New(ctx, url)
	rtParams := runtime.ParamDescs().ToParams()

	return runtime.GetGadgetInfo(gadgetCtx, rtParams, nil)
}

// ListInstances lists all running gadget instances in an environment
func (s *Service) ListInstances(ctx context.Context, runtime *grpcruntime.Runtime) ([]*api.GadgetInstance, error) {
	rtParams := runtime.ParamDescs().ToParams()
	return runtime.GetGadgetInstances(ctx, rtParams)
}

// RemoveInstance removes a gadget instance from the runtime
func (s *Service) RemoveInstance(ctx context.Context, runtime *grpcruntime.Runtime, instanceID string) error {
	rtParams := runtime.ParamDescs().ToParams()
	return runtime.RemoveGadgetInstance(ctx, rtParams, instanceID)
}
