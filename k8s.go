package main

import (
	"fmt"

	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
)

func (a *App) GetK8SConfigForEnvironment(environmentID string) (*rest.Config, error) {
	env, err := a.GetEnvironment(environmentID)
	if err != nil {
		return nil, err
	}

	if env.Runtime != TypeK8S {
		return nil, fmt.Errorf("unsupported environment type: %s", env.Runtime)
	}

	return clientcmd.NewNonInteractiveDeferredLoadingClientConfig(
		clientcmd.NewDefaultClientConfigLoadingRules(),
		&clientcmd.ConfigOverrides{
			CurrentContext: env.Params[ParamContext],
		}).ClientConfig()
}
