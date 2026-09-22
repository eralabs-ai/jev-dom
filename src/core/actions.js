// A page snapshot -> the indexed element table the model reads, plus the
// targets each operation may choose from. One index per real DOM node; an
// operation is only offered when the page has something it can act on.

export const OPERATIONS = {
  CLICK: "Click one element: a button, link, tab, filter chip, checkbox, radio option, or menu item.",
  TYPE: "Type text into a field without submitting it (more fields to fill first, or a suggestion to pick next).",
  TYPE_SUBMIT: "Type text into a field and press Enter to submit it, like a search box.",
  SELECT: "Choose an option in a dropdown.",
  SCROLL_DOWN: "Scroll down to reveal more of the page.",
  SCROLL_UP: "Scroll back up.",
  DONE: "The request is carried out: the page now shows what the user asked for, or the change they asked for has been made.",
  NONE: "Nothing on this page can carry out the request, or it is conversation, unclear, or unfinished.",
};

// Operations whose target is chosen by a speculative target head.
export const TARGETED = { CLICK: "click", TYPE: "type", TYPE_SUBMIT: "type", SELECT: "select" };

const STATE_WORDS = {
  checked: { true: "checked", false: "not checked", mixed: "partly checked" },
  pressed: { true: "pressed", false: "not pressed", mixed: "partly pressed" },
  expanded: { true: "expanded", false: "collapsed" },
  selected: { true: "selected" },
};

function stateOf(el) {
  const out = [];
  for (const [key, value] of Object.entries(el.state ?? {})) {
    if (key === "current") out.push(value === "true" ? "current" : `current ${value}`);
    else if (STATE_WORDS[key]?.[value]) out.push(STATE_WORDS[key][value]);
  }
  return out;
}

/** `[12] button "Add Bananas to cart" (pressed) · in Produce › $0.29 Bananas each` */
export function describe(el, index = el.index) {
  const parts = [`[${index}] ${el.role} "${el.name}"`];
  if (el.value) parts.push(`= "${el.value}"`);
  const state = stateOf(el);
  if (state.length) parts.push(`(${state.join(", ")})`);
  if (el.context) parts.push(`· in ${el.context}`);
  return parts.join(" ");
}

const isNumeric = (el) => el.role === "spinbutton" || el.type === "number";

export function actionSpace(snapshot, { maxTextFields = 6 } = {}) {
  const elements = snapshot.elements.map((el, i) => ({ ...el, index: String(i + 1) }));
  const click = {};
  const type = {};
  const select = {};
  for (const el of elements) {
    if (el.tag === "select") {
      el.options?.forEach((option, k) => {
        if (!option.selected) select[`${el.index}:${k + 1}`] = { ...el, option };
      });
    } else if (el.editable) {
      type[el.index] = { ...el, numeric: isNumeric(el) };
      if (el.role === "combobox") click[el.index] = el;
    } else {
      click[el.index] = el;
    }
  }

  const ops = {};
  if (Object.keys(click).length) ops.CLICK = OPERATIONS.CLICK;
  if (Object.keys(type).length) Object.assign(ops, { TYPE: OPERATIONS.TYPE, TYPE_SUBMIT: OPERATIONS.TYPE_SUBMIT });
  if (Object.keys(select).length) ops.SELECT = OPERATIONS.SELECT;
  const { y, height, viewport } = snapshot.scroll ?? {};
  if (y + viewport < height - 4) ops.SCROLL_DOWN = OPERATIONS.SCROLL_DOWN;
  if (y > 0) ops.SCROLL_UP = OPERATIONS.SCROLL_UP;
  ops.DONE = OPERATIONS.DONE;
  ops.NONE = OPERATIONS.NONE;

  // Text heads are speculative too: one per field, visible fields first.
  const textFields = Object.values(type)
    .sort((a, b) => Number(b.inView) - Number(a.inView))
    .slice(0, maxTextFields);

  return { elements, ops, targets: { CLICK: click, TYPE: type, TYPE_SUBMIT: type, SELECT: select }, textFields };
}
