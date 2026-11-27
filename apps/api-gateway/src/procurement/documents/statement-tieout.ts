/**
 * A VENDOR STATEMENT AGAINST THE HOUSE'S PAPERS (r109 g5). For each invoice or
 * credit row the statement lists, find the house's paper from the same vendor
 * with the same document number (trimmed, case-folded, inner whitespace
 * dropped, leading zeros KEPT: "00123" and "123" are different papers), and
 * compare the amounts in integer cents in one currency. Never on amount alone:
 * two invoices of 312.40 would pair wrongly.
 *
 * Payments and balances are ignored, and nothing is marked paid (the
 * DD-r104-31 boundary: Mudavym does not hold the house's ledger).
 */
import type { ParsedStatementEntry } from "./parsed-document";

export type TieOutVerdict =
  | "checked_same"
  | "on_file_not_checked"
  | "amount_differs"
  | "never_received"
  | "not_compared";

export interface TieOutPaper {
  id: string;
  doc_type: string;
  doc_number: string | null;
  doc_date: string | null;
  total: number | string | null;
  currency: string | null;
  status: string;
}

export interface TieOutRow {
  docNumber: string | null;
  docDate: string | null;
  kind: "invoice" | "credit";
  amount: string | null;
  verdict: TieOutVerdict;
  /** Statement minus paper, in the statement's money; only for amount_differs. */
  differsBy: string | null;
  /** Why it was not compared, in words; only for not_compared. */
  reason: string | null;
  paperId: string | null;
}

export interface TieOut {
  rows: TieOutRow[];
  /** Papers from this vendor dated inside the statement's span that it does not list. */
  notOnStatement: { id: string; docNumber: string | null; docDate: string | null; total: string | null; kind: "invoice" | "credit" }[];
  paymentsIgnored: number;
}

/** "INV 00123 " and "inv00123" are one number; "123" is another. */
export function normalDocNumber(n: string | null | undefined): string | null {
  const t = String(n ?? "").trim().toLowerCase().replace(/\s+/g, "");
  return t ? t : null;
}

/** A decimal (number or text) to integer cents, exactly for two places; null when not a number. */
export function toCents(v: number | string | null | undefined): bigint | null {
  if (v === null || v === undefined || v === "") return null;
  const t = (typeof v === "number" ? (Number.isFinite(v) ? v.toFixed(3) : "") : String(v)).trim();
  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(t);
  if (!m || (!m[2] && !m[3])) return null;
  const f = (m[3] ?? "").padEnd(3, "0");
  let c = BigInt((m[2] || "0") + f.slice(0, 2));
  if (Number(f[2]) >= 5) c += 1n;
  return m[1] ? -c : c;
}

export function centsText(c: bigint): string {
  const neg = c < 0n;
  const a = neg ? -c : c;
  return `${neg ? "-" : ""}${a / 100n}.${(a % 100n).toString().padStart(2, "0")}`;
}

const PAPER_KIND: Record<"invoice" | "credit", string> = { invoice: "invoice", credit: "credit_memo" };
const OUT = new Set(["rejected", "superseded"]);

export function tieOutStatement(
  entries: ParsedStatementEntry[],
  papers: TieOutPaper[],
  ctx: { vendorNamed: boolean; currency: string | null },
): TieOut {
  const money = (ctx.currency ?? "").trim().toUpperCase() || null;
  const live = papers.filter((p) => !OUT.has(p.status));
  const byKey = new Map<string, TieOutPaper[]>();
  for (const p of live) {
    const n = normalDocNumber(p.doc_number);
    if (!n) continue;
    const k = `${p.doc_type}\u0000${n}`;
    byKey.set(k, [...(byKey.get(k) ?? []), p]);
  }
  const rows: TieOutRow[] = [];
  const listed = new Set<string>();
  let paymentsIgnored = 0;
  let lo: string | null = null;
  let hi: string | null = null;
  for (const e of entries) {
    if (e.kind === "payment") {
      paymentsIgnored++;
      continue;
    }
    const kind = e.kind;
    const cents = toCents(e.amount);
    const base = { docNumber: e.docNumber, docDate: e.docDate, kind, amount: cents === null ? null : centsText(cents), differsBy: null, reason: null, paperId: null };
    if (e.docDate) {
      if (!lo || e.docDate < lo) lo = e.docDate;
      if (!hi || e.docDate > hi) hi = e.docDate;
    }
    const n = normalDocNumber(e.docNumber);
    if (n) listed.add(`${PAPER_KIND[kind]}\u0000${n}`);
    if (!ctx.vendorNamed) {
      rows.push({ ...base, verdict: "not_compared", reason: "no vendor is named on this statement" });
      continue;
    }
    if (!n) {
      rows.push({ ...base, verdict: "not_compared", reason: "the statement prints no number for this row" });
      continue;
    }
    // Two live papers with one number (an upload twice): the checked one speaks.
    const same = byKey.get(`${PAPER_KIND[kind]}\u0000${n}`) ?? [];
    const match = same.find((p) => p.status === "verified") ?? same[0];
    if (!match) {
      rows.push({ ...base, verdict: "never_received" });
      continue;
    }
    const withPaper = { ...base, paperId: match.id };
    // An unknown money on either side is not guessed to be the other's (ADR 0020).
    const theirs = (match.currency ?? "").trim().toUpperCase() || null;
    if (!money || !theirs || theirs !== money) {
      const reason = !money
        ? "the statement's money is not known"
        : !theirs
          ? "the paper's money is not known"
          : `the paper is in ${theirs} and the statement in ${money}`;
      rows.push({ ...withPaper, verdict: "not_compared", reason });
      continue;
    }
    const paper = toCents(match.total);
    if (cents === null || paper === null) {
      rows.push({ ...withPaper, verdict: "not_compared", reason: cents === null ? "the statement prints no amount for this row" : "the paper on file has no total" });
      continue;
    }
    const d = cents - (paper < 0n ? -paper : paper);
    if (d !== 0n) rows.push({ ...withPaper, verdict: "amount_differs", differsBy: centsText(d) });
    else rows.push({ ...withPaper, verdict: match.status === "verified" ? "checked_same" : "on_file_not_checked" });
  }
  const notOnStatement =
    ctx.vendorNamed && lo && hi
      ? live
          .filter((p) => (p.doc_type === "invoice" || p.doc_type === "credit_memo") && p.doc_date && p.doc_date >= lo! && p.doc_date <= hi!)
          .filter((p) => {
            const n = normalDocNumber(p.doc_number);
            return !n || !listed.has(`${p.doc_type}\u0000${n}`);
          })
          .map((p) => {
            const t = toCents(p.total);
            return { id: p.id, docNumber: p.doc_number, docDate: p.doc_date, total: t === null ? null : centsText(t), kind: p.doc_type === "credit_memo" ? ("credit" as const) : ("invoice" as const) };
          })
      : [];
  return { rows, notOnStatement, paymentsIgnored };
}
