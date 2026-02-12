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
	"slices"

	log "github.com/sirupsen/logrus"
	appsv1 "k8s.io/api/apps/v1"
	v1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
)

type DeploymentStatus struct {
	Deployed  bool   `json:"deployed"`
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

	// Try both label selectors for DaemonSets
	labelSelectors := []string{
		"app.kubernetes.io/name=gadget",
		"k8s-app=gadget",
	}

	for _, selector := range labelSelectors {
		daemonSets, err := clientset.AppsV1().DaemonSets(namespace).List(ctx, metav1.ListOptions{
			LabelSelector: selector,
		})
		if err != nil {
			log.Warnf("Failed to list DaemonSets in namespace %s with selector %s: %v", namespace, selector, err)
			continue
		}

		if len(daemonSets.Items) > 0 {
			log.Infof("Found Inspektor Gadget DaemonSet in namespace %s with label selector %s", namespace, selector)
			return buildDeploymentStatus(daemonSets.Items[0], namespace), nil
		}
	}

	// Try both label selectors for Deployments (alternative deployment method)
	for _, selector := range labelSelectors {
		deployments, err := clientset.AppsV1().Deployments(namespace).List(ctx, metav1.ListOptions{
			LabelSelector: selector,
		})
		if err != nil {
			log.Warnf("Failed to list Deployments in namespace %s with selector %s: %v", namespace, selector, err)
			continue
		}

		if len(deployments.Items) > 0 {
			log.Infof("Found Inspektor Gadget Deployment in namespace %s with label selector %s", namespace, selector)
			return buildDeploymentStatusFromDeployment(deployments.Items[0], namespace), nil
		}
	}

	// Not found in specified namespace, try all namespaces
	log.Infof("Inspektor Gadget not found in namespace %s, checking all namespaces", namespace)
	return checkAllNamespaces(ctx, clientset)
}

// checkAllNamespaces checks all namespaces for Inspektor Gadget deployment
func checkAllNamespaces(ctx context.Context, clientset *kubernetes.Clientset) (*DeploymentStatus, error) {
	// Get all namespaces
	namespaces, err := clientset.CoreV1().Namespaces().List(ctx, metav1.ListOptions{})
	if err != nil {
		return &DeploymentStatus{
			Deployed: false,
			Error:    fmt.Sprintf("Failed to list namespaces: %v", err),
		}, err
	}

	// Check common namespaces first (optimization)
	commonNamespaces := []string{"gadget", "kube-system", "ig-system", "inspektor-gadget"}
	for _, ns := range commonNamespaces {
		if status := checkNamespace(ctx, clientset, ns); status.Deployed {
			return status, nil
		}
	}

	// Check remaining namespaces
	for _, ns := range namespaces.Items {
		if slices.Contains(commonNamespaces, ns.Name) {
			continue // Already checked
		}
		if status := checkNamespace(ctx, clientset, ns.Name); status.Deployed {
			return status, nil
		}
	}

	return &DeploymentStatus{Deployed: false}, nil
}

// checkNamespace checks a specific namespace for IG deployment
func checkNamespace(ctx context.Context, clientset *kubernetes.Clientset, namespace string) *DeploymentStatus {
	// Try both label selectors
	labelSelectors := []string{
		"app.kubernetes.io/name=gadget",
		"k8s-app=gadget",
	}

	for _, selector := range labelSelectors {
		daemonSets, err := clientset.AppsV1().DaemonSets(namespace).List(ctx, metav1.ListOptions{
			LabelSelector: selector,
		})
		if err == nil && len(daemonSets.Items) > 0 {
			return buildDeploymentStatus(daemonSets.Items[0], namespace)
		}

		deployments, err := clientset.AppsV1().Deployments(namespace).List(ctx, metav1.ListOptions{
			LabelSelector: selector,
		})
		if err == nil && len(deployments.Items) > 0 {
			return buildDeploymentStatusFromDeployment(deployments.Items[0], namespace)
		}
	}

	return &DeploymentStatus{Deployed: false}
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
