/**
 * Web Worker for filtering large event datasets.
 * Supports both full refilter and incremental updates for streaming data.
 *
 * Message types:
 * - 'filter': Full refilter (query changed or initial load)
 * - 'filter-incremental': Add new events to existing filtered results
 * - 'reset': Clear worker state
 */

import { entryMatchesSearch } from '$lib/utils/search-match';

export interface FilterRequest {
	type: 'filter';
	id: number;
	events: any[];
	query: string;
	fieldNames: string[];
}

export interface IncrementalFilterRequest {
	type: 'filter-incremental';
	id: number;
	newEvents: any[];
	query: string;
	fieldNames: string[];
}

export interface ResetRequest {
	type: 'reset';
}

export interface FilterResponse {
	type: 'filter-result';
	id: number;
	filteredEvents: any[];
	matchIndices: number[];
}

type WorkerRequest = FilterRequest | IncrementalFilterRequest | ResetRequest;

// Worker state - maintains filtered results between incremental updates
let currentFilteredEvents: any[] = [];
let currentQuery = '';
let currentFieldNames: string[] = [];

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
	const { type } = e.data;

	if (type === 'reset') {
		currentFilteredEvents = [];
		currentQuery = '';
		currentFieldNames = [];
		return;
	}

	if (type === 'filter') {
		const { id, events, query, fieldNames } = e.data as FilterRequest;
		const lowerQuery = query.toLowerCase();

		// Update worker state
		currentQuery = lowerQuery;
		currentFieldNames = fieldNames;

		// Full refilter
		const filteredEvents: any[] = [];
		const matchIndices: number[] = [];

		const len = events.length;
		for (let i = 0; i < len; i++) {
			if (entryMatchesSearch(events[i], lowerQuery, fieldNames)) {
				matchIndices.push(filteredEvents.length);
				filteredEvents.push(events[i]);
			}
		}

		currentFilteredEvents = filteredEvents;

		const response: FilterResponse = {
			type: 'filter-result',
			id,
			filteredEvents,
			matchIndices
		};
		self.postMessage(response);
		return;
	}

	if (type === 'filter-incremental') {
		const { id, newEvents, query, fieldNames } = e.data as IncrementalFilterRequest;
		const lowerQuery = query.toLowerCase();

		// If query or fields changed, we need a full refilter (shouldn't happen in normal flow)
		if (lowerQuery !== currentQuery || fieldNames.join(',') !== currentFieldNames.join(',')) {
			// Can't do incremental - signal caller needs full refilter
			// Just filter the new events for now
			currentQuery = lowerQuery;
			currentFieldNames = fieldNames;
			currentFilteredEvents = [];
		}

		// Filter only the new events and prepend to existing results
		// (new events are prepended to the array, so they should appear first)
		const newMatches: any[] = [];
		const len = newEvents.length;
		for (let i = 0; i < len; i++) {
			if (entryMatchesSearch(newEvents[i], lowerQuery, fieldNames)) {
				newMatches.push(newEvents[i]);
			}
		}

		// Prepend new matches to existing filtered events
		currentFilteredEvents = [...newMatches, ...currentFilteredEvents];

		// Recompute match indices (simple sequential indices since all are matches)
		const matchIndices: number[] = [];
		for (let i = 0; i < currentFilteredEvents.length; i++) {
			matchIndices.push(i);
		}

		const response: FilterResponse = {
			type: 'filter-result',
			id,
			filteredEvents: currentFilteredEvents,
			matchIndices
		};
		self.postMessage(response);
	}
};
