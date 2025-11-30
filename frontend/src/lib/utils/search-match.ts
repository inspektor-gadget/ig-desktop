/**
 * Shared search matching utility for table filtering.
 */

/**
 * Check if an entry matches the search query in any of the specified fields.
 * Performs case-insensitive substring matching.
 *
 * @param entry - Row data object
 * @param query - Lowercase search query
 * @param fieldNames - Array of field names to search in
 * @returns true if any field contains the query
 */
export function entryMatchesSearch(
	entry: Record<string, unknown>,
	query: string,
	fieldNames: string[]
): boolean {
	const len = fieldNames.length;
	for (let i = 0; i < len; i++) {
		const value = entry[fieldNames[i]];
		if (value != null) {
			const str = typeof value === 'string' ? value : String(value);
			if (str.toLowerCase().indexOf(query) !== -1) {
				return true;
			}
		}
	}
	return false;
}
