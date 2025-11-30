/**
 * A fixed-capacity ring buffer optimized for "last N items" scenarios.
 *
 * Performance characteristics:
 * - O(1) push (append)
 * - O(1) get by index
 * - O(1) automatic trimming (old items overwritten)
 * - Fixed memory footprint (no GC pressure from resizing)
 *
 * Index 0 always returns the newest item (most recently pushed).
 * This matches the typical display order for event streams (newest first).
 */
export class EventRingBuffer<T> {
	private buffer: (T | undefined)[];
	private head = 0; // Next write position
	private _length = 0; // Current number of items
	private _version = 0; // Incremented on each push for change detection
	readonly capacity: number;

	constructor(capacity: number) {
		if (capacity <= 0) throw new Error('Capacity must be positive');
		this.capacity = capacity;
		this.buffer = new Array(capacity);
	}

	/**
	 * Add an item to the buffer. O(1) operation.
	 * If buffer is full, oldest item is overwritten.
	 */
	push(item: T): void {
		this.buffer[this.head] = item;
		this.head = (this.head + 1) % this.capacity;
		if (this._length < this.capacity) this._length++;
		this._version++;
	}

	/**
	 * Add multiple items to the buffer. O(k) where k is items.length.
	 */
	pushMany(items: T[]): void {
		for (let i = 0; i < items.length; i++) {
			this.push(items[i]);
		}
	}

	/**
	 * Get item by logical index (0 = newest). O(1) operation.
	 * Returns undefined if index is out of bounds.
	 */
	get(index: number): T | undefined {
		if (index < 0 || index >= this._length) return undefined;
		// Map logical index (0=newest) to physical index
		const physicalIndex = (this.head - 1 - index + this.capacity) % this.capacity;
		return this.buffer[physicalIndex];
	}

	/** Current number of items in the buffer */
	get length(): number {
		return this._length;
	}

	/** Version number, incremented on each push. Useful for change detection. */
	get version(): number {
		return this._version;
	}

	/**
	 * Get a slice of items as an array. O(end - start) operation.
	 * Index 0 = newest item.
	 */
	slice(start: number, end: number): T[] {
		const actualEnd = Math.min(end, this._length);
		const actualStart = Math.max(0, start);
		if (actualStart >= actualEnd) return [];

		const result: T[] = new Array(actualEnd - actualStart);
		for (let i = actualStart; i < actualEnd; i++) {
			result[i - actualStart] = this.get(i)!;
		}
		return result;
	}

	/**
	 * Convert entire buffer to array (newest first). O(n) operation.
	 * Use sparingly - prefer slice() for partial access.
	 */
	toArray(): T[] {
		return this.slice(0, this._length);
	}

	/**
	 * Iterate over items (newest first).
	 */
	*[Symbol.iterator](): Iterator<T> {
		for (let i = 0; i < this._length; i++) {
			yield this.get(i)!;
		}
	}

	/**
	 * Clear all items from the buffer.
	 */
	clear(): void {
		this.buffer = new Array(this.capacity);
		this.head = 0;
		this._length = 0;
		this._version++;
	}

	/**
	 * Check if buffer is empty.
	 */
	isEmpty(): boolean {
		return this._length === 0;
	}

	/**
	 * Check if buffer is at capacity.
	 */
	isFull(): boolean {
		return this._length === this.capacity;
	}

	/**
	 * Get the newest item (index 0).
	 */
	newest(): T | undefined {
		return this.get(0);
	}

	/**
	 * Get the oldest item (last index).
	 */
	oldest(): T | undefined {
		return this.get(this._length - 1);
	}
}
