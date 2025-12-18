/**
 * Gadget Wizard type definitions
 * Defines the structure of the decision tree and wizard state
 */

export interface WizardTreeConfig {
	title: string;
	question: string;
	gadgetPrefix: string;
	nodes: Record<string, WizardNode>;
}

export type WizardNode = WizardBranchNode | WizardEndpointNode;

export interface WizardBranchNode {
	type: 'branch';
	label?: string;
	icon?: string;
	description?: string;
	detached?: boolean;
	children: string[];
}

/**
 * Specification for a single gadget in an endpoint
 */
export interface WizardGadgetSpec {
	/** Gadget image name (without prefix) */
	gadget: string;
	/** Gadget-specific parameters */
	params?: Record<string, string>;
	/** Suggested instance name for detached mode */
	suggestedInstanceName?: string;
}

/**
 * Endpoint node - the final step that runs gadget(s)
 * Supports either a single gadget or multiple gadgets
 */
export interface WizardEndpointNode {
	type: 'endpoint';
	label: string;
	description?: string;
	/**
	 * Single gadget (simple case) - shorthand for gadgets array with one item
	 * Use this OR gadgets, not both
	 */
	gadget?: string;
	/**
	 * Parameters for single gadget mode
	 */
	params?: Record<string, string>;
	/**
	 * Suggested instance name for single gadget in detached mode
	 */
	suggestedInstanceName?: string;
	/**
	 * Multiple gadgets to run together (e.g., telemetry templates)
	 * When present, gadget/params/suggestedInstanceName are ignored
	 */
	gadgets?: WizardGadgetSpec[];
}

export interface WizardTargetParams {
	// K8s mode
	namespace?: string;
	pod?: string;
	labels?: string;
	// Local mode
	containername?: string;
	host?: boolean;
}

export interface WizardNavigationState {
	path: string[];
	currentNodeId: string;
	inheritedDetached: boolean;
}

/**
 * Check if a node is a branch node
 */
export function isBranchNode(node: WizardNode): node is WizardBranchNode {
	return node.type === 'branch';
}

/**
 * Check if a node is an endpoint node
 */
export function isEndpointNode(node: WizardNode): node is WizardEndpointNode {
	return node.type === 'endpoint';
}

/**
 * Get the label for a node (branches may have optional labels)
 */
export function getNodeLabel(node: WizardNode): string {
	if (isEndpointNode(node)) {
		return node.label;
	}
	return node.label || 'Select an option';
}

/**
 * Get normalized gadget specs from an endpoint node
 * Converts single gadget format to array format for consistent handling
 */
export function getGadgetSpecs(node: WizardEndpointNode): WizardGadgetSpec[] {
	// If gadgets array is present, use it
	if (node.gadgets && node.gadgets.length > 0) {
		return node.gadgets;
	}
	// Otherwise, convert single gadget to array format
	if (node.gadget) {
		return [
			{
				gadget: node.gadget,
				params: node.params,
				suggestedInstanceName: node.suggestedInstanceName
			}
		];
	}
	return [];
}

/**
 * Extract short gadget name from full image path
 * e.g., "trace_dns:latest" -> "trace_dns"
 */
export function getGadgetShortName(gadget: string): string {
	// Remove version tag if present
	const withoutTag = gadget.split(':')[0];
	// Get last part after any slashes (shouldn't have any, but just in case)
	const parts = withoutTag.split('/');
	return parts[parts.length - 1];
}

/**
 * Get all gadget short names from an endpoint node
 */
export function getEndpointGadgetNames(node: WizardEndpointNode): string[] {
	return getGadgetSpecs(node).map((spec) => getGadgetShortName(spec.gadget));
}
