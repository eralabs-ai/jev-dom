// The field gate for generated text. Jev picks a span of the user's own words
// when the request has one; when it does not, a small model may write a TASK
// value (a search term, a city, a quantity) for a field this gate lets
// through. It never writes identity: who the user is, how to reach them, what
// they pay with. Those fields stay `incomplete`, exactly as without a helper.
//
// Deny is judged first and on every signal there is (type, autocomplete,
// format, pattern, name, path, description); allow is judged on the field's
// own name and role only. Anything else abstains: an unlabelled textbox or a
// message box never gets invented text. This runs in code before any model is
// asked; a prompt that repeats the rule is a second layer, never the first.

const IDENTITY_TYPES = new Set(["password", "email", "tel"]);
const IDENTITY_FORMATS = new Set(["email", "uri", "url", "tel", "phone", "password", "hostname", "ipv4", "ipv6", "uuid"]);

// Word-bounded: "term" must not match "terms of service" and "to" must not match "tomato".
const IDENTITY_WORDS =
  /\b(e[ -]?mail|password|passcode|pin|otp|verification code|phone|tel|telephone|mobile|(?:first|last|full|user)[ -]?name|username|login|sign ?in|address|street|shipping|billing|zip|postal|card|cvv|cvc|expiry|expiration|iban|account number|ssn|tax id|date of birth|dob|company)\b/i;

const TASK_ROLES = new Set(["searchbox", "spinbutton"]);
const TASK_WORDS =
  /\b(search|find|filter|query|keywords?|q|term|city|destination|origin|from|to|where|date|when|quantity|qty|amount|count|product|item|topic|subject|size|colou?r)\b/i;

// A pattern that demands a long run of digits is a card or phone mask.
const DIGIT_MASK = /(?:\\d|\[0-9\])\{(?:[7-9]|1\d|2\d)(?:,\d*)?\}|(?:(?:\\d|\[0-9\])[ -]?){7,}/;

// Path and identifier punctuation becomes spaces so `\b` sees words; hyphens stay, "e-mail" is one word.
const words = (value) => String(value ?? "").replace(/[._/[\]]+/g, " ");

/**
 * May a generated value go into this field?
 *
 * @param field  a DOM target ({ name, role, type, autocomplete, context }) or a
 *               WebMCP parameter ({ name, path, description, format, pattern, kind })
 * @returns {{ ok: true } | { ok: false, reason: "identity" | "not-task-field" }}
 */
export function fillable(field) {
  if (!field) return { ok: false, reason: "not-task-field" };
  const identity = { ok: false, reason: "identity" };

  if (IDENTITY_TYPES.has(field.type)) return identity;
  if (IDENTITY_FORMATS.has(String(field.format ?? "").toLowerCase())) return identity;
  const tokens = String(field.autocomplete ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.some((t) => t !== "off" && t !== "on")) return identity;
  if (field.pattern && DIGIT_MASK.test(String(field.pattern))) return identity;
  const own = [field.name, field.label, field.path].map(words).join(" ");
  if (IDENTITY_WORDS.test(`${own} ${words(field.description)}`)) return identity;

  const numeric = field.numeric || field.kind === "number" || field.type === "number" || field.type === "range";
  if (numeric || TASK_ROLES.has(field.role) || TASK_WORDS.test(own)) return { ok: true };
  return { ok: false, reason: "not-task-field" };
}
