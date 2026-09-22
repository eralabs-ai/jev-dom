/** The WebMCP half: jev-webmcp-extension's pipeline as one function, its internals unexposed. */

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  untrustedContentHint?: boolean;
  consequentialHint?: boolean;
  destructiveHint?: boolean;
}

/** A tool schema as the page registered it, normalised by `pageListTools`. */
export interface ToolSchema {
  name: string;
  title?: string | null;
  description?: string;
  inputSchema?: unknown;
  annotations?: ToolAnnotations;
}

/**
 * none        no tool fits: hand off to a System Two model or the user
 * incomplete  a required argument has no value yet
 * auto        read-only and confident: safe to run while the user types
 * ready       run it
 * confirm     ask first (shaky, flagged, or consequential)
 */
export type ToolVerdict = "none" | "incomplete" | "auto" | "ready" | "confirm";

/** The predicted call, with a probability behind every part of it. */
export interface ToolCall {
  name: string;
  tool: ToolSchema;
  args: Record<string, unknown>;
  /** Per-argument decode detail: label, path, value and probability. */
  details: unknown[];
  /** Labels of required arguments the request did not state. */
  missing: string[];
  routes: Array<{ value: string | null; probability: number }>;
  routeProbability?: number;
  /** The least certain judgement behind the call. */
  confidence: number;
  picked?: boolean;
}

export interface ChooseToolResult {
  /** Null when no tool fits the request. */
  call: ToolCall | null;
  verdict: ToolVerdict;
  /** The call's confidence, or the route's when no tool was chosen. */
  confidence: number;
  inputTokens: number;
  /** The Jev request's own latency. */
  ms: number;
  model: string;
  /** The decode plan behind this prediction, for inspection. */
  plan: unknown;
}

export interface ChooseToolOptions {
  /** The tool schemas the page registered (see `pageListTools`). */
  tools: ToolSchema[];
  /** The user's own words. */
  request: string;
  /** The page's host and title: the page context Jev reads. */
  host?: string;
  title?: string;
  apiKey: string;
  model?: string;
  signal?: AbortSignal;
}

/**
 * One request: which of the page's WebMCP tools carries out `request`, with what
 * arguments. The call is NOT executed — the page bridge belongs to the caller.
 */
export declare function chooseTool(options: ChooseToolOptions): Promise<ChooseToolResult>;

/** In-page bridge: the tools this page offers. Runs INSIDE the page. */
export declare function pageListTools(): Promise<{ tools: ToolSchema[]; api?: string | null; error?: string }>;

/** In-page bridge: run one tool. `argsJson` is the arguments as a JSON string. Runs INSIDE the page. */
export declare function pageCallTool(name: string, argsJson: string): Promise<{ ok: true; result: string } | { ok: false; error: string }>;
