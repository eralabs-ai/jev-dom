import type { ActionTarget, Operation, Snapshot, SnapshotElement } from "../common.js";

export type { ActionTarget, Operation, Snapshot, SnapshotElement } from "../common.js";

/** Every operation the model may choose, and the sentence describing it. */
export declare const OPERATIONS: Record<Operation, string>;

/** Operations whose target is chosen by a speculative target head. */
export declare const TARGETED: { readonly CLICK: "click"; readonly TYPE: "type"; readonly TYPE_SUBMIT: "type"; readonly SELECT: "select" };

/** `[12] button "Add Bananas to cart" (pressed) · in Produce › $0.29 Bananas each` */
export declare function describe(el: SnapshotElement & { index?: string }, index?: string): string;

export interface ActionSpace {
  /** The snapshot's controls, each given the `index` the model answers with. */
  elements: ActionTarget[];
  /** Only the operations this page has something to act on, mapped to their descriptions. */
  ops: Partial<Record<Operation, string>>;
  targets: {
    CLICK: Record<string, ActionTarget>;
    TYPE: Record<string, ActionTarget>;
    TYPE_SUBMIT: Record<string, ActionTarget>;
    SELECT: Record<string, ActionTarget>;
  };
  /** The fields that get their own text question, visible ones first. */
  textFields: ActionTarget[];
}

/** A page snapshot -> the indexed element table the model reads, plus each operation's targets. */
export declare function actionSpace(snapshot: Snapshot, options?: { maxTextFields?: number }): ActionSpace;
