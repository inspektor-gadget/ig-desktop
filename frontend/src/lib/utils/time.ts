/**
 * Formats a timestamp as a relative time string (e.g., "2 hours ago")
 * @param timestamp - Unix timestamp in milliseconds
 * @returns Relative time string
 */
export function formatRelativeTime(timestamp: number | undefined): string {
	if (!timestamp) return '';

	const seconds = Math.floor((Date.now() - timestamp) / 1000);

	if (seconds < 60) return 'just now';
	if (seconds < 3600) {
		const minutes = Math.floor(seconds / 60);
		return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
	}
	if (seconds < 86400) {
		const hours = Math.floor(seconds / 3600);
		return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
	}
	const days = Math.floor(seconds / 86400);
	return `${days} day${days !== 1 ? 's' : ''} ago`;
}

/**
 * Formats a timestamp as an absolute date and time string
 * @param timestamp - Unix timestamp in milliseconds
 * @returns Formatted date string (e.g., "Nov 19, 2025 at 14:30:45")
 */
export function formatAbsoluteTime(timestamp: number | undefined): string {
	if (!timestamp) return '';

	const date = new Date(timestamp);
	return date.toLocaleString('en-US', {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit'
	});
}
