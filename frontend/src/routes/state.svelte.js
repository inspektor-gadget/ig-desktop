let reqID = 0;
let requests = {};
let ws;

export const appState = $state({
	api: {
		request(cmd) {
			reqID++;
			cmd.reqID = '' + reqID; // stringify
			const prom = new Promise((resolve, reject) => {
				requests[cmd.reqID] = { resolve, reject };
			});
			ws.send(JSON.stringify(cmd));
			return prom;
		},
		setWs(newWs) {
			ws = newWs;
		}
	}
});
