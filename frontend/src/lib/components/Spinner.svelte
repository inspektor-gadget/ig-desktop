<script lang="ts">
	let { size = 'md', message }: { size?: 'sm' | 'md' | 'lg'; message?: string } = $props();

	const sizeMap = {
		sm: '24px',
		md: '48px',
		lg: '64px'
	};
</script>

<div class="spinner-container">
	<div class="spinner" style="width: {sizeMap[size]}; height: {sizeMap[size]};"></div>
	{#if message}
		<p class="spinner-message">{message}</p>
	{/if}
</div>

<style>
	.spinner-container {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1rem;
	}

	.spinner {
		border: 4px solid rgba(255, 255, 255, 0.1);
		border-top-color: #3b82f6;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	.spinner-message {
		font-size: 0.875rem;
		color: rgba(156, 163, 175, 1);
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
