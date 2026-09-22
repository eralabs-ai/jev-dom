// What may happen to a decided step. WebMCP tools DECLARE their risk
// (readOnlyHint, consequentialHint); raw DOM controls do not, so a click whose
// label reads like a commitment is inferred to need the user's say-so.

export const THRESHOLDS = { act: 0.5 };

const COMMITS =
  /\b(place (?:the |my |your )?order|buy|pay|purchase|order now|checkout now|complete (?:order|purchase)|confirm (?:order|purchase|payment)|delete|send|transfer|book now|subscribe|unsubscribe|sign out|log ?out)\b/i;

export const looksConsequential = (target) => COMMITS.test(target?.name ?? "");

/**
 * @returns {"act" | "unsure" | "confirm" | "incomplete" | "done" | "none"}
 *   act         confident: run it
 *   unsure      below the confidence threshold: show it, let the user decide
 *   confirm     reads like a commitment (order, payment, delete, send): always ask
 *   incomplete  a field needs text the request does not contain
 *   done        the request is carried out
 *   none        nothing on the page fits, or the request is conversation
 */
export function decide(decision, { thresholds = THRESHOLDS } = {}) {
  if (decision.op === "NONE") return "none";
  if (decision.op === "DONE") return "done";
  if ((decision.op === "TYPE" || decision.op === "TYPE_SUBMIT") && decision.text == null) return "incomplete";
  if (decision.op === "CLICK" && looksConsequential(decision.target)) return "confirm";
  return decision.confidence >= thresholds.act ? "act" : "unsure";
}
