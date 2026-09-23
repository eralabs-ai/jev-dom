// The WebMCP half of the comparison, as one function. jev-webmcp-extension's
// pipeline is unchanged — its questions, its decode, its policy — so a consumer
// gets the same prediction the extension would make without importing any of
// its internals: tool schemas in, one Jev request, one predicted call out.
//
// The call is NOT executed here: the page bridge belongs to the caller, which
// may be Playwright, `chrome.scripting`, or navigator.modelContext directly.
//
// A required argument the request did not state leaves the call `incomplete`.
// With a `writeText` helper (see agent.js), a free-text or numeric argument
// that `fillable` lets through is written by the helper and checked against
// the schema's bounds in code before it goes into the call; anything those
// reject stays missing, never clamped. A page-written `pattern` is never run.
import { decode } from "jev-webmcp/src/core/decode.js";
import { decide } from "jev-webmcp/src/core/policy.js";
import { buildQuestions, buildState } from "jev-webmcp/src/core/questions.js";
import { systemOne } from "jev-webmcp/src/jev.js";
import { fillable } from "./core/identity.js";

// In-page bridges, for a caller that drives navigator.modelContext itself.
export { pageCallTool, pageListTools } from "jev-webmcp/src/platform/chrome.js";

/** Longest generated value a schema may be asked to accept. */
const MAX_TEXT = 120;

function setPath(target, path, value) {
  let node = target;
  path.forEach((key, i) => {
    if (i === path.length - 1) return void (node[key] = value);
    node[key] ??= typeof path[i + 1] === "number" ? [] : {};
    node = node[key];
  });
}

/** The generated text as the schema's value, or undefined when the schema rejects it. */
function accept(param, text) {
  const schema = param.schema ?? {};
  if (typeof text !== "string" || !text.trim()) return undefined;
  if (param.kind === "number") {
    const raw = Number(text.trim());
    if (!Number.isFinite(raw)) return undefined;
    const value = schema.type === "integer" ? Math.round(raw) : raw;
    if (Number.isFinite(schema.minimum) && value < schema.minimum) return undefined;
    if (Number.isFinite(schema.maximum) && value > schema.maximum) return undefined;
    if (Number.isFinite(schema.exclusiveMinimum) && value <= schema.exclusiveMinimum) return undefined;
    if (Number.isFinite(schema.exclusiveMaximum) && value >= schema.exclusiveMaximum) return undefined;
    return value;
  }
  const value = text.trim();
  if (value.length > MAX_TEXT) return undefined;
  if (Number.isFinite(schema.maxLength) && value.length > schema.maxLength) return undefined;
  if (Number.isFinite(schema.minLength) && value.length < schema.minLength) return undefined;
  // A schema `pattern` is deliberately NOT run: it is a regex the page wrote,
  // and `new RegExp(pattern).test(value)` on the caller's event loop is a
  // ReDoS the page controls (`^.*.*.*.*.*.*.*.*Z$` at 23 chars takes seconds,
  // and neither an abort signal nor a route timeout interrupts a synchronous
  // regex). A value the page's own handler rejects is the page's answer to
  // give, and the caller sees it as a refused call rather than a stalled worker.
  return value;
}

/** Fill the missing required arguments the gate lets through. Mutates `call`. */
async function fillMissing(call, plan, writeText, { request, host, title, signal }) {
  const helper = { ms: 0, tokens: { input: 0, output: 0 } };
  const generated = [];
  const params = plan.tools[call.name]?.params ?? [];
  const candidates = call.missing
    .map((label) => params.find((p) => p.label === label))
    .filter((p) => p && (p.kind === "span" || p.kind === "number"))
    .filter((p) => fillable({ name: p.label, path: p.label, kind: p.kind, description: p.schema?.description, format: p.schema?.format, pattern: p.schema?.pattern }).ok);
  if (!candidates.length) return { ...helper, generated };

  const started = performance.now();
  const tool = { name: call.tool.name, description: call.tool.description ?? "" };
  const replies = await Promise.all(
    candidates.map((p) =>
      writeText(
        { request, field: { name: p.label, kind: p.kind === "number" ? "number" : "text", schema: p.schema, description: p.schema?.description ?? null, tool }, page: { url: host ?? null, title: title ?? null }, history: [] },
        { signal },
      ),
    ),
  );
  helper.ms = Math.round(performance.now() - started);
  replies.forEach((reply, i) => {
    helper.tokens.input += reply?.inputTokens ?? 0;
    helper.tokens.output += reply?.outputTokens ?? 0;
    const param = candidates[i];
    const value = accept(param, reply?.text);
    if (value === undefined) return;
    setPath(call.args, param.path, value);
    const detail = call.details.find((d) => d.label === param.label);
    if (detail) Object.assign(detail, { value, missing: false, generated: true });
    generated.push(param.label);
  });
  call.missing = call.missing.filter((label) => !generated.includes(label));
  return { ...helper, generated };
}

/**
 * One request: which of the page's WebMCP tools carries out `request`, with what arguments.
 *
 * @param tools     the tool schemas the page registered (see pageListTools)
 * @param request   the user's own words
 * @param host      the page's host, and `title` its title: the page context Jev reads
 * @param writeText optional helper for required free-text / numeric arguments the request did not state
 * @returns `call` is null when no tool fits; `ms` is the Jev request's own latency;
 *          `helperMs` / `helperTokens` the helper's, apart from Jev's; `generated` the labels it filled.
 */
export async function chooseTool({ tools, request, host, title, apiKey, model = "jev-latest", signal, writeText = null }) {
  const { questions, plan } = buildQuestions(tools, request);
  const reply = await systemOne({ apiKey, model, state: buildState(request, { host, title }), questions, signal });
  const call = decode(plan, reply.answers);
  const helper =
    writeText && call.name && call.missing.length ? await fillMissing(call, plan, writeText, { request, host, title, signal }) : { ms: 0, tokens: { input: 0, output: 0 }, generated: [] };
  if (call.name) call.generated = helper.generated;
  return {
    call: call.name ? call : null,
    verdict: decide(call),
    confidence: call.confidence,
    inputTokens: reply.usage?.input_tokens ?? 0,
    ms: reply.ms,
    model: reply.model,
    plan,
    helperMs: helper.ms,
    helperTokens: helper.tokens,
    generated: helper.generated,
  };
}
