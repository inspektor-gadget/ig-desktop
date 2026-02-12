import { useEffect, useRef, type ComponentType } from 'react';
import { createClassComponent } from 'svelte/legacy';

interface SvelteWrapperProps {
	/** The Svelte component class to mount */
	component: ComponentType<any>;
	/** Props to pass to the Svelte component (spread as individual props) */
	[key: string]: any;
}

/**
 * Generic React wrapper that mounts a compiled Svelte 5 component
 * into a React DOM node using createClassComponent from svelte/legacy.
 *
 * Usage:
 * ```tsx
 * import Gadget from '@inspektor-gadget/frontend/components/Gadget.svelte';
 * <SvelteWrapper component={Gadget} instanceID="my-instance" />
 * ```
 */
export function SvelteWrapper({ component: SvelteComp, ...props }: SvelteWrapperProps) {
	const targetRef = useRef<HTMLDivElement>(null);
	const instanceRef = useRef<any>(null);

	// Mount/unmount on component change
	useEffect(() => {
		if (!targetRef.current) return;

		const Compat = createClassComponent({ component: SvelteComp as any });
		instanceRef.current = new Compat({
			target: targetRef.current,
			props
		});

		return () => {
			instanceRef.current?.$destroy();
			instanceRef.current = null;
		};
		// Only re-mount when the Svelte component class itself changes
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [SvelteComp]);

	// Update props on the mounted instance when they change
	useEffect(() => {
		instanceRef.current?.$set(props);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [JSON.stringify(props)]);

	return <div ref={targetRef} />;
}
