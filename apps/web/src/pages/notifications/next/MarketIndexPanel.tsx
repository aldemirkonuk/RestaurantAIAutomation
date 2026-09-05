/**
 * The posted-price INDEX line — its own labelled register, never beside a quote.
 *
 * The founder, 2026-09-04: *"Run it, labelled tier 4, never beside a quote"*
 * and *"Show as a labelled index line, own register"*.
 *
 * WHY IT IS A SEPARATE BOX AND NOT A ROW IN THE MARKET BOX. A state posted
 * list and a price a vendor quoted this house are different KINDS of fact
 * (ADR 0117): different issuer, different date, different unit, different
 * standing. Put them in one list and the reader averages them with their eye
 * even when the arithmetic does not. So this register gets its own heading,
 * its own ground (`--paper-0` against the market box's `--paper-1`) and its own
 * rule-of-the-box paragraph, and it sits BELOW the market box rather than
 * beside it — there is no side-by-side arrangement in which the two could be
 * read as one ladder.
 *
 * THE EMPTY ANSWER IS THE DESIGN PROBLEM, again, and it has four distinct
 * shapes that must not be allowed to look alike:
 *
 *   • the call itself failed / was refused → say which, name the status
 *   • the house has no state recorded      → the endpoint's own sentence
 *   • the jurisdiction is not one the register knows (Türkiye, the UK)
 *                                           → the endpoint's own sentence
 *   • the state is known but the register is quiet (no posting regime, a
 *     withheld source, an unarmed fetch, an unreadable table)
 *                                           → the endpoint's own sentence,
 *                                             plus the withheld publisher named
 *
 * In every one of them the box prints WORDS from the endpoint. It never prints
 * an empty list and never prints a zero.
 */

import { Landmark, RotateCw, TriangleAlert } from 'lucide-react';
import { EM, MONO, SANS, SERIF } from './nt-format';
import { HouseIndexLine, HouseIndexSource, useHouseIndex } from './useHouseIndex';

/** The class, in the words a reader knows. An unmapped class prints its key. */
const CLASS_LABEL: Record<string, string> = {
  posted_wholesale_list: 'State posted list',
  retail_reference: 'Control-state shelf price',
  public_index: 'Public index',
};

function classLabel(sourceClass: string): string {
  return CLASS_LABEL[sourceClass] ?? sourceClass;
}

function money(value: number | null, currency: string): string {
  if (value === null) return EM;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

/**
 * A posted list is issued on a DAY, not at a minute — `stampOf` would print an
 * hour the issuer never stated, so this register keeps its own day formatter.
 */
function dayOf(iso: string | null): string {
  if (!iso) return EM;
  // `issued_at` is a DATE column, so it arrives as 'YYYY-MM-DD'. Passing that
  // to `new Date` parses it as UTC midnight and a browser west of Greenwich
  // then renders the previous day — the issuer's own date, silently altered.
  // Read the parts and build the day locally instead.
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const t = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(iso);
  if (!Number.isFinite(t.getTime())) return EM;
  return t.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function Line({ item }: { item: HouseIndexLine }) {
  const size =
    item.sizeValue !== null
      ? `${item.sizeValue}${item.sizeUnit ?? ''}`
      : (item.packageDesc ?? EM);
  return (
    <li className="py-2" style={{ borderTop: '1px solid var(--paper-2)' }}>
      <div className="flex items-baseline justify-between gap-2">
        <span
          className="min-w-0 flex-1 truncate text-[12.5px] font-semibold"
          style={{ fontFamily: SANS, color: 'var(--ink-1)' }}
        >
          {item.productName}
          {item.brand ? ` · ${item.brand}` : ''}
        </span>
        <span
          className="shrink-0 text-[12px] font-semibold"
          style={{ fontFamily: MONO, color: 'var(--ink-1)' }}
        >
          {money(item.price, item.currency)}
        </span>
      </div>
      <p className="mt-0.5 text-[11px]" style={{ fontFamily: SANS, color: 'var(--ink-4)' }}>
        {size} · {item.priceUnit ?? EM} · to {item.priceBasis ?? EM}
        {item.region ? ` · ${item.region}` : ''}
      </p>
      <p className="mt-0.5 text-[11px]" style={{ fontFamily: SANS, color: 'var(--ink-4)' }}>
        {classLabel(item.sourceClass)} · {item.issuer} · issued {dayOf(item.issuedAt)}
      </p>
    </li>
  );
}

/** A publisher that exists for this state and cannot be read — named, not hidden. */
function Withheld({ source }: { source: HouseIndexSource }) {
  return (
    <p className="mt-1 text-[11px]" style={{ fontFamily: SANS, color: 'var(--ink-4)' }}>
      {source.issuer} publishes a {classLabel(source.sourceClass).toLowerCase()} for this
      state and it is withheld: {source.withheld?.reason}
      {source.withheld?.measuredOn ? ` (measured ${source.withheld.measuredOn})` : ''}
    </p>
  );
}

export function MarketIndexPanel() {
  const m = useHouseIndex();
  const withheld = m.sources.filter((s) => s.withheld);
  // The heading names the class actually held, so a control-state shelf line is
  // never announced as a state posted list.
  const heading = m.lines.length > 0 ? classLabel(m.lines[0].sourceClass) : 'Posted price index';

  return (
    <section
      aria-labelledby="nt-index"
      className="rounded-xl p-3.5"
      // A different ground from the market box, so the eye never reads the two
      // as one register.
      style={{ border: '1px solid var(--seal-ring)', background: 'var(--paper-0)' }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2
          id="nt-index"
          className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.14em]"
          style={{ fontFamily: MONO, color: 'var(--ink-4)' }}
        >
          <Landmark size={12} strokeWidth={1.75} aria-hidden />
          {m.jurisdiction ? `${heading} · ${m.jurisdiction}` : heading}
        </h2>
        <button
          type="button"
          onClick={m.refresh}
          aria-label="Re-read the price index"
          className="nt-ink rounded px-1.5 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal"
          style={{
            border: '1px solid var(--paper-2)',
            background: 'transparent',
            color: 'var(--ink-2)',
            cursor: 'pointer',
          }}
        >
          <RotateCw size={11} strokeWidth={1.75} aria-hidden />
        </button>
      </div>

      {m.state === 'loading' && <div className="nt-skel mt-2 h-12" aria-hidden />}

      {m.state === 'unreadable' && (
        <p
          role="status"
          className="mt-2 inline-flex items-start gap-1.5 text-[11.5px]"
          style={{ fontFamily: SANS, color: 'var(--ink-2)' }}
        >
          <TriangleAlert size={12} strokeWidth={1.75} aria-hidden className="mt-0.5 shrink-0" />
          {m.failure?.forbidden
            ? `The price index refused this account (${m.failure.status ?? 'refused'}). The posted-list register is owner and manager only, so nothing is claimed here either way.`
            : `The price index could not be read (${m.failure?.message ?? 'no reason given'}). This box is unknown, not empty.`}
        </p>
      )}

      {m.state === 'ready' && m.lines.length > 0 && (
        <>
          <p
            className="mt-1.5 text-[12px]"
            style={{ fontFamily: SERIF, fontStyle: 'italic', color: 'var(--ink-2)' }}
          >
            A published list for this house&rsquo;s state. It is a reference, not a quote — it is
            never compared with a price a vendor gave this house.
          </p>
          <ul className="mt-1.5">
            {m.lines.map((l) => (
              <Line key={l.id} item={l} />
            ))}
          </ul>
        </>
      )}

      {m.state === 'ready' && m.lines.length === 0 && (
        <p
          role="status"
          className="mt-1.5 text-[11.5px]"
          style={{ fontFamily: SANS, color: 'var(--ink-2)' }}
        >
          {m.silence ??
            'The register returned no index line for this house and gave no reason. That is unknown, not "nothing is posted".'}
        </p>
      )}

      {m.state === 'ready' && withheld.map((s) => <Withheld key={s.key} source={s} />)}

      <p
        className="mt-2.5 pt-2 text-[10.5px]"
        style={{ fontFamily: SANS, color: 'var(--ink-4)', borderTop: '1px solid var(--paper-2)' }}
      >
        A state-published or control-state list, kept as its own register (ADR 0117). It is shown
        as posted — its own unit, basis and pack, never reduced to a bottle — and it is never
        placed beside, ranked against or averaged with a vendor quote. This box reads a public
        list; it never places an order.
      </p>
    </section>
  );
}

export default MarketIndexPanel;
