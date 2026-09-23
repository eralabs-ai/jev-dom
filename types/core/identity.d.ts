/** Why a field may not take generated text. */
export type NotFillable = "identity" | "not-task-field";

/** A DOM target or a WebMCP parameter, as the gate reads it. Every field is optional: absent means "unknown". */
export interface GateField {
  name?: string | null;
  label?: string | null;
  role?: string | null;
  /** The input's `type` attribute. */
  type?: string | null;
  /** The input's `autocomplete` attribute: any token but `off` / `on` is identity. */
  autocomplete?: string | null;
  /** A WebMCP parameter's path label, e.g. `legs[0].destination`. */
  path?: string | null;
  description?: string | null;
  /** JSON Schema `format` / `pattern`. */
  format?: string | null;
  pattern?: string | null;
  /** A number field, however it was detected. */
  numeric?: boolean;
  kind?: "span" | "number" | string;
}

/**
 * May a generated value go into this field? Identity (who the user is, how to
 * reach them, what they pay with) is denied first; a search, place, date or
 * quantity field is allowed; anything else abstains.
 */
export declare function fillable(field: GateField | null | undefined): { ok: true } | { ok: false; reason: NotFillable };
