// Type requests at a real page and watch Jev drive it through the DOM.
//
//   npm run try -- "throw in two cartons of oat milk" "what's in my cart?"
//   npm run try                                  # interactive: one request per line
//   npm run try -- --url https://example.com --shots --verbose "..."
//
// The browser is plain headless Chromium: no WebMCP, no site-specific code.
import { mkdirSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { chromium } from "playwright";
import { runRequest } from "../src/agent.js";
import { createJev, PRICE_PER_INPUT_TOKEN } from "../src/jev.js";
import { playwrightPage } from "../src/page/playwright.js";

const { values: opts, positionals: requests } = parseArgs({
  allowPositionals: true,
  options: {
    url: { type: "string", default: "https://shopping-webmcp-demo.netlify.app/store/greenleaf" },
    yes: { type: "boolean", short: "y", default: false },
    shots: { type: "boolean", default: false },
    video: { type: "boolean", default: false },
    dump: { type: "boolean", default: false },
    verbose: { type: "boolean", short: "v", default: false },
    steps: { type: "string", default: "8" },
    quiet: { type: "string", default: "60" },   // ms of DOM silence that counts as settled
    cap: { type: "string", default: "1500" },   // ms to wait for that silence
    "action-timeout": { type: "string", default: "2500" },
  },
});

const ask = createJev({ apiKey: process.env.TYPESAFE_API_KEY, model: process.env.TYPESAFE_MODEL || "jev-latest" });
const out = `runs/try-${new Date().toISOString().replace(/[:.]/g, "-")}`;
if (opts.shots || opts.video || opts.dump) mkdirSync(out, { recursive: true });

const pct = (p) => `${Math.round((p ?? 0) * 100)}%`.padStart(4);
const describe = (s) =>
  s.op === "DONE" || s.op === "NONE"
    ? s.op
    : `${s.op} ${s.target ? `${s.target.role} "${s.target.name}"${s.target.option ? ` → "${s.target.option}"` : ""}` : ""}${s.text != null ? ` ← "${s.text}"` : ""}`;

const tty = process.stdin.isTTY;
const rl = createInterface({ input: process.stdin, output: process.stdout });
async function confirm(decision, why) {
  if (opts.yes) return true;
  if (!tty) return false;
  const reason = why === "confirm" ? "this looks like a commitment" : `only ${pct(decision.confidence).trim()} sure`;
  const answer = await rl.question(`     ? ${reason}. Run it? [y/N] `);
  return /^y/i.test(answer.trim());
}

const browser = await chromium.launch({ channel: "chromium" });
const context = await browser.newContext({
  viewport: { width: 1280, height: 860 },
  ...(opts.video ? { recordVideo: { dir: out, size: { width: 1280, height: 860 } } } : {}),
});
const tab = await context.newPage();
await tab.goto(opts.url, { waitUntil: "domcontentloaded" });
// A heavy site keeps rendering after DOMContentLoaded; read it once it has settled.
await tab.waitForLoadState("load").catch(() => {});
const page = playwrightPage(tab, { quietMs: Number(opts.quiet), capMs: Number(opts.cap), actionTimeoutMs: Number(opts["action-timeout"]) });
await page.settle();
await page.settle();
console.log(`page: ${tab.url()}  (plain Chromium, no WebMCP)`);

let n = 0;
async function handle(request) {
  n++;
  console.log(`\n› ${request}`);
  const result = await runRequest({
    page,
    ask,
    request,
    maxSteps: Number(opts.steps),
    confirm,
    onStep: async (s, { built, reply }) => {
      const tail = `${pct(s.confidence)}  ${String(s.jevMs).padStart(4)} ms  ${s.elements} elements`;
      console.log(`  ${String(s.step).padStart(2)} ${describe(s).padEnd(64)} ${tail}`);
      if (opts.verbose) {
        const top = Object.entries(reply.answers.operation.probabilities).sort((a, b) => b[1] - a[1]).slice(0, 3);
        console.log(`       operation: ${top.map(([k, p]) => `${k} ${pct(p).trim()}`).join(", ")}`);
      }
      if (opts.dump) writeFileSync(`${out}/${n}-${s.step}.json`, JSON.stringify({ request: built.state, questions: built.questions, answers: reply.answers, usage: reply.usage }, null, 2));
    },
  });
  for (const s of result.steps) if (s.error) console.log(`     ! step ${s.step}: ${s.error}`);
  const cost = (result.inputTokens * PRICE_PER_INPUT_TOKEN).toFixed(5);
  const effect = result.effectMs != null ? ` (last change at ${(result.effectMs / 1000).toFixed(2)} s)` : "";
  console.log(`  ${result.status === "done" ? "✔" : "■"} ${result.status}${result.reason ? `: ${result.reason}` : ""} · ${(result.totalMs / 1000).toFixed(2)} s${effect} · ${result.jevCalls} Jev calls · ${(result.inputTokens / 1000).toFixed(1)}k input tokens ≈ $${cost}`);
  console.log(`  now at ${tab.url()}`);
  if (opts.shots) {
    await tab.screenshot({ path: `${out}/${n}.png` });
    console.log(`  screenshot: ${out}/${n}.png`);
  }
}

try {
  if (requests.length) for (const request of requests) await handle(request);
  else {
    console.log("Type a request (empty line to quit).");
    for (;;) {
      const request = (await rl.question("\n> ")).trim();
      if (!request) break;
      await handle(request);
    }
  }
} finally {
  rl.close();
  await context.close();
  await browser.close();
  if (opts.shots || opts.video || opts.dump) console.log(`\nsaved to ${out}/`);
}
