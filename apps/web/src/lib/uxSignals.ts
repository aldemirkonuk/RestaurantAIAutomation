/**
 * uxSignals — client half of the self-learning UX agent.
 *
 * Reports real interaction friction (rage clicks, dead clicks, slow
 * time-to-interactive) to the UX optimizer so the agent has something to reason
 * over. Ships DARK: does nothing unless VITE_UX_OPTIMIZER === "true".
 *
 * PRIVACY CONTRACT — what leaves the browser is a page key, an event type, an
 * optional element key, and a number. Never text the user typed, never text the
 * app rendered, never a DOM id. `elementKey` will only emit an explicit
 * `data-ux-key`; see the note there for why the fallback is deliberately blunt.
 */

const API_URL = import.meta.env.VITE_API_GATEWAY_URL || "http://localhost:4000";
const ENABLED = import.meta.env.VITE_UX_OPTIMIZER === "true";

const SESSION_KEY = "wineops.ux.session";

/**
 * Groups the signals of one browsing session together. NOT used for rollout
 * bucketing — the server buckets on the authenticated user id, so the same
 * human sees the same UI in every tab and on every device.
 */
export function uxSessionId(): string {
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id =
        (crypto?.randomUUID?.() ??
          Math.random().toString(36).slice(2)) as string;
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return "anon";
  }
}

export interface UxSignal {
  page: string;
  event:
    | "rage_click"
    | "dead_click"
    | "abandon"
    | "slow_tti"
    | "task_success"
    | "task_fail"
    | "error"
    | "nav";
  targetKey?: string;
  value?: number;
  meta?: Record<string, unknown>;
}

/**
 * Fire-and-forget; never throws, never blocks the UI.
 *
 * Uses fetch({keepalive}) rather than sendBeacon: /ux/signals requires a JWT so
 * the server can derive restaurant_id from the token instead of trusting the
 * body, and sendBeacon cannot set an Authorization header. keepalive gives the
 * same "survives page unload" guarantee.
 */
export function reportUxSignal(signal: UxSignal): void {
  if (!ENABLED) return;
  try {
    const token = localStorage.getItem("accessToken");
    if (!token) return; // Unauthenticated: nothing to attribute the signal to.
    void fetch(`${API_URL}/api/v1/ux/signals`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ ...signal, sessionId: uxSessionId() }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* telemetry must never break the app */
  }
}

/**
 * Attach automatic friction detectors (rage + dead clicks) for a page. Returns
 * a cleanup function. No-op when the feature is off.
 */
export function attachFrictionDetectors(page: string): () => void {
  if (!ENABLED || typeof window === "undefined") return () => {};

  // Rage clicks are counted PER ELEMENT. A single shared array counted any three
  // clicks anywhere within 700ms as rage and blamed whichever element the third
  // one happened to land on — so ordinary fast navigation manufactured friction
  // reports against innocent controls, and the agent optimised for a phantom.
  const recent = new Map<string, number[]>();

  const onClick = (e: MouseEvent) => {
    const now = Date.now();
    const el = e.target as HTMLElement | null;
    const key = elementKey(el);

    const times = recent.get(key) ?? [];
    times.push(now);
    while (times.length && now - times[0] > 700) times.shift();
    recent.set(key, times);

    if (times.length >= 3) {
      reportUxSignal({ page, event: "rage_click", targetKey: key });
      recent.set(key, []);
    }

    // Dead click: clicked a non-interactive element that isn't inside a control.
    if (el && !isInteractive(el)) {
      reportUxSignal({ page, event: "dead_click", targetKey: key });
    }
  };

  window.addEventListener("click", onClick, { capture: true });
  return () => {
    recent.clear();
    window.removeEventListener("click", onClick, { capture: true });
  };
}

/** Report first-interactive timing once, comparing to the 1s flow budget. */
export function reportTti(page: string): void {
  if (!ENABLED) return;
  try {
    const nav = performance.getEntriesByType("navigation")[0] as
      | PerformanceNavigationTiming
      | undefined;
    const tti = nav ? nav.domInteractive : performance.now();
    if (tti > 1000)
      reportUxSignal({ page, event: "slow_tti", value: Math.round(tti) });
  } catch {
    /* ignore */
  }
}

function isInteractive(el: HTMLElement): boolean {
  const tag = el.closest(
    "a,button,input,select,textarea,label,[role='button'],[role='link'],[tabindex],[onclick]",
  );
  return !!tag;
}

/**
 * The element's stable agent-facing name, or a coarse bucket.
 *
 * Only `data-ux-key` counts. Two things previously leaked here: DOM ids were
 * preferred over the explicit key and forwarded verbatim, and the fallback
 * emitted class names. Both routinely embed record identifiers
 * (`order-3f9c…`, `wine-row-Chateau-Margaux-2016`) — and this table is written
 * from the browser and read by an LLM, so anything that lands in it should be
 * assumed to be retained and read.
 *
 * The consequence is intended: an element nobody has tagged is not addressable
 * by the agent. Tagging is how a human says "this is a thing you may reason
 * about", and that opt-in is the point.
 */
function elementKey(el: HTMLElement | null): string {
  if (!el) return "unknown";
  const tagged = el.closest?.("[data-ux-key]") as HTMLElement | null;
  const dataKey = tagged?.getAttribute("data-ux-key");
  if (dataKey) return dataKey.slice(0, 120);
  return `untagged:${el.tagName.toLowerCase()}`;
}
