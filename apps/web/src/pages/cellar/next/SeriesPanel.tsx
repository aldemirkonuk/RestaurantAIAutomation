/**
 * THE SERIES BEHIND A CELL — a graph and the ledger that made it.
 *
 * The founder: *"Let us see insights and details when double clicked/right
 * clicked on columns to see their data graphs or research (you decide), order
 * ledgers maybe when clicked on paid."*
 *
 * WE DO NOT DECIDE — AND THAT IS THE RESEARCHED ANSWER, NOT A DODGE.
 * The terminal that has been answering this exact question longest answers it
 * with a pair: on a Bloomberg, `GP <GO>` draws a security's history as a graph
 * and `HP <GO>` gives the same series as a table, and the operator moves
 * between them (https://libguides.cbs.dk/gp_function_bloomberg,
 * https://businesslibrary.uflib.ufl.edu/c.php?g=114612&p=746558). Neither is
 * "the insight" — the graph is where you see a move, the table is where you
 * find the line that caused it. So this panel is one read rendered twice: the
 * series on top, the lines beneath, always both, and the founder's "order
 * ledger when clicked on paid" is simply the lower half of the panel that the
 * Paid column opens.
 *
 * WHAT IT DRAWS FROM. `GET /beverages/:rid/row-record?label=` — every line of
 * this house's five books that names the row. Measured against :4000 on
 * 2026-09-03: the till returns 11 real lines for "Chardonnay Reserve (glass)"
 * with an 11-point price series and an 11-point quantity series; the invoice,
 * order and quote books return `readable: true, rows: 0` with a sentence each,
 * because `procurement_document_lines` and `vendor_price_observations` hold
 * zero rows in the entire database today.
 *
 * AN EMPTY CHART IS A LIE, AND IS NOT DRAWN. A flat line across an empty
 * invoice book would say "the price never moved", which is a claim about the
 * vendor. "No invoice line in this house's books names this" is a claim about
 * our books, and it is the true one. Fewer than two points draws no axis at
 * all.
 *
 * THE SVG IS HAND-DRAWN ON PURPOSE. No chart library is added: the house has
 * none, the shape is a polyline and a baseline, and the tokens do the rest.
 */

import { useEffect, useMemo, useRef } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { animate, settle } from '../../../lib/mudavym/motion';
import { EM, money, shortDate } from './cellar-format';
import type { ColumnSeries } from './cellar-columns';
import type { BookRecordVM, RowRecordVM } from './useCellarNextData';

const BOOK_TITLE: Record<string, string> = {
  menu: 'On our list',
  invoice: 'Invoiced',
  order: 'Ordered',
  quote: 'Quoted',
  pos: 'At the till',
};

/**
 * Which axis a book is read on. The till carries both a quantity and a price
 * and they answer different questions, so the column that opened the panel
 * chooses — `Sold` draws the quantity, `Taken` draws the price.
 */
function axisFor(book: string, column: string): 'price' | 'quantity' {
  if (book !== 'pos') return 'price';
  return column === 'sold' ? 'quantity' : 'price';
}

function Spark({
  points,
  unit,
}: {
  points: { at: string; value: number }[];
  unit: 'money' | 'count';
}) {
  const W = 560;
  const H = 96;
  const PAD = 8;

  const path = useMemo(() => {
    if (points.length < 2) return null;
    const xs = points.map((p) => Date.parse(p.at));
    const ys = points.map((p) => p.value);
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const y0 = Math.min(...ys);
    const y1 = Math.max(...ys);
    // A series that never moves is a horizontal line through the middle, not a
    // division by zero and not a line pinned to the floor.
    const spanX = x1 - x0 || 1;
    const spanY = y1 - y0 || 1;
    const flat = y1 === y0;
    const at = (i: number) => {
      const x = PAD + ((xs[i] - x0) / spanX) * (W - PAD * 2);
      const y = flat
        ? H / 2
        : H - PAD - ((ys[i] - y0) / spanY) * (H - PAD * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    };
    return {
      d: points.map((_, i) => at(i)).join(' '),
      lo: y0,
      hi: y1,
      flat,
      firstAt: points[0].at,
      lastAt: points[points.length - 1].at,
    };
  }, [points]);

  if (points.length === 0) return null;
  if (path === null) {
    return (
      <p className="cl-said cl-dim" data-testid="series-one-point">
        One line only, on {shortDate(points[0].at)} —{' '}
        {unit === 'money' ? money(points[0].value) : points[0].value}. A single
        point is a fact, not a series, so nothing is drawn between it and
        anything else.
      </p>
    );
  }

  const fmt = (v: number) => (unit === 'money' ? money(v) : String(v));

  return (
    <figure style={{ margin: '10px 0 0' }} data-testid="series-graph">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        role="img"
        aria-label={`${points.length} points, from ${fmt(path.lo)} to ${fmt(path.hi)}`}
        style={{ display: 'block', overflow: 'visible' }}
      >
        <line
          x1={0}
          y1={H - 0.5}
          x2={W}
          y2={H - 0.5}
          stroke="var(--paper-2)"
          strokeWidth={1}
        />
        <polyline
          points={path.d}
          fill="none"
          stroke="var(--seal)"
          strokeWidth={1.6}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {points.map((p, i) => {
          const [x, y] = path.d.split(' ')[i].split(',').map(Number);
          return (
            <circle key={`${p.at}-${i}`} cx={x} cy={y} r={2.1} fill="var(--seal-deep)" />
          );
        })}
      </svg>
      <figcaption
        className="cl-note"
        style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 4 }}
      >
        <span>{shortDate(path.firstAt)}</span>
        <span className="cl-num">
          {path.flat
            ? `${fmt(path.lo)} on every line — it has not moved`
            : `${fmt(path.lo)} — ${fmt(path.hi)}`}
        </span>
        <span>{shortDate(path.lastAt)}</span>
      </figcaption>
    </figure>
  );
}

function BookBlock({
  book,
  column,
}: {
  book: BookRecordVM;
  column: string;
}) {
  const axis = axisFor(book.book, column);
  const points = axis === 'price' ? book.price : book.quantity;

  return (
    <section style={{ marginTop: 16 }} data-testid={`series-book-${book.book}`}>
      <h4 className="cl-sec" style={{ fontSize: 12 }}>
        {BOOK_TITLE[book.book] ?? book.book}
      </h4>

      {!book.readable ? (
        <p className="cl-said" role="alert" data-testid={`series-unread-${book.book}`}>
          <AlertTriangle size={13} aria-hidden style={{ verticalAlign: '-2px', marginRight: 5 }} />
          {book.reason ?? 'This book could not be read.'} Unread, not empty — no
          figure below is claimed for it.
        </p>
      ) : book.rows === 0 ? (
        <p className="cl-said cl-dim" data-testid={`series-empty-${book.book}`}>
          {book.reason}
        </p>
      ) : (
        <>
          <Spark points={points} unit={axis === 'price' ? 'money' : 'count'} />
          <div style={{ overflowX: 'auto', marginTop: 10 }}>
            <table className="cl-table">
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>When</th>
                  <th style={{ textAlign: 'left' }}>Line</th>
                  <th style={{ textAlign: 'left' }}>Who</th>
                  <th style={{ textAlign: 'right' }}>Qty</th>
                  <th style={{ textAlign: 'right' }}>Each</th>
                  <th style={{ textAlign: 'right' }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {book.ledger.map((e, i) => (
                  <tr key={`${e.at ?? 'undated'}-${i}`}>
                    <td className="cl-num">{shortDate(e.at)}</td>
                    <td>
                      {e.label}
                      {e.matchedBy === 'contains' ? (
                        <span className="cl-dim" style={{ fontSize: 11 }}>
                          {' '}
                          · matched loosely
                        </span>
                      ) : null}
                      {e.note ? (
                        <span className="cl-dim" style={{ fontSize: 11 }}> · {e.note}</span>
                      ) : null}
                    </td>
                    <td>{e.who ?? <span className="cl-dim">{EM}</span>}</td>
                    <td className="cl-num" style={{ textAlign: 'right' }}>
                      {e.qty ?? EM}
                    </td>
                    <td className="cl-num" style={{ textAlign: 'right' }}>
                      {money(e.unitPrice)}
                    </td>
                    <td className="cl-num" style={{ textAlign: 'right' }}>
                      {money(e.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="cl-note">Read from {book.source}.</p>
        </>
      )}
    </section>
  );
}

export interface SeriesPanelProps {
  label: string;
  /** Which column was opened — decides which book leads and which axis is drawn. */
  columnLabel: string;
  columnId: string;
  book: ColumnSeries;
  record: RowRecordVM | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}

export default function SeriesPanel({
  label,
  columnLabel,
  columnId,
  book,
  record,
  loading,
  error,
  onClose,
}: SeriesPanelProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (ref.current) {
      animate(ref.current, [{ opacity: 0 }, { opacity: 1 }], settle);
    }
  }, [label, columnId]);

  // The book the column named leads; the other four follow, so the operator
  // can see the price they were quoted against the price they were charged
  // without opening a second thing.
  const ordered = useMemo(() => {
    const books = record?.books ?? [];
    if (book === null) return books;
    return [...books].sort((a, z) =>
      a.book === book ? -1 : z.book === book ? 1 : 0,
    );
  }, [record, book]);

  return (
    <div
      ref={ref}
      className="cl-series"
      role="dialog"
      aria-label={`${columnLabel} for ${label}`}
      data-testid="series-panel"
    >
      <div style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
        <div style={{ minWidth: 0 }}>
          <p className="cl-crumb">{columnLabel} · the whole record</p>
          <h3 className="cl-serif" style={{ margin: '2px 0 0', fontSize: 19, fontWeight: 600 }}>
            {label}
          </h3>
        </div>
        <button
          type="button"
          className="cl-btn cl-focus"
          onClick={onClose}
          style={{ marginLeft: 'auto' }}
          aria-label="Close the record"
        >
          <X size={13} aria-hidden />
        </button>
      </div>

      {loading ? (
        <p className="cl-said" role="status" data-testid="series-loading">
          Reading this house’s five books for that line…
        </p>
      ) : error !== null ? (
        <p className="cl-said" role="alert" data-testid="series-error">
          <AlertTriangle size={13} aria-hidden style={{ verticalAlign: '-2px', marginRight: 5 }} />
          The record behind this row could not be read ({error}). Nothing below
          is drawn — an empty graph here would say the figure never moved, which
          is a claim about the vendor rather than about our books.
        </p>
      ) : record === null ? null : (
        <>
          {record.nothingNamesIt ? (
            <p className="cl-said" data-testid="series-nothing">
              Every one of this house’s five books was read, and none of them
              names this line. It is a catalogue row somebody else recorded, and
              this house has never listed, ordered, been invoiced, been quoted
              or sold it.
            </p>
          ) : null}
          {ordered.map((b) => (
            <BookBlock key={b.book} book={b} column={columnId} />
          ))}
          <p className="cl-note" style={{ marginTop: 16 }}>
            {record.matchRule}
          </p>
        </>
      )}
    </div>
  );
}
