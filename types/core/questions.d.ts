import type { ActionSpace } from "./actions.js";
import type { BuiltStep, HistoryEntry, Operation, Snapshot } from "../common.js";

export type { BuiltStep, HistoryEntry, StepPlan } from "../common.js";

/** The option a text question offers when the request does not give that field's words. */
export declare const NOT_STATED: "(not stated)";

/** A Choice accepts up to 255 options; targets are capped just under it. */
export declare const MAX_OPTIONS: number;

/** The instruction list embedded in the operation and target questions. */
export declare const RULES: string[];

/** Which question id carries each targeted operation's target. */
export declare const TARGET_QID: Record<Extract<Operation, "CLICK" | "TYPE" | "TYPE_SUBMIT" | "SELECT">, string>;

/** The whole step as one request, plus the plan `decode` needs to read the answers. */
export declare function buildStep(args: { request: string; snapshot: Snapshot; space: ActionSpace; history?: HistoryEntry[] }): BuiltStep;
