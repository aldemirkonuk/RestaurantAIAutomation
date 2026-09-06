/**
 * The front matter of the cellar book: the registers THIS house carries, and
 * what the building holds tonight.
 *
 * SECOND PASS, 2026-09-03. The four registers used to be a global constant, so
 * a non-alcoholic house was shown an empty whiskey programme — presence
 * asserted where there was none, then reported as emptiness. The set is now the
 * house's own (`GET /cellar/:rid/registers`), and the surface renders four
 * different screens for four genuinely different states:
 *
 *   confirmed / manual — the house said so. Its registers, and no others.
 *   inferred           — read from this house's own cellar and menu, unconfirmed.
 *   unknown            — nothing to read it off. ALL SEVEN are shown, greyed,
 *                        with the ask — because hiding six registers from a
 *                        house nobody has asked is the same lie in reverse.
 *   unread             — the readout failed. Words, and the wine register only,
 *                        which is the one this page can serve without it.
 */

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { springs, tally, useReducedMotion } from '../../../lib/mudavym/motion';
import RegisterNotice from './NeedsItemsNotice';
import {
  EM,
  REGISTER_ORDER,
  REGISTER_TITLE,
  count,
  decidedLine,
  parentView,
  registerHref,
  type RegisterId,
} from './cellar-format';
import { REGISTER_SOURCE } from './registerShapes';
import { BOOK_READ_LIMIT, type CellarData, type RegisterReadoutVM } from './useCellarNextData';
import FloorStrip from './FloorStrip';
import WholeCellar from './WholeCellar';

/* ── the tally: figures arrive overdamped, and an unknown never counts ──── */

function tallyProgress(t: number): number {
  const s = springs.tally.samples;
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const pos = t * (s.length - 1);
  const i = Math.floor(pos);
  return s[i] + (s[Math.min(i + 1, s.length - 1)] - s[i]) * (pos - i);
}

export function Tally({ value }: { value: number | null }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState<number | null>(value);
  const raf = useRef(0);
  const land = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    cancelAnimationFrame(raf.current);
    if (land.current) clearTimeout(land.current);
    // An unknown appears as the dash instantly. Nothing eases to a dash.
    if (value === null || reduced) {
      setShown(value);
      return;
    }
    const start = performance.now();
    const step = (now: number) => {
      const p = tallyProgress((now - start) / tally.ms);
      setShown(value * p);
      if (p < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    // rAF is throttled to nothing in a hidden tab; the figure must still land.
    land.current = setTimeout(() => {
      cancelAnimationFrame(raf.current);
      setShown(value);
    }, tally.ms + 120);
    return () => {
      cancelAnimationFrame(raf.current);
      if (land.current) clearTimeout(land.current);
    };
  }, [value, reduced]);

  return <span className="cl-num">{shown === null ? EM : count(Math.round(shown))}</span>;
}

/* ── one register card ─────────────────────────────────────────────────── */

function figuresFor(
  id: RegisterId,
  data: CellarData,
  readout: RegisterReadoutVM | undefined,
): [string, number | null][] {
  if (id === 'wines') {
    const inBook = data.bottles === null ? null : data.bottles.length;
    return [
      // Measured live 2026-09-02: the catalogue read returns exactly its
      // 500-row cap, so "titles in the book" would be a claim about the library
      // when it is only a claim about this read. The label says which.
      [data.bookTruncated ? 'Titles read (capped)' : 'Titles in the book', inBook],
      ['Titles in the cellar', data.building.titles],
      ['Bottles on hand', data.building.bottles],
    ];
  }
  // Every other register is a shared catalogue today — `restaurant_inventory`
  // is keyed on the wine library, so nothing of the kind can be stock yet. The
  // label says "in the catalogue", never "on hand".
  return [
    ['Titles in the catalogue', readout?.evidence.catalogueRows ?? null],
    ['Named on this menu', readout?.evidence.menuRows ?? null],
  ];
}

function RegisterCard({
  id,
  data,
  readout,
  muted,
}: {
  id: RegisterId;
  data: CellarData;
  readout: RegisterReadoutVM | undefined;
  /** True in the `unknown` state: shown, but not claimed to be carried. */
  muted?: boolean;
}) {
  const source = REGISTER_SOURCE[id];
  const figures = figuresFor(id, data, readout);

  return (
    <Link
      to={registerHref(id)}
      className="cl-register cl-ink cl-focus"
      data-wired={source.wired ? 'true' : 'false'}
      data-muted={muted ? 'true' : 'false'}
      data-testid={`register-${id}`}
      style={muted ? { opacity: 0.72 } : undefined}
    >
      <span style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <span className="cl-serif" style={{ fontSize: 21, fontWeight: 600, letterSpacing: '-0.015em' }}>
          {REGISTER_TITLE[id]}
        </span>
        <span className="cl-chip" data-seal={source.stockable ? 'true' : 'false'}>
          {source.stockable ? 'stocked' : source.wired ? 'catalogue' : 'no source'}
        </span>
      </span>

      {source.wired ? (
        <span style={{ display: 'block', marginTop: 12 }}>
          {figures.map(([label, v]) => (
            <span key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12 }}>
              <span className="cl-dim">{label}</span>
              <span style={{ fontSize: 13 }}>
                <Tally value={v} />
              </span>
            </span>
          ))}
        </span>
      ) : (
        <span className="cl-said" style={{ display: 'block', marginTop: 12, fontSize: 12 }}>
          {source.oneLine} Open it to see what is missing.
        </span>
      )}
    </Link>
  );
}

/* ── the parent surface ────────────────────────────────────────────────── */

export default function Registers({ data }: { data: CellarData }) {
  const { building, registers } = data;

  const tiles: [string, string, number | null][] = [
    ['bottles', 'Bottles on hand', building.bottles],
    ['titles', 'Titles carried', building.titles],
    ['par', 'At or under their own par', building.belowPar],
    ['offbook', 'Carried but off this read', building.offBook],
  ];

  // Which cards to draw. Four states, four answers — never an empty grid.
  const readoutById = new Map((registers?.registers ?? []).map((r) => [r.id, r]));
  const unread = data.registersError !== null || (!data.registersLoading && registers === null);
  const unknown = registers?.decidedBy === 'unknown';
  const shown: RegisterId[] = unread
    ? ['wines']
    : unknown
      ? REGISTER_ORDER
      : REGISTER_ORDER.filter((id) => readoutById.get(id)?.carried === true);

  return (
    <>
      <section style={{ marginTop: 18 }}>
        <h2 className="cl-sec">The registers</h2>

        {/* The founder's one line: how this was decided, and where to change it. */}
        {data.registersLoading ? (
          <p className="cl-said" role="status">
            Working out which registers this house carries…
          </p>
        ) : unread ? (
          <p className="cl-said" role="alert" data-testid="registers-unread">
            <AlertTriangle size={13} aria-hidden style={{ verticalAlign: '-2px', marginRight: 5 }} />
            Which registers this house carries could not be read
            {data.registersError ? ` (${data.registersError})` : ''}. Only the wine
            register is shown, because it is the one this page can serve without
            that answer — the rest are unread, not absent.
          </p>
        ) : (
          <p className="cl-said" data-testid="registers-decided">
            {decidedLine(registers?.decidedBy ?? 'unknown')}
          </p>
        )}

        <div className="cl-grid" style={{ marginTop: 12 }}>
          {shown.map((id) => (
            <RegisterCard
              key={id}
              id={id}
              data={data}
              readout={readoutById.get(id)}
              muted={unknown}
            />
          ))}
        </div>

        {/* ONE ask, however many registers need rows — never a stack. Every
            from-scratch onboarding switches several on at once, and N
            near-identical panels is how a notice stops being read. */}
        {(registers?.needsEvidence ?? []).length > 0 ? (
          <RegisterNotice registers={registers!.needsEvidence} />
        ) : null}

        {/* The symmetric state: registers switched off with this house's items
            still behind them. Ending a season is a correct act, so this states
            what is there and never guards the toggle. */}
        {(registers?.stranded ?? []).length > 0 ? (
          <RegisterNotice
            kind="stranded"
            registers={registers!.stranded}
            counts={Object.fromEntries(
              (registers?.registers ?? []).map((r) => [r.id, r.strandedItems]),
            )}
          />
        ) : null}

        {/* Not on the list, but still in the building. The register is off and
            these items are not lost: they are shown here, counted, reachable. */}
        {(registers?.stranded ?? []).length > 0 ? (
          <section style={{ marginTop: 20 }} data-testid="not-on-the-list">
            <h2 className="cl-sec">Not on the list</h2>
            <p className="cl-said">
              These registers are off, and this house’s books still hold items in
              them. Nothing was deleted, and nothing here is counted into the
              figures above.
            </p>
            <div className="cl-grid" style={{ marginTop: 10 }}>
              {registers!.stranded.map((id) => (
                <RegisterCard
                  key={id}
                  id={id}
                  data={data}
                  readout={readoutById.get(id)}
                  muted
                />
              ))}
            </div>
          </section>
        ) : null}

        {registers && !unknown && registers.carried.length < REGISTER_ORDER.length ? (
          <p className="cl-note" data-testid="registers-hidden-note">
            {REGISTER_ORDER.length - registers.carried.length - registers.stranded.length} of
            the seven registers are not drawn at all: this house does not carry them
            and its books hold nothing in them. Turn one on in Settings and it
            appears here.
          </p>
        ) : null}

        {/* What the library ITSELF knows, per `beverage_kind` — the field the
            gateway used to drop before it reached the browser. It is a
            catalogue figure and is labelled as one: none of it is stock, and
            none of it moves which registers this house carries. */}
        {data.libraryByKind && data.libraryByKind.size > 0 ? (
          <p className="cl-note" data-testid="library-by-kind">
            This read of the wine library classifies its titles as{' '}
            {[...data.libraryByKind.entries()]
              .sort((a, z) => z[1] - a[1])
              .map(([kind, n]) => `${count(n)} ${kind.replace(/_/g, ' ')}`)
              .join(', ')}
            . That is the library, not this cellar.
          </p>
        ) : null}

        {data.bookTruncated ? (
          <p className="cl-note">
            The catalogue read is capped at {BOOK_READ_LIMIT} titles and came back full, so “titles
            read” is a floor, not the size of the library.
          </p>
        ) : null}
      </section>

      <section style={{ marginTop: 26 }}>
        <h2 className="cl-sec">In the building tonight</h2>
        <div className="cl-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
          {tiles.map(([k, label, v]) => (
            <div key={k} className="cl-tile">
              <p className="cl-tile-label">{label}</p>
              <p className="cl-tile-fig">
                <Tally value={v} />
              </p>
            </div>
          ))}
        </div>
        <p className="cl-note">
          {data.cellarError
            ? `The cellar could not be read (${data.cellarError}) — the four figures above are unknown, not zero.`
            : !data.cellarKnown
              ? 'Counting the cellar…'
              : 'Par is only claimed for a row that records its own minimum. Everything the cellar holds is booked against the wine library today — `restaurant_inventory` is keyed on it, so beer, spirits and cocktails can be browsed here but not yet counted as stock.'}
        </p>
      </section>

      {/* Direction A, built: the floor, over confirmed zones only. It sits
          BELOW "In the building tonight" because the founder's "keep the top
          info boxes" stands above it. */}
      <FloorStrip />

      {/* Direction B, merged in rather than replacing the registers: the whole
          book in one list, with only the columns that mean the same thing in
          every register. Opened deliberately — it is one read per register. */}
      <WholeCellar
        carried={unread || unknown ? null : shown.filter((r) => r !== 'wines')}
        defaultOpen={parentView(unread ? null : registers).whole}
      />
    </>
  );
}
