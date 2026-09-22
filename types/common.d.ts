// Shapes shared by several subpaths. Not a public entry point: import the
// subpath you use ("jev-dom/agent", "jev-dom/core/policy", …) and these come with it.

/** One control the snapshot found, with the identity the executor resolves it by. */
export interface SnapshotElement {
  /** Code-owned node identity; the model only ever picks one of these, never a selector. */
  id: number;
  role: string;
  name: string;
  tag?: string;
  type?: string;
  /** The card, row, shelf or form the control sits in. */
  context?: string;
  value?: string;
  /** checked / pressed / expanded / selected / current, as read off the page. */
  state?: Record<string, string>;
  editable?: boolean;
  inView?: boolean;
  options?: SelectOption[];
}

export interface SelectOption {
  label: string;
  value: string;
  selected?: boolean;
}

/** One atomic read of the page: what a person would see plus every control. */
export interface Snapshot {
  url: string;
  title: string;
  text: string;
  /** The open dialog's name, when one limits the controls to what is inside it. */
  modal: string | null;
  scroll: { y: number; height: number; viewport: number };
  elements: SnapshotElement[];
  /** Controls found but dropped to stay inside `maxElements`. */
  omitted: number;
}

export type Operation = "CLICK" | "TYPE" | "TYPE_SUBMIT" | "SELECT" | "SCROLL_DOWN" | "SCROLL_UP" | "DONE" | "NONE";

/** What may happen to a decided step. See core/policy's `decide`. */
export type Verdict = "act" | "unsure" | "confirm" | "incomplete" | "done" | "none";

/** A snapshot element as the action space indexes it: `index` is what the model answers. */
export interface ActionTarget extends SnapshotElement {
  index: string;
  /** Set on a SELECT target: the one option this entry offers. */
  option?: SelectOption;
  /** Set on a TYPE target that takes a number rather than words. */
  numeric?: boolean;
}

export interface Alternative {
  value: string;
  probability: number;
}

/** One decided step, with a probability behind every part of it. */
export interface Decision {
  op: Operation;
  probability: number;
  alternatives: Alternative[];
  /** The winning target's key in the action space, when the operation is targeted. */
  index?: string;
  target?: ActionTarget;
  targetProbability?: number;
  targetAlternatives?: Alternative[];
  /** The words to type, taken from the user's own request; null when they did not state them. */
  text?: string | null;
  textAlternatives?: Alternative[];
  textProbability?: number;
  /** The least sure part of the step: one wrong part spoils it. */
  confidence: number;
  /** 0..1 — can this request be carried out completely by this one action? */
  singleStep: number;
}

/** What one Jev request answers with. */
export interface JevReply {
  answers: Record<string, JevAnswer>;
  usage: { input_tokens: number };
  model: string;
  ms: number;
}

export interface JevAnswer {
  choice?: string;
  probabilities?: Record<string, number>;
  noul?: number;
}

/** The one call the agent makes per step. `createJev` returns one of these. */
export type Ask = (args: { state: unknown; questions: Record<string, unknown>; signal?: AbortSignal }) => Promise<JevReply>;

/** Anything the agent can drive: Playwright, a Chrome extension, your own bridge. */
export interface PageHost {
  observe(): Promise<Snapshot>;
  act(decision: Decision): Promise<void>;
  settle?(): Promise<void>;
}

/** What `buildStep` produces: the request to send, and the plan `decode` reads the answers with. */
export interface BuiltStep {
  state: Record<string, unknown>;
  questions: Record<string, unknown>;
  plan: StepPlan;
}

export interface StepPlan {
  ops: Record<string, string>;
  targets: Partial<Record<Operation, Record<string, ActionTarget>>>;
  text: Record<string, { qid: string; values: Record<string, string> }>;
}

/** One step already taken, as `runRequest` feeds it back to the next request. */
export interface HistoryEntry {
  step: number;
  op: Operation;
  target?: ActionTarget;
  text?: string | null;
  changed?: boolean;
}
