// The WebMCP half of the comparison, as one function. jev-webmcp-extension's
// pipeline is unchanged — its questions, its decode, its policy — so a consumer
// gets the same prediction the extension would make without importing any of
// its internals: tool schemas in, one Jev request, one predicted call out.
//
// The call is NOT executed here: the page bridge belongs to the caller, which
// may be Playwright, `chrome.scripting`, or navigator.modelContext directly.
import { decode } from "jev-webmcp/src/core/decode.js";
import { decide } from "jev-webmcp/src/core/policy.js";
import { buildQuestions, buildState } from "jev-webmcp/src/core/questions.js";
import { systemOne } from "jev-webmcp/src/jev.js";

// In-page bridges, for a caller that drives navigator.modelContext itself.
export { pageCallTool, pageListTools } from "jev-webmcp/src/platform/chrome.js";

/**
 * One request: which of the page's WebMCP tools carries out `request`, with what arguments.
 *
 * @param tools   the tool schemas the page registered (see pageListTools)
 * @param request the user's own words
 * @param host    the page's host, and `title` its title: the page context Jev reads
 * @returns `call` is null when no tool fits; `ms` is the Jev request's own latency.
 */
export async function chooseTool({ tools, request, host, title, apiKey, model = "jev-latest", signal }) {
  const { questions, plan } = buildQuestions(tools, request);
  const reply = await systemOne({ apiKey, model, state: buildState(request, { host, title }), questions, signal });
  const call = decode(plan, reply.answers);
  return {
    call: call.name ? call : null,
    verdict: decide(call),
    confidence: call.confidence,
    inputTokens: reply.usage?.input_tokens ?? 0,
    ms: reply.ms,
    model: reply.model,
    plan,
  };
}
