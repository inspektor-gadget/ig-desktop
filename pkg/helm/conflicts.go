// Copyright 2026 The Inspektor Gadget authors
// SPDX-License-Identifier: Apache-2.0

package helm

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/chart"
	"helm.sh/helm/v3/pkg/kube"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/apimachinery/pkg/util/wait"
	"k8s.io/cli-runtime/pkg/resource"
	"k8s.io/client-go/kubernetes"
)

// ResourceIdentity binds approval to one observed version of one object.
type ResourceIdentity struct {
	APIVersion      string `json:"apiVersion"`
	Kind            string `json:"kind"`
	Namespace       string `json:"namespace"`
	Name            string `json:"name"`
	UID             string `json:"uid"`
	ResourceVersion string `json:"resourceVersion"`
}

type ResourceConflict struct {
	ResourceIdentity
	BlockedReason string `json:"blockedReason,omitempty"`
}

type OwnershipConflictError struct {
	Err       error
	Conflicts []ResourceConflict
}

func (e *OwnershipConflictError) Error() string { return e.Err.Error() }
func (e *OwnershipConflictError) Unwrap() error { return e.Err }

// ResourceConflicts returns only display/approval metadata, never object contents.
func ResourceConflicts(err error) []ResourceConflict {
	var conflict *OwnershipConflictError
	if errors.As(err, &conflict) {
		return conflict.Conflicts
	}
	return []ResourceConflict{}
}

func resourceKey(r ResourceIdentity) string {
	return r.APIVersion + "/" + r.Kind + "/" + r.Namespace + "/" + r.Name
}

func getConflictObject(ctx context.Context, info *resource.Info) (runtime.Object, error) {
	return info.Client.Get().
		NamespaceIfScoped(info.Namespace, info.Mapping.Scope.Name() == meta.RESTScopeNameNamespace).
		Resource(info.Mapping.Resource.Resource).Name(info.Name).Do(ctx).Get()
}

func deleteConflictObject(ctx context.Context, info *resource.Info, options *metav1.DeleteOptions) error {
	// Unlike resource.Helper, this honors cancellation and disables client-go's
	// automatic retries: a lost DELETE response is an uncertain outcome.
	return info.Client.Delete().
		NamespaceIfScoped(info.Namespace, info.Mapping.Scope.Name() == meta.RESTScopeNameNamespace).
		Resource(info.Mapping.Resource.Resource).Name(info.Name).
		Body(options).MaxRetries(0).Do(ctx).Error()
}

// Reasons why an existing object must not be deleted by IG cleanup. Exact
// approval and the label-based removal sweep share these rules.
const (
	blockedOwnerReferences = "Resource has Kubernetes owner references"
	blockedOtherRelease    = "Resource belongs to another Helm release"
	blockedForeignManager  = "Resource is managed by another installer"
	blockedHelmStorage     = "Helm release storage cannot be removed by conflict recovery"
	blockedKeepPolicy      = "Resource has Helm's keep policy"
	blockedDeleting        = "Resource is already being deleted"
	blockedNoIdentity      = "Resource lacks a stable UID or resource version"
)

// removalBlock returns why obj must not be deleted on behalf of the given Helm
// release, or "" when its metadata permits removal. It does not judge scope or
// kind; each deletion path adds its own restrictions on top.
func removalBlock(obj runtime.Object, metadata metav1.Object, releaseName, releaseNamespace string) string {
	annotations, labels := metadata.GetAnnotations(), metadata.GetLabels()
	helmStorage := strings.HasPrefix(metadata.GetName(), "sh.helm.release.") || labels["owner"] == "helm"
	if object, ok := obj.(runtime.Unstructured); ok && object.UnstructuredContent()["type"] == "helm.sh/release.v1" {
		helmStorage = true
	}
	switch {
	case len(metadata.GetOwnerReferences()) != 0:
		return blockedOwnerReferences
	case annotations["meta.helm.sh/release-name"] != "" && annotations["meta.helm.sh/release-name"] != releaseName,
		annotations["meta.helm.sh/release-namespace"] != "" && annotations["meta.helm.sh/release-namespace"] != releaseNamespace:
		return blockedOtherRelease
	case labels["app.kubernetes.io/managed-by"] != "" && labels["app.kubernetes.io/managed-by"] != "Helm":
		return blockedForeignManager
	case helmStorage:
		return blockedHelmStorage
	case annotations["helm.sh/resource-policy"] == "keep":
		return blockedKeepPolicy
	case metadata.GetDeletionTimestamp() != nil:
		return blockedDeleting
	case metadata.GetUID() == "" || metadata.GetResourceVersion() == "":
		return blockedNoIdentity
	}
	return ""
}

func (d *Deployer) conflictFor(info *resource.Info, obj runtime.Object) (*ResourceConflict, error) {
	metadata, err := meta.Accessor(obj)
	if err != nil {
		return nil, err
	}
	annotations, labels := metadata.GetAnnotations(), metadata.GetLabels()
	if labels["app.kubernetes.io/managed-by"] == "Helm" &&
		annotations["meta.helm.sh/release-name"] == d.config.ReleaseName &&
		annotations["meta.helm.sh/release-namespace"] == d.config.Namespace {
		return nil, nil
	}
	conflict := &ResourceConflict{ResourceIdentity: ResourceIdentity{
		APIVersion: info.Mapping.GroupVersionKind.GroupVersion().String(),
		Kind:       info.Mapping.GroupVersionKind.Kind, Namespace: metadata.GetNamespace(),
		Name: metadata.GetName(), UID: string(metadata.GetUID()), ResourceVersion: metadata.GetResourceVersion(),
	}}
	switch {
	case info.Mapping.Scope.Name() != meta.RESTScopeNameNamespace:
		conflict.BlockedReason = "Cluster-scoped or shared resources require manual resolution"
	case metadata.GetNamespace() != d.config.Namespace:
		conflict.BlockedReason = "Resource is outside the deployment namespace"
	default:
		conflict.BlockedReason = removalBlock(obj, metadata, d.config.ReleaseName, d.config.Namespace)
		if conflict.BlockedReason != "" {
			break
		}
		// Only known, namespace-local workload/configuration kinds are eligible;
		// RBAC and unfamiliar custom resources may be shared by other workloads.
		switch info.Mapping.GroupVersionKind.GroupVersion().String() + "/" + info.Mapping.GroupVersionKind.Kind {
		case "v1/ConfigMap", "v1/Secret", "v1/ServiceAccount", "v1/Service", "apps/v1/DaemonSet", "apps/v1/Deployment":
		default:
			conflict.BlockedReason = "Shared or unsupported resource kind requires manual resolution"
		}
	}
	return conflict, nil
}

// Helm v3.21's server dry-run performs discovery, rendering and GETs, but
// returns before namespace creation, release storage, hooks or installation.
// TakeOwnership is NEVER set on the real install client.
func (d *Deployer) renderConflictResources(ctx context.Context, config *action.Configuration, client *action.Install, chrt *chart.Chart) (kube.ResourceList, error) {
	inspection := action.NewInstall(config)
	inspection.Namespace, inspection.ReleaseName = client.Namespace, client.ReleaseName
	inspection.DryRun, inspection.DryRunOption = true, "server"
	inspection.TakeOwnership = true
	inspection.DisableOpenAPIValidation = client.DisableOpenAPIValidation
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	rendered, err := inspection.RunWithContext(ctx, chrt, d.config.CustomValues)
	if err != nil {
		return nil, fmt.Errorf("inspect chart ownership conflicts: %w", err)
	}
	return config.KubeClient.Build(bytes.NewBufferString(rendered.Manifest), !client.DisableOpenAPIValidation)
}

func (d *Deployer) inspectConflicts(ctx context.Context, resources kube.ResourceList) ([]ResourceConflict, error) {
	conflicts := []ResourceConflict{}
	seen := map[string]bool{}
	seenUID := map[string]bool{}
	for _, info := range resources {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		obj, err := getConflictObject(ctx, info)
		if apierrors.IsNotFound(err) {
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("inspect %s %s/%s: %w", info.Mapping.GroupVersionKind.Kind, info.Namespace, info.Name, err)
		}
		conflict, err := d.conflictFor(info, obj)
		if err != nil {
			return nil, err
		}
		if conflict != nil {
			key := resourceKey(conflict.ResourceIdentity)
			if seen[key] || conflict.UID != "" && seenUID[conflict.UID] {
				return nil, fmt.Errorf("chart contains duplicate resource %s", key)
			}
			seen[key] = true
			seenUID[conflict.UID] = true
			conflicts = append(conflicts, *conflict)
		}
	}
	return conflicts, nil
}

func (d *Deployer) withCurrentConflicts(ctx context.Context, resources kube.ResourceList, err error) error {
	conflicts, inspectionErr := d.inspectConflicts(ctx, resources)
	if inspectionErr != nil {
		return fmt.Errorf("%w; conflict inspection failed: %v", err, inspectionErr)
	}
	return &OwnershipConflictError{Err: err, Conflicts: conflicts}
}

// ValidateCleanupResources rejects malformed explicit approvals before deployment.
func ValidateCleanupResources(approved []ResourceIdentity) error {
	if len(approved) == 0 {
		return fmt.Errorf("cleanupResources must contain at least one complete object identity")
	}
	seen := make(map[string]bool, len(approved))
	for _, approval := range approved {
		key := resourceKey(approval)
		for _, value := range []string{approval.APIVersion, approval.Kind, approval.Namespace, approval.Name, approval.UID, approval.ResourceVersion} {
			if strings.TrimSpace(value) == "" {
				return fmt.Errorf("cleanupResources approval lacks required object identity")
			}
		}
		if seen[key] {
			return fmt.Errorf("duplicate cleanupResources approval for %s", key)
		}
		seen[key] = true
	}
	return nil
}

// validateApprovals requires approvals to equal the current conflicts exactly.
// Well-formedness is checked once by NewDeployer; the exact match below also
// rejects duplicates (conflicts are unique by key) and incomplete identities.
func validateApprovals(approved []ResourceIdentity, conflicts []ResourceConflict) error {
	if len(approved) == 0 {
		return fmt.Errorf("cleanupResources must contain at least one complete object identity")
	}
	if len(approved) != len(conflicts) {
		return fmt.Errorf("conflicting resources changed or approval is incomplete; inspect and confirm every resource again")
	}
	byKey := make(map[string]ResourceIdentity, len(approved))
	for _, approval := range approved {
		key := resourceKey(approval)
		byKey[key] = approval
	}
	for _, conflict := range conflicts {
		if conflict.BlockedReason != "" {
			return fmt.Errorf("cannot clean up %s: %s", resourceKey(conflict.ResourceIdentity), conflict.BlockedReason)
		}
		if byKey[resourceKey(conflict.ResourceIdentity)] != conflict.ResourceIdentity {
			return fmt.Errorf("cleanup approval does not match current object %s; inspect and confirm again", resourceKey(conflict.ResourceIdentity))
		}
	}
	return nil
}

func (d *Deployer) cleanupConflicts(ctx context.Context, resources kube.ResourceList) error {
	conflicts, err := d.inspectConflicts(ctx, resources)
	if err != nil {
		return err
	}
	if err := validateApprovals(d.config.CleanupResources, conflicts); err != nil {
		return &OwnershipConflictError{Err: err, Conflicts: conflicts}
	}
	approved := make(map[string]ResourceIdentity, len(conflicts))
	for _, conflict := range conflicts {
		approved[resourceKey(conflict.ResourceIdentity)] = conflict.ResourceIdentity
	}
	type deletion struct {
		info    *resource.Info
		options *metav1.DeleteOptions
		// dependents selects the pods (and ReplicaSets) a workload controls.
		dependents labels.Selector
	}
	deletions := []deletion{}
	for _, info := range resources {
		key := resourceKey(ResourceIdentity{APIVersion: info.Mapping.GroupVersionKind.GroupVersion().String(),
			Kind: info.Mapping.GroupVersionKind.Kind, Namespace: info.Namespace, Name: info.Name})
		if identity, ok := approved[key]; ok {
			uid, version := types.UID(identity.UID), identity.ResourceVersion
			// Orphaning would leave privileged IG pods running after their
			// workload is gone; only configuration objects are orphan-deleted.
			propagation := metav1.DeletePropagationOrphan
			var dependents labels.Selector
			if workloadKinds[identity.APIVersion+"/"+identity.Kind] {
				propagation = metav1.DeletePropagationBackground
				var changed bool
				if dependents, changed, err = approvedWorkloadSelector(ctx, info, identity); changed {
					return d.withCurrentConflicts(ctx, resources, err)
				} else if err != nil {
					return err
				}
			}
			deletions = append(deletions, deletion{info, &metav1.DeleteOptions{
				Preconditions:     &metav1.Preconditions{UID: &uid, ResourceVersion: &version},
				PropagationPolicy: &propagation,
			}, dependents})
		}
	}
	if len(deletions) != len(approved) {
		return fmt.Errorf("cleanup approvals no longer match the rendered chart; no resources deleted")
	}
	// Check delete authorization/admission for every object before any mutation.
	for _, deletion := range deletions {
		if err := ctx.Err(); err != nil {
			return err
		}
		options := deletion.options.DeepCopy()
		options.DryRun = []string{metav1.DryRunAll}
		if err := deleteConflictObject(ctx, deletion.info, options); err != nil {
			failure := fmt.Errorf("cleanup preflight failed for %s/%s; no resources deleted: %w", deletion.info.Namespace, deletion.info.Name, err)
			if apierrors.IsConflict(err) {
				return d.withCurrentConflicts(ctx, resources, failure)
			}
			return failure
		}
	}
	// Re-read the entire set after preflight, including previously absent chart objects.
	conflicts, err = d.inspectConflicts(ctx, resources)
	if err != nil {
		return err
	}
	if err := validateApprovals(d.config.CleanupResources, conflicts); err != nil {
		return &OwnershipConflictError{Err: err, Conflicts: conflicts}
	}
	for index, deletion := range deletions {
		if err := ctx.Err(); err != nil {
			return fmt.Errorf("cleanup interrupted after %d deletion requests: %w", index, err)
		}
		info := deletion.info
		if err := deleteConflictObject(ctx, info, deletion.options); err != nil {
			// Kubernetes has no multi-object delete transaction. Do not retry or
			// proceed to installation after any uncertain/partial outcome.
			failure := fmt.Errorf("cleanup stopped at %s/%s after %d deletion requests; inspect cluster before retrying: %w", info.Namespace, info.Name, index, err)
			if apierrors.IsConflict(err) {
				return d.withCurrentConflicts(ctx, resources, failure)
			}
			return failure
		}
	}
	for _, deletion := range deletions {
		info := deletion.info
		recreated := false
		if err := wait.PollUntilContextTimeout(ctx, 200*time.Millisecond, 30*time.Second, true, func(ctx context.Context) (bool, error) {
			obj, err := getConflictObject(ctx, info)
			if apierrors.IsNotFound(err) {
				return true, nil
			}
			if err != nil {
				return false, err
			}
			metadata, err := meta.Accessor(obj)
			if err != nil {
				return false, err
			}
			if metadata.GetUID() != *deletion.options.Preconditions.UID {
				recreated = true
				return false, fmt.Errorf("resource was recreated during cleanup; fresh confirmation required")
			}
			return false, nil
		}); err != nil {
			failure := fmt.Errorf("could not confirm deletion of %s/%s; installation stopped: %w", info.Namespace, info.Name, err)
			if recreated {
				return d.withCurrentConflicts(ctx, resources, failure)
			}
			return failure
		}
	}
	var clientset kubernetes.Interface
	for _, deletion := range deletions {
		if deletion.dependents == nil {
			continue
		}
		if clientset == nil {
			config, err := getKubeConfig(d.config.KubeConfig, d.config.KubeContext)
			if err != nil {
				return fmt.Errorf("failed to get kubeconfig: %w", err)
			}
			if clientset, err = getKubernetesClient(config); err != nil {
				return fmt.Errorf("failed to create Kubernetes client: %w", err)
			}
		}
		info := deletion.info
		d.sendProgress("install_chart", 70, fmt.Sprintf("Waiting for pods of %s %s to terminate", info.Mapping.GroupVersionKind.Kind, info.Name), nil)
		if err := waitForWorkloadDependents(ctx, clientset, info.Namespace, info.Mapping.GroupVersionKind.Kind, deletion.dependents, 2*time.Minute); err != nil {
			return fmt.Errorf("could not confirm removal of pods controlled by %s/%s; installation stopped: %w", info.Namespace, info.Name, err)
		}
	}
	return nil
}

// workloadKinds are deleted with background propagation so that their pods
// are removed too; cleanup then waits for those dependents.
var workloadKinds = map[string]bool{"apps/v1/DaemonSet": true, "apps/v1/Deployment": true}

// approvedWorkloadSelector reads the approved workload's pod selector. changed
// reports that the object no longer matches the approval.
func approvedWorkloadSelector(ctx context.Context, info *resource.Info, identity ResourceIdentity) (labels.Selector, bool, error) {
	obj, err := getConflictObject(ctx, info)
	if err != nil {
		return nil, apierrors.IsNotFound(err), fmt.Errorf("reading %s %s/%s before cleanup: %w", identity.Kind, info.Namespace, info.Name, err)
	}
	metadata, err := meta.Accessor(obj)
	if err != nil {
		return nil, false, err
	}
	if string(metadata.GetUID()) != identity.UID || metadata.GetResourceVersion() != identity.ResourceVersion {
		return nil, true, fmt.Errorf("cleanup approval does not match current object %s; inspect and confirm again", resourceKey(identity))
	}
	object, ok := obj.(runtime.Unstructured)
	if !ok {
		return nil, false, fmt.Errorf("unexpected object type for %s", resourceKey(identity))
	}
	raw, found, err := unstructured.NestedMap(object.UnstructuredContent(), "spec", "selector")
	var selector metav1.LabelSelector
	if err == nil && found {
		err = runtime.DefaultUnstructuredConverter.FromUnstructured(raw, &selector)
	}
	if err != nil {
		return nil, false, fmt.Errorf("reading pod selector of %s: %w", resourceKey(identity), err)
	}
	parsed, err := metav1.LabelSelectorAsSelector(&selector)
	if err != nil || parsed.Empty() {
		// Without a selector, pod removal cannot be confirmed.
		return nil, false, fmt.Errorf("%s has no usable pod selector; resolve manually", resourceKey(identity))
	}
	return parsed, false, nil
}

// waitForWorkloadDependents waits until no pods (and, for Deployments, no
// ReplicaSets) matching the deleted workload's selector remain.
func waitForWorkloadDependents(ctx context.Context, clientset kubernetes.Interface, namespace, kind string, selector labels.Selector, timeout time.Duration) error {
	options := metav1.ListOptions{LabelSelector: selector.String()}
	return wait.PollUntilContextTimeout(ctx, time.Second, timeout, true, func(ctx context.Context) (bool, error) {
		pods, err := clientset.CoreV1().Pods(namespace).List(ctx, options)
		if err != nil {
			return false, fmt.Errorf("listing pods: %w", err)
		}
		if len(pods.Items) != 0 {
			return false, nil
		}
		if kind == "Deployment" {
			replicaSets, err := clientset.AppsV1().ReplicaSets(namespace).List(ctx, options)
			if err != nil {
				return false, fmt.Errorf("listing ReplicaSets: %w", err)
			}
			if len(replicaSets.Items) != 0 {
				return false, nil
			}
		}
		return true, nil
	})
}

func (d *Deployer) runInstall(ctx context.Context, config *action.Configuration, client *action.Install, chrt *chart.Chart) error {
	if d.config.CleanupResources != nil {
		resources, err := d.renderConflictResources(ctx, config, client, chrt)
		if err != nil {
			return err
		}
		if err := d.cleanupConflicts(ctx, resources); err != nil {
			return err
		}
	}
	_, err := client.RunWithContext(ctx, chrt, d.config.CustomValues)
	if !IsOwnershipConflict(err) {
		return err
	}
	resources, inspectionErr := d.renderConflictResources(ctx, config, client, chrt)
	if inspectionErr != nil {
		return fmt.Errorf("%w; conflict inspection failed: %v", err, inspectionErr)
	}
	return d.withCurrentConflicts(ctx, resources, err)
}
