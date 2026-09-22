import type { ActionTarget, Decision, Verdict } from "../common.js";

export type { Decision, Verdict } from "../common.js";

export declare const THRESHOLDS: { readonly act: number };

/** Does this control's label read like a commitment (order, payment, delete, send)? */
export declare function looksConsequential(target: Pick<ActionTarget, "name"> | null | undefined): boolean;

/**
 * act         confident: run it
 * unsure      below the confidence threshold: show it, let the user decide
 * confirm     reads like a commitment: always ask
 * incomplete  a field needs text the request does not contain
 * done        the request is carried out
 * none        nothing on the page fits, or the request is conversation
 */
export declare function decide(decision: Decision, options?: { thresholds?: { act: number } }): Verdict;
