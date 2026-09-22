// Runs one case three ways from the same seeded start:
//   reference  the expected WebMCP call, executed directly (ground truth)
//   webmcp     jev-webmcp-extension's pipeline, UNCHANGED: its questions,
//              decode, policy and page bridge, then the predicted call executed
//   dom        this project's agent: no WebMCP, only the page's own controls
import { decode as decodeCall } from "jev-webmcp/src/core/decode.js";
import { decide as decideCall } from "jev-webmcp/src/core/policy.js";
import { buildQuestions, buildState } from "jev-webmcp/src/core/questions.js";
import { systemOne } from "jev-webmcp/src/jev.js";
import { pageCallTool, pageListTools } from "jev-webmcp/src/platform/chrome.js";
import { chromium } from "playwright";
import { runRequest } from "../src/agent.js";
import { playwrightPage } from "../src/page/playwright.js";
import { acceptsCommitment, CLOCK, captureOutcome, SITE, STORAGE_KEY } from "./basketful.js";
import { llmDom, llmWebmcp } from "./llm.js";

export async function launchBrowsers() {
  const base = { channel: "chromium" };
  const [webmcp, plain] = await Promise.all([
    chromium.launch({ ...base, args: ["--enable-features=WebMCPTesting"] }),
    chromium.launch(base),
  ]);
  return { webmcp, plain, close: () => Promise.all([webmcp.close(), plain.close()]) };
}

async function newPage(browser, seed, { video } = {}) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 860 },
    timezoneId: CLOCK.timezoneId,
    locale: "en-US",
    ...(video ? { recordVideo: { dir: video, size: { width: 1280, height: 860 } } } : {}),
  });
  await context.clock.setFixedTime(new Date(CLOCK.time));
  // Seed the app's storage before its scripts run, once per tab (not on reloads).
  await context.addInitScript(
    ([key, value]) => {
      if (sessionStorage.getItem("__jevSeeded")) return;
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
      sessionStorage.setItem("__jevSeeded", "1");
    },
    [STORAGE_KEY, seed ?? null],
  );
  const page = await context.newPage();
  return { page, context };
}

const capture = (page) => page.evaluate(captureOutcome, STORAGE_KEY);
const listTools = (page) => page.evaluate(pageListTools);

async function waitForTools(page, name, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const listed = await listTools(page).catch(() => ({ tools: [] }));
    if (listed.tools.length && (!name || listed.tools.some((t) => t.name === name))) return listed.tools;
    if (Date.now() > deadline) throw new Error(`WebMCP tool ${name ?? "(any)"} never registered: ${listed.api ?? "no WebMCP API"} ${listed.error ?? ""}`);
    await page.waitForTimeout(100);
  }
}

async function callTool(page, name, args) {
  await waitForTools(page, name);
  const expression = `(${pageCallTool})(${JSON.stringify(name)}, ${JSON.stringify(JSON.stringify(args))})`;
  const outcome = await page.evaluate(expression);
  await playwrightPage(page).settle();
  return outcome;
}

async function open(page, path) {
  await page.goto(SITE + path, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#main, main", { timeout: 15_000 });
  await playwrightPage(page).settle();
}

/** Run the case's setup through the site's own tools and keep the resulting storage as the seed. */
export async function buildSeed(browsers, kase) {
  const { page, context } = await newPage(browsers.webmcp, null);
  try {
    await open(page, "/");
    for (const step of kase.setup) {
      if (step.patch) {
        const state = JSON.parse(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY));
        await page.evaluate(([key, value]) => localStorage.setItem(key, value), [STORAGE_KEY, JSON.stringify(step.patch(state))]);
        await page.reload({ waitUntil: "domcontentloaded" });
        await playwrightPage(page).settle();
        continue;
      }
      const [name, args] = step;
      const result = await callTool(page, name, args);
      if (!result.ok) throw new Error(`setup ${name} failed: ${result.error}`);
    }
    return await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
  } finally {
    await context.close();
  }
}

export async function runReference(browsers, kase, seed) {
  const { page, context } = await newPage(browsers.webmcp, seed);
  try {
    await open(page, kase.start);
    const start = await capture(page);
    let result = null;
    if (kase.expected) {
      result = await callTool(page, ...kase.expected);
      if (!result.ok) throw new Error(`reference ${kase.expected[0]} failed: ${result.error}`);
    }
    return { start, outcome: await capture(page), result: result?.result ?? null };
  } finally {
    await context.close();
  }
}

export async function runWebmcpArm(browsers, kase, seed, { apiKey, model }) {
  const { page, context } = await newPage(browsers.webmcp, seed);
  try {
    await open(page, kase.start);
    // The extension lists tools when the panel opens, not per keystroke: not timed.
    const tools = await waitForTools(page);
    const start = await capture(page);
    const host = new URL(page.url()).host;
    const title = await page.title();

    const began = performance.now();
    const { questions, plan } = buildQuestions(tools, kase.said);
    const reply = await systemOne({ apiKey, model, state: buildState(kase.said, { host, title }), questions });
    const call = decodeCall(plan, reply.answers);
    let verdict = decideCall(call);
    let result = null;
    let toolMs = 0;
    // The panel asks for Enter (twice for a consequential tool). The simulated
    // user presses it, except for a commitment their request did not ask for.
    const hints = call.tool?.annotations ?? {};
    if ((hints.consequentialHint || hints.destructiveHint) && !acceptsCommitment(kase)) verdict = "declined";
    if (call.name && !["none", "incomplete", "declined"].includes(verdict)) {
      const t = performance.now();
      result = await callTool(page, call.name, call.args);
      toolMs = Math.round(performance.now() - t);
    }
    return {
      start,
      outcome: await capture(page),
      totalMs: Math.round(performance.now() - began),
      jevMs: Math.round(reply.ms),
      toolMs,
      jevCalls: 1,
      inputTokens: reply.usage?.input_tokens ?? 0,
      call: { name: call.name, args: call.args, confidence: call.confidence, missing: call.missing },
      verdict,
      evidence: { result: result?.ok ? result.result : (result?.error ?? null), acted: result ? `called ${call.name}` : null },
    };
  } finally {
    await context.close();
  }
}

export async function runDomArm(browsers, kase, seed, { ask, video, onStep, finishEarly = false, input = "trusted" }) {
  const { page, context } = await newPage(browsers.plain, seed, { video });
  const recording = page.video();
  try {
    await open(page, kase.start);
    const start = await capture(page);
    // Same simulated user as the webmcp arm: shaky steps are accepted (the panel's
    // Enter), a commitment only when the request asked for one.
    const confirm = async (_decision, why) => (why === "confirm" ? acceptsCommitment(kase) : true);
    const quietMs = Number(process.env.JEV_QUIET_MS) || undefined;
    const run = await runRequest({ page: playwrightPage(page, { input, quietMs }), ask, request: kase.said, confirm, onStep, finishEarly });
    await page.waitForTimeout(video ? 600 : 0); // let the recording show the final state
    const executed = run.steps.filter((s) => s.actMs != null);
    const acted = executed.length ? executed.map((s) => `${s.op} "${s.target?.name ?? ""}"`).join(", ") : null;
    return { start, outcome: await capture(page), ...run, evidence: { acted } };
  } finally {
    await context.close();
    if (recording) {
      await recording.saveAs(`${video}/${kase.id}.webm`).catch(() => {});
      await recording.delete().catch(() => {});
    }
  }
}

/** A general LLM agent holding the site's WebMCP tools. */
export async function runLlmWebmcpArm(browsers, kase, seed, { client }) {
  const { page, context } = await newPage(browsers.webmcp, seed);
  try {
    await open(page, kase.start);
    const tools = await waitForTools(page);
    const start = await capture(page);
    const run = await llmWebmcp({
      client,
      kase,
      tools,
      commits: acceptsCommitment(kase),
      callTool: (name, args) => callTool(page, name, args),
    });
    return { start, outcome: await capture(page), ...run };
  } finally {
    await context.close();
  }
}

/** The same LLM agent with no WebMCP: the element table this project builds. */
export async function runLlmDomArm(browsers, kase, seed, { client }) {
  const { page, context } = await newPage(browsers.plain, seed);
  try {
    await open(page, kase.start);
    const start = await capture(page);
    const run = await llmDom({ client, kase, page: playwrightPage(page), commits: acceptsCommitment(kase) });
    return { start, outcome: await capture(page), ...run };
  } finally {
    await context.close();
  }
}
