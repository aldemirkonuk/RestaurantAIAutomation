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

/** Add whole cents, keeping "printed nowhere" apart from 0. */
const addCents = (a: number | null, b: number | null): number | null => (a === null ? b : b === null ? a : a + b);

/**
 * One total per currency (r109, DD-r109-8b). INVARIANT: two amounts are added
 * only when both papers state the same currency. Lira is never added to
 * dollars, and a paper that states no currency is added to nothing, because
 * its money could be either: its Total row says so in words and carries no
 * figure. A figure no paper in a currency printed totals to empty, never 0.
 */
export function verifiedCsv(rows: ExportRow[]): string {
  const lines: string[] = [EXPORT_COLUMNS.join(",")];
  type Sum = { sub: number | null; fr: number | null; tax: number | null; tot: number | null };
  const sums = new Map<string, Sum>();
  let unstated = 0;
  for (const r of rows) {
    const cur = (r.currency ?? "").trim().toUpperCase();
    const [sub, fr, tax, tot] = [r.subtotal, r.freight, r.tax, r.total].map(toCents);
    if (!cur) unstated += 1;
    else {
      const s = sums.get(cur) ?? { sub: null, fr: null, tax: null, tot: null };
      sums.set(cur, { sub: addCents(s.sub, sub), fr: addCents(s.fr, fr), tax: addCents(s.tax, tax), tot: addCents(s.tot, tot) });
    }
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
      ["Total", "", "", "", cell(cur), formatCents(s.sub), formatCents(s.fr), formatCents(s.tax), formatCents(s.tot), ""].join(","),
    );
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

/**
 * Split `target` cents (either sign) over `weights` (cents, each > 0) pro
 * rata, by largest remainder: floor shares of |target|, then one cent each to
 * the largest remainders, ties to the earlier class. Σ shares = target.
 */
export function allocateSigned(weights: number[], target: number): number[] {
  const w = weights.map((x) => BigInt(Math.max(0, Math.round(x))));
  const W = w.reduce((a, b) => a + b, 0n);
  if (W === 0n) return weights.map(() => 0);
  const neg = target < 0;
  const T = BigInt(Math.abs(Math.round(target)));
  const q = w.map((x) => (T * x) / W);
  const r = w.map((x, i) => T * x - q[i] * W);
  let left = T - q.reduce((a, b) => a + b, 0n);
  const order = r
    .map((x, i) => ({ x, i }))
    .sort((a, b) => (a.x === b.x ? a.i - b.i : a.x > b.x ? -1 : 1));
  for (let k = 0; left > 0n; k++, left--) q[order[k].i] += 1n;
  return q.map((x) => (neg ? 0 - Number(x) : Number(x)));
}

export const LINE_EXPORT_COLUMNS = [
  "Paper number",
  "Date",
  "Type",
  "Vendor",
  "Currency",
  "Line",
  "Description",
  "Category",
  "VAT rate",
  "Net",
  "Tax share",
  "Deposit",
] as const;

/** One paper of the lines view: its row and its lines, each already classed. */
export interface LineExportPaper extends ExportRow {
  lines: Array<{
    line_no?: number | null;
    description?: string | null;
    line_total: number | string | null;
    deposit?: number | string | null;
    vat_rate_percent?: number | string | null;
    cls: string | null;
  }>;
}

/**
 * The verified papers one row per line (r110 g4, ?lines=1). A line's
 * category is the class of the good it is linked to ('Not classed' when it is
 * linked to none). Its VAT rate is the printed one, else 'rate not printed'.
 * Its tax share is the paper's printed tax spread over its lines by net, by
 * largest remainder, so a paper's shares sum to its tax to the cent; a line
 * printed no tax of its own. A credit memo's figures are negative. One Total
 * row per currency; a paper with no currency is added to nothing.
 */
export function verifiedLinesCsv(papers: LineExportPaper[]): string {
  const out: string[] = [LINE_EXPORT_COLUMNS.join(",")];
  type Sum = { net: number; tax: number; dep: number };
  const sums = new Map<string, Sum>();
  let unstated = 0;
  for (const p of papers) {
    const cur = (p.currency ?? "").trim().toUpperCase();
    const sign = p.doc_type === "credit_memo" ? -1 : 1;
    const nets = p.lines.map((l) => toCents(l.line_total));
    const taxCents = toCents(p.tax);
    const shares =
      taxCents === null
        ? nets.map(() => null)
        : allocateSigned(nets.map((n) => Math.max(0, n ?? 0)), taxCents);
    if (!cur) unstated += 1;
    const s = sums.get(cur) ?? { net: 0, tax: 0, dep: 0 };
    p.lines.forEach((l, i) => {
      const net = nets[i] === null ? null : sign * (nets[i] as number) || 0;
      const tax = shares[i] === null ? null : sign * (shares[i] as number) || 0;
      const dc = toCents(l.deposit);
      const dep = dc === null ? null : sign * dc || 0;
      const r = l.vat_rate_percent;
      const rate =
        r === null || r === undefined || r === "" || !Number.isFinite(Number(r))
          ? "rate not printed"
          : `${Number(r)}%`;
      if (cur) {
        s.net += net ?? 0;
        s.tax += tax ?? 0;
        s.dep += dep ?? 0;
      }
      out.push(
        [
          cell(p.doc_number),
          cell(p.doc_date),
          cell(p.doc_type),
          cell(p.vendor),
          cell(cur || null),
          l.line_no == null ? "" : String(l.line_no),
          cell(l.description ?? null),
          cell(l.cls ?? "Not classed"),
          cell(rate),
          formatCents(net),
          formatCents(tax),
          formatCents(dep),
        ].join(","),
      );
    });
    if (cur) sums.set(cur, s);
  }
  for (const [cur, s] of sums)
    out.push(
      ["Total", "", "", "", cell(cur), "", "", "", "", formatCents(s.net), formatCents(s.tax), formatCents(s.dep)].join(","),
    );
  if (unstated > 0)
    out.push(
      [
        "Total", "", "", "", "", "", "", "", "", "", "",
        `${unstated} ${unstated === 1 ? "paper states" : "papers state"} no currency; not added up`,
      ].join(","),
    );
  return out.join("\r\n") + "\r\n";
}
