export namespace grpcruntime {
	export class Runtime {
		static createFrom(source: any = {}) {
			return new Runtime(source);
		}

		constructor(source: any = {}) {
			if ('string' === typeof source) source = JSON.parse(source);
		}
	}
}

export namespace main {
	export class Environment {
		id: string;
		name: string;
		runtime: string;
		params: Record<string, string>;

		static createFrom(source: any = {}) {
			return new Environment(source);
		}

		constructor(source: any = {}) {
			if ('string' === typeof source) source = JSON.parse(source);
			this.id = source['id'];
			this.name = source['name'];
			this.runtime = source['runtime'];
			this.params = source['params'];
		}
	}
}
