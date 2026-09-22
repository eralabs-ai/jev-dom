import type { Decision, Snapshot } from "../common.js";

export type { Decision, Snapshot } from "../common.js";

/** Thrown when the node the snapshot recorded is no longer in the page. */
export declare class StaleTarget extends Error {}

export interface PlaywrightPageOptions {
  /**
   * trusted    Playwright input (CDP): actionability checks refuse hidden, disabled or covered targets
   * synthetic  performInPage, exactly what the browser extension runs
   */
  input?: "trusted" | "synthetic";
  /** Passed to `snapshotPage`. */
  snapshot?: { maxElements?: number; maxText?: number };
  /** How long the DOM must be quiet before a read is taken, and the cap on waiting for that. */
  quietMs?: number;
  capMs?: number;
  actionTimeoutMs?: number;
}

/** The page host, plus the Playwright page it was built from. */
export interface PlaywrightDriver<TPage> {
  observe(): Promise<Snapshot>;
  act(decision: Decision): Promise<void>;
  /** Wait until the DOM stops changing, so the next observation sees this action's result. */
  settle(): Promise<void>;
  page: TPage;
}

/**
 * Executes decisions in a Playwright page. `page` is your own Playwright `Page`;
 * it is handed back on the result so you can keep driving it yourself.
 */
export declare function playwrightPage<TPage>(page: TPage, options?: PlaywrightPageOptions): PlaywrightDriver<TPage>;
