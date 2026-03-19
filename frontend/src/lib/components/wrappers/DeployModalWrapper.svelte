<script lang="ts">
	import { setContext } from 'svelte';
	import { apiService, type RequestCommand } from '$lib/services/api.service.svelte';
	import K8sDeployModal from '../K8sDeployModal.svelte';

	interface Props {
		open: boolean;
		onClose: () => void;
		clusterName?: string;
		deploymentId?: string;
		redeploy?: boolean;
		undeploy?: boolean;
	}

	let {
		open = $bindable(false),
		onClose,
		clusterName = '',
		deploymentId,
		redeploy = false,
		undeploy = false
	}: Props = $props();

	setContext('api', {
		request: (cmd: RequestCommand) => apiService.request(cmd)
	});
</script>

<K8sDeployModal {open} {onClose} kubeContext={clusterName} {deploymentId} {redeploy} {undeploy} />
