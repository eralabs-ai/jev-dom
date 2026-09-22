// Same sentences, same site, same starting state: WebMCP + Jev vs DOM + Jev,
// each judged by the outcome it produced on the live page.
//
//   node --env-file=.env evals/run.js [--arm webmcp,dom,dom-fast] [--only id,id] [--repeat 3] [--video] [--verbose]
//   dom-fast = the DOM agent with finishEarly (no DONE round trip after a one-step request)
//   dom-ext  = dom-fast with the extension's synthetic-event executor instead of Playwright input
//   llm-webmcp / llm-dom = a general LLM agent (LLM_MODEL, default claude-opus-5) with the
//   site's WebMCP tools, or with the same DOM element table Jev reads
import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { createJev, PRICE_PER_INPUT_TOKEN } from "../src/jev.js";
import { CASES, judge } from "./basketful.js";
import { buildSeed, launchBrowsers, runDomArm, runLlmDomArm, runLlmWebmcpArm, runReference, runWebmcpArm } from "./harness.js";
import { costOf, createClaude, MODEL } from "./llm.js";

const { values: opts } = parseArgs({
  options: {
    arm: { type: "string", default: "webmcp,dom" },
    only: { type: "string" },
    repeat: { type: "string", default: "1" },
    video: { type: "boolean", default: false },
    verbose: { type: "boolean", short: "v", default: false },
  },
});
const apiKey = process.env.TYPESAFE_API_KEY;
const model = process.env.TYPESAFE_MODEL || "jev-latest";
if (!apiKey) {
  console.error("Set TYPESAFE_API_KEY in .env (console.typesafe.ai/keys).");
  process.exit(1);
}
const arms = opts.arm.split(",");
const repeat = Number(opts.repeat);
const cases = opts.only ? CASES.filter((k) => opts.only.split(",").includes(k.id)) : CASES;
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const videoDir = opts.video ? `runs/video-${stamp}` : null;
if (videoDir) mkdirSync(videoDir, { recursive: true });

const ask = createJev({ apiKey, model });
let claudeClient = null;
const claude = () => (claudeClient ??= createClaude());
const pct = (p) => `${Math.round((p ?? 0) * 100)}%`;
const ms = (n) => `${Math.round(n).toLocaleString()} ms`;
const tok = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0;
};
const formatCall = (call) => (call?.name ? `${call.name}(${JSON.stringify(call.args).replace(/"([A-Za-z_$][\w$]*)":/g, "$1:")})` : "(no tool)");
const stepText = (s) =>
  s.op === "DONE" || s.op === "NONE" ? s.op : `${s.op} ${s.target ? `${s.target.role} "${s.target.name}"${s.target.option ? ` → ${s.target.option}` : ""}` : ""}${s.text != null ? ` ← "${s.text}"` : ""}`;

const llmStep = (t) => (t.op === "STOP" ? "STOP" : `${t.op}${t.input?.index != null ? ` [${t.input.index}]` : ""}${t.input?.text ? ` ←"${t.input.text}"` : ""}${t.input && !t.input.index && Object.keys(t.input).length ? `(${JSON.stringify(t.input).slice(0, 44)})` : ""}`);

function line(arm, result) {
  const mark = result.error ? "ERROR" : result.failure ? "FAIL " : "PASS ";
  if (result.error) return `  ${arm.padEnd(10)} ${mark} ${result.error}`;
  if (arm.startsWith("llm")) {
    return `  ${arm.padEnd(10)} ${mark} ${result.trail.map(llmStep).join("  →  ")}   ${ms(result.totalMs)}   ${result.modelCalls} calls  ${tok(result.inputTokens)}/${tok(result.outputTokens)} tok  $${costOf(result).toFixed(4)}`;
  }
  if (arm === "webmcp") {
    return `  webmcp ${mark} ${formatCall(result.call)}  ${pct(result.call.confidence)} → ${result.verdict}   ${ms(result.totalMs)} (jev ${result.jevMs}, tool ${result.toolMs})   1 call  ${tok(result.inputTokens)} tok`;
  }
  const path = result.steps.map(stepText).join("  →  ");
  return `  ${arm.padEnd(6)} ${mark} ${path}   [${result.status}]   ${ms(result.totalMs)}${result.effectMs != null ? ` (effect at ${result.effectMs})` : ""}   ${result.jevCalls} calls  ${tok(result.inputTokens)} tok`;
}

const browsers = await launchBrowsers();
const report = { stamp, model, repeat, cases: [] };
try {
  for (const kase of cases) {
    console.log(`\n${kase.id}  "${kase.said}"`);
    const entry = { id: kase.id, said: kase.said, expected: kase.expected, runs: Object.fromEntries(arms.map((a) => [a, []])) };
    report.cases.push(entry);
    let seed;
    let reference;
    try {
      seed = await buildSeed(browsers, kase);
      reference = await runReference(browsers, kase, seed);
      entry.reference = reference.outcome;
    } catch (error) {
      console.log(`  reference ERROR ${error.message}`);
      continue;
    }
    for (let r = 0; r < repeat; r++) {
      for (const arm of arms) {
        let result;
        try {
          result =
            arm === "webmcp"
              ? await runWebmcpArm(browsers, kase, seed, { apiKey, model })
              : arm === "llm-webmcp"
              ? await runLlmWebmcpArm(browsers, kase, seed, { client: claude() })
              : arm === "llm-dom"
              ? await runLlmDomArm(browsers, kase, seed, { client: claude() })
              : await runDomArm(browsers, kase, seed, {
                  ask,
                  finishEarly: arm === "dom-fast" || arm === "dom-ext",
                  input: arm === "dom-ext" ? "synthetic" : "trusted",
                  video: r === 0 && arm === arms.find((a) => a !== "webmcp") ? videoDir : null,
                  onStep: opts.verbose ? (s) => console.log(`      · ${stepText(s)}  ${pct(s.confidence)} ${s.verdict}  ${s.jevMs} ms  ${tok(s.inputTokens)} tok`) : undefined,
                });
          result.failure = judge(kase, result.outcome, reference.outcome, result.start, result.evidence);
        } catch (error) {
          result = { error: error.message.split("\n")[0] };
        }
        entry.runs[arm].push(result);
        console.log(line(arm, result));
        if (result.failure) console.log(`         ↳ ${result.failure}`);
      }
    }
  }
} finally {
  await browsers.close();
}

// ---- summary
console.log("\n" + "─".repeat(78));
for (const arm of arms) {
  const runs = report.cases.flatMap((c) => c.runs[arm]);
  const done = runs.filter((r) => !r.error);
  const passed = done.filter((r) => !r.failure).length;
  const tokens = done.reduce((s, r) => s + (r.inputTokens ?? 0), 0);
  const llm = arm.startsWith("llm");
  const line1 = `${arm.padEnd(10)} ${passed}/${runs.length} outcomes correct`;
  const line2 = `median ${ms(median(done.map((r) => r.totalMs)))} per request, ${median(done.map((r) => (llm ? r.modelCalls : r.jevCalls)))} model calls, ${tok(median(done.map((r) => r.inputTokens ?? 0)))} input tokens`;
  const perRequest = llm
    ? done.reduce((s, r) => s + costOf(r), 0) / Math.max(1, done.length)
    : (tokens * PRICE_PER_INPUT_TOKEN) / Math.max(1, done.length);
  const cost = `≈ $${perRequest.toFixed(5)} per request${llm ? ` (${MODEL})` : ""}`;
  console.log(`${line1.padEnd(34)} ${line2}  ${cost}`);
  report[arm] = { passed, total: runs.length };
}
mkdirSync("runs", { recursive: true });
const out = `runs/eval-${stamp}.json`;
writeFileSync(out, JSON.stringify(report, null, 2));
console.log(`\nfull results: ${out}${videoDir ? `   videos: ${videoDir}/` : ""}`);
