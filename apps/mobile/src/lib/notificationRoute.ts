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
    const verify = idFromQuery(rawQuery, ["verify"]);
    if (verify) return `/cellar/receive/${verify}`;
    const id = segments[1] ?? idFromQuery(rawQuery, ["highlight", "wineId", "item"]);
    return id ? `/cellar/${id}` : "/cellar";
  }

  if (head === "orders" || head === "receiving") {
    const id =
      segments[1] ?? idFromQuery(rawQuery, ["order", "orderId", "highlight"]);
    return id ? `/supply/${id}` : "/supply";
  }

  if (head === "team") return "/team";
  if (head === "reports" || head === "recommendations") return "/insights";
  if (head === "notifications") return "/notifications";
  if (head === "settings") return "/settings";
  if (head === "help") return "/help";

  // Everything else is a web-only surface today.
  return null;
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
  if (orderId) return `/supply/${orderId}`;

  const inventoryId = d.inventoryId ?? d.inventory_id;
  if (inventoryId) return `/cellar/${inventoryId}`;

  return routeForActionUrl(d.actionUrl ?? d.action_url) ?? "/notifications";
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
 */
export async function openNotificationTap(
  data: Record<string, any> | null | undefined,
  deps: {
    currentHouse: string | null | undefined;
    chooseHouse: (houseId: string) => Promise<boolean>;
    navigate: (route: string) => void;
    refused: (message: string) => void;
  },
): Promise<void> {
  const d = data ?? {};
  const raw = d.restaurantId ?? d.restaurant_id;
  const house = typeof raw === "string" && raw.length > 0 ? raw : null;
  const route = routeForNotificationData(d);
  if (house && deps.currentHouse && house !== deps.currentHouse) {
    const moved = await deps.chooseHouse(house).catch(() => false);
    if (!moved) {
      deps.refused(
        "This notice is from another of your restaurants, and that restaurant could not be opened just now. Nothing was opened. Try the notice again in a moment.",
      );
      return;
    }
  }
  deps.navigate(route);
}
