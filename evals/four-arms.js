// Four ways to operate the same site, on the same tasks, measured the same way:
//
//   jev-dom               this project: Jev reads the DOM, no WebMCP
//   jev-webmcp            jev-webmcp-extension's pipeline: Jev calls the site's tools
//   agent-browser         a general LLM agent with a real browser (ora run + `desktop`)
//   agent-browser-webmcp  the same agent with the browser AND the site's tools
//
// Every arm is timed FROM A LOADED PAGE: the Jev arms start their clock after
// the page settles, and the agent arms subtract everything up to and including
// their own first navigation step (pod, sidecar and harness start-up excluded too).
//
//   node --env-file=.env evals/four-arms.js --journey basketful
//   node --env-file=.env evals/four-arms.js --journey aloyoga --arms jev-dom,jev-webmcp
//   node --env-file=.env evals/four-arms.js --journey ./my-journey.json --repeats 2
//
// The agent arms need an ora experiments API (see README): ORA_API_URL + ORA_TOKEN,
// or ORA_EMAIL/ORA_PASSWORD against ORA_AUTH_URL for the dev login fallback.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { chromium } from "playwright";
import { decode as decodeCall } from "jev-webmcp/src/core/decode.js";
import { decide as decideCall } from "jev-webmcp/src/core/policy.js";
import { buildQuestions, buildState } from "jev-webmcp/src/core/questions.js";
import { systemOne } from "jev-webmcp/src/jev.js";
import { pageCallTool, pageListTools } from "jev-webmcp/src/platform/chrome.js";
import { runRequest } from "../src/agent.js";
import { createJev, PRICE_PER_INPUT_TOKEN } from "../src/jev.js";
import { playwrightPage } from "../src/page/playwright.js";
import { agentRun, ARMS as AGENT_ARMS, oraSession } from "./ora-agent.js";

const { values: opts } = parseArgs({
  options: {
    journey: { type: "string", default: "basketful" },
    arms: { type: "string", default: "agent-browser,agent-browser-webmcp,jev-dom,jev-webmcp" },
    repeats: { type: "string", default: "1" },
    only: { type: "string" },
    out: { type: "string" },
  },
});

const JEV_ARMS = ["jev-dom", "jev-webmcp"];
const journeyPath = opts.journey.includes("/") ? opts.journey : new URL(`./journeys/${opts.journey}.json`, import.meta.url).pathname;
const journey = JSON.parse(readFileSync(journeyPath, "utf8"));
const tasks = opts.only ? journey.tasks.filter((t) => opts.only.split(",").includes(t.id)) : journey.tasks;
const arms = opts.arms.split(",");
const repeats = Number(opts.repeats);
const apiKey = process.env.TYPESAFE_API_KEY;
const model = process.env.TYPESAFE_MODEL || "jev-latest";

const ms = (n) => `${Math.round(n).toLocaleString()} ms`;
const money = (n) => `$${n < 0.01 ? n.toFixed(4) : n.toFixed(2)}`;
const tok = (n) => (n >= 1000 ? `${(n / 1000).toFixed(0)}k` : String(Math.round(n)));
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0;
};

/** Did the arm reach what the task asked for? URL and stored state for the Jev arms, the reported answer for an agent. */
function judge(task, { url, storage, answer }) {
  if (task.expectStorage && storage !== undefined) {
    const { equals } = task.expectStorage;
    if (storage !== equals) return `stored ${JSON.stringify(storage)}, expected ${JSON.stringify(equals)}`;
  }
  if (url != null && task.expectUrl && !new RegExp(task.expectUrl, "i").test(url)) return `ended at ${url}`;
  if (answer != null && task.expectText && !new RegExp(task.expectText, "i").test(answer)) return `answer did not mention ${task.expectText}`;
  return null;
}

const readStorage = (page, expect) =>
  expect
    ? page.evaluate(({ key, path }) => {
        try {
          return path.split(".").reduce((value, part) => value?.[part], JSON.parse(localStorage.getItem(key) ?? "null"));
        } catch {
          return undefined;
        }
      }, expect)
    : Promise.resolve(undefined);

async function openSite(browser, url) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: "en-US" });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForLoadState("load").catch(() => {});
  return { context, page };
}

/** This project: Jev picks operations and targets straight off the DOM. */
async function runJevDom(browser, task) {
  const { context, page } = await openSite(browser, journey.site);
  try {
    const driver = playwrightPage(page);
    await driver.settle();
    await driver.settle();
    const run = await runRequest({ page: driver, ask: createJev({ apiKey, model }), request: task.request, maxSteps: 12, confirm: async () => true });
    const storage = await readStorage(page, task.expectStorage);
    return {
      ms: run.totalMs,
      cost: run.inputTokens * PRICE_PER_INPUT_TOKEN,
      tokens: run.inputTokens,
      steps: run.jevCalls,
      trail: run.steps.map((s) => (s.target ? `${s.op} "${s.target.name}"` : s.op)).join(" → "),
      failure: judge(task, { url: page.url(), storage }),
    };
  } finally {
    await context.close();
  }
}

/** jev-webmcp-extension's pipeline, unchanged: one request, then the predicted tool call. */
async function runJevWebmcp(browser, task) {
  const { context, page } = await openSite(browser, journey.site);
  try {
    let tools = [];
    for (let attempt = 0; attempt < 50 && !tools.length; attempt++) {
      tools = (await page.evaluate(pageListTools)).tools;
      if (!tools.length) await page.waitForTimeout(200);
    }
    if (!tools.length) throw new Error("the site registered no WebMCP tools (is this Chromium started with --enable-features=WebMCPTesting?)");

    const began = performance.now();
    const { questions, plan } = buildQuestions(tools, task.request);
    const reply = await systemOne({ apiKey, model, state: buildState(task.request, { host: new URL(page.url()).host, title: await page.title() }), questions });
    const call = decodeCall(plan, reply.answers);
    const verdict = decideCall(call);
    let answer = null;
    if (call.name && !["none", "incomplete"].includes(verdict)) {
      const result = await page.evaluate(`(${pageCallTool})(${JSON.stringify(call.name)}, ${JSON.stringify(JSON.stringify(call.args))})`);
      answer = result.ok ? String(result.result) : `error: ${result.error}`;
      await playwrightPage(page).settle();
    }
    const tokens = reply.usage?.input_tokens ?? 0;
    const storage = await readStorage(page, task.expectStorage);
    // The panel shows the tool's own text, so an answer task is satisfied by either.
    const failure = judge(task, { url: page.url(), storage }) && judge(task, { answer });
    return { ms: performance.now() - began, cost: tokens * PRICE_PER_INPUT_TOKEN, tokens, steps: 1, trail: `${call.name ?? "(no tool)"} [${verdict}]`, failure };
  } finally {
    await context.close();
  }
}

// ---- run everything
const rows = [];
const browsers = {};
const need = (kind) =>
  (browsers[kind] ??= chromium.launch({ channel: "chromium", args: kind === "webmcp" ? ["--enable-features=WebMCPTesting"] : [] }));
const ora = arms.some((a) => a in AGENT_ARMS) ? await oraSession() : null;

try {
  for (const task of tasks) {
    console.log(`\n${task.id}  "${task.request}"`);
    for (let repeat = 0; repeat < repeats; repeat++) {
      for (const arm of arms) {
        let result;
        try {
          if (arm === "jev-dom") result = await runJevDom(await need("plain"), task);
          else if (arm === "jev-webmcp") result = await runJevWebmcp(await need("webmcp"), task);
          else if (arm in AGENT_ARMS) {
            if (!ora) throw new Error("no ora session: set ORA_TOKEN or ORA_EMAIL/ORA_PASSWORD");
            result = await agentRun({ ora, arm, task, site: journey.site, judge });
          } else throw new Error(`unknown arm "${arm}"`);
        } catch (error) {
          result = { error: error.message.split("\n")[0] };
        }
        rows.push({ task: task.id, arm, repeat, ...result });
        const head = `  ${arm.padEnd(21)} ${result.error ? "ERROR" : result.failure ? "FAIL " : "PASS "}`;
        console.log(result.error ? `${head} ${result.error}` : `${head} ${ms(result.ms)}  ${money(result.cost)}  ${tok(result.tokens)} tok  ${result.steps} ${JEV_ARMS.includes(arm) ? "calls" : "turns"}   ${result.trail ?? ""}`.trimEnd());
        if (result.failure) console.log(`${" ".repeat(28)}↳ ${result.failure}`);
      }
    }
  }
} finally {
  await Promise.all(Object.values(browsers).map(async (b) => (await b).close()));
}

// ---- the table
const label = { "agent-browser": "Claude (browser use)", "agent-browser-webmcp": "Claude (browser use) + WebMCP", "jev-dom": "Jev on DOM", "jev-webmcp": "Jev + WebMCP" };
const columns = arms.map((arm) => {
  const done = rows.filter((r) => r.arm === arm && !r.error);
  return {
    arm,
    label: label[arm] ?? arm,
    passed: `${done.filter((r) => !r.failure).length}/${rows.filter((r) => r.arm === arm).length}`,
    avgMs: avg(done.map((r) => r.ms)),
    medianMs: median(done.map((r) => r.ms)),
    avgCost: avg(done.map((r) => r.cost)),
    lo: Math.min(...done.map((r) => r.cost), Infinity),
    hi: Math.max(...done.map((r) => r.cost), 0),
    avgTokens: avg(done.map((r) => r.tokens)),
    avgSteps: avg(done.map((r) => r.steps)),
  };
});
const line = (name, cells) => console.log(`| ${name.padEnd(26)} | ${cells.map((c) => String(c).padStart(28)).join(" | ")} |`);
console.log(`\n${journey.name} — ${tasks.length} tasks${repeats > 1 ? ` × ${repeats} repeats` : ""}, timed from a loaded page\n`);
line("", columns.map((c) => c.label));
line("---", columns.map(() => "---"));
line("Avg time", columns.map((c) => ms(c.avgMs)));
line("Median time", columns.map((c) => ms(c.medianMs)));
line("Avg cost per task", columns.map((c) => money(c.avgCost)));
line("Cost range", columns.map((c) => `${money(c.lo)} – ${money(c.hi)}`));
line("Avg tokens", columns.map((c) => tok(c.avgTokens)));
line("Avg turns / calls", columns.map((c) => c.avgSteps.toFixed(1)));
line("Correct", columns.map((c) => c.passed));

const out = opts.out ?? `runs/four-arms-${opts.journey.replace(/[^\w-]/g, "_")}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
mkdirSync(out.replace(/\/[^/]+$/, ""), { recursive: true });
writeFileSync(out, JSON.stringify({ journey: journey.name, site: journey.site, arms, repeats, rows, columns }, null, 2));
console.log(`\nfull results: ${out}`);
