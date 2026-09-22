import type { Snapshot } from "../common.js";

export type { Snapshot, SnapshotElement } from "../common.js";

/**
 * In-page DOM reader: one atomic read of the page's controls with their
 * accessible names, values and state. Runs INSIDE the page, so pass it to
 * `page.evaluate` or `chrome.scripting.executeScript` rather than calling it here.
 * Returns null before the document has a body.
 */
export declare function snapshotPage(options?: { maxElements?: number; maxText?: number }): Snapshot | null;
