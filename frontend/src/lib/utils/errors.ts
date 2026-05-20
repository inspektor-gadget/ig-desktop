/**
 * Extract a human-readable message from an unknown thrown value.
 *
 * `catch` clauses bind their value as `unknown`; this narrows it safely
 * instead of resorting to `any`.
 */
export function getErrorMessage(err: unknown): string {
	if (err instanceof Error) return err.message;
	if (err == null) return 'Unknown error';
	if (typeof err === 'string') return err;
	return String(err);
}
