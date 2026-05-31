// Copyright 2025 The Inspektor Gadget authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * Minimal shape of a datasource needed to resolve its display title.
 * Kept structural so this helper works with both `GadgetDatasource`
 * (frontend type) and the wire-level datasource objects shared with
 * the runtime layer.
 */
export interface DatasourceLike {
	name: string;
	annotations?: Record<string, string>;
}

/**
 * Returns the user-visible label for a datasource. When the
 * datasource carries a non-empty `title` annotation it is returned
 * verbatim; otherwise the datasource's raw `name` is used as the
 * fallback. The `name` remains the canonical identifier for storage
 * keys, lookups, and references throughout the application — only
 * display surfaces should use this helper.
 */
export function datasourceTitle(ds: DatasourceLike | null | undefined): string {
	if (!ds) return '';
	const title = ds.annotations?.title?.trim();
	return title || ds.name;
}
