// The published surface: every subpath in package.json's `exports` resolves,
// and carries the names types/ declares. A consumer installs this package and
// imports exactly these specifiers, so a missing entry breaks them, not us.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const lockfile = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));

/** The major from a ">=22" style floor, which is all any engines field here uses. */
const floorOf = (range) => Number(/>=\s*(\d+)/.exec(range ?? "")?.[1] ?? 0);

const SURFACE = {
  "jev-dom/agent": ["STOPS", "STABLE", "EARLY", "fingerprint", "runRequest"],
  "jev-dom/jev": ["PRICE_PER_INPUT_TOKEN", "JevError", "createJev", "checkKey"],
  "jev-dom/webmcp": ["chooseTool", "pageListTools", "pageCallTool"],
  "jev-dom/core/actions": ["OPERATIONS", "TARGETED", "describe", "actionSpace"],
  "jev-dom/core/decode": ["InvalidAnswer", "decode"],
  "jev-dom/core/policy": ["THRESHOLDS", "looksConsequential", "decide"],
  "jev-dom/core/questions": ["NOT_STATED", "MAX_OPTIONS", "RULES", "TARGET_QID", "buildStep"],
  "jev-dom/core/spans": ["tokenize", "spans", "numbers"],
  "jev-dom/page/playwright": ["StaleTarget", "playwrightPage"],
  "jev-dom/page/snapshot": ["snapshotPage"],
  "jev-dom/page/perform": ["performInPage", "waitForQuiet"],
};

for (const [specifier, names] of Object.entries(SURFACE)) {
  test(`${specifier} exports ${names.join(", ")}`, async () => {
    const module = await import(specifier);
    for (const name of names) assert.equal(typeof module[name] !== "undefined", true, `${specifier} has no export "${name}"`);
  });
}

test("every subpath ships its types, and `files` carries them", () => {
  for (const [subpath, entry] of Object.entries(manifest.exports)) {
    if (subpath === "./package.json") continue;
    assert.ok(entry.types?.startsWith("./types/"), `${subpath} declares no types file`);
    assert.ok(entry.default?.startsWith("./src/"), `${subpath} points at no source file`);
  }
  for (const shipped of ["src/", "types/"]) assert.ok(manifest.files.includes(shipped), `package "files" omits ${shipped}`);
});

test("the engine takes no runtime dependency on the browser or the LLM SDK", () => {
  assert.deepEqual(Object.keys(manifest.dependencies), ["jev-webmcp"]);
  for (const devOnly of ["playwright", "@anthropic-ai/sdk"]) assert.ok(devOnly in manifest.devDependencies, `${devOnly} should be a devDependency`);
});

test("the declared node floor is no lower than any runtime dependency's", () => {
  // A consumer installs those dependencies too, so promising less than they ask
  // for is a promise this package cannot keep. `jev-webmcp` wants Node 22.
  const ours = floorOf(manifest.engines.node);
  assert.ok(ours > 0, `engines.node "${manifest.engines.node}" declares no floor`);
  for (const name of Object.keys(manifest.dependencies)) {
    const theirs = floorOf(lockfile.packages[`node_modules/${name}`]?.engines?.node);
    assert.ok(ours >= theirs, `engines.node is >=${ours}, but ${name} needs >=${theirs}`);
  }
});
