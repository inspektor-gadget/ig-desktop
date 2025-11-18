interface Request {
	resolve: (value: any) => void;
	reject: (error: any) => void;
}

interface WebSocketLike {
	send: (data: string) => void;
}

interface Command {
	reqID?: string;
	[key: string]: any;
}

let reqID = 0;
let requests: Record<string, Request> = {};
let ws: WebSocket | WebSocketLike;

export const appState = $state({
	api: {
		request(cmd: Command): Promise<any> {
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
