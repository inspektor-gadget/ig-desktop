import type { Datasource } from './charts';

/** Payload delivered to cell click and context menu callbacks. */
export interface CellInteractionEvent {
	/** Originating result and enriched schema, when emitted by a gadget view. */
	instanceID?: string;
	datasource?: Datasource;
	/** Cell display value */
	value: unknown;
	/** Dot-notation field name, e.g. "k8s.podName" */
	fieldName: string;
	/** Merged annotations (backend + client) for this field */
	fieldAnnotations: Record<string, string>;
	/** Full row data */
	row: Record<string, unknown>;
	/** Mouse position (for context menu anchoring) */
	position: { x: number; y: number };
	/** Original DOM event */
	event: MouseEvent;
}

export type CellClickHandler = (event: CellInteractionEvent) => void;
export type CellContextMenuHandler = (event: CellInteractionEvent) => void;
