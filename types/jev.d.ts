import type { Ask } from "./common.js";

export type { Ask, JevReply } from "./common.js";

/** Dollars per input token (output tokens are free), as used by jev-webmcp-extension. */
export declare const PRICE_PER_INPUT_TOKEN: number;

export declare class JevError extends Error {
  constructor(message: string, status?: number);
  name: "JevError";
  status?: number;
}

export interface CreateJevOptions {
  /** From console.typesafe.ai/keys. Required: `createJev` throws `JevError` without it. */
  apiKey: string;
  model?: string;
  /** Override the TypeSafe endpoint, e.g. for a proxy. */
  api?: string;
  timeoutMs?: number;
  /** How many times to back off and retry a 429/503/529. */
  retries?: number;
}

/** Returns the `ask` function `runRequest` calls once per step. */
export declare function createJev(options?: CreateJevOptions): Ask;

/** Lists the models the key can reach; throws `JevError` if it cannot. */
export declare function checkKey(options: { apiKey: string; api?: string }): Promise<unknown>;
