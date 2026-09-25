/**
 * Locked prices -- `/menu`'s section for every price this house holds (ADR
 * 0193 round 3, L17, L23).
 *
 * THE FOUNDER, 2026-09-21, verbatim: "add a section to that where you can lock
 * price, but wha f that menu item disappears?". A lock whose wine leaves the
 * menu is KEPT, not dropped: it is listed here under "Locked, not on the
 * current menu", holds again if the same wine comes back, and moves to another
 * wine only when a person moves it. Nothing here expires on a timer; each lock
 * shows its age and the facts that say whether it still fits.
 *
 * READS AND WRITES (all house-scoped by the token):
 *   GET  /pricing/locks                   every open lock (anyone of the house)
 *   POST /pricing/locks/:id/change        change and keep locked (owner, manager)
 *   POST /pricing/locks/:id/release       release; the price does not change
 *   POST /pricing/locks/:id/move          move to another wine at a named price
 *   GET  /pricing/advice                  the house's wines, to choose a move target
 * The gateway refuses staff whatever this page offers.
 */
import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  changeLockedPrice,
  getPriceAdvice,
  listPriceLocks,
  movePriceLock,
  releasePriceLock,
  type LockMarker,
  type PriceLock,
} from '../../../services/api/pricing';

const EM = '—';

function money(n: number | null | undefined): string {
  return n === null || n === undefined ? EM : n.toFixed(2);
}

function reasonOf(err: unknown): string {
  const e = err as { response?: { status?: number; data?: { message?: unknown } }; message?: string };
  if (e?.response?.status === 403) return 'only an owner or a manager can change a lock';
  const m = e?.response?.data?.message;
  if (typeof m === 'string' && m) return m;
  if (Array.isArray(m) && m.length) return String(m[0]);
  return e?.message || 'no reason was given';
}

/** '' is not a price here: a lock act always names one. */
function readPrice(raw: string): number | null {
  const t = raw.trim().replace(/^\$/, '');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

/** One lock's facts, in words. The menu grouping says "not on the current menu" itself. */
export function markerWords(l: PriceLock): string[] {
  const out: string[] = [];
  const has = (m: LockMarker) => l.markers.includes(m);
  if (has('off_target') && l.advice) out.push(`off your target margin: ${l.advice.sentence}`);
  if (has('advice_unknown')) out.push(`no advice: ${l.adviceUnknownReason ?? 'the reason was not given'}`);
  if (has('menu_differs')) out.push(`the current menu reads ${money(l.menuPrice)}`);
  if (has('wine_removed')) out.push('the wine was removed from inventory');
  if (has('author_without_access')) out.push('set by someone who no longer manages this house');
  return out;
}

function LockRow({ l, canManage, onSaid }: { l: PriceLock; canManage: boolean; onSaid: (s: string) => void }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'none' | 'change' | 'move'>('none');
  const [price, setPrice] = useState('');
  const [target, setTarget] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const done = (s: string) => {
    setMode('none');
    setPrice('');
    setTarget('');
    setFormError(null);
    onSaid(s);
    void queryClient.invalidateQueries({ queryKey: ['pricing'] });
    void queryClient.invalidateQueries({ queryKey: ['menu', 'plan'] });
  };
  const change = useMutation({
    mutationFn: (p: number) => changeLockedPrice(l.lockId, p),
    onSuccess: (r) => done(r.sentence),
  });
  const release = useMutation({ mutationFn: () => releasePriceLock(l.lockId), onSuccess: (r) => done(r.sentence) });
  const move = useMutation({
    mutationFn: (v: { target: string; price: number }) => movePriceLock(l.lockId, v.target, v.price),
    onSuccess: (r) => done(r.sentence),
  });
  const wines = useQuery({ queryKey: ['pricing', 'advice'], queryFn: getPriceAdvice, enabled: mode === 'move' });
  const busy = change.isPending || release.isPending || move.isPending;
  const failed = change.error ?? release.error ?? move.error;

  const submitChange = (e: FormEvent) => {
    e.preventDefault();
    const p = readPrice(price);
    if (p === null) return setFormError('Say the new price: a number of 0 or more.');
    change.mutate(p);
  };
  const submitMove = (e: FormEvent) => {
    e.preventDefault();
    const p = readPrice(price);
    if (!target) return setFormError('Choose the wine this lock moves to.');
    if (p === null) return setFormError('Say the price it is locked at: a move never guesses one.');
    move.mutate({ target, price: p });
  };

  const words = markerWords(l);
  return (
    <li className="cl-said" style={{ padding: '10px 0', borderTop: '1px solid var(--paper-2)' }} data-testid="locked-price-row">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'baseline', justifyContent: 'space-between' }}>
        <span>
          <strong>{l.wine.name ?? 'A wine'}</strong>
          {l.wine.vintage ? ` ${l.wine.vintage}` : ''} <span className="cl-dim">({l.kind})</span> locked at{' '}
          <strong>{money(l.lockedPrice)}</strong>
        </span>
        <span className="cl-dim">
          by {l.lockedBy.name ?? 'someone whose name could not be read'}, {l.ageDays} day{l.ageDays === 1 ? '' : 's'} ago
        </span>
      </div>
      {l.note ? <span className="cl-note" style={{ display: 'block', marginTop: 2 }}>“{l.note}”</span> : null}
      {words.length > 0 ? (
        <ul style={{ margin: '4px 0 0', paddingLeft: 18 }} data-testid="locked-price-facts">
          {words.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
      {canManage ? (
        <div className="cl-row-controls" style={{ marginTop: 6 }}>
          <button type="button" className="cl-btn cl-focus" disabled={busy} onClick={() => setMode(mode === 'change' ? 'none' : 'change')}>
            Change and keep locked
          </button>
          {l.dormant === true ? (
            <button type="button" className="cl-btn cl-focus" disabled={busy} onClick={() => setMode(mode === 'move' ? 'none' : 'move')}>
              Move to another wine
            </button>
          ) : null}
          <button
            type="button"
            className="cl-btn cl-focus"
            disabled={busy}
            onClick={() => release.mutate()}
            aria-label={`Release the ${l.kind} lock on ${l.wine.name ?? 'this wine'}`}
          >
            {release.isPending ? 'Releasing…' : 'Release'}
          </button>
        </div>
      ) : null}
      {mode === 'change' ? (
        <form onSubmit={submitChange} className="cl-row-controls" style={{ marginTop: 6 }}>
          <label className="cl-said">
            New {l.kind} price{' '}
            <input className="cl-field" inputMode="decimal" aria-label={`New ${l.kind} price for ${l.wine.name ?? 'this wine'}`} value={price} onChange={(e) => setPrice(e.target.value)} />
          </label>
          <button type="submit" className="cl-btn cl-ink cl-focus" disabled={busy}>
            {change.isPending ? 'Saving…' : 'Save, keep locked'}
          </button>
        </form>
      ) : null}
      {mode === 'move' ? (
        <form onSubmit={submitMove} className="cl-row-controls" style={{ marginTop: 6 }}>
          {wines.isLoading ? (
            <span className="cl-note">Reading this house's wines…</span>
          ) : wines.isError ? (
            <span role="alert" className="cl-note">The house's wines could not be read ({reasonOf(wines.error)}).</span>
          ) : (
            <label className="cl-said">
              Move to{' '}
              <select className="cl-field" aria-label="Wine the lock moves to" value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">Choose a wine</option>
                {(wines.data?.wines ?? [])
                  .filter((w) => w.inventoryId !== l.inventoryId)
                  .map((w) => (
                    <option key={w.inventoryId} value={w.inventoryId}>
                      {w.wineName ?? w.inventoryId}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <label className="cl-said">
            at{' '}
            <input className="cl-field" inputMode="decimal" aria-label="Price the moved lock holds" value={price} onChange={(e) => setPrice(e.target.value)} />
          </label>
          <button type="submit" className="cl-btn cl-ink cl-focus" disabled={busy || wines.isLoading}>
            {move.isPending ? 'Moving…' : 'Move the lock'}
          </button>
        </form>
      ) : null}
      {formError ? (
        <span role="alert" className="cl-note" style={{ display: 'block' }}>
          {formError}
        </span>
      ) : null}
      {failed ? (
        <span role="alert" className="cl-note" style={{ display: 'block' }}>
          Nothing was changed: {reasonOf(failed)}.
        </span>
      ) : null}
    </li>
  );
}

export function LockedPrices({ canManage }: { canManage: boolean }) {
  const [said, setSaid] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['pricing', 'locks'], queryFn: listPriceLocks });

  let body: ReactNode;
  if (q.isLoading) {
    body = (
      <p className="cl-said" role="status">
        Reading the locked prices…
      </p>
    );
  } else if (q.isError || !q.data) {
    body = (
      <p className="cl-said" role="alert" data-testid="locked-prices-error">
        The locked prices could not be read ({reasonOf(q.error)}). This is not the same as having none.
      </p>
    );
  } else if (!q.data.readable) {
    body = (
      <p className="cl-said" role="alert" data-testid="locked-prices-error">
        {q.data.reason ?? 'The locked prices could not be read.'}
      </p>
    );
  } else if (q.data.locks.length === 0) {
    body = (
      <p className="cl-said" data-testid="locked-prices-none">
        No price is locked at this house. {canManage ? 'Keep one when you choose a menu, or from a menu’s plan.' : ''}
      </p>
    );
  } else {
    const onMenu = q.data.locks.filter((l) => l.dormant === false);
    const off = q.data.locks.filter((l) => l.dormant === true);
    // Whether these are on the current menu could not be read (L25): shown in
    // a group of their own, never under "On the current menu".
    const unknown = q.data.locks.filter((l) => l.dormant !== true && l.dormant !== false);
    const noMenu = q.data.currentMenus.length === 0;
    body = (
      <>
        <p className="cl-standing" data-testid="locked-prices-standing">
          {q.data.counts.open} price{q.data.counts.open === 1 ? '' : 's'} locked at this house
          {q.data.counts.toReview > 0 ? `, ${q.data.counts.toReview} worth a look` : ''}.
        </p>
        {!q.data.namesReadable ? <p className="cl-note">{q.data.namesReason}</p> : null}
        {!q.data.markersReadable ? <p className="cl-note">{q.data.markersReason}</p> : null}
        {onMenu.length > 0 ? (
          <div style={{ marginTop: 10 }}>
            <p className="cl-crumb">On the current menu</p>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} data-testid="locked-on-menu">
              {onMenu.map((l) => (
                <LockRow key={l.lockId} l={l} canManage={canManage} onSaid={setSaid} />
              ))}
            </ul>
          </div>
        ) : null}
        {off.length > 0 ? (
          <div style={{ marginTop: 14 }}>
            <p className="cl-crumb">{noMenu ? 'Locked (there is no current menu)' : 'Locked, not on the current menu'}</p>
            <p className="cl-note" style={{ marginTop: 2 }}>
              Kept, and held again if the same wine comes back on a menu. A renamed wine or a new vintage is a different
              wine: move the lock to it by hand.
            </p>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} data-testid="locked-off-menu">
              {off.map((l) => (
                <LockRow key={l.lockId} l={l} canManage={canManage} onSaid={setSaid} />
              ))}
            </ul>
          </div>
        ) : null}
        {unknown.length > 0 ? (
          <div style={{ marginTop: 14 }}>
            <p className="cl-crumb">Locked (whether on the current menu could not be read)</p>
            <p className="cl-note" style={{ marginTop: 2 }}>
              These locks hold as they are. Whether each wine is on the current menu is not said, because it could not
              be read.
            </p>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} data-testid="locked-menu-unknown">
              {unknown.map((l) => (
                <LockRow key={l.lockId} l={l} canManage={canManage} onSaid={setSaid} />
              ))}
            </ul>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <section id="locked-prices" style={{ marginTop: 32 }} aria-labelledby="locked-prices-h">
      <h2 id="locked-prices-h" className="cl-crumb">
        Locked prices
      </h2>
      <p className="cl-note">
        A locked price stays as it is at this house: no menu, correction or accepted advice changes it until an owner or a
        manager does.{canManage ? '' : ' Only an owner or a manager changes or releases a lock.'}
      </p>
      <div style={{ marginTop: 10 }}>{body}</div>
      {said ? (
        <p role="status" className="cl-said" style={{ marginTop: 10 }} data-testid="locked-prices-said">
          {said}
        </p>
      ) : null}
    </section>
  );
}

export default LockedPrices;
