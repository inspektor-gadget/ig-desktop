/**
 * Global confirmation modal store
 * Provides a promise-based API for showing confirmation dialogs
 */

type ConfirmationOptions = {
	message: string;
	confirmLabel?: string;
	cancelLabel?: string;
	title?: string;
};

type ConfirmationState = {
	isOpen: boolean;
	message: string;
	confirmLabel: string;
	cancelLabel: string;
	title: string;
	resolve: ((confirmed: boolean) => void) | null;
};

class ConfirmationModalStore {
	private state = $state<ConfirmationState>({
		isOpen: false,
		message: '',
		confirmLabel: 'OK',
		cancelLabel: 'Cancel',
		title: 'Confirm',
		resolve: null
	});

	get isOpen() {
		return this.state.isOpen;
	}

	get message() {
		return this.state.message;
	}

	get confirmLabel() {
		return this.state.confirmLabel;
	}

	get cancelLabel() {
		return this.state.cancelLabel;
	}

	get title() {
		return this.state.title;
	}

	/**
	 * Show a confirmation dialog and return a promise that resolves to true if confirmed, false if canceled
	 */
	confirm(options: ConfirmationOptions): Promise<boolean> {
		return new Promise((resolve) => {
			this.state = {
				isOpen: true,
				message: options.message,
				confirmLabel: options.confirmLabel || 'OK',
				cancelLabel: options.cancelLabel || 'Cancel',
				title: options.title || 'Confirm',
				resolve
			};
		});
	}

	/**
	 * Handle confirmation - resolves the promise with true
	 */
	handleConfirm() {
		const resolve = this.state.resolve;
		this.close();
		if (resolve) {
			resolve(true);
		}
	}

	/**
	 * Handle cancellation - resolves the promise with false
	 */
	handleCancel() {
		const resolve = this.state.resolve;
		this.close();
		if (resolve) {
			resolve(false);
		}
	}

	/**
	 * Close the modal without resolving (same as cancel)
	 */
	private close() {
		this.state.isOpen = false;
		this.state.message = '';
		this.state.resolve = null;
	}
}

export const confirmationModal = new ConfirmationModalStore();
