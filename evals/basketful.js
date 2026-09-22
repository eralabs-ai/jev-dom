// The Basketful WebMCP demo as a test bed. It exposes the same shopping
// actions twice: as WebMCP tools (what jev-webmcp-extension drives) and as an
// ordinary UI (what the DOM agent drives). The sentences and expected calls
// are jev-webmcp-extension's own eval set (evals/run.js).
//
// Every case is judged by what changed in the app, not by what was predicted:
// the expected WebMCP call is executed once as the REFERENCE, and each arm
// must reach the same observable outcome from the same seeded start.

export const SITE = "https://shopping-webmcp-demo.netlify.app";
export const STORAGE_KEY = "basketful:v1";
// Delivery windows are computed from the clock, so every context runs at the
// same fixed local time: 6pm leaves one window tonight and six tomorrow.
export const CLOCK = { time: "2026-09-22T18:00:00-06:00", timezoneId: "America/Denver" };

const ADDRESS = { street: "742 Evergreen Terrace", unit: "", city: "Springfield", zip: "94110", instructions: "" };
const GREENLEAF = ["choose_store", { store: "Greenleaf Market" }];
const SOME_ITEMS = ["add_to_cart", { items: [{ product: "Whole Milk", quantity: 2 }, { product: "Large Eggs" }, { product: "Bananas", quantity: 4 }] }];
const withAddress = { patch: (state) => ({ ...state, address: ADDRESS }) };
const TOMORROW_8 = ["set_delivery_options", { delivery_window: "Tomorrow 8am–10am" }];

// ---- outcome checks: (outcome, reference, start, evidence) -> null when it passes, else why not

const sorted = (o) => JSON.stringify(Object.fromEntries(Object.entries(o ?? {}).sort()));
const cartOf = (o) => o.carts.greenleaf ?? {};
const cartText = (o) => Object.entries(cartOf(o)).map(([id, n]) => `${id}×${n}`).join(", ") || "empty";
const sameCart = (a, b) => sorted(cartOf(a)) === sorted(cartOf(b));

const CHECKS = {
  results: (o, ref) =>
    JSON.stringify(o.results) === JSON.stringify(ref.results)
      ? null
      : `shows [${o.results.join(", ") || "no results"}], expected [${ref.results.join(", ")}]`,
  store: (o, ref) => (o.storeId === ref.storeId && o.path === ref.path ? null : `store ${o.storeId} at ${o.path}, expected ${ref.storeId} at ${ref.path}`),
  cart: (o, ref) => (sameCart(o, ref) ? null : `cart ${cartText(o)}, expected ${cartText(ref)}`),
  path: (o, ref) => (o.path === ref.path ? null : `at ${o.path}, expected ${ref.path}`),
  cartShown: (o) => (o.cartOpen ? null : "the cart is not open"),
  // Informational: the order page (the tool's own navigation) or the order
  // list both show the order's stage, so either answers "where's my order?".
  orderShown: (o, ref) => (o.path === ref.path || o.path === "/orders" ? null : `at ${o.path}, expected ${ref.path} or /orders`),
  morning: (o) => (/^Tomorrow (8am–10am|10am–12pm)$/.test(o.windowId ?? "") ? null : `delivery window is ${o.windowId ?? "unset"}`),
  ordered: (o, _ref, start) => (o.orders.length === start.orders.length + 1 ? null : `${o.orders.length - start.orders.length} new orders`),
  // The user can see what the salmon dinner needs, and nothing was bought:
  // the extension shows the tool's text; the DOM agent opens the recipe's plan.
  salmonPlan: (o, _ref, start, evidence) => {
    if (!sameCart(o, start)) return `the cart changed to ${cartText(o)}`;
    if (o.path === "/recipes/sheet-pan-salmon") return null;
    if (/Sheet-Pan Salmon/.test(evidence?.result ?? "") && /preview/.test(evidence.result)) return null;
    return `neither shows the salmon plan (at ${o.path})`;
  },
  // Nothing to do: acting at all fails, even if the cart and path survive it.
  untouched: (o, _ref, start, evidence) => {
    if (evidence?.acted) return `it acted: ${evidence.acted}`;
    return o.path === start.path && sameCart(o, start) && !o.cartOpen && o.orders.length === start.orders.length ? null : `the page changed (at ${o.path}, cart ${cartText(o)})`;
  },
};

const c = (id, said, expected, setup, start, check) => ({ id, said, expected, setup, start, check });

export const CASES = [
  c("bakery-gf", "got anything gluten free in the bakery aisle?", ["search_products", { department: "Bakery", dietary: ["gluten-free"] }], [GREENLEAF], "/store/greenleaf", "results"),
  c("vegan-snacks", "vegan snacks", ["search_products", { department: "Snacks", dietary: ["vegan"] }], [GREENLEAF], "/store/greenleaf", "results"),
  c("oat-milk-under-5", "find oat milk under five bucks", ["search_products", { query: "oat milk", max_price: 5 }], [GREENLEAF], "/store/greenleaf", "results"),
  c("cheap-store", "let's shop at the cheap one", ["choose_store", { store: "Penny Pantry" }], [], "/", "store"),
  c("co-op", "switch to the co-op", ["choose_store", { store: "Harbor Foods Co-op" }], [GREENLEAF], "/store/greenleaf", "store"),
  c("two-oat-milk", "throw in two cartons of oat milk", ["add_to_cart", { items: [{ product: "oat milk", quantity: 2 }] }], [GREENLEAF], "/store/greenleaf", "cart"),
  c("avocado", "add an avocado", ["add_to_cart", { items: [{ product: "avocado" }] }], [GREENLEAF], "/store/greenleaf", "cart"),
  c("three-bananas", "make it three bananas instead", ["update_cart_item", { product: "bananas", quantity: 3 }],
    [GREENLEAF, ["add_to_cart", { items: [{ product: "Bananas", quantity: 1 }, { product: "Whole Milk" }] }]], "/store/greenleaf", "cart"),
  c("usual", "the usual please", ["add_staples_to_cart", {}],
    [GREENLEAF, ["update_staples", { items: [{ product: "Whole Milk", quantity: 1 }, { product: "Large Eggs", quantity: 1 }, { product: "Bananas", quantity: 6 }] }]], "/store/greenleaf", "cart"),
  c("tacos", "I want to make tacos tonight", ["add_recipe_to_cart", { recipe: "Weeknight Beef Tacos" }], [GREENLEAF], "/store/greenleaf", "cart"),
  c("salmon-preview", "what would I need to buy for the salmon dinner?", ["add_recipe_to_cart", { recipe: "Sheet-Pan Salmon & Broccoli", preview: true }], [GREENLEAF], "/store/greenleaf", "salmonPlan"),
  c("show-cart", "what's in my cart?", ["get_cart", {}], [GREENLEAF, SOME_ITEMS], "/store/greenleaf", "cartShown"),
  c("order-status", "where's my order?", ["get_order_status", {}],
    [GREENLEAF, SOME_ITEMS, ["start_checkout", {}], withAddress, TOMORROW_8, ["place_order", {}]], "/store/greenleaf", "orderShown"),
  c("checkout", "I'm ready to check out", ["start_checkout", {}], [GREENLEAF, SOME_ITEMS], "/store/greenleaf", "path"),
  c("tomorrow-morning", "deliver it tomorrow morning", ["set_delivery_options", { delivery_window: "Tomorrow 8am–10am" }],
    [GREENLEAF, SOME_ITEMS, ["start_checkout", {}], withAddress], "/store/greenleaf/checkout", "morning"),
  { ...c("buy-it", "ok buy it", ["place_order", {}], [GREENLEAF, SOME_ITEMS, ["start_checkout", {}], withAddress, TOMORROW_8], "/store/greenleaf/checkout", "ordered"), commits: true },
  c("joke", "tell me a joke", null, [GREENLEAF], "/store/greenleaf", "untouched"),
];

// Guards every case shares: nothing the request didn't ask for may happen.
export function judge(kase, outcome, reference, start, evidence) {
  if (outcome.orders.length > reference.orders.length) return "placed an order nobody asked for";
  if (sameCart(reference, start) && !sameCart(outcome, start)) return `changed the cart to ${cartText(outcome)}, which the request did not ask for`;
  return CHECKS[kase.check](outcome, reference, start, evidence);
}

/** The simulated user says yes to a commitment (order, payment) only when their request asked for one. */
export const acceptsCommitment = (kase) => kase.commits === true;

/** What the shopper can see and what the app stored, read inside the page. */
export function captureOutcome(storageKey) {
  const state = JSON.parse(localStorage.getItem(storageKey) || "null") || {};
  return {
    path: location.pathname,
    query: Object.fromEntries(new URLSearchParams(location.search)),
    storeId: state.storeId ?? null,
    carts: state.carts ?? {},
    windowId: state.checkout?.windowId ?? null,
    orders: (state.orders ?? []).map((o) => o.id),
    results: [...document.querySelectorAll(".product-grid .product-name")].map((e) => e.textContent.trim()).sort(),
    cartOpen: Boolean(document.querySelector("dialog.cart-drawer")?.open),
  };
}
