import type { Operation } from "../common.js";

export type { Operation } from "../common.js";

/**
 * In-page executor for hosts without trusted input, like a browser extension.
 * Runs INSIDE the page. `id` is the node identity `snapshotPage` recorded.
 * Returns `{ error }` when the target is gone, disabled, invisible or covered.
 */
export declare function performInPage(step: { op: Operation; id?: number; text?: string | null; value?: string }): { error?: string } | undefined;

/** Resolves once the DOM has been quiet for `quietMs` (or after `capMs`). Runs INSIDE the page. */
export declare function waitForQuiet(options?: { quietMs?: number; capMs?: number }): Promise<true>;
