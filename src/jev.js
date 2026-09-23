// Minimal client for TypeSafe's System One endpoint: the request shape
// jev-webmcp-extension uses, plus a short retry on rate limits, since an agent
// step would rather wait a moment than fail. Works in Node 22+ and browsers.
const API = "https://api.typesafe.ai/v1";

/** Dollars per input token (output tokens are free), as used by jev-webmcp-extension. */
export const PRICE_PER_INPUT_TOKEN = 0.042 / 1e6;

export class JevError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "JevError";
    this.status = status;
  }
}

const REASONS = {
  401: "TypeSafe did not accept that API key.",
  403: "TypeSafe refused the request (is TYPESAFE_API_KEY set?).",
  422: "TypeSafe rejected the questions.",
  429: "Rate limited by TypeSafe.",
  529: "TypeSafe is overloaded.",
};

async function explain(response) {
  let detail = "";
  try {
    const body = await response.json();
    detail = typeof body.detail === "string" ? body.detail : (body.detail?.message ?? body.error?.message ?? body.message ?? JSON.stringify(body.detail ?? ""));
  } catch {}
  return [REASONS[response.status] ?? `TypeSafe returned ${response.status}.`, detail].filter(Boolean).join(" ");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** @returns ask({ state, questions, signal }) -> { answers, usage, model, ms } */
export function createJev({ apiKey, model = "jev-latest", api = API, timeoutMs = 20_000, retries = 2 } = {}) {
  if (!apiKey) throw new JevError("Set TYPESAFE_API_KEY (from console.typesafe.ai/keys), e.g. in .env.");
  return async function ask({ state, questions, signal }) {
    for (let attempt = 0; ; attempt++) {
      const started = performance.now();
      const response = await fetch(`${api}/systemone`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ state, model, questions }),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
      });
      if ([429, 503, 529].includes(response.status) && attempt < retries) {
        await sleep(300 * 2 ** attempt);
        continue;
      }
      if (!response.ok) throw new JevError(await explain(response), response.status);
      const body = await response.json();
      return { answers: body.answers, usage: { input_tokens: body.usage?.input_tokens ?? 0 }, model: body.model, ms: performance.now() - started };
    }
  };
}

export async function checkKey({ apiKey, api = API }) {
  const response = await fetch(`${api}/models`, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!response.ok) throw new JevError(await explain(response), response.status);
  return response.json();
}
