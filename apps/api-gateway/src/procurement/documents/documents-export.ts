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
 *
 * Totals are keyed by (currency, paper type) and never net one type against
 * another; a Total column no paper printed is empty, and one some papers left
 * out says "n of m papers printed no <column>" in the basis cell.
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

const MONEY_COLUMNS = ["subtotal", "freight", "tax", "total"] as const;

/**
 * One total per (currency, paper type). INVARIANTS: two amounts are added only
 * when both papers state the same currency (r109, DD-r109-8b) AND are the same
 * paper type (r106: an invoice is never added to its packing slip, the
 * vendor's statement of it or a credit memo). A paper that states no currency
 * is added to nothing: its money could be either, and one Total row says so in
 * words. An empty cell is never 0.
 */
export function verifiedCsv(rows: ExportRow[]): string {
  const lines: string[] = [EXPORT_COLUMNS.join(",")];
  type Acc = { cur: string; type: string; n: number; sum: number[]; nulls: number[] };
  const sums = new Map<string, Acc>();
  let unstated = 0;
  for (const r of rows) {
    const cur = (r.currency ?? "").trim().toUpperCase();
    const type = (r.doc_type ?? "").trim();
    const cents = [r.subtotal, r.freight, r.tax, r.total].map(toCents);
    if (!cur) unstated += 1;
    else {
      const key = `${cur}\u0000${type}`;
      const s = sums.get(key) ?? { cur, type, n: 0, sum: [0, 0, 0, 0], nulls: [0, 0, 0, 0] };
      s.n += 1;
      cents.forEach((c, i) => {
        if (c === null) s.nulls[i] += 1;
        else s.sum[i] += c;
      });
      sums.set(key, s);
    }
    lines.push(
      [
        cell(r.doc_number),
        cell(r.doc_date),
        cell(r.doc_type),
        cell(r.vendor),
        cell(cur || null),
        ...cents.map(formatCents),
        "not stated",
      ].join(","),
    );
  }
  for (const s of sums.values()) {
    // A column no paper printed stays empty; a column some papers left out says
    // how many, so the total does not read as the book.
    const figures = s.sum.map((v, i) => (s.nulls[i] === s.n ? "" : formatCents(v)));
    const notes = MONEY_COLUMNS.flatMap((name, i) =>
      s.nulls[i] > 0 && s.nulls[i] < s.n ? [`${s.nulls[i]} of ${s.n} papers printed no ${name}`] : [],
    );
    lines.push(
      [`Total ${s.type || "unlabelled"}`, "", "", "", cell(s.cur), ...figures, cell(notes.join("; ") || null)].join(","),
    );
  }
  if (unstated > 0)
    lines.push(
      [
        "Total",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        `${unstated} ${unstated === 1 ? "paper states" : "papers state"} no currency; not added up`,
      ].join(","),
    );
  return lines.join("\r\n") + "\r\n";
}
