/**
 * The front matter of the cellar book: the four registers, and what the
 * building actually holds tonight.
 *
 * The parent surface answers one question — *what is in this building* — so
 * every figure on it is a count of something real. The wine register counts
 * titles the gateway returned and rows this tenant's inventory holds. The
 * other three count nothing, because nothing serves them: they say so, and
 * their card is drawn unruled (dashed) rather than showing a zero.
 */

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { springs, tally, useReducedMotion } from '../../../lib/mudavym/motion';
import {
  EM,
  REGISTER_ORDER,
  REGISTER_PATH,
  REGISTER_TITLE,
  count,
  type RegisterId,
} from './cellar-format';
import { REGISTER_STATE } from './registerShapes';
import { BOOK_READ_LIMIT, type CellarData } from './useCellarNextData';

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

function RegisterCard({ id, data }: { id: RegisterId; data: CellarData }) {
  const state = REGISTER_STATE[id];
  const inBook = data.bottles === null ? null : data.bottles.length;
  const figures: [string, number | null][] = [
    // Measured live 2026-09-02: the catalogue read returns exactly its 500-row
    // cap, so "titles in the book" would have been a claim about the library
    // when it is only a claim about this read. The label says which.
    [data.bookTruncated ? 'Titles read (capped)' : 'Titles in the book', inBook],
    ['Titles in the cellar', data.building.titles],
    ['Bottles on hand', data.building.bottles],
  ];

  return (
    <Link
      to={REGISTER_PATH[id]}
      className="cl-register cl-ink cl-focus"
      data-wired={state.wired ? 'true' : 'false'}
      data-testid={`register-${id}`}
    >
      <span style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <span className="cl-serif" style={{ fontSize: 21, fontWeight: 600, letterSpacing: '-0.015em' }}>
          {REGISTER_TITLE[id]}
        </span>
        <span className="cl-chip" data-seal={state.wired ? 'true' : 'false'}>
          {state.wired ? 'open' : 'unruled'}
        </span>
      </span>

      {state.wired ? (
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
          {state.oneLine} Open it to see the shape it would carry.
        </span>
      )}
    </Link>
  );
}

/* ── the parent surface ────────────────────────────────────────────────── */

export default function Registers({ data }: { data: CellarData }) {
  const { building } = data;
  const tiles: [string, string, number | null][] = [
    ['bottles', 'Bottles on hand', building.bottles],
    ['titles', 'Titles carried', building.titles],
    ['par', 'At or under their own par', building.belowPar],
    ['offbook', 'Carried but off this read', building.offBook],
  ];

  return (
    <>
      <section style={{ marginTop: 18 }}>
        <h2 className="cl-sec">The registers</h2>
        <div className="cl-grid">
          {REGISTER_ORDER.map((id) => (
            <RegisterCard key={id} id={id} data={data} />
          ))}
        </div>
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
              : 'Par is only claimed for a row that records its own minimum. Everything the cellar holds is booked against the wine library today — beer, whiskey and cocktails have no register of their own yet.'}
        </p>
      </section>
    </>
  );
}
