export namespace api {
	
	export class AuthProviderConfig {
	    name: string;
	    config?: Record<string, string>;
	
	    static createFrom(source: any = {}) {
	        return new AuthProviderConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.config = source["config"];
	    }
	}
	export class ExecEnvVar {
	    name: string;
	    value: string;
	
	    static createFrom(source: any = {}) {
	        return new ExecEnvVar(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.value = source["value"];
	    }
	}
	export class ExecConfig {
	    command: string;
	    args: string[];
	    env: ExecEnvVar[];
	    apiVersion?: string;
	    installHint?: string;
	    provideClusterInfo: boolean;
	    interactiveMode?: string;
	
	    static createFrom(source: any = {}) {
	        return new ExecConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.command = source["command"];
	        this.args = source["args"];
	        this.env = this.convertValues(source["env"], ExecEnvVar);
	        this.apiVersion = source["apiVersion"];
	        this.installHint = source["installHint"];
	        this.provideClusterInfo = source["provideClusterInfo"];
	        this.interactiveMode = source["interactiveMode"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

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
	    inDeployment: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Environment(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.runtime = source["runtime"];
	        this.params = source["params"];
	        this.inDeployment = source["inDeployment"];
	    }
	}

}

export namespace rest {
	
	export class ImpersonationConfig {
	    UserName: string;
	    UID: string;
	    Groups: string[];
	    Extra: Record<string, string[]>;
	
	    static createFrom(source: any = {}) {
	        return new ImpersonationConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.UserName = source["UserName"];
	        this.UID = source["UID"];
	        this.Groups = source["Groups"];
	        this.Extra = source["Extra"];
	    }
	}
	export class Config {
	    Host: string;
	    APIPath: string;
	    AcceptContentTypes: string;
	    ContentType: string;
	    // Go type: schema
	    GroupVersion?: any;
	    NegotiatedSerializer: any;
	    Username: string;
	    Password: string;
	    BearerToken: string;
	    BearerTokenFile: string;
	    Impersonate: ImpersonationConfig;
	    AuthProvider?: api.AuthProviderConfig;
	    AuthConfigPersister: any;
	    ExecProvider?: api.ExecConfig;
	    Insecure: boolean;
	    ServerName: string;
	    CertFile: string;
	    KeyFile: string;
	    CAFile: string;
	    CertData: number[];
	    KeyData: number[];
	    CAData: number[];
	    NextProtos: string[];
	    UserAgent: string;
	    DisableCompression: boolean;
	    Transport: any;
	    QPS: number;
	    Burst: number;
	    RateLimiter: any;
	    WarningHandler: any;
	    Timeout: number;
	
	    static createFrom(source: any = {}) {
	        return new Config(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Host = source["Host"];
	        this.APIPath = source["APIPath"];
	        this.AcceptContentTypes = source["AcceptContentTypes"];
	        this.ContentType = source["ContentType"];
	        this.GroupVersion = this.convertValues(source["GroupVersion"], null);
	        this.NegotiatedSerializer = source["NegotiatedSerializer"];
	        this.Username = source["Username"];
	        this.Password = source["Password"];
	        this.BearerToken = source["BearerToken"];
	        this.BearerTokenFile = source["BearerTokenFile"];
	        this.Impersonate = this.convertValues(source["Impersonate"], ImpersonationConfig);
	        this.AuthProvider = this.convertValues(source["AuthProvider"], api.AuthProviderConfig);
	        this.AuthConfigPersister = source["AuthConfigPersister"];
	        this.ExecProvider = this.convertValues(source["ExecProvider"], api.ExecConfig);
	        this.Insecure = source["Insecure"];
	        this.ServerName = source["ServerName"];
	        this.CertFile = source["CertFile"];
	        this.KeyFile = source["KeyFile"];
	        this.CAFile = source["CAFile"];
	        this.CertData = source["CertData"];
	        this.KeyData = source["KeyData"];
	        this.CAData = source["CAData"];
	        this.NextProtos = source["NextProtos"];
	        this.UserAgent = source["UserAgent"];
	        this.DisableCompression = source["DisableCompression"];
	        this.Transport = source["Transport"];
	        this.QPS = source["QPS"];
	        this.Burst = source["Burst"];
	        this.RateLimiter = source["RateLimiter"];
	        this.WarningHandler = source["WarningHandler"];
	        this.Timeout = source["Timeout"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

