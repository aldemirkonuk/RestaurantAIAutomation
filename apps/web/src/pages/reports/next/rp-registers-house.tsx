/**
 * The house registers — the cellar, the room, the people, and the desk that
 * points at where a cutting is written up (OD-81, `ExportsShelf.tsx`).
 *
 * Six of the eleven catalogue entries (`rp-catalogue.tsx` assembles them all).
 * Same contract as the trade registers: a path, a window, the drawings that are
 * true of the data, and one `view` builder that reduces the payload to the
 * shape `Cutting.tsx` draws.
 *
 * Every `basis` array below holds the SERVER's own sentences, verbatim.
 */

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { FigureRow } from './rp-plot';
import { EM, MONO, codeOf, countOf, figure, money, num, ratioPct } from './rp-format';
import { analysis, arr, obj, str, type AnalysisSpec } from './rp-spec';
import { monthLabel, till } from './rp-registers-trade';
import { countsByReasonFrom, netNotRecordedReasonsSaid } from '../../dashboard/next/useDashboardNextData';

/** What a staff reader is told in place of the house's money (F-203). */
export const AMOUNTS_WITHHELD =
  'Prices, costs and margins are kept for owners and managers.';

/* ────────────────────────────────────────── 6. margin against movement ── */

export interface QuadrantItem {
  id: string;
  name: string;
  /**
   * null when a line of this wine carries no bottle figure: its movement is
   * not measured, which is not 0 bottles a day (F-470, ADR 0297).
   */
  velocityPerDay: number | null;
  /** null when the row has no recorded cost — it has NO quadrant, not "dog". */
  marginPerBottle: number | null;
  marginPct: number | null;
  quadrant: string | null;
  /** F-1645: the days its sales are averaged over; null from an older gateway. */
  velocityDays?: number | null;
  /** F-1645: too few days of sales to place it; it has no quadrant. */
  tooFewDays?: boolean;
  /** F-1587: why a costed wine has no margin, when the till's prices include tax. */
  marginRefusal?: string | null;
}

export interface QuadrantRegister {
  /** Staff are sent no margins (F-203); the gateway says so at the root. */
  amountsWithheld?: boolean;
  /** The house's tax basis could not be read, so every margin is refused (F-1626). */
  taxBasisUnread?: boolean;
  basis?: { velocity?: string; margin?: string; unpriced?: string; list?: string };
  costCoverage?: { total: number; priced: number; unpriced: number; complete: boolean };
  medians: { velocityPerDay: number | null; marginPerBottle: number | null };
  counts: Record<string, number>;
  items: QuadrantItem[];
  /** Wines the engine could not price at all, by name (F-472). */
  leftOut?: { id: string; name: string; reason: string }[];
  /** F-1667: priced wines on no live menu, not placed; absent from an older gateway. */
  offMenu?: { id: string; name: string }[];
}

const quadrants = analysis<QuadrantRegister>({
  title: 'Margin against movement',
  register: 'menu-engineering register',
  answers: 'Which wines earn their place: margin against how fast they move',
  // F-1667: the list is the live menus' wines; a house with none places its priced stock (basis.list says which).
  window: () => 'the wines on your live Drinks and Desserts menus (your priced stock when no Drinks menu is live), each against its own days on the list, up to 90 days to yesterday',
  path: (rid) => `/analytics/menu-engineering/${rid}`,
  graphs: ['scatter', 'bars', 'table'],
  graphNote:
    'The scatter is the only drawing that shows both measures at once; bars and the table rank on margin alone. No line or area — these are wines, not a sequence, and joining them would draw a trend through an alphabet.',
  select: (raw) => {
    const d = obj(raw);
    const medians = obj(d.medians);
    return {
      amountsWithheld: d.amountsWithheld === true,
      taxBasisUnread: d.taxBasisUnread === true,
      basis: d.basis as QuadrantRegister['basis'],
      costCoverage: d.costCoverage as QuadrantRegister['costCoverage'],
      medians: {
        velocityPerDay: num(medians.velocityPerDay),
        marginPerBottle: num(medians.marginPerBottle),
      },
      counts: (d.counts ?? {}) as Record<string, number>,
      items: arr(d.items).map((i) => ({
        id: str(i.id),
        name: str(i.name),
        velocityPerDay: num(i.velocityPerDay),
        marginPerBottle: num(i.marginPerBottle),
        marginPct: num(i.marginPct),
        quadrant: (i.quadrant ?? null) as string | null,
        velocityDays: num(i.velocityDays),
        tooFewDays: i.tooFewDays === true,
        marginRefusal: typeof i.marginRefusal === 'string' ? i.marginRefusal : null,
      })),
      leftOut: arr(d.leftOut).map((w) => ({
        id: str(w.id),
        name: str(w.name),
        reason: str(w.reason),
      })),
      offMenu: arr(d.offMenu).map((w) => ({ id: str(w.id), name: str(w.name) })),
    };
  },
  view: (q) => {
    const unclassified = q.counts.unclassified ?? 0;
    const unmeasured = q.counts.unmeasured ?? 0;
    // F-1645: a new wine, or a new house, with too few days of sales to place.
    const tooFew = q.counts.tooFewDays ?? 0;
    // F-1587: prices that include tax, with a cost or rate not known without it.
    const taxRefused = q.counts.taxRefused ?? 0;
    const taxReasons = [
      ...new Set(q.items.map((i) => i.marginRefusal).filter((r): r is string => !!r)),
    ];
    const priced = q.items.filter((i) => i.marginPerBottle != null);
    // A wine whose movement is not measured has no place on the x axis.
    const plotted = priced.filter((i) => i.velocityPerDay != null && !i.tooFewDays);
    const leftOut = q.leftOut ?? [];
    const offMenu = q.offMenu ?? [];
    const basis = [q.basis?.list, q.basis?.velocity, q.basis?.margin, q.basis?.unpriced];
    const offPlot = [
      unclassified > 0
        ? `${countOf(unclassified, 'wine is', 'wines are')} off the plot for want of a recorded cost — an uncosted wine is unknown, not a dog.`
        : null,
      taxRefused > 0
        ? q.taxBasisUnread
          ? `${countOf(taxRefused, 'wine is', 'wines are')} off the plot because whether your till prices include tax could not be read just now, so no margin is worked out. Try again in a moment.`
          : `${countOf(taxRefused, 'wine is', 'wines are')} off the plot because the margin is worked out on the price without tax, and it could not be: ${taxReasons.slice(0, 3).join(' ')}`
        : null,
      unmeasured > 0
        ? `${countOf(unmeasured, 'wine is', 'wines are')} off the plot because some of its sales were recorded without a bottle figure, so how fast it moves is not measured — not 0 bottles a day.`
        : null,
      tooFew > 0
        ? `${countOf(tooFew, 'wine is', 'wines are')} off the plot because ${tooFew === 1 ? 'it has' : 'they have'} been on the list or on record for under a week, too few days to say how fast ${tooFew === 1 ? 'it moves' : 'they move'}.`
        : null,
      leftOut.length > 0
        ? `Not on this list at all, because the menu gives no price we can use (no bottle price, and no glass price with a confirmed pour): ${leftOut
            .slice(0, 8)
            .map((w) => w.name)
            .join(', ')}${leftOut.length > 8 ? ` and ${leftOut.length - 8} more` : ''}.`
        : null,
      offMenu.length > 0
        ? `Not on any menu, so not placed and not in the medians: ${offMenu
            .slice(0, 8)
            .map((w) => w.name)
            .join(', ')}${offMenu.length > 8 ? ` and ${offMenu.length - 8} more` : ''}.`
        : null,
    ].filter((n): n is string => n != null);
    const figures = [
      { label: 'Stars', value: figure(q.counts.star ?? 0) },
      { label: 'Plowhorses', value: figure(q.counts.plowhorse ?? 0) },
      { label: 'Puzzles', value: figure(q.counts.puzzle ?? 0) },
      { label: 'Dogs', value: figure(q.counts.dog ?? 0) },
      { label: 'No quadrant', value: figure(unclassified + unmeasured) },
      // F-1645: a wine too new to place has its own tile, as a tax refusal
      // does, so its reason is not folded into cost or velocity.
      ...(tooFew > 0 ? [{ label: 'Under a week of sales', value: figure(tooFew) }] : []),
      // A wine refused for tax has no quadrant either; it gets its own tile so
      // the reason (no pre-tax margin, F-1587) is not folded into cost/velocity.
      ...(taxRefused > 0
        ? [{ label: q.taxBasisUnread ? 'No margin: tax basis not read' : 'No pre-tax margin', value: figure(taxRefused) }]
        : []),
      // F-1667: priced wines on no live menu; the export carries the same row.
      ...(offMenu.length > 0 ? [{ label: 'Not on any menu', value: figure(offMenu.length) }] : []),
    ];
    if (q.amountsWithheld)
      return {
        say: `${AMOUNTS_WITHHELD} The quadrant counts below still say how the list splits.`,
        figures,
        notes: [],
        basis: [q.basis?.velocity],
      };
    if (priced.length === 0)
      return {
        say: `${
          taxRefused > 0
            ? 'No wine on the list has a margin on its price without tax yet, so there is no margin axis to plot against.'
            : 'No wine on the list carries both a recorded cost and a menu price, so there is no margin axis to plot against.'
        }${
          unclassified > 0
            ? ` ${countOf(unclassified, 'wine is', 'wines are')} unclassified for that reason — not because they sell badly.`
            : ' Nothing is filed in a quadrant, and nothing is guessed into one.'
        }`,
        figures,
        notes: offPlot,
        basis,
      };
    if (plotted.length === 0)
      return {
        say: 'No costed wine has a measured movement yet, so there is nothing to plot: some of their sales were recorded without a bottle figure.',
        figures,
        notes: offPlot,
        basis,
      };
    const ranked = [...priced].sort(
      (a, b) => (b.marginPerBottle as number) - (a.marginPerBottle as number),
    );
    return {
      points: {
        data: plotted.map((i) => ({
          x: Number((i.velocityPerDay as number).toFixed(3)),
          y: Number((i.marginPerBottle as number).toFixed(2)),
          name: i.name,
        })),
        xLabel: 'bottles/day',
        yLabel: 'margin/bottle',
        formatX: (v) => figure(v),
        formatY: (v) => money(v, 'compact'),
        refX: q.medians.velocityPerDay,
        refY: q.medians.marginPerBottle,
      },
      cats: {
        data: ranked.slice(0, 12).map((i) => ({
          label: i.name.length > 14 ? `${i.name.slice(0, 13)}…` : i.name,
          value: i.marginPerBottle,
          full: i.name,
        })),
        xLabel: 'wine',
        yLabel: 'margin/bottle',
        unit: 'margin per bottle',
        format: (v) => money(v, 'compact'),
        refs:
          q.medians.marginPerBottle != null
            ? [{ y: q.medians.marginPerBottle, label: 'median margin' }]
            : undefined,
      },
      table: {
        cols: [
          { key: 'n', label: 'Wine' },
          { key: 'v', label: 'Bottles/day', numeric: true },
          { key: 'm', label: 'Margin', numeric: true },
          { key: 'q', label: 'Quadrant' },
        ],
        rows: q.items.slice(0, 40).map((i) => ({
          key: i.id,
          cells: [
            i.name,
            i.velocityPerDay == null ? 'not measured' : figure(i.velocityPerDay),
            money(i.marginPerBottle, 'table'),
            i.quadrant ?? (i.tooFewDays ? 'under a week of sales' : EM),
          ],
        })),
        more:
          unclassified + unmeasured > 0
            ? [
                unclassified > 0
                  ? `${countOf(unclassified, 'wine has', 'wines have')} no quadrant because no cost was ever recorded for them.`
                  : null,
                unmeasured > 0
                  ? `${countOf(unmeasured, 'wine has', 'wines have')} no quadrant because how fast it sells is not measured.`
                  : null,
              ]
                .filter(Boolean)
                .join(' ')
            : undefined,
      },
      figures,
      // F-1670: the uncosted sentence is offPlot's own, said only when a wine
      // is uncosted; it read "0 wines are off the plot…" on a costed list.
      notes: [
        'Fast is right of the vertical rule, fat-margin is above the horizontal one; both rules are the engine’s own medians.',
        ...offPlot,
      ],
      basis,
    };
  },
});

/* ──────────────────────────────────────────────── 7. figures of record ── */

export interface LedgerRegister {
  /** Staff are sent no amounts or margins (F-203). */
  amountsWithheld?: boolean;
  /** The house's tax basis could not be read, so every margin is refused (F-1626). */
  taxBasisUnread?: boolean;
  basis?: Record<string, string>;
  costCoverage?: {
    total: number;
    priced: number;
    unpriced: number;
    complete: boolean;
    /** F-1652: wines with a cost for only some of their bottles, and those bottles. */
    partial?: number;
    uncostedBottles?: number;
  };
  /** The on-hand wines with no recorded cost, by name (F-133); capped by the gateway. */
  uncosted?: Array<{ id: string; name: string }>;
  /** On-hand wines with and without a bottle price (F-574); absent on an older gateway. */
  priceCoverage?: { total: number; priced: number; unpriced: number };
  inventoryValue: number | null;
  /** F-644: the priced wines' own total, beside how many it leaves out. */
  pricedInventoryValue: number | null;
  cogs: number | null;
  /** The code `cogs` is in, when the gateway names one (F-1145). */
  cogsCurrency?: string | null;
  /** The house's stated money; null when none is on record (F-1052). */
  houseCurrency?: string | null;
  /** Delivered orders with no price, left out of `cogs` (F-701). */
  cogsUnpricedCount?: number;
  /** Why `cogs` is blank when the orders were in two currencies (F-1054). */
  cogsNote?: string | null;
  revenue: number | null;
  /**
   * F-1715: at a house whose till prices include tax, how the valuation and
   * margins are taken without it, or why they are withheld; absent elsewhere
   * and from an older gateway.
   */
  marginTaxNote?: string | null;
  grossMargin: number | null;
  cogsRatio: number | null;
  inventoryTurnover: number | null;
  daysInventoryOutstanding: number | null;
  /**
   * F-1491: why turns and days of stock are withheld for a house under a
   * month of buying, or the days they are scaled up from; null otherwise and
   * from an older gateway.
   */
  turnsSpanNote?: string | null;
  /** F-1491: true when the short span is why turns are withheld. */
  turnsSpanShort?: boolean;
  gmroi: number | null;
  deadStockCapital: number | null;
}

const ledger = analysis<LedgerRegister>({
  title: 'Figures of record',
  register: 'financial register',
  answers: 'What the cellar is worth, and how hard that capital is working',
  window: () => '365 days of COGS; turns over up to a year of buying; the cellar as it stands today',
  path: (rid) => `/analytics/financial/${rid}`,
  graphs: ['table', 'figure'],
  graphNote:
    'No bars, line or area: these eight figures are in four different units — money, a ratio, a count of turns, a count of days — and one axis across them would compare dollars with days.',
  select: (raw) => {
    const d = obj(raw);
    return {
      amountsWithheld: d.amountsWithheld === true,
      taxBasisUnread: d.taxBasisUnread === true,
      basis: d.basis as Record<string, string>,
      costCoverage: d.costCoverage as LedgerRegister['costCoverage'],
      uncosted: arr(d.uncosted).map((u) => ({ id: str(u.id), name: str(u.name) || str(u.id) })),
      priceCoverage: d.priceCoverage as LedgerRegister['priceCoverage'],
      inventoryValue: num(d.inventoryValue),
      pricedInventoryValue: num(d.pricedInventoryValue),
      cogs: num(d.cogs),
      cogsCurrency: codeOf(d.cogsCurrency),
      houseCurrency: codeOf(d.houseCurrency),
      cogsUnpricedCount: num(d.cogsUnpricedCount) ?? undefined,
      cogsNote: typeof d.cogsNote === 'string' ? d.cogsNote : null,
      revenue: num(d.revenue),
      marginTaxNote: typeof d.marginTaxNote === 'string' && d.marginTaxNote ? d.marginTaxNote : null,
      grossMargin: num(d.grossMargin),
      cogsRatio: num(d.cogsRatio),
      inventoryTurnover: num(d.inventoryTurnover),
      daysInventoryOutstanding: num(d.daysInventoryOutstanding),
      turnsSpanNote: typeof d.turnsSpanNote === 'string' ? d.turnsSpanNote : null,
      turnsSpanShort: d.turnsSpanShort === true,
      gmroi: num(d.gmroi),
      deadStockCapital: num(d.deadStockCapital),
    };
  },
  view: (f) => {
    const cc = f.costCoverage;
    const uncosted = f.uncosted ?? [];
    const pc = f.priceCoverage;
    // F-1652: a wine costed for some of its bottles is a gap too, said in bottles.
    const partWines = cc?.partial ?? 0;
    const partBottles = cc?.uncostedBottles ?? 0;
    const partial =
      f.inventoryValue == null && f.pricedInventoryValue != null && !!cc && (cc.unpriced > 0 || partWines > 0);
    const leftOut = [
      cc && cc.unpriced > 0 ? `${figure(cc.unpriced)} wine${cc.unpriced === 1 ? '' : 's'} with no cost yet` : null,
      partWines > 0
        ? `${countOf(partBottles, 'bottle', 'bottles')} with no cost in ${countOf(partWines, 'wine', 'wines')} costed only in part`
        : null,
    ].filter((x): x is string => x !== null);
    const shortCogs = (f.cogsUnpricedCount ?? 0) > 0;
    const shortCogsWhy = shortCogs
      ? `${figure(f.cogsUnpricedCount as number)} delivered ${f.cogsUnpricedCount === 1 ? 'order has' : 'orders have'} no price, so Cost of goods is short`
      : undefined;
    // F-1518: why turns and days of stock read a dash, in the export's order
    // (report-export-cuttings.ts writeLedger), the gateway's own: an unpriced
    // delivery, Cost of goods in another money, Cost of goods withheld, the
    // short span, then the cost basis. The scaled-up span is not a reason;
    // it is said only beside a figure that is drawn.
    const turnsDrawn = f.inventoryTurnover != null || f.daysInventoryOutstanding != null;
    // F-1715: at a house whose till prices include tax, why a margin reads a
    // dash is the tax basis first; the sentence also says what a drawn one
    // is worked out on.
    const taxNote = f.marginTaxNote ?? undefined;
    const turnsWhy =
      shortCogsWhy ??
      (f.cogsCurrency && f.houseCurrency && f.cogsCurrency !== f.houseCurrency
        ? `Cost of goods is in ${f.cogsCurrency}, not the house's ${f.houseCurrency}, and with no exchange rate on record it is not set against the cellar`
        : f.cogsNote
          ? `Cost of goods is withheld: ${f.cogsNote}`
          : f.turnsSpanShort && f.turnsSpanNote
            ? f.turnsSpanNote
            : 'Needs a complete cost basis and a delivered order with a price');
    const all = [
      partial
        ? {
            label: 'Cellar at cost (priced wines)',
            value: money(f.pricedInventoryValue),
            note: `Leaves out ${leftOut.join(' and ')}`,
          }
        : {
            label: 'Cellar at cost',
            value: money(f.inventoryValue),
            note: 'Not every on-hand row carries a recorded cost',
          },
      {
        label: 'Cost of goods (365d)',
        value: money(f.cogs, 'full', f.cogsCurrency),
        note: f.cogsNote ?? 'No delivered order came back for the window',
      },
      {
        label: 'Sell-price valuation',
        value: money(f.revenue),
        note: taxNote ?? 'No wine on hand carries a bottle price, or no inventory row came back',
      },
      { label: 'Gross margin', value: ratioPct(f.grossMargin), note: taxNote ?? 'Needs a complete cost basis' },
      { label: 'COGS ratio', value: ratioPct(f.cogsRatio), note: taxNote },
      // F-1443: turns and days divide Cost of goods by the cellar; with
      // deliveries left out for no price that is short, so neither is drawn.
      // F-1491: otherwise a dash here had no reason; a young house's is its
      // short span.
      { label: 'Inventory turns', value: shortCogs ? EM : figure(f.inventoryTurnover), note: turnsWhy },
      { label: 'Days of inventory', value: shortCogs ? EM : figure(f.daysInventoryOutstanding), note: turnsWhy },
      { label: 'GMROI', value: figure(f.gmroi), note: taxNote },
      {
        label: 'Capital sitting still',
        value: money(f.deadStockCapital),
        note: 'No movement signal recorded, or an idle row has no cost',
      },
    ];
    // Staff keep the two figures that are counts of turns and days.
    const figures = f.amountsWithheld
      ? all.filter((x) => x.label === 'Inventory turns' || x.label === 'Days of inventory')
      : all;
    return {
      // The "table" of this register IS its figures — one label, one figure of
      // record — so it is rendered as the figure list rather than as a grid
      // repeating every label twice.
      node: (
        <dl className="rp-dl">
          {figures.map((x) => (
            <FigureRow key={x.label} label={x.label} value={x.value} note={x.note} />
          ))}
        </dl>
      ),
      figures,
      notes: [
        ...(f.amountsWithheld
        ? [AMOUNTS_WITHHELD]
        : [
        ...(cc && !cc.complete
          ? [
              cc.total === 0
                ? `No on-hand wine carries a recorded cost, so every cost-derived figure above reads ${EM} rather than a total assembled from nothing.`
                : partial && partWines === 0
                  ? `${figure(cc.unpriced)} of ${figure(cc.total)} on-hand wines have no cost yet, so the cellar figure above counts only the ${figure(cc.priced)} that do, and the figures built on the whole cellar read ${EM}.`
                  : partial
                  ? `The cellar figure above leaves out ${leftOut.join(' and ')}, so it counts only the bottles that carry a cost, and the figures built on the whole cellar read ${EM}.`
                  : `${figure(cc.priced)} of ${figure(cc.total)} on-hand wines carry a recorded cost, so every cost-derived figure above reads ${EM} rather than a total assembled from part of the cellar.`,
              // Which wines, and how to cost them (F-133): a wine's cost is
              // what its invoice says, so the way back is to file it.
              ...(uncosted.length > 0
                ? [
                    <>
                      No cost recorded yet for {uncosted.map((u) => u.name).join(', ')}
                      {cc.unpriced > uncosted.length
                        ? ` and ${countOf(cc.unpriced - uncosted.length, 'other', 'others')}`
                        : ''}
                      . A wine is costed from its invoice — <Link to="/receipts">file the invoice on Receipts</Link>{' '}
                      and these figures fill in.
                    </>,
                  ]
                : []),
            ]
          : []),
        ...(f.marginTaxNote ? [f.marginTaxNote] : []),
        // F-574: a wine with no bottle price is left out of the sell-price
        // valuation and the margin rather than counted as selling for $0.
        ...(pc && pc.unpriced > 0
          ? [
              `${countOf(pc.unpriced, 'wine on hand has', 'wines on hand have')} no bottle price, so ${pc.unpriced === 1 ? 'it is' : 'they are'} left out of the sell-price valuation, the gross margin and the COGS ratio, rather than counted as selling for nothing.`,
            ]
          : []),
        // F-701: a delivery with no price is left out of Cost of goods,
        // and said so, rather than added as $0.
        ...(f.cogsUnpricedCount && f.cogsUnpricedCount > 0
          ? [
              `${figure(f.cogsUnpricedCount)} delivered ${f.cogsUnpricedCount === 1 ? 'order carries' : 'orders carry'} no price, so Cost of goods leaves ${f.cogsUnpricedCount === 1 ? 'it' : 'them'} out and is short by what ${f.cogsUnpricedCount === 1 ? 'it' : 'they'} cost. Inventory turns and Days of inventory are not taken from it.`,
            ]
          : []),
      ]),
        // F-1491: the span turns and days of stock are taken over, staff
        // included — they keep those two figures. F-1518: only when it is
        // their reason or they are drawn from it.
        ...(f.turnsSpanNote && (f.turnsSpanShort || (!shortCogs && turnsDrawn)) ? [f.turnsSpanNote] : []),
      ],
      basis: [
        f.basis?.revenue,
        f.basis?.cogs,
        f.basis?.inventoryValue,
        f.basis?.turns,
        f.basis?.deadStock,
        f.basis?.costDerived,
      ],
    };
  },
});

/* ──────────────────────────── 8–9. what an empty POS window means ──── */

/**
 * The two POS registers below (the room, who served it) used to read "no check
 * in the window names a table / a server" as a fault in the feed — "an absent
 * field on the POS feed", "an absent attribution". The page is fixed at 90
 * days, so a window that simply holds no check (the feed stopped, the house
 * closed for a season) printed the same accusation. Analytics walk, 2026-10-03
 * (A-040): a window starting after Aug 30 on Tuzlu Rüzgar holds 0 checks
 * because the feed stops there, not because a field is missing.
 *
 * The gateway now says which it is (`table-analytics.service.ts` feedStatus):
 * `checksInWindow` counts the non-voided checks it read, and `latestCheckAt`
 * is the newest one this house has — null only when it has none at all. An
 * older gateway sends neither, and then this page asserts neither cause.
 */
export interface PosWindow {
  sinceDays: number;
  /** The calendar month read instead of `sinceDays` (w111-tips-owed); null or absent for the trailing window. */
  month?: string | null;
  /** null: the gateway did not say (it predates the field). */
  checksInWindow: number | null;
  /** The newest non-voided check's `opened_at`; null when none is on record. */
  latestCheckAt: string | null;
}

function posWindowOf(d: Record<string, unknown>): PosWindow {
  return {
    sinceDays: num(d.sinceDays) ?? 90,
    month: typeof d.month === 'string' && d.month ? d.month : null,
    checksInWindow: num(d.checksInWindow),
    latestCheckAt: typeof d.latestCheckAt === 'string' && d.latestCheckAt ? d.latestCheckAt : null,
  };
}

/** "Aug 30, 2026" from an ISO timestamp, in the reader's own calendar. */
function onDay(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * The sentence for a window that holds NO check, or null when it holds some
 * (or the gateway did not say). Only the caller's `checksInWindow > 0` branch
 * may blame a missing field — there are checks, and none of them carries it.
 */
/** "in the last 90 days", or "in July 2026" for a month (w111-tips-owed). */
function spanSaid(w: PosWindow): string {
  return w.month ? `in ${monthLabel(w.month)}` : `in the last ${w.sinceDays} days`;
}

export function emptyWindowLine(w: PosWindow): string | null {
  if (w.checksInWindow !== 0) return null;
  return w.latestCheckAt
    ? `No POS check was opened ${spanSaid(w)} — the latest this house has is from ${onDay(w.latestCheckAt)}. The window is empty; no field is missing.`
    : 'No POS check has reached Mudavym for this house yet (voided checks are not counted), so there is nothing to attribute.';
}

/* ──────────────────────────────────────────────────────── 8. the room ─── */

/**
 * F-1532: the room and server registers sum the checks' totals, which on most
 * tills hold tax and the tip, while the dashboard draws net sales (ADR 0287).
 * Word for word the gateway's `REGISTER_TOTALS_NOT_NET`
 * (`reports/exports/report-export-cuttings.ts`); change one and the other with it.
 */
export const REGISTER_TOTALS_NOT_NET =
  "Taken and the average check are check totals as your till sends them. On most tills that includes tax and tips, so they read higher than the dashboard's net sales, which are before tax and tips.";

/**
 * w111-net-table-revenue (AW17): the room and server registers' Taken and
 * average check are net sales, the dashboard's own reader, when the gateway
 * says so (`revenueBasis: 'net'`); an older gateway keeps the sentence above.
 * Word for word the gateway's `REGISTER_NET_SALES`.
 */
export const REGISTER_NET_SALES =
  "Taken and the average check are net sales, before tax and tips, the same figure as the dashboard's.";

/** w111: word for word the gateway's `checksWithoutNetSaid`. */
export function checksWithoutNetSaid(n: number): string {
  return `${n === 1 ? '1 check' : `${n} checks`} carried no amount before tax: counted in Checks, left out of Taken and the average check.`;
}

/** F-1532: word for word the gateway's `REGISTER_TIP_ON_NET`. */
export const REGISTER_TIP_ON_NET =
  'Tip is tips over net sales, before tax and tips, on the checks that recorded a tip.';

/**
 * F-1534: checks rung at 0, a comp or a staff meal, on the till, room and
 * server registers. Word for word the gateway's `zeroChecksSaid`
 * (`reports/exports/report-export-cuttings.ts`).
 */
export function zeroChecksSaid(n: number): string {
  return `${n} ${n === 1 ? 'check was' : 'checks were'} rung at 0, such as a comp or a staff meal: counted in Checks, left out of the average check.`;
}

/**
 * F-1644: refunds the till sent as checks with a minus total, on the till,
 * room and server registers. Word for word the gateway's `refundChecksSaid`
 * (`reports/exports/report-export-cuttings.ts`).
 */
export function refundChecksSaid(n: number): string {
  return `${n} ${n === 1 ? 'check was a refund' : 'checks were refunds'}, sent by your till with a minus total: counted in Checks, taken off Taken, left out of the average check.`;
}

export interface SeatsRegister extends PosWindow {
  dataStatus: string;
  /** Checks in the window with no table: the till named none, or a word no table answers (ADR 0303); null from an older gateway. */
  checksWithoutTable: number | null;
  /** Checks in the window at a hidden (or retired) table; null from an older gateway. */
  checksAtHiddenTables: number | null;
  /** How many hidden (or retired) tables those checks were at. */
  hiddenTables: number | null;
  /** The house's tables hidden now, whatever the window held; null from an older gateway. */
  hiddenTablesInHouse: number | null;
  /** Checks at a shown table rung at 0, out of every average (F-1534); 0 from an older gateway. */
  checksTakingNoMoney: number;
  /** Refunds, checks with a minus total (F-1644). 0 from an older gateway. */
  checksRefunded: number;
  /** w109-gross-basis (ADR 0341): only where till prices include tax, or that answer is unread. */
  totalsTaxNote?: string | null;
  /** w111: 'net' when Taken is net sales, as the dashboard's; null from an older gateway (check totals). */
  revenueBasis: 'net' | null;
  /** w111: checks that stated no net, out of Taken; 0 from an older gateway. */
  checksWithoutNet: number;
  /** w111 (ADR 0341 F2): the window's net is not on one tax basis, and why; null when it is. */
  netSalesTaxNote: string | null;
  tables: Array<{
    tableId: string;
    label: string;
    zone: string | null;
    seats: number | null;
    checks: number;
    /** Null: the table had checks and not one stated its net ("not recorded"). */
    revenue: number | null;
    covers: number;
    avgCheck: number | null;
    revenuePerSeat: number | null;
    seatUtilization: number | null;
    wineAttachRate: number | null;
  }>;
}

const seats = analysis<SeatsRegister>({
  title: 'The room',
  register: 'table register',
  answers: 'Which tables earn, and which seats sit idle',
  window: () => 'the last 90 days of POS checks',
  path: (rid) => `/analytics/table-performance/${rid}?sinceDays=90`,
  graphs: ['bars', 'scatter', 'table'],
  graphNote:
    'The scatter puts seats against average check, which is the question this register exists for. No line, area or heat map: tables are not a sequence and the endpoint returns no per-day grain.',
  select: (raw) => {
    const d = obj(raw);
    return {
      ...posWindowOf(d),
      dataStatus: str(d.dataStatus),
      checksWithoutTable: num(d.checksWithoutTable),
      checksAtHiddenTables: num(d.checksAtHiddenTables),
      hiddenTables: num(d.hiddenTables),
      hiddenTablesInHouse: num(d.hiddenTablesInHouse),
      checksTakingNoMoney: num(d.checksTakingNoMoney) ?? 0,
      checksRefunded: num(d.checksRefunded) ?? 0,
      totalsTaxNote: str(d.totalsTaxNote) || null,
      revenueBasis: d.revenueBasis === 'net' ? 'net' : null,
      checksWithoutNet: num(d.checksWithoutNet) ?? 0,
      netSalesTaxNote: str(d.netSalesTaxNote) || null,
      tables: arr(d.tables).map((t) => ({
        tableId: str(t.tableId),
        label: str(t.label),
        zone: (t.zone ?? null) as string | null,
        seats: num(t.seats),
        checks: num(t.checks) ?? 0,
        revenue: d.revenueBasis === 'net' ? num(t.revenue) : (num(t.revenue) ?? 0),
        covers: num(t.covers) ?? 0,
        avgCheck: num(t.avgCheck),
        revenuePerSeat: num(t.revenuePerSeat),
        seatUtilization: num(t.seatUtilization),
        wineAttachRate: num(t.wineAttachRate),
      })),
    };
  },
  view: (s) => {
    const basis = [
      `Non-voided pos_checks the till attributed to a shown table over the last ${s.sinceDays} days.`,
      s.revenueBasis === 'net' ? REGISTER_NET_SALES : REGISTER_TOTALS_NOT_NET,
      s.totalsTaxNote ?? null,
      s.netSalesTaxNote,
      s.dataStatus ? `Feed: ${s.dataStatus}.` : null,
    ];
    // ADR 0303: tables are learned from the till, so nothing is drawn. A check
    // the till sent without a table, or one at a table the owner hid, is in
    // takings and in no table's figure; the register says how many.
    const withoutTable = s.checksWithoutTable ?? 0;
    const atHidden = s.checksAtHiddenTables ?? 0;
    const hiddenInHouse = s.hiddenTablesInHouse ?? 0;
    const hiddenNote =
      atHidden > 0
        ? `${countOf(atHidden, 'check was', 'checks were')} at ${countOf(s.hiddenTables ?? 0, 'hidden table', 'hidden tables')}: counted in takings, not shown here.`
        : null;
    if (s.tables.length === 0)
      return {
        say:
          withoutTable > 0
            ? `${countOf(withoutTable, 'check in this window has', 'checks in this window have')} no table, so none can be attributed to a seat. They are in takings. A till word with no number in it, such as Booth or a name, makes no table.`
            : atHidden > 0
              ? 'No shown table took a check in this window; show a table again under Settings → Point of sale.'
              : hiddenInHouse > 0
                ? 'Every table in this house is hidden, and this window held no check. Show a table again under Settings → Point of sale.'
                : 'This house has no table yet, so no check can be attributed to a seat. A table is learned when a check arrives naming one with a number in it, such as T12, 12 or Patio 3; rename or hide it under Settings → Point of sale.',
        figures: [],
        notes: hiddenNote ? [hiddenNote] : [],
        basis,
      };
    const roomNotes = [
      withoutTable > 0
        ? `${countOf(withoutTable, 'check has', 'checks have')} no table: counted in takings, not in the room.`
        : null,
      hiddenNote,
      s.checksTakingNoMoney > 0 ? zeroChecksSaid(s.checksTakingNoMoney) : null,
      s.checksRefunded > 0 ? refundChecksSaid(s.checksRefunded) : null,
      s.checksWithoutNet > 0 ? checksWithoutNetSaid(s.checksWithoutNet) : null,
    ].filter((n): n is string => n !== null);
    const served = s.tables.filter((t) => t.checks > 0);
    const figures = [
      { label: 'Tables in the room', value: figure(s.tables.length) },
      { label: 'Tables that took a check', value: figure(served.length) },
      {
        label: 'Busiest by takings',
        value: served.length > 0 ? served[0].label : EM,
        note: 'No check has been attributed to any table',
      },
    ];
    if (served.length === 0) {
      const mapped = `${countOf(s.tables.length, 'table is', 'tables are')} mapped`;
      const empty = emptyWindowLine(s);
      const n = s.checksInWindow;
      const none =
        n === 1
          ? `the one check in the last ${s.sinceDays} days was not`
          : `not one of the ${countOf(n, 'check', 'checks')} in the last ${s.sinceDays} days was`;
      return {
        say: empty
          ? `${mapped}. ${empty}`
          : n !== null && n > 0
            ? atHidden > 0
              ? `${mapped}, and ${none} attributed to any of them.`
              : `${mapped}, and ${none} attributed to any of them — that is an absent attribution, not an empty room.`
            : `${mapped}, and no check in the last ${s.sinceDays} days was attributed to any of them. This register does not say whether the window held any check, so an empty window and checks that name no table cannot be told apart here.`,
        figures,
        notes: roomNotes,
        basis,
      };
    }
    const withCheck = served.filter((t) => t.avgCheck != null && t.seats != null);
    return {
      cats: {
        // w111: a table whose net was not recorded has no bar, never one at 0.
        data: served
          .filter((t): t is typeof t & { revenue: number } => t.revenue !== null)
          .slice(0, 14)
          .map((t) => ({
            label: t.label,
            value: t.revenue,
            full: `${t.label}${t.zone ? ` · ${t.zone}` : ''}`,
          })),
        xLabel: 'table',
        yLabel: 'taken',
        unit: 'taken',
        format: (v) => money(v, 'compact'),
      },
      points: {
        data: withCheck.map((t) => ({
          x: t.seats as number,
          y: Number((t.avgCheck as number).toFixed(2)),
          name: t.label,
        })),
        xLabel: 'seats',
        yLabel: 'average check',
        formatX: (v) => figure(v),
        formatY: (v) => money(v, 'compact'),
        refX: null,
        refY: null,
      },
      table: {
        cols: [
          { key: 't', label: 'Table' },
          { key: 'c', label: 'Checks', numeric: true },
          { key: 'r', label: 'Taken', numeric: true },
          { key: 'a', label: 'Avg check', numeric: true },
          { key: 'w', label: 'Wine attach', numeric: true },
        ],
        rows: s.tables.slice(0, 40).map((t) => ({
          key: t.tableId,
          cells: [
            t.label,
            figure(t.checks),
            money(t.revenue, 'table'),
            money(t.avgCheck, 'table'),
            ratioPct(t.wineAttachRate),
          ],
        })),
      },
      figures,
      notes: [
        ...(s.tables.length > served.length
          ? [
              `${countOf(s.tables.length - served.length, 'mapped table', 'mapped tables')} took no check in the window, and is drawn at no height rather than left off the chart.`,
            ]
          : []),
        ...roomNotes,
      ],
      basis,
    };
  },
});

/* ────────────────────────────────────────────────── 9. who served it ──── */

export interface ServiceRegister extends PosWindow {
  dataStatus: string;
  /** 'net' when Tip % is over the checks' subtotal (F-1532); null from an older gateway, which took it over the total. */
  tipBasis: 'net' | null;
  /** F-1573: the gateway's reason when Tip is not (all) over net sales — a till that sends no amount before tax; null otherwise. */
  tipBasisWhy: string | null;
  /** F-1581: tipped checks whose net this house's tax settings left unrecorded; 0 from an older gateway. */
  tipsNetNotRecorded: number;
  /** F-1612: the same, by the reason kept on each check; empty from an older gateway. */
  tipsNetNotRecordedByReason: Record<string, number>;
  /** F-1588: Tip's net is not on one tax basis across this window, and why; null when it is, or from an older gateway. */
  tipTaxNote: string | null;
  /** Checks rung at 0, out of Avg check (F-1534); 0 from an older gateway. */
  checksTakingNoMoney: number;
  /** Refunds, checks with a minus total (F-1644). 0 from an older gateway. */
  checksRefunded: number;
  /** w109-gross-basis (ADR 0341): only where till prices include tax, or that answer is unread. */
  totalsTaxNote?: string | null;
  /** w111: 'net' when Taken is net sales, as the dashboard's; null from an older gateway (check totals). */
  revenueBasis: 'net' | null;
  /** w111: checks that stated no net, out of Taken; 0 from an older gateway. */
  checksWithoutNet: number;
  /** w111 (ADR 0341 F2): the window's net is not on one tax basis, and why; null when it is. */
  netSalesTaxNote: string | null;
  adjusted: { method?: string; r2?: number | null } | null;
  /** Every server's tips as money; null when no check carried one, or from an older gateway. */
  tips: number | null;
  waiters: Array<{
    name: string;
    checks: number;
    /** Null: the server had checks and not one stated its net ("not recorded"). */
    revenue: number | null;
    avgCheck: number | null;
    wineAttachRate: number | null;
    tipPct: number | null;
    /** The money tipped on their checks; null when none carried a tip, or from an older gateway. */
    tips: number | null;
    revenuePerCover: number | null;
  }>;
}

const trailingService = analysis<ServiceRegister>({
  title: 'Who served it',
  register: 'server register',
  answers: 'What each server’s checks look like, before and after the table they were given',
  window: () => 'the last 90 days of POS checks',
  path: (rid) => `/analytics/waiters/${rid}?sinceDays=90`,
  graphs: ['bars', 'table'],
  graphNote:
    'Bars rank one measure; the table carries all six. No scatter — the endpoint publishes no second axis a server can be placed on without a fixed effect, and its own adjusted model is a fit, not a coordinate.',
  select: (raw) => {
    const d = obj(raw);
    const adj = d.adjusted ? obj(d.adjusted) : null;
    return {
      ...posWindowOf(d),
      dataStatus: str(d.dataStatus),
      tipBasis: d.tipBasis === 'net' ? 'net' : null,
      tipBasisWhy: str(d.tipBasisWhy) || null,
      tipsNetNotRecorded: num(d.tipsNetNotRecorded) ?? 0,
      tipsNetNotRecordedByReason: countsByReasonFrom(d.tipsNetNotRecordedByReason),
      tipTaxNote: str(d.tipTaxNote) || null,
      checksTakingNoMoney: num(d.checksTakingNoMoney) ?? 0,
      checksRefunded: num(d.checksRefunded) ?? 0,
      totalsTaxNote: str(d.totalsTaxNote) || null,
      revenueBasis: d.revenueBasis === 'net' ? 'net' : null,
      checksWithoutNet: num(d.checksWithoutNet) ?? 0,
      netSalesTaxNote: str(d.netSalesTaxNote) || null,
      adjusted: adj ? { method: str(adj.method), r2: num(adj.r2) } : null,
      tips: num(d.tips),
      waiters: arr(d.waiters).map((w) => ({
        name: str(w.name),
        checks: num(w.checks) ?? 0,
        revenue: d.revenueBasis === 'net' ? num(w.revenue) : (num(w.revenue) ?? 0),
        avgCheck: num(w.avgCheck),
        wineAttachRate: num(w.wineAttachRate),
        tipPct: num(w.tipPct),
        tips: num(w.tips),
        revenuePerCover: num(w.revenuePerCover),
      })),
    };
  },
  view: (s) => {
    const basis = [
      `Non-voided pos_checks grouped by server name ${s.month ? `in ${monthLabel(s.month)}, by the house’s days` : `over the last ${s.sinceDays} days`}.`,
      s.revenueBasis === 'net' ? REGISTER_NET_SALES : REGISTER_TOTALS_NOT_NET,
      s.totalsTaxNote ?? null,
      s.netSalesTaxNote,
      s.tipBasis === 'net' ? REGISTER_TIP_ON_NET : null,
      s.tipBasisWhy,
      s.dataStatus ? `Feed: ${s.dataStatus}.` : null,
      s.adjusted?.method ?? null,
    ];
    const figures = [
      { label: 'Servers with a check', value: figure(s.waiters.length) },
      {
        label: 'Tips',
        value: money(s.tips, 'full'),
        note: 'The money tipped on the checks that carried a tip; a dash when none did',
      },
      {
        label: 'Table-adjusted fit (R²)',
        value: s.adjusted?.r2 == null ? EM : ratioPct(s.adjusted.r2, 2),
        note: 'Needs 10 checks across at least two tables before a server can be separated from their section',
      },
    ];
    if (s.waiters.length === 0) {
      const n = s.checksInWindow;
      const none =
        n === 1
          ? `The one check ${spanSaid(s)} carries no`
          : `None of the ${countOf(n, 'check', 'checks')} ${spanSaid(s)} carries a`;
      return {
        say:
          emptyWindowLine(s) ??
          (n !== null && n > 0
            ? `${none} server name, so nothing can be attributed to anyone. That is an absent field on the POS feed, not a shift nobody worked.`
            : `No check ${spanSaid(s)} names a server. This register does not say whether the window held any check, so an empty window and checks that carry no server name cannot be told apart here.`),
        figures,
        notes: [],
        basis,
      };
    }
    return {
      cats: {
        // w111: a server whose net was not recorded has no bar, never one at 0.
        data: s.waiters
          .filter((w): w is typeof w & { revenue: number } => w.revenue !== null)
          .slice(0, 14)
          .map((w) => ({
            label: w.name.length > 12 ? `${w.name.slice(0, 11)}…` : w.name,
            value: w.revenue,
            full: `${w.name} · ${countOf(w.checks, 'check', 'checks')}`,
          })),
        xLabel: 'server',
        yLabel: 'taken',
        unit: 'taken',
        format: (v) => money(v, 'compact'),
      },
      table: {
        cols: [
          { key: 'n', label: 'Server' },
          { key: 'c', label: 'Checks', numeric: true },
          { key: 'a', label: 'Avg check', numeric: true },
          { key: 'w', label: 'Wine attach', numeric: true },
          { key: 't', label: 'Tip', numeric: true },
          { key: 'm', label: 'Tips', numeric: true },
        ],
        rows: s.waiters.slice(0, 40).map((w) => ({
          key: w.name,
          cells: [
            w.name,
            figure(w.checks),
            money(w.avgCheck, 'table'),
            ratioPct(w.wineAttachRate),
            ratioPct(w.tipPct),
            money(w.tips, 'table'),
          ],
        })),
      },
      figures,
      notes: [
        'A server’s raw average is partly the section they were given. The adjusted fit above is the engine’s attempt to remove it; where it reads an em dash, the raw ranking is all there is.',
        ...(s.checksTakingNoMoney > 0 ? [zeroChecksSaid(s.checksTakingNoMoney)] : []),
        ...(s.checksRefunded > 0 ? [refundChecksSaid(s.checksRefunded)] : []),
        ...(s.checksWithoutNet > 0 ? [checksWithoutNetSaid(s.checksWithoutNet)] : []),
        ...(s.tipsNetNotRecorded > 0 ? [tipsNetNotRecordedSaid(s.tipsNetNotRecorded, s.tipsNetNotRecordedByReason)] : []),
        // F-1588: Tip is over net sales; the gateway's sentence when this
        // window's net changes tax basis (ADR 0341 F2), as the export says it.
        ...(s.tipTaxNote ? [`Tip is worked out on net sales. ${s.tipTaxNote}`] : []),
      ],
      basis,
    };
  },
});

/**
 * Who served it over one calendar month when the reader picked one, on the
 * house's days as the till's month is read (w111-tips-owed), otherwise the
 * trailing 90 days above, unchanged: the export desk pins that one against
 * its own catalogue, and it still writes only the trailing window.
 */
const service: AnalysisSpec = {
  ...trailingService,
  takesMonth: true,
  // The till's own month line, so the two read the same month alike.
  window: (ctx) => (ctx.month ? till.window({ ...ctx, week: null }) : trailingService.window(ctx)),
  path: (rid, ctx) =>
    ctx.month ? `/analytics/waiters/${rid}?month=${ctx.month}` : trailingService.path!(rid, ctx),
};

/**
 * F-1581: tipped checks with no net because the house's prices include tax
 * and the tax could not be taken off. F-1612 = F-1623: counted by the reason
 * kept on each check, each in its own words and with its own fix (no rate,
 * an unreadable till tax, tax on top...), never all as "no rate in force".
 * An older gateway that sends no reasons gets the count alone.
 */
function tipsNetNotRecordedSaid(n: number, byReason: Record<string, number>): ReactNode {
  const reasons = netNotRecordedReasonsSaid(byReason);
  return (
    <span key="tips-net-not-recorded" data-testid="rp-tips-net-not-recorded">
      {n === 1 ? '1 tipped check has' : `${n} tipped checks have`} no net sales, because the tax could not be taken off{' '}
      {n === 1 ? 'it' : 'them'}, so {n === 1 ? 'its tip is' : 'their tips are'} left out of Tip
      {reasons.length > 0 ? ':' : '.'}
      {reasons.map((r, i) => (
        <span key={r.reason} data-testid={`rp-tips-net-not-recorded-${r.reason}`}>
          {' '}
          {countOf(r.n, 'check', 'checks')}, {r.why}
          {i < reasons.length - 1 ? ';' : '.'}
          {r.fix && (
            <>
              {' '}
              <Link to={r.fix.to} className="rp-link rp-ink rp-focus rp-no-drag">
                {r.fix.label}
              </Link>
            </>
          )}
        </span>
      ))}
    </span>
  );
}

/* ──────────────────────────────────────────── 10. what to buy back ────── */

export interface RestockRegister {
  params: { serviceLevel: number | null; leadTimeDays: number | null; demandWindowDays: number | null };
  basis?: Record<string, string>;
  skuCount: number;
  reorderCount: number;
  reorderList: Array<{
    id: string;
    name: string;
    onHand: number;
    daysOfCover: number | null;
    reorderPoint: number | null;
    safetyStock: number | null;
    stockoutProbability: number | null;
  }>;
}

/**
 * The first `n` bars, extended through every row tied with bar `n` (ADR 0272).
 *
 * The register arrives highest risk first, and a plain `slice(0, 14)` drew
 * some wines of a tie and dropped the rest by row order — a ranking the data
 * did not make. A tie is the same computed risk, to within floating-point
 * noise (one part in a billion, the gateway's own `sameValue`); two risks that
 * merely PRINT alike (26.8% and 26.9%, both "27%") are not tied.
 *
 * A tie at 0% is never extended, as on the gateway's cut: it is the wines with
 * no demand and nothing on hand, a group with no risk to rank and no height to
 * draw, and extending through it drew every one of them.
 */
function barsKeepingTies(
  rows: RestockRegister['reorderList'],
  n: number,
): RestockRegister['reorderList'] {
  if (rows.length <= n) return rows;
  const same = (a: number | null, b: number | null) =>
    a == null || b == null
      ? a == null && b == null
      : Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  const edge = rows[n - 1].stockoutProbability;
  if (edge == null || edge <= 0 || same(edge, 0)) return rows.slice(0, n);
  let end = n;
  while (end < rows.length && same(rows[end].stockoutProbability, edge)) end++;
  return rows.slice(0, end);
}

const restock = analysis<RestockRegister>({
  title: 'What to buy back',
  register: 'reorder register',
  answers: 'What is about to run out, and how likely it is to run out first',
  window: () => 'demand over the last 90 days to yesterday, not counting today until it is over, at the service level in the params',
  path: (rid) => `/analytics/inventory-science/${rid}`,
  graphs: ['table', 'bars'],
  graphNote:
    'The table is first because a reorder list is read row by row, not skimmed as a shape. Bars rank the same rows by stockout probability. No line, area or scatter: this is a list at one moment, not a series.',
  select: (raw) => {
    const d = obj(raw);
    const p = obj(d.params);
    return {
      params: {
        serviceLevel: num(p.serviceLevel),
        leadTimeDays: num(p.leadTimeDays),
        demandWindowDays: num(p.demandWindowDays),
      },
      basis: d.basis as Record<string, string>,
      skuCount: num(d.skuCount) ?? 0,
      reorderCount: num(d.reorderCount) ?? 0,
      reorderList: arr(d.reorderList).map((s) => ({
        id: str(s.id),
        name: str(s.name),
        onHand: num(s.onHand) ?? 0,
        daysOfCover: num(s.daysOfCover),
        reorderPoint: num(s.reorderPoint),
        safetyStock: num(s.safetyStock),
        stockoutProbability: num(s.stockoutProbability),
      })),
    };
  },
  view: (r) => {
    const basis = [r.basis?.demand, r.basis?.reorderScience, r.basis?.costDerived];
    const figures = [
      { label: 'Wines on the register', value: figure(r.skuCount) },
      { label: 'Below their reorder point', value: figure(r.reorderCount) },
      { label: 'Service level', value: ratioPct(r.params.serviceLevel, 0) },
      { label: 'Lead time assumed', value: figure(r.params.leadTimeDays) },
    ];
    if (r.skuCount === 0)
      return {
        say: 'No wine came back from the inventory register, so there is nothing to reorder and nothing to say about cover.',
        figures,
        notes: [],
        basis,
      };
    if (r.reorderList.length === 0)
      return {
        say: `Nothing is below its reorder point. That is a real answer about ${countOf(r.skuCount, 'wine', 'wines')}, not an empty register.`,
        figures,
        notes: [],
        basis,
      };
    return {
      cats: {
        data: barsKeepingTies(r.reorderList, 14).map((s) => ({
          label: s.name.length > 12 ? `${s.name.slice(0, 11)}…` : s.name,
          value: s.stockoutProbability,
          full: `${s.name} · ${figure(s.onHand)} on hand`,
        })),
        xLabel: 'wine',
        yLabel: 'stockout risk',
        unit: 'chance of running out before the delivery',
        format: (v) => ratioPct(v, 0),
      },
      table: {
        cols: [
          { key: 'n', label: 'Wine' },
          { key: 'o', label: 'On hand', numeric: true },
          { key: 'd', label: 'Days of cover', numeric: true },
          { key: 'r', label: 'Reorder at', numeric: true },
          { key: 'p', label: 'Stockout risk', numeric: true },
        ],
        rows: r.reorderList.map((s) => ({
          key: s.id,
          cells: [
            s.name,
            figure(s.onHand),
            figure(s.daysOfCover),
            figure(s.reorderPoint),
            ratioPct(s.stockoutProbability, 0),
          ],
        })),
        more:
          r.reorderCount > r.reorderList.length
            ? `${figure(r.reorderCount)} wines are below their reorder point; the ${figure(r.reorderList.length)} at the highest risk are listed.`
            : undefined,
      },
      figures,
      notes: [
        'A days-of-cover em dash means the wine has no measured demand — it cannot run out on a rate nobody has observed.',
        // F-688: the two pages work a reorder out differently; each says how.
        "A wine listed fewer than 90 days ago is averaged over the days it has been listed. Each wine's own row on Inventory works its order out from 30 days of sales, a 6-day wait and two weeks on the shelf, so the two can name different amounts.",
      ],
      basis,
    };
  },
});

/* ───────────────────────────────────────────────── 11. the writing desk ── */

/**
 * The writing desk — where a report used to be promised, and now points at the
 * place one is actually written.
 *
 * Until 2026-09-17 this cutting rendered a disabled "Write this sheet up": the
 * only endpoint behind it, `POST /reports/generate`, filed a `generated_reports`
 * row marked `pending` that nothing ever wrote (OD-81). The founder's answer
 * (ADR 0149 row 20) was a real export, and it lives under the sheet
 * (`ExportsShelf.tsx`): a cutting is written by the gateway to a CSV and a page
 * laid out for print, with the status the server holds. `/reports/generate`
 * now answers 410. So the desk no longer carries a dead button; it says where
 * the writing happens, and keeps the archive one link away.
 */
const writing = analysis<null>({
  title: 'The writing desk',
  register: 'report archive',
  answers: 'Where a cutting is written up — the shelf under the sheet (OD-81)',
  window: () => 'no register: this cutting reads nothing',
  path: null,
  graphs: [],
  graphNote:
    'No drawing at all: there is no register behind this cutting to draw. It is here to say where reports are written.',
  select: () => null,
  view: () => ({
    node: (
      <div style={{ display: 'grid', gap: 8 }}>
        <p className="rp-note">
          A cutting is written up under the sheet, in “Written up”: the gateway writes it to a CSV
          and a page laid out for print, from the same register the cutting reads, and shows whether
          it is being written, ready, or not written and why. A figure the engine could not compute
          is written <span style={{ fontFamily: MONO }}>withheld</span>, never 0.
        </p>
        <div className="rp-row" style={{ gap: 10 }}>
          <a href="#rp-exports" className="rp-link rp-ink rp-focus rp-no-drag">
            Go to what is written up
          </a>
          <Link to="/documents-reports" className="rp-link rp-ink rp-focus rp-no-drag">
            Open the document archive
          </Link>
        </div>
      </div>
    ),
    figures: [],
    notes: [],
    basis: [],
  }),
});

export { quadrants, ledger, seats, service, restock, writing };
