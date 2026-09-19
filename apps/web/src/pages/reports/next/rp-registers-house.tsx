/**
 * The house registers — the cellar, the room, the people, and the desk that is
 * honest about writing nothing.
 *
 * Six of the eleven catalogue entries (`rp-catalogue.tsx` assembles them all).
 * Same contract as the trade registers: a path, a window, the drawings that are
 * true of the data, and one `view` builder that reduces the payload to the
 * shape `Cutting.tsx` draws.
 *
 * Every `basis` array below holds the SERVER's own sentences, verbatim.
 */

import { Link } from 'react-router-dom';
import { FigureRow } from './rp-plot';
import { EM, MONO, countOf, figure, money, num, ratioPct } from './rp-format';
import { analysis, arr, obj, str } from './rp-spec';

/* ────────────────────────────────────────── 6. margin against movement ── */

export interface QuadrantItem {
  id: string;
  name: string;
  velocityPerDay: number;
  /** null when the row has no recorded cost — it has NO quadrant, not "dog". */
  marginPerBottle: number | null;
  marginPct: number | null;
  quadrant: string | null;
}

export interface QuadrantRegister {
  basis?: { velocity?: string; margin?: string };
  costCoverage?: { total: number; priced: number; unpriced: number; complete: boolean };
  medians: { velocityPerDay: number | null; marginPerBottle: number | null };
  counts: Record<string, number>;
  items: QuadrantItem[];
}

const quadrants = analysis<QuadrantRegister>({
  title: 'Margin against movement',
  register: 'menu-engineering register',
  answers: 'Which wines earn their place: margin against how fast they move',
  window: () => 'the list as it stands, against 90 days of movement',
  path: (rid) => `/analytics/menu-engineering/${rid}`,
  graphs: ['scatter', 'bars', 'table'],
  graphNote:
    'The scatter is the only drawing that shows both measures at once; bars and the table rank on margin alone. No line or area — these are wines, not a sequence, and joining them would draw a trend through an alphabet.',
  select: (raw) => {
    const d = obj(raw);
    const medians = obj(d.medians);
    return {
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
        velocityPerDay: num(i.velocityPerDay) ?? 0,
        marginPerBottle: num(i.marginPerBottle),
        marginPct: num(i.marginPct),
        quadrant: (i.quadrant ?? null) as string | null,
      })),
    };
  },
  view: (q) => {
    const unclassified = q.counts.unclassified ?? 0;
    const priced = q.items.filter((i) => i.marginPerBottle != null);
    const basis = [q.basis?.velocity, q.basis?.margin];
    const figures = [
      { label: 'Stars', value: figure(q.counts.star ?? 0) },
      { label: 'Plowhorses', value: figure(q.counts.plowhorse ?? 0) },
      { label: 'Puzzles', value: figure(q.counts.puzzle ?? 0) },
      { label: 'Dogs', value: figure(q.counts.dog ?? 0) },
      { label: 'No quadrant', value: figure(unclassified) },
    ];
    if (priced.length === 0)
      return {
        say: `No wine on the list carries both a recorded cost and a menu price, so there is no margin axis to plot against.${
          unclassified > 0
            ? ` ${countOf(unclassified, 'wine is', 'wines are')} unclassified for that reason — not because they sell badly.`
            : ' Nothing is filed in a quadrant, and nothing is guessed into one.'
        }`,
        figures,
        notes: [],
        basis,
      };
    const ranked = [...priced].sort(
      (a, b) => (b.marginPerBottle as number) - (a.marginPerBottle as number),
    );
    return {
      points: {
        data: priced.map((i) => ({
          x: Number(i.velocityPerDay.toFixed(3)),
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
            figure(i.velocityPerDay),
            money(i.marginPerBottle, 'table'),
            i.quadrant ?? EM,
          ],
        })),
        more:
          unclassified > 0
            ? `${countOf(unclassified, 'wine has', 'wines have')} no quadrant because no cost was ever recorded for them.`
            : undefined,
      },
      figures,
      notes: [
        `Fast is right of the vertical rule, fat-margin is above the horizontal one; both rules are the engine’s own medians. ${countOf(unclassified, 'wine is', 'wines are')} off the plot for want of a recorded cost — an uncosted wine is unknown, not a dog.`,
      ],
      basis,
    };
  },
});

/* ──────────────────────────────────────────────── 7. figures of record ── */

export interface LedgerRegister {
  basis?: Record<string, string>;
  costCoverage?: { total: number; priced: number; unpriced: number; complete: boolean };
  inventoryValue: number | null;
  cogs: number | null;
  revenue: number | null;
  grossMargin: number | null;
  cogsRatio: number | null;
  inventoryTurnover: number | null;
  daysInventoryOutstanding: number | null;
  gmroi: number | null;
  deadStockCapital: number | null;
}

const ledger = analysis<LedgerRegister>({
  title: 'Figures of record',
  register: 'financial register',
  answers: 'What the cellar is worth, and how hard that capital is working',
  window: () => '365 days of COGS; the cellar as it stands today',
  path: (rid) => `/analytics/financial/${rid}`,
  graphs: ['table', 'figure'],
  graphNote:
    'No bars, line or area: these eight figures are in four different units — money, a ratio, a count of turns, a count of days — and one axis across them would compare dollars with days.',
  select: (raw) => {
    const d = obj(raw);
    return {
      basis: d.basis as Record<string, string>,
      costCoverage: d.costCoverage as LedgerRegister['costCoverage'],
      inventoryValue: num(d.inventoryValue),
      cogs: num(d.cogs),
      revenue: num(d.revenue),
      grossMargin: num(d.grossMargin),
      cogsRatio: num(d.cogsRatio),
      inventoryTurnover: num(d.inventoryTurnover),
      daysInventoryOutstanding: num(d.daysInventoryOutstanding),
      gmroi: num(d.gmroi),
      deadStockCapital: num(d.deadStockCapital),
    };
  },
  view: (f) => {
    const cc = f.costCoverage;
    const figures = [
      {
        label: 'Cellar at cost',
        value: money(f.inventoryValue),
        note: 'Not every on-hand row carries a recorded cost',
      },
      {
        label: 'Cost of goods (365d)',
        value: money(f.cogs),
        note: 'No delivered order came back for the window — which is either no buying or a read that failed',
      },
      {
        label: 'Sell-price valuation',
        value: money(f.revenue),
        note: 'No inventory row came back',
      },
      { label: 'Gross margin', value: ratioPct(f.grossMargin), note: 'Needs a complete cost basis' },
      { label: 'COGS ratio', value: ratioPct(f.cogsRatio) },
      { label: 'Inventory turns', value: figure(f.inventoryTurnover) },
      { label: 'Days of inventory', value: figure(f.daysInventoryOutstanding) },
      { label: 'GMROI', value: figure(f.gmroi) },
      {
        label: 'Capital sitting still',
        value: money(f.deadStockCapital),
        note: 'No movement signal recorded, or an idle row has no cost',
      },
    ];
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
      notes:
        cc && !cc.complete
          ? [
              cc.total === 0
                ? `No on-hand wine carries a recorded cost, so every cost-derived figure above reads ${EM} rather than a total assembled from nothing.`
                : `${figure(cc.priced)} of ${figure(cc.total)} on-hand wines carry a recorded cost, so every cost-derived figure above reads ${EM} rather than a total assembled from part of the cellar.`,
            ]
          : [],
      basis: [
        f.basis?.revenue,
        f.basis?.cogs,
        f.basis?.inventoryValue,
        f.basis?.deadStock,
        f.basis?.costDerived,
      ],
    };
  },
});

/* ──────────────────────────────────────────────────────── 8. the room ─── */

export interface SeatsRegister {
  sinceDays: number;
  dataStatus: string;
  tables: Array<{
    tableId: string;
    label: string;
    zone: string | null;
    seats: number | null;
    checks: number;
    revenue: number;
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
      sinceDays: num(d.sinceDays) ?? 90,
      dataStatus: str(d.dataStatus),
      tables: arr(d.tables).map((t) => ({
        tableId: str(t.tableId),
        label: str(t.label),
        zone: (t.zone ?? null) as string | null,
        seats: num(t.seats),
        checks: num(t.checks) ?? 0,
        revenue: num(t.revenue) ?? 0,
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
      `Non-voided pos_checks attributed to a table over the last ${s.sinceDays} days.`,
      s.dataStatus ? `Feed: ${s.dataStatus}.` : null,
    ];
    if (s.tables.length === 0)
      return {
        say: 'No table is mapped for this restaurant yet, so no check can be attributed to a seat. The room has to be drawn before it can be read.',
        figures: [],
        notes: [],
        basis,
      };
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
    if (served.length === 0)
      return {
        say: `${countOf(s.tables.length, 'table is', 'tables are')} mapped, and not one check in the last ${s.sinceDays} days was attributed to any of them — that is an absent attribution, not an empty room.`,
        figures,
        notes: [],
        basis,
      };
    const withCheck = served.filter((t) => t.avgCheck != null && t.seats != null);
    return {
      cats: {
        data: served.slice(0, 14).map((t) => ({
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
      notes:
        s.tables.length > served.length
          ? [
              `${countOf(s.tables.length - served.length, 'mapped table', 'mapped tables')} took no check in the window, and is drawn at no height rather than left off the chart.`,
            ]
          : [],
      basis,
    };
  },
});

/* ────────────────────────────────────────────────── 9. who served it ──── */

export interface ServiceRegister {
  sinceDays: number;
  dataStatus: string;
  adjusted: { method?: string; r2?: number | null } | null;
  waiters: Array<{
    name: string;
    checks: number;
    revenue: number;
    avgCheck: number | null;
    wineAttachRate: number | null;
    tipPct: number | null;
    revenuePerCover: number | null;
  }>;
}

const service = analysis<ServiceRegister>({
  title: 'Who served it',
  register: 'server register',
  answers: 'What each server’s checks look like, before and after the table they were given',
  window: () => 'the last 90 days of POS checks',
  path: (rid) => `/analytics/waiters/${rid}?sinceDays=90`,
  graphs: ['bars', 'table'],
  graphNote:
    'Bars rank one measure; the table carries all five. No scatter — the endpoint publishes no second axis a server can be placed on without a fixed effect, and its own adjusted model is a fit, not a coordinate.',
  select: (raw) => {
    const d = obj(raw);
    const adj = d.adjusted ? obj(d.adjusted) : null;
    return {
      sinceDays: num(d.sinceDays) ?? 90,
      dataStatus: str(d.dataStatus),
      adjusted: adj ? { method: str(adj.method), r2: num(adj.r2) } : null,
      waiters: arr(d.waiters).map((w) => ({
        name: str(w.name),
        checks: num(w.checks) ?? 0,
        revenue: num(w.revenue) ?? 0,
        avgCheck: num(w.avgCheck),
        wineAttachRate: num(w.wineAttachRate),
        tipPct: num(w.tipPct),
        revenuePerCover: num(w.revenuePerCover),
      })),
    };
  },
  view: (s) => {
    const basis = [
      `Non-voided pos_checks grouped by server name over the last ${s.sinceDays} days.`,
      s.dataStatus ? `Feed: ${s.dataStatus}.` : null,
      s.adjusted?.method ?? null,
    ];
    const figures = [
      { label: 'Servers with a check', value: figure(s.waiters.length) },
      {
        label: 'Table-adjusted fit (R²)',
        value: s.adjusted?.r2 == null ? EM : ratioPct(s.adjusted.r2, 2),
        note: 'Needs 10 checks across at least two tables before a server can be separated from their section',
      },
    ];
    if (s.waiters.length === 0)
      return {
        say: 'No check in the window carries a server name, so nothing can be attributed to anyone. That is an absent field on the POS feed, not a shift nobody worked.',
        figures,
        notes: [],
        basis,
      };
    return {
      cats: {
        data: s.waiters.slice(0, 14).map((w) => ({
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
        ],
        rows: s.waiters.slice(0, 40).map((w) => ({
          key: w.name,
          cells: [
            w.name,
            figure(w.checks),
            money(w.avgCheck, 'table'),
            ratioPct(w.wineAttachRate),
            ratioPct(w.tipPct),
          ],
        })),
      },
      figures,
      notes: [
        'A server’s raw average is partly the section they were given. The adjusted fit above is the engine’s attempt to remove it; where it reads an em dash, the raw ranking is all there is.',
      ],
      basis,
    };
  },
});

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

const restock = analysis<RestockRegister>({
  title: 'What to buy back',
  register: 'reorder register',
  answers: 'What is about to run out, and how likely it is to run out first',
  window: () => 'demand over the last 90 days, at the service level in the params',
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
        data: r.reorderList.slice(0, 14).map((s) => ({
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
      ],
      basis,
    };
  },
});

/* ───────────────────────────────────────────────── 11. the writing desk ── */

/**
 * The report generator, told the truth about.
 *
 * `POST /reports/generate` inserts a `generated_reports` row with
 * `status: "pending"` and a NULL `pdf_url`, and NOTHING in the repo — gateway,
 * orchestrator, worker — ever fills it in (OD-81; `/communications` deleted its
 * own copy of this button for the same reason, and the shipping Reports page
 * mounts `<ReportGenerator>` with no `onGenerate` at all, `Reports.tsx:911-917`).
 * So the control is rendered disabled with one line saying why, and the archive
 * that DOES hold real documents is one link away. A button that lies is worse
 * than no button.
 */
const writing = analysis<null>({
  title: 'The writing desk',
  register: 'report archive',
  answers: 'Nothing yet — no report writer exists behind this button (OD-81)',
  window: () => 'no register: this cutting reads nothing',
  path: null,
  graphs: [],
  graphNote:
    'No drawing at all: there is no register behind this cutting to draw. It is here to say so.',
  select: () => null,
  view: () => ({
    node: (
      <div style={{ display: 'grid', gap: 8 }}>
        <p className="rp-note">
          Nothing writes a report yet. The endpoint behind “generate” files a row marked{' '}
          <span style={{ fontFamily: MONO }}>pending</span> with no document attached, and no worker
          in this product ever fills it in — so the button is off rather than pretending (OD-81).
        </p>
        <div className="rp-row" style={{ gap: 10 }}>
          <button
            type="button"
            className="rp-btn"
            disabled
            title="No report writer exists yet — OD-81"
          >
            Write this sheet up
          </button>
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
