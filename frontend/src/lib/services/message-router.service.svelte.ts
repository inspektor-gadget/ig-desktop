import { handleRequestResponse } from '$lib/handlers/request.handler';
import {
	handleGadgetInfo,
	handleGadgetEvent,
	handleGadgetLogging,
	handleGadgetQuit,
	handleGadgetArrayData
} from '$lib/handlers/gadget.handler.svelte';
import {
	handleEnvironmentCreate,
	handleEnvironmentDelete
} from '$lib/handlers/environment.handler';
import {
	handleDeploymentProgress,
	handleDeploymentComplete,
	handleDeploymentError
} from '$lib/handlers/deployment.handler';

/**
 * Message router that dispatches incoming WebSocket messages to appropriate handlers.
 */
export class MessageRouterService {
	private msgID = 0;

	/**
	 * Route an incoming message to the appropriate handler based on message type.
	 * @param ev - The raw message string from WebSocket
	 */
	route(ev: string): void {
		const msg = JSON.parse(ev);
		if (!msg) return;

		// Add msgID to data if present
		if (msg.data) {
			msg.data.msgID = this.msgID++;
		}

		switch (msg.type) {
			case 1: // Request/response
				handleRequestResponse(msg);
				break;

			case 2: // Gadget info
				handleGadgetInfo(msg);
				break;

			case 3: // Gadget event
				handleGadgetEvent(msg);
				break;

			case 4: // Logging
				handleGadgetLogging(msg);
				break;

			case 5: // Quit
				handleGadgetQuit(msg);
				break;

			case 6: // Array data
				handleGadgetArrayData(msg);
				break;

			case 100: // Environment create
				handleEnvironmentCreate(msg);
				break;

			case 101: // Environment delete
				handleEnvironmentDelete(msg);
				break;

			case 200: // Deployment progress
				handleDeploymentProgress(msg);
				break;

			case 201: // Deployment complete
				handleDeploymentComplete(msg);
				break;

			case 202: // Deployment error
				handleDeploymentError(msg);
				break;

			default:
				console.warn(`Unknown message type: ${msg.type}`, msg);
		}
	}
}

/**
 * Singleton instance of MessageRouterService.
 */
export const messageRouter = new MessageRouterService();
