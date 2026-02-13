import type { GadgetDatasource, GadgetDatasourceField } from '../types';

/** Injects extra annotations onto individual datasource fields. */
export type FieldAnnotationProvider = (
	field: GadgetDatasourceField,
	datasource: GadgetDatasource
) => Record<string, string>;

/** Injects extra annotations onto datasources themselves. */
export type DatasourceAnnotationProvider = (
	datasource: GadgetDatasource
) => Record<string, string>;

export interface AnnotationProviders {
	field?: FieldAnnotationProvider;
	datasource?: DatasourceAnnotationProvider;
}

// Internal registry of active providers
const providers: AnnotationProviders[] = [];

/**
 * Register annotation providers that inject extra annotations into
 * datasource fields and/or datasources.
 *
 * @returns An unregister function for cleanup.
 */
export function registerAnnotationProvider(p: AnnotationProviders): () => void {
	providers.push(p);
	return () => {
		const idx = providers.indexOf(p);
		if (idx !== -1) providers.splice(idx, 1);
	};
}

/** Apply all registered field-level providers, merging results onto existing annotations. */
export function applyFieldAnnotationProviders(
	field: GadgetDatasourceField,
	datasource: GadgetDatasource
): Record<string, string> {
	let merged = { ...(field.annotations ?? {}) };
	for (const p of providers) {
		if (p.field) {
			const extra = p.field(field, datasource);
			if (extra && Object.keys(extra).length > 0) {
				merged = { ...merged, ...extra };
			}
		}
	}
	return merged;
}

/** Apply all registered datasource-level providers, merging results onto existing annotations. */
export function applyDatasourceAnnotationProviders(
	datasource: GadgetDatasource
): Record<string, string> {
	let merged = { ...(datasource.annotations ?? {}) };
	for (const p of providers) {
		if (p.datasource) {
			const extra = p.datasource(datasource);
			if (extra && Object.keys(extra).length > 0) {
				merged = { ...merged, ...extra };
			}
		}
	}
	return merged;
}
