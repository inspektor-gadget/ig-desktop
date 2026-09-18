import type { FileOutputCapability } from '$lib/types';

let capability = $state<FileOutputCapability | undefined>();

export function setFileOutputCapability(value: FileOutputCapability | undefined): void {
	capability = value;
}

export function fileOutputNotificationsEnabled(): boolean {
	return capability?.notify !== false;
}
