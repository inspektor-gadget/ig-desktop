<script lang="ts">
	import EnvironmentLayout from '#lib/components/app/EnvironmentLayout.svelte';
	let { children } = $props();
</script>

<EnvironmentLayout {children} />
