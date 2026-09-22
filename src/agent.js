// The loop for one request: observe -> one Jev request -> decide -> act,
// until Jev says DONE (or NONE), a field needs text the user did not give,
// the user declines a step, the page stops responding, or the budget runs out.
// Browser-agnostic: `page` is anything with observe() and act().
import { actionSpace } from "./core/actions.js";
import { decode } from "./core/decode.js";
import { decide } from "./core/policy.js";
import { buildStep } from "./core/questions.js";

export const STOPS = { done: "done", none: "none", incomplete: "incomplete" };

// What the page looks like to a person: address, dialog, text, and each control's label, value and state.
export function fingerprint(snapshot) {
  return JSON.stringify([
    snapshot.url,
    snapshot.modal,
    snapshot.text,
    snapshot.elements.map((e) => [e.id, e.name, e.value ?? null, e.state ?? null]),
  ]);
}

const brief = (el) => (el ? { id: el.id, index: el.index, role: el.role, name: el.name, context: el.context, option: el.option?.label } : null);

// A click on a heavy site starts a render the page has not finished. Reading it
// then yields a handful of controls and the next step acts on a page that does
// not exist yet, so read again until two reads agree, or the budget runs out.
export const STABLE = { budgetMs: 8000, pauseMs: 250, shrink: 0.6 };

async function readWhenStable(page, previous) {
  const deadline = Date.now() + STABLE.budgetMs;
  let snapshot = await page.observe();
  let attempt = 0;
  while (Date.now() < deadline) {
    const count = snapshot.elements.length;
    // Nothing to act on at all, or far less than a moment ago: still rendering.
    const settling =
      count === 0 ||
      count < Math.round((previous?.elements.length ?? 0) * STABLE.shrink) ||
      (attempt > 0 && count !== previous?.elements.length);
    if (process.env.JEV_DEBUG_READS) console.error(`      [read ${attempt}] elements=${count} url=${snapshot.url.slice(28, 60)} text=${snapshot.text.length}`);
    if (!settling) break;
    previous = snapshot;
    attempt++;
    await page.settle?.();
    await new Promise((resolve) => setTimeout(resolve, STABLE.pauseMs));
    snapshot = await page.observe();
  }
  return snapshot;
}

// `finishEarly`: when Jev judged (in the same request) that one action completes the
// request, and that action visibly changed the page, stop without asking again.
export const EARLY = { singleStep: 0.85, ops: ["CLICK", "SELECT", "TYPE_SUBMIT"] };

export async function runRequest({ page, ask, request, maxSteps = 8, thresholds, finishEarly = false, signal, confirm = async () => true, onStep = () => {} }) {
  const started = performance.now();
  const clock = () => Math.round(performance.now() - started);
  const history = [];
  const steps = [];
  let effectMs = null; // when the last action that changed the page finished
  let snapshot = await page.observe();
  let before = fingerprint(snapshot);

  const finish = (status, reason) => ({
    request,
    status,
    reason,
    steps,
    totalMs: clock(),
    effectMs,
    jevCalls: steps.length,
    jevMs: Math.round(steps.reduce((sum, s) => sum + s.jevMs, 0)),
    inputTokens: steps.reduce((sum, s) => sum + (s.inputTokens ?? 0), 0),
  });

  for (let step = 1; step <= maxSteps; step++) {
    if (signal?.aborted) return finish("stopped", "stopped by the user");
    const space = actionSpace(snapshot);
    const built = buildStep({ request, snapshot, space, history });
    const reply = await ask({ state: built.state, questions: built.questions, signal });
    const decision = decode(built.plan, reply.answers);
    const verdict = decide(decision, { thresholds });
    const record = {
      step,
      op: decision.op,
      target: brief(decision.target),
      text: decision.text,
      confidence: decision.confidence,
      verdict,
      jevMs: Math.round(reply.ms),
      inputTokens: reply.usage.input_tokens,
      model: reply.model,
      elements: space.elements.length,
      questions: Object.keys(built.questions).length,
      singleStep: decision.singleStep,
    };
    steps.push(record);
    await onStep(record, { decision, built, reply });

    if (verdict in STOPS) return finish(STOPS[verdict]);
    if (verdict === "confirm" || verdict === "unsure") {
      record.asked = verdict;
      if (!(await confirm(decision, verdict))) return finish("declined");
    }
    if (signal?.aborted) return finish("stopped", "stopped by the user");

    const acting = performance.now();
    try {
      await page.act(decision);
    } catch (error) {
      record.error = error.message.split("\n")[0];
    }
    record.actMs = Math.round(performance.now() - acting);
    const acted = snapshot;
    snapshot = await readWhenStable(page, acted);
    const after = fingerprint(snapshot);
    record.changed = after !== before;
    before = after;
    if (record.changed) effectMs = clock();
    history.push({ step, op: decision.op, target: decision.target, text: decision.text, changed: record.changed });

    const oneAndDone = step === 1 && verdict === "act" && record.changed && !record.error && EARLY.ops.includes(decision.op);
    if (finishEarly && oneAndDone && decision.singleStep >= EARLY.singleStep) return finish("done", "one step was enough");

    // Two steps in a row that changed nothing: the page is not responding to us.
    if (history.length >= 2 && history.slice(-2).every((h) => !h.changed)) return finish("stuck", "two steps changed nothing");
  }
  return finish("budget", `stopped after ${maxSteps} steps`);
}
