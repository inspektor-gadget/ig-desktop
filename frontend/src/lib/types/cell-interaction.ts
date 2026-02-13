/** Payload delivered to cell click and context menu callbacks. */
export interface CellInteractionEvent {
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
