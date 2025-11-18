let lastId = 0;

/**
 * Generates a unique ID with an optional prefix.
 * @param prefix - Optional prefix for the ID
 * @returns A unique ID in the format "prefix-number"
 */
export const getUniqueId = (prefix: string = ''): string => {
	lastId++;
	return [prefix, lastId].join('-');
};
