<script lang="js">
	let { param, config } = $props();

	import Title from './title.svelte';
</script>

<div class="flex flex-row gap-4">
	<div class="grid items-center justify-center">
		<input type="checkbox" class="peer col-start-1 row-start-1 h-4 w-4 appearance-none rounded border border-gray-300 ring-transparent checked:border-violet-600 checked:bg-violet-600 dark:border-gray-600 dark:checked:border-violet-600 forced-colors:appearance-auto"
							bind:checked={() => { return config.get(param) === 'true' }, (v) => { config.set(param, ''+v)	}} />
		<svg viewBox="0 0 14 14" fill="none"
				 class="pointer-events-none invisible col-start-1 row-start-1 stroke-white peer-checked:visible dark:text-violet-300 forced-colors:hidden"><path d="M3 8L6 11L11 3.5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>
	</div>
	<div
		onclick={() => { config.set(param, config.get(param) === 'true' ? 'false' : 'true'); console.log('chg'); }}><Title
		{param}
	/></div>
</div>
