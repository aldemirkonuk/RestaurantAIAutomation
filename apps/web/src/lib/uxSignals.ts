/**
 * uxSignals — client half of the self-learning UX agent.
 *
 * Reports real interaction friction (rage clicks, dead clicks, slow
 * time-to-interactive) to the UX optimizer so the agent has something to reason
 * over. Ships DARK: does nothing unless VITE_UX_OPTIMIZER === "true". No PII is
 * sent — only a page key, an event type, an optional element key, and a value.
 */

const API_URL = import.meta.env.VITE_API_GATEWAY_URL || "http://localhost:4000";
const ENABLED = import.meta.env.VITE_UX_OPTIMIZER === "true";

const SESSION_KEY = "wineops.ux.session";

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
  restaurantId?: string;
  meta?: Record<string, unknown>;
}

/** Fire-and-forget; never throws, never blocks the UI. */
export function reportUxSignal(signal: UxSignal): void {
  if (!ENABLED) return;
  try {
    const body = JSON.stringify({ ...signal, sessionId: uxSessionId() });
    const url = `${API_URL}/api/v1/ux/signals`;
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
    } else {
      void fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => {});
    }
  } catch {
    /* telemetry must never break the app */
  }
}

/**
 * Attach automatic friction detectors (rage + dead clicks) for a page. Returns
 * a cleanup function. No-op when the feature is off.
 */
export function attachFrictionDetectors(
  page: string,
  restaurantId?: string,
): () => void {
  if (!ENABLED || typeof window === "undefined") return () => {};

  const clickTimes: number[] = [];
  const onClick = (e: MouseEvent) => {
    const now = Date.now();
    // Rage click: 3+ clicks within 700ms.
    clickTimes.push(now);
    while (clickTimes.length && now - clickTimes[0] > 700) clickTimes.shift();
    const el = e.target as HTMLElement | null;
    const key = elementKey(el);
    if (clickTimes.length >= 3) {
      reportUxSignal({ page, event: "rage_click", targetKey: key, restaurantId });
      clickTimes.length = 0;
    }
    // Dead click: clicked a non-interactive element that isn't inside a control.
    if (el && !isInteractive(el)) {
      reportUxSignal({ page, event: "dead_click", targetKey: key, restaurantId });
    }
  };

  window.addEventListener("click", onClick, { capture: true });
  return () => window.removeEventListener("click", onClick, { capture: true });
}

/** Report first-interactive timing once, comparing to the 1s flow budget. */
export function reportTti(page: string, restaurantId?: string): void {
  if (!ENABLED) return;
  try {
    const nav = performance.getEntriesByType("navigation")[0] as
      | PerformanceNavigationTiming
      | undefined;
    const tti = nav ? nav.domInteractive : performance.now();
    if (tti > 1000)
      reportUxSignal({ page, event: "slow_tti", value: Math.round(tti), restaurantId });
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

function elementKey(el: HTMLElement | null): string {
  if (!el) return "unknown";
  if (el.id) return `#${el.id}`;
  const dataKey = el.getAttribute?.("data-ux-key");
  if (dataKey) return dataKey;
  const cls = (el.className || "").toString().split(/\s+/).slice(0, 2).join(".");
  return `${el.tagName.toLowerCase()}${cls ? "." + cls : ""}`.slice(0, 80);
}
