/**
 * The item drawer's eight cards (proposal §2 S2 item 2, §4 K1).
 *
 * Each card is one figure and one sentence saying where it comes from. A card
 * whose source could not be read says so and never shows 0 (G15, ADR 0020).
 * Money is for owners and managers only: for anyone else the Value card is
 * not drawn and no other card carries a currency figure.
 *
 * On hand, value, usage and days of cover come from the list row, the one
 * source the table already shows (K9). Waste, the count gap and the cost
 * trend come from GET /inventory/:rid/item/:id/figures.
 */
import type { ReactNode } from 'react';
import type { ItemFigures, ItemNutrition } from '../../../services/api/inventory';
import { figureWords, PER } from './nutrition-words';
import { cellMoney, EM, fmtCount, fmtPace, type HouseCurrency, type InvRow } from './useInventoryNextData';
import { fmtWhen } from '../../../lib/mudavym/format';
import { shortDate } from '../../cellar/next/cellar-format';

export type CardId = 'onhand' | 'value' | 'usage' | 'cover' | 'cost' | 'waste' | 'gap' | 'inside';

export const CARD_TITLE: Record<CardId, string> = {
  onhand: 'On hand',
  value: 'Value',
  usage: 'Usage a day',
  cover: 'Days of cover',
  cost: 'Cost',
  waste: 'Waste (30 days)',
  gap: 'Count gap',
  inside: 'What’s in it',
};

/** The figures read: still reading, failed as a whole, or answered. */
export type FiguresLoad =
  | { status: 'reading' }
  | { status: 'failed'; reason: string }
  | { status: 'ready'; data: ItemFigures };

/** What's in it, read for its card: still reading, failed, or answered. */
export type InsideLoad = { status: 'reading' } | { status: 'failed' } | { status: 'ready'; data: ItemNutrition };

/** The "What's in it" card: energy per 100 g or 100 ml, never 0 for unknown. */
function insideCard(inside: InsideLoad): { figure: ReactNode; source: string; unread: boolean } {
  if (inside.status === 'reading') return { figure: EM, source: 'Reading…', unread: false };
  if (inside.status === 'failed') return { figure: EM, source: 'Nutrition and allergens could not be read; open it to try again.', unread: true };
  const { figures, allergens } = inside.data;
  const contains = allergens.filter((a) => a.status === 'contains').length;
  const stated = allergens.some((a) => a.status !== 'not_stated');
  const allergenWords =
    contains > 0 ? `Contains ${contains} of the 14 allergens` : stated ? 'Allergens stated' : 'Allergens not stated yet';
  if (!figures) return { figure: 'Not recorded', source: `${allergenWords}; nutrition not recorded yet.`, unread: false };
  const per = PER[figures.basis].toLowerCase();
  return { figure: `${figureWords(figures.energyKcal, 'kcal')} ${per}`, source: `${allergenWords}.`, unread: false };
}

const UNREAD = 'could not be read';

const UNIT_WORDS: Record<string, [string, string]> = {
  bottle: ['bottle', 'bottles'],
  case: ['case', 'cases'],
  keg: ['keg', 'kegs'],
  pack: ['pack', 'packs'],
  glass: ['glass', 'glasses'],
  shot: ['shot', 'shots'],
};

/**
 * A whole g or ml count read in kg or l keeps every gram: 1750 g is "1.75 kg",
 * and 1755 g is "1.755 kg". fmtCount's one place would print 1750 g as "1.8 kg"
 * right after the count sheet said "now reads 1.75 kg".
 */
function fmtScaled(n: number): string {
  return n.toLocaleString('en-GB', { maximumFractionDigits: 3 });
}

/**
 * A quantity in the item's own unit (ADR 0070: stored as whole g, ml or
 * each). 12400 g reads "12.4 kg"; 1500 ml reads "1.5 l"; each is a count.
 * A wine row with no unit on it is in bottles.
 */
export function fmtQty(n: number, uom: string | null): string {
  const a = Math.abs(n);
  switch (uom) {
    case 'g':
      return a >= 1000 ? `${fmtScaled(n / 1000)} kg` : `${fmtCount(n)} g`;
    case 'mg':
      return a >= 1000 ? `${fmtScaled(n / 1000)} g` : `${fmtCount(n)} mg`;
    case 'ml':
      return a >= 1000 ? `${fmtScaled(n / 1000)} l` : `${fmtCount(n)} ml`;
    case 'each':
      return fmtCount(n);
    default: {
      const [one, many] = UNIT_WORDS[uom ?? 'bottle'] ?? [uom ?? 'bottle', uom ?? 'bottles'];
      return `${fmtCount(n)} ${a === 1 ? one : many}`;
    }
  }
}

/** A cost is per kg or per l for a weighed or poured good: per g would read 0.01. */
export function perUnit(wac: number, uom: string | null): { amount: number; per: string } {
  if (uom === 'g') return { amount: wac * 1000, per: 'a kg' };
  if (uom === 'ml') return { amount: wac * 1000, per: 'a litre' };
  // "US$0.35 each", never "US$0.35 a item"; "a litre", never "a l".
  if (uom === 'each') return { amount: wac, per: 'each' };
  if (uom === 'l') return { amount: wac, per: 'a litre' };
  return { amount: wac, per: `a ${UNIT_WORDS[uom ?? 'bottle']?.[0] ?? uom ?? 'bottle'}` };
}

/** Usage a day: small paces keep two places (fmtPace), large weighed ones read in kg or l. */
export function usageWords(v: number, uom: string | null): string {
  if ((uom === 'g' || uom === 'ml') && v >= 1000) return fmtQty(v, uom);
  // 290 g a day, not "290.0 g": a gram is already small, so whole ones from 10 up.
  if ((uom === 'g' || uom === 'ml') && v >= 10) return `${fmtCount(Math.round(v))} ${uom}`;
  if (uom === 'g' || uom === 'ml') return `${fmtPace(v)} ${uom}`;
  if (uom === 'each') return fmtPace(v);
  const [one, many] = UNIT_WORDS[uom ?? 'bottle'] ?? [uom ?? 'bottle', uom ?? 'bottles'];
  return `${fmtPace(v)} ${v === 1 ? one : many}`;
}

function signed(n: number, uom: string | null): string {
  if (n === 0) return 'No gap';
  return `${n > 0 ? '+' : '−'}${fmtQty(Math.abs(n), uom)}`;
}

/** A small line of what each delivery cost, first to last. Drawn only from read points. */
export function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return null;
  const w = 96;
  const h = 24;
  const lo = Math.min(...points);
  const hi = Math.max(...points);
  const span = hi - lo || 1;
  const d = points
    .map((p, i) => `${((i / (points.length - 1)) * w).toFixed(1)},${(h - 2 - ((p - lo) / span) * (h - 4)).toFixed(1)}`)
    .join(' ');
  return (
    <svg className="ivd-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" focusable="false">
      <polyline points={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function trendWords(f: ItemFigures['costTrend']): string {
  if (!f.readable) return `What each delivery cost ${UNREAD}.`;
  // No points is the server saying why there is no trend, not "too few receipts".
  if (f.points === null) return f.source;
  const pts = f.points;
  if (pts.length < 2 || f.changePct === null) return 'Not enough receipts to show a change.';
  const month = new Date(pts[0].receivedAt).toLocaleDateString('en-GB', { month: 'long' });
  const pct = Math.abs(f.changePct);
  if (f.changePct === 0) return `Unchanged since ${month}.`;
  return `${f.changePct > 0 ? 'Up' : 'Down'} ${fmtCount(pct)}% since ${month}.`;
}

interface CardProps {
  id: CardId;
  figure: ReactNode;
  extra?: ReactNode;
  source: ReactNode;
  unread?: boolean;
  open: CardId | null;
  onOpen?: (id: CardId) => void;
}

function Card({ id, figure, extra, source, unread, open, onOpen }: CardProps) {
  const body = (
    <>
      <span className="ivd-card-k">{CARD_TITLE[id]}</span>
      <span className="ivd-card-v" data-unread={unread ? 'true' : undefined}>
        {unread ? UNREAD : figure}
      </span>
      {extra && !unread ? <span className="ivd-card-x">{extra}</span> : null}
      <span className="ivd-card-s">{source}</span>
    </>
  );
  if (!onOpen) {
    return (
      <div className="ivd-card" data-testid={`ivd-card-${id}`}>
        {body}
      </div>
    );
  }
  return (
    <button
      type="button"
      className="ivd-card iv-focus"
      data-testid={`ivd-card-${id}`}
      aria-expanded={open === id}
      aria-controls={open === id ? 'ivd-evidence' : undefined}
      data-on={open === id}
      onClick={() => onOpen(id)}
    >
      {body}
    </button>
  );
}

export interface ItemCardsProps {
  row: InvRow;
  uom: string | null;
  /** The house item's kind: a food or supply is not drawn down by a sale yet. */
  kind?: string | null;
  canManage: boolean;
  currency: HouseCurrency;
  figures: FiguresLoad;
  inside: InsideLoad;
  open: CardId | null;
  onOpen: (id: CardId) => void;
}

/**
 * A sale draws down only what the till maps to the good itself (a bottle, a
 * glass). A drink recipe may link a food or supply (lime, syrup: "Used in"
 * lists them), but no recipe is taken from stock at the till yet (ADR 0360:
 * sale depletion is the next wave). So its use is measured from its counts
 * (inventory_analytics, days_of_stock_from_real_use): until it has two, it
 * is not "not enough history", it is not measured yet, and says how to.
 */
export const NOT_DRAWN_BY_SALES =
  'A sale does not draw a food or supply down yet, so its use is measured from its counts: count it twice, at least 3 days apart and the second within the last 30 days, and what was used between them shows here.';

const DAY_MS = 86_400_000;

/** Whole days between two instants, at least 1. */
function daysBetween(since: string, until: string): number {
  return Math.max(1, Math.round((Date.parse(until) - Date.parse(since)) / DAY_MS));
}

/**
 * Where a good's usage a day comes from, in the house's words, for the Usage
 * card and the pace evidence. Null when the server sent no source (an older
 * gateway, or neither sales nor counts measured it).
 */
export function usageSaid(row: InvRow, uom: string | null): string | null {
  if (!row.analyticsReadable || row.usageSource === null || !row.usageSince || !row.usageUntil) return null;
  const n = daysBetween(row.usageSince, row.usageUntil);
  if (row.usageSource === 'counts') {
    const used = row.usageQty === null ? 'What was used' : `${fmtQty(row.usageQty, uom)} used`;
    return `${used} between the counts of ${shortDate(row.usageSince)} and ${shortDate(row.usageUntil)} (${n} days): the two counts, with what was received, written off and found short between them.`;
  }
  return row.usageQty === null
    ? `Sold over the last ${n} days, from the stock ledger, less voids.`
    : `${fmtQty(row.usageQty, uom)} sold in the last ${n} days, from the stock ledger, less voids.`;
}

export default function ItemCards({ row, uom, kind, canManage, currency, figures, inside, open, onOpen }: ItemCardsProps) {
  const pace = row.analyticsReadable;
  // Only a pace that was read can say "not drawn by sales": an unread one is
  // null too, and stays unread rather than read as a measured answer.
  // A food or supply with no measured use (no two counts yet) says how to
  // measure it; one its counts measured reads like any other good.
  const unsold =
    pace && (kind === 'food' || kind === 'supply') && row.usageSource === null && (row.velocity === null || row.velocity === 0);
  const counted = pace && row.usageSource === 'counts';
  const said = usageSaid(row, uom);
  const f = figures.status === 'ready' ? figures.data : null;
  const reading = figures.status === 'reading';
  const failedWhy = figures.status === 'failed' ? `This item’s figures ${UNREAD} — ${figures.reason}.` : null;
  const money = (n: number | null) => cellMoney(n, currency);

  const onHand =
    row.stock === null ? null : (
      <>
        {fmtQty(row.stock, uom)}
        {row.openMl !== null && row.openMl > 0 ? <span className="ivd-dim"> + {fmtQty(row.openMl, 'ml')} open</span> : null}
      </>
    );

  let cost: ReactNode = EM;
  let costSource: ReactNode;
  let costExtra: ReactNode = null;
  if (!canManage) {
    cost = 'Not shown';
    costSource = 'Cost is shown to owners and managers.';
  } else {
    if (row.wac !== null) {
      const u = perUnit(row.wac, uom);
      cost = `${money(u.amount)} ${u.per}`;
    } else {
      cost = 'No cost yet';
    }
    const prov =
      row.costProvenance === 'invoice' ? 'from invoices' : row.costProvenance === 'estimated' ? 'partly estimated' : null;
    costSource = `The average cost of what was received${prov ? `, ${prov}` : ''}.`;
    costExtra = reading ? (
      'Reading the receipts…'
    ) : f ? (
      <>
        <Sparkline points={(f.costTrend.points ?? []).map((p) => p.unitCost)} />
        <span>{trendWords(f.costTrend)}</span>
      </>
    ) : (
      `What each delivery cost ${UNREAD}.`
    );
  }

  const waste = f?.waste ?? null;
  const gap = f?.countGap ?? null;
  // A failed part says so in the house's words; the server's own sentence
  // for a failure carries the database's message, which is not for a person.
  const fromFigures = (readable: boolean | undefined, sentence: string | undefined, what: string) =>
    reading ? 'Reading…' : failedWhy ?? (readable === false ? `The stock ledger did not answer, so ${what} is not shown.` : sentence ?? '');

  return (
    <div className="ivd-cards" data-testid="ivd-cards">
      <Card
        id="onhand"
        open={open}
        onOpen={onOpen}
        unread={row.stock === null}
        figure={onHand}
        source="Counted and received stock on the shelf, from the stock ledger."
      />
      {canManage ? (
        <Card
          id="value"
          open={open}
          onOpen={onOpen}
          unread={row.stock === null}
          figure={row.value === null ? 'No cost yet' : money(row.value)}
          source={
            row.value === null
              ? 'On hand at the average cost; no received lot of this item has a cost yet.'
              : 'On hand at the average cost of what was received.'
          }
        />
      ) : null}
      <Card
        id="usage"
        open={open}
        onOpen={onOpen}
        unread={!pace}
        figure={
          unsold
            ? 'Not measured yet'
            : row.velocity === null
              ? 'Not enough history'
              : counted && row.velocity === 0
                ? 'None used'
                : usageWords(row.velocity, uom)
        }
        source={
          unsold
            ? NOT_DRAWN_BY_SALES
            : !pace
              ? 'The sales pace could not be read, so how fast it goes is not shown.'
              : said ?? 'Sold over the last 30 days, from the stock ledger.'
        }
      />
      <Card
        id="cover"
        open={open}
        onOpen={onOpen}
        unread={!pace}
        figure={
          unsold
            ? 'Not known'
            : row.runway !== null
              ? `${fmtCount(Math.round(row.runway))} days`
              : counted
                ? 'Not running down'
                : 'Not enough history'
        }
        source={
          unsold
            ? 'On hand divided by usage a day; its use is measured once it has been counted twice.'
            : counted
              ? `On hand less what was used since the last count${row.usageUntil ? ` (${shortDate(row.usageUntil)})` : ''}, at its usage a day between its last counts.`
              : 'On hand divided by usage a day.'
        }
      />
      <Card id="cost" open={open} onOpen={onOpen} figure={cost} extra={costExtra} source={costSource} />
      <Card
        id="waste"
        open={open}
        onOpen={onOpen}
        unread={figures.status === 'failed' || waste?.readable === false}
        figure={reading ? EM : waste && waste.qty30d !== null ? fmtQty(waste.qty30d, uom) : EM}
        extra={
          waste && waste.readable ? (
            <>
              given away: {waste.given30d === null ? EM : fmtQty(waste.given30d, uom)}
              {canManage && waste.value30d !== null ? <> · worth {money(waste.value30d)}</> : null}
            </>
          ) : null
        }
        source={fromFigures(waste?.readable, waste?.source, 'waste')}
      />
      <Card
        id="gap"
        open={open}
        onOpen={onOpen}
        unread={figures.status === 'failed' || gap?.readable === false}
        figure={
          reading ? EM : gap?.last && gap.last.length > 0 ? (gap.last[0].variance === null ? EM : signed(gap.last[0].variance, uom)) : 'Never counted'
        }
        extra={
          gap?.last && gap.last.length > 0 ? (
            <ol className="ivd-gaps">
              {gap.last.map((c, i) => (
                <li key={`${c.countedAt}-${i}`}>
                  {fmtWhen(c.countedAt)} · {c.variance === null ? EM : signed(c.variance, uom)}
                  {c.by ? ` · ${c.by}` : ''}
                  {canManage && c.money !== null ? ` · ${money(c.money)}` : ''}
                </li>
              ))}
            </ol>
          ) : null
        }
        source={fromFigures(gap?.readable, gap?.source, 'the count gap')}
      />
      {/* A supply is not eaten or drunk: no "What's in it" card. */}
      {kind !== 'supply' ? <Card id="inside" open={open} onOpen={onOpen} {...insideCard(inside)} /> : null}
    </div>
  );
}
