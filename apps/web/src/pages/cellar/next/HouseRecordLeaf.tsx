/**
 * The reading stand, for a bottle that is not a wine: everything this house's
 * own books say about one product, on one leaf.
 *
 * This is DESIGN-FOUNDATION.md §6's exponential idea for `/cellar` made
 * literal — "the house's own record on every bottle: first bought, what we have
 * paid, what we poured, who quoted it". CellarTracker's answer to a bottle is
 * 7.5M strangers' notes; this page's answer is one house's memory, and the
 * memory is assembled from the five books that actually carry a
 * `restaurant_id`.
 *
 * FOUR RULES, ALL OF THEM ABOUT NOT OVERCLAIMING
 *
 *  1. A book that names this product nowhere is ABSENT from the leaf, not
 *     rendered as a block of zeroes. `quoted: null` is "nobody has quoted it,
 *     or nobody wrote the quote down"; `quoted: { count: 0 }` would be a
 *     confident nought this page cannot support.
 *  2. Every block says which table it was read from, so the claim is checkable
 *     against the schema rather than taken on the page's word.
 *  3. A loose match says it is loose, in the row and again here.
 *  4. **Nothing here can be counted into the cellar.** The control is rendered,
 *     disabled, with the gateway's own sentence beneath it — never hidden, and
 *     never a working button that writes nowhere.
 */

import { AlertTriangle, BookOpen, Lock, X } from 'lucide-react';
import {
  BOOK_LABEL,
  BOOK_SOURCE,
  EM,
  count,
  matchNote,
  money,
  quoteSource,
  shortDate,
  volume,
} from './cellar-format';
import type { RegisterRowVM } from './useCellarNextData';

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12 }}>
      <span className="cl-dim">{label}</span>
      <span className="cl-num" style={{ textAlign: 'right' }}>{value}</span>
    </div>
  );
}

function Book({
  id,
  children,
}: {
  id: keyof typeof BOOK_LABEL;
  children: React.ReactNode;
}) {
  return (
    <section className="cl-book">
      <h4 className="cl-sec" style={{ margin: '0 0 6px' }}>{BOOK_LABEL[id]}</h4>
      <div style={{ display: 'grid', gap: 4 }}>{children}</div>
      <p className="cl-note" style={{ marginTop: 7, fontSize: 10.5 }}>
        Read from <code>{BOOK_SOURCE[id]}</code>.
      </p>
    </section>
  );
}

export default function HouseRecordLeaf({
  row,
  stockingReason,
  onClose,
}: {
  row: RegisterRowVM;
  /** The gateway's own sentence. Rendered verbatim; never rewritten here. */
  stockingReason: string;
  onClose: () => void;
}) {
  const h = row.house;
  const c = row.catalogue;
  const note = matchNote(c?.matchedBy ?? null);

  return (
    <div className="cl-panel" data-testid="house-leaf" style={{ marginTop: 4 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 className="cl-h2" style={{ fontSize: 21 }}>{row.name}</h3>
          <p className="cl-dim" style={{ margin: '3px 0 0', fontSize: 12 }}>
            {[row.producer, c?.beverageType].filter(Boolean).join(' · ') || 'unattributed'}
          </p>
        </div>
        <button
          type="button"
          className="cl-btn cl-focus"
          onClick={onClose}
          aria-label="Close this record"
        >
          <X size={13} aria-hidden />
          Close
        </button>
      </div>

      <hr className="cl-rule-thin" style={{ margin: '14px 0' }} />

      {h === null ? (
        <p className="cl-said" data-testid="leaf-no-record">
          Nobody in this house has touched this bottle. It is in the shared
          reference catalogue and appears on no menu, no invoice, no order, no
          quote and no till line here. That is a complete answer, not a missing
          one.
        </p>
      ) : (
        <>
          <p className="cl-standing" style={{ marginTop: 0, fontSize: 14 }}>
            {h.firstSeen
              ? `First appears in this house’s books on ${shortDate(h.firstSeen)}.`
              : 'This house’s books name it, though none of them is dated.'}
          </p>
          <div className="cl-books" style={{ marginTop: 12 }}>
            {h.onMenu ? (
              <Book id="menu">
                <Fact label="Lines" value={count(h.onMenu.lines)} />
                <Fact label="By the bottle" value={money(h.onMenu.bottlePrice)} />
                <Fact label="By the glass" value={money(h.onMenu.glassPrice)} />
                <Fact
                  label="Section"
                  value={
                    h.onMenu.sections.length > 0 ? h.onMenu.sections.join(', ') : EM
                  }
                />
              </Book>
            ) : null}

            {h.bought ? (
              <Book id="invoice">
                <Fact label="First bought" value={shortDate(h.bought.first)} />
                <Fact label="Last bought" value={shortDate(h.bought.last)} />
                <Fact label="Bottles" value={count(h.bought.bottles)} />
                <Fact label="Paid, in total" value={money(h.bought.paidTotal)} />
                <Fact label="Last unit price" value={money(h.bought.lastUnitPrice)} />
                <Fact label="From" value={h.bought.lastFrom ?? EM} />
              </Book>
            ) : null}

            {h.ordered ? (
              <Book id="order">
                <Fact label="Orders" value={count(h.ordered.lines)} />
                <Fact label="Last ordered" value={shortDate(h.ordered.lastAt)} />
                <Fact label="At" value={money(h.ordered.lastPrice)} />
                <Fact label="From" value={h.ordered.lastFrom ?? EM} />
              </Book>
            ) : null}

            {h.quoted ? (
              <Book id="quote">
                <Fact label="Quotes" value={count(h.quoted.count)} />
                <Fact label="Last quoted" value={shortDate(h.quoted.lastAt)} />
                <Fact label="At" value={money(h.quoted.lastPrice)} />
                <Fact label="By" value={h.quoted.lastFrom ?? EM} />
                <Fact label="Off" value={quoteSource(h.quoted.lastSource)} />
              </Book>
            ) : null}

            {h.poured ? (
              <Book id="pos">
                <Fact label="Till lines" value={count(h.poured.lines)} />
                <Fact label="Sold" value={count(h.poured.qty)} />
                <Fact label="Taken" value={money(h.poured.revenue)} />
                <Fact label="First sold" value={shortDate(h.poured.firstAt)} />
                <Fact label="Last sold" value={shortDate(h.poured.lastAt)} />
              </Book>
            ) : null}
          </div>
        </>
      )}

      {/* ── what the shared catalogue adds, and how we got there ─────────── */}
      {c ? (
        <>
          <hr className="cl-rule-thin" style={{ margin: '16px 0 12px' }} />
          <h4 className="cl-sec" style={{ margin: '0 0 8px' }}>
            <BookOpen size={11} aria-hidden style={{ verticalAlign: '-1px', marginRight: 5 }} />
            The shared catalogue
          </h4>
          <div className="cl-books">
            <div style={{ display: 'grid', gap: 4 }}>
              <Fact label="Type" value={c.beverageType ?? EM} />
              <Fact
                label="Origin"
                value={[c.region, c.country].filter(Boolean).join(', ') || EM}
              />
              <Fact label="ABV" value={c.abvPct === null ? EM : `${c.abvPct}%`} />
              <Fact label="Format" value={volume(c.volumeMl)} />
              <Fact label="Package" value={c.packageFormat ?? EM} />
              <Fact label="Reference price" value={money(c.priceReference)} />
            </div>
          </div>
          {note ? (
            <p
              className="cl-note"
              data-testid={`match-${c.matchedBy}`}
              role={c.matchedBy === 'contains' ? 'note' : undefined}
            >
              {c.matchedBy === 'contains' ? (
                <AlertTriangle
                  size={12}
                  aria-hidden
                  style={{ verticalAlign: '-2px', marginRight: 5 }}
                />
              ) : null}
              {note}
            </p>
          ) : null}
        </>
      ) : row.house ? (
        <p className="cl-note" data-testid="leaf-uncatalogued">
          No row of the shared catalogue carries these words. That does not make
          the record above less real — a bottle nobody catalogued is not a bottle
          nobody bought.
        </p>
      ) : null}

      {/* ── the one control, and why it does nothing ─────────────────────── */}
      <hr className="cl-rule-thin" style={{ margin: '16px 0 12px' }} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <button
          type="button"
          className="cl-btn cl-focus"
          disabled
          data-testid="stock-gate"
          aria-describedby="cl-stock-why"
        >
          <Lock size={13} aria-hidden />
          Count into the cellar
        </button>
        <p id="cl-stock-why" className="cl-note" style={{ margin: 0, flex: '1 1 320px' }}>
          {stockingReason}
        </p>
      </div>
    </div>
  );
}
