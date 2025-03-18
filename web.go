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
	"github.com/inspektor-gadget/inspektor-gadget/pkg/datasource"
	gadgetcontext "github.com/inspektor-gadget/inspektor-gadget/pkg/gadget-context"
	"github.com/inspektor-gadget/inspektor-gadget/pkg/gadget-service/api"
	"github.com/inspektor-gadget/inspektor-gadget/pkg/gadgets"
	"github.com/inspektor-gadget/inspektor-gadget/pkg/logger"
	"github.com/inspektor-gadget/inspektor-gadget/pkg/operators"
	"github.com/inspektor-gadget/inspektor-gadget/pkg/operators/simple"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"google.golang.org/protobuf/encoding/protojson"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/clientcmd"

	"ig-frontend/pkg/deploy"
	grpcruntime "ig-frontend/pkg/grpc-runtime"
	json2 "ig-frontend/pkg/json"
)

const (
	ParamContext = "context"

	TypeK8S    = "grpc-k8s"
	TypeDaemon = "grpc-ig"
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
	TypeGadgetPrepare     = 7
	TypeDeployLog         = 20
	TypeEnvironmentCreate = 100
	TypeEnvironmentDelete = 101
	TypeEnvironmentUpdate = 102
)

type Environment struct {
	ID      string            `json:"id"`
	Name    string            `json:"name"`
	Runtime string            `json:"runtime"`
	Params  map[string]string `json:"params"`

	// InDeployment is only used at runtime
	InDeployment bool `json:"inDeployment"`
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

func (a *App) GetEnvironment(id string) (*Environment, error) {
	if err := uuid.Validate(id); err != nil {
		return nil, fmt.Errorf("invalid environment ID %q: %w", id, err)
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
	return &environment, nil
}

func (a *App) GetRuntime(id string) (*grpcruntime.Runtime, error) {
	environment, err := a.GetEnvironment(id)
	if err != nil {
		return nil, err
	}
	var rt *grpcruntime.Runtime
	switch environment.Runtime {
	case TypeK8S:
		rt = grpcruntime.New(grpcruntime.WithConnectUsingK8SProxy)
		config, err := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(
			clientcmd.NewDefaultClientConfigLoadingRules(),
			&clientcmd.ConfigOverrides{
				CurrentContext: environment.Params[ParamContext],
			}).ClientConfig()
		if err != nil {
			return nil, fmt.Errorf("could not load kubernetes config: %v", err)
		}
		rt.SetRestConfig(config)

		namespace, _ := utils.GetNamespace()
		rt.SetDefaultValue(gadgets.K8SNamespace, namespace)
	case TypeDaemon:
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

func (a *App) AddEnvironment(environment *Environment) error {
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

func (a *App) DeleteEnvironment(environment *Environment) error {
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

func (a *App) GetEnvironments() ([]*Environment, error) {
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
	send        func(any)
	instanceID  string
	messageType int
	level       logger.Level
}

func (l *GenericLogger) SetLevel(level logger.Level) {
	l.level = level
}

func (l *GenericLogger) GetLevel() logger.Level {
	return l.level
}

func (l *GenericLogger) Log(severity logger.Level, params ...any) {
	d, _ := json.Marshal(map[string]any{
		"severity": uint32(severity),
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
		"severity": uint32(severity),
		"msg":      fmt.Sprintf(format, params...),
	})
	l.send(&GadgetEvent{
		InstanceID: l.instanceID,
		Type:       TypeGadgetLog,
		Data:       d,
	})
}

func (a *App) Run() error {
	var l sync.Mutex

	cancellers := make(map[string]context.CancelFunc)

	send := func(ev any) {
		d, _ := json.Marshal(ev)
		l.Lock()
		defer l.Unlock()
		runtime.EventsEmit(a.ctx, "client", string(d))
	}

	ctx := a.ctx

	runtime.EventsOn(ctx, "server", func(optionalData ...interface{}) {
		ev := &Event{}

		if len(optionalData) == 0 {
			log.Printf("no data in message")
			return
		}

		log.Printf("message: %s", optionalData[0])

		str, ok := optionalData[0].(string)
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
			env, err := a.GetEnvironments()
			if err != nil {
				// TODO LOG
				return
			}
			a.mu.Lock()
			// Set deployment status
			for _, env := range env {
				if _, ok := a.deploying[env.ID]; ok {
					env.InDeployment = true
				}
			}
			a.mu.Unlock()
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
			env, err := a.GetRuntime(removeInstanceRequest.EnvironmentID)
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
			env, err := a.GetRuntime(gadgetRunRequest.EnvironmentID)
			if err != nil {
				send(ev.SetError(err))
				return
			}

			instanceID := uuid.New().String()

			// First, send an event that lets the client prepare for receiving gadget relevant information
			xev := &GadgetEvent{
				Type:          TypeGadgetPrepare,
				EnvironmentID: gadgetRunRequest.EnvironmentID,
				InstanceID:    instanceID,
			}
			send(xev)

			xop := simple.New("exp", simple.WithPriority(1000), simple.OnPreStart(func(gadgetCtx operators.GadgetContext) error {
				gi, _ := gadgetCtx.SerializeGadgetInfo()
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
				gadgetcontext.WithLogger(logger.NewFromGenericLogger(&GenericLogger{send: send, instanceID: instanceID, messageType: TypeGadgetLog, level: logger.DebugLevel})),
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
				{Key: TypeDaemon, Title: "IG Daemon", Description: "Connect to Inspektor Gadget running as Daemon"},
				{Key: TypeK8S, Title: "IG on Kubernetes", Description: "Connect to Inspektor Gadget running on a Kubernetes cluster"},
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
				env, err := a.GetRuntime(listInstancesRequest.EnvironmentID)
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

			env, err := a.GetRuntime(gadgetInfoRequest.EnvironmentID)
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

			// keep runtime info clean
			env.InDeployment = false

			err = a.AddEnvironment(env)
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
			err = a.DeleteEnvironment(env)
			// Emit deletion of environment first
			d, _ := json.Marshal(env)
			cmd := &GadgetEvent{
				Type: TypeEnvironmentDelete,
				Data: d,
			}
			send(cmd)

			// Then ack create action
			send(ev.SetData(env))
		case "getKubeContexts":
			cfg, err := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(
				// &clientcmd.ClientConfigLoadingRules{},
				clientcmd.NewDefaultClientConfigLoadingRules(),
				&clientcmd.ConfigOverrides{}).RawConfig()
			if err != nil {
				send(ev.SetError(err))
				return
			}

			list := make([]string, 0, len(cfg.Contexts))
			for k := range cfg.Contexts {
				list = append(list, k)
			}

			send(ev.SetData(list))
			return
		case "getDeploymentParams":
			params := (&deploy.Deployment{}).Params()
			send(ev.SetData(params))
		case "deploy":
			var deployRequest struct {
				EnvironmentID string            `json:"environmentID"`
				Params        map[string]string `json:"params"`
			}
			err = json.Unmarshal(ev.Data, &deployRequest)
			if err != nil {
				send(ev.SetError(err))
				return
			}

			log.Printf("%+v", deployRequest.Params)

			err := (&deploy.Deployment{}).ValidateParamValues(deployRequest.Params)
			if err != nil {
				send(ev.SetError(err))
				return
			}

			dpl := &deploy.Deployment{}
			dpl.Logger = logger.NewFromGenericLogger(&GenericLogger{send: send, level: logger.DebugLevel, messageType: TypeDeployLog})

			go func() {
				err = dpl.Deploy("gadget")
				if err != nil {
					send(ev.SetError(err))
					return
				}
				// Ack action
				send(ev.SetData(nil))
			}()
		case "getDeploymentStatus":
			var getDeploymentStatusRequest struct {
				EnvironmentID string `json:"environmentID"`
			}
			var getDeploymentStatusResponse struct {
				Found bool            `json:"found"`
				Info  json.RawMessage `json:"info"`
			}

			err = json.Unmarshal(ev.Data, &getDeploymentStatusRequest)
			if err != nil {
				send(ev.SetError(err))
				return
			}

			config, err := a.GetK8SConfigForEnvironment(getDeploymentStatusRequest.EnvironmentID)
			if err != nil {
				send(ev.SetError(err))
				return
			}

			k8sClient, err := kubernetes.NewForConfig(config)
			if err != nil {
				send(ev.SetError(err))
				return
			}

			daemonSetInterface := k8sClient.AppsV1().DaemonSets("gadget")
			list, err := daemonSetInterface.List(ctx, metav1.ListOptions{
				LabelSelector: "k8s-app=gadget",
			})
			if err != nil {
				send(ev.SetError(err))
				return
			}

			getDeploymentStatusResponse.Found = len(list.Items) > 0

			if len(list.Items) > 0 {
				info, _ := json.Marshal(list.Items[0])
				getDeploymentStatusResponse.Info = info
			}

			send(ev.SetData(&getDeploymentStatusResponse))
			return
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
