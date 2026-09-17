/** Svelte-reactive props for hosts that update a mounted component without remounting it. */
export function createReactiveProps<T extends Record<string, unknown>>(props: T): T {
	const reactive = $state({ ...props });
	return reactive;
}
