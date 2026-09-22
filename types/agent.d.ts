import type { ActionSpace } from "./core/actions.js";
import type { BuiltStep, Decision, JevReply, Operation, PageHost, Snapshot, Verdict, Ask } from "./common.js";

export type { Ask, Decision, PageHost, Snapshot, Verdict } from "./common.js";

/** Verdicts that end the loop by themselves, mapped to the status they end it with. */
export declare const STOPS: { readonly done: "done"; readonly none: "none"; readonly incomplete: "incomplete" };

/** Tuning for `readWhenStable`: re-read until the element count settles, or the budget runs out. */
export declare const STABLE: { readonly budgetMs: number; readonly pauseMs: number; readonly shrink: number };

/** Tuning for `finishEarly`: how sure a one-step finish must be, and which operations may end one. */
export declare const EARLY: { readonly singleStep: number; readonly ops: Operation[] };

/** What the page looks like to a person: address, dialog, text, and each control's label, value and state. */
export declare function fingerprint(snapshot: Snapshot): string;

/** How a run ended. */
export type RunStatus = "done" | "none" | "incomplete" | "stopped" | "declined" | "stuck" | "budget";

/** The target as `onStep` reports it: enough to name the control, not the whole element. */
export interface StepTarget {
  id: number;
  index: string;
  role: string;
  name: string;
  context?: string;
  option?: string;
}

/** One step of a run, recorded as it happens. */
export interface StepRecord {
  step: number;
  op: Operation;
  target: StepTarget | null;
  text: string | null;
  /** The least sure part of the decision. */
  confidence: number;
  verdict: Verdict;
  /** The Jev request's own latency. */
  jevMs: number;
  inputTokens: number;
  model: string;
  /** How many controls the step chose between. */
  elements: number;
  /** How many questions the one request carried. */
  questions: number;
  /** 0..1 — could this one action have completed the request? */
  singleStep: number;
  /** Set when the user was asked before acting. */
  asked?: "confirm" | "unsure";
  /** First line of the error, when `page.act` threw. */
  error?: string;
  /** Milliseconds spent in `page.act`. */
  actMs?: number;
  /** Did the page look different afterwards? */
  changed?: boolean;
}

export interface RunResult {
  request: string;
  status: RunStatus;
  reason?: string;
  steps: StepRecord[];
  totalMs: number;
  /** When the last action that changed the page finished, or null if none did. */
  effectMs: number | null;
  jevCalls: number;
  jevMs: number;
  inputTokens: number;
}

export interface RunRequestOptions {
  page: PageHost;
  ask: Ask;
  /** The user's own words. */
  request: string;
  maxSteps?: number;
  thresholds?: { act: number };
  /** Let a one-step request end without a second request to say DONE. */
  finishEarly?: boolean;
  signal?: AbortSignal;
  /** Asked before a shaky or consequential step; returning false ends the run as "declined". */
  confirm?: (decision: Decision, verdict: "confirm" | "unsure") => Promise<boolean> | boolean;
  onStep?: (record: StepRecord, extra: { decision: Decision; built: BuiltStep; reply: JevReply }) => void | Promise<void>;
}

/** The loop for one request: observe -> one Jev request -> decide -> act, until it is carried out. */
export declare function runRequest(options: RunRequestOptions): Promise<RunResult>;

export type { ActionSpace };
