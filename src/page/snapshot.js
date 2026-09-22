// In-page DOM reader. It runs INSIDE the page (Playwright `page.evaluate`, or
// `chrome.scripting.executeScript` in an extension), so it must stay
// self-contained: no imports and no references to module scope.
//
// Adapted from browser-use/jev-ultrafast's snapshot.js (MIT): one atomic read
// of the page's controls with their accessible names, values and state, and a
// code-owned identity for each real DOM node. The model only ever picks one of
// these identities, never a selector, a coordinate or a script.
//
// Differences from jev-ultrafast: controls outside the viewport are kept (the
// executor scrolls them into view) so short commands need no scroll-hunting;
// each control carries a short `context` (the card, row, shelf or form it sits
// in); pressed/current state is read; and an open modal limits the controls
// to what is inside it.
export function snapshotPage({ maxElements = 240, maxText = 2500 } = {}) {
  if (!document.body) return null;
  const cache = (window.__jevDom ||= { ids: new WeakMap(), nodes: new Map(), next: 1 });
  const identity = (e) => {
    if (!cache.ids.has(e)) cache.ids.set(e, cache.next++);
    const id = cache.ids.get(e);
    cache.nodes.set(id, e);
    return id;
  };
  for (const [id, e] of cache.nodes) if (!e.isConnected) cache.nodes.delete(id);

  const squash = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
  const clip = (s, n) => {
    const t = squash(s);
    return t.length > n ? `${t.slice(0, n - 1)}…` : t;
  };
  // Native checkboxes and radios are often transparent under a styled label
  // (TodoMVC, most design systems), so opacity does not hide them.
  const toggle = (e) => e.tagName === "INPUT" && (e.type === "checkbox" || e.type === "radio");
  const visible = (e) =>
    !e.closest('[aria-hidden="true"],[inert]') && e.checkVisibility({ checkOpacity: !toggle(e), checkVisibilityCSS: true });

  // Accessible name, close enough for common HTML/ARIA (not the full spec).
  const name = (e, seen = new Set()) => {
    if (!e || seen.has(e)) return "";
    seen.add(e);
    const referenced = (e.getAttribute("aria-labelledby") || "")
      .split(/\s+/)
      .map((id) => name(document.getElementById(id), seen))
      .filter(Boolean)
      .join(" ");
    return squash(
      referenced ||
        e.getAttribute("aria-label") ||
        [...(e.labels || [])].map((l) => name(l, seen)).filter(Boolean).join(" ") ||
        (["button", "submit", "reset"].includes(e.type) ? e.value : "") ||
        e.getAttribute("alt") ||
        (["INPUT", "SELECT", "TEXTAREA"].includes(e.tagName)
          ? ""
          : [...e.childNodes]
              .map((n) => {
                if (n.nodeType === 3) return n.textContent;
                if (n.nodeType !== 1 || n.getAttribute("aria-hidden") === "true") return "";
                // A page's inline CSS/JS is not its label.
                if (["STYLE", "SCRIPT", "NOSCRIPT", "TEMPLATE"].includes(n.tagName)) return "";
                return name(n, seen);
              })
              .join(" ")) ||
        e.querySelector?.("svg > title")?.textContent ||
        e.getAttribute("title") ||
        e.getAttribute("placeholder") ||
        "",
    );
  };

  const ROLES = ["button", "link", "checkbox", "radio", "switch", "tab", "menuitem", "menuitemradio", "menuitemcheckbox",
    "option", "gridcell", "combobox", "textbox", "searchbox", "spinbutton", "treeitem"];
  const SELECTOR = `a[href],button,input,textarea,select,summary,[contenteditable="true"],${ROLES.map((r) => `[role="${r}"]`).join(",")}`;
  const role = (e) => {
    const explicit = e.getAttribute("role");
    if (ROLES.includes(explicit)) return explicit;
    if (e.tagName === "BUTTON" || e.tagName === "SUMMARY") return "button";
    if (e.tagName === "A") return "link";
    if (e.tagName === "SELECT") return "combobox";
    if (e.tagName === "TEXTAREA" || e.isContentEditable) return "textbox";
    if (e.tagName === "INPUT") {
      if (["checkbox", "radio"].includes(e.type)) return e.type;
      if (["button", "submit", "reset", "image"].includes(e.type)) return "button";
      if (e.type === "search") return "searchbox";
      if (e.type === "number" || e.type === "range") return "spinbutton";
      if (["text", "email", "url", "tel", "date", "time", "datetime-local", "month", "week", ""].includes(e.type)) return "textbox";
    }
    return null;
  };

  // The card, row, shelf, form or dialog a control sits in: "Dairy & Eggs › Oat Milk $4.99 …".
  const CONTAINERS = 'article,li,tr,[role="row"],fieldset,[role="group"],[role="radiogroup"],form,dialog,[role="dialog"],' +
    'section,[role="region"],nav,aside,[role="listitem"],[role="gridcell"]';
  const INTERACTIVE = `${SELECTOR},label`;
  // A group's own short text, outside its controls: the "2" between a stepper's − and +.
  const groupValue = (c) => {
    if (!c.matches('fieldset,[role="group"],[role="radiogroup"],[role="spinbutton"]')) return "";
    let text = "";
    const walker = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n && text.length <= 30; n = walker.nextNode()) {
      const p = n.parentElement;
      const control = p?.closest(INTERACTIVE);
      if (!p || (control && c.contains(control)) || p.closest('[aria-hidden="true"],h1,h2,h3,h4,h5,h6,legend,script,style')) continue;
      text += ` ${n.textContent}`;
    }
    text = squash(text);
    return text.length <= 30 ? text : "";
  };
  const containerLabel = (c, own) => {
    const labelled = (c.getAttribute("aria-labelledby") || "")
      .split(/\s+/)
      .map((id) => (id ? document.getElementById(id)?.textContent ?? "" : ""))
      .join(" ");
    const legend = c.tagName === "FIELDSET" ? c.querySelector(":scope > legend")?.textContent : "";
    const heading = c.querySelector("h1,h2,h3,h4,h5,h6")?.textContent;
    const explicit = squash(labelled || c.getAttribute("aria-label") || legend || heading || "");
    if (explicit) {
      const value = groupValue(c);
      return clip(value ? `${explicit}: ${value}` : explicit, 70);
    }
    // A small unlabeled container (a product card, a table row) explains a
    // terse control ("Add", "Remove", "+"): its accessible text minus the control's own.
    if (own.length > 24 || (c.textContent || "").length > 600) return "";
    const text = name(c);
    if (!text || text.length > 300) return "";
    const rest = squash(own ? text.replace(own, " ") : text).replace(/\p{Extended_Pictographic}/gu, "").trim();
    return /\p{L}{3}/u.test(rest) ? clip(rest, 70) : "";
  };
  const context = (e, own) => {
    const parts = [];
    let c = e.parentElement?.closest(CONTAINERS);
    for (let hops = 0; c && hops < 4 && parts.length < 2; hops++) {
      const label = containerLabel(c, own);
      if (label && label !== own && !parts.includes(label)) parts.unshift(label);
      c = c.parentElement?.closest(CONTAINERS);
    }
    return parts.join(" › ");
  };

  // An open modal makes everything behind it unreachable.
  const modal =
    [...document.querySelectorAll("dialog[open]")].filter((d) => d.matches(":modal") && visible(d)).pop() ||
    [...document.querySelectorAll('[aria-modal="true"]')].filter(visible).pop() ||
    null;
  const root = modal || document;

  const W = innerWidth;
  const H = innerHeight;
  const found = [];
  const seenKey = new Set();
  let order = 0;
  for (const e of root.querySelectorAll(SELECTOR)) {
    if (["password", "file", "hidden"].includes(e.type)) continue;
    if (!visible(e) || e.matches(":disabled") || e.closest('[aria-disabled="true"]')) continue;
    const r = role(e);
    if (!r) continue;
    if (r === "gridcell" && e.querySelector('button,[role="button"],a[href]')) continue;
    const rect = e.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    // Unlabelled controls are common; their id/name attribute is the last hint a
    // person would have from the markup, and it often says what the field is for.
    const hint = () => squash(String(e.getAttribute("name") || e.id || "").replace(/[-_]+/g, " ").replace(/\d{4,}/g, "")).toLowerCase();
    const own = name(e) || hint();
    const tag = e.tagName.toLowerCase();
    const el = { id: identity(e), role: r, name: clip(own || r, 90), tag, order: order++ };
    if (e.type && tag === "input") el.type = e.type;
    el.inView = rect.bottom > 0 && rect.right > 0 && rect.top < H && rect.left < W;
    const where = context(e, own);
    if (where) el.context = where;

    // Toggle state is kept even when "false": "not pressed" tells the model a filter is off.
    const state = {};
    for (const key of ["checked", "pressed", "selected", "expanded", "current"]) {
      const v = e.getAttribute(`aria-${key}`);
      if (v !== null && !(key === "current" && v === "false")) state[key] = v;
    }
    if (["checkbox", "radio"].includes(e.type)) state.checked = String(e.checked);
    if (Object.keys(state).length) el.state = state;

    if (tag === "select") {
      el.value = [...e.selectedOptions].map((o) => o.label).join(", ");
      el.options = [...e.options]
        .filter((o) => !o.disabled && !o.closest("optgroup[disabled]"))
        .slice(0, 60)
        .map((o) => ({ value: o.value, label: clip(o.label || o.textContent, 60), selected: o.selected }));
    } else {
      el.editable =
        !e.readOnly && e.getAttribute("aria-readonly") !== "true" &&
        (["textbox", "searchbox", "spinbutton"].includes(r) || (r === "combobox" && ["INPUT", "TEXTAREA"].includes(e.tagName)) ||
          e.isContentEditable);
      if (!el.editable) delete el.editable;
      const value = e.isContentEditable ? e.innerText : el.editable || r === "combobox" ? String(e.value ?? "") : "";
      if (value) el.value = clip(value, 80);
    }

    // The same control rendered twice (desktop + mobile nav): keep one.
    const key = `${r}|${el.name}|${el.context ?? ""}|${el.value ?? ""}`;
    if (seenKey.has(key)) continue;
    seenKey.add(key);
    found.push(el);
  }

  // Everything in view, then the rest in document order, up to the budget.
  const kept = [...found].sort((a, b) => Number(b.inView) - Number(a.inView) || a.order - b.order).slice(0, maxElements);
  kept.sort((a, b) => a.order - b.order);
  for (const el of kept) delete el.order;

  // Visible text, so the model can see results, messages and totals.
  const words = [];
  let length = 0;
  const walker = document.createTreeWalker(modal || document.body, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let node = walker.nextNode(); node && length < maxText; node = walker.nextNode()) {
    const value = squash(node.textContent);
    const parent = node.parentElement;
    if (!value || !parent || parent.closest("script,style,noscript,template") || !visible(parent)) continue;
    range.selectNodeContents(node);
    const r = range.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < H && r.right > 0 && r.left < W) {
      words.push(value);
      length += value.length + 1;
    }
  }

  return {
    url: location.href,
    title: document.title,
    text: clip(words.join(" \n"), maxText),
    modal: modal ? clip(name(modal) || modal.getAttribute("aria-label") || "dialog", 60) : null,
    scroll: { y: Math.round(scrollY), height: document.documentElement.scrollHeight, viewport: H },
    elements: kept,
    omitted: found.length - kept.length,
  };
}
