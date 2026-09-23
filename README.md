# jev-dom

**Jev driving a web page through its DOM — no WebMCP.**

[jev-webmcp-extension](https://github.com/sdras/jev-webmcp-extension) turns a site's
**WebMCP tool schemas** into Jev questions: type a request, Jev picks the tool and fills its
arguments. That only works on sites that ship WebMCP tools (an origin trial today).

This project asks the same model to do the same job on **any** page, by reading the DOM the
way [jev-ultrafast](https://github.com/browser-use/jev-ultrafast) does: the page's own
buttons, links, fields and dropdowns become the action space. Only a Jev key is needed.

```
"throw in two cartons of oat milk"
  CLICK  button "Add Oat Milk to cart"          100%  424 ms
  CLICK  button "Increase Oat Milk quantity"     99%  281 ms
  DONE                                           99%  273 ms
  ✔ done · 1.38 s · 3 Jev calls · ≈ $0.0019
```

## Install

Not on npm. Install it from GitHub, pinned to a commit — this is a research package and its
surface still moves:

```bash
npm i github:eralabs-ai/jev-dom#e211e2a
```

Node 22 or newer — `jev-webmcp`, the one runtime dependency, sets that floor. `playwright` is a
peer of your own choosing: this package never imports it, so you supply the browser and hand it a
page.

That first `npm install` of a GitHub dependency needs `git` on `PATH` (npm shells out to
`git ls-remote`); once a lockfile is committed, `npm ci` does not — it fetches both packages from
GitHub's codeload tarball instead.

### Use from your own Playwright page

```js
import { runRequest } from "jev-dom/agent";
import { createJev, PRICE_PER_INPUT_TOKEN } from "jev-dom/jev";
import { playwrightPage } from "jev-dom/page/playwright";

const driver = playwrightPage(page); // `page` is yours: any Playwright Page
await driver.settle();

const run = await runRequest({
  page: driver,
  ask: createJev({ apiKey: process.env.TYPESAFE_API_KEY }),
  request: "throw in two cartons of oat milk",
  maxSteps: 12,
  confirm: async () => true, // asked before a shaky or consequential step
  onStep: (step) => console.log(step.op, step.target?.name, step.confidence),
});

console.log(run.status, run.totalMs, run.inputTokens * PRICE_PER_INPUT_TOKEN);
```

Subpaths: `jev-dom/agent` (the loop), `jev-dom/jev` (the System One client), `jev-dom/webmcp`
(`chooseTool`, the WebMCP arm as one call), `jev-dom/core/*` (action space, decode, policy,
questions, spans) and `jev-dom/page/*` (the Playwright host, the in-page reader and executor).
Hand-written TypeScript declarations ship with each one.

## Results

jev-webmcp-extension's own 17 eval sentences, on its own demo site
([Basketful](https://shopping-webmcp-demo.netlify.app/)), which offers every action both as a
WebMCP tool and as ordinary UI. Every case starts from the same seeded state and is judged by
**what changed on the page**, against the expected WebMCP call executed directly.

| | Correct outcomes | Median time / request | Jev calls | Input tokens | ≈ Cost |
| --- | --- | --- | --- | --- | --- |
| **WebMCP + Jev** (the extension's pipeline, unchanged) | 30/34 over 2 runs | 305 ms | 1 | 5.1k | $0.0002 |
| **DOM + Jev** (this project, no WebMCP) | 29/34 over 2 runs | 862 ms | 2–3 | 21.9k | $0.0010 |
| **DOM + Jev**, the Chrome extension's executor | 14/17 | 801 ms | 2 | 20.1k | $0.0009 |
| **Claude Opus 5 + WebMCP** (bare tool loop, cached) | 34/34 over 2 runs | 3,608 ms | 2 | 8.1k | $0.0151 |
| **Claude Opus 5 + DOM** (the same element table Jev reads) | 30/34 over 2 runs | 4,456 ms | 2 | 25.8k | $0.0351 |
| **Claude Haiku 4.5 + WebMCP** / **+ DOM** | 15/17 · 15/17 | 2,058 / 3,491 ms | 2 | 6.8k / 21.3k | $0.0082 / $0.0189 |

On the same DOM action space, Jev matches Opus 5 (29 vs 30 of 34) at **5× the speed and 35×
less cost**. An LLM handed the site's WebMCP tools is the accuracy ceiling here (34/34), at
4× the latency and 15× the cost of Jev — and it needs the site to ship WebMCP.

Where the DOM agent's 862 ms goes: **558 ms of Jev** (2–3 calls), **192 ms** acting and
waiting for the page to settle, **69 ms** re-reading it. A Jev call never gets cheap — a
320-token, two-option probe still takes ~150–200 ms from this machine — so round trips
dominate: 1-call runs finish in ~330 ms, 2-call runs in ~670 ms, 3-call runs in ~1.2 s.

| Sentence | WebMCP | DOM | What the DOM agent did |
| --- | :-: | :-: | --- |
| got anything gluten free in the bakery aisle? | ✅ | ✅ | Bakery aisle → gluten-free chip |
| vegan snacks | ✅ | ✅ | Snacks aisle → vegan chip |
| find oat milk under five bucks | ✅ | ❌ | searched "oat milk"; **the UI has no price filter** (`max_price` exists only in the tool) |
| let's shop at the cheap one | ✅ | ✅ | Penny Pantry |
| switch to the co-op | ✅ | ✅ | Change store → Harbor Foods Co-op |
| throw in two cartons of oat milk | ✅ | ✅ | Add → + |
| add an avocado | ✅ | ✅ | Add Hass Avocados |
| make it three bananas instead | ✅ | ✅ | + → + (reads the stepper's count) |
| the usual please | ✅ | ✅ | Add my usuals |
| I want to make tacos tonight | ❌ | ❌ | opened the recipe, didn't add it (WebMCP dropped the `recipe` argument) |
| what would I need to buy for the salmon dinner? | ❌ | ⚠️ 1 of 2 | found the recipe once, went to Meat & Seafood once (WebMCP dropped the `recipe` argument) |
| what's in my cart? | ✅ | ✅ | Open cart |
| where's my order? | ✅ | ✅ | Orders → the order |
| I'm ready to check out | ✅ | ✅ | Open cart → Go to checkout |
| deliver it tomorrow morning | ✅ | ✅ | Tomorrow 8am–10am |
| ok buy it | ✅ | ✅ | Place order (asks first: it reads like a commitment) |
| tell me a joke | ✅ | ✅ | NONE, nothing touched |

The same agent on sites that have never heard of WebMCP, no site-specific code:
**6/6** (Wikipedia search → article, TodoMVC add and complete, a native dropdown, a checkbox,
and a three-field form: type, select, submit), 0.4–1.2 s each.

### Against a real agent

The comparison above swaps the decision engine but keeps the harness thin. The other
question is how this compares to what people actually ship: a general LLM agent driving a
browser. Three tasks, run on an external agent-harness runner (`claude-code` harness, Claude
Opus 5), with its `desktop` add-on (a real Chromium in the pod — the trajectories show
screenshot → read-image → click loops) and with its `webmcp` add-on (the site's own tools
re-served as MCP). Every run below produced the correct answer.

| Task | Agent + browser | Agent + WebMCP | Jev + DOM |
| --- | --- | --- | --- |
| Add two cartons of oat milk | 98.8 s · $0.53 · 22 turns | 30.7 s · $0.29 · 6 turns | **1.8 s · $0.0019 · 3 calls** |
| Gluten-free items in Bakery | 51.2 s · $0.18 · 9 turns | 26.8 s · $0.08 · 4 turns | **1.2 s · $0.0010 · 3 calls** |
| Switch to the cheapest store | 46.9 s · $0.13 · 6 turns | 24.7 s · $0.08 · 4 turns | **1.2 s · $0.0013 · 3 calls** |
| Median | 51 s · $0.18 | 27 s · $0.08 | **1.2 s · $0.0013** |

A real agent's cost is dominated by its harness: 100k–500k tokens per task, mostly cached
system prompt and tool preamble. Stripped to a bare loop (the `llm-webmcp` / `llm-dom` arms
above) the same model runs in 3.6–4.5 s at $0.015–0.035. Jev needs neither the harness nor
the site's cooperation.

Caveats: three tasks, one run each, on a dev cluster. The agent arms also *answer in prose*
("the subtotal is $9.98"), which Jev does not do — it operates the page and the user reads
the result.

### On a real store

The same four arms on [aloyoga.com](https://www.aloyoga.com/) — a live shop with 11 WebMCP
tools, a heavy SPA, a cookie banner and hover menus (`--journey aloyoga`, four tasks: browse
leggings, browse shoes, open cart, add a black legging in size S; nothing is ever bought).

| | Claude (browser use) | Claude (browser use) + WebMCP | Jev on DOM | Jev + WebMCP |
| --- | --- | --- | --- | --- |
| Avg time (from loaded page) | 175.7 s | 49.3 s | **4.3 s*** | **2.1 s** |
| Avg cost per task | $0.87 | $0.46 | $0.0005 | **$0.0002** |
| Avg tokens | 1,037k | 481k | 12k | **5k** |
| Avg turns / calls | 27.8 | 12.8 | 2.3 | **1** |
| Correct | 4/4 | 4/4 | 3/4 | 2/4 |

\* over its three successes. Jev is 20–40× faster and ~1,000× cheaper here, and it wins the
navigation tasks outright — but neither Jev arm is 4/4 alone, and the two fail on *opposite*
tasks:

- **Jev + WebMCP loses both browse tasks.** `browse_store` wants `collection:
  "womens-leggings"`, a handle the shopper never utters, and Jev only picks words the user
  actually said. Basketful's human-worded enums ("Bakery", "Penny Pantry") hid this; real
  schemas use identifiers. An LLM guesses the handle, a model that never writes cannot.
- **Jev on DOM loses add-to-cart.** Not the site's markup: given the product page it picks
  `S (4-6)` at 98% and `Add to Bag` at 100% in 3.1 s. It loses on navigation — after certain
  clicks the page renders ~125 controls and then reads as completely empty, which reproduces
  with plain Playwright and no Jev involved.

Together they cover 4/4 for about $0.001 — which is the shape a product would ship: the DOM
for navigating, the site's tools for typed actions.

### Compare the four yourself

`evals/four-arms.js` runs one journey through all four interfaces and prints the table
above. A journey is a JSON file (`evals/journeys/`) with the request each Jev arm gets, the
prompt each agent arm gets, and what counts as success.

```bash
# the two Jev arms only — fast, pennies, no cluster needed
node --env-file=.env evals/four-arms.js --journey basketful --arms jev-dom,jev-webmcp

# all four, on the live store
node --env-file=.env evals/four-arms.js --journey aloyoga

# one task, repeated, written to a file you name
node --env-file=.env evals/four-arms.js --journey aloyoga --only add-legging --repeats 3 --out runs/mine.json
```

The two agent arms need an external agent-harness runner — a real harness in a pod, with a
`desktop` feature (a Chromium it drives with navigate/click/type/screenshot) and optionally a
`webmcp` feature (the site's own tools re-served as MCP). `evals/ora-agent.js` drives **one
specific such runner** (ora's experiments API) over HTTP; swap that file for your own runner's
client and the other three arms are unaffected. Pointed at ora's, it takes:

```bash
export ORA_API_URL=... ORA_AUTH_URL=...      # e.g. port-forwarded from the cluster
export ORA_EMAIL=... ORA_PASSWORD=...        # or ORA_TOKEN=...; ORA_HARNESS/ORA_MODEL to switch
```

**Timing convention.** Every arm is timed **from a loaded page**. The Jev arms start their
clock after the page settles; the agent arms subtract everything up to and including their
own first navigation step, which also removes pod, sidecar and harness start-up (20–38 s on
the demo store). Full wall-clock for an agent arm is 2–10× the number shown, and `wallMs` in
the JSON output keeps it.

**Judging.** The Jev arms are judged on where the page ended up (URL, and stored state where
a journey declares `expectStorage`); the agent arms are judged on the answer they report,
since their browser lives in a pod this process cannot inspect. Same bar, different evidence.

**One trap worth knowing:** attaching `desktop` and `webmcp` together fails unless the
desktop Chromium is started with `--enable-features=WebMCPTesting` — the webmcp sidecar
attaches to it over CDP, finds no `navigator.modelContext`, and the run sits `pending` while
its init container crash-loops. `evals/ora-agent.js` passes that flag; the real fix belongs
in the operator.

### What we learned

- **Where the UI can do the job, the DOM gets the same outcome.** The DOM agent matched WebMCP
  on 14 of the 15 cases WebMCP gets right. The one miss is a UI gap, not a model gap.
- **It is slower: about 2.8×.** A tool is one call; a UI is two or three steps, and each step
  costs a round trip plus a browser action. Jev latency measured ≈ 177 ms + 7.5 ms per 1k input
  tokens, so payload size matters far less than the number of calls: Jev is 65% of the DOM
  agent's time, acting 22%, re-reading 8%. Still under a second, versus seconds for
  LLM/screenshot agents.
- **WebMCP carries knowledge the page does not show:** parameters with no UI control
  (`max_price`), options not on screen (every recipe name is in the schema), and declared
  risk (`consequentialHint`). The DOM agent infers risk from labels and discovers the rest by
  navigating.
- **The DOM works everywhere today**, needs nothing from the site, and the user sees each
  step happen with the page's own controls.
- For reference, the extension's own fixture eval scores 13/17 with `jev-latest` today (it
  fails the two recipe cases, vegan snacks' arguments, and an avocado arguments nitpick).

## How a step works

Every step is **one** Jev request (System One: typed questions, calibrated answers, no text
generation). All questions share the same state and are answered in parallel, so the questions
a step *might* need are asked speculatively and the code reads only the ones the winning
operation needs:

| Question | Type | Options |
| --- | --- | --- |
| `operation` | Choice | `CLICK`, `TYPE`, `TYPE_SUBMIT`, `SELECT`, `SCROLL_*`, `DONE`, `NONE`, only those the page supports |
| `click_target` | Choice | every clickable control, by role, name, state and where it sits |
| `type_target` | Choice | every editable field |
| `select_target` | Choice | every unselected `<select>` option |
| `text@<field>` | Choice | **spans of the user's own words** (numbers for number fields) + "(not stated)" |
| `single_step` | Noul | can one action finish the request? (optional early finish) |

The `text@` heads are jev-webmcp-extension's trick: Jev never writes, so text to type is a
Choice over what the user actually said. That removes jev-ultrafast's second model (a small LLM
for typing). When a request doesn't contain the text a field needs, the step stops as
`incomplete` instead of guessing.

The model only ever picks an index the code created for a real DOM node: never a selector, a
coordinate or a script. Steps below 50% confidence, and any click that reads like a commitment
(order, pay, delete, send), ask the user first.

## Try it

### In the terminal (Playwright, headless Chromium)

```bash
npm install
npx playwright install chromium        # Linux may also need: sudo npx playwright install-deps chromium
echo 'TYPESAFE_API_KEY=...' > .env      # console.typesafe.ai/keys

npm run try                              # interactive: one request per line, on Basketful
npm run try -- "throw in two cartons of oat milk" "what's in my cart?"
npm run try -- --url https://en.wikipedia.org/wiki/Main_Page --shots "open the article about Kurt Gödel"
```

Flags: `--url`, `--shots` (screenshot per request), `--video`, `--dump` (every request and
answer as JSON), `--verbose`, `--yes` (don't ask before commitments).

### In your Chrome (side panel extension)

```bash
node scripts/build-extension.js          # -> dist/extension and dist/jev-dom-extension.zip
```

1. `chrome://extensions` → Developer mode → **Load unpacked** → `dist/extension` (or unzip
   `jev-dom-extension.zip` and pick that folder). Chrome 121+.
2. Click the toolbar icon to open the side panel. Settings (sliders icon) → paste your key → Save.
3. On any site: **Enable on <site>** (access is granted one site at a time), then type.

The extension runs the same core (`src/core`, `src/agent.js`) and the in-page executor
`src/page/perform.js` (synthetic pointer events, the native value setter so React sees typed
text, `requestSubmit` for Enter). `node --env-file=.env scripts/e2e-extension.js` loads it into
Chromium and drives the real panel end to end.

## Compare with WebMCP yourself

```bash
npm run eval                                   # WebMCP vs DOM, all 17 cases
npm run eval -- --arm llm-webmcp,llm-dom       # add the LLM baselines (LLM_MODEL, LLM_BASE_URL)
npm run eval -- --arm webmcp,dom,dom-ext --repeat 2
npm run eval -- --arm dom --only tacos,usual --verbose --video
node --env-file=.env evals/sites.js --verbose  # the non-Basketful sites
```

- **webmcp**: jev-webmcp-extension's questions, decode, policy and page bridge, installed from
  GitHub at a pinned commit and unchanged. The predicted call runs in Chromium with WebMCP
  testing enabled.
- **dom**: this agent, in a Chromium without WebMCP. **dom-fast** adds the early finish;
  **dom-ext** uses the extension's synthetic-event executor.
- After an action both arms wait for the DOM to go quiet for 60 ms (capped at 1.5 s) before
  reading it again; at 120 ms every case took the same path and each request cost ~85 ms more.
- Seeds are built through the site's own tools at a fixed browser clock (delivery windows
  depend on the time). The simulated user accepts shaky steps (the extension's Enter) but only
  accepts a commitment when the request asked for one, in both arms. Any unrequested cart
  change or order fails a case.

## Layout

```
src/core/          pure JavaScript, no browser: shared by the CLI, the evals and the extension
  actions.js       snapshot -> indexed elements + per-operation targets
  questions.js     one step -> one request (operation, target and text heads)
  decode.js        answers -> a validated decision
  policy.js        act / unsure / confirm / incomplete / done / none
  spans.js         vendored from jev-webmcp-extension
src/page/
  snapshot.js      in-page DOM reader (adapted from jev-ultrafast)
  perform.js       in-page executor (synthetic events) + settle
  playwright.js    Playwright host: trusted or synthetic input
src/agent.js       the loop
src/jev.js         System One client
cli/try.js         try it on any page
extension/         the side panel (built into dist/ with the core)
evals/
  run.js           WebMCP vs DOM vs LLM arms on Basketful's 17 sentences
  four-arms.js     one journey through all four interfaces -> the comparison table
  ora-agent.js     the two agent arms, via one specific external runner (ora's experiments API)
  journeys/        the task sets (basketful, aloyoga)
  sites.js         the same agent on sites that never heard of WebMCP
```

`npm test` runs offline: fabricated Jev answers and a local fixture page, both executors.

## Limits

- Shadow DOM, iframes, canvas and custom keyboard widgets are not read.
- A DOM agent can only do what the UI exposes, and only knows what the current page shows.
- Risk is inferred from labels; a site's declared `consequentialHint` is stronger.
- `DONE` is the model's judgment. The evals check outcomes independently.
- The extension uses synthetic events (no debugger banner). A page that checks `isTrusted`
  will ignore them; the Playwright host uses real input.

Credits: `spans.js` and the schema-to-question idea from
[sdras/jev-webmcp-extension](https://github.com/sdras/jev-webmcp-extension) (Apache-2.0); the
snapshot and the operation + target heads from
[browser-use/jev-ultrafast](https://github.com/browser-use/jev-ultrafast) (MIT).
