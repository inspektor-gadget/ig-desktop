<script lang="js">
	import { environments } from '$lib/shared/environments.svelte.js';
</script>

<div class="flex-1 flex flex-col gap-8 text-gray-100 bg-gray-950 items-center justify-center align-middle">
	<div>
		<div class="text-4xl font-serif -rotate-6 -translate-x-8 -translate-y-2">Welcome!</div>
		<div class="text-lg">The Inspektor awaits you.</div>
	</div>
	{#if !Object.keys(environments).length}
		<div class="flex flex-col gap-4 text-center w-1/3 text-gray-400">
			<div>
				Let's start by <a class="underline" href="/environment/create">creating a new environment</a> (the button on
				the upper left let's you create one).
			</div>
			<div>
				If you haven't yet installed Inspektor Gadget on either your host or cluster, please take a look at the
				<a class="underline" target="_blank" href="https://inspektor-gadget.io/docs/latest/quick-start">Quickstart Guide</a>
				to find out how that's done. In order to use  this tool, you can either choose to deploy Inspektor Gadget to
				your <a class="underline" target="_blank" href="https://inspektor-gadget.io/docs/latest/quick-start#kubernetes">Kubernetes cluster</a> or run it as a
				<a target="_blank" class="underline" href="https://inspektor-gadget.io/docs/latest/quick-start#kubernetes">daemon
				on your Linux machine</a>.
			</div>
		</div>
	{/if}
</div>
