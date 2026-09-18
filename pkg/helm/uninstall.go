// Copyright 2026 The Inspektor Gadget authors
// SPDX-License-Identifier: Apache-2.0

package helm

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/release"
	"helm.sh/helm/v3/pkg/storage/driver"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/apimachinery/pkg/util/wait"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/rest"
)

var gadgetSelectors = []string{"k8s-app=gadget", "app.kubernetes.io/name=gadget"}

func (d *Deployer) uninstall(ctx context.Context) error {
	actionConfig, err := d.newActionConfig()
	if err != nil {
		return err
	}
	config, err := actionConfig.RESTClientGetter.ToRESTConfig()
	if err != nil {
		return err
	}
	client, err := dynamic.NewForConfig(config)
	if err != nil {
		return err
	}

	// Workload ownership is authoritative; the form's release name is only a
	// fallback for partially removed installations with no workloads left.
	name, namespace := "", ""
	for _, resource := range []string{"daemonsets", "deployments"} {
		items, err := listGadgetResources(ctx, client.Resource(schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: resource}).Namespace(d.config.Namespace))
		if err != nil {
			return fmt.Errorf("discovering IG %s: %w", resource, err)
		}
		for _, item := range items {
			annotations := item.GetAnnotations()
			owner, ownerNamespace := annotations["meta.helm.sh/release-name"], annotations["meta.helm.sh/release-namespace"]
			if owner == "" && ownerNamespace == "" {
				continue
			}
			if owner == "" || ownerNamespace == "" {
				return fmt.Errorf("incomplete Helm ownership on %s %s; refusing ambiguous removal", resource, item.GetName())
			}
			if name != "" && (name != owner || namespace != ownerNamespace) {
				return fmt.Errorf("multiple Helm releases own IG workloads in namespace %s; remove each release explicitly", d.config.Namespace)
			}
			name, namespace = owner, ownerNamespace
		}
	}
	if name == "" {
		name, namespace = d.config.ReleaseName, d.config.Namespace
	}
	if namespace != d.config.Namespace {
		return fmt.Errorf("IG belongs to Helm release %s in namespace %s; select that namespace to remove it", name, namespace)
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	existing, err := action.NewGet(actionConfig).Run(name)
	if err != nil && !errors.Is(err, driver.ErrReleaseNotFound) {
		return fmt.Errorf("looking up Helm release %s: %w", name, err)
	}
	if err == nil && existing.Info.Status != release.StatusUninstalled {
		if existing.Chart == nil || existing.Chart.Metadata == nil || existing.Chart.Metadata.Name != "gadget" {
			return fmt.Errorf("Helm release %s is not the IG chart; refusing to uninstall potentially unrelated resources", name)
		}
		d.sendProgress("uninstall", 25, fmt.Sprintf("Uninstalling Helm release %s in namespace %s", name, namespace), nil)
		uninstall := action.NewUninstall(actionConfig)
		uninstall.Wait = true
		uninstall.Timeout = 5 * time.Minute
		if deadline, ok := ctx.Deadline(); ok {
			uninstall.Timeout = min(uninstall.Timeout, time.Until(deadline))
		}
		if _, err := uninstall.Run(name); err != nil {
			return fmt.Errorf("uninstalling Helm release %s: %w", name, err)
		}
		return nil
	}

	d.sendProgress("uninstall", 25, "No Helm release found; removing identified IG Kubernetes resources. GitOps controllers may recreate them unless reconciliation is suspended.", nil)
	return d.removeKubernetesResources(ctx, config, client, name)
}

func listGadgetResources(ctx context.Context, client dynamic.ResourceInterface) ([]unstructured.Unstructured, error) {
	var items []unstructured.Unstructured
	seen := make(map[string]bool)
	for _, selector := range gadgetSelectors {
		list, err := client.List(ctx, metav1.ListOptions{LabelSelector: selector})
		if err != nil {
			return nil, err
		}
		for _, item := range list.Items {
			if !seen[item.GetName()] {
				items = append(items, item)
				seen[item.GetName()] = true
			}
		}
	}
	return items, nil
}

type removalResource struct {
	client dynamic.ResourceInterface
	object unstructured.Unstructured
}

func (d *Deployer) removeKubernetesResources(ctx context.Context, config *rest.Config, client dynamic.Interface, releaseName string) error {
	discover, err := discovery.NewDiscoveryClientForConfig(config)
	if err != nil {
		return err
	}
	resourceLists, err := discover.ServerPreferredResources()
	if err != nil {
		// Fail closed even for partial results: an unavailable (typically
		// aggregated) API can serve namespaced objects carrying IG labels, and
		// skipping it would report removal while IG resources remain.
		var failed *discovery.ErrGroupDiscoveryFailed
		if errors.As(err, &failed) {
			groups := make([]string, 0, len(failed.Groups))
			for gv, groupErr := range failed.Groups {
				groups = append(groups, fmt.Sprintf("%s (%v)", gv, groupErr))
			}
			slices.Sort(groups)
			return fmt.Errorf("discovering Kubernetes resources before removal failed for API groups %s; nothing was removed because they may contain IG resources. Restore or remove the unavailable APIService and retry",
				strings.Join(groups, ", "))
		}
		return fmt.Errorf("discovering Kubernetes resources before removal: %w", err)
	}
	var resources []removalResource
	for _, list := range resourceLists {
		gv, err := schema.ParseGroupVersion(list.GroupVersion)
		if err != nil {
			return err
		}
		for _, resource := range list.APIResources {
			// Cluster-wide labels alone do not establish namespace ownership.
			// Cluster RBAC is resolved separately through binding subjects.
			imagePolicy := gv.Group == "policy.sigstore.dev" && resource.Name == "clusterimagepolicies"
			if (!resource.Namespaced && !imagePolicy) || strings.Contains(resource.Name, "/") ||
				!slices.Contains(resource.Verbs, "list") || !slices.Contains(resource.Verbs, "delete") ||
				!slices.Contains(resource.Verbs, "get") {
				continue
			}
			var target dynamic.ResourceInterface = client.Resource(gv.WithResource(resource.Name))
			if resource.Namespaced {
				target = client.Resource(gv.WithResource(resource.Name)).Namespace(d.config.Namespace)
			}
			items, err := listGadgetResources(ctx, target)
			if err != nil {
				return fmt.Errorf("listing %s before removal: %w", resource.Name, err)
			}
			for _, item := range items {
				if imagePolicy && item.GetName() != d.config.Namespace+"-image-policy" {
					continue
				}
				resources = append(resources, removalResource{target, item})
			}
		}
	}
	rbac, err := d.clusterRBACForRemoval(ctx, client)
	if err != nil {
		return err
	}
	resources = append(resources, rbac...)
	resources, err = d.eligibleForRemoval(resources, releaseName)
	if err != nil {
		return err
	}
	// Keep bindings until their roles have been removed so a retry can still
	// establish namespace ownership after a partial failure.
	slices.SortStableFunc(resources, func(a, b removalResource) int {
		priority := func(kind string) int {
			if kind == "ClusterRole" {
				return -1
			}
			if kind == "ClusterRoleBinding" || kind == "RoleBinding" {
				return 1
			}
			return 0
		}
		return priority(a.object.GetKind()) - priority(b.object.GetKind())
	})
	if len(resources) == 0 {
		d.sendProgress("uninstall", 40, "No identified IG resources remain in the selected namespace", nil)
	}

	// Discovery and eligibility are complete before the first delete; a
	// permission error is not evidence that resources are absent. UID
	// preconditions protect replacements.
	for _, resource := range resources {
		if resource.object.GetDeletionTimestamp() != nil {
			continue // already terminating; only wait for it
		}
		uid := resource.object.GetUID()
		propagation := metav1.DeletePropagationForeground
		d.sendProgress("uninstall", 40, fmt.Sprintf("Removing %s %s", resource.object.GetKind(), resource.object.GetName()), nil)
		err := resource.client.Delete(ctx, resource.object.GetName(), metav1.DeleteOptions{
			Preconditions: &metav1.Preconditions{UID: &uid}, PropagationPolicy: &propagation,
		})
		if err != nil && !apierrors.IsNotFound(err) {
			return fmt.Errorf("removing %s %s: %w", resource.object.GetKind(), resource.object.GetName(), err)
		}
	}
	return wait.PollUntilContextTimeout(ctx, time.Second, 2*time.Minute, true, func(ctx context.Context) (bool, error) {
		for _, resource := range resources {
			_, err := resource.client.Get(ctx, resource.object.GetName(), metav1.GetOptions{})
			if apierrors.IsNotFound(err) {
				continue
			}
			if err != nil {
				return false, fmt.Errorf("verifying removal of %s %s: %w", resource.object.GetKind(), resource.object.GetName(), err)
			}
			return false, nil
		}
		return true, nil
	})
}

// eligibleForRemoval applies the same removalBlock policy as exact approval to
// the label sweep. Objects owned by another object of the sweep are left to
// the garbage collector, Helm storage and keep-policy objects are preserved,
// and any other blocked object aborts the removal before the first delete.
func (d *Deployer) eligibleForRemoval(resources []removalResource, releaseName string) ([]removalResource, error) {
	swept := make(map[types.UID]bool, len(resources))
	for _, resource := range resources {
		swept[resource.object.GetUID()] = true
	}
	var eligible []removalResource
	var blocked []string
	for _, resource := range resources {
		object := &resource.object
		reason := removalBlock(object, object, releaseName, d.config.Namespace)
		switch reason {
		case "", blockedDeleting:
			eligible = append(eligible, resource)
			continue
		case blockedHelmStorage:
			// Helm storage must only be modified by Helm itself.
			continue
		case blockedKeepPolicy:
			d.sendProgress("uninstall", 30, fmt.Sprintf("Preserving %s %s: it has Helm's keep policy", object.GetKind(), object.GetName()), nil)
			continue
		case blockedOwnerReferences:
			owned := true
			for _, owner := range object.GetOwnerReferences() {
				owned = owned && owner.UID != "" && swept[owner.UID]
			}
			if owned {
				continue // removed with its owner (foreground propagation)
			}
		}
		blocked = append(blocked, fmt.Sprintf("%s %s (%s)", object.GetKind(), object.GetName(), reason))
	}
	if len(blocked) != 0 {
		return nil, fmt.Errorf("refusing to remove IG resources in namespace %s that IG does not own; no resources deleted. Resolve manually: %s",
			d.config.Namespace, strings.Join(blocked, "; "))
	}
	return eligible, nil
}

func (d *Deployer) clusterRBACForRemoval(ctx context.Context, client dynamic.Interface) ([]removalResource, error) {
	gv := schema.GroupVersion{Group: "rbac.authorization.k8s.io", Version: "v1"}
	bindingsClient := client.Resource(gv.WithResource("clusterrolebindings"))
	bindings, err := bindingsClient.List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("listing ClusterRoleBindings: %w", err)
	}
	roleBindings, err := client.Resource(gv.WithResource("rolebindings")).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("listing RoleBindings for shared ClusterRoles: %w", err)
	}
	var resources []removalResource
	localRoles, sharedRoles := make(map[string]bool), make(map[string]bool)
	for _, binding := range append(bindings.Items, roleBindings.Items...) {
		roleKind, _, _ := unstructured.NestedString(binding.Object, "roleRef", "kind")
		role, _, _ := unstructured.NestedString(binding.Object, "roleRef", "name")
		if roleKind != "ClusterRole" {
			continue
		}
		subjects, _, _ := unstructured.NestedSlice(binding.Object, "subjects")
		local, other := false, false
		for _, raw := range subjects {
			subject, ok := raw.(map[string]any)
			if !ok {
				return nil, fmt.Errorf("invalid subject on binding %s", binding.GetName())
			}
			if subject["kind"] == "ServiceAccount" && subject["namespace"] == d.config.Namespace {
				local = true
			} else {
				other = true
			}
		}
		isGadget := binding.GetLabels()["k8s-app"] == "gadget" || binding.GetLabels()["app.kubernetes.io/name"] == "gadget"
		if isGadget && local && !other && (binding.GetNamespace() == "" || binding.GetNamespace() == d.config.Namespace) {
			localRoles[role] = true
			if binding.GetKind() == "ClusterRoleBinding" {
				resources = append(resources, removalResource{bindingsClient, binding})
			}
		} else {
			sharedRoles[role] = true
			if isGadget && local && other && binding.GetNamespace() == "" {
				return nil, fmt.Errorf("IG ClusterRoleBinding %s also grants access outside namespace %s; refusing shared-resource deletion", binding.GetName(), d.config.Namespace)
			}
		}
	}
	rolesClient := client.Resource(gv.WithResource("clusterroles"))
	for role := range localRoles {
		if sharedRoles[role] {
			d.sendProgress("uninstall", 30, fmt.Sprintf("Preserving shared ClusterRole %s", role), nil)
			continue
		}
		object, err := rolesClient.Get(ctx, role, metav1.GetOptions{})
		if apierrors.IsNotFound(err) {
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("reading ClusterRole %s: %w", role, err)
		}
		if object.GetLabels()["k8s-app"] == "gadget" || object.GetLabels()["app.kubernetes.io/name"] == "gadget" {
			resources = append(resources, removalResource{rolesClient, *object})
		}
	}
	return resources, nil
}
