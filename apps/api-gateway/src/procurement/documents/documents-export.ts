/**
 * VERIFIED PAPERS AS ONE CSV (r106 g5).
 *
 * Pure: rows in, text out. Money is carried as INTEGER CENTS, never a float
 * sum, so the totals row is the exact sum of the rows above it and a
 * spreadsheet's own total ties to the cent. A cell the paper left empty is
 * empty, never 0.
 *
 * The currency/tax-basis column says "not stated" because main stores no tax
 * basis per paper yet (#2029 / #1813 carry it); the column exists now so the
 * file's shape does not change when they land.
 */
export interface ExportRow {
  doc_number: string | null;
  doc_date: string | null;
  doc_type: string | null;
  vendor: string | null;
  currency: string | null;
  subtotal: number | string | null;
  freight: number | string | null;
  tax: number | string | null;
  total: number | string | null;
}

export const EXPORT_COLUMNS = [
  "Paper number",
  "Date",
  "Type",
  "Vendor",
  "Currency",
  "Subtotal",
  "Freight",
  "Tax",
  "Total",
  "Currency and tax basis",
] as const;

/** A decimal string or number to whole cents; null when the paper printed none. */
export function toCents(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v).trim();
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) {
    const n = Number(s);
    return Number.isFinite(n) ? Math.round(n * 100) : null;
  }
  const frac = (m[3] ?? "").padEnd(3, "0");
  let cents = Number(m[2]) * 100 + Number(frac.slice(0, 2));
  if (Number(frac[2]) >= 5) cents += 1;
  return m[1] ? -cents : cents;
}

export function formatCents(c: number | null): string {
  if (c === null) return "";
  const neg = c < 0;
  const a = Math.abs(c);
  return `${neg ? "-" : ""}${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
}

/** Quote a cell; neutralise a leading formula character so a vendor name cannot run in a spreadsheet. */
export function cell(v: string | null): string {
  if (v === null || v === "") return "";
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function verifiedCsv(rows: ExportRow[]): string {
  const lines: string[] = [EXPORT_COLUMNS.join(",")];
  // One total per currency: adding lira to dollars is not a total.
  const sums = new Map<string, { sub: number; fr: number; tax: number; tot: number }>();
  for (const r of rows) {
    const cur = (r.currency ?? "").trim();
    const [sub, fr, tax, tot] = [r.subtotal, r.freight, r.tax, r.total].map(toCents);
    const s = sums.get(cur) ?? { sub: 0, fr: 0, tax: 0, tot: 0 };
    s.sub += sub ?? 0;
    s.fr += fr ?? 0;
    s.tax += tax ?? 0;
    s.tot += tot ?? 0;
    sums.set(cur, s);
    lines.push(
      [
        cell(r.doc_number),
        cell(r.doc_date),
        cell(r.doc_type),
        cell(r.vendor),
        cell(cur || null),
        formatCents(sub),
        formatCents(fr),
        formatCents(tax),
        formatCents(tot),
        "not stated",
      ].join(","),
    );
  }
  for (const [cur, s] of sums)
    lines.push(
      ["Total", "", "", "", cell(cur || null), formatCents(s.sub), formatCents(s.fr), formatCents(s.tax), formatCents(s.tot), ""].join(","),
    );
  return lines.join("\r\n") + "\r\n";
}
