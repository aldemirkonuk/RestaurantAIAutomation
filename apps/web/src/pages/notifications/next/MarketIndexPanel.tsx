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

import {
  FileCheck2,
  Globe,
  Hourglass,
  Landmark,
  RotateCw,
  Sprout,
  TriangleAlert,
} from 'lucide-react';
import { EM, MONO, SANS, SERIF } from './nt-format';
import { HouseIndexLine, HouseIndexSource, useHouseIndex } from './useHouseIndex';
import { CommoditySeriesVM, useHouseCommodity } from './useHouseCommodity';

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

/**
 * How each admission basis reads to an operator (ADR 0128 Q4).
 *
 * `same_person` is spelled out rather than softened. The founder's answer was
 * *"Acceptable: reason + record"* — acceptable BECAUSE it is recorded and
 * printed, so the words have to say that nobody else looked.
 */
const BASIS_WORDS: Record<string, string> = {
  routine:
    'stood on one person\u2019s upload \u2014 every check this register makes was inside its band, so nobody was asked to confirm it',
  byte_match:
    'was admitted by a second owner or manager who fetched the same file themselves and matched it byte for byte',
  attested: 'was admitted by a second owner or manager',
  same_person:
    'was admitted by the same person who brought it in, because this jurisdiction has no second owner or manager \u2014 this is not a second pair of eyes',
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

/**
 * A published commodity or market index series — the CONTEXT LINE.
 *
 * The founder, 2026-09-05: *"Both: the line now, the alert behind a flag"*.
 * This is the line, and its whole discipline is that it makes no claim. It
 * states what a series last printed and who printed it. It never says a price
 * will rise, it is never placed beside a vendor quote, and it is never
 * converted into one.
 *
 * WHY IT LIVES INSIDE THIS BOX. A class-E index series needs its own TABLE for
 * five measured reasons (it is not a price, has no currency, carries a unit
 * longer than `price_index_postings` allows, names a commodity class rather
 * than a product, and can be world-scoped where the postings table's `state`
 * regex has no code for "everywhere"). But it is the same KIND of thing a
 * reader is looking at here — a published reference — so it draws as another
 * labelled section of this register rather than as a third box.
 *
 * FOUR THINGS EVERY LINE MUST CARRY, and none of them is decoration:
 *
 *   the PERIOD    the observation's own, never our clock. A world index's
 *                 August number is August's, whatever day we read it
 *   the BASE      an index number without one cannot be compared to anything,
 *                 including its own earlier self, and a rebasing looks exactly
 *                 like a fifty-percent crash
 *   whose DATE    "issued" is a claim about the PUBLISHER. FAO's CSV states no
 *                 date of any kind, so its rows say "read on"; ONS stamps one
 *                 on every observation, so its rows say "issued". Rendering
 *                 both as "issued" would manufacture provenance in the one
 *                 place a reader looks for it
 *   the UNIT      verbatim, the issuer's own string
 */
function CommodityLine({ s }: { s: CommoditySeriesVM }) {
  // A rate is not an index and is not a price. Naming it separately is the
  // whole reason `value_kind` exists: a duty rendered as a price would be a
  // number the house has to pay ON TOP of the one it is reading.
  const label =
    s.valueKind === 'rate'
      ? 'Published rate'
      : s.valueKind === 'price'
        ? 'Public price series'
        : 'Public index';
  return (
    <li className="py-2" style={{ borderTop: '1px solid var(--paper-2)' }}>
      <div className="flex items-baseline justify-between gap-2">
        <span
          className="min-w-0 flex-1 text-[12.5px] font-semibold"
          style={{ fontFamily: SANS, color: 'var(--ink-1)' }}
        >
          {s.seriesTitle}
        </span>
        <span
          className="shrink-0 text-[12px] font-semibold"
          style={{ fontFamily: MONO, color: 'var(--ink-1)' }}
        >
          {/* An index number is NOT money and is never formatted as money: no
              currency symbol, no thousands grouping that would imply one. */}
          {s.latest ? s.latest.value.toLocaleString('en-US') : EM}
        </span>
      </div>

      {s.latest ? (
        <p className="mt-0.5 text-[11px]" style={{ fontFamily: SANS, color: 'var(--ink-4)' }}>
          {s.unit}
          {s.basePeriod ? ` · base ${s.basePeriod}` : ''} · {monthOf(s.latest.periodStart)}
          {s.latest.vintage ? ` · ${s.latest.vintage}` : ''}
        </p>
      ) : (
        <p
          role="status"
          className="mt-0.5 text-[11.5px]"
          style={{ fontFamily: SANS, color: 'var(--ink-2)' }}
        >
          {/* Never an empty row and never a zero: the endpoint's own sentence
              says WHICH silence this is. */}
          {s.note ??
            'This register returned no observation for this series and gave no reason. That is unknown, not "the index has not moved".'}
        </p>
      )}

      {/* One expression, one text node: the issuer, the word and the date are
          a single sentence about provenance and must not be splittable. */}
      <p className="mt-0.5 text-[11px]" style={{ fontFamily: SANS, color: 'var(--ink-4)' }}>
        {`${label} · ${s.issuer}${
          s.latest
            ? ` · ${dateLabel(s.latest.issuedAtBasis)} ${dayOfUtc(s.latest.issuedAt)}`
            : ''
        }`}
      </p>

      {s.stale === true && s.staleReason ? (
        <p className="mt-0.5 text-[11px]" style={{ fontFamily: SANS, color: 'var(--ink-4)' }}>
          Held back as out of date: {s.staleReason}
        </p>
      ) : null}

      {s.exposures.length > 0 ? (
        <p className="mt-0.5 text-[11px]" style={{ fontFamily: SANS, color: 'var(--ink-4)' }}>
          {s.exposures.length === 1
            ? 'Somebody here mapped one of this house’s items to this series.'
            : `Somebody here mapped ${s.exposures.length} of this house’s items to this series.`}{' '}
          {s.exposures.every((e) => e.passThroughBasis === 'unset')
            ? 'This house has never measured how much of a move in it reaches an invoice, so no figure for that is given.'
            : 'The share expected to reach an invoice was typed by a person and carries its basis.'}
        </p>
      ) : null}

      {/* A rate names the instrument it comes from and the day it took effect.
          Without those it is a number somebody typed. */}
      {s.valueKind === 'rate' && (s.statute || s.effectiveFrom) ? (
        <p className="mt-0.5 text-[11px]" style={{ fontFamily: SANS, color: 'var(--ink-4)' }}>
          {s.statute ?? 'No instrument recorded'}
          {s.effectiveFrom ? ` · in force from ${s.effectiveFrom}` : ''}
        </p>
      ) : null}

      {/* THE PER-BOTTLE DUTY, where two person-stated facts exist for a mapped
          item: the strength on the shared library row and the size on the
          bottle's own identity. Never the library's 750 ml column default,
          which the gateway refuses by name.

          A figure here is a DUTY and not a price, so it says so — a number
          beside a bottle reads as what the house pays for it unless the line
          says otherwise. Where no figure can be shown the refusal is printed
          instead, because "nobody has stated this bottle's strength" is
          something a person can go and fix and an empty space is not. */}
      {s.exposures.map((e) =>
        e.duty === null ? null : e.duty.derived ? (
          <p
            key={`duty-${e.id}`}
            className="mt-0.5 text-[11px]"
            style={{ fontFamily: SANS, color: 'var(--ink-2)' }}
          >
            <span style={{ fontFamily: MONO }}>
              {e.duty.currency} {e.duty.amount.toFixed(2)}
            </span>{' '}
            per bottle on a mapped item. {e.duty.basis}
          </p>
        ) : (
          <p
            key={`duty-${e.id}`}
            role="status"
            className="mt-0.5 text-[11px]"
            style={{ fontFamily: SANS, color: 'var(--ink-4)' }}
          >
            No per-bottle figure for a mapped item: {e.duty.detail}
          </p>
        ),
      )}

      {/* Whether a per-bottle duty can be derived from this rate AT ALL,
          independently of any one bottle. "This publisher does not say what its
          number is per" and "somebody has to state this bottle's strength" are
          different facts, and only the second one a person can fix. */}
      {s.duty ? (
        <p className="mt-0.5 text-[11px]" style={{ fontFamily: SANS, color: 'var(--ink-4)' }}>
          Per bottle: {s.duty.sentence}
        </p>
      ) : null}

      {/* A series read over a credential says so, and says whether THIS
          deployment holds one. "The publisher refused us" and "this environment
          was never given the key" are different facts and only the second is
          something a person can fix in a dashboard. */}
      {s.accessKeyRequired && s.keyConfiguredHere === false ? (
        <p
          role="status"
          className="mt-0.5 text-[11px]"
          style={{ fontFamily: SANS, color: 'var(--ink-4)' }}
        >
          Read over a credential this deployment does not hold: {s.keyEnvVar} is not set
          here, so nothing has been fetched. That is a missing setting, not a publisher
          refusing us.
        </p>
      ) : null}

      {/* A parser that has never seen real bytes must never look like a working
          feed. The founder's call, 2026-09-05: a one-off human read, logged. */}
      {s.awaitingHumanDownload ? (
        <p
          role="status"
          className="mt-0.5 text-[11px]"
          style={{ fontFamily: SANS, color: 'var(--ink-4)' }}
        >
          Waiting on a person&rsquo;s own download. Nothing here fetches this source, and
          nothing is claimed about where it stands until the file arrives.
        </p>
      ) : null}

      {s.withheld ? (
        <p className="mt-0.5 text-[11px]" style={{ fontFamily: SANS, color: 'var(--ink-4)' }}>
          Not fetched: {s.withheld.reason}
          {s.withheld.measuredOn ? ` (measured ${s.withheld.measuredOn})` : ''}
        </p>
      ) : null}

      {/* Read-but-unusable is a different silence from unreadable, and the
          registry keeps them apart. Today this is the ÖTV schedule, whose
          figure is exact and whose denominator the issuer never published. */}
      {s.silent ? (
        <p className="mt-0.5 text-[11px]" style={{ fontFamily: SANS, color: 'var(--ink-4)' }}>
          Held as published, and not derived from: {s.silent.reason}
        </p>
      ) : null}

      {/* An armed series can interrupt somebody. Who turned it on, and on which
          numbers, belongs on the same line as the number itself. */}
      {s.armed && s.armedBy ? (
        <p className="mt-0.5 text-[11px]" style={{ fontFamily: SANS, color: 'var(--ink-4)' }}>
          Armed for alerting by {s.armedBy.label} on {dayOfUtc(s.armedBy.at)}, on the
          calibration {s.armedBy.proposalHash.slice(0, 12)}.
        </p>
      ) : null}

      {/* The licence travels with the number, because for one of these series
          it is a condition of using it at all, and for another it is unstated
          and that is a fact a reader is entitled to. */}
      <p className="mt-0.5 text-[11px]" style={{ fontFamily: SANS, color: 'var(--ink-4)' }}>
        {s.redistribution === 'attribution_required' && s.attribution
          ? s.attribution
          : s.licence === 'unstated'
            ? 'This publisher states no licence for this series. Recorded as unstated, never as permitted.'
            : s.licence}
      </p>
    </li>
  );
}

/**
 * A period is a MONTH (or a day, or a quarter) — not an instant.
 *
 * `dayOf` renders a date; this renders the PERIOD the issuer published for,
 * which is the thing a reader must not confuse with when we read it. It is
 * built from the parts for the same reason `dayOf` is: `new Date('2026-08-01')`
 * parses as UTC midnight and renders as July west of Greenwich, which would
 * silently move an issuer's own month.
 */
function monthOf(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso || EM;
  const t = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (!Number.isFinite(t.getTime())) return iso;
  return t.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
}

/**
 * An INSTANT, rendered in UTC and never in the reader's own zone.
 *
 * `issued_at` on an observation is a `timestamptz` — a moment, not a day — and
 * `dayOf` renders a moment in the browser's zone. That is right for something
 * that happened to this house and wrong for a PUBLICATION: ONS stamps
 * `2026-08-18T23:00:00.000Z`, which a reader in California sees as the 18th and
 * a reader in Sydney sees as the 19th, so the same issuer's same act would be
 * dated two different days on two screens.
 *
 * UTC is not the issuer's own zone either — the register does not record one,
 * and this is stated rather than papered over — but it is the SAME frame for
 * every reader, which is the property that matters when the number beside it is
 * being cited as evidence.
 */
function dayOfUtc(iso: string): string {
  const t = new Date(iso);
  if (!Number.isFinite(t.getTime())) return EM;
  return t.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** The commodity section: every series that speaks for this house. */
function CommoditySection() {
  const c = useHouseCommodity();

  if (c.state === 'loading') return <div className="nt-skel mt-3 h-12" aria-hidden />;

  return (
    <section
      aria-labelledby="nt-commodity"
      className="mt-3 rounded-lg p-3"
      style={{ border: '1px solid var(--paper-2)', background: 'var(--paper-1)' }}
    >
      <h3
        id="nt-commodity"
        className="flex items-start gap-1.5 text-[11px] uppercase tracking-[0.14em]"
        style={{ fontFamily: MONO, color: 'var(--ink-4)' }}
      >
        <Globe size={12} strokeWidth={1.75} aria-hidden className="mt-[2px] shrink-0" />
        <span>
          Commodity and market index
          {c.jurisdiction ? ` · ${c.jurisdiction}` : ''}
        </span>
      </h3>
      <p
        className="mt-1 text-[11.5px]"
        style={{ fontFamily: SERIF, fontStyle: 'italic', color: 'var(--ink-2)' }}
      >
        Published series for markets this house buys into. Context, not a forecast: none of
        these says what this house will pay, and none is compared with a vendor quote.
      </p>

      {c.state === 'unreadable' && (
        <p
          role="status"
          className="mt-1.5 inline-flex items-start gap-1.5 text-[11.5px]"
          style={{ fontFamily: SANS, color: 'var(--ink-2)' }}
        >
          <TriangleAlert size={12} strokeWidth={1.75} aria-hidden className="mt-0.5 shrink-0" />
          {c.failure?.forbidden
            ? `The index-series register refused this account (${c.failure.status ?? 'refused'}). It is owner and manager only, so nothing is claimed here either way.`
            : `The index-series register could not be read (${c.failure?.message ?? 'no reason given'}). This section is unknown, not empty.`}
        </p>
      )}

      {c.state === 'ready' && c.series.length > 0 && (
        <ul className="mt-1.5">
          {c.series.map((s) => (
            <CommodityLine key={s.seriesKey} s={s} />
          ))}
        </ul>
      )}

      {c.state === 'ready' && c.series.length === 0 && (
        <p
          role="status"
          className="mt-1.5 text-[11.5px]"
          style={{ fontFamily: SANS, color: 'var(--ink-2)' }}
        >
          {c.silence ??
            'The register returned no series for this house and gave no reason. That is unknown, not "no index covers you".'}
        </p>
      )}

      {/* A house with no mapping sees the series and this sentence, rather than
          a panel that quietly implies the series is about its own eggs. Nothing
          proposes a mapping: the category leader's own product infers item-level
          exposures and publishes no accuracy figure of any kind. */}
      {c.state === 'ready' && c.series.length > 0 && c.noExposureRecorded && (
        <p
          role="status"
          className="mt-1.5 text-[11.5px]"
          style={{ fontFamily: SANS, color: 'var(--ink-2)' }}
        >
          No one here has said which of this house&rsquo;s items any of these series moves, so
          none of these numbers is about anything you buy yet. That mapping is typed by a
          person and is never guessed.
        </p>
      )}
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

  // Only the carried books whose lines are actually on this screen (ADR 0128
  // Q4). A basis note beside a book the reader cannot see would be an answer to
  // a question nobody asked; a book with no drawn line is either held (the
  // label above says so) or simply not in this state's current page of lines.
  const drawnShas = new Set(m.lines.map((l) => l.uploadSha256).filter(Boolean));
  const drawnCarriedBooks = (m.carriedBooks ?? []).filter((b) =>
    drawnShas.has(b.sha256),
  );

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

      {/* The commodity and market index context line (2026-09-05, the founder's
          "both: the line now, the alert behind a flag"). Drawn WHATEVER the
          posted-price register above is doing, including when it could not be
          read: the two are separate endpoints over separate tables, and hiding
          one behind the other's failure would make a working register look
          silent. */}
      <CommoditySection />

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
            {/* The hold's LENGTH, printed rather than implied (ADR 0128 Q2).
                Read from the wire — the panel never names its own 24. Omitted
                when the gateway did not send one, because a hold of unknown
                length is not a hold of no length. */}
            {m.heldBookHoldHours !== null && (
              <>
                {' '}
                After {m.heldBookHoldHours} hours the people who could act are told again, and the
                person who brought {m.heldBooks === 1 ? 'it' : 'them'} in may admit{' '}
                {m.heldBooks === 1 ? 'it' : 'them'} with a stated reason.
              </>
            )}
          </span>
        </p>
      )}

      {/* On what basis a hand-carried book that IS drawn was let in
          (ADR 0128 Q4; the founder: "Acceptable: reason + record"). Only the
          books whose lines are actually on this screen, so the box never
          annotates a line it is not showing. `same_person` says in words that
          nobody else looked — a basis that read like a second pair of eyes when
          it was not one would be the control evaporating at the last step. */}
      {m.state === 'ready' && drawnCarriedBooks.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {drawnCarriedBooks.map((b) => (
            <li
              key={b.sha256}
              className="flex items-start gap-1.5 text-[10.5px]"
              style={{ fontFamily: SANS, color: 'var(--ink-3)' }}
            >
              <FileCheck2 size={11} className="mt-0.5 shrink-0" aria-hidden />
              <span>
                <strong style={{ fontWeight: 500 }}>{b.fileName}</strong> ({b.editionDate}) was
                brought in by hand and {BASIS_WORDS[b.basis] ?? 'let into the market'}.
                {b.reason ? ` Reason given: ${b.reason}` : ''}
              </span>
            </li>
          ))}
        </ul>
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
        quote, and a produce line is never read as a drinks price. The commodity and market index
        section is context and not a forecast: an index number is not a price, it is never
        rendered as money, and nothing here says what this house will pay. This box reads public
        lists; it never places an order.
      </p>
    </section>
  );
}

export default MarketIndexPanel;
