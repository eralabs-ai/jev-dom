// The agent's `page` for a Chrome tab: the same in-page reader and executor the
// Playwright harness tests (lib/page/snapshot.js, lib/page/perform.js), injected
// with chrome.scripting. Both run in the extension's isolated world, where the
// node identities from the last snapshot live between calls.
import { performInPage, waitForQuiet } from "./lib/page/perform.js";
import { snapshotPage } from "./lib/page/snapshot.js";

async function inject(tabId, func, args = []) {
  const [injection] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return injection?.result;
}

function loaded(tabId, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const done = () => {
      chrome.tabs.onUpdated.removeListener(listen);
      clearTimeout(timer);
      resolve();
    };
    const listen = (id, change) => id === tabId && change.status === "complete" && done();
    const timer = setTimeout(done, timeoutMs);
    chrome.tabs.onUpdated.addListener(listen);
    chrome.tabs.get(tabId).then((tab) => tab.status === "complete" && done(), done);
  });
}

export function chromePage(tabId, { quietMs = 60, capMs = 1500 } = {}) {
  async function observe() {
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const snapshot = await inject(tabId, snapshotPage, [{}]);
        if (snapshot) return snapshot;
      } catch {
        // The document is being replaced; wait for the new one.
      }
      await loaded(tabId, 3000);
    }
    throw new Error("Could not read this page.");
  }

  async function settle() {
    try {
      await inject(tabId, waitForQuiet, [{ quietMs, capMs }]);
    } catch {
      await loaded(tabId);
    }
  }

  async function act(decision) {
    const payload = { op: decision.op, id: decision.target?.id, text: decision.text, value: decision.target?.option?.value };
    let result = null;
    try {
      result = await inject(tabId, performInPage, [payload]);
    } catch {
      // The action navigated away mid-call: it ran.
    }
    if (result?.error) throw new Error(result.error);
    await settle();
  }

  return { observe, act, settle };
}
