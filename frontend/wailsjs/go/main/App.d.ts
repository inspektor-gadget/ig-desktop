// Cynhyrchwyd y ffeil hon yn awtomatig. PEIDIWCH Â MODIWL
// This file is automatically generated. DO NOT EDIT
import {main} from '../models';
import {grpcruntime} from '../models';

export function AddEnvironment(arg1:main.Environment):Promise<void>;

export function DeleteEnvironment(arg1:main.Environment):Promise<void>;

export function GetEnvironments():Promise<Array<main.Environment>>;

export function GetRuntime(arg1:string):Promise<grpcruntime.Runtime>;

export function Greet(arg1:string):Promise<string>;

export function Run():Promise<void>;
