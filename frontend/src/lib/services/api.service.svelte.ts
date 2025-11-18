import { websocketService } from './websocket.service.svelte';

type RequestCommand = {
	cmd: string;
	reqID?: string;
	[key: string]: any;
};

type PendingRequest = {
	resolve: (data: any) => void;
	reject: (error: any) => void;
};

/**
 * API service that provides a promise-based request/response pattern over WebSocket.
 */
export class ApiService {
	private reqID = 0;
	private requests: Record<string, PendingRequest> = {};

	/**
	 * Send a request command and get a promise that resolves with the response.
	 * @param cmd - The command object to send
	 * @returns Promise that resolves with the response data
	 */
	request(cmd: RequestCommand): Promise<any> {
		this.reqID++;
		cmd.reqID = '' + this.reqID; // stringify

		const prom = new Promise((resolve, reject) => {
			this.requests[cmd.reqID!] = { resolve, reject };
		});

		websocketService.send(JSON.stringify(cmd));
		return prom;
	}

	/**
	 * Handle a response message (type 1) from the server.
	 * @param msg - The parsed message object
	 */
	handleResponse(msg: any): void {
		if (msg.reqID && this.requests[msg.reqID]) {
			if (!msg.success) {
				this.requests[msg.reqID].reject(msg.error);
				delete this.requests[msg.reqID];
				return;
			}
			this.requests[msg.reqID].resolve(msg.data);
			delete this.requests[msg.reqID];
		}
	}
}

/**
 * Singleton instance of ApiService.
 */
export const apiService = new ApiService();
