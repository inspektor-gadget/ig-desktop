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

package k8s

import (
	"context"
	"fmt"
	appsv1 "k8s.io/api/apps/v1"
	v1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
)

type DeploymentStatus struct {
	Deployed  bool   `json:"deployed"`
	Missing   bool   `json:"missing,omitempty"`
	Namespace string `json:"namespace,omitempty"`
	Version   string `json:"version,omitempty"`
	Error     string `json:"error,omitempty"`
}

// CheckIGDeployment checks if Inspektor Gadget is deployed in the cluster
func CheckIGDeployment(ctx context.Context, config *rest.Config, namespace string) (*DeploymentStatus, error) {
	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		return &DeploymentStatus{
			Deployed: false,
			Error:    fmt.Sprintf("Failed to create Kubernetes client: %v", err),
		}, err
	}

	status, err := checkNamespace(ctx, clientset, namespace)
	if err == nil && !status.Deployed && namespace != "" {
		// A differently configured namespace is not proof that IG is absent.
		status, err = checkNamespace(ctx, clientset, metav1.NamespaceAll)
	}
	if err != nil {
		return &DeploymentStatus{Error: err.Error()}, err
	}
	status.Missing = !status.Deployed
	return status, nil
}

// checkNamespace checks a specific namespace for IG deployment
func checkNamespace(ctx context.Context, clientset kubernetes.Interface, namespace string) (*DeploymentStatus, error) {
	// Try both label selectors
	labelSelectors := []string{
		"app.kubernetes.io/name=gadget",
		"k8s-app=gadget",
	}

	for _, selector := range labelSelectors {
		daemonSets, err := clientset.AppsV1().DaemonSets(namespace).List(ctx, metav1.ListOptions{
			LabelSelector: selector,
		})
		if err != nil {
			return nil, fmt.Errorf("checking IG DaemonSets: %w", err)
		}
		if len(daemonSets.Items) > 0 {
			return buildDeploymentStatus(daemonSets.Items[0], daemonSets.Items[0].Namespace), nil
		}

		deployments, err := clientset.AppsV1().Deployments(namespace).List(ctx, metav1.ListOptions{
			LabelSelector: selector,
		})
		if err != nil {
			return nil, fmt.Errorf("checking IG Deployments: %w", err)
		}
		if len(deployments.Items) > 0 {
			return buildDeploymentStatusFromDeployment(deployments.Items[0], deployments.Items[0].Namespace), nil
		}

		pods, err := clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{LabelSelector: selector})
		if err != nil {
			return nil, fmt.Errorf("checking IG Pods: %w", err)
		}
		if len(pods.Items) > 0 {
			// Pending/unready workloads are installed, not an invitation to deploy again.
			return &DeploymentStatus{Deployed: true, Namespace: pods.Items[0].Namespace}, nil
		}
	}

	return &DeploymentStatus{}, nil
}

// buildDeploymentStatus creates a DeploymentStatus from a DaemonSet
func buildDeploymentStatus(ds appsv1.DaemonSet, namespace string) *DeploymentStatus {
	version := "unknown"
	if v, ok := ds.Labels["app.kubernetes.io/version"]; ok {
		version = v
	} else if v, ok := ds.Labels["version"]; ok {
		version = v
	} else {
		// Try to extract from image tag
		if len(ds.Spec.Template.Spec.Containers) > 0 {
			version = extractVersionFromImage(ds.Spec.Template.Spec.Containers[0].Image)
		}
	}

	return &DeploymentStatus{
		Deployed:  true,
		Namespace: namespace,
		Version:   version,
	}
}

// buildDeploymentStatusFromDeployment creates a DeploymentStatus from a Deployment
func buildDeploymentStatusFromDeployment(d appsv1.Deployment, namespace string) *DeploymentStatus {
	version := "unknown"
	if v, ok := d.Labels["app.kubernetes.io/version"]; ok {
		version = v
	} else if v, ok := d.Labels["version"]; ok {
		version = v
	} else {
		// Try to extract from image tag
		if len(d.Spec.Template.Spec.Containers) > 0 {
			version = extractVersionFromImage(d.Spec.Template.Spec.Containers[0].Image)
		}
	}

	return &DeploymentStatus{
		Deployed:  true,
		Namespace: namespace,
		Version:   version,
	}
}

// extractVersionFromImage extracts version from container image tag
func extractVersionFromImage(image string) string {
	// Image format: registry/image:tag
	for i := len(image) - 1; i >= 0; i-- {
		if image[i] == ':' {
			return image[i+1:]
		}
	}
	return "latest"
}

// GetKubeConfig loads the Kubernetes configuration with optional context
func GetKubeConfig(kubeconfig string, kubeContext string) (*rest.Config, error) {
	if kubeconfig != "" {
		return clientcmd.BuildConfigFromFlags("", kubeconfig)
	}

	// Try in-cluster config first
	if config, err := rest.InClusterConfig(); err == nil {
		return config, nil
	}

	// Fall back to default kubeconfig with optional context override
	loadingRules := clientcmd.NewDefaultClientConfigLoadingRules()
	configOverrides := &clientcmd.ConfigOverrides{
		CurrentContext: kubeContext,
	}
	return clientcmd.NewNonInteractiveDeferredLoadingClientConfig(
		loadingRules,
		configOverrides,
	).ClientConfig()
}

// GetGadgetPods returns all gadget pods in the namespace
func GetGadgetPods(ctx context.Context, config *rest.Config, namespace string) ([]v1.Pod, error) {
	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		return nil, fmt.Errorf("failed to create Kubernetes client: %w", err)
	}

	// Try both label selectors
	labelSelectors := []string{
		"app.kubernetes.io/name=gadget",
		"k8s-app=gadget",
	}

	for _, selector := range labelSelectors {
		pods, err := clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{
			LabelSelector: selector,
		})
		if err == nil && len(pods.Items) > 0 {
			return pods.Items, nil
		}
	}

	// Return empty list if not found with either selector
	return []v1.Pod{}, nil
}
