/**
 * A figure in the house's own money, grouped the house's way (F-885).
 *
 * The phone printed `$` with en-US grouping on every money figure — the
 * Today strip, Insights, a wine's cost, an order's amount — so a lira house
 * read "$12,400" about lira. This mirrors the gateway's `houseMoney`
 * (`apps/api-gateway/src/common/house-money.ts`): the code is the house's
 * `restaurants.currency` and the locale its formats tag, both sent on
 * `/mobile/today-pulse`. No currency recorded prints the figure with no
 * symbol, never a dollar; no locale keeps en-US grouping, as before.
 *
 * Pure: no network, no clock.
 */
export interface HouseMoneyFrame {
  currency: string | null;
  locale: string | null;
}

export function houseMoney(
  value: number,
  frame: Partial<HouseMoneyFrame> | null | undefined,
  opts: { maxFractionDigits?: number } = {},
): string {
  const locale = usableLocale(frame?.locale);
  const body = Number(value).toLocaleString(locale, {
    maximumFractionDigits: opts.maxFractionDigits ?? 0,
  });
  const raw = frame?.currency;
  const code = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  if (!/^[A-Z]{3}$/.test(code)) return body;
  try {
    const parts = new Intl.NumberFormat(locale, {
      style: "currency",
      currency: code,
    }).formatToParts(1);
    // Keep the symbol and its spacing where the locale puts them; the number is ours.
    const numeric = new Set(["integer", "group", "decimal", "fraction"]);
    const first = parts.findIndex((p) => numeric.has(p.type));
    let last = first;
    parts.forEach((p, i) => {
      if (numeric.has(p.type)) last = i;
    });
    if (first < 0) return `${code} ${body}`;
    const before = parts.slice(0, first).map((p) => p.value).join("");
    const after = parts.slice(last + 1).map((p) => p.value).join("");
    return `${before}${body}${after}`;
  } catch {
    return `${code} ${body}`;
  }
}

/** The tag when this runtime formats with it; else en-US, the old default. */
export function usableLocale(tag: string | null | undefined): string {
  if (typeof tag !== "string" || !tag.trim()) return "en-US";
  try {
    return Intl.NumberFormat.supportedLocalesOf([tag.trim()]).length > 0
      ? tag.trim()
      : "en-US";
  } catch {
    return "en-US";
  }
}

// ── The house's other formats (F-953, F-955) ─────────────────────────
// Times, decimals and typed prices follow the same formats tag as money, so a
// Turkish house reads "19:00" and "2,5/day", and its "1.250" is ₺1250.

/** A plain figure with the house's decimal mark: "2,5" in a Turkish house. */
export function houseDecimal(
  value: number,
  locale: string | null | undefined,
  fractionDigits = 1,
): string {
  return Number(value).toLocaleString(usableLocale(locale), {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

/**
 * A clock time the house's way (F-953). "HH:MM[:SS]" is a wall-clock time and
 * is never shifted by a zone; anything else is read as an instant. A house on
 * a 24-hour clock reads "19:00" and "07:30"; one on a 12-hour clock keeps the
 * short "7pm".
 * No locale keeps the 12-hour form, as before.
 */
export function houseClock(
  value: string | Date | null | undefined,
  locale: string | null | undefined,
): string {
  if (value == null || value === "") return "";
  const hm = typeof value === "string" ? /^(\d{2}):(\d{2})/.exec(value) : null;
  const at = hm
    ? new Date(Date.UTC(1970, 0, 1, Number(hm[1]), Number(hm[2])))
    : value instanceof Date
      ? value
      : new Date(value);
  if (isNaN(at.getTime())) return "";
  const tag = usableLocale(locale);
  const opts: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
    ...(hm ? { timeZone: "UTC" } : {}),
  };
  const twelveHour = new Intl.DateTimeFormat(tag, opts)
    .formatToParts(at)
    .some((p) => p.type === "dayPeriod");
  if (!twelveHour) return at.toLocaleTimeString(tag, { ...opts, hour: "2-digit" });
  const h = hm ? at.getUTCHours() : at.getHours();
  const m = hm ? at.getUTCMinutes() : at.getMinutes();
  const suffix = h >= 12 ? "pm" : "am";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour12}${suffix}` : `${hour12}:${String(m).padStart(2, "0")}${suffix}`;
}

export type GroupMark = "." | ",";

/** The mark the house groups thousands with, or null when unknown or neither. */
export function houseGroupMark(locale: string | null | undefined): GroupMark | null {
  if (typeof locale !== "string" || !locale.trim()) return null;
  try {
    const part = new Intl.NumberFormat(usableLocale(locale))
      .formatToParts(1234567)
      .find((p) => p.type === "group");
    return part?.value === "." || part?.value === "," ? part.value : null;
  } catch {
    return null;
  }
}

/**
 * A price the manager TYPED, read with the house's marks (F-955; the phone
 * instance of F-358). The phone read "1.250" as 1.25 and "1.250,00" as NaN.
 * The rule is the web's `apps/web/src/lib/parseDecimal.ts`:
 *   - both marks present: the later one is the decimal mark;
 *   - one mark written more than once: it groups thousands;
 *   - one mark written once before exactly three digits ("1.250") is the one
 *     ambiguous shape: it groups when the house groups with that mark, and is
 *     a decimal mark when the house groups with the other one. When the house's
 *     mark is not known the figure is refused with a sentence, never guessed;
 *   - groups must be real: "1.2.3" is not a number.
 * Blank is `value: null`; a figure below zero is refused.
 */
export function readHousePrice(
  raw: string,
  locale: string | null | undefined,
): { ok: true; value: number | null } | { ok: false; problem: string } {
  const s = raw.replace(/[\s\u00a0\u202f]/g, "").replace(/^[$€₺£¥]+|[$€₺£¥]+$/g, "");
  if (s === "") return { ok: true, value: null };
  const notANumber = {
    ok: false as const,
    problem: `“${raw.trim()}” is not a price. Type it like 1250 or 12,50.`,
  };
  if (!/^[\d.,]+$/.test(s)) return notANumber;
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  let groupMark: GroupMark | null = null;
  let decimalAt = -1;
  if (lastDot >= 0 && lastComma >= 0) {
    decimalAt = Math.max(lastDot, lastComma);
    groupMark = lastDot > lastComma ? "," : ".";
  } else if (lastDot >= 0 || lastComma >= 0) {
    const mark: GroupMark = lastDot >= 0 ? "." : ",";
    const at = Math.max(lastDot, lastComma);
    if (s.indexOf(mark) !== at) {
      groupMark = mark;
    } else {
      const ambiguous = /^\d{3}$/.test(s.slice(at + 1)) && /^[1-9]\d{0,2}$/.test(s.slice(0, at));
      const house = houseGroupMark(locale);
      if (ambiguous && house === null) {
        return {
          ok: false,
          problem: `“${raw.trim()}” could be a thousand or more, or a small figure. Type it without a thousands mark, like 1250 or 1,25.`,
        };
      }
      if (ambiguous && house === mark) groupMark = mark;
      else decimalAt = at;
    }
  }
  const intRaw = decimalAt >= 0 ? s.slice(0, decimalAt) : s;
  const frac = decimalAt >= 0 ? s.slice(decimalAt + 1) : "";
  if (!/^\d*$/.test(frac)) return notANumber;
  let intPart: string;
  if (groupMark === null) {
    if (!/^\d*$/.test(intRaw)) return notANumber;
    intPart = intRaw;
  } else {
    const sep = groupMark === "." ? "\\." : ",";
    if (!new RegExp(`^[1-9]\\d{0,2}(${sep}\\d{3})+$`).test(intRaw)) return notANumber;
    intPart = intRaw.split(groupMark).join("");
  }
  if (intPart === "" && frac === "") return notANumber;
  const n = Number(`${intPart || "0"}.${frac || "0"}`);
  return Number.isFinite(n) ? { ok: true, value: n } : notANumber;
}
