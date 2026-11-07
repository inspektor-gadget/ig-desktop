/**
 * Host overrides that can be installed by several owners. Each cleanup removes only its own
 * entry, so out-of-order cleanup never reinstalls an override whose owner was disposed.
 */
export function overrideStack<T>(onChange?: (current: T | undefined) => void) {
	const entries: Array<{ value: T }> = [];
	return {
		get current(): T | undefined {
			return entries.at(-1)?.value;
		},
		push(value: T): () => void {
			const entry = { value };
			entries.push(entry);
			onChange?.(value);
			return () => {
				const index = entries.indexOf(entry);
				if (index < 0) return;
				entries.splice(index, 1);
				onChange?.(entries.at(-1)?.value);
			};
		}
	};
}
