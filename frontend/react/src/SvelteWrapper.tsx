import { useEffect, useRef } from 'react';
import { mount, unmount, type Component } from 'svelte';
import { createReactiveProps } from '@inspektor-gadget/frontend';

interface SvelteWrapperProps {
	/** The Svelte component class to mount */
	component: Component<any>;
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
	const propsRef = useRef<Record<string, unknown> | null>(null);
	const previousPropsRef = useRef<Record<string, unknown> | null>(null);

	// Mount/unmount on component change
	useEffect(() => {
		if (!targetRef.current) return;

		propsRef.current = createReactiveProps(props);
		previousPropsRef.current = props;
		instanceRef.current = mount(SvelteComp as any, {
			target: targetRef.current,
			props: propsRef.current
		});

		return () => {
			if (instanceRef.current) {
				unmount(instanceRef.current);
				instanceRef.current = null;
				propsRef.current = null;
				previousPropsRef.current = null;
			}
		};
		// Only re-mount when the Svelte component class itself changes
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [SvelteComp]);

	useEffect(() => {
		const current = propsRef.current;
		if (!current) return;
		for (const key of Object.keys(current)) {
			if (!(key in props)) delete current[key];
		}
		// Compare host values, not Svelte's nested proxies, to avoid replaying unchanged commands.
		for (const key of Object.keys(props)) {
			if (!Object.is(previousPropsRef.current?.[key], props[key])) current[key] = props[key];
		}
		previousPropsRef.current = props;
	});

	return (
		<div
			ref={targetRef}
			style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}
		/>
	);
}
