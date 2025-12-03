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
	"time"

	"github.com/google/uuid"
	log "github.com/sirupsen/logrus"
	"gopkg.in/yaml.v3"

	"ig-frontend/internal/api"
	"ig-frontend/internal/k8s"
	"ig-frontend/pkg/helm"
)

type CheckIGDeploymentRequest struct {
	Namespace   string `json:"namespace"`
	KubeContext string `json:"kubeContext,omitempty"`
}

type DeployIGRequest struct {
	Namespace    string `json:"namespace"`
	ReleaseName  string `json:"releaseName"`
	ChartVersion string `json:"chartVersion,omitempty"`
	CustomValues string `json:"customValues,omitempty"`
	KubeConfig   string `json:"kubeConfig,omitempty"`
	KubeContext  string `json:"kubeContext,omitempty"`
	Redeploy     bool   `json:"redeploy,omitempty"`
	Undeploy     bool   `json:"undeploy,omitempty"`
}

type DeployIGResponse struct {
	DeploymentID string `json:"deploymentId"`
}

type DeploymentStatusRequest struct {
	DeploymentID string `json:"deploymentId"`
}

type GetChartValuesRequest struct {
	ChartVersion string `json:"chartVersion,omitempty"`
}

type GetChartValuesResponse struct {
	Values string `json:"values"`
}

// HandleCheckIGDeployment checks if Inspektor Gadget is deployed in the cluster
func (h *Handler) HandleCheckIGDeployment(ev *api.Event) {
	req := &CheckIGDeploymentRequest{}
	err := json.Unmarshal(ev.Data, req)
	if err != nil {
		h.send(ev.SetError(err))
		return
	}

	// Get Kubernetes config with context
	config, err := k8s.GetKubeConfig("", req.KubeContext)
	if err != nil {
		h.send(ev.SetError(fmt.Errorf("failed to load kubeconfig: %w", err)))
		return
	}

	// Check deployment status
	status, err := k8s.CheckIGDeployment(h.ctx, config, req.Namespace)
	if err != nil {
		log.Warnf("Error checking IG deployment: %v", err)
		// Don't fail completely, return status with error message
	}

	h.send(ev.SetData(status))
}

// HandleDeployIG initiates the deployment of Inspektor Gadget to Kubernetes
func (h *Handler) HandleDeployIG(ev *api.Event) {
	req := &DeployIGRequest{}
	err := json.Unmarshal(ev.Data, req)
	if err != nil {
		h.send(ev.SetError(err))
		return
	}

	// Validate required fields
	if req.Namespace == "" {
		h.send(ev.SetError(fmt.Errorf("namespace is required")))
		return
	}
	if req.ReleaseName == "" {
		h.send(ev.SetError(fmt.Errorf("releaseName is required")))
		return
	}

	// Parse custom values if provided
	customValues := make(map[string]interface{})
	if req.CustomValues != "" {
		if err := yaml.Unmarshal([]byte(req.CustomValues), &customValues); err != nil {
			h.send(ev.SetError(fmt.Errorf("invalid custom values YAML: %w", err)))
			return
		}
	}

	// Generate deployment ID
	deploymentID := uuid.New().String()

	// Create deployment config
	deployConfig := &helm.DeployConfig{
		Namespace:    req.Namespace,
		ReleaseName:  req.ReleaseName,
		ChartVersion: req.ChartVersion,
		CustomValues: customValues,
		KubeConfig:   req.KubeConfig,
		KubeContext:  req.KubeContext,
	}

	// Return deployment ID immediately
	response := &DeployIGResponse{
		DeploymentID: deploymentID,
	}
	h.send(ev.SetData(response))

	// Start deployment in background
	go h.performDeployment(deploymentID, deployConfig, req.Redeploy, req.Undeploy)
}

// performDeployment runs the actual Helm deployment and streams progress
func (h *Handler) performDeployment(deploymentID string, config *helm.DeployConfig, redeploy bool, undeploy bool) {
	log.Infof("[Deploy %s] Starting deployment with config: %+v, redeploy: %v, undeploy: %v", deploymentID, config, redeploy, undeploy)
	deployer, err := helm.NewDeployer(config)
	if err != nil {
		log.Errorf("[Deploy %s] Failed to create deployer: %v", deploymentID, err)
		errorData := map[string]interface{}{
			"deploymentId": deploymentID,
			"error":        fmt.Sprintf("Failed to initialize Helm: %v", err),
			"progress":     0,
		}
		data, _ := json.Marshal(errorData)
		h.send(&api.GadgetEvent{
			Type: api.TypeDeploymentError,
			Data: data,
		})
		return
	}
	progressChan := deployer.GetProgressChan()

	// Create a context with timeout
	ctx, cancel := context.WithTimeout(h.ctx, 10*time.Minute)
	defer cancel()

	// Start deployment
	deployErr := make(chan error, 1)
	go func() {
		var err error
		if undeploy {
			log.Infof("[Deploy %s] Calling deployer.Undeploy()", deploymentID)
			err = deployer.Undeploy(ctx)
		} else if redeploy {
			log.Infof("[Deploy %s] Calling deployer.Redeploy()", deploymentID)
			err = deployer.Redeploy(ctx)
		} else {
			log.Infof("[Deploy %s] Calling deployer.Deploy()", deploymentID)
			err = deployer.Deploy(ctx)
		}
		log.Infof("[Deploy %s] deployer operation returned with error: %v", deploymentID, err)
		deployErr <- err
	}()

	// Stream progress updates
	log.Infof("[Deploy %s] Entering progress loop", deploymentID)
	timeoutTimer := time.NewTimer(10 * time.Minute)
	defer timeoutTimer.Stop()

	for {
		select {
		case <-timeoutTimer.C:
			// Global timeout exceeded
			log.Errorf("[Deploy %s] Global timeout exceeded (10 minutes)", deploymentID)
			errorData := map[string]interface{}{
				"deploymentId": deploymentID,
				"error":        "Operation timeout exceeded (10 minutes). The operation may still be running in the background. Please check your cluster manually.",
				"progress":     0,
			}
			data, _ := json.Marshal(errorData)
			h.send(&api.GadgetEvent{
				Type: api.TypeDeploymentError,
				Data: data,
			})
			return

		case progress, ok := <-progressChan:
			if !ok {
				// Channel closed, deployment finished
				log.Infof("[Deploy %s] Progress channel closed, exiting", deploymentID)
				return
			}

			log.Infof("[Deploy %s] Progress update: step=%s, progress=%d, message=%s, error=%v",
				deploymentID, progress.Step, progress.Progress, progress.Message, progress.Error)

			// Send progress update to frontend
			progressData := map[string]interface{}{
				"deploymentId": deploymentID,
				"step":         progress.Step,
				"progress":     progress.Progress,
				"message":      progress.Message,
			}

			if progress.Error != nil {
				progressData["error"] = progress.Error.Error()
				// Send error event
				data, _ := json.Marshal(progressData)
				log.Infof("[Deploy %s] Sending error event: %s", deploymentID, string(data))
				h.send(&api.GadgetEvent{
					Type: api.TypeDeploymentError,
					Data: data,
				})
			} else if progress.Progress == 100 {
				// Send completion event
				data, _ := json.Marshal(progressData)
				log.Infof("[Deploy %s] Sending completion event: %s", deploymentID, string(data))
				h.send(&api.GadgetEvent{
					Type: api.TypeDeploymentComplete,
					Data: data,
				})
			} else {
				// Send progress event
				data, _ := json.Marshal(progressData)
				log.Infof("[Deploy %s] Sending progress event: %s", deploymentID, string(data))
				h.send(&api.GadgetEvent{
					Type: api.TypeDeploymentProgress,
					Data: data,
				})
			}

		case err := <-deployErr:
			log.Infof("[Deploy %s] Received deployment error from channel: %v", deploymentID, err)
			if err != nil {
				log.Errorf("Deployment %s failed: %v", deploymentID, err)
				// Send final error if not already sent
				errorData := map[string]interface{}{
					"deploymentId": deploymentID,
					"error":        err.Error(),
					"progress":     0,
				}
				data, _ := json.Marshal(errorData)
				log.Infof("[Deploy %s] Sending final error event: %s", deploymentID, string(data))
				h.send(&api.GadgetEvent{
					Type: api.TypeDeploymentError,
					Data: data,
				})
				log.Infof("[Deploy %s] Exiting performDeployment due to error", deploymentID)
				return
			}
			// Success case - continue reading progress channel until it closes
			// to ensure we get the final 100% completion event
			log.Infof("[Deploy %s] Deployment succeeded, waiting for final progress events", deploymentID)
		}
	}
}

// HandleGetChartValues fetches the default values.yaml from the Helm chart
func (h *Handler) HandleGetChartValues(ev *api.Event) {
	req := &GetChartValuesRequest{}
	if len(ev.Data) > 0 {
		if err := json.Unmarshal(ev.Data, req); err != nil {
			h.send(ev.SetError(err))
			return
		}
	}

	values, err := helm.GetChartValues(req.ChartVersion)
	if err != nil {
		h.send(ev.SetError(fmt.Errorf("failed to get chart values: %w", err)))
		return
	}

	response := &GetChartValuesResponse{
		Values: values,
	}
	h.send(ev.SetData(response))
}
