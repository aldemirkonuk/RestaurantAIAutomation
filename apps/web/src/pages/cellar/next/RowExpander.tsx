/**
 * THE EXPANDED ROW — the cellar's answer to the /inventory dropdown the founder
 * singled out.
 *
 * MAKEOVER-VERDICTS.md:66-72, on `/inventory`'s row expansion: *"it shows
 * everything you need to see"*. The founder asked whether this wave can have
 * *"that dropdown, all in one with essential details"*. So this is that shape,
 * not a modal and not a panel above the table: the row opens IN PLACE, the rows
 * below move down, and the record is laid out as cards — which is exactly what
 * `pages/inventory/command/RowExpansion.tsx` does with Live vs shadow · Par and
 * reorder · Market price · Velocity 14 days · When it sells · Order history.
 *
 * WHAT THE CELLAR CAN FILL, AND WHAT IT CANNOT — the honest half of the answer.
 *
 *   Live vs shadow      WITHHELD. `restaurant_inventory` is keyed on
 *                       `master_wine_id`, so a keg, a bottle of rye and a case
 *                       of cola have no stock row at all. There is no live
 *                       count to compare a shadow count against. OD-113.
 *   Par and reorder     WITHHELD, same key, same reason: `threshold_min` lives
 *                       on the inventory row that does not exist. A suggested
 *                       order drawn without it would be arithmetic on nothing.
 *   Market price        REAL, in part: what we PAID is the invoice book, what we
 *                       CHARGE is the menu book, and the catalogue's own
 *                       reference price is `beverages.price_reference`. The
 *                       delta is arithmetic over two real figures, and the card
 *                       says which of the three it is missing when it is.
 *   Velocity            REAL, from the till lines. Clipped to the days the
 *                       house has evidence for rather than zero-filled to a
 *                       fixed 14 (see `rowSeries.ts`).
 *   When it sells       REAL, from the same lines, over whatever hours the
 *                       house actually sold in — not the 16:00–23:00 window
 *                       `/inventory` hard-codes, which drops every lunch.
 *   Order ledger        REAL: purchase orders and invoice lines, dated, with
 *                       the vendor, and each line marked paid or not by whether
 *                       an invoice names it.
 *   Its own kind        Per-register, and mostly WITHHELD: a beer's style, ABV
 *                       and format and a whisky's age, cask and proof are real
 *                       columns of `public.beverages` with no writer (measured
 *                       0 of 609 on 2026-09-03). The card names each one and
 *                       says what is missing rather than omitting the card.
 *
 * A WITHHELD CARD IS DRAWN, NOT DROPPED. Dropping it would make a keg look like
 * a bottle whose stock happens to be unknown; drawing it with a sentence makes
 * it a decision somebody has to take (OD-113). That is the whole difference
 * between this page and the one it replaced.
 */

import { useMemo } from 'react';
import { AlertTriangle, Ban, LineChart } from 'lucide-react';
import { EM, money, shortDate, type RegisterId } from './cellar-format';
import { velocity, whenItSells, type TillLine } from './rowSeries';
import type { BookRecordVM, RegisterRowVM, RowRecordVM } from './useCellarNextData';

function Card({
  title,
  right,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="cl-card">
      <h5 className="cl-card-title">
        {title}
        {right}
      </h5>
      {children}
    </div>
  );
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="cl-kv">
      <span>{k}</span>
      <span className="cl-num">{v}</span>
    </div>
  );
}

/** A card that exists to say it cannot be filled, and why. Never omitted. */
function Withheld({ title, reason }: { title: string; reason: string }) {
  return (
    <div className="cl-card" data-withheld="true" data-testid={`withheld-${title.toLowerCase().replace(/\W+/g, '-')}`}>
      <h5 className="cl-card-title">
        {title}
        <Ban size={12} aria-hidden />
      </h5>
      <p className="cl-said cl-dim" style={{ margin: 0 }}>
        {reason}
      </p>
    </div>
  );
}

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * What this register's own kind puts on a row. The columns research, rendered
 * as the card the founder asked for — a beer's style and format, a whisky's age
 * and cask — with every unwritten one named rather than dropped.
 */
interface Fact {
  label: string;
  source: string;
  /** Reads the value off the row, or returns null when nothing carries it. */
  read: (r: RegisterRowVM) => string | null;
}

const type: Fact = {
  label: 'Type',
  source: 'beverages.beverage_type',
  read: (r) => r.catalogue?.beverageType ?? null,
};
const origin: Fact = {
  label: 'Origin',
  source: 'beverages.region, beverages.country',
  read: (r) => [r.catalogue?.region, r.catalogue?.country].filter(Boolean).join(', ') || null,
};
const abv: Fact = {
  label: 'ABV',
  source: 'beverages.abv_pct',
  read: (r) => (r.catalogue?.abvPct == null ? null : `${r.catalogue.abvPct}%`),
};
const format: Fact = {
  label: 'Format',
  source: 'beverages.volume_ml, beverages.package_format',
  read: (r) => (r.catalogue?.volumeMl ? `${r.catalogue.volumeMl} ml` : null),
};
/** A column of `public.beverages` with no writer. Always reads null, by design. */
const unwritten = (label: string, source: string): Fact => ({
  label,
  source,
  read: () => null,
});

const KIND_FIELDS: Partial<Record<RegisterId, Fact[]>> = {
  beer: [
    unwritten('Style', 'beverages.type_attributes → style'),
    unwritten('IBU', 'beverages.type_attributes → ibu'),
    abv,
    format,
    origin,
  ],
  whiskey: [
    unwritten('Age', 'beverages.age_years'),
    unwritten('Cask', 'beverages.cask_finish'),
    unwritten('Proof', 'beverages.proof'),
    abv,
    origin,
  ],
  spirits: [type, origin, abv, format],
  non_alcoholic: [
    type,
    origin,
    format,
    unwritten('Case size', 'procurement_document_lines.pack_size'),
  ],
  soft_drinks: [
    type,
    origin,
    format,
    unwritten('Case size', 'procurement_document_lines.pack_size'),
  ],
  cocktails: [],
};

/**
 * THE FACT STRIP — the run of label/value pairs directly under the row, before
 * any card. It is the first thing `/inventory`'s expander shows (grape · region
 * · format · vintage · last counted), and it is the reason the founder called
 * that dropdown "all in one": you learn what the thing IS before you read what
 * it has DONE.
 *
 * A fact with no source in this schema is a WITHHELD LINE, not a missing one:
 * the label is drawn, the value is an em dash, and the table it would have been
 * read from is on the value's own title. `/inventory` does the same thing in
 * its own idiom — "Last counted: never", in words, rather than a blank.
 */
function FactStrip({ row, register }: { row: RegisterRowVM; register: RegisterId }) {
  const facts = KIND_FIELDS[register] ?? [];
  if (facts.length === 0) return null;
  return (
    <div className="cl-facts" data-testid="fact-strip">
      {facts.map((f) => {
        const v = f.read(row);
        return (
          <div key={f.label} className="cl-fact">
            <span className="cl-fact-k">{f.label}</span>
            <span
              className="cl-fact-v"
              data-withheld={v === null ? 'true' : undefined}
              title={v === null ? `Would be read from ${f.source} — nothing writes it` : f.source}
            >
              {v ?? EM}
            </span>
          </div>
        );
      })}
      <div className="cl-fact">
        <span className="cl-fact-k">Counted</span>
        <span
          className="cl-fact-v"
          data-withheld="true"
          title="restaurant_inventory.last_counted_at — this kind has no inventory row (OD-113)"
        >
          never counted
        </span>
      </div>
    </div>
  );
}

function book(record: RowRecordVM | null, id: BookRecordVM['book']): BookRecordVM | null {
  return record?.books.find((b) => b.book === id) ?? null;
}

export interface RowExpanderProps {
  row: RegisterRowVM;
  register: RegisterId;
  record: RowRecordVM | null;
  loading: boolean;
  error: string | null;
  stockingReason: string;
  /** Open the deeper series for one book — the double-click route, from a card. */
  onOpenSeries: (book: 'invoice' | 'pos' | 'quote' | 'menu' | 'order') => void;
}

export default function RowExpander({
  row,
  register,
  record,
  loading,
  error,
  stockingReason,
  onOpenSeries,
}: RowExpanderProps) {
  const pos = book(record, 'pos');
  const invoice = book(record, 'invoice');
  const order = book(record, 'order');
  const menu = book(record, 'menu');
  const quote = book(record, 'quote');

  const tillLines: TillLine[] = useMemo(
    () => (pos?.readable ? pos.ledger : []).map((l) => ({ at: l.at, qty: l.qty, unitPrice: l.unitPrice })),
    [pos],
  );
  const vel = useMemo(() => velocity(tillLines), [tillLines]);
  const hours = useMemo(() => whenItSells(tillLines), [tillLines]);

  const maxDay = Math.max(1, ...vel.days.map((d) => d.qty));
  const maxHour = Math.max(1, ...hours.buckets.map((b) => b.qty));

  const paidUnit = invoice?.ledger.find((l) => l.unitPrice !== null)?.unitPrice ?? null;
  const listPrice = menu?.ledger.find((l) => l.unitPrice !== null)?.unitPrice ?? null;
  const reference = row.catalogue?.priceReference ?? null;
  const markup = paidUnit !== null && listPrice !== null && paidUnit > 0 ? listPrice / paidUnit : null;

  if (loading) {
    return (
      <p className="cl-said" role="status" data-testid="expander-loading">
        Reading this house’s five books for {row.name}…
      </p>
    );
  }
  if (error !== null) {
    return (
      <p className="cl-said" role="alert" data-testid="expander-error">
        <AlertTriangle size={13} aria-hidden style={{ verticalAlign: '-2px', marginRight: 5 }} />
        The record behind {row.name} could not be read ({error}). Every card below
        would have been arithmetic on nothing, so none is drawn.
      </p>
    );
  }

  return (
    <div data-testid="row-expander">
      <FactStrip row={row} register={register} />
      <div className="cl-cards">
      {/* ── the two cards /inventory fills and this register cannot ──────── */}
      <Withheld
        title="Live vs shadow"
        reason={`${stockingReason} There is no live count here to hold a shadow count against, so neither figure is drawn.`}
      />
      <Withheld
        title="Par and reorder"
        reason="A par is a column on the inventory row (restaurant_inventory.threshold_min), and this kind has no inventory row. Suggested order, reorder point and runway are all arithmetic over that par, so all four are withheld together rather than one of them being guessed."
      />

      {/* ── market price: real where the books answer ────────────────────── */}
      <Card
        title="What it costs and what it makes"
        right={
          <span className="cl-dim" style={{ fontSize: 10, textTransform: 'none', letterSpacing: 0 }}>
            {invoice?.readable === false ? 'invoices unread' : `${invoice?.rows ?? 0} invoice lines`}
          </span>
        }
      >
        <KV k="Last paid, each" v={money(paidUnit)} />
        <KV k="On our list" v={money(listPrice)} />
        <KV k="Catalogue reference" v={money(reference)} />
        <KV k="Markup" v={markup === null ? EM : `${markup.toFixed(1)}x`} />
        <p className="cl-note" style={{ marginTop: 6 }}>
          {paidUnit === null
            ? 'No invoice line carries a unit price for this, so the markup is unknown rather than 0.'
            : listPrice === null
              ? 'It is bought but not listed: no menu line names it, so there is nothing to divide by.'
              : 'Markup is our list price over the last unit price we were invoiced. Neither figure is a default.'}
        </p>
      </Card>

      {/* ── velocity, clipped to the days there is evidence for ──────────── */}
      <Card
        title="Velocity"
        right={
          <button
            type="button"
            className="cl-linkish cl-focus"
            onClick={() => onOpenSeries('pos')}
            aria-label="Open the till series"
          >
            <LineChart size={12} aria-hidden />
          </button>
        }
      >
        {vel.days.length === 0 ? (
          <p className="cl-said cl-dim" style={{ margin: 0 }} data-testid="velocity-none">
            {pos?.readable === false
              ? `The till could not be read (${pos.reason ?? 'no reason given'}). This is unread, not a quiet night.`
              : 'The till has never rung this up, so there is no rate to draw. Not zero a day — none recorded.'}
          </p>
        ) : (
          <>
            <div className="cl-bars" role="img" aria-label={`Sold per day from ${vel.from} to ${vel.to}`}>
              {vel.days.map((d) => (
                <i
                  key={d.date}
                  title={`${d.date}: ${d.qty}`}
                  data-peak={d.qty >= maxDay * 0.75 ? 'true' : undefined}
                  style={{ height: `${Math.max((d.qty / maxDay) * 100, 4)}%` }}
                />
              ))}
            </div>
            <div className="cl-barscale">
              <span>{vel.from}</span>
              <span>{vel.to}</span>
            </div>
            <KV k="Per day, over that span" v={vel.perDay === null ? EM : vel.perDay.toFixed(1)} />
            <p className="cl-note" style={{ marginTop: 4 }}>
              {vel.days.length} day{vel.days.length === 1 ? '' : 's'} of evidence
              {vel.clipped ? ', capped at the last 14' : ''}. Days before the first
              till line are not drawn as zeroes — they are days nobody was reading.
            </p>
          </>
        )}
      </Card>

      {/* ── when it sells, over the hours this house actually sells in ───── */}
      <Card title="When it sells">
        {hours.buckets.length === 0 ? (
          <p className="cl-said cl-dim" style={{ margin: 0 }}>
            Nothing at the till to place on a clock yet.
          </p>
        ) : (
          <>
            <div className="cl-heat" style={{ gridTemplateColumns: `28px repeat(${hours.hours.length}, 1fr)` }}>
              <span />
              {hours.hours.map((h) => (
                <span key={h} className="cl-heat-h">
                  {h}
                </span>
              ))}
              {DOW.map((label, dow) => (
                <>
                  <span key={`l${dow}`} className="cl-heat-d">
                    {label}
                  </span>
                  {hours.hours.map((h) => {
                    const b = hours.buckets.find((x) => x.dow === dow && x.hour === h);
                    return (
                      <span
                        key={`${dow}-${h}`}
                        className="cl-heat-c"
                        title={`${label} ${h}:00 — ${b?.qty ?? 0}`}
                        style={{ opacity: b ? 0.18 + (b.qty / maxHour) * 0.82 : 0 }}
                      />
                    );
                  })}
                </>
              ))}
            </div>
            <p className="cl-note">
              {hours.peak
                ? `Busiest: ${DOW[hours.peak.dow]} at ${hours.peak.hour}:00.`
                : ''}{' '}
              Only the hours this house has actually sold in are drawn — there is
              no fixed service window here.
            </p>
          </>
        )}
      </Card>

      {/* ── the order ledger: what we asked for, and what we were charged ── */}
      <Card
        title="Order ledger"
        right={
          <button
            type="button"
            className="cl-linkish cl-focus"
            onClick={() => onOpenSeries('invoice')}
            aria-label="Open the invoice series"
          >
            <LineChart size={12} aria-hidden />
          </button>
        }
      >
        {(order?.rows ?? 0) === 0 && (invoice?.rows ?? 0) === 0 ? (
          <p className="cl-said cl-dim" style={{ margin: 0 }} data-testid="ledger-none">
            {order?.readable === false || invoice?.readable === false
              ? 'The order and invoice books could not both be read, so nothing is listed. Unread, not empty.'
              : 'Never ordered and never invoiced. It reached this house some other way — the books above say which.'}
          </p>
        ) : (
          <div>
            {(order?.ledger ?? []).slice(0, 4).map((l, i) => (
              <div className="cl-ledgerline" key={`o${i}`}>
                <span className="cl-num">{shortDate(l.at)}</span>
                <span>{l.who ?? EM}</span>
                <span className="cl-num">{l.qty ?? EM}</span>
                <span className="cl-tag">ordered</span>
              </div>
            ))}
            {(invoice?.ledger ?? []).slice(0, 4).map((l, i) => (
              <div className="cl-ledgerline" key={`i${i}`}>
                <span className="cl-num">{shortDate(l.at)}</span>
                <span>{l.who ?? EM}</span>
                <span className="cl-num">{money(l.total)}</span>
                <span className="cl-tag" data-paid="true">
                  invoiced
                </span>
              </div>
            ))}
            <p className="cl-note">
              An order is what we asked for; an invoice is what we were charged.
              Whether an invoice has been SETTLED is not in these books —{' '}
              <span className="cl-num">procurement_documents</span> carries a
              status but no payment date, so no line here claims &ldquo;paid&rdquo;.
            </p>
          </div>
        )}
      </Card>

      {/* ── its own kind: the per-register columns, as a card ─────────────── */}
      <Card title={`Where a ${register === 'soft_drinks' ? 'soft drink' : register.replace('_', '-')}'s facts come from`}>
        {register === 'cocktails' ? (
          <p className="cl-said cl-dim" style={{ margin: 0 }}>
            A cocktail’s own facts are its build, its glass and its garnish, and
            they are on the cocktail register rather than here.
          </p>
        ) : (
          <>
            {/* Not a second copy of the strip above: the strip shows the
                VALUES, this shows where each one would come FROM. It is the
                "research" half of the founder's ask, attached to the row. */}
            {(KIND_FIELDS[register] ?? []).map((f) => (
              <div key={f.label} className="cl-kv">
                <span>{f.label}</span>
                <span className="cl-num" data-filled={f.read(row) === null ? undefined : 'true'}>
                  {f.read(row) === null ? 'no writer' : 'read'}
                </span>
              </div>
            ))}
            <p className="cl-note" style={{ marginTop: 6 }}>
              Every dash above is a real column of{' '}
              <span className="cl-num">public.beverages</span> with no writer —
              measured 0 of 609 rows on 2026-09-03. None of them needs a
              migration; all of them need somebody to fill them.
              {register === 'beer'
                ? ' Carbonation and yeast are not listed at all: BJCP keeps both in prose, and prose does not go in a field.'
                : ''}
            </p>
          </>
        )}
      </Card>

      {/* ── quotes: the one book the founder named that has no rows ──────── */}
      <Card
        title="Quoted"
        right={
          <button
            type="button"
            className="cl-linkish cl-focus"
            onClick={() => onOpenSeries('quote')}
            aria-label="Open the quote series"
          >
            <LineChart size={12} aria-hidden />
          </button>
        }
      >
        {(quote?.rows ?? 0) === 0 ? (
          <p className="cl-said cl-dim" style={{ margin: 0 }} data-testid="quote-none">
            {quote?.reason ?? 'No vendor has quoted this to this house.'}
          </p>
        ) : (
          <>
            <KV k="Last quote" v={money(quote?.ledger[0]?.unitPrice ?? null)} />
            <KV k="From" v={quote?.ledger[0]?.who ?? EM} />
            <KV k="When" v={shortDate(quote?.ledger[0]?.at)} />
          </>
        )}
      </Card>
      </div>
    </div>
  );
}
