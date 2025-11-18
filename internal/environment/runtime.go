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

package environment

import (
	"fmt"
	"log"

	"github.com/inspektor-gadget/inspektor-gadget/cmd/kubectl-gadget/utils"
	"github.com/inspektor-gadget/inspektor-gadget/pkg/gadgets"
	"k8s.io/client-go/tools/clientcmd"

	"ig-frontend/internal/api"
	grpcruntime "ig-frontend/pkg/grpc-runtime"
)

// RuntimeFactory handles creation and initialization of runtimes from environment configs
type RuntimeFactory struct {
	storage *Storage
}

// NewRuntimeFactory creates a new RuntimeFactory
func NewRuntimeFactory(storage *Storage) *RuntimeFactory {
	return &RuntimeFactory{
		storage: storage,
	}
}

// GetKubernetesContexts returns a list of available Kubernetes contexts
func GetKubernetesContexts() ([]string, error) {
	cfg, err := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(
		clientcmd.NewDefaultClientConfigLoadingRules(),
		&clientcmd.ConfigOverrides{},
	).RawConfig()
	if err != nil {
		return nil, err
	}

	list := make([]string, 0, len(cfg.Contexts))
	for k := range cfg.Contexts {
		list = append(list, k)
	}
	return list, nil
}

// GetRuntime loads an environment and initializes its runtime
func (f *RuntimeFactory) GetRuntime(id string) (*grpcruntime.Runtime, error) {
	environment, err := f.storage.Get(id)
	if err != nil {
		return nil, err
	}

	var rt *grpcruntime.Runtime
	switch environment.Runtime {
	case "grpc-k8s":
		rt = grpcruntime.New(grpcruntime.WithConnectUsingK8SProxy)

		// Load Kubernetes config with context override if specified
		context := environment.Params["context"]
		config, err := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(
			clientcmd.NewDefaultClientConfigLoadingRules(),
			&clientcmd.ConfigOverrides{
				CurrentContext: context,
			},
		).ClientConfig()
		if err != nil {
			return nil, fmt.Errorf("could not load kubernetes config: %v", err)
		}
		rt.SetRestConfig(config)

		namespace, _ := utils.GetNamespace()
		rt.SetDefaultValue(gadgets.K8SNamespace, namespace)
	case "grpc-ig":
		rt = grpcruntime.New()
	default:
		return nil, &api.ErrInvalidRuntime{Runtime: environment.Runtime}
	}

	params := rt.GlobalParamDescs().ToParams()
	err = params.CopyFromMap(environment.Params, "")
	if err != nil {
		log.Printf("failed to copy params: %v", err)
		return nil, fmt.Errorf("copying environment params: %w", err)
	}

	err = rt.Init(params)
	if err != nil {
		log.Printf("failed to init runtime: %v", err)
		return nil, fmt.Errorf("initializing runtime: %w", err)
	}

	return rt, nil
}

// GetRuntimeParams returns the global parameters for a given runtime type
func (f *RuntimeFactory) GetRuntimeParams(runtimeType string) (interface{}, error) {
	var rt *grpcruntime.Runtime
	switch runtimeType {
	case "grpc-k8s":
		rt = grpcruntime.New(grpcruntime.WithConnectUsingK8SProxy)
	case "grpc-ig":
		rt = grpcruntime.New()
	default:
		return nil, &api.ErrInvalidRuntime{Runtime: runtimeType}
	}
	params := rt.GlobalParamDescs().ToParams()
	return params, nil
}
