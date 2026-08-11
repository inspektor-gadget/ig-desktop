export function shouldReverseByPort(
	srcPort: number | undefined,
	dstPort: number | undefined,
	threshold: number
): boolean {
	return (
		threshold > 0 &&
		srcPort !== undefined &&
		dstPort !== undefined &&
		srcPort < threshold &&
		dstPort >= threshold
	);
}

export function mergeHandleType(
	current: 'source' | 'target' | 'both',
	next: 'source' | 'target'
): 'source' | 'target' | 'both' {
	return current === next || current === 'both' ? current : 'both';
}
