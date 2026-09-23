// The in-page reader and the executor against a local fixture (no network).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium } from "playwright";
import { actionSpace } from "../src/core/actions.js";
import { playwrightPage } from "../src/page/playwright.js";
import { shopHtml } from "./helpers.js";

let browser;
let tab;
let page;
before(async () => {
  browser = await chromium.launch();
});
after(async () => browser?.close());

async function fresh(input = "trusted") {
  tab = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  await tab.setContent(shopHtml);
  page = playwrightPage(tab, { quietMs: 30, input });
  return page.observe();
}
const byName = (snap, name) => snap.elements.find((e) => e.name === name);

test("reads names, values, state and context; skips secrets, hidden and disabled controls", async () => {
  const snap = await fresh();
  const names = snap.elements.map((e) => e.name);
  assert.ok(!names.includes("Password"), "password fields are never offered");
  assert.ok(!names.includes("Hidden button"));
  assert.equal(names.filter((n) => n === "Add").length, 1, "the disabled Add is skipped");

  assert.equal(byName(snap, "Search the shop").role, "searchbox");
  assert.equal(byName(snap, "Search the shop").editable, true);
  assert.deepEqual(byName(snap, "vegan").state, { pressed: "false" });
  assert.equal(byName(snap, "vegan").context, "Dietary filters");
  assert.equal(byName(snap, "In stock only").state.checked, "false");
  assert.match(byName(snap, "Add").context, /Dairy & Eggs › Oat Milk \$4\.99/);
  assert.equal(byName(snap, "Quantity").value, "1");
  assert.equal(byName(snap, "Your name").autocomplete, "name", "autocomplete is read: it is the identity signal a site cannot mislabel by accident");
  assert.equal(byName(snap, "Search the shop").autocomplete, undefined);
  assert.deepEqual(
    byName(snap, "Sort by").options.map((o) => o.value),
    ["relevance", "price-asc"],
    "disabled options are not offered",
  );
  const far = byName(snap, "Store policies");
  assert.equal(far.inView, false, "controls below the fold are kept, marked out of view");
});

test("an open modal hides everything behind it", async () => {
  await fresh();
  await tab.evaluate(() => document.getElementById("modal").showModal());
  const snap = await page.observe();
  assert.equal(snap.modal, "Confirm order");
  assert.deepEqual(snap.elements.map((e) => e.name), ["Place order", "Cancel"]);
});

for (const input of ["trusted", "synthetic"]) test(`the ${input} executor clicks, types, submits and selects through observed nodes`, async () => {
  const snap = await fresh(input);
  const space = actionSpace(snap);
  const target = (name) => space.elements.find((e) => e.name === name);

  await page.act({ op: "CLICK", target: target("Add") });
  await page.act({ op: "TYPE_SUBMIT", target: target("Search the shop"), text: "oat milk" });
  const sort = Object.values(space.targets.SELECT).find((t) => t.option.value === "price-asc");
  await page.act({ op: "SELECT", target: sort });
  await page.act({ op: "CLICK", target: target("vegan") });
  await page.act({ op: "TYPE", target: target("Quantity"), text: "3" });

  assert.deepEqual(await tab.evaluate(() => window.events), ["add:oat-milk", "search:oat milk", "sort:price-asc"]);
  const after = await page.observe();
  assert.equal(byName(after, "vegan").state.pressed, "true");
  assert.equal(byName(after, "Quantity").value, "3");
  assert.match(byName(after, "Open cart: 0 items").name, /Open cart/);
});

for (const input of ["trusted", "synthetic"]) test(`the ${input} executor scrolls to a control out of view before clicking`, async () => {
  const snap = await fresh(input);
  const far = actionSpace(snap).elements.find((e) => e.name === "Store policies");
  await page.act({ op: "CLICK", target: far });
  assert.equal(await tab.evaluate(() => location.hash), "#footer-link");
});

test("the synthetic executor refuses a covered control and a vanished one", async () => {
  const snap = await fresh("synthetic");
  const add = actionSpace(snap).elements.find((e) => e.name === "Add");
  await tab.evaluate(() => {
    const cover = document.createElement("div");
    cover.style.cssText = "position:fixed;inset:0;z-index:9;background:rgba(0,0,0,.2)";
    document.body.append(cover);
  });
  await assert.rejects(page.act({ op: "CLICK", target: add }), /covering/);
  await tab.evaluate(() => document.querySelector(".add").remove());
  await assert.rejects(page.act({ op: "CLICK", target: add }), /gone/);
  assert.deepEqual(await tab.evaluate(() => window.events), []);
});
