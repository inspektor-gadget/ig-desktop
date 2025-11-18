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
	json2 "ig-frontend/pkg/json"
)

// Service handles gadget operations
type Service struct {
	runtimeFactory  *environment.RuntimeFactory
	instanceManager *InstanceManager
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

// RunRequest contains parameters for running a gadget
type RunRequest struct {
	ID            string
	Image         string
	EnvironmentID string
	Params        map[string]string
	Detached      bool
	InstanceName  string
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

	// Create operator for gadget info and event streaming
	xop := simple.New("exp", simple.WithPriority(1000), simple.OnPreStart(func(gadgetCtx operators.GadgetContext) error {
		gi, _ := gadgetCtx.SerializeGadgetInfo(false)
		gid, _ := protojson.Marshal(gi)

		s.send(&apiTypes.GadgetEvent{
			Type:          apiTypes.TypeGadgetInfo,
			EnvironmentID: req.EnvironmentID,
			InstanceID:    instanceID,
			Data:          gid,
		})

		// Subscribe to datasources
		ds := gadgetCtx.GetDataSources()
		for _, ds := range ds {
			formatter, err := json2.New(ds, json2.WithFlatten(true), json2.WithShowAll(true))
			if err != nil {
				log.Println(err)
				return nil
			}
			dsName := ds.Name()
			switch ds.Type() {
			case datasource.TypeSingle:
				ds.Subscribe(func(ds datasource.DataSource, data datasource.Data) error {
					ev := &apiTypes.GadgetEvent{
						Type:         apiTypes.TypeGadgetEvent,
						InstanceID:   instanceID,
						Data:         formatter.Marshal(data),
						DatasourceID: dsName,
					}
					s.send(ev)
					return nil
				}, 1000)
			case datasource.TypeArray:
				ds.SubscribeArray(func(ds datasource.DataSource, data datasource.DataArray) error {
					log.Printf("got array")
					ev := &apiTypes.GadgetEvent{
						Type:         apiTypes.TypeGadgetEventArray,
						InstanceID:   instanceID,
						Data:         formatter.MarshalArray(data),
						DatasourceID: dsName,
					}
					s.send(ev)
					return nil
				}, 1000)
			}
		}
		return nil
	}))

	options := []gadgetcontext.Option{
		gadgetcontext.WithDataOperators(xop),
		gadgetcontext.WithLogger(logger.NewFromGenericLogger(NewLogger(s.send, instanceID, logger.DebugLevel))),
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

	// Create operator for gadget info and event streaming
	xop := simple.New("exp", simple.WithPriority(1000), simple.OnPreStart(func(gadgetCtx operators.GadgetContext) error {
		gi, _ := gadgetCtx.SerializeGadgetInfo(false)
		gid, _ := protojson.Marshal(gi)

		s.send(&apiTypes.GadgetEvent{
			Type:          apiTypes.TypeGadgetInfo,
			EnvironmentID: req.EnvironmentID,
			InstanceID:    instanceID,
			Data:          gid,
		})

		// Subscribe to datasources
		ds := gadgetCtx.GetDataSources()
		for _, ds := range ds {
			formatter, err := json2.New(ds, json2.WithFlatten(true), json2.WithShowAll(true))
			if err != nil {
				log.Println(err)
				return nil
			}
			dsName := ds.Name()
			switch ds.Type() {
			case datasource.TypeSingle:
				ds.Subscribe(func(ds datasource.DataSource, data datasource.Data) error {
					ev := &apiTypes.GadgetEvent{
						Type:         apiTypes.TypeGadgetEvent,
						InstanceID:   instanceID,
						Data:         formatter.Marshal(data),
						DatasourceID: dsName,
					}
					s.send(ev)
					return nil
				}, 1000)
			case datasource.TypeArray:
				ds.SubscribeArray(func(ds datasource.DataSource, data datasource.DataArray) error {
					ev := &apiTypes.GadgetEvent{
						Type:         apiTypes.TypeGadgetEventArray,
						InstanceID:   instanceID,
						Data:         formatter.MarshalArray(data),
						DatasourceID: dsName,
					}
					s.send(ev)
					return nil
				}, 1000)
			}
		}
		return nil
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
