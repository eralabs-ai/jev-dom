import assert from "node:assert/strict";
import { test } from "node:test";
import { runRequest } from "../src/agent.js";
import { actionSpace, describe } from "../src/core/actions.js";
import { decode, InvalidAnswer } from "../src/core/decode.js";
import { decide } from "../src/core/policy.js";
import { buildStep, MAX_OPTIONS, NOT_STATED } from "../src/core/questions.js";
import { answersFor, el, snapshotOf } from "./helpers.js";

const shop = () =>
  snapshotOf([
    el(10, "searchbox", "Search the shop", { tag: "input", type: "search", editable: true }),
    el(11, "button", "vegan", { state: { pressed: "false" }, context: "Dietary filters" }),
    el(12, "button", "Add", { context: "Dairy & Eggs › Oat Milk $4.99" }),
    el(13, "spinbutton", "Quantity", { tag: "input", type: "number", editable: true, value: "1" }),
    el(14, "combobox", "Sort by", {
      tag: "select",
      value: "Relevance",
      options: [
        { value: "relevance", label: "Relevance", selected: true },
        { value: "price-asc", label: "Price: low to high", selected: false },
      ],
    }),
    el(15, "button", "Place order"),
  ]);

test("each operation is offered only when the page can support it", () => {
  const space = actionSpace(shop());
  assert.deepEqual(Object.keys(space.ops), ["CLICK", "TYPE", "TYPE_SUBMIT", "SELECT", "DONE", "NONE"]);
  assert.deepEqual(Object.keys(space.targets.CLICK), ["2", "3", "6"]);
  assert.deepEqual(Object.keys(space.targets.TYPE), ["1", "4"]);
  assert.deepEqual(Object.keys(space.targets.SELECT), ["5:2"], "the selected option is not offered again");

  const scrolled = actionSpace(snapshotOf([el(1, "link", "Home")], { scroll: { y: 300, height: 3000, viewport: 800 } }));
  assert.ok(scrolled.ops.SCROLL_DOWN && scrolled.ops.SCROLL_UP && !scrolled.ops.TYPE && !scrolled.ops.SELECT);
});

test("elements are described with their state and where they sit", () => {
  const space = actionSpace(shop());
  assert.equal(describe(space.elements[1]), '[2] button "vegan" (not pressed) · in Dietary filters');
  assert.equal(describe(space.elements[2]), '[3] button "Add" · in Dairy & Eggs › Oat Milk $4.99');
  assert.equal(describe(space.elements[3]), '[4] spinbutton "Quantity" = "1"');
});

test("one request carries the operation, every target head, and a text head per field", () => {
  const snapshot = shop();
  const { questions, plan, state } = buildStep({ request: "throw in two cartons of oat milk", snapshot, space: actionSpace(snapshot) });
  assert.deepEqual(Object.keys(questions), ["operation", "single_step", "click_target", "type_target", "select_target", "text@1", "text@4"]);
  assert.equal(state.user_request, "throw in two cartons of oat milk");
  assert.equal(state.elements.length, 6);
  assert.ok("oat milk" in questions["text@1"].criteria, "free text is a span of the user's words");
  assert.ok(NOT_STATED in questions["text@1"].criteria);
  assert.deepEqual(Object.keys(questions["text@4"].criteria), ["2", NOT_STATED], "a number field is offered the numbers the user said");
  assert.equal(plan.text["4"].values["2"], "2");
});

test("no head ever offers more options than a Choice accepts", () => {
  const many = snapshotOf(Array.from({ length: 400 }, (_, i) => el(i + 1, "button", `Button ${i + 1}`)));
  const { questions } = buildStep({ request: "press the last button", snapshot: many, space: actionSpace(many) });
  assert.equal(Object.keys(questions.click_target.criteria).length, MAX_OPTIONS);
});

const decided = (request, intent, snapshot = shop()) => {
  const { questions, plan } = buildStep({ request, snapshot, space: actionSpace(snapshot) });
  return decode(plan, answersFor(questions, intent));
};

test("only the winning operation's target head is read", () => {
  const d = decided("show vegan things", {
    operation: ["CLICK", 0.9],
    click_target: ["2", 0.8],
    type_target: ["1", 0.99], // speculative, must be ignored
  });
  assert.equal(d.op, "CLICK");
  assert.equal(d.target.name, "vegan");
  assert.equal(d.confidence, 0.8, "a step is as sure as its least sure part");
  assert.equal(d.text, undefined);
});

test("typed text is a span of the request, and submit is its own operation", () => {
  const d = decided("find oat milk", { operation: ["TYPE_SUBMIT", 0.95], type_target: ["1", 0.9], "text@1": ["oat milk", 0.85] });
  assert.equal(d.op, "TYPE_SUBMIT");
  assert.equal(d.target.id, 10);
  assert.equal(d.text, "oat milk");
  assert.equal(d.confidence, 0.85);
  assert.equal(decide(d), "act");
});

test("a field whose text the request does not give is incomplete, not guessed", () => {
  const d = decided("search for something", { operation: ["TYPE", 0.9], type_target: ["1", 0.9], "text@1": [NOT_STATED, 0.7] });
  assert.equal(d.text, null);
  assert.equal(decide(d), "incomplete");
});

test("selects carry the chosen option", () => {
  const d = decided("cheapest first", { operation: ["SELECT", 0.9], select_target: ["5:2", 0.9] });
  assert.equal(d.target.option.value, "price-asc");
});

test("answers outside the offered options execute nothing", () => {
  const snapshot = shop();
  const { questions, plan } = buildStep({ request: "x", snapshot, space: actionSpace(snapshot) });
  const answers = answersFor(questions, { operation: ["CLICK", 0.9] });
  answers.click_target = { type: "choice", choice: "99", probabilities: { 99: 1 }, confidence: 1 };
  assert.throws(() => decode(plan, answers), InvalidAnswer);
});

test("policy: commitments always ask, shaky steps ask, the rest runs", () => {
  assert.equal(decide(decided("buy it", { operation: ["CLICK", 0.99], click_target: ["6", 0.99] })), "confirm");
  assert.equal(decide(decided("vegan", { operation: ["CLICK", 0.9], click_target: ["2", 0.3] })), "unsure");
  assert.equal(decide(decided("tell me a joke", { operation: ["NONE", 0.9] })), "none");
  assert.equal(decide(decided("vegan", { operation: ["DONE", 0.9] })), "done");
});

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

// Scripted Jev: one intent per step, read off the request's own element table.
const scripted = (intents) => {
  let n = 0;
  return async ({ questions }) => ({ answers: answersFor(questions, intents[n++]), usage: { input_tokens: 100 }, model: "scripted", ms: 1 });
};

test("the loop acts until Jev says DONE, feeding each result back as history", async () => {
  const first = shop();
  const second = snapshotOf([...first.elements.slice(0, 2), el(12, "button", "Increase Oat Milk quantity"), ...first.elements.slice(3)], { text: "1 in cart" });
  const third = { ...second, text: "2 in cart" };
  const page = fakePage([first, second, third]);
  const seen = [];
  const jev = scripted([{ operation: ["CLICK", 0.9], click_target: ["3", 0.9] }, { operation: ["CLICK", 0.9], click_target: ["3", 0.9] }, { operation: ["DONE", 0.9] }]);
  const result = await runRequest({
    page,
    request: "two oat milks",
    ask: async (req) => {
      seen.push(req.state.recent_actions);
      return jev(req);
    },
  });
  assert.equal(result.status, "done");
  assert.deepEqual(page.acted, ["CLICK:Add", "CLICK:Increase Oat Milk quantity"]);
  assert.equal(result.jevCalls, 3);
  assert.equal(seen[2].length, 2);
  assert.equal(seen[2][0].result, "the page changed");
});

test("the loop gives up when two steps in a row change nothing", async () => {
  const page = fakePage([shop()]);
  const always = { operation: ["CLICK", 0.9], click_target: ["2", 0.9] };
  const result = await runRequest({ page, request: "vegan", ask: scripted([always, always, always]) });
  assert.equal(result.status, "stuck");
  assert.equal(page.acted.length, 2);
});

test("a reply with no usage data still produces a numeric inputTokens, not NaN", async () => {
  // `createJev`'s ask normalises a missing/empty API `usage` to `{ input_tokens: 0 }`
  // (src/jev.js) — this is that contract, fed straight to runRequest via a scripted ask.
  const page = fakePage([shop()]);
  const result = await runRequest({
    page,
    request: "vegan",
    ask: async ({ questions }) => ({
      answers: answersFor(questions, { operation: ["DONE", 0.9] }),
      usage: { input_tokens: 0 },
      model: "scripted",
      ms: 1,
    }),
  });
  assert.equal(result.steps[0].inputTokens, 0);
  assert.equal(Number.isNaN(result.steps[0].inputTokens), false);
});

test("a declined confirmation stops before acting", async () => {
  const page = fakePage([shop()]);
  const result = await runRequest({
    page,
    request: "ok buy it",
    ask: scripted([{ operation: ["CLICK", 0.99], click_target: ["6", 0.99] }]),
    confirm: async () => false,
  });
  assert.equal(result.status, "declined");
  assert.equal(page.acted.length, 0);
});

test("finishEarly skips the DONE round trip only when one step was judged enough and the page changed", async () => {
  const first = shop();
  const changed = snapshotOf(first.elements, { text: "vegan filter on" });
  const oneStep = { operation: ["CLICK", 0.9], click_target: ["2", 0.9], single_step: 0.95 };

  const early = await runRequest({ page: fakePage([first, changed]), request: "vegan", ask: scripted([oneStep]), finishEarly: true });
  assert.equal(early.status, "done");
  assert.equal(early.jevCalls, 1);

  const doubtful = await runRequest({
    page: fakePage([first, changed, changed]),
    request: "vegan",
    ask: scripted([{ ...oneStep, single_step: 0.4 }, { operation: ["DONE", 0.9] }]),
    finishEarly: true,
  });
  assert.equal(doubtful.jevCalls, 2, "an unsure single-step judgment still asks again");

  const unchanged = await runRequest({
    page: fakePage([first, first, first]),
    request: "vegan",
    ask: scripted([oneStep, { operation: ["DONE", 0.9] }]),
    finishEarly: true,
  });
  assert.equal(unchanged.jevCalls, 2, "an action that changed nothing is not trusted to have finished");
});

test("an aborted signal stops the loop before the next step", async () => {
  const controller = new AbortController();
  const page = fakePage([shop(), snapshotOf(shop().elements, { text: "changed" })]);
  const result = await runRequest({
    page,
    request: "vegan",
    signal: controller.signal,
    ask: async (req) => {
      controller.abort();
      return scripted([{ operation: ["CLICK", 0.9], click_target: ["2", 0.9] }])(req);
    },
  });
  assert.equal(result.status, "stopped");
  assert.equal(page.acted.length, 0);
});
