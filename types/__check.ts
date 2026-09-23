// A consumer sample: imports every published subpath the way an app would, so
// `npm run typecheck` fails if an entry point, a name or a shape goes missing.
// Nothing here runs.
import { EARLY, fingerprint, runRequest, STABLE, STOPS } from "jev-dom/agent";
import type { RunResult, StepRecord, TextWriter } from "jev-dom/agent";
import { checkKey, createJev, JevError, PRICE_PER_INPUT_TOKEN } from "jev-dom/jev";
import { actionSpace, describe, OPERATIONS, TARGETED } from "jev-dom/core/actions";
import { decode, InvalidAnswer } from "jev-dom/core/decode";
import type { Decision } from "jev-dom/core/decode";
import { fillable } from "jev-dom/core/identity";
import { decide, looksConsequential, THRESHOLDS } from "jev-dom/core/policy";
import { buildStep, MAX_OPTIONS, NOT_STATED, RULES, TARGET_QID } from "jev-dom/core/questions";
import { numbers, spans, tokenize } from "jev-dom/core/spans";
import { playwrightPage, StaleTarget } from "jev-dom/page/playwright";
import { snapshotPage } from "jev-dom/page/snapshot";
import { performInPage, waitForQuiet } from "jev-dom/page/perform";
import { chooseTool, pageCallTool, pageListTools } from "jev-dom/webmcp";
import type { Snapshot } from "jev-dom/page/snapshot";

declare const someSnapshot: Snapshot;
/** Stands in for a Playwright `Page`, which this package does not depend on. */
declare const somePage: { url(): string; title(): Promise<string> };

const helper: TextWriter = async ({ request, field, page, history }, { signal }) => {
  void [request, field.name, field.kind, page.url, history.length, signal?.aborted];
  return fillable(field).ok ? { text: "running shoes", ms: 400, inputTokens: 300, outputTokens: 8, model: "small" } : { text: null };
};

async function driveThePage(apiKey: string, request: string): Promise<RunResult> {
  const driver = playwrightPage(somePage);
  const stillAPage: string = driver.page.url();
  void stillAPage;
  await driver.settle();

  const steps: StepRecord[] = [];
  const run = await runRequest({
    page: driver,
    ask: createJev({ apiKey, model: "jev-latest" }),
    request,
    maxSteps: 12,
    finishEarly: true,
    thresholds: THRESHOLDS,
    confirm: async (decision: Decision, why: "confirm" | "unsure") => why === "unsure" && decision.confidence > 0.3,
    onStep: (record) => void steps.push(record),
    writeText: helper,
  });
  const spent: number = run.inputTokens * PRICE_PER_INPUT_TOKEN;
  void [spent, run.helperMs, run.helperTokens.input, run.steps[0]?.textSource, run.steps[0]?.helperMs];
  void run.steps[0]?.target?.name;
  void STOPS.done;
  void STABLE.budgetMs;
  void EARLY.singleStep;
  void fingerprint(someSnapshot);
  return run;
}

async function chooseAWebmcpTool(apiKey: string, request: string) {
  const { tools } = await pageListTools();
  const { call, verdict, confidence, inputTokens, ms, model, plan, helperMs, helperTokens, generated } = await chooseTool({
    tools,
    request,
    host: new URL(somePage.url()).host,
    title: await somePage.title(),
    apiKey,
    writeText: helper,
  });
  void [verdict, confidence, inputTokens, ms, model, plan, helperMs, helperTokens.output, generated.length];
  if (!call) return null;
  void call.tool.annotations?.consequentialHint;
  void [call.missing.length, call.generated?.length];
  return pageCallTool(call.name, JSON.stringify(call.args));
}

function readThePage() {
  const space = actionSpace(someSnapshot, { maxTextFields: 6 });
  const built = buildStep({ request: "add oat milk", snapshot: someSnapshot, space, history: [] });
  const decision = decode(built.plan, {});
  const verdict = decide(decision, { thresholds: { act: 0.5 } });
  void [describe(space.elements[0]), OPERATIONS.CLICK, TARGETED.CLICK, verdict];
  void [looksConsequential(decision.target), MAX_OPTIONS, NOT_STATED, RULES.length, TARGET_QID.CLICK];
  void [tokenize("two cartons"), spans("two cartons"), numbers("two cartons")[0]?.value];
  return decision;
}

function inPageOnly() {
  void snapshotPage({ maxElements: 240 });
  void performInPage({ op: "CLICK", id: 1 });
  void waitForQuiet({ quietMs: 60, capMs: 1500 });
}

function errorsAreClasses(error: unknown) {
  return error instanceof JevError || error instanceof InvalidAnswer || error instanceof StaleTarget;
}

void [driveThePage, chooseAWebmcpTool, readThePage, inPageOnly, errorsAreClasses, checkKey];
