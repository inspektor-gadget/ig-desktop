import { useEffect, useRef, type ComponentType } from 'react';
import { mount, unmount } from 'svelte';

interface SvelteWrapperProps {
	/** The Svelte component class to mount */
	component: ComponentType<any>;
	/** Props to pass to the Svelte component (spread as individual props) */
	[key: string]: any;
}

/**
 * Generic React wrapper that mounts a compiled Svelte 5 component
 * into a React DOM node using Svelte 5's mount() API.
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

		instanceRef.current = mount(SvelteComp as any, {
			target: targetRef.current,
			props
		});

		return () => {
			if (instanceRef.current) {
				unmount(instanceRef.current);
				instanceRef.current = null;
			}
		};
		// Only re-mount when the Svelte component class itself changes
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [SvelteComp]);

	return (
		<div
			ref={targetRef}
			style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}
		/>
	);
}
