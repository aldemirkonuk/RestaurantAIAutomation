/**
 * WHEN A HOUSE IS DUE TO READ A NEWER MENU (menu r104 g1).
 *
 * A read already takes a cadence tag (weekly, monthly, quarterly, yearly) and
 * nothing ever used it. The cadence of the CURRENT menu is the one that
 * counts: a menu made current weeks ago and kept monthly is due once a month
 * of days has passed on the HOUSE's clock, and overdue at one and a half
 * times that. No cadence, or "none", says nothing: the house never said it
 * wants a reminder, so none is made up (ADR 0067).
 *
 * Pure: the instant and the zone come in as arguments, so the spec runs the
 * same code production does. Days are counted on the house's own calendar day
 * (a clock in another zone must not move the day), the same rule
 * menu-clock.ts keeps on the page.
 */
import type { MenuCadence } from "./dto/import-menu.dto";

export type MenuDueState = "ok" | "due" | "overdue";

/** The days one period of each cadence is (a fixed count, so a month is never a calendar guess). */
export const CADENCE_DAYS: Record<Exclude<MenuCadence, "none">, number> = {
  weekly: 7,
  monthly: 30,
  quarterly: 91,
  yearly: 365,
};

/** Overdue at this many periods (1.5x), due at 1x. */
const OVERDUE_AT = 1.5;

/** The house-calendar day of an instant as whole days since 1970-01-01 (a bad zone reads UTC). */
function houseDayNumber(at: Date, zone: string | null): number {
  let tz: string | undefined;
  if (zone) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: zone });
      tz = zone;
    } catch {
      tz = undefined;
    }
  }
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz ?? "UTC", year: "numeric", month: "2-digit", day: "2-digit" });
  const p: Record<string, string> = {};
  for (const part of f.formatToParts(at)) p[part.type] = part.value;
  return Math.floor(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)) / 86_400_000);
}

export interface MenuDue {
  state: MenuDueState;
  cadence: Exclude<MenuCadence, "none">;
  /** Whole house-calendar days since the menu was made current. */
  daysSince: number;
}

/**
 * `null` = nothing to say: no cadence, "none", or a menu with no moment it was
 * made current (never guess one).
 */
export function menuDueState(
  cadence: MenuCadence | string | null | undefined,
  madeCurrentAt: string | null | undefined,
  now: Date,
  zone: string | null,
): MenuDue | null {
  if (!cadence || cadence === "none" || !(cadence in CADENCE_DAYS)) return null;
  if (!madeCurrentAt) return null;
  const made = new Date(madeCurrentAt);
  if (Number.isNaN(made.getTime())) return null;
  const c = cadence as Exclude<MenuCadence, "none">;
  const daysSince = houseDayNumber(now, zone) - houseDayNumber(made, zone);
  const period = CADENCE_DAYS[c];
  const state: MenuDueState = daysSince >= period * OVERDUE_AT ? "overdue" : daysSince >= period ? "due" : "ok";
  return { state, cadence: c, daysSince };
}
