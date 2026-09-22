// Fabricated Jev answers for offline tests: what Jev would return if it meant
// `intent`. Questions the intent does not mention get a uniform shrug, so a
// test only passes when the code reads the head it is supposed to read.
import { readFileSync } from "node:fs";

export const shopHtml = readFileSync(new URL("./fixtures/shop.html", import.meta.url), "utf8");

export function answersFor(questions, intent = {}) {
  const answers = {};
  for (const [id, q] of Object.entries(questions)) {
    if (q.type === "noul") {
      answers[id] = { type: "noul", noul: intent[id] ?? 0.02 };
      continue;
    }
    const keys = Object.keys(q.criteria);
    const given = intent[id];
    const [pick, stated] = given ?? [keys[0], 1 / keys.length];
    if (!(pick in q.criteria)) throw new Error(`"${pick}" is not an option of ${id}: ${keys.slice(0, 8).join(", ")}…`);
    const others = keys.filter((k) => k !== pick);
    const p = others.length ? stated : 1;
    const probabilities = Object.fromEntries([[pick, p], ...others.map((k) => [k, (1 - p) / others.length])]);
    answers[id] = { type: "choice", choice: pick, probabilities, confidence: p };
  }
  return answers;
}

/** A snapshot element, as the in-page reader would produce it. */
export const el = (id, role, name, extra = {}) => ({ id, role, name, tag: extra.tag ?? (role === "link" ? "a" : "button"), inView: true, ...extra });

export const snapshotOf = (elements, extra = {}) => ({
  url: "https://shop.example/",
  title: "Shop",
  text: "Shop",
  modal: null,
  scroll: { y: 0, height: 800, viewport: 800 },
  elements,
  omitted: 0,
  ...extra,
});
