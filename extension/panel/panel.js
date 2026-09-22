// The side panel: type a request, watch Jev carry it out on the page.
// Everything from the page (control names, text) is rendered as text nodes.
import { chromePage } from "../chrome-page.js";
import { runRequest } from "../lib/agent.js";
import { checkKey, createJev, PRICE_PER_INPUT_TOKEN } from "../lib/jev.js";

const $ = (id) => document.getElementById(id);
const DEFAULTS = { apiKey: "", model: "jev-latest", askWhenUnsure: true, finishEarly: false };
const settings = { ...DEFAULTS, ...(await chrome.storage.local.get(Object.keys(DEFAULTS))) };
const save = (patch) => (Object.assign(settings, patch), chrome.storage.local.set(patch));

// The panel follows the active tab; ?tab=<id> pins one (used by the automated test).
const pinnedTab = Number(new URLSearchParams(location.search).get("tab")) || null;
let page = null; // { tab, origin, host }
let running = null; // AbortController of the run in progress

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c != null));
  return node;
}

// ---- settings
$("settings-toggle").addEventListener("click", () => {
  const open = $("settings").hidden;
  $("settings").hidden = !open;
  $("settings-toggle").setAttribute("aria-expanded", String(open));
});
$("api-key").value = settings.apiKey;
$("ask-unsure").checked = settings.askWhenUnsure;
$("finish-early").checked = settings.finishEarly;
$("ask-unsure").addEventListener("change", (e) => save({ askWhenUnsure: e.target.checked }));
$("finish-early").addEventListener("change", (e) => save({ finishEarly: e.target.checked }));
$("save-key").addEventListener("click", async () => {
  const apiKey = $("api-key").value.trim();
  $("key-status").textContent = "Checking…";
  try {
    await checkKey({ apiKey });
    await save({ apiKey });
    $("key-status").textContent = "Saved. The key works.";
    refresh();
  } catch (error) {
    $("key-status").textContent = error.message;
  }
});

// ---- which page, and may we touch it?
function notice(text, action) {
  $("notice").replaceChildren(el("p", { textContent: text }), action ?? "");
  $("notice").hidden = false;
  $("app").hidden = true;
}

async function refresh() {
  const tab = pinnedTab ? await chrome.tabs.get(pinnedTab) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!tab?.url || !/^https?:/.test(tab.url)) {
    page = null;
    $("site").textContent = "";
    return notice("Open a regular web page to use Jev × DOM here.");
  }
  const { origin, host } = new URL(tab.url);
  page = { tab, origin, host };
  $("site").textContent = host;
  if (!settings.apiKey) {
    $("settings").hidden = false;
    return notice("Add your TypeSafe API key in settings to start.");
  }
  if (!(await chrome.permissions.contains({ origins: [`${origin}/*`] }))) {
    const enable = el("button", { type: "button", textContent: `Enable on ${host}` });
    enable.addEventListener("click", async () => (await chrome.permissions.request({ origins: [`${origin}/*`] })) && refresh());
    return notice(`Jev × DOM reads and operates a page only on sites you enable.`, enable);
  }
  $("notice").hidden = true;
  $("app").hidden = false;
  $("say").focus();
}

if (!pinnedTab) {
  chrome.tabs.onActivated.addListener(() => !running && refresh());
  chrome.tabs.onUpdated.addListener((_id, change, tab) => tab.active && (change.status === "complete" || change.url) && !running && refresh());
}
refresh();

// ---- one request
const pct = (p) => `${Math.round((p ?? 0) * 100)}%`;
const what = (s) => {
  if (s.op === "DONE") return "done";
  if (s.op === "NONE") return "nothing on this page fits";
  const target = s.target ? `${s.target.role} “${s.target.option ?? s.target.name}”` : "";
  return s.text != null ? `${target} ← “${s.text}”` : target;
};

function stepRow(s) {
  const row = el(
    "li",
    { className: `step ${s.op.toLowerCase()}` },
    el("span", { className: "op", textContent: s.op.replace("_", " ") }),
    el("span", { className: "what", textContent: what(s), title: s.target?.context ? `in ${s.target.context}` : "" }),
    el("span", { className: `conf ${s.confidence >= 0.8 ? "high" : s.confidence >= 0.5 ? "mid" : "low"}`, textContent: pct(s.confidence) }),
    el("span", { className: "ms", textContent: `${s.jevMs} ms` }),
  );
  return row;
}

function ask(list, decision, why) {
  return new Promise((resolve) => {
    const reason = why === "confirm" ? "This looks like a commitment." : `Jev is only ${pct(decision.confidence)} sure.`;
    const yes = el("button", { type: "button", className: "primary", textContent: "Run it" });
    const no = el("button", { type: "button", textContent: "Stop" });
    const prompt = el("li", { className: "prompt" }, el("span", { textContent: reason }), no, yes);
    const answer = (value) => (prompt.remove(), resolve(value));
    yes.addEventListener("click", () => answer(true));
    no.addEventListener("click", () => answer(false));
    running?.signal.addEventListener("abort", () => answer(false));
    list.append(prompt);
    yes.focus();
  });
}

const SUMMARY = {
  done: "✔ done",
  none: "■ nothing on this page fits",
  incomplete: "■ a field needs text your request doesn't give",
  declined: "■ stopped at your request",
  stopped: "■ stopped",
  stuck: "■ the page stopped responding",
  budget: "■ gave up after too many steps",
};

async function run(request) {
  const list = el("ol", { className: "steps" });
  const status = el("p", { className: "status", textContent: "Thinking…" });
  const block = el("article", { className: "run" }, el("h2", { textContent: request }), list, status);
  $("log").prepend(block);
  running = new AbortController();
  $("stop").hidden = false;
  $("run").disabled = true;
  try {
    const result = await runRequest({
      page: chromePage(page.tab.id),
      ask: createJev({ apiKey: settings.apiKey, model: settings.model }),
      request,
      signal: running.signal,
      finishEarly: settings.finishEarly,
      confirm: (decision, why) => (why === "unsure" && !settings.askWhenUnsure ? true : ask(list, decision, why)),
      onStep: (s) => {
        list.append(stepRow(s));
        status.textContent = "Working…";
      },
    });
    for (const s of result.steps) if (s.error) list.append(el("li", { className: "error", textContent: `Step ${s.step}: ${s.error}` }));
    const cost = (result.inputTokens * PRICE_PER_INPUT_TOKEN).toFixed(4);
    status.textContent = `${SUMMARY[result.status] ?? result.status} · ${(result.totalMs / 1000).toFixed(2)} s · ${result.jevCalls} Jev ${result.jevCalls === 1 ? "call" : "calls"} · ≈ $${cost}`;
    status.className = `status ${result.status}`;
  } catch (error) {
    status.textContent = error.name === "AbortError" ? SUMMARY.stopped : `Error: ${error.message}`;
    status.className = "status error";
  } finally {
    running = null;
    $("stop").hidden = true;
    $("run").disabled = false;
  }
}

$("command").addEventListener("submit", (event) => {
  event.preventDefault();
  const request = $("say").value.trim();
  if (!request || running || !page) return;
  $("say").value = "";
  run(request);
});
$("say").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    $("command").requestSubmit();
  }
});
$("stop").addEventListener("click", () => running?.abort());
