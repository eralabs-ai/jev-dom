// In-page executor for hosts without trusted input, like a browser extension
// (chrome.scripting.executeScript). Like snapshot.js it runs INSIDE the page and
// must stay self-contained. Targets are the node identities snapshotPage
// recorded; nothing the model says becomes a selector or a script.

/** Carry out one decided step on the node the snapshot recorded under `id`. */
export function performInPage({ op, id, text, value }) {
  const el = window.__jevDom?.nodes.get(id);
  if (!el?.isConnected) return { error: "The chosen element is gone." };
  if (el.matches(":disabled") || el.closest('[aria-disabled="true"],[inert]')) return { error: "The chosen element is disabled." };
  el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return { error: "The chosen element is not visible." };
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;

  // Refuse a control covered by something else (an overlay, a cookie banner).
  const hit = document.elementFromPoint(x, y);
  const reachable = hit && (hit === el || el.contains(hit) || [...(el.labels ?? [])].some((label) => label.contains(hit)));
  if (!reachable && op !== "SELECT") return { error: "Something else is covering the chosen element." };

  const at = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, view: window };
  const press = () => {
    el.dispatchEvent(new PointerEvent("pointerdown", { ...at, pointerType: "mouse", isPrimary: true }));
    el.dispatchEvent(new MouseEvent("mousedown", at));
    el.focus?.({ preventScroll: true });
    el.dispatchEvent(new PointerEvent("pointerup", { ...at, pointerType: "mouse", isPrimary: true }));
    el.dispatchEvent(new MouseEvent("mouseup", at));
    el.click();
  };
  // The prototype's native setter, so frameworks that track `value` (React) see a change.
  const type = (value) => {
    el.focus?.({ preventScroll: true });
    if (el.isContentEditable) {
      document.execCommand("selectAll");
      document.execCommand("insertText", false, value);
      return;
    }
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: value }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  // Synthetic keys have no default action, so a form is submitted explicitly,
  // unless the page handled Enter itself.
  const enter = () => {
    const key = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true };
    const unhandled = el.dispatchEvent(new KeyboardEvent("keydown", key));
    el.dispatchEvent(new KeyboardEvent("keyup", key));
    if (unhandled && el.form) el.form.requestSubmit();
  };

  switch (op) {
    case "CLICK":
      press();
      return { ok: true };
    case "TYPE":
      type(text);
      return { ok: true };
    case "TYPE_SUBMIT":
      type(text);
      enter();
      return { ok: true };
    case "SELECT":
      if (![...el.options].some((o) => o.value === value && !o.disabled)) return { error: "That option is no longer offered." };
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true };
    case "SCROLL_DOWN":
    case "SCROLL_UP":
      scrollBy({ top: op === "SCROLL_DOWN" ? 600 : -600, behavior: "instant" });
      return { ok: true };
    default:
      return { error: `Cannot perform ${op}.` };
  }
}

/** Resolve once the DOM has been quiet for `quietMs` (or after `capMs`), so the next read sees the result. */
export function waitForQuiet({ quietMs = 60, capMs = 1500 } = {}) {
  return new Promise((resolve) => {
    let timer;
    const finish = () => {
      observer.disconnect();
      clearTimeout(timer);
      clearTimeout(cap);
      resolve(true);
    };
    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(finish, quietMs);
    });
    observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    timer = setTimeout(finish, quietMs);
    const cap = setTimeout(finish, capMs);
  });
}
