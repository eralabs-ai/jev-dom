// The baseline everyone builds today: a general LLM agent driving the page.
//
//   llm-webmcp  the model is handed the site's WebMCP tools and calls them
//   llm-dom     the model is handed the same element table Jev sees (browser-use style)
//
// Both get the same rules Jev gets, the same simulated user, and are judged by
// the same outcome check — so what is being compared is the decision engine.
import Anthropic from "@anthropic-ai/sdk";
import { actionSpace, describe } from "../src/core/actions.js";
import { looksConsequential } from "../src/core/policy.js";
import { RULES } from "../src/core/questions.js";

/** Dollars per input/output token (Anthropic list prices). */
export const PRICES = {
  "claude-opus-5": [5 / 1e6, 25 / 1e6],
  "claude-sonnet-5": [2 / 1e6, 10 / 1e6],
  "claude-haiku-4-5": [1 / 1e6, 5 / 1e6],
};

export const MODEL = process.env.LLM_MODEL ?? "claude-opus-5";
const EFFORT = process.env.LLM_EFFORT ?? "low";
const SUPPORTS_EFFORT = !/haiku/.test(MODEL);
const MAX_TURNS = 8;

export const createClaude = () =>
  new Anthropic({
    baseURL: process.env.LLM_BASE_URL ?? "http://127.0.0.1:18080/anthropic",
    apiKey: process.env.LLM_API_KEY ?? "sk-kalanu-brokered-no-secret",
    maxRetries: 2,
  });

const SYSTEM = [
  "You carry out one request from the user of a web page, for them, right now.",
  ...RULES.map((rule) => rule.replace(/`user_request`/g, "the request").replace(/`elements`/g, "the listed elements").replace(/`recent_actions`/g, "the steps so far")),
  "Call exactly one tool per turn. When the request is carried out, say so in one short sentence and stop.",
].join("\n");

const DOM_TOOLS = [
  { name: "click", description: "Click one listed element: a button, link, tab, filter chip, checkbox, radio option or menu item.",
    input_schema: { type: "object", properties: { index: { type: "integer", description: "The [number] of the element to click." } }, required: ["index"] } },
  { name: "type_text", description: "Type text into one listed editable field, replacing what is there.",
    input_schema: { type: "object", properties: { index: { type: "integer", description: "The [number] of the field." }, text: { type: "string" }, submit: { type: "boolean", description: "Press Enter afterwards, e.g. for a search box." } }, required: ["index", "text"] } },
  { name: "select_option", description: "Choose an option in a listed dropdown.",
    input_schema: { type: "object", properties: { index: { type: "integer" }, option: { type: "string", description: "The option's label, exactly as listed." } }, required: ["index", "option"] } },
  { name: "scroll", description: "Scroll the page.", input_schema: { type: "object", properties: { direction: { type: "string", enum: ["down", "up"] } }, required: ["direction"] } },
  { name: "done", description: "The request is carried out: the page shows what was asked for, or the change is visible.", input_schema: { type: "object", properties: {} } },
  { name: "blocked", description: "Nothing on this page can carry out the request, or it is conversation, unclear or unfinished.", input_schema: { type: "object", properties: {} } },
];

const pageState = (snapshot, space) =>
  [
    `URL: ${snapshot.url}`,
    `Title: ${snapshot.title}`,
    snapshot.modal ? `An open dialog covers the page: ${snapshot.modal}` : null,
    "",
    "Visible text:",
    snapshot.text,
    "",
    "Elements you can act on:",
    ...space.elements.map((el) => describe(el)),
  ]
    .filter((line) => line != null)
    .join("\n");

/** One agent run. `execute(name, input)` returns the text the model sees back. */
async function converse({ client, system, tools, first, execute }) {
  const messages = [{ role: "user", content: first }];
  const started = performance.now();
  const usage = { input: 0, output: 0, calls: 0, cacheRead: 0, cacheWrite: 0 };
  const trail = [];
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const reply = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      // A real product would cache the stable prefix (system + tools + the page
      // states already seen), so the baseline gets it too.
      cache_control: { type: "ephemeral" },
      system,
      messages,
      tools,
      // Effort exists on the Opus/Sonnet 5 family; Haiku 4.5 rejects it.
      ...(SUPPORTS_EFFORT ? { output_config: { effort: EFFORT } } : {}),
    });
    usage.calls++;
    // Cache reads cost ~0.1x and writes ~1.25x; count them at face value for tokens
    // and price them properly in costOf().
    usage.input += reply.usage.input_tokens;
    usage.cacheRead += reply.usage.cache_read_input_tokens ?? 0;
    usage.cacheWrite += reply.usage.cache_creation_input_tokens ?? 0;
    usage.output += reply.usage.output_tokens;
    const calls = reply.content.filter((block) => block.type === "tool_use");
    if (!calls.length) {
      trail.push({ op: "STOP", text: reply.content.find((b) => b.type === "text")?.text?.slice(0, 80) });
      break;
    }
    messages.push({ role: "assistant", content: reply.content });
    const results = [];
    let stop = false;
    for (const call of calls) {
      const outcome = await execute(call.name, call.input ?? {});
      trail.push({ op: call.name, input: call.input, note: outcome.note });
      results.push({ type: "tool_result", tool_use_id: call.id, content: outcome.text, ...(outcome.isError ? { is_error: true } : {}) });
      stop ||= outcome.stop;
    }
    messages.push({ role: "user", content: results });
    if (stop) break;
  }
  return {
    totalMs: Math.round(performance.now() - started),
    modelCalls: usage.calls,
    inputTokens: usage.input + usage.cacheRead + usage.cacheWrite,
    outputTokens: usage.output,
    billed: { input: usage.input, output: usage.output, cacheRead: usage.cacheRead, cacheWrite: usage.cacheWrite },
    trail,
  };
}

/** The model is given the site's WebMCP tools — the case this project argues you no longer need. */
export async function llmWebmcp({ client, kase, tools, callTool, commits }) {
  const declared = tools.map((tool) => ({
    name: tool.name,
    description: tool.description ?? "",
    input_schema: tool.inputSchema && Object.keys(tool.inputSchema).length ? tool.inputSchema : { type: "object", properties: {} },
  }));
  const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
  let acted = null;
  const said = [];  // what the tools told the agent: the panel would show this to the user
  const run = await converse({
    client,
    system: `${SYSTEM}\nThe page offers the tools below. Call them to carry out the request.`,
    tools: declared,
    first: kase.said,
    execute: async (name, input) => {
      const tool = byName[name];
      const hints = tool?.annotations ?? {};
      if ((hints.consequentialHint || hints.destructiveHint) && !commits) {
        return { text: "The user did not confirm this action, so it was not carried out.", stop: true };
      }
      const result = await callTool(name, input);
      acted = acted ?? `called ${name}`;
      const text = result.ok ? String(result.result).slice(0, 4000) : `Error: ${result.error}`;
      said.push(text);
      return { text, isError: !result.ok };
    },
  });
  return { ...run, evidence: { acted, result: said.join("\n") } };
}

/** The model is given the same DOM element table Jev gets — today's browser-use agent. */
export async function llmDom({ client, kase, page, commits }) {
  let snapshot = await page.observe();
  let space = actionSpace(snapshot);
  let acted = null;
  const find = (index) => space.elements.find((el) => el.index === String(index));

  const run = await converse({
    client,
    system: `${SYSTEM}\nYou act through the listed elements only, by their [number].`,
    tools: DOM_TOOLS,
    first: `${kase.said}\n\n${pageState(snapshot, space)}`,
    execute: async (name, input) => {
      if (name === "done" || name === "blocked") return { text: "Stopped.", stop: true };
      const target = find(input.index);
      if (!target && name !== "scroll") return { text: `There is no element [${input.index}]. Choose one of the listed numbers.`, isError: true };
      let decision;
      if (name === "click") {
        if (looksConsequential(target) && !commits) return { text: "The user did not confirm this action, so it was not carried out.", stop: true };
        decision = { op: "CLICK", target };
      } else if (name === "type_text") {
        decision = { op: input.submit ? "TYPE_SUBMIT" : "TYPE", target, text: String(input.text ?? "") };
      } else if (name === "select_option") {
        const option = Object.values(space.targets.SELECT).find((t) => t.index === String(input.index) && t.option.label === input.option);
        if (!option) return { text: `That dropdown has no option "${input.option}".`, isError: true };
        decision = { op: "SELECT", target: option };
      } else if (name === "scroll") {
        decision = { op: input.direction === "up" ? "SCROLL_UP" : "SCROLL_DOWN" };
      }
      let failure = null;
      try {
        await page.act(decision);
        acted = acted ?? `${decision.op} "${target?.name ?? ""}"`;
      } catch (error) {
        failure = error.message.split("\n")[0];
      }
      snapshot = await page.observe();
      space = actionSpace(snapshot);
      return { text: `${failure ? `That did not work: ${failure}\n\n` : ""}${pageState(snapshot, space)}`, isError: Boolean(failure) };
    },
  });
  return { ...run, evidence: { acted } };
}

export const costOf = (run, model = MODEL) => {
  const [inPrice, outPrice] = PRICES[model] ?? [0, 0];
  const b = run.billed ?? { input: run.inputTokens, output: run.outputTokens, cacheRead: 0, cacheWrite: 0 };
  return b.input * inPrice + b.cacheWrite * inPrice * 1.25 + b.cacheRead * inPrice * 0.1 + b.output * outPrice;
};
