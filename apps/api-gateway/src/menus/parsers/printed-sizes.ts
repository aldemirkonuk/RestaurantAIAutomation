/**
 * The sizes a menu PRINTS on one line (r109 menu-g3): a rakı at 20 cl, 35 cl
 * and 70 cl, a beer at 33 cl and 50 cl, a dish as half and full portion.
 *
 * The session's call: sizes are kept as printed, beside the line, and are
 * NEVER carried into the house price. by_glass_price and bottle_price stay
 * the only two prices a menu sets (ADR 0193); a size's price is something
 * the menu says, shown back to the house. Rejected: a size-to-glass/bottle
 * mapping (which of 20/35/70 cl is "the glass" is a guess, and a wrong guess
 * moves a house price), and a per-size price table (a schema the house price
 * path does not read).
 *
 * Every price is read by the one menu price reader (menu-price.ts). A size
 * whose price does not read is dropped and counted (`unread`), never guessed.
 * When the line's raw text is held, a size is kept only when its label is on
 * that text (the printed-marks rule), so a size the reader worked out is not
 * kept.
 */
import { markIsPrinted } from "./printed-marks";
import { readMenuPrice } from "./menu-price";

export const MIN_PRINTED_SIZES = 2;
export const MAX_PRINTED_SIZES = 8;
export const MAX_SIZE_LABEL_CHARS = 40;
/** Bounds the migration's menu_printed_sizes_fit check holds too. */
const ML_MIN = 10;
const ML_MAX = 5000;
const PRICE_CEILING = 1e8;

export interface PrintedSize {
  label: string;
  ml: number | null;
  price: number;
}

export interface KeptSizes {
  /** null when fewer than two sizes are left, or more than eight were printed. */
  sizes: PrintedSize[] | null;
  /** Sizes whose price did not read: dropped, never guessed. */
  unread: number;
}

/** A size's price, as the menu price reader reads it: null when it has no one reading, is negative, or has more than two decimals. */
export function sizePrice(value: unknown): number | null {
  let text: string;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    text = String(value);
  } else if (typeof value === "string") {
    text = value;
  } else return null;
  if (/^\s*-/.test(text)) return null;
  const read = readMenuPrice(text);
  if (read.amount === null) return null;
  const amount = read.amount;
  if (amount < 0 || amount >= PRICE_CEILING) return null;
  // 12.34 * 100 is 1234.0000000000002 in floating point: compare within a hair.
  if (Math.abs(Math.round(amount * 100) - amount * 100) > 1e-6) return null;
  return amount;
}

function sizeMl(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value.trim()) : value;
  if (typeof n !== "number" || !Number.isInteger(n)) return null;
  return n >= ML_MIN && n <= ML_MAX ? n : null;
}

/**
 * The sizes of one line that may be stored. More than eight printed sizes is
 * not a line's sizes (it is a price table read onto a line) and is refused
 * whole: null, never the first eight.
 */
export function keepPrintedSizes(sizes: unknown, rawText: string | null | undefined): KeptSizes {
  if (!Array.isArray(sizes) || sizes.length === 0) return { sizes: null, unread: 0 };
  if (sizes.length > MAX_PRINTED_SIZES) return { sizes: null, unread: 0 };
  const seen = new Set<string>();
  const kept: PrintedSize[] = [];
  let unread = 0;
  for (const s of sizes) {
    if (!s || typeof s !== "object" || Array.isArray(s)) continue;
    const entry = s as Record<string, unknown>;
    if (typeof entry.label !== "string") continue;
    const label = entry.label.replace(/\s+/g, " ").trim();
    if (label.length === 0 || label.length > MAX_SIZE_LABEL_CHARS) continue;
    if (rawText && !markIsPrinted(label, rawText)) continue;
    const key = label.toLocaleLowerCase();
    if (seen.has(key)) continue;
    const price = sizePrice(entry.price);
    if (price === null) {
      unread += 1;
      continue;
    }
    seen.add(key);
    kept.push({ label, ml: sizeMl(entry.ml), price });
  }
  return { sizes: kept.length >= MIN_PRINTED_SIZES ? kept : null, unread };
}
