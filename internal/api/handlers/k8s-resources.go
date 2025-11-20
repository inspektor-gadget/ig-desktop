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

package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	log "github.com/sirupsen/logrus"
	v1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"

	"ig-frontend/internal/api"
	"ig-frontend/internal/k8s"
)

// K8sResourceRequest represents a request for Kubernetes resources
type K8sResourceRequest struct {
	EnvironmentID string `json:"environmentID"`
	ResourceType  string `json:"resourceType"`
	Namespace     string `json:"namespace,omitempty"`
	Pod           string `json:"pod,omitempty"`
	Search        string `json:"search,omitempty"`
}

// K8sResourceItem represents a single resource item in the response
type K8sResourceItem struct {
	Name  string `json:"name"`
	Value string `json:"value"`
	Label string `json:"label,omitempty"`
}

// K8sResourceResponse represents the response containing K8s resources
type K8sResourceResponse struct {
	Items []K8sResourceItem `json:"items"`
	Error string            `json:"error,omitempty"`
}

// getK8sClientFromEnvironment creates a Kubernetes client from environment config
func (h *Handler) getK8sClientFromEnvironment(environmentID string) (*kubernetes.Clientset, error) {
	env, err := h.envStorage.Get(environmentID)
	if err != nil {
		return nil, fmt.Errorf("failed to get environment: %w", err)
	}

	// Get kubeconfig and context from environment params
	kubeConfigPath := env.Params["kubeconfig"]
	kubeContext := env.Params["context"]

	// Get Kubernetes config
	config, err := k8s.GetKubeConfig(kubeConfigPath, kubeContext)
	if err != nil {
		return nil, fmt.Errorf("failed to load kubeconfig: %w", err)
	}

	// Create clientset
	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		return nil, fmt.Errorf("failed to create Kubernetes client: %w", err)
	}

	return clientset, nil
}

// HandleGetK8sNodes retrieves a list of Kubernetes nodes
func (h *Handler) HandleGetK8sNodes(ev *api.Event) {
	var req K8sResourceRequest
	if err := json.Unmarshal(ev.Data, &req); err != nil {
		h.send(ev.SetError(err))
		return
	}

	clientset, err := h.getK8sClientFromEnvironment(req.EnvironmentID)
	if err != nil {
		h.send(ev.SetData(K8sResourceResponse{Error: err.Error()}))
		return
	}

	nodes, err := clientset.CoreV1().Nodes().List(context.Background(), metav1.ListOptions{})
	if err != nil {
		log.Errorf("Failed to list nodes: %v", err)
		h.send(ev.SetData(K8sResourceResponse{Error: err.Error()}))
		return
	}

	items := make([]K8sResourceItem, 0, len(nodes.Items))
	for _, node := range nodes.Items {
		// Filter by search query if provided
		if req.Search != "" && !strings.Contains(strings.ToLower(node.Name), strings.ToLower(req.Search)) {
			continue
		}

		items = append(items, K8sResourceItem{
			Name:  node.Name,
			Value: node.Name,
			Label: node.Name,
		})
	}

	h.send(ev.SetData(K8sResourceResponse{Items: items}))
}

// HandleGetK8sPods retrieves a list of Kubernetes pods
func (h *Handler) HandleGetK8sPods(ev *api.Event) {
	var req K8sResourceRequest
	if err := json.Unmarshal(ev.Data, &req); err != nil {
		h.send(ev.SetError(err))
		return
	}

	clientset, err := h.getK8sClientFromEnvironment(req.EnvironmentID)
	if err != nil {
		h.send(ev.SetData(K8sResourceResponse{Error: err.Error()}))
		return
	}

	// If namespace is not provided, use all namespaces
	namespace := req.Namespace
	if namespace == "" {
		namespace = v1.NamespaceAll
	}

	pods, err := clientset.CoreV1().Pods(namespace).List(context.Background(), metav1.ListOptions{})
	if err != nil {
		log.Errorf("Failed to list pods: %v", err)
		h.send(ev.SetData(K8sResourceResponse{Error: err.Error()}))
		return
	}

	items := make([]K8sResourceItem, 0, len(pods.Items))
	for _, pod := range pods.Items {
		// Filter by search query if provided
		if req.Search != "" && !strings.Contains(strings.ToLower(pod.Name), strings.ToLower(req.Search)) {
			continue
		}

		label := pod.Name
		// If we're filtering by namespace, show just the name, otherwise include namespace
		if namespace == v1.NamespaceAll {
			label = fmt.Sprintf("%s (%s)", pod.Name, pod.Namespace)
		}

		items = append(items, K8sResourceItem{
			Name:  pod.Name,
			Value: pod.Name,
			Label: label,
		})
	}

	h.send(ev.SetData(K8sResourceResponse{Items: items}))
}

// HandleGetK8sNamespaces retrieves a list of Kubernetes namespaces
func (h *Handler) HandleGetK8sNamespaces(ev *api.Event) {
	var req K8sResourceRequest
	if err := json.Unmarshal(ev.Data, &req); err != nil {
		h.send(ev.SetError(err))
		return
	}

	clientset, err := h.getK8sClientFromEnvironment(req.EnvironmentID)
	if err != nil {
		h.send(ev.SetData(K8sResourceResponse{Error: err.Error()}))
		return
	}

	namespaces, err := clientset.CoreV1().Namespaces().List(context.Background(), metav1.ListOptions{})
	if err != nil {
		log.Errorf("Failed to list namespaces: %v", err)
		h.send(ev.SetData(K8sResourceResponse{Error: err.Error()}))
		return
	}

	items := make([]K8sResourceItem, 0, len(namespaces.Items))
	for _, ns := range namespaces.Items {
		// Filter by search query if provided
		if req.Search != "" && !strings.Contains(strings.ToLower(ns.Name), strings.ToLower(req.Search)) {
			continue
		}

		items = append(items, K8sResourceItem{
			Name:  ns.Name,
			Value: ns.Name,
			Label: ns.Name,
		})
	}

	h.send(ev.SetData(K8sResourceResponse{Items: items}))
}

// HandleGetK8sContainers retrieves a list of containers in a pod
func (h *Handler) HandleGetK8sContainers(ev *api.Event) {
	var req K8sResourceRequest
	if err := json.Unmarshal(ev.Data, &req); err != nil {
		h.send(ev.SetError(err))
		return
	}

	if req.Pod == "" {
		h.send(ev.SetData(K8sResourceResponse{Items: []K8sResourceItem{}}))
		return
	}

	clientset, err := h.getK8sClientFromEnvironment(req.EnvironmentID)
	if err != nil {
		h.send(ev.SetData(K8sResourceResponse{Error: err.Error()}))
		return
	}

	// If namespace is not provided, try to find the pod across all namespaces
	namespace := req.Namespace
	var pod *v1.Pod

	if namespace == "" {
		// List pods across all namespaces to find the one with matching name
		pods, listErr := clientset.CoreV1().Pods(v1.NamespaceAll).List(context.Background(), metav1.ListOptions{
			FieldSelector: fmt.Sprintf("metadata.name=%s", req.Pod),
		})
		if listErr != nil {
			log.Errorf("Failed to list pods: %v", listErr)
			h.send(ev.SetData(K8sResourceResponse{Error: listErr.Error()}))
			return
		}
		if len(pods.Items) == 0 {
			h.send(ev.SetData(K8sResourceResponse{Error: fmt.Sprintf("pod %q not found", req.Pod)}))
			return
		}
		// Use the first matching pod
		pod = &pods.Items[0]
	} else {
		// Namespace provided, get pod from specific namespace
		var getErr error
		pod, getErr = clientset.CoreV1().Pods(namespace).Get(context.Background(), req.Pod, metav1.GetOptions{})
		if getErr != nil {
			log.Errorf("Failed to get pod: %v", getErr)
			h.send(ev.SetData(K8sResourceResponse{Error: getErr.Error()}))
			return
		}
	}

	items := make([]K8sResourceItem, 0)

	// Add regular containers
	for _, container := range pod.Spec.Containers {
		// Filter by search query if provided
		if req.Search != "" && !strings.Contains(strings.ToLower(container.Name), strings.ToLower(req.Search)) {
			continue
		}

		items = append(items, K8sResourceItem{
			Name:  container.Name,
			Value: container.Name,
			Label: container.Name,
		})
	}

	// Add init containers
	for _, container := range pod.Spec.InitContainers {
		// Filter by search query if provided
		if req.Search != "" && !strings.Contains(strings.ToLower(container.Name), strings.ToLower(req.Search)) {
			continue
		}

		items = append(items, K8sResourceItem{
			Name:  container.Name,
			Value: container.Name,
			Label: fmt.Sprintf("%s (init)", container.Name),
		})
	}

	h.send(ev.SetData(K8sResourceResponse{Items: items}))
}

// HandleGetK8sLabels retrieves a list of unique labels from pods
func (h *Handler) HandleGetK8sLabels(ev *api.Event) {
	var req K8sResourceRequest
	if err := json.Unmarshal(ev.Data, &req); err != nil {
		h.send(ev.SetError(err))
		return
	}

	clientset, err := h.getK8sClientFromEnvironment(req.EnvironmentID)
	if err != nil {
		h.send(ev.SetData(K8sResourceResponse{Error: err.Error()}))
		return
	}

	// If namespace is not provided, use all namespaces
	namespace := req.Namespace
	if namespace == "" {
		namespace = v1.NamespaceAll
	}

	pods, err := clientset.CoreV1().Pods(namespace).List(context.Background(), metav1.ListOptions{})
	if err != nil {
		log.Errorf("Failed to list pods: %v", err)
		h.send(ev.SetData(K8sResourceResponse{Error: err.Error()}))
		return
	}

	// Collect unique label keys and values
	labelSet := make(map[string]bool)
	for _, pod := range pods.Items {
		for key, value := range pod.Labels {
			labelPair := fmt.Sprintf("%s=%s", key, value)
			labelSet[labelPair] = true

			// Also add just the key
			labelSet[key] = true
		}
	}

	items := make([]K8sResourceItem, 0)
	for label := range labelSet {
		// Filter by search query if provided
		if req.Search != "" && !strings.Contains(strings.ToLower(label), strings.ToLower(req.Search)) {
			continue
		}

		items = append(items, K8sResourceItem{
			Name:  label,
			Value: label,
			Label: label,
		})
	}

	h.send(ev.SetData(K8sResourceResponse{Items: items}))
}
