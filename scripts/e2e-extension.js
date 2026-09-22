// End-to-end: load the built extension into Chromium, open its panel pinned to
// a Basketful tab, type requests into the panel, and check what the store did.
//
//   node --env-file=.env scripts/e2e-extension.js
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const SITE = "https://shopping-webmcp-demo.netlify.app";
const root = new URL("..", import.meta.url).pathname;
execFileSync("node", [join(root, "scripts/build-extension.js"), "--test", `${SITE}/*`], { stdio: "inherit" });
const extension = join(root, "dist", "extension-test");
const shots = join(root, "runs", "extension");
mkdirSync(shots, { recursive: true });

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "jev-ext-")), {
  channel: "chromium",
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  viewport: { width: 1280, height: 860 },
});
let failures = 0;
try {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  const id = new URL(worker.url()).host;

  const shop = await context.newPage();
  await shop.goto(`${SITE}/store/greenleaf`, { waitUntil: "domcontentloaded" });
  await shop.waitForSelector("main");

  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 760 });
  await panel.goto(`chrome-extension://${id}/panel/panel.html`);
  const tabId = await panel.evaluate(async ({ apiKey, site }) => {
    await chrome.storage.local.set({ apiKey, askWhenUnsure: false });
    const [tab] = await chrome.tabs.query({ url: `${site}/*` });
    return tab.id;
  }, { apiKey: process.env.TYPESAFE_API_KEY, site: SITE });
  await panel.goto(`chrome-extension://${id}/panel/panel.html?tab=${tabId}`);
  await panel.waitForSelector("#app:not([hidden])");

  const cart = () => shop.evaluate(() => JSON.parse(localStorage.getItem("basketful:v1") || "{}").carts?.greenleaf ?? {});
  const cases = [
    ["throw in two cartons of oat milk", async () => (await cart())["oat-milk"] === 2],
    ["add an avocado", async () => (await cart()).avocado === 1],
    ["what's in my cart?", async () => shop.evaluate(() => Boolean(document.querySelector("dialog.cart-drawer")?.open))],
  ];
  for (const [request, check] of cases) {
    const runs = await panel.locator(".run").count();
    await panel.fill("#say", request);
    await panel.press("#say", "Enter");
    await panel.waitForFunction((n) => document.querySelectorAll(".run").length > n && !document.querySelector(".run .status")?.textContent.startsWith("Thinking") && !document.querySelector(".run .status")?.textContent.startsWith("Working"), runs, { timeout: 30_000 });
    const status = await panel.locator(".run .status").first().textContent();
    const steps = await panel.locator(".run").first().locator(".step").allInnerTexts();
    const ok = await check();
    if (!ok) failures++;
    console.log(`${ok ? "PASS" : "FAIL"}  "${request}"\n      ${steps.map((s) => s.replace(/\s+/g, " ")).join("  →  ")}\n      ${status}`);
  }
  await panel.screenshot({ path: join(shots, "panel.png") });
  await shop.screenshot({ path: join(shots, "page.png") });
  console.log(`\nscreenshots: ${shots}/panel.png, ${shots}/page.png`);
} finally {
  await context.close();
}
process.exit(failures ? 1 : 0);
