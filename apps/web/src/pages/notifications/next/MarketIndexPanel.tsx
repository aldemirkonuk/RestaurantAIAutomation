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
 *
 * TWO BOXES, NOT ONE (added 2026-09-05 on the founder's Q24 call:
 * *"show it, labelled as produce, in its own box"*). The register now holds a
 * kind of row that is not a drinks posting at all — Defra's wholesale fruit and
 * vegetable prices, the only public UK source found that carries an issuer, a
 * date, a unit and a currency. It is an honest index of a market the house also
 * buys from, and it is NOT a wine price. So it draws in its own titled section,
 * and the title says what it is before the reader reaches a number:
 *
 *     Wholesale produce · Defra · England and Wales · read on 5 Sep 2026
 *
 * The two sections never sit side by side, and neither sits beside the
 * vendor-quote box. A source earns its own box by carrying `display` from the
 * registry; everything without one draws as a drinks posting, which is what
 * every state posted list and control-state shelf price is.
 */

import { Hourglass, Landmark, RotateCw, Sprout, TriangleAlert } from 'lucide-react';
import { EM, MONO, SANS, SERIF } from './nt-format';
import { HouseIndexLine, HouseIndexSource, useHouseIndex } from './useHouseIndex';

/** The class, in the words a reader knows. An unmapped class prints its key. */
const CLASS_LABEL: Record<string, string> = {
  posted_wholesale_list: 'State posted list',
  // Was 'Control-state shelf price' until 2026-09-05, when class D stopped
  // being only Iowa and Oregon: a merchant shop's shelf price is the same class
  // (ADR 0117), and calling a Berry Bros line a control-state price would be
  // false on the face of it. The issuer's own name is printed beside this, so
  // the reader still sees which kind of retail it is.
  retail_reference: 'Retail reference',
  public_index: 'Public index',
};

function classLabel(sourceClass: string): string {
  return CLASS_LABEL[sourceClass] ?? sourceClass;
}

/**
 * How the line says when its price was true.
 *
 * "issued" is a claim about the PUBLISHER: it says someone stamped this date on
 * this price. Only `issuer_stated` earns it. A `fetch_date` row carries the day
 * WE read the shop's page because the shop published no date at all, and
 * printing that as "issued" would manufacture provenance in the one place a
 * reader looks for it. A null basis is a row written before the register
 * recorded one, so it gets the weaker wording too — an unknown is never
 * upgraded by rendering.
 */
function dateLabel(basis: string | null): string {
  return basis === 'issuer_stated' ? 'issued' : 'read on';
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

function Line({ item, labelled = false }: { item: HouseIndexLine; labelled?: boolean }) {
  const size =
    item.sizeValue !== null
      ? `${item.sizeValue}${item.sizeUnit ?? ''}`
      : (item.packageDesc ?? EM);
  // A container size is a fact about a BOTTLE. A price per kilogram has no
  // container, so the register stores null — and printing an em dash for it
  // would say "we do not know this bottle's size" about a row that has no
  // bottle. On a labelled source the unknown is dropped instead of shown.
  const showSize = !labelled || size !== EM;
  // "to X" names the TRADE LEVEL a posting is filed for ("to Retailers"). A
  // produce row's basis is the kind of number it is, not who it is for, so the
  // preposition would assert a trade relationship the issuer never stated.
  const basis = item.priceBasis ?? EM;
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
        {showSize ? `${size} · ` : ''}
        {item.priceUnit ?? EM} · {labelled ? basis : `to ${basis}`}
        {item.region ? ` · ${item.region}` : ''}
      </p>
      <p className="mt-0.5 text-[11px]" style={{ fontFamily: SANS, color: 'var(--ink-4)' }}>
        {classLabel(item.sourceClass)} · {item.issuer} · {dateLabel(item.issuedAtBasis)}{' '}
        {dayOf(item.issuedAt)}
      </p>
    </li>
  );
}

/**
 * A run of rows from ONE source that carries its own label — the produce index
 * today. The title is the source's own words (category, short issuer, extent)
 * plus OUR read date, never the issuer's: "read on" is a claim about us and is
 * the one date this box can always stand behind.
 */
function LabelledSection({
  source,
  lines,
}: {
  source: HouseIndexSource;
  lines: HouseIndexLine[];
}) {
  const d = source.display!;
  const readOn = lines.map((l) => l.fetchedAt).find(Boolean) ?? null;
  return (
    <section
      aria-labelledby={`nt-index-${source.key}`}
      className="mt-3 rounded-lg p-3"
      // Its own ground again, one step in from the drinks box, so the eye reads
      // it as a neighbour and never as a continuation of the list above.
      style={{ border: '1px solid var(--paper-2)', background: 'var(--paper-1)' }}
    >
      <h3
        id={`nt-index-${source.key}`}
        className="flex items-start gap-1.5 text-[11px] uppercase tracking-[0.14em]"
        style={{ fontFamily: MONO, color: 'var(--ink-4)' }}
      >
        {/* `shrink-0` and a top-aligned box: the title wraps at 1440 and an
            inline icon would otherwise be carried onto the second line, where
            it reads as a bullet against "England and Wales". */}
        <Sprout size={12} strokeWidth={1.75} aria-hidden className="mt-[2px] shrink-0" />
        <span>
          {d.category} · {d.shortIssuer} · {d.extent} · read on {dayOf(readOn)}
        </span>
      </h3>
      <p
        className="mt-1 text-[11.5px]"
        style={{ fontFamily: SERIF, fontStyle: 'italic', color: 'var(--ink-2)' }}
      >
        A market this house also buys from. It is not a drinks price and is never
        compared with one.
      </p>
      <ul className="mt-1.5">
        {lines.map((l) => (
          <Line key={l.id} item={l} labelled />
        ))}
      </ul>
    </section>
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

  // A source with `display` gets its own titled section (Q24). Everything else
  // is a drinks posting and stays in the main list. Splitting on the SOURCE
  // rather than on the class keeps the rule where the evidence is: the registry
  // decides what a source is, the panel only draws it.
  const labelled = m.sources.filter((s) => s.display);
  const labelledKeys = new Set(labelled.map((s) => s.key));
  const drinkLines = m.lines.filter((l) => !labelledKeys.has(l.sourceKey));
  const labelledSections = labelled
    .map((s) => ({ source: s, lines: m.lines.filter((l) => l.sourceKey === s.key) }))
    .filter((g) => g.lines.length > 0);

  // The heading names the class actually held, so a control-state shelf line is
  // never announced as a state posted list.
  const heading =
    drinkLines.length > 0 ? classLabel(drinkLines[0].sourceClass) : 'Posted price index';

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

      {m.state === 'ready' && drinkLines.length > 0 && (
        <>
          <p
            className="mt-1.5 text-[12px]"
            style={{ fontFamily: SERIF, fontStyle: 'italic', color: 'var(--ink-2)' }}
          >
            A published list for this house&rsquo;s state. It is a reference, not a quote — it is
            never compared with a price a vendor gave this house.
          </p>
          <ul className="mt-1.5">
            {drinkLines.map((l) => (
              <Line key={l.id} item={l} />
            ))}
          </ul>
        </>
      )}

      {/* Produce and anything else the registry labels: its own titled box,
          below the drinks list, never beside it. (Q24, 2026-09-05) */}
      {m.state === 'ready' &&
        labelledSections.map((g) => (
          <LabelledSection key={g.source.key} source={g.source} lines={g.lines} />
        ))}

      {/* A book somebody carried in that nobody has admitted yet (ADR 0128).
          Drawn whether or not there are lines: a jurisdiction can hold a new
          book while an older admitted edition is still on the screen, and a
          label that appeared only on an empty panel would hide the waiting book
          at exactly the moment the panel looked healthy. `heldBooks === null`
          means the gateway could not answer, and nothing is drawn rather than
          claiming nothing waits. */}
      {m.state === 'ready' && (m.heldBooks ?? 0) > 0 && (
        <p
          role="status"
          className="mt-1.5 flex items-start gap-1.5 rounded px-2 py-1.5 text-[11.5px]"
          style={{
            fontFamily: SANS,
            color: 'var(--ink-2)',
            background: 'var(--paper-1)',
            border: '1px solid var(--paper-2)',
          }}
        >
          <Hourglass size={12} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            {m.heldBooks === 1
              ? 'A price book brought in by hand is waiting for a second pair of eyes.'
              : `${m.heldBooks} price books brought in by hand are waiting for a second pair of eyes.`}{' '}
            Nothing from {m.heldBooks === 1 ? 'it' : 'them'} is drawn here until an owner or manager
            admits {m.heldBooks === 1 ? 'it' : 'them'}.
          </span>
        </p>
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
        A state-published or control-state list, kept as its own register (ADR 0117), and — where
        one exists — a public index of another market the house buys from, in its own labelled
        box. Every line is shown as published: its own unit, basis and pack, never reduced to a
        bottle. None of them is ever placed beside, ranked against or averaged with a vendor
        quote, and a produce line is never read as a drinks price. This box reads public lists; it
        never places an order.
      </p>
    </section>
  );
}

export default MarketIndexPanel;
