/**
 * Sold out (86) on the phone, the words for it. F-145, coordinator call S195:
 * a drink is 86'd from /cellar, /inventory and the phone, by anyone of the
 * house, and comes back when a person says so or a delivery is booked in.
 *
 * The gateway answers GET/POST /inventory/:house/item/:item/stock-out with
 * the item's open stock-out (or null) and its last ten. A failed read is said
 * as such, never shown as "not sold out" (the web's SoldOutControl rule).
 */

export type StockOutCause = "ran_out" | "broken" | "pulled" | "other";

export interface StockOut {
  id: string;
  cause: StockOutCause;
  note: string | null;
  startedAt: string;
  startedBy: string | null;
  endedAt: string | null;
  endedBy: string | null;
}

export interface StockOutState {
  open: StockOut | null;
  recent: StockOut[];
}

/** The four reasons, in the order the phone offers them. */
export const STOCK_OUT_CHOICES: Array<{ cause: StockOutCause; label: string }> = [
  { cause: "ran_out", label: "Ran out" },
  { cause: "broken", label: "Broken" },
  { cause: "pulled", label: "Pulled" },
  { cause: "other", label: "Other" },
];

const CAUSE_WORDS: Record<StockOutCause, string> = {
  ran_out: "ran out",
  broken: "broken",
  pulled: "pulled",
  other: "other reason",
};

/**
 * One line for the wine's screen. `zone` is the house's time zone; without
 * one the phone's clock stands in.
 */
export function soldOutLine(
  state: StockOutState | undefined,
  readFailed: boolean,
  locale = "en-US",
  zone?: string | null,
): string {
  if (readFailed || !state) {
    return readFailed
      ? "Whether this is sold out could not be read. That is not the same as not sold out."
      : "";
  }
  const open = state.open;
  if (!open) return "Available. Mark it sold out (86) when it runs out.";
  const d = new Date(open.startedAt);
  const tz = zone ? { timeZone: zone } : {};
  const at = Number.isNaN(d.getTime())
    ? String(open.startedAt).slice(0, 16)
    : `${d.toLocaleDateString(locale, { day: "numeric", month: "numeric", ...tz })} ${d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", ...tz })}`;
  const why = CAUSE_WORDS[open.cause] ?? open.cause;
  return `Sold out since ${at}, ${why}${open.note ? ` (${open.note})` : ""}. It comes back when you say so or a delivery is booked in.`;
}
