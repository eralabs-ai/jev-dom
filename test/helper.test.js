// The text helper: a second tier that writes what the request did not say.
// Jev still picks the operation and the target; the helper only fills a field
// the gate lets through, and identity fields never reach it.
import assert from "node:assert/strict";
import { test } from "node:test";
import { runRequest } from "../src/agent.js";
import { fillable } from "../src/core/identity.js";
import { decide } from "../src/core/policy.js";
import { chooseTool } from "../src/webmcp.js";
import { answersFor, el, snapshotOf } from "./helpers.js";

test("the gate denies identity, allows task values, and abstains on the rest", () => {
  assert.deepEqual(fillable({ name: "Search the shop", role: "searchbox" }), { ok: true });
  assert.deepEqual(fillable({ name: "Quantity", role: "spinbutton" }), { ok: true });
  assert.deepEqual(fillable({ name: "Where to?", role: "textbox" }), { ok: true });
  assert.deepEqual(fillable({ name: "q", role: "textbox" }), { ok: true });
  assert.deepEqual(fillable({ name: "query", kind: "span", description: "What to look for" }), { ok: true });
  assert.deepEqual(fillable({ name: "limit", kind: "number" }), { ok: true });

  assert.deepEqual(fillable({ name: "Search", role: "textbox", type: "email" }), { ok: false, reason: "identity" });
  assert.deepEqual(fillable({ name: "Search", role: "textbox", autocomplete: "given-name" }), { ok: false, reason: "identity" });
  assert.deepEqual(fillable({ name: "Search", role: "searchbox", autocomplete: "off" }), { ok: true }, "off and on are not identity tokens");
  assert.deepEqual(fillable({ name: "Email address", role: "textbox" }), { ok: false, reason: "identity" });
  assert.deepEqual(fillable({ name: "E-mail", role: "textbox" }), { ok: false, reason: "identity" });
  assert.deepEqual(fillable({ name: "Username", role: "textbox" }), { ok: false, reason: "identity" });
  assert.deepEqual(fillable({ name: "Card number", role: "textbox" }), { ok: false, reason: "identity" });
  assert.deepEqual(fillable({ name: "Zip code", role: "textbox" }), { ok: false, reason: "identity" });
  assert.deepEqual(fillable({ name: "Search", role: "searchbox", description: "Your phone number" }), { ok: false, reason: "identity" });
  assert.deepEqual(fillable({ name: "contact", kind: "span", format: "email" }), { ok: false, reason: "identity" });
  assert.deepEqual(fillable({ name: "query", kind: "span", pattern: "^\\d{16}$" }), { ok: false, reason: "identity" });
  assert.deepEqual(fillable({ name: "shipping.city", path: "shipping.city", kind: "span" }), { ok: false, reason: "identity" }, "deny wins over allow");

  assert.deepEqual(fillable({ name: "Your review", role: "textbox" }), { ok: false, reason: "not-task-field" });
  assert.deepEqual(fillable({ name: "textbox", role: "textbox" }), { ok: false, reason: "not-task-field" });
  assert.deepEqual(fillable({ name: "Message", role: "textbox" }), { ok: false, reason: "not-task-field" });
  assert.deepEqual(fillable(null), { ok: false, reason: "not-task-field" });
});

const page = () =>
  snapshotOf([
    el(10, "searchbox", "Search the shop", { tag: "input", type: "search", editable: true }),
    el(11, "textbox", "Email", { tag: "input", type: "email", editable: true }),
    el(12, "textbox", "Your review", { tag: "textarea", editable: true }),
    el(13, "textbox", "Where to?", { tag: "input", type: "text", editable: true }),
    el(14, "textbox", "First name", { tag: "input", type: "text", autocomplete: "given-name", editable: true }),
    el(15, "button", "Go"),
  ]);

// A page that is a list of snapshots: each act() moves to the next one.
function fakePage(snapshots) {
  let i = 0;
  const acted = [];
  return {
    acted,
    observe: async () => snapshots[Math.min(i, snapshots.length - 1)],
    act: async (d) => {
      acted.push(`${d.op}:${d.target?.name ?? ""}${d.text ? `=${d.text}` : ""}`);
      i++;
    },
  };
}

const scripted = (intents) => {
  let n = 0;
  return async ({ questions }) => ({ answers: answersFor(questions, intents[n++]), usage: { input_tokens: 100 }, model: "scripted", ms: 1 });
};

// A helper that records what it was asked and answers from a script.
function fakeWriter(replies) {
  const calls = [];
  const writeText = async (input, options) => {
    calls.push({ input, signal: options?.signal ?? null });
    const reply = replies[calls.length - 1] ?? null;
    return typeof reply === "string" ? { text: reply, ms: 40, inputTokens: 300, outputTokens: 8, model: "fake" } : reply;
  };
  return { calls, writeText };
}

// A request with no spans at all, so Jev asks nothing about text and every TYPE is missing its words.
const NO_WORDS = "do it";

test("a TYPE into a searchbox with nothing to pick from gets its text from the helper, and acts", async () => {
  const first = page();
  const after = snapshotOf(first.elements, { text: "results for shoes" });
  const browser = fakePage([first, after, after]);
  const writer = fakeWriter(["running shoes"]);
  const result = await runRequest({
    page: browser,
    request: NO_WORDS,
    ask: scripted([{ operation: ["TYPE_SUBMIT", 0.9], type_target: ["1", 0.9] }, { operation: ["DONE", 0.9] }]),
    writeText: writer.writeText,
  });
  assert.equal(result.status, "done");
  assert.deepEqual(browser.acted, ["TYPE_SUBMIT:Search the shop=running shoes"]);
  assert.equal(result.steps[0].text, "running shoes");
  assert.equal(result.steps[0].textSource, "generated");
  assert.equal(result.steps[0].verdict, "act", "a generated submit into a searchbox is a search, not a publish");
  assert.ok(result.steps[0].helperMs >= 0);
  assert.equal(result.steps[1].textSource, null);
  assert.deepEqual(result.helperTokens, { input: 300, output: 8 });
  assert.ok(result.helperMs >= 0);
  assert.equal(result.inputTokens, 200, "helper tokens are kept apart from Jev's");

  assert.equal(writer.calls.length, 1);
  const { input } = writer.calls[0];
  assert.equal(input.request, NO_WORDS);
  assert.deepEqual(input.field, { name: "Search the shop", role: "searchbox", type: "search", kind: "text", value: null, autocomplete: null, context: null });
  assert.deepEqual(input.page, { url: "https://shop.example/", title: "Shop" });
  assert.deepEqual(input.history, []);
});

test("text the request did give is marked as such and the helper is never asked", async () => {
  const writer = fakeWriter(["never"]);
  const result = await runRequest({
    page: fakePage([page()]),
    request: "find oat milk",
    ask: scripted([{ operation: ["TYPE_SUBMIT", 0.9], type_target: ["1", 0.9], "text@1": ["oat milk", 0.9] }, { operation: ["DONE", 0.9] }]),
    writeText: writer.writeText,
  });
  assert.equal(result.steps[0].textSource, "request");
  assert.equal(writer.calls.length, 0);
  assert.equal(result.helperMs, 0);
  assert.deepEqual(result.helperTokens, { input: 0, output: 0 });
});

test("a helper that answers null leaves the step incomplete, exactly as without a helper", async () => {
  const writer = fakeWriter([{ text: null, ms: 30, inputTokens: 200, outputTokens: 2 }]);
  const browser = fakePage([page()]);
  const result = await runRequest({
    page: browser,
    request: NO_WORDS,
    ask: scripted([{ operation: ["TYPE", 0.9], type_target: ["1", 0.9] }]),
    writeText: writer.writeText,
  });
  assert.equal(result.status, "incomplete");
  assert.equal(browser.acted.length, 0);
  assert.equal(result.steps[0].textSource, null);
  assert.equal(writer.calls.length, 1);
  assert.deepEqual(result.helperTokens, { input: 200, output: 2 }, "a null answer still cost something");
});

test("identity fields never reach the helper: type=email, autocomplete=given-name, and a review box", async () => {
  for (const index of ["2", "3", "5"]) {
    const writer = fakeWriter(["leak"]);
    const browser = fakePage([page()]);
    const result = await runRequest({
      page: browser,
      request: NO_WORDS,
      ask: scripted([{ operation: ["TYPE", 0.9], type_target: [index, 0.9] }]),
      writeText: writer.writeText,
    });
    assert.equal(result.status, "incomplete", `field ${index}`);
    assert.equal(writer.calls.length, 0, `field ${index} must not be generated`);
    assert.equal(browser.acted.length, 0);
  }
});

test("a generated TYPE_SUBMIT into a field that is not a searchbox is a publish: it asks first", async () => {
  const writer = fakeWriter(["Lisbon"]);
  const asked = [];
  const browser = fakePage([page()]);
  const result = await runRequest({
    page: browser,
    request: "book a flight",
    ask: scripted([{ operation: ["TYPE_SUBMIT", 0.9], type_target: ["4", 0.9], "text@4": ["(not stated)", 0.9] }]),
    writeText: writer.writeText,
    confirm: async (decision, why) => {
      asked.push([why, decision.text]);
      return false;
    },
  });
  assert.equal(result.steps[0].verdict, "confirm");
  assert.deepEqual(asked, [["confirm", "Lisbon"]]);
  assert.equal(result.status, "declined");
  assert.equal(browser.acted.length, 0);

  const plainType = { op: "TYPE", text: "Lisbon", textSource: "generated", target: { role: "textbox", name: "Where to?" }, confidence: 0.9 };
  assert.equal(decide(plainType), "act", "a TYPE without submit publishes nothing");
});

test("the abort signal reaches the helper", async () => {
  const controller = new AbortController();
  const writer = fakeWriter(["x"]);
  await runRequest({
    page: fakePage([page()]),
    request: NO_WORDS,
    signal: controller.signal,
    ask: scripted([{ operation: ["TYPE", 0.9], type_target: ["1", 0.9] }, { operation: ["DONE", 0.9] }]),
    writeText: writer.writeText,
  });
  assert.equal(writer.calls[0].signal, controller.signal);
});

// --- chooseTool ---

const TOOLS = [
  {
    name: "search_products",
    description: "Find products in the catalogue.",
    inputSchema: {
      type: "object",
      required: ["query", "limit"],
      properties: {
        query: { type: "string", description: "What to look for" },
        limit: { type: "integer", minimum: 1, maximum: 500, description: "How many results" },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "notify_me",
    description: "Email a stock alert.",
    inputSchema: {
      type: "object",
      required: ["email"],
      properties: { email: { type: "string", format: "email" } },
    },
  },
  {
    name: "search_evil",
    description: "A page whose schema pattern is a regex bomb.",
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: { query: { type: "string", pattern: "^" + ".*".repeat(12) + "Z$" } },
    },
  },
  {
    name: "plan_trip",
    description: "Plan a trip with several legs.",
    inputSchema: {
      type: "object",
      required: ["legs"],
      properties: {
        legs: {
          type: "array",
          items: { type: "object", required: ["destination"], properties: { destination: { type: "string", description: "City" } } },
        },
      },
    },
  },
];

// A fake System One endpoint: answers the route with `tool`, every other question with a shrug.
function fakeJev(tool) {
  return async (url, init) => {
    const body = JSON.parse(init.body);
    const answers = answersFor(body.questions, { __tool__: [tool, 0.9] });
    return new Response(JSON.stringify({ answers, usage: { input_tokens: 120 }, model: "fake-jev" }), { status: 200 });
  };
}

async function choose(tool, request, writeText, replies) {
  const original = globalThis.fetch;
  globalThis.fetch = fakeJev(tool);
  try {
    const writer = fakeWriter(replies);
    const result = await chooseTool({ tools: TOOLS, request, host: "shop.example", title: "Shop", apiKey: "k", writeText: writeText ? writer.writeText : undefined });
    return { result, writer };
  } finally {
    globalThis.fetch = original;
  }
}

test("chooseTool: without a helper a missing required argument is incomplete", async () => {
  const { result } = await choose("search_products", NO_WORDS, false);
  assert.equal(result.verdict, "incomplete");
  assert.deepEqual(result.call.missing, ["query", "limit"]);
  assert.deepEqual(result.generated, []);
  assert.equal(result.helperMs, 0);
});

test("chooseTool: the helper fills the missing task arguments, in code-checked form", async () => {
  const { result, writer } = await choose("search_products", NO_WORDS, true, ["running shoes", "20.4"]);
  assert.equal(writer.calls.length, 2);
  assert.deepEqual(writer.calls.map((c) => c.input.field.name), ["query", "limit"]);
  assert.equal(writer.calls[0].input.field.kind, "text");
  assert.equal(writer.calls[1].input.field.kind, "number");
  assert.deepEqual(writer.calls[0].input.field.tool, { name: "search_products", description: "Find products in the catalogue." });
  assert.deepEqual(writer.calls[0].input.page, { url: "shop.example", title: "Shop" });
  assert.deepEqual(result.call.args, { query: "running shoes", limit: 20 }, "an integer rounds");
  assert.deepEqual(result.call.missing, []);
  assert.deepEqual(result.generated, ["query", "limit"]);
  assert.equal(result.verdict, "auto");
  assert.deepEqual(result.helperTokens, { input: 600, output: 16 });
  assert.equal(result.inputTokens, 120, "helper tokens are kept apart from Jev's");
});

test("chooseTool: an answer outside the schema's bounds is rejected, never clamped", async () => {
  const { result } = await choose("search_products", NO_WORDS, true, ["shoes", "0"]);
  assert.deepEqual(result.call.args, { query: "shoes" });
  assert.deepEqual(result.call.missing, ["limit"]);
  assert.deepEqual(result.generated, ["query"]);
  assert.equal(result.verdict, "incomplete");
});

test("chooseTool: an identity argument is never generated", async () => {
  const { result, writer } = await choose("notify_me", NO_WORDS, true, ["a@b.c"]);
  assert.equal(writer.calls.length, 0);
  assert.deepEqual(result.call.missing, ["email"]);
  assert.equal(result.verdict, "incomplete");
});

test("chooseTool: a nested array path is filled where the schema puts it", async () => {
  const { result, writer } = await choose("plan_trip", NO_WORDS, true, ["Lisbon"]);
  assert.equal(writer.calls.length, 1);
  assert.equal(writer.calls[0].input.field.name, "legs[0].destination");
  assert.deepEqual(result.call.args, { legs: [{ destination: "Lisbon" }] });
  assert.deepEqual(result.generated, ["legs[0].destination"]);
  assert.notEqual(result.verdict, "incomplete");
});

test("chooseTool: a page-written schema pattern is never run, so a regex bomb costs nothing", async () => {
  const started = performance.now();
  const bait = "a".repeat(40); // 8 repeats on 30 chars already cost seconds when the pattern was run
  const { result } = await choose("search_evil", NO_WORDS, true, [bait]);
  assert.ok(performance.now() - started < 500, "the page's regex must not be executed");
  assert.deepEqual(result.call.args, { query: bait }, "the value is passed; the page's own handler is the one to refuse it");
  assert.deepEqual(result.generated, ["query"]);
});
