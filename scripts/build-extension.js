// Assemble the loadable extension: extension/ + the shared core copied into lib/,
// icons rendered once, and a zip to hand around.
//
//   node scripts/build-extension.js                       -> dist/extension, dist/jev-dom-extension.zip
//   node scripts/build-extension.js --test <origin>/*     -> dist/extension-test, host access pre-granted (for the automated test)
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright";

const { values: opts } = parseArgs({ options: { test: { type: "string" } } });
const root = new URL("..", import.meta.url).pathname;
const out = join(root, "dist", opts.test ? "extension-test" : "extension");

// The core the side panel runs: the same files the CLI and the evals use.
const SHARED = ["agent.js", "jev.js", "core/actions.js", "core/decode.js", "core/policy.js", "core/questions.js", "core/spans.js", "page/snapshot.js", "page/perform.js"];

rmSync(out, { recursive: true, force: true });
cpSync(join(root, "extension"), out, { recursive: true });
for (const file of SHARED) {
  mkdirSync(dirname(join(out, "lib", file)), { recursive: true });
  cpSync(join(root, "src", file), join(out, "lib", file));
}

if (opts.test) {
  const manifest = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
  manifest.host_permissions.push(opts.test);
  writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2));
}

// Icons: a lightning bolt on a rounded square, rendered by Chromium.
const icons = join(root, "extension", "icons");
if (!existsSync(join(icons, "icon-128.png"))) {
  mkdirSync(icons, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const size of [16, 32, 48, 128]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<body style="margin:0;background:transparent">
      <svg viewBox="0 0 16 16" width="${size}" height="${size}"><rect width="16" height="16" rx="3.5" fill="#011627"/>
      <path d="M9.2 1.6 3.6 9h3.7l-.6 5.4L12.6 7H8.9z" fill="#82aaff"/></svg></body>`);
    await page.screenshot({ path: join(icons, `icon-${size}.png`), omitBackground: true });
  }
  await browser.close();
  cpSync(icons, join(out, "icons"), { recursive: true });
}

if (!opts.test) {
  const zip = join(root, "dist", "jev-dom-extension.zip");
  rmSync(zip, { force: true });
  execFileSync("zip", ["-qr", zip, "."], { cwd: out });
  console.log(`built ${out}\nzipped ${zip}`);
} else {
  console.log(`built ${out} (test build, host access: ${opts.test})`);
}
