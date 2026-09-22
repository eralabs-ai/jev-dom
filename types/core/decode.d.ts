import type { Decision, JevAnswer, StepPlan } from "../common.js";

export type { Alternative, Decision, StepPlan } from "../common.js";

/** Thrown when Jev answers outside the offered options, or the probabilities do not add up. */
export declare class InvalidAnswer extends Error {}

/** Answers -> one decision the executor can run. Only the winning operation's target head is read. */
export declare function decode(plan: StepPlan, answers: Record<string, JevAnswer>): Decision;
