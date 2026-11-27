/**
 * A till's item-sales export, read into one sale per (house-local day, item)
 * (r109 onboarding g3). Pure: no database, no clock of its own.
 *
 * The one shape taken is an item-sales report: a date, an item, a quantity and,
 * optionally, net sales. The header names Square's, Toast's and Lightspeed's
 * exports use are read as synonyms (taken from those tills' documented export
 * columns; not checked against a real file in this repo).
 *
 * What must always hold:
 *  - one sale per (day, item): rows for the same day and item (Square writes
 *    one per variation) are summed, and the key carries no money, so a
 *    re-upload of a corrected file replaces that day's figure, never adds one;
 *  - nothing here is a check: these sales never reach `pos_checks`, so no
 *    reader counts them as checks and no stock path can see them (ADR 0281,
 *    amended 2026-11-27);
 *  - every row not taken is named, with why: a quantity of 0 or less (a
 *    refund or a void), a day after the house's today or more than 90 days
 *    before it, an unreadable date, quantity or net;
 *  - net is kept only when the house's money is set; otherwise the quantity
 *    is kept and the net dropped, and the answer says so.
 */
import { createHash } from "crypto";
import { parseCsv } from "../price-index/parse-defra";

export const HISTORY_MAX_BYTES = 5 * 1024 * 1024;
export const HISTORY_MAX_ROWS = 50_000;
export const HISTORY_MAX_DAYS_BACK = 90;
/** Named refusals listed before the rest are only counted. */
export const HISTORY_MAX_NAMED = 50;

const HEADERS = {
  date: ["date", "day", "business date", "sales date", "order date", "sale date"],
  item: ["item", "item name", "menu item", "product", "product name", "name"],
  qty: ["qty", "quantity", "items sold", "item qty", "quantity sold", "sold", "count"],
  net: ["net sales", "net", "net amount", "net price", "net total", "net revenue"],
} as const;

export interface HistorySale {
  saleDate: string; // YYYY-MM-DD, the house's day
  itemKey: string;
  itemName: string;
  qty: number;
  net: number | null;
}

export interface HistoryReading {
  sales: HistorySale[];
  rowsRead: number;
  days: number;
  refused: string[];
  refusedCount: number;
  netDropped: boolean;
  /** A refusal of the whole file, in words. When set, `sales` is empty. */
  fileRefused: string | null;
}

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

function column(header: string[], names: readonly string[]): string | null {
  for (const name of names) {
    const hit = header.find((h) => norm(h) === name);
    if (hit !== undefined) return hit;
  }
  return null;
}

/** Days since 1970-01-01 for a calendar date, or null when it is not one. */
function dayNumber(y: number, m: number, d: number): number | null {
  const t = Date.UTC(y, m - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) return null;
  return Math.round(t / 86_400_000);
}

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/**
 * Slashed dates are ambiguous (3/4/2026). The file decides: a first part over
 * 12 anywhere means day/month, a second part over 12 means month/day; both,
 * or neither, and slashed dates are refused by name. Dots are day.month.year.
 */
function slashOrder(raw: string[]): "dmy" | "mdy" | null {
  let dmy = false;
  let mdy = false;
  for (const v of raw) {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v.trim());
    if (!m) continue;
    if (Number(m[1]) > 12) dmy = true;
    if (Number(m[2]) > 12) mdy = true;
  }
  return dmy === mdy ? null : dmy ? "dmy" : "mdy";
}

function readDate(raw: string, order: "dmy" | "mdy" | null): string | null {
  const s = raw.trim();
  const v = /^\d{4}-\d{2}-\d{2}([T ].*)?$/.test(s) ? s.slice(0, 10) : s;
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (m) return dayNumber(+m[1], +m[2], +m[3]) === null ? null : iso(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(v);
  if (m) return dayNumber(+m[3], +m[2], +m[1]) === null ? null : iso(+m[3], +m[2], +m[1]);
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  if (m && order) {
    const [d, mo] = order === "dmy" ? [+m[1], +m[2]] : [+m[2], +m[1]];
    return dayNumber(+m[3], mo, d) === null ? null : iso(+m[3], mo, d);
  }
  return null;
}

/** "1,234.50", "$12", "12,50" (a decimal comma), or null. Never a guess on "1.234,5x". */
export function readAmount(raw: string): number | null {
  let v = raw.trim().replace(/[\s$€£₺¥]/g, "");
  if (v === "") return null;
  if (/^-?\d+,\d{1,2}$/.test(v)) v = v.replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3})+,\d{1,2}$/.test(v)) v = v.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(v)) v = v.replace(/,/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function readHistoryCsv(
  text: string,
  opts: { todayDay: string; moneySet: boolean },
): HistoryReading {
  const empty = (fileRefused: string): HistoryReading => ({
    sales: [], rowsRead: 0, days: 0, refused: [], refusedCount: 0, netDropped: false, fileRefused,
  });
  if (Buffer.byteLength(text, "utf8") > HISTORY_MAX_BYTES) {
    return empty("The file is over 5 MB. Export fewer days, or one report per month.");
  }
  const rows = parseCsv(text);
  if (rows.length === 0) return empty("The file holds no rows to read.");
  if (rows.length > HISTORY_MAX_ROWS) {
    return empty(`The file holds ${rows.length} rows, over the 50,000 a file may carry. Export fewer days.`);
  }
  const header = Object.keys(rows[0]);
  const cDate = column(header, HEADERS.date);
  const cItem = column(header, HEADERS.item);
  const cQty = column(header, HEADERS.qty);
  const cNet = column(header, HEADERS.net);
  if (!cDate || !cItem || !cQty) {
    const missing = [!cDate && "date", !cItem && "item", !cQty && "quantity"].filter(Boolean).join(", ");
    return empty(`We could not find the ${missing} column. Use the till's item sales export, with a header row.`);
  }

  const t = /^(\d{4})-(\d{2})-(\d{2})$/.exec(opts.todayDay);
  const today = t ? dayNumber(+t[1], +t[2], +t[3]) : null;
  if (today === null) return empty("The house's day could not be read.");
  const order = slashOrder(rows.map((r) => r[cDate] ?? ""));

  const refused: string[] = [];
  let refusedCount = 0;
  const refuse = (what: string) => {
    refusedCount++;
    if (refused.length < HISTORY_MAX_NAMED) refused.push(what);
  };
  const byKey = new Map<string, HistorySale>();
  let netDropped = false;

  for (const row of rows) {
    const rawDate = row[cDate] ?? "";
    const name = (row[cItem] ?? "").trim().replace(/\s+/g, " ");
    const said = `${rawDate || "(no date)"} ${name || "(no item)"}`;
    const day = readDate(rawDate, order);
    if (!day) {
      refuse(`${said}: not read, the date is not one we can read for sure (write it as YYYY-MM-DD)`);
      continue;
    }
    if (!name) {
      refuse(`${said}: not read, the row names no item`);
      continue;
    }
    const qty = readAmount(row[cQty] ?? "");
    if (qty === null) {
      refuse(`${said}: not read, the quantity is not a number`);
      continue;
    }
    if (qty <= 0) {
      refuse(`${said}: not read, the quantity is 0 or less (a refund or a void)`);
      continue;
    }
    const n = dayNumber(+day.slice(0, 4), +day.slice(5, 7), +day.slice(8, 10)) as number;
    if (n > today) {
      refuse(`${said}: not read, the day is after the house's today`);
      continue;
    }
    if (n < today - HISTORY_MAX_DAYS_BACK) {
      refuse(`${said}: not read, the day is more than 90 days back`);
      continue;
    }
    let net: number | null = null;
    if (cNet && (row[cNet] ?? "").trim() !== "") {
      net = readAmount(row[cNet]);
      if (net === null) {
        refuse(`${said}: not read, the net sales is not a number`);
        continue;
      }
      if (net < 0) {
        refuse(`${said}: not read, the net sales is below 0`);
        continue;
      }
      if (!opts.moneySet) {
        netDropped = true;
        net = null;
      }
    }
    const key = createHash("sha256").update(`${day}|${norm(name)}`).digest("hex");
    const kept = byKey.get(key);
    if (kept) {
      kept.qty += qty;
      // A day's net is known only when every row of it carried one.
      kept.net = kept.net === null || net === null ? null : kept.net + net;
    } else {
      byKey.set(key, { saleDate: day, itemKey: `hist:${key}`, itemName: name, qty, net });
    }
  }

  const sales = [...byKey.values()].map((s) => ({
    ...s,
    qty: Math.round(s.qty * 1000) / 1000,
    net: s.net === null ? null : Math.round(s.net * 100) / 100,
  }));
  return {
    sales,
    rowsRead: rows.length,
    days: new Set(sales.map((s) => s.saleDate)).size,
    refused,
    refusedCount,
    netDropped,
    fileRefused: null,
  };
}
