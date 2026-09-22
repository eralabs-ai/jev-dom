// Beyond Basketful: sites that never heard of WebMCP or of this project.
// Same agent, no site-specific code; each outcome is checked independently.
//
//   node --env-file=.env evals/sites.js [--only id] [--verbose] [--input synthetic]
import { parseArgs } from "node:util";
import { chromium } from "playwright";
import { runRequest } from "../src/agent.js";
import { createJev } from "../src/jev.js";
import { playwrightPage } from "../src/page/playwright.js";

const { values: opts } = parseArgs({
  options: { only: { type: "string" }, verbose: { type: "boolean", short: "v", default: false }, input: { type: "string", default: "trusted" } },
});

const CASES = [
  {
    id: "wikipedia",
    url: "https://en.wikipedia.org/wiki/Main_Page",
    said: "open the article about Gödel's incompleteness theorems",
    check: async (page) => /G%C3%B6del%27s_incompleteness_theorems|Gödel's_incompleteness_theorems/.test(decodeURI(page.url())) || /G%C3%B6del%27s_incompleteness_theorems/.test(page.url()),
  },
  {
    id: "todo-add",
    url: "https://demo.playwright.dev/todomvc/#/",
    said: "add buy oat milk to my list",
    check: async (page) => (await page.locator(".todo-list li").allInnerTexts()).some((t) => /buy oat milk/i.test(t)),
  },
  {
    id: "todo-complete",
    url: "https://demo.playwright.dev/todomvc/#/",
    setup: async (page) => {
      for (const todo of ["walk the dog", "pay rent", "call mom"]) {
        await page.getByPlaceholder("What needs to be done?").fill(todo);
        await page.keyboard.press("Enter");
      }
    },
    said: "mark pay rent as done",
    check: async (page) => {
      const done = await page.locator(".todo-list li.completed").allInnerTexts();
      return done.length === 1 && /pay rent/.test(done[0]);
    },
  },
  {
    id: "dropdown",
    url: "https://the-internet.herokuapp.com/dropdown",
    said: "pick option 2",
    check: async (page) => (await page.locator("#dropdown").inputValue()) === "2",
  },
  {
    id: "checkboxes",
    url: "https://the-internet.herokuapp.com/checkboxes",
    said: "tick the first checkbox",
    check: async (page) => page.locator("#checkboxes input").nth(0).isChecked(),
  },
  {
    id: "web-form",
    url: "https://www.selenium.dev/selenium/web/web-form.html",
    said: "put Ada Lovelace in the text input, choose Two in the dropdown, and submit",
    check: async (page) => /Form submitted/i.test(await page.content()) && /my-text=Ada\+Lovelace/.test(page.url()) && /my-select=2/.test(page.url()),
  },
];

const ask = createJev({ apiKey: process.env.TYPESAFE_API_KEY, model: process.env.TYPESAFE_MODEL || "jev-latest" });
const browser = await chromium.launch({ channel: "chromium" });
let passed = 0;
const cases = opts.only ? CASES.filter((c) => opts.only.split(",").includes(c.id)) : CASES;
try {
  for (const kase of cases) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: "en-US" });
    const tab = await context.newPage();
    try {
      await tab.goto(kase.url, { waitUntil: "domcontentloaded" });
      await kase.setup?.(tab);
      const page = playwrightPage(tab, { input: opts.input });
      await page.settle();
      const run = await runRequest({
        page,
        ask,
        request: kase.said,
        confirm: async () => true,
        onStep: opts.verbose
          ? (s) => console.log(`      · ${s.op} ${s.target ? `${s.target.role} "${s.target.name}"${s.target.option ? ` → ${s.target.option}` : ""}` : ""}${s.text != null ? ` ← "${s.text}"` : ""}  ${Math.round(s.confidence * 100)}%  ${s.jevMs} ms  ${s.elements} el`)
          : undefined,
      });
      const ok = await kase.check(tab);
      if (ok) passed++;
      const path = run.steps.map((s) => (s.target ? `${s.op} "${s.target.option ?? s.target.name}"${s.text != null ? `←"${s.text}"` : ""}` : s.op)).join(" → ");
      console.log(`${ok ? "PASS" : "FAIL"}  ${kase.id.padEnd(13)} "${kase.said}"\n      ${path}   [${run.status}] ${run.totalMs} ms, ${run.jevCalls} calls`);
    } catch (error) {
      console.log(`ERROR ${kase.id}: ${error.message.split("\n")[0]}`);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
console.log(`\n${passed}/${cases.length} passed`);
