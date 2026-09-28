/**
 * Sales by hand — the pure half of `SalesSheet`: reading a typed figure, a
 * typed row and a CSV into the exact `SalesEntry` the legacy panel sent
 * (`pages/team/command/PerformancePanel.tsx:70-135`), and saying why a row
 * cannot go.
 *
 * WHAT IS THE SAME AS LEGACY, ON PURPOSE. The written row: member, day,
 * covers, checks, net sales, wine sales, and `source` = 'manual' when typed,
 * 'csv' when read from a file. A blank figure is 0, as it was. The CSV header
 * names the legacy panel accepted are all still accepted.
 *
 * WHAT IS STRICTER, AND WHY. The legacy panel wrote `Number(x) || 0`, so
 * "1,200" or "abc" became a 0 that then sat in the register as a real night.
 * Here a figure that is not a number, is negative, or (for covers and checks)
 * is not a whole number refuses its row with the reason; nothing is guessed.
 * A day in the future refuses too — there are no sales for it yet. Two rows
 * for one person on one day refuse before sending, because the gateway would
 * refuse the whole batch for it.
 */

import type { SalesEntry, TeamMember } from '../../../services/api/team';
import { resolveName } from './tm-format';

export interface SalesDraft {
  /** Stable key for React and for naming the row in a refusal. */
  key: string;
  memberId: string;
  serviceDate: string;
  covers: string;
  checks: string;
  netSales: string;
  wineSales: string;
  source: 'manual' | 'csv';
}

export type FigureField = 'covers' | 'checks' | 'netSales' | 'wineSales';

export const FIGURES: ReadonlyArray<{ field: FigureField; label: string; whole: boolean }> = [
  { field: 'covers', label: 'Covers', whole: true },
  { field: 'checks', label: 'Checks', whole: true },
  { field: 'netSales', label: 'Net sales', whole: false },
  { field: 'wineSales', label: 'Wine sales', whole: false },
];

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A typed figure: blank is 0 (legacy), otherwise a plain non-negative number. */
export function readFigure(
  raw: string,
  whole: boolean,
): { ok: true; value: number } | { ok: false; why: string } {
  const s = raw.trim();
  if (s === '') return { ok: true, value: 0 };
  // Plain digits with at most one decimal point. "1,200" is refused rather than
  // read as 1 or 1200 — which one the person meant is not ours to decide.
  if (!/^\d+(\.\d+)?$/.test(s)) return { ok: false, why: `“${s}” is not a plain number` };
  const n = Number(s);
  if (!Number.isFinite(n)) return { ok: false, why: `“${s}” is not a plain number` };
  if (whole && !Number.isInteger(n)) return { ok: false, why: `“${s}” is not a whole number` };
  if (!whole && /\.\d{3,}$/.test(s)) return { ok: false, why: `“${s}” has more than two decimals` };
  return { ok: true, value: n };
}

/** True when a draft row carries no figure at all — a grid row left alone. */
export function isBlank(d: SalesDraft): boolean {
  return FIGURES.every(({ field }) => d[field].trim() === '');
}

export type RowVerdict = { ok: true; entry: SalesEntry } | { ok: false; why: string };

/** One draft row → the exact body, or the reason it cannot be sent. */
export function checkRow(d: SalesDraft, today: string, memberIds: ReadonlySet<string>): RowVerdict {
  if (!d.memberId) return { ok: false, why: 'no person is named' };
  if (!memberIds.has(d.memberId)) return { ok: false, why: 'that person is not on this house’s roster' };
  if (!ISO_DAY.test(d.serviceDate)) return { ok: false, why: 'no service day is given' };
  if (d.serviceDate > today) return { ok: false, why: 'the day is in the future, so it has no sales yet' };
  const out: SalesEntry = { memberId: d.memberId, serviceDate: d.serviceDate, source: d.source };
  for (const { field, label, whole } of FIGURES) {
    const r = readFigure(d[field], whole);
    if (!r.ok) return { ok: false, why: `${label.toLowerCase()}: ${r.why}` };
    out[field] = r.value;
  }
  return { ok: true, entry: out };
}

/** Pairs of rows naming the same person on the same day, by their keys. */
export function duplicateKeys(rows: ReadonlyArray<SalesDraft>): Set<string> {
  const first = new Map<string, string>();
  const dup = new Set<string>();
  for (const r of rows) {
    if (!r.memberId || !r.serviceDate) continue;
    const k = `${r.memberId}|${r.serviceDate}`;
    const seen = first.get(k);
    if (seen) {
      dup.add(seen);
      dup.add(r.key);
    } else first.set(k, r.key);
  }
  return dup;
}

// ── CSV ──────────────────────────────────────────────────────────────────

/** The legacy panel's header names, every one still accepted (`PerformancePanel.tsx:108-114`). */
const HEADERS = {
  date: ['service_date', 'servicedate', 'date'],
  covers: ['covers', 'cover'],
  netSales: ['net_sales', 'netsales', 'sales', 'net'],
  wineSales: ['wine_sales', 'winesales', 'wine'],
  checks: ['checks', 'check_count', 'tickets'],
  memberId: ['member_id', 'memberid', 'member'],
  /** New: a person's name, matched to the roster, since nobody knows a member id. */
  name: ['name', 'member_name', 'server', 'person'],
} as const;

function cells(line: string): string[] {
  return line.split(',').map((c) => c.trim().replace(/^"(.*)"$/, '$1').trim());
}

export type CsvRead =
  | { ok: true; rows: SalesDraft[]; unnamed: number; refused: Array<{ line: number; why: string }> }
  | { ok: false; why: string };

/**
 * A CSV into draft rows. A row names its person by `member_id` or by `name`
 * (matched to the roster's names, ignoring case; an unknown or ambiguous name
 * refuses that row). A file with neither column puts every row on
 * `fallbackMemberId` — the legacy panel's "this member" — and counts them as
 * `unnamed` so the sheet can say whose they became.
 */
export function readSalesCsv(
  text: string,
  members: ReadonlyArray<TeamMember>,
  fallbackMemberId: string,
): CsvRead {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return { ok: false, why: 'The file needs a header row and at least one row of figures.' };
  const head = cells(lines[0]).map((h) => h.toLowerCase());
  const at = (names: ReadonlyArray<string>) => head.findIndex((h) => names.includes(h));
  const iDate = at(HEADERS.date);
  if (iDate < 0) return { ok: false, why: 'The file has no service_date (or date) column, so no row can be placed on a day.' };
  const iCovers = at(HEADERS.covers);
  const iNet = at(HEADERS.netSales);
  const iWine = at(HEADERS.wineSales);
  const iChecks = at(HEADERS.checks);
  const iMember = at(HEADERS.memberId);
  const iName = at(HEADERS.name);

  const byName = new Map<string, string[]>();
  for (const m of members) {
    const n = resolveName(m).text.trim().toLowerCase();
    if (!n) continue;
    byName.set(n, [...(byName.get(n) ?? []), m.id]);
  }

  const rows: SalesDraft[] = [];
  const refused: Array<{ line: number; why: string }> = [];
  let unnamed = 0;
  lines.slice(1).forEach((line, i) => {
    const c = cells(line);
    const lineNo = i + 2;
    let memberId = iMember >= 0 ? (c[iMember] ?? '') : '';
    if (!memberId && iName >= 0 && c[iName]) {
      const hits = byName.get(c[iName].toLowerCase()) ?? [];
      if (hits.length !== 1) {
        refused.push({
          line: lineNo,
          why: hits.length === 0 ? `nobody on the roster is called “${c[iName]}”` : `more than one person is called “${c[iName]}”`,
        });
        return;
      }
      memberId = hits[0];
    }
    if (!memberId) {
      if (iMember >= 0 || iName >= 0) {
        refused.push({ line: lineNo, why: 'the row names nobody' });
        return;
      }
      memberId = fallbackMemberId;
      unnamed += 1;
    }
    const pick = (idx: number) => (idx >= 0 ? (c[idx] ?? '') : '');
    rows.push({
      key: `csv-${lineNo}`,
      memberId,
      serviceDate: pick(iDate),
      covers: pick(iCovers),
      checks: pick(iChecks),
      netSales: pick(iNet),
      wineSales: pick(iWine),
      source: 'csv',
    });
  });
  return { ok: true, rows, unnamed, refused };
}
