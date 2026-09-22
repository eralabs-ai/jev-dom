// The two agent arms: a general LLM agent driving the same site through ora's
// experiment runner (a real harness in a pod, not a loop in this process).
//
//   agent-browser         kalanu's `desktop` feature — a real Chromium the agent
//                         drives with navigate/click/type/screenshot verbs
//   agent-browser-webmcp  the same, plus the `webmcp` feature, which holds the
//                         target page and re-serves its registered tools as MCP
//
// Configuration (all optional except a reachable API):
//   ORA_API_URL   default http://127.0.0.1:29434   (kubectl port-forward svc/experiments-service)
//   ORA_AUTH_URL  default http://127.0.0.1:29433   (kubectl port-forward svc/auth-service)
//   ORA_TOKEN     a bearer token; otherwise ORA_EMAIL/ORA_PASSWORD log in for one
//   ORA_HARNESS   default claude-code       ORA_MODEL default claude-opus-5
const API = process.env.ORA_API_URL ?? "http://127.0.0.1:29434";
const AUTH = process.env.ORA_AUTH_URL ?? "http://127.0.0.1:29433";
const HARNESS = process.env.ORA_HARNESS ?? "claude-code";
const MODEL = process.env.ORA_MODEL ?? "claude-opus-5";
const POLL_MS = 10_000;
const RUN_LIMIT_MS = 15 * 60_000;

export const ARMS = {
  "agent-browser": () => ({ desktop: {} }),
  // The webmcp sidecar attaches to the desktop's Chromium over CDP, and that
  // Chromium must be started with the WebMCP flag or its startup probe never
  // passes and the run sits pending. Passing it here is what makes the pair work.
  "agent-browser-webmcp": (site) => ({ desktop: { chromeArgs: ["--enable-features=WebMCPTesting"] }, webmcp: { targetUrl: site } }),
};

const login = async () => {
  const email = process.env.ORA_EMAIL;
  const password = process.env.ORA_PASSWORD;
  if (!email || !password) return null;
  const response = await fetch(`${AUTH}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw new Error(`ora login failed: ${response.status}`);
  return (await response.json()).token;
};

/** A session that re-logs in when its token expires mid-benchmark. */
export async function oraSession() {
  let token = process.env.ORA_TOKEN ?? (await login());
  if (!token) return null;
  const call = async (path, init = {}, retry = true) => {
    const response = await fetch(`${API}${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}`, "content-type": "application/json" },
    });
    if (response.status === 401 && retry) {
      token = await login();
      if (!token) throw new Error("ora token expired and ORA_EMAIL/ORA_PASSWORD are not set");
      return call(path, init, false);
    }
    if (!response.ok) throw new Error(`ora ${path} -> ${response.status} ${(await response.text()).slice(0, 120)}`);
    return response.json();
  };
  return { call };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const TERMINAL = ["succeeded", "failed", "errored", "timed_out", "canceled", "cancelled"];
const isNavigation = (step) =>
  step.tool === "mcp__webmcp__open_site" || (step.tool === "Bash" && /xdg-open|navigate |chromium|google-chrome/.test(JSON.stringify(step.input ?? "")));

export async function agentRun({ ora, arm, task, site, judge }) {
  const intent = task.agentPrompt.replaceAll("{url}", site);
  const { runId } = await ora.call("/api/runs", {
    method: "POST",
    body: JSON.stringify({ intent, harness: HARNESS, model: MODEL, addons: ARMS[arm](site) }),
  });

  const deadline = Date.now() + RUN_LIMIT_MS;
  let row;
  for (;;) {
    await sleep(POLL_MS);
    const listed = await ora.call(`/api/runs?pageSize=25`);
    row = (listed.results ?? []).find((r) => r.id === runId);
    if (row && TERMINAL.includes(row.status)) break;
    if (Date.now() > deadline) throw new Error(`run ${runId.slice(0, 8)} still ${row?.status ?? "unknown"} after ${RUN_LIMIT_MS / 60000} min`);
  }
  if (row.status !== "succeeded") throw new Error(`run ${runId.slice(0, 8)} ${row.status}${row.outcome_reason ? `: ${row.outcome_reason}` : ""}`);

  const { steps = [] } = await ora.call(`/api/runs/${runId}/trajectory`);
  // Time from a loaded page: drop everything up to and including the agent's own
  // navigation, which also drops pod, sidecar and harness start-up.
  const navigation = steps.find(isNavigation);
  const trajectoryMs = steps.at(-1)?.elapsed_ms ?? row.duration_ms;
  const fromLoadedMs = trajectoryMs - (navigation?.elapsed_ms ?? 0);
  const answer = [...steps].reverse().find((s) => !s.tool && s.text)?.text ?? "";
  const tools = [...new Set(steps.filter((s) => s.tool).map((s) => s.tool))];

  return {
    ms: fromLoadedMs,
    wallMs: row.duration_ms,
    cost: Number(row.cost_usd ?? 0),
    tokens: row.total_tokens ?? 0,
    steps: row.num_turns ?? steps.length,
    trail: `${tools.filter((t) => t.startsWith("mcp__webmcp")).length ? "webmcp+" : ""}${tools.join(",").slice(0, 46)}`,
    runId,
    failure: judge(task, { answer }),
  };
}
