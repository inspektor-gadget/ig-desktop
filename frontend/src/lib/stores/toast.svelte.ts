/**
 * Toast notification store using Svelte 5 runes
 * Provides global toast notification management with auto-dismiss functionality
 */

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ToastAction {
	label: string;
	onClick: () => void;
}

export interface Toast {
	id: string;
	type: ToastType;
	message: string;
	duration?: number; // milliseconds, undefined = no auto-dismiss
	action?: ToastAction;
}

class ToastStore {
	private state = $state<{ toasts: Toast[] }>({
		toasts: []
	});

	get toasts(): Toast[] {
		return this.state.toasts;
	}

	/**
	 * Show a new toast notification
	 * @param toast - Toast configuration (without id)
	 * @returns The generated toast ID
	 */
	show(toast: Omit<Toast, 'id'>): string {
		const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
		const newToast: Toast = { id, ...toast };

		// Add to state
		this.state.toasts = [...this.state.toasts, newToast];

		// Auto-dismiss if duration is set
		if (toast.duration) {
			setTimeout(() => this.dismiss(id), toast.duration);
		}

		// Enforce max 5 visible toasts
		if (this.state.toasts.length > 5) {
			this.dismiss(this.state.toasts[0].id);
		}

		return id;
	}

	/**
	 * Dismiss a specific toast by ID
	 * @param id - Toast ID to dismiss
	 */
	dismiss(id: string): void {
		this.state.toasts = this.state.toasts.filter((t) => t.id !== id);
	}

	/**
	 * Dismiss all toasts
	 */
	dismissAll(): void {
		this.state.toasts = [];
	}

	/**
	 * Convenience method for success toasts
	 */
	success(message: string, duration = 5000): string {
		return this.show({ type: 'success', message, duration });
	}

	/**
	 * Convenience method for error toasts
	 */
	error(message: string, duration = 7000, action?: ToastAction): string {
		return this.show({ type: 'error', message, duration, action });
	}

	/**
	 * Convenience method for info toasts
	 */
	info(message: string, duration = 4000): string {
		return this.show({ type: 'info', message, duration });
	}

	/**
	 * Convenience method for warning toasts
	 */
	warning(message: string, duration = 6000): string {
		return this.show({ type: 'warning', message, duration });
	}
}

export const toastStore = new ToastStore();
