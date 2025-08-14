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

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	runtime2 "runtime"
	"sync"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/inspektor-gadget/inspektor-gadget/cmd/kubectl-gadget/utils"
	"github.com/inspektor-gadget/inspektor-gadget/pkg/gadgets"
	"github.com/wailsapp/wails/v3/pkg/application"
	"google.golang.org/protobuf/encoding/protojson"

	"github.com/inspektor-gadget/inspektor-gadget/pkg/datasource"
	gadgetcontext "github.com/inspektor-gadget/inspektor-gadget/pkg/gadget-context"
	"github.com/inspektor-gadget/inspektor-gadget/pkg/gadget-service/api"
	"github.com/inspektor-gadget/inspektor-gadget/pkg/logger"
	"github.com/inspektor-gadget/inspektor-gadget/pkg/operators"
	"github.com/inspektor-gadget/inspektor-gadget/pkg/operators/simple"

	grpcruntime "ig-frontend/pkg/grpc-runtime"
	json2 "ig-frontend/pkg/json"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

type Event struct {
	Type      int             `json:"type"`
	Command   string          `json:"cmd"`
	RequestID string          `json:"reqID"`
	Data      json.RawMessage `json:"data"`
	Success   bool            `json:"success"`
	Error     string          `json:"error"`
}

type GadgetEvent struct {
	EnvironmentID string          `json:"environmentID,omitempty"`
	InstanceID    string          `json:"instanceID,omitempty"`
	Type          int             `json:"type"`
	Data          json.RawMessage `json:"data"`
	DatasourceID  string          `json:"datasourceID,omitempty"`
}

func (ev *Event) SetError(err error) *Event {
	ev.Data = nil
	ev.Success = false
	ev.Error = err.Error()
	return ev
}

func (ev *Event) SetData(data any) *Event {
	ev.Data, _ = json.Marshal(data)
	ev.Success = true
	return ev
}

type Web struct {
	runtime *grpcruntime.Runtime
}

const (
	TypeCommandResponse   = 1
	TypeGadgetInfo        = 2
	TypeGadgetEvent       = 3
	TypeGadgetLog         = 4
	TypeGadgetStop        = 5
	TypeGadgetEventArray  = 6
	TypeEnvironmentCreate = 100
	TypeEnvironmentDelete = 101
	TypeEnvironmentUpdate = 102
)

type Environment struct {
	ID      string            `json:"id"`
	Name    string            `json:"name"`
	Runtime string            `json:"runtime"`
	Params  map[string]string `json:"params"`
}

func getDir(suffix string) (string, error) {
	dirname, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	switch runtime2.GOOS {
	case "windows":
		dirname = filepath.Join(dirname, "Inspektor Gadget Desktop")
	default:
		dirname = filepath.Join(dirname, ".inspektor-gadget-desktop")
	}
	if suffix != "" {
		dirname = filepath.Join(dirname, suffix)
	}
	err = os.MkdirAll(dirname, 0o755)
	if err != nil && !os.IsExist(err) {
		return "", err
	}
	return dirname, nil
}

func (w *App) GetRuntime(id string) (*grpcruntime.Runtime, error) {
	if err := uuid.Validate(id); err != nil {
		return nil, fmt.Errorf("environment ID: %s", id)
	}
	dir, err := getDir("env")
	if err != nil {
		return nil, err
	}
	b, err := os.ReadFile(filepath.Join(dir, id+".json"))
	if err != nil {
		return nil, err
	}
	var environment Environment
	err = json.Unmarshal(b, &environment)
	if err != nil {
		return nil, err
	}
	var rt *grpcruntime.Runtime
	switch environment.Runtime {
	case "grpc-k8s":
		rt = grpcruntime.New(grpcruntime.WithConnectUsingK8SProxy)
		config, err := utils.KubernetesConfigFlags.ToRESTConfig()
		if err != nil {
			return nil, fmt.Errorf("could not load kubernetes config: %v", err)
		}
		rt.SetRestConfig(config)

		namespace, _ := utils.GetNamespace()
		rt.SetDefaultValue(gadgets.K8SNamespace, namespace)
	case "grpc-ig":
		rt = grpcruntime.New()
	}

	params := rt.GlobalParamDescs().ToParams()
	err = params.CopyFromMap(environment.Params, "")
	if err != nil {
		log.Printf("failed to copy params: %v", err)
		return nil, err
	}
	// params.Set(grpcruntime.ParamRemoteAddress, "tcp://10.211.55.12:1234")
	err = rt.Init(params)
	if err != nil {
		log.Printf("failed to init runtime: %v", err)
	}
	return rt, nil
}

func (w *App) AddEnvironment(environment *Environment) error {
	dir, err := getDir("env")
	if err != nil {
		return err
	}
	uuid := uuid.New().String()
	environment.ID = uuid
	filename := filepath.Join(dir, environment.ID+".json")
	d, _ := json.Marshal(environment)
	return os.WriteFile(filename, d, 0o644)
}

func (w *App) DeleteEnvironment(environment *Environment) error {
	dir, err := getDir("env")
	if err != nil {
		return err
	}
	if err := uuid.Validate(environment.ID); err != nil {
		return fmt.Errorf("environment ID: %s", environment.ID)
	}
	os.Remove(filepath.Join(dir, environment.ID+".json"))
	return nil
}

func (w *App) GetEnvironments() ([]*Environment, error) {
	dir, err := getDir("env")
	if err != nil {
		return nil, err
	}
	files, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	environments := make([]*Environment, 0, len(files))
	for _, file := range files {
		b, err := os.ReadFile(filepath.Join(dir, file.Name()))
		if err != nil {
			continue
		}
		var environment Environment
		err = json.Unmarshal(b, &environment)
		if err != nil {
			// TODO: Log...
			continue
		}
		environments = append(environments, &environment)
	}
	return environments, nil
}

type GenericLogger struct {
	send       func(any)
	instanceID string
	level      logger.Level
}

func (l *GenericLogger) SetLevel(level logger.Level) {
	l.level = level
}

func (l *GenericLogger) GetLevel() logger.Level {
	return l.level
}

func (l *GenericLogger) Log(severity logger.Level, params ...any) {
	d, _ := json.Marshal(map[string]any{
		"severity": severity,
		"msg":      fmt.Sprint(params...),
	})
	l.send(&GadgetEvent{
		InstanceID: l.instanceID,
		Type:       TypeGadgetLog,
		Data:       d,
	})
}

func (l *GenericLogger) Logf(severity logger.Level, format string, params ...any) {
	d, _ := json.Marshal(map[string]any{
		"severity": severity,
		"msg":      fmt.Sprintf(format, params...),
	})
	l.send(&GadgetEvent{
		InstanceID: l.instanceID,
		Type:       TypeGadgetLog,
		Data:       d,
	})
}

func (w *App) Run(app *application.App) error {
	var l sync.Mutex

	cancellers := make(map[string]context.CancelFunc)

	send := func(ev any) {
		d, _ := json.Marshal(ev)
		l.Lock()
		defer l.Unlock()
		app.Event.Emit("client", string(d))
	}

	ctx := w.ctx

	app.Event.On("server", func(event *application.CustomEvent) {
		ev := &Event{}

		log.Printf("message: %s", event.Data)

		str, ok := event.Data.(string)
		if !ok {
			log.Printf("message not of type string")
			return
		}

		log.Printf("msg <" + str + ">")
		err := json.Unmarshal([]byte(str), &ev)
		if err != nil {
			log.Println(err)
			return
		}
		log.Printf("%+v", ev)

		ev.Type = TypeCommandResponse

		switch ev.Command {
		case "helo":
			// Send environments
			env, err := w.GetEnvironments()
			if err != nil {
				// TODO LOG
				return
			}
			for _, env := range env {
				d, _ := json.Marshal(env)
				cmd := &GadgetEvent{
					Type: TypeEnvironmentCreate,
					Data: d,
				}
				send(cmd)
			}
		case "removeInstance":
			var removeInstanceRequest struct {
				ID            string `json:"id"`
				EnvironmentID string `json:"environmentID"`
			}
			err = json.Unmarshal(ev.Data, &removeInstanceRequest)
			if err != nil {
				send(ev.SetError(err))
				return
			}
			env, err := w.GetRuntime(removeInstanceRequest.EnvironmentID)
			if err != nil {
				send(ev.SetError(err))
				return
			}
			go func() {
				// use default params; TODO!
				rtParams := env.ParamDescs().ToParams()
				err = env.RemoveGadgetInstance(ctx, rtParams, removeInstanceRequest.ID)
				if err != nil {
					send(ev.SetError(err))
					return
				}
				send(ev.SetData(nil))
			}()
		case "stopInstance":
			var stopInstanceRequest struct {
				ID string `json:"id"`
			}
			err = json.Unmarshal(ev.Data, &stopInstanceRequest)
			if err != nil {
				send(ev.SetError(err))
				return
			}
			l.Lock()
			canceller, ok := cancellers[stopInstanceRequest.ID]
			l.Unlock()
			if ok {
				log.Printf("stopping instance %s", stopInstanceRequest.ID)
				canceller()
			} else {
				log.Printf("instance %s not found", stopInstanceRequest.ID)
			}
			send(ev.SetData(nil))
		case "runGadget", "attachInstance":
			var gadgetRunRequest struct {
				ID            string            `json:"id"`
				Image         string            `json:"image"`
				EnvironmentID string            `json:"environmentID"`
				Params        map[string]string `json:"params"`
				Detached      bool              `json:"detached"`
				InstanceName  string            `json:"instanceName"`
			}
			err = json.Unmarshal(ev.Data, &gadgetRunRequest)
			if err != nil {
				send(ev.SetError(err))
				return
			}
			env, err := w.GetRuntime(gadgetRunRequest.EnvironmentID)
			if err != nil {
				send(ev.SetError(err))
				return
			}

			instanceID := uuid.New().String()
			xop := simple.New("exp", simple.WithPriority(1000), simple.OnPreStart(func(gadgetCtx operators.GadgetContext) error {
				gi, _ := gadgetCtx.SerializeGadgetInfo(false)
				gid, _ := protojson.Marshal(gi)

				xev := &GadgetEvent{
					Type:          TypeGadgetInfo,
					EnvironmentID: gadgetRunRequest.EnvironmentID,
					InstanceID:    instanceID,
					Data:          gid,
				}

				// Send
				send(xev)

				// Now ack // TODO: fallback in case of error
				gadgetRunRequest.ID = instanceID
				send(ev.SetData(gadgetRunRequest))

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
							ev := &GadgetEvent{
								Type:         TypeGadgetEvent,
								InstanceID:   instanceID,
								Data:         formatter.Marshal(data),
								DatasourceID: dsName,
							}
							send(ev)
							return nil
						}, 1000)
					case datasource.TypeArray:
						ds.SubscribeArray(func(ds datasource.DataSource, data datasource.DataArray) error {
							log.Printf("got array")
							ev := &GadgetEvent{
								Type:         TypeGadgetEventArray,
								InstanceID:   instanceID,
								Data:         formatter.MarshalArray(data),
								DatasourceID: dsName,
							}
							send(ev)
							return nil
						}, 1000)
					}
				}
				return nil
			}))

			// TODO: add runtime
			// gadgetRunRequest.Params["operator.LocalManager.host"] = "true"

			options := []gadgetcontext.Option{
				gadgetcontext.WithDataOperators(xop),
				gadgetcontext.WithLogger(logger.NewFromGenericLogger(&GenericLogger{send: send, instanceID: instanceID, level: logger.DebugLevel})),
				gadgetcontext.WithUseInstance(ev.Command == "attachInstance"),
			}

			rtParams := env.ParamDescs().ToParams()
			if gadgetRunRequest.Detached {
				rtParams.Set("detach", "true")
				if gadgetRunRequest.InstanceName != "" {
					rtParams.Set("name", gadgetRunRequest.InstanceName)
				}
			}

			nctx, cancel := context.WithCancel(ctx)
			l.Lock()
			cancellers[instanceID] = cancel
			l.Unlock()

			gadgetCtx := gadgetcontext.New(nctx, gadgetRunRequest.Image, options...)
			go func() {
				err := env.RunGadget(gadgetCtx, rtParams, gadgetRunRequest.Params)
				// hack around detached - confirm here...
				if gadgetRunRequest.Detached {
					send(ev.SetData(nil))
				}
				if err != nil {
					send(ev.SetError(err))
				}

				l.Lock()
				delete(cancellers, instanceID)
				l.Unlock()
				cancel()

				xev := &GadgetEvent{
					Type:          TypeGadgetStop,
					EnvironmentID: gadgetRunRequest.EnvironmentID,
					InstanceID:    instanceID,
				}

				// Send
				send(xev)
			}()

			// Ack is done in operator's PreStart
		case "getRuntimes":
			runtimes := []struct {
				Key         string `json:"key"`
				Title       string `json:"title"`
				Description string `json:"description"`
			}{
				{Key: "grpc-ig", Title: "IG Daemon", Description: "Connect to Inspektor Gadget running as Daemon"},
				{Key: "grpc-k8s", Title: "IG on Kubernetes", Description: "Connect to Inspektor Gadget running on a Kubernetes cluster"},
			}
			send(ev.SetData(runtimes))
		case "getRuntimeParams":
			var runtimeSelection struct {
				Runtime string `json:"runtime"`
			}
			err = json.Unmarshal(ev.Data, &runtimeSelection)
			if err != nil {
				send(ev.SetError(err))
				return
			}
			var rt *grpcruntime.Runtime
			switch runtimeSelection.Runtime {
			case "grpc-k8s":
				rt = grpcruntime.New(grpcruntime.WithConnectUsingK8SProxy)
			case "grpc-ig":
				rt = grpcruntime.New()
			}
			params := rt.GlobalParamDescs().ToParams()
			send(ev.SetData(params))
		case "listInstances":
			var listInstancesRequest struct {
				EnvironmentID string `json:"environmentID"`
			}
			err = json.Unmarshal(ev.Data, &listInstancesRequest)
			if err != nil {
				send(ev.SetError(err))
				return
			}
			go func() {
				env, err := w.GetRuntime(listInstancesRequest.EnvironmentID)
				if err != nil {
					send(ev.SetError(err))
					return
				}

				// use default params; TODO!
				rtParams := env.ParamDescs().ToParams()
				instances, err := env.GetGadgetInstances(ctx, rtParams)
				if err != nil {
					log.Println(err)
					return
				}
				tmp, _ := protojson.Marshal(&api.ListGadgetInstanceResponse{GadgetInstances: instances})
				ev.Data = tmp
				ev.Success = true
				send(ev)
			}()
			return
		case "getGadgetInfo":
			var gadgetInfoRequest struct {
				URL           string `json:"url"`
				EnvironmentID string `json:"environmentID"`
			}
			err = json.Unmarshal(ev.Data, &gadgetInfoRequest)
			if err != nil {
				send(ev.SetError(err))
				return
			}

			env, err := w.GetRuntime(gadgetInfoRequest.EnvironmentID)
			if err != nil {
				send(ev.SetError(err))
				return
			}

			go func() {
				gadgetCtx := gadgetcontext.New(
					ctx,
					gadgetInfoRequest.URL,
				)

				// use default params; TODO!
				rtParams := env.ParamDescs().ToParams()
				gi, err := env.GetGadgetInfo(gadgetCtx, rtParams, nil)
				if err != nil {
					send(ev.SetError(err))
					return
				}
				send(ev.SetData(gi))
			}()
			return
		case "createEnvironment":
			env := &Environment{}
			err = json.Unmarshal(ev.Data, env)
			if err != nil {
				send(ev.SetError(err))
				return
			}
			err = w.AddEnvironment(env)
			if err != nil {
				send(ev.SetError(err))
				return
			}
			// Emit new environment first
			d, _ := json.Marshal(env)
			cmd := &GadgetEvent{
				Type: TypeEnvironmentCreate,
				Data: d,
			}
			send(cmd)

			// Then ack create action
			send(ev.SetData(env))
		case "deleteEnvironment":
			env := &Environment{}
			err = json.Unmarshal(ev.Data, env)
			if err != nil {
				send(ev.SetError(err))
				return
			}
			err = w.DeleteEnvironment(env)
			// Emit deletion of environment first
			d, _ := json.Marshal(env)
			cmd := &GadgetEvent{
				Type: TypeEnvironmentDelete,
				Data: d,
			}
			send(cmd)

			// Then ack create action
			send(ev.SetData(env))
		case "getArtifactHubPackage":
			var hubRequest struct {
				Repository string `json:"repository"`
				Package    string `json:"package"`
				Version    string `json:"version"`
			}
			err = json.Unmarshal(ev.Data, &hubRequest)
			if err != nil {
				send(ev.SetError(err))
				return
			}
			go func() {
				req, err := http.NewRequestWithContext(ctx, "GET", fmt.Sprintf("https://artifacthub.io/api/v1/packages/inspektor-gadget/%s/%s/%s", hubRequest.Repository, hubRequest.Package, hubRequest.Version), nil)
				if err != nil {
					send(ev.SetError(err))
					return
				}
				resp, err := http.DefaultClient.Do(req)
				if err != nil {
					send(ev.SetError(err))
					return
				}
				var response struct {
					Code int             `json:"code"`
					Data json.RawMessage `json:"data"`
				}
				response.Code = resp.StatusCode
				response.Data, err = io.ReadAll(resp.Body)
				if err != nil {
					send(ev.SetError(err))
					return
				}
				send(ev.SetData(response))
			}()
		}
	})
	return nil
}
