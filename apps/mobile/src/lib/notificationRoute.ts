/**
 * One destination resolver for both entry points into a notification: the push
 * banner and the in-app inbox row.
 *
 * The gateway writes web paths into `action_url` — `/orders?order=…`,
 * `/inventory?verify=…`, `/team?shift=…` and friends (grep `actionUrl:` across
 * `apps/api-gateway/src`). Mobile's routes are named for the tabs, not the web
 * sidebar, so the two vocabularies have to be translated rather than reused.
 *
 * Pure on purpose: this is the part worth testing, and it needs no navigator.
 */

/** Mobile route, or null when nothing better than "stay put" is known. */
export type MobileRoute = string | null;

function idFromQuery(query: string, keys: string[]): string | null {
  const params = new Map<string, string>();
  for (const pair of query.split("&")) {
    if (!pair) continue;
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    params.set(
      decodeURIComponent(pair.slice(0, eq)),
      decodeURIComponent(pair.slice(eq + 1)),
    );
  }
  for (const k of keys) {
    const v = params.get(k);
    if (v) return v;
  }
  return null;
}

/**
 * Translate a web `action_url` into a mobile route.
 * Returns null for web-only destinations (promotions, providers, …) so the
 * caller can decide — the inbox keeps you in the inbox rather than bouncing
 * you to a screen that does not exist yet.
 */
export function routeForActionUrl(actionUrl: string | null | undefined): MobileRoute {
  if (!actionUrl) return null;
  const [rawPath, rawQuery = ""] = actionUrl.split("?");
  const path = rawPath.replace(/\/+$/, "") || "/";
  const segments = path.split("/").filter(Boolean);
  const head = segments[0];

  if (head === "inventory" || head === "wines") {
    // F-1309: "Name the item" (`?name-delivery=<orderId>`) opens that order's
    // receive screen, not the cellar list.
    const verify = idFromQuery(rawQuery, ["verify", "name-delivery"]);
    if (verify) return `/cellar/receive/${verify}`;
    const id = segments[1] ?? idFromQuery(rawQuery, ["highlight", "wineId", "item"]);
    return id ? `/cellar/${id}` : "/cellar";
  }

  if (head === "orders" || head === "receiving") {
    const id =
      segments[1] ?? idFromQuery(rawQuery, ["order", "orderId", "highlight"]);
    return id ? `/supply/${id}` : "/supply";
  }

  // A delivery id is not an order id (F-1309): the tap resolves it to its
  // order (`openNotificationTap`); the inbox row stays put.
  if (head === "deliveries") return null;

  if (head === "team") return "/team";
  if (head === "reports" || head === "recommendations") return "/insights";
  if (head === "notifications") return "/notifications";
  if (head === "settings") return "/settings";
  if (head === "help") return "/help";

  // Everything else is a web-only surface today.
  return null;
}

/**
 * Where an alert card on Today opens (F-1451): the same place its notice opens
 * from the inbox. Its order when it names one, else its `actionUrl` read as
 * the inbox reads it; null keeps the card where it is.
 */
export function alertCardRoute(item: {
  orderId?: string | null;
  actionUrl?: string | null;
}): MobileRoute {
  if (item.orderId) return `/supply/${item.orderId}`;
  return routeForActionUrl(item.actionUrl);
}

/**
 * Destination for a push payload. Prefers the structured ids the mobile feed
 * already carries, then falls back to translating the web `actionUrl`, then to
 * the inbox — never to nowhere, because a tapped banner that does nothing
 * reads as a broken app.
 */
export function routeForNotificationData(
  data: Record<string, any> | null | undefined,
): string {
  const d = data ?? {};
  const type = String(d.type ?? "");
  const orderId = d.orderId ?? d.order_id;

  if (type === "invoice_received" && orderId) return `/cellar/receive/${orderId}`;
  // F-1309: "Name the item" carries its orderId too; it opens the receive
  // screen for that order, not the order page, which has no such control.
  if (type === "delivery_item_to_name" && orderId) return `/cellar/receive/${orderId}`;
  if (orderId) return `/supply/${orderId}`;
  // F-1572: a manager's week note opens the inbox, where its words are. The
  // Team tab shows tonight's shift only, never the note (the week view on
  // the phone is the F-591 build).
  if (type === "team_note") return "/notifications";

  const inventoryId = d.inventoryId ?? d.inventory_id;
  if (inventoryId) return `/cellar/${inventoryId}`;

  return routeForActionUrl(d.actionUrl ?? d.action_url) ?? "/notifications";
}

/**
 * The delivery a push names when it carries no order id (F-1309): the
 * delivery clock, a lapse and a vendor's proposal send `/deliveries/<id>` with
 * `deliveryId` only. The tap reads that delivery's order before opening it.
 */
export function deliveryToResolve(data: Record<string, any> | null | undefined): string | null {
  const d = data ?? {};
  if (d.orderId ?? d.order_id) return null;
  const url = String(d.actionUrl ?? d.action_url ?? "");
  const fromUrl = /^\/deliveries\/([^/?#]+)/.exec(url)?.[1] ?? null;
  const id = d.deliveryId ?? d.delivery_id ?? fromUrl;
  return url.startsWith("/deliveries/") && typeof id === "string" && id ? id : null;
}

/**
 * Open a tapped notification in the house it belongs to (F-523).
 *
 * A person in two houses gets both houses' pushes on one phone, and the
 * gateway names the house in the push data (`restaurantId`). A push of
 * another house is not opened under this one, where its order cannot load:
 * the session moves to that house first, and only then is the screen opened.
 * When the move is refused, nothing is opened and the person is told why.
 * A push that names no house opens as before.
 *
 * F-1724: a session that names no house yet (a two-house owner signed in and
 * sent to the house chooser) moves to the push's house too — under no house,
 * every read on the order is refused and the screen can never load.
 */
export async function openNotificationTap(
  data: Record<string, any> | null | undefined,
  deps: {
    currentHouse: string | null | undefined;
    chooseHouse: (houseId: string) => Promise<boolean>;
    navigate: (route: string) => void;
    refused: (message: string) => void;
    /** The order a delivery belongs to, or null when it has none or the read failed. */
    deliveryOrder?: (deliveryId: string) => Promise<string | null>;
    /** The order whose count is open and unsaved on this phone (F-1452). */
    unsavedCount?: () => string | null;
    /** Asks the person whether to leave that count; true = leave it. */
    confirmLeaveCount?: () => Promise<boolean>;
  },
): Promise<void> {
  const d = data ?? {};
  const raw = d.restaurantId ?? d.restaurant_id;
  const house = typeof raw === "string" && raw.length > 0 ? raw : null;
  let route = routeForNotificationData(d);
  if (house && house !== deps.currentHouse) {
    // Moving house clears everything read under this one, and a count being
    // typed in is lost with it (F-1452). The person is asked first; "stay"
    // opens nothing.
    if (deps.unsavedCount?.() && deps.confirmLeaveCount) {
      const leave = await deps.confirmLeaveCount().catch(() => false);
      if (!leave) return;
    }
    const moved = await deps.chooseHouse(house).catch(() => false);
    if (!moved) {
      deps.refused(
        "This notice is from another of your restaurants, and that restaurant could not be opened just now. Nothing was opened. Try the notice again in a moment.",
      );
      return;
    }
  }
  // Read in the delivery's own house, after the move above. A delivery with
  // no order, or a read that failed, leaves the tap on the inbox.
  const deliveryId = deliveryToResolve(d);
  if (deliveryId && deps.deliveryOrder) {
    const order = await deps.deliveryOrder(deliveryId).catch(() => null);
    if (order) route = `/supply/${order}`;
  }
  deps.navigate(route);
}

/**
 * The order whose delivery count is open and not yet saved on this phone
 * (F-1452). The receive screen holds its figures in its own state, so it says
 * here while it has some; a push from another house asks before moving.
 */
let unsavedCountOrder: string | null = null;

export function holdUnsavedCount(orderId: string | null): void {
  unsavedCountOrder = orderId;
}

/** Let go of the hold, only when it is still this order's. */
export function releaseUnsavedCount(orderId: string): void {
  if (unsavedCountOrder === orderId) unsavedCountOrder = null;
}

export function unsavedCount(): string | null {
  return unsavedCountOrder;
}

/** What the phone asks before leaving a count for another house's notice. */
export const LEAVE_COUNT_WORDS = {
  title: "Leave this count?",
  message:
    "This notice is from another of your restaurants. Opening it leaves the delivery you are counting, and the numbers you entered are not saved.",
  stay: "Keep counting",
  leave: "Open the notice",
} as const;
