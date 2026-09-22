// Executes decisions in a Playwright page. Every target is resolved from the
// node identity the snapshot recorded.
//
//   input: "trusted"    Playwright input (CDP): actionability checks scroll the
//                       node into view and refuse hidden, disabled or covered targets.
//   input: "synthetic"  performInPage, exactly what the browser extension runs,
//                       so the extension's executor can be tested on real sites.
import { performInPage, waitForQuiet } from "./perform.js";
import { snapshotPage } from "./snapshot.js";

export class StaleTarget extends Error {}

const NAVIGATING = /context was destroyed|navigat|Target closed/i;

export function playwrightPage(page, { input = "trusted", snapshot = {}, quietMs = 60, capMs = 1500, actionTimeoutMs = 2500 } = {}) {
  async function observe() {
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const snap = await page.evaluate(snapshotPage, snapshot);
        if (snap) return snap;
      } catch (error) {
        if (!NAVIGATING.test(error.message)) throw error;
      }
      await page.waitForLoadState("domcontentloaded").catch(() => {});
    }
    throw new Error("The page never settled enough to read.");
  }

  // Wait until the DOM stops changing, so the next observation sees this action's result.
  async function settle() {
    try {
      await page.evaluate(waitForQuiet, { quietMs, capMs });
    } catch (error) {
      if (!NAVIGATING.test(error.message)) throw error;
      await page.waitForLoadState("domcontentloaded").catch(() => {});
    }
  }

  async function element(id) {
    const handle = await page.evaluateHandle((node) => window.__jevDom?.nodes.get(node) ?? null, id);
    const el = handle.asElement();
    if (!el) throw new StaleTarget("The chosen element is gone.");
    return el;
  }

  async function trusted(decision) {
    const target = decision.target;
    const options = { timeout: actionTimeoutMs };
    switch (decision.op) {
      case "CLICK":
        return (await element(target.id)).click(options);
      case "TYPE":
        return (await element(target.id)).fill(decision.text, options);
      case "TYPE_SUBMIT": {
        const el = await element(target.id);
        await el.fill(decision.text, options);
        return el.press("Enter", options);
      }
      case "SELECT":
        return (await element(target.id)).selectOption(target.option.value, options);
      case "SCROLL_DOWN":
      case "SCROLL_UP":
        return page.mouse.wheel(0, decision.op === "SCROLL_DOWN" ? 600 : -600);
      default:
        throw new Error(`Cannot execute ${decision.op}.`);
    }
  }

  async function synthetic(decision) {
    const payload = { op: decision.op, id: decision.target?.id, text: decision.text, value: decision.target?.option?.value };
    let result;
    try {
      result = await page.evaluate(performInPage, payload);
    } catch (error) {
      if (!NAVIGATING.test(error.message)) throw error; // the action navigated away: it ran
    }
    if (result?.error) throw new Error(result.error);
  }

  async function act(decision) {
    await (input === "synthetic" ? synthetic(decision) : trusted(decision));
    await settle();
  }

  return { observe, act, settle, page };
}
