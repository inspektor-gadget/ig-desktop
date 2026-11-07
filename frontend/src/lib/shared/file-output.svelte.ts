import type { FileOutputCapability } from '$lib/types';
import { overrideStack } from '$lib/utils/override-stack';

let capability = $state<FileOutputCapability | undefined>();
const owners = overrideStack<FileOutputCapability | undefined>((current) => {
	capability = current;
});

/** Installs this owner's capability; the returned cleanup removes only this owner's entry. */
export function setFileOutputCapability(value: FileOutputCapability | undefined): () => void {
	return owners.push(value);
}

export function fileOutputNotificationsEnabled(): boolean {
	return capability?.notify !== false;
}
