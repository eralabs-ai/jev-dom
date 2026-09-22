// The other half of the comparison: jev-webmcp-extension's pipeline, unchanged,
// on a live page. Tool schemas -> Jev questions -> one call -> the predicted
// tool executed. Use it to time the same request the DOM agent gets.
//
//   node --env-file=.env cli/webmcp-try.js "throw in two cartons of oat milk" ...
import { parseArgs } from "node:util";
import { decode } from "jev-webmcp/src/core/decode.js";
import { decide } from "jev-webmcp/src/core/policy.js";
import { buildQuestions, buildState } from "jev-webmcp/src/core/questions.js";
import { systemOne } from "jev-webmcp/src/jev.js";
import { pageCallTool, pageListTools } from "jev-webmcp/src/platform/chrome.js";
import { chromium } from "playwright";
import { PRICE_PER_INPUT_TOKEN } from "../src/jev.js";

const { values: opts, positionals: requests } = parseArgs({
  allowPositionals: true,
  options: { url: { type: "string", default: "https://shopping-webmcp-demo.netlify.app/store/greenleaf" } },
});
const apiKey = process.env.TYPESAFE_API_KEY;
const model = process.env.TYPESAFE_MODEL || "jev-latest";
const formatCall = (call) => (call?.name ? `${call.name}(${JSON.stringify(call.args).replace(/"([A-Za-z_$][\w$]*)":/g, "$1:")})` : "(no tool)");

const browser = await chromium.launch({ channel: "chromium", args: ["--enable-features=WebMCPTesting"] });
try {
  for (const request of requests) {
    // A fresh page per request, like the eval: no state carried between them.
    const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const page = await context.newPage();
    await page.goto(opts.url, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#main, main");
    let tools = [];
    for (let attempt = 0; attempt < 40 && !tools.length; attempt++) {
      tools = (await page.evaluate(pageListTools)).tools;
      if (!tools.length) await page.waitForTimeout(100);
    }

    const started = performance.now();
    const { questions, plan } = buildQuestions(tools, request);
    const reply = await systemOne({ apiKey, model, state: buildState(request, { host: new URL(page.url()).host, title: await page.title() }), questions });
    const call = decode(plan, reply.answers);
    const verdict = decide(call);
    let result = null;
    if (call.name && verdict !== "none" && verdict !== "incomplete") {
      result = await page.evaluate(`(${pageCallTool})(${JSON.stringify(call.name)}, ${JSON.stringify(JSON.stringify(call.args))})`);
    }
    const totalMs = performance.now() - started;

    const tokens = reply.usage?.input_tokens ?? 0;
    console.log(`\n› ${request}`);
    console.log(`  ${formatCall(call)}`);
    console.log(`  ${Math.round(call.confidence * 100)}% → ${verdict} · ${(totalMs / 1000).toFixed(2)} s (jev ${Math.round(reply.ms)} ms) · 1 Jev call · ${(tokens / 1000).toFixed(1)}k tokens ≈ $${(tokens * PRICE_PER_INPUT_TOKEN).toFixed(5)}`);
    if (result?.ok) {
      const text = JSON.parse(result.result)?.content?.[0]?.text ?? result.result;
      console.log(`  the panel shows: ${String(text).replace(/\s+/g, " ").slice(0, 150)}`);
    } else if (result) {
      console.log(`  tool error: ${result.error}`);
    }
    console.log(`  now at ${page.url()}`);
    await context.close();
  }
} finally {
  await browser.close();
}
