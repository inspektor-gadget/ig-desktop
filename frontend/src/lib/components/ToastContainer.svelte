<script lang="ts">
	import { toastStore } from '$lib/stores/toast.svelte';
	import Toast from './Toast.svelte';

	interface Props {
		/** Whether the deployment indicator is visible (adjusts positioning) */
		hasDeploymentIndicator?: boolean;
	}

	let { hasDeploymentIndicator = false }: Props = $props();

	// Calculate bottom offset based on deployment indicator visibility
	const bottomClass = $derived(hasDeploymentIndicator ? 'bottom-20' : 'bottom-4');
</script>

<!-- Toast container positioned in lower right corner -->
<div
	class="fixed right-4 {bottomClass} z-60 flex max-w-sm flex-col gap-3 transition-all duration-300"
>
	{#each toastStore.toasts as toast (toast.id)}
		<Toast {toast} onDismiss={toastStore.dismiss.bind(toastStore)} />
	{/each}
</div>
