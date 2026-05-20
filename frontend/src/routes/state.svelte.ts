interface Request {
	resolve: (value: unknown) => void;
	reject: (error: unknown) => void;
}

interface WebSocketLike {
	send: (data: string) => void;
}

interface Command {
	reqID?: string;
	[key: string]: unknown;
}

let reqID = 0;
const requests: Record<string, Request> = {};
let ws: WebSocket | WebSocketLike;

export const appState = $state({
	api: {
		request(cmd: Command): Promise<unknown> {
			reqID++;
			cmd.reqID = '' + reqID; // stringify
			const prom = new Promise((resolve, reject) => {
				requests[cmd.reqID!] = { resolve, reject };
			});
			ws.send(JSON.stringify(cmd));
			return prom;
		},
		setWs(newWs: WebSocket | WebSocketLike): void {
			ws = newWs;
		}
	}
});
