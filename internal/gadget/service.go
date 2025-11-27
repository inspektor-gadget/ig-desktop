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
	"log"

	"github.com/google/uuid"
	gadgetcontext "github.com/inspektor-gadget/inspektor-gadget/pkg/gadget-context"
	"github.com/inspektor-gadget/inspektor-gadget/pkg/gadget-service/api"
	"github.com/inspektor-gadget/inspektor-gadget/pkg/logger"
	"github.com/inspektor-gadget/inspektor-gadget/pkg/operators"
	"github.com/inspektor-gadget/inspektor-gadget/pkg/operators/simple"
	"google.golang.org/protobuf/encoding/protojson"

	"github.com/inspektor-gadget/inspektor-gadget/pkg/datasource"
	apiTypes "ig-frontend/internal/api"
	"ig-frontend/internal/environment"
	"ig-frontend/internal/session"
	json2 "ig-frontend/pkg/json"
)

// Service handles gadget operations
type Service struct {
	runtimeFactory  *environment.RuntimeFactory
	instanceManager *InstanceManager
	sessionService  *session.Service
	send            func(any)
}

// NewService creates a new gadget service
func NewService(runtimeFactory *environment.RuntimeFactory, instanceManager *InstanceManager) *Service {
	return &Service{
		runtimeFactory:  runtimeFactory,
		instanceManager: instanceManager,
	}
}

// SetSendFunc sets the send function for the service
func (s *Service) SetSendFunc(send func(any)) {
	s.send = send
}

// SetSessionService sets the session service for the service
func (s *Service) SetSessionService(ss *session.Service) {
	s.sessionService = ss
}

// setupSessionRecording creates or uses an existing session for recording.
// Returns nil if recording setup fails (gadget will continue without recording).
func (s *Service) setupSessionRecording(instanceID string, req RunRequest, gi *api.GadgetInfo) *apiTypes.SessionInfo {
	sessionID := req.SessionID
	isNew := false

	if sessionID == "" {
		var err error
		sessionID, err = s.sessionService.CreateSession(req.SessionName, req.EnvironmentID)
		if err != nil {
			log.Printf("failed to create session: %v (continuing without recording)", err)
			return nil
		}
		isNew = true
	}

	gadgetInfoBytes, err := protojson.Marshal(gi)
	if err != nil {
		log.Printf("failed to marshal gadget info: %v (continuing without recording)", err)
		return nil
	}

	runID, err := s.sessionService.StartGadgetRun(instanceID, sessionID, req.Image, req.Params, gadgetInfoBytes)
	if err != nil {
		log.Printf("failed to start gadget run: %v (continuing without recording)", err)
		return nil
	}

	return &apiTypes.SessionInfo{
		SessionID: sessionID,
		RunID:     runID,
		IsNew:     isNew,
	}
}

// subscribeToDataSources subscribes to all data sources and sends events to the frontend.
// If withRecording is true, events are also written to the session service.
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
				if withRecording && s.sessionService != nil {
					if err := s.sessionService.WriteEvent(instanceID, apiTypes.TypeGadgetEvent, dsName, jsonData); err != nil {
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
				if withRecording && s.sessionService != nil {
					if err := s.sessionService.WriteEvent(instanceID, apiTypes.TypeGadgetEventArray, dsName, jsonData); err != nil {
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
	ID            string
	Image         string
	EnvironmentID string
	Params        map[string]string
	Detached      bool
	InstanceName  string
	Record        bool   `json:"record"`      // enable recording
	SessionID     string `json:"sessionId"`   // existing session (empty = new)
	SessionName   string `json:"sessionName"` // name for new session
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
func (s *Service) Run(ctx context.Context, req RunRequest) (string, error) {
	runtime, err := s.runtimeFactory.GetRuntime(req.EnvironmentID)
	if err != nil {
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

		var sessionInfo *apiTypes.SessionInfo
		if req.Record && s.sessionService != nil {
			sessionInfo = s.setupSessionRecording(instanceID, req, gi)
		}

		s.send(&apiTypes.GadgetEvent{
			Type:          apiTypes.TypeGadgetInfo,
			EnvironmentID: req.EnvironmentID,
			InstanceID:    instanceID,
			Data:          gid,
			SessionInfo:   sessionInfo,
		})

		return s.subscribeToDataSources(gadgetCtx, instanceID, req.Record)
	}))

	// Create logger and set session service if available
	gadgetLogger := NewLogger(s.send, instanceID, logger.DebugLevel)
	if s.sessionService != nil {
		gadgetLogger.SetSessionService(s.sessionService)
	}

	options := []gadgetcontext.Option{
		gadgetcontext.WithDataOperators(xop),
		gadgetcontext.WithLogger(logger.NewFromGenericLogger(gadgetLogger)),
		gadgetcontext.WithUseInstance(false),
	}

	rtParams := runtime.ParamDescs().ToParams()
	if req.Detached {
		rtParams.Set("detach", "true")
		if req.InstanceName != "" {
			rtParams.Set("name", req.InstanceName)
		}
	}

	nctx, cancel := context.WithCancel(ctx)
	s.instanceManager.Register(instanceID, cancel)

	gadgetCtx := gadgetcontext.New(nctx, req.Image, options...)

	go func() {
		err := runtime.RunGadget(gadgetCtx, rtParams, req.Params)
		if err != nil {
			log.Printf("gadget error: %v", err)
		}

		// Stop session recording if active
		if s.sessionService != nil {
			if err := s.sessionService.StopGadgetRun(instanceID); err != nil {
				log.Printf("failed to stop gadget run: %v", err)
			}
		}

		s.instanceManager.Unregister(instanceID)
		cancel()

		s.send(&apiTypes.GadgetEvent{
			Type:          apiTypes.TypeGadgetStop,
			EnvironmentID: req.EnvironmentID,
			InstanceID:    instanceID,
		})
	}()

	return instanceID, nil
}

// Attach attaches to an existing gadget instance
func (s *Service) Attach(ctx context.Context, req AttachRequest) (string, error) {
	runtime, err := s.runtimeFactory.GetRuntime(req.EnvironmentID)
	if err != nil {
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
		})

		return s.subscribeToDataSources(gadgetCtx, instanceID, false)
	}))

	options := []gadgetcontext.Option{
		gadgetcontext.WithDataOperators(xop),
		gadgetcontext.WithLogger(logger.NewFromGenericLogger(NewLogger(s.send, instanceID, logger.DebugLevel))),
		gadgetcontext.WithUseInstance(true),
	}

	rtParams := runtime.ParamDescs().ToParams()

	nctx, cancel := context.WithCancel(ctx)
	s.instanceManager.Register(instanceID, cancel)

	gadgetCtx := gadgetcontext.New(nctx, req.Image, options...)

	go func() {
		err := runtime.RunGadget(gadgetCtx, rtParams, req.Params)
		if err != nil {
			log.Printf("gadget error: %v", err)
		}

		s.instanceManager.Unregister(instanceID)
		cancel()

		s.send(&apiTypes.GadgetEvent{
			Type:          apiTypes.TypeGadgetStop,
			EnvironmentID: req.EnvironmentID,
			InstanceID:    instanceID,
		})
	}()

	return instanceID, nil
}

// GetInfo retrieves information about a gadget
func (s *Service) GetInfo(ctx context.Context, environmentID string, url string) (*api.GadgetInfo, error) {
	runtime, err := s.runtimeFactory.GetRuntime(environmentID)
	if err != nil {
		return nil, err
	}

	gadgetCtx := gadgetcontext.New(ctx, url)
	rtParams := runtime.ParamDescs().ToParams()

	return runtime.GetGadgetInfo(gadgetCtx, rtParams, nil)
}

// ListInstances lists all running gadget instances in an environment
func (s *Service) ListInstances(ctx context.Context, environmentID string) ([]*api.GadgetInstance, error) {
	runtime, err := s.runtimeFactory.GetRuntime(environmentID)
	if err != nil {
		return nil, err
	}

	rtParams := runtime.ParamDescs().ToParams()
	return runtime.GetGadgetInstances(ctx, rtParams)
}

// RemoveInstance removes a gadget instance from the runtime
func (s *Service) RemoveInstance(ctx context.Context, environmentID string, instanceID string) error {
	runtime, err := s.runtimeFactory.GetRuntime(environmentID)
	if err != nil {
		return err
	}

	rtParams := runtime.ParamDescs().ToParams()
	return runtime.RemoveGadgetInstance(ctx, rtParams, instanceID)
}
