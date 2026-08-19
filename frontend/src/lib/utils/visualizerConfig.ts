export function isVisualizerExcluded(
	annotations: Record<string, string> | undefined,
	visualizerId: string
): boolean {
	return (annotations?.['visualizers.exclude'] ?? '')
		.split(',')
		.some((id) => id.trim() === visualizerId);
}
