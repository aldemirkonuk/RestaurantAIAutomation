/**
 * The parts of the plot module that draw no chart: the four honest states, the
 * basis line, figures of record, the heat grid and the plain table. They live
 * apart from `rp-plot.tsx` so the page can paint these without waiting for
 * recharts to parse (r104 g4); `rp-plot.tsx` re-exports them unchanged.
 */

import { useState, type ReactNode } from 'react';
import { turn } from '@/lib/mudavym';
import { EM, failureLine, type Failure } from './rp-format';
import type { Fig, MatrixSeries, TableSpec } from './rp-view';

/* ───────────────────────────────────────────── the four honest states ──── */

/** A register in flight. Bars, because something IS coming. */
export function Waiting({ rows = 3 }: { rows?: number }) {
  return (
    <div style={{ display: 'grid', gap: 6 }} role="status" aria-label="Reading the register">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="rp-skel" style={{ height: 10, width: `${94 - i * 13}%` }} />
      ))}
    </div>
  );
}

/** A register that answered and had nothing in it. A real, quiet empty. */
export function Nothing({ children }: { children: ReactNode }) {
  return <p className="rp-quiet">{children}</p>;
}

/** A register that refused or broke. Words, and a retry only when one helps. */
export function Refused({
  register,
  failure,
  onRetry,
}: {
  register: string;
  failure: Failure;
  onRetry: () => void;
}) {
  return (
    <div role="status" style={{ display: 'grid', gap: 6, justifyItems: 'start' }}>
      <p className="rp-note">{failureLine(register, failure)}</p>
      {!failure.forbidden && (
        <button type="button" className="rp-mini rp-ink rp-focus" onClick={onRetry}>
          Read it again
        </button>
      )}
    </div>
  );
}

/**
 * One register, four surfaces. Every cutting on the sheet goes through this,
 * so no block can accidentally render a failure as an empty chart.
 */
export function RegisterBody<T>({
  register,
  loading,
  failure,
  data,
  onRetry,
  children,
}: {
  register: string;
  loading: boolean;
  failure: Failure | null;
  data: T | undefined;
  onRetry: () => void;
  children: (value: T) => ReactNode;
}) {
  if (failure) return <Refused register={register} failure={failure} onRetry={onRetry} />;
  if (loading || data === undefined) return <Waiting />;
  return <>{children(data)}</>;
}

/* ─────────────────────────────────────── "show the working" (the basis) ── */

/**
 * The line back to the data — and it is the SERVER'S sentence, not ours.
 * Every analytics endpoint returns a `basis` describing the rows it actually
 * covered (`financial.basis.revenue`, `menuEngineering.basis.margin`), written
 * precisely because a hand-written basis once claimed "on-hand qty × WAC" for
 * a figure computed from WAC on 2 rows in 72. Reprinting it verbatim is the
 * only version of this line that cannot go stale.
 */
export function Working({
  lines,
  defaultOpen = false,
}: {
  lines: Array<string | null | undefined>;
  /** Open on first paint. The flat view starts open: it has the room. */
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const real = lines.filter((l): l is string => !!l && l.trim() !== '');
  if (real.length === 0) return null;
  return (
    <div style={{ marginTop: 'auto' }}>
      <button
        type="button"
        className="rp-eyebrow rp-ink rp-focus rp-no-drag"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{ background: 'transparent', border: 0, padding: '2px 0', cursor: 'pointer' }}
      >
        {open ? 'Hide the working' : 'Show the working'}
      </button>
      <div
        className="rp-working"
        data-open={open}
        style={{ transitionDuration: `${turn.ms}ms`, transitionTimingFunction: turn.easing }}
      >
        <div>
          <ul style={{ margin: '4px 0 0', padding: '0 0 0 14px', display: 'grid', gap: 3 }}>
            {/* Keyed by position AND text: a server can return the same
                sentence twice, and a text-only key collapsed the pair into one. */}
            {real.map((l, i) => (
              <li key={`${i}:${l}`} className="rp-cap">
                {l}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────── figures of record ─────── */

/** One labelled figure. Tabular mono; an unknown is the dash, always. */
const NBSP = '\u00a0';

export function FigureRow({
  label,
  value,
  note,
  held = false,
}: {
  label: string;
  value: string;
  note?: string;
  /** Not shown for this drawing: on a phone its row keeps the space (hidden), elsewhere it is not drawn. */
  held?: boolean;
}) {
  const unknown = value === EM;
  return (
    <div className="rp-fig" data-held={held ? '' : undefined} aria-hidden={held ? true : undefined}>
      {/* A held row says nothing (a non-breaking space), so the figure is never on the page twice. */}
      <dt>{held ? NBSP : label}</dt>
      <dd data-unknown={unknown} title={unknown ? note : undefined}>
        {held ? NBSP : value}
      </dd>
    </div>
  );
}

/**
 * The "one figure" drawing: the analysis reduced to its headline number.
 * An unknown stays an em dash at any size — a big dash is the point.
 */
export function BigFigure({ fig, window }: { fig: Fig; window: string }) {
  const unknown = fig.value === EM;
  return (
    <div className="rp-big">
      <span className="rp-eyebrow">{fig.label}</span>
      <strong className="rp-big__value" data-unknown={unknown} title={unknown ? fig.note : undefined}>
        {fig.value}
      </strong>
      <span className="rp-cap">{window}</span>
    </div>
  );
}


/**
 * The heat map — a real table, for the reasons in this file's header.
 *
 * The ramp is one hue: the seal at an opacity proportional to the cell's share
 * of the largest cell. A cell with NO recorded row is left as blank paper with
 * a hairline, because "nobody rang anything up" and "the quietest service of
 * the quarter" must not look like each other.
 */
export function HeatGrid({ series }: { series: MatrixSeries }) {
  const { rows, cols, cells, xLabel, yLabel, unit, format } = series;
  const byKey = new Map(cells.map((c) => [`${c.row}|${c.col}`, c]));
  const known = cells.map((c) => c.value).filter((v): v is number => v != null);
  const max = known.length > 0 ? Math.max(...known) : 0;
  return (
    <div className="rp-heat-wrap">
      <table className="rp-heat">
        <caption className="rp-cap" style={{ textAlign: 'left', paddingBottom: 4 }}>
          {yLabel} against {xLabel}, in {unit}. A blank cell is a day with nothing recorded, not a
          day of nothing.
        </caption>
        <thead>
          <tr>
            <th scope="col" className="rp-heat__corner">
              <span className="rp-eyebrow">{yLabel}</span>
            </th>
            {cols.map((c) => (
              <th key={c} scope="col" className="rp-heat__col">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r}>
              <th scope="row" className="rp-heat__row">
                {r}
              </th>
              {cols.map((c) => {
                const cell = byKey.get(`${r}|${c}`);
                const v = cell?.value ?? null;
                const t = v == null || max <= 0 ? 0 : v / max;
                return (
                  <td
                    key={c}
                    className="rp-heat__cell"
                    data-blank={v == null}
                    title={cell ? `${cell.title} — ${heatWords(v, format, unit)}` : undefined}
                    aria-label={cell ? `${cell.title}, ${heatWords(v, format, unit)}` : undefined}
                  >
                    <span style={{ opacity: v == null ? 0 : 0.1 + 0.9 * t }} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A heat cell's figure in words; a cell with no value is "nothing recorded", never a formatted null. */
function heatWords(v: number | null, format: (n: number) => string, unit: string): string {
  return v == null ? 'nothing recorded' : `${format(v)} ${unit}`;
}

/** The plain register: rows as they are, already formatted, dashes intact. */
export function DataTable({ table }: { table: TableSpec }) {
  return (
    <div className="rp-table-wrap">
      <table className="rp-table">
        <thead>
          <tr>
            {table.cols.map((c) => (
              <th key={c.key} scope="col" data-numeric={c.numeric}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((r) => (
            <tr key={r.key}>
              {r.cells.map((cell, i) => (
                <td
                  key={table.cols[i]?.key ?? i}
                  data-numeric={table.cols[i]?.numeric}
                  data-unknown={cell === EM}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {table.more && <p className="rp-cap">{table.more}</p>}
    </div>
  );
}
