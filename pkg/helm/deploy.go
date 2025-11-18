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

package helm

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"time"

	log "github.com/sirupsen/logrus"
	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/chart/loader"
	"helm.sh/helm/v3/pkg/cli"
	"helm.sh/helm/v3/pkg/getter"
	"helm.sh/helm/v3/pkg/repo"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/cli-runtime/pkg/genericclioptions"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
)

const (
	inspektorGadgetRepoName = "gadget"
	inspektorGadgetRepoURL  = "https://inspektor-gadget.github.io/charts"
	inspektorGadgetChart    = "gadget/gadget"
)

type DeployConfig struct {
	Namespace    string
	ReleaseName  string
	ChartVersion string
	CustomValues map[string]interface{}
	KubeConfig   string
	KubeContext  string
}

type DeployProgress struct {
	Step     string
	Progress int
	Message  string
	Error    error
}

type Deployer struct {
	config       *DeployConfig
	settings     *cli.EnvSettings
	progressChan chan DeployProgress
}

func NewDeployer(config *DeployConfig) *Deployer {
	settings := cli.New()
	if config.KubeConfig != "" {
		settings.KubeConfig = config.KubeConfig
	}

	return &Deployer{
		config:       config,
		settings:     settings,
		progressChan: make(chan DeployProgress, 100),
	}
}

func (d *Deployer) GetProgressChan() <-chan DeployProgress {
	return d.progressChan
}

func (d *Deployer) sendProgress(step string, progress int, message string, err error) {
	select {
	case d.progressChan <- DeployProgress{
		Step:     step,
		Progress: progress,
		Message:  message,
		Error:    err,
	}:
	default:
		log.Warnf("Progress channel full, dropping message: %s", message)
	}
}

func (d *Deployer) Deploy(ctx context.Context) error {
	defer close(d.progressChan)

	// Step 1: Add Helm repository
	d.sendProgress("add_repo", 10, "Adding Inspektor Gadget Helm repository", nil)
	if err := d.addRepo(ctx); err != nil {
		d.sendProgress("add_repo", 10, "Failed to add repository", err)
		return fmt.Errorf("failed to add helm repository: %w", err)
	}
	d.sendProgress("add_repo", 20, "Repository added successfully", nil)

	// Step 2: Update repository
	d.sendProgress("update_repo", 30, "Updating Helm repository", nil)
	if err := d.updateRepo(ctx); err != nil {
		d.sendProgress("update_repo", 30, "Failed to update repository", err)
		return fmt.Errorf("failed to update helm repository: %w", err)
	}
	d.sendProgress("update_repo", 40, "Repository updated successfully", nil)

	// Step 3: Create namespace if it doesn't exist
	d.sendProgress("create_namespace", 50, fmt.Sprintf("Creating namespace %s", d.config.Namespace), nil)
	if err := d.createNamespace(ctx); err != nil {
		log.Warnf("Namespace creation failed (may already exist): %v", err)
		// Don't fail if namespace already exists
	}
	d.sendProgress("create_namespace", 60, "Namespace ready", nil)

	// Step 4: Install chart
	d.sendProgress("install_chart", 70, fmt.Sprintf("Installing Inspektor Gadget (release: %s)", d.config.ReleaseName), nil)
	if err := d.installChart(ctx); err != nil {
		d.sendProgress("install_chart", 70, "Failed to install chart", err)
		return fmt.Errorf("failed to install chart: %w", err)
	}
	d.sendProgress("install_chart", 90, "Chart installed successfully", nil)

	// Step 5: Verify deployment
	d.sendProgress("verify", 95, "Verifying deployment", nil)
	if err := d.verifyDeployment(ctx); err != nil {
		log.Warnf("Deployment verification failed: %v", err)
		d.sendProgress("verify", 95, "Verification timed out, but Helm install completed", nil)
		// Don't fail the whole operation if verification times out
		// The Helm install already succeeded
	}

	d.sendProgress("complete", 100, "Deployment completed successfully", nil)
	return nil
}

func (d *Deployer) Undeploy(ctx context.Context) error {
	defer close(d.progressChan)

	// Uninstall deployment
	d.sendProgress("uninstall", 20, fmt.Sprintf("Uninstalling Inspektor Gadget (release: %s)", d.config.ReleaseName), nil)
	if err := d.uninstall(ctx); err != nil {
		d.sendProgress("uninstall", 20, "Failed to uninstall", err)
		return fmt.Errorf("failed to uninstall deployment: %w", err)
	}
	d.sendProgress("uninstall", 50, "Helm release removed", nil)

	// Wait for DaemonSet to be removed (up to 2 minutes)
	d.sendProgress("verify_removal", 60, "Verifying DaemonSet removal", nil)
	log.Infof("Waiting for DaemonSet to be removed (timeout: 2 minutes)")
	if err := d.waitForDaemonSetRemoval(ctx, 2*time.Minute); err != nil {
		log.Warnf("DaemonSet removal verification failed: %v", err)
		d.sendProgress("verify_removal", 90, "Verification timed out, but Helm uninstall completed", nil)
		// Don't fail the whole operation if verification times out
		// The Helm uninstall already succeeded
	} else {
		d.sendProgress("verify_removal", 90, "DaemonSet removed", nil)
	}

	d.sendProgress("complete", 100, "Undeployment completed successfully", nil)
	return nil
}

func (d *Deployer) Redeploy(ctx context.Context) error {
	defer close(d.progressChan)

	// Step 1: Uninstall existing deployment
	d.sendProgress("uninstall", 10, fmt.Sprintf("Uninstalling existing Inspektor Gadget (release: %s)", d.config.ReleaseName), nil)
	if err := d.uninstall(ctx); err != nil {
		d.sendProgress("uninstall", 10, "Failed to uninstall", err)
		return fmt.Errorf("failed to uninstall existing deployment: %w", err)
	}
	d.sendProgress("uninstall", 20, "Existing deployment removed", nil)

	// Step 2: Add Helm repository
	d.sendProgress("add_repo", 30, "Adding Inspektor Gadget Helm repository", nil)
	if err := d.addRepo(ctx); err != nil {
		d.sendProgress("add_repo", 30, "Failed to add repository", err)
		return fmt.Errorf("failed to add helm repository: %w", err)
	}
	d.sendProgress("add_repo", 35, "Repository added successfully", nil)

	// Step 3: Update repository
	d.sendProgress("update_repo", 40, "Updating Helm repository", nil)
	if err := d.updateRepo(ctx); err != nil {
		d.sendProgress("update_repo", 40, "Failed to update repository", err)
		return fmt.Errorf("failed to update helm repository: %w", err)
	}
	d.sendProgress("update_repo", 50, "Repository updated successfully", nil)

	// Step 4: Create namespace if it doesn't exist
	d.sendProgress("create_namespace", 55, fmt.Sprintf("Creating namespace %s", d.config.Namespace), nil)
	if err := d.createNamespace(ctx); err != nil {
		log.Warnf("Namespace creation failed (may already exist): %v", err)
	}
	d.sendProgress("create_namespace", 60, "Namespace ready", nil)

	// Step 5: Install chart
	d.sendProgress("install_chart", 70, fmt.Sprintf("Installing Inspektor Gadget (release: %s)", d.config.ReleaseName), nil)
	if err := d.installChart(ctx); err != nil {
		d.sendProgress("install_chart", 70, "Failed to install chart", err)
		return fmt.Errorf("failed to install chart: %w", err)
	}
	d.sendProgress("install_chart", 90, "Chart installed successfully", nil)

	// Step 6: Verify deployment
	d.sendProgress("verify", 95, "Verifying deployment", nil)
	if err := d.verifyDeployment(ctx); err != nil {
		log.Warnf("Deployment verification failed: %v", err)
		d.sendProgress("verify", 95, "Verification timed out, but Helm install completed", nil)
		// Don't fail the whole operation if verification times out
		// The Helm install already succeeded
	}

	d.sendProgress("complete", 100, "Redeployment completed successfully", nil)
	return nil
}

func (d *Deployer) uninstall(ctx context.Context) error {
	actionConfig := new(action.Configuration)
	configFlags := genericclioptions.NewConfigFlags(true)
	configFlags.Namespace = &d.config.Namespace

	if err := actionConfig.Init(configFlags, d.config.Namespace, os.Getenv("HELM_DRIVER"), log.Debugf); err != nil {
		return err
	}

	client := action.NewUninstall(actionConfig)
	client.Wait = true
	client.Timeout = 5 * time.Minute

	_, err := client.Run(d.config.ReleaseName)
	return err
}

func (d *Deployer) addRepo(ctx context.Context) error {
	repoFile := d.settings.RepositoryConfig

	// Ensure the repository directory exists
	if err := os.MkdirAll(filepath.Dir(repoFile), 0755); err != nil {
		return err
	}

	// Load existing repositories
	var repoFileContent *repo.File
	if _, err := os.Stat(repoFile); err == nil {
		repoFileContent, err = repo.LoadFile(repoFile)
		if err != nil {
			return err
		}
	} else {
		repoFileContent = repo.NewFile()
	}

	// Check if repo already exists
	for _, r := range repoFileContent.Repositories {
		if r.Name == inspektorGadgetRepoName {
			log.Infof("Repository %s already exists", inspektorGadgetRepoName)
			return nil
		}
	}

	// Add new repository
	entry := &repo.Entry{
		Name: inspektorGadgetRepoName,
		URL:  inspektorGadgetRepoURL,
	}

	chartRepo, err := repo.NewChartRepository(entry, getter.All(d.settings))
	if err != nil {
		return err
	}

	// Download index file
	if _, err := chartRepo.DownloadIndexFile(); err != nil {
		return err
	}

	repoFileContent.Update(entry)
	return repoFileContent.WriteFile(repoFile, 0644)
}

func (d *Deployer) updateRepo(ctx context.Context) error {
	repoFile := d.settings.RepositoryConfig
	repoFileContent, err := repo.LoadFile(repoFile)
	if err != nil {
		return err
	}

	for _, entry := range repoFileContent.Repositories {
		if entry.Name == inspektorGadgetRepoName {
			chartRepo, err := repo.NewChartRepository(entry, getter.All(d.settings))
			if err != nil {
				return err
			}
			if _, err := chartRepo.DownloadIndexFile(); err != nil {
				return err
			}
			return nil
		}
	}

	return fmt.Errorf("repository %s not found", inspektorGadgetRepoName)
}

func (d *Deployer) createNamespace(ctx context.Context) error {
	// Create action configuration
	actionConfig := new(action.Configuration)
	configFlags := genericclioptions.NewConfigFlags(true)
	configFlags.Namespace = &d.config.Namespace

	if err := actionConfig.Init(configFlags, d.config.Namespace, os.Getenv("HELM_DRIVER"), log.Debugf); err != nil {
		return err
	}

	// Use kubectl to create namespace (simpler than using client-go directly)
	// This is handled by Helm during installation with --create-namespace flag
	return nil
}

func (d *Deployer) installChart(ctx context.Context) error {
	actionConfig := new(action.Configuration)
	configFlags := genericclioptions.NewConfigFlags(true)
	configFlags.Namespace = &d.config.Namespace

	if err := actionConfig.Init(configFlags, d.config.Namespace, os.Getenv("HELM_DRIVER"), log.Debugf); err != nil {
		return err
	}

	client := action.NewInstall(actionConfig)
	client.Namespace = d.config.Namespace
	client.ReleaseName = d.config.ReleaseName
	client.CreateNamespace = true
	client.Wait = true
	client.Timeout = 5 * time.Minute

	if d.config.ChartVersion != "" {
		client.Version = d.config.ChartVersion
	}

	// Locate chart
	chartPath, err := client.ChartPathOptions.LocateChart(inspektorGadgetChart, d.settings)
	if err != nil {
		return err
	}

	// Load chart
	chart, err := loader.Load(chartPath)
	if err != nil {
		return err
	}

	// Install
	_, err = client.RunWithContext(ctx, chart, d.config.CustomValues)
	return err
}

func (d *Deployer) verifyDeployment(ctx context.Context) error {
	// Create action configuration
	actionConfig := new(action.Configuration)
	configFlags := genericclioptions.NewConfigFlags(true)
	configFlags.Namespace = &d.config.Namespace

	if err := actionConfig.Init(configFlags, d.config.Namespace, os.Getenv("HELM_DRIVER"), log.Debugf); err != nil {
		return err
	}

	// Check release status
	client := action.NewGet(actionConfig)
	release, err := client.Run(d.config.ReleaseName)
	if err != nil {
		return err
	}

	if release.Info.Status != "deployed" {
		return fmt.Errorf("release status is %s, expected deployed", release.Info.Status)
	}

	// Wait for DaemonSet to be ready (up to 2 minutes)
	log.Infof("Waiting for DaemonSet to be ready (timeout: 2 minutes)")
	return d.waitForDaemonSet(ctx, 2*time.Minute)
}

func (d *Deployer) waitForDaemonSet(ctx context.Context, timeout time.Duration) error {
	// Get Kubernetes config with context
	config, err := getKubeConfig(d.config.KubeConfig, d.config.KubeContext)
	if err != nil {
		return fmt.Errorf("failed to get kubeconfig: %w", err)
	}

	clientset, err := getKubernetesClient(config)
	if err != nil {
		return fmt.Errorf("failed to create Kubernetes client: %w", err)
	}

	startTime := time.Now()
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			// Check if timeout exceeded
			if time.Since(startTime) > timeout {
				return fmt.Errorf("timeout waiting for DaemonSet to be ready after %v. This could be due to slow network, slow cluster, or other issues. Please check your cluster manually", timeout)
			}

			// Try both label selectors
			labelSelectors := []string{
				"app.kubernetes.io/name=gadget",
				"k8s-app=gadget",
			}

			for _, selector := range labelSelectors {
				daemonSets, err := clientset.AppsV1().DaemonSets(d.config.Namespace).List(ctx, metav1.ListOptions{
					LabelSelector: selector,
				})
				if err != nil {
					log.Warnf("Failed to list DaemonSets: %v", err)
					continue
				}

				if len(daemonSets.Items) > 0 {
					ds := daemonSets.Items[0]
					log.Infof("DaemonSet status: desired=%d, current=%d, ready=%d, updated=%d",
						ds.Status.DesiredNumberScheduled,
						ds.Status.CurrentNumberScheduled,
						ds.Status.NumberReady,
						ds.Status.UpdatedNumberScheduled)

					// Check if DaemonSet is ready
					if ds.Status.NumberReady > 0 &&
						ds.Status.NumberReady == ds.Status.DesiredNumberScheduled {
						log.Infof("DaemonSet is ready!")
						return nil
					}
				}
			}

			log.Debugf("DaemonSet not ready yet, waiting... (elapsed: %v)", time.Since(startTime))
		}
	}
}

func (d *Deployer) waitForDaemonSetRemoval(ctx context.Context, timeout time.Duration) error {
	// Get Kubernetes config with context
	config, err := getKubeConfig(d.config.KubeConfig, d.config.KubeContext)
	if err != nil {
		return fmt.Errorf("failed to get kubeconfig: %w", err)
	}

	clientset, err := getKubernetesClient(config)
	if err != nil {
		return fmt.Errorf("failed to create Kubernetes client: %w", err)
	}

	startTime := time.Now()
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			// Check if timeout exceeded
			if time.Since(startTime) > timeout {
				return fmt.Errorf("timeout waiting for DaemonSet to be removed after %v. This could be due to slow network, slow cluster, or other issues. Please check your cluster manually", timeout)
			}

			// Try both label selectors
			labelSelectors := []string{
				"app.kubernetes.io/name=gadget",
				"k8s-app=gadget",
			}

			found := false
			for _, selector := range labelSelectors {
				daemonSets, err := clientset.AppsV1().DaemonSets(d.config.Namespace).List(ctx, metav1.ListOptions{
					LabelSelector: selector,
				})
				if err != nil {
					log.Warnf("Failed to list DaemonSets: %v", err)
					continue
				}

				if len(daemonSets.Items) > 0 {
					found = true
					log.Debugf("DaemonSet still exists, waiting for removal... (elapsed: %v)", time.Since(startTime))
					break
				}
			}

			// If no DaemonSet found with either selector, it's been removed
			if !found {
				log.Infof("DaemonSet successfully removed!")
				return nil
			}
		}
	}
}

func getKubeConfig(kubeconfig string, kubeContext string) (*rest.Config, error) {
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

func getKubernetesClient(config *rest.Config) (*kubernetes.Clientset, error) {
	return kubernetes.NewForConfig(config)
}
