/**
 * CellarNext — the Mudavym rebuild of the cellar, behind `mudavym_design_cellar`
 * (ADR 0044, p4 wave).
 *
 * THE VERDICT, verbatim (06-pages/MAKEOVER-VERDICTS.md §`/wines`):
 *
 *   "I don't like the new version. It's so much crowded and I don't like the
 *    way it looks." … used to like today's page "where we could see
 *    everything." Verdict: **put more character into it.**
 *
 * and the IA decided after it: **"Cellar" is the parent surface — what is in
 * the building — with `/wines`, `/beer`, `/whiskey` and `/cocktails` as its
 * children.** This component is all five: `category` undefined is the parent.
 *
 * THE STRUCTURE THAT ENFORCES IT. A cellar book, not a data grid. The parent is
 * the book's front matter: four registers and what the building holds tonight.
 * A register is the book opened at that section — the full breadth the founder
 * liked, every title and every column — and the crowding is gone because
 * *depth* left the row: a row states only facts of record, and everything the
 * library has learned about one bottle opens on a reading stand above the
 * register, one bottle at a time. Character is the book's own voice (Fraunces
 * speaks the titles and the notes), the double rule ruling the account off, and
 * the seal appearing exactly once — on the hold that sends a real order.
 *
 * HONESTY. Market price is the em dash because `retail_price_avg` is null on
 * every row; `body`/`sweetness`/`acidity`/`alcohol`/`aromas`/`flavors` are gone
 * entirely (they were constants sold as measurements); a bottle with no
 * inventory row says "not in the building" rather than showing an invented
 * stock of 0 against an invented par of 6; "Reorder" and "save as recurring" —
 * which reported success and wrote nothing — are replaced by one real order
 * path and by nothing at all, respectively. Beer, whiskey and cocktails have
 * tables and no endpoint, so their registers say so and show the shape.
 */

import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Wordmark } from '@/components/mudavym';
import Registers from './Registers';
import UnwiredRegister from './UnwiredRegister';
import WineRegister from './WineRegister';
import { useCellarNextData } from './useCellarNextData';
import { REGISTER_ORDER, REGISTER_PATH, REGISTER_TITLE, SANS, ensureFraunces } from './cellar-format';
import './cellar-next.css';

export interface CellarNextProps {
  /** Force the Warm Charcoal ground regardless of app theme (ADR 0042). */
  ground?: 'charcoal';
  /** Which register of the cellar to open; undefined = the parent overview. */
  category?: 'wines' | 'beer' | 'whiskey' | 'cocktails';
}

export default function CellarNext({ ground, category }: CellarNextProps) {
  const data = useCellarNextData();
  const { pathname } = useLocation();

  useEffect(() => {
    ensureFraunces();
  }, []);

  return (
    <div
      className="mudavym min-h-full"
      data-ground={ground}
      style={{ background: 'var(--paper-0)', color: 'var(--ink-1)', fontFamily: SANS }}
    >
      <div style={{ margin: '0 auto', maxWidth: 1200, padding: '22px 16px 40px' }}>
        {/* ── the book's spine: wordmark + the four registers ───────────── */}
        <header style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
          <Link to="/cellar" className="cl-focus" style={{ textDecoration: 'none' }}>
            <Wordmark size={13} />
          </Link>
          <nav aria-label="Cellar registers" style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginLeft: 'auto' }}>
            {REGISTER_ORDER.map((id) => (
              <Link
                key={id}
                to={REGISTER_PATH[id]}
                className="cl-btn cl-ink cl-focus"
                data-on={pathname === REGISTER_PATH[id]}
                style={{ textDecoration: 'none' }}
              >
                {REGISTER_TITLE[id]}
              </Link>
            ))}
          </nav>
        </header>

        <div style={{ marginTop: 20 }}>
          {data.authLoading ? (
            <div role="status" data-testid="cellar-opening">
              <h1 className="cl-h1">The Cellar.</h1>
              <p className="cl-said" style={{ marginTop: 8 }}>
                Finding out which building this is…
              </p>
            </div>
          ) : data.activeRestaurantId === null ? (
            <div role="status" data-testid="cellar-no-tenant">
              <h1 className="cl-h1">The Cellar.</h1>
              <p className="cl-said" style={{ marginTop: 8 }}>
                No restaurant is active on this account, so there is no building to open a cellar
                for. The book is unread — not empty. Choose a branch, or ask an owner for access.
              </p>
            </div>
          ) : category === undefined ? (
            <>
              <p className="cl-crumb">What the house keeps</p>
              <h1 className="cl-h1" data-size="parent">
                The Cellar<span style={{ color: 'var(--seal)' }}>.</span>
              </h1>
              <p className="cl-standing" style={{ fontSize: 15.5 }}>
                Four registers. One of them is written in; three have their pages ruled and nothing
                on them yet.
              </p>
              <hr className="cl-rule" style={{ margin: '16px 0 0' }} />
              <Registers data={data} />
            </>
          ) : category === 'wines' ? (
            <WineRegister data={data} />
          ) : (
            <UnwiredRegister id={category} />
          )}
        </div>

        {/* ── the signature ─────────────────────────────────────────────── */}
        <footer
          style={{
            marginTop: 40,
            paddingTop: 12,
            borderTop: '1px solid var(--paper-2)',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 10,
            justifyContent: 'space-between',
            alignItems: 'baseline',
          }}
        >
          <Wordmark size={13} />
          <p className="cl-note" style={{ margin: 0, fontSize: 11 }}>
            Every figure here was read from the book or from the cellar. Nothing on this page is a
            default.
          </p>
        </footer>
      </div>
    </div>
  );
}
