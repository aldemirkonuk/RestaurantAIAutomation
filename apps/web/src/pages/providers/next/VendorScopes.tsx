/**
 * The /vendors scope ladder, drawn — founder, 2026-09-26, item 36 (ADR 0221).
 *
 *   Supplies my menu · N   All my vendors · N   Find new vendors · N
 *
 * A segmented control with live counts, the banner that says why the page did
 * not open on the menu, the menu rung's honest empty states, and the "Find new
 * vendors" rung (the existing curated catalogue search).
 *
 * Page-local on purpose: /promotions is building its own scope bar in the same
 * wave (#474). Extracting ONE shared bar once both exist is DESIGN-FOUNDATION
 * item 4's filter-bar row, not something to guess at from one caller.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../../lib/query-keys';
import {
  addProviderFromCatalogue,
  type VendorCatalogueEntry,
} from '../../../services/api/vendors';
import { EM, MONO, SANS } from './pv-format';
import { SCOPE_LABEL, listedTag, wineSearchable, type VendorScope } from './vendor-scope';
import type { VendorScopes, CatalogueSearch, BookSearch } from './useVendorScopes';

const SCOPES: VendorScope[] = ['menu', 'all', 'find'];

const note: React.CSSProperties = {
  fontFamily: SANS,
  fontSize: 12.5,
  color: 'var(--ink-2, #4F473C)',
  border: '1px solid var(--paper-2, #EAE4D8)',
  background: 'var(--paper-1, #F3EFE6)',
  borderRadius: 12,
  padding: '10px 14px',
  margin: '0 0 12px',
};

const quiet: React.CSSProperties = {
  fontFamily: SANS,
  fontSize: 11.5,
  color: 'var(--ink-3, #7C7365)',
  margin: '0 0 10px',
};

const linkBtn: React.CSSProperties = {
  fontFamily: SANS,
  fontSize: 12,
  fontWeight: 600,
  padding: 0,
  border: 0,
  background: 'transparent',
  color: 'var(--seal-deep, #14515C)',
  cursor: 'pointer',
  textDecoration: 'underline',
  textUnderlineOffset: 2,
};

export function VendorScopeBar<T>({ scopes }: { scopes: VendorScopes<T> }) {
  return (
    <div
      role="tablist"
      aria-label="Which vendors to show"
      className="vs-bar"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 6,
        margin: '0 0 12px',
        fontFamily: SANS,
      }}
    >
      <style>{`
        .vs-tab:focus-visible { outline: 2px solid var(--seal, #1A5E6B); outline-offset: 2px }
        @media (max-width: 480px) { .vs-bar { display: grid !important; grid-template-columns: 1fr } }
      `}</style>
      {SCOPES.map((s) => {
        const on = scopes.scope === s;
        const count = scopes.counts[s];
        return (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={on}
            data-testid={`scope-${s}`}
            className="vs-tab"
            onClick={() => scopes.choose(s)}
            style={{
              display: 'inline-flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: 8,
              padding: '6px 12px',
              borderRadius: 999,
              border: `1px solid ${on ? 'var(--seal-ring, rgba(26,94,107,.32))' : 'var(--paper-2, #EAE4D8)'}`,
              background: on ? 'var(--seal-tint, rgba(26,94,107,.10))' : 'transparent',
              color: on ? 'var(--seal-deep, #14515C)' : 'var(--ink-2, #4F473C)',
              fontWeight: on ? 600 : 400,
              fontSize: 12.5,
              cursor: 'pointer',
            }}
          >
            <span>{SCOPE_LABEL[s]}</span>
            <span
              data-testid={`scope-${s}-count`}
              style={{ fontFamily: MONO, fontSize: 11, fontVariantNumeric: 'tabular-nums' }}
            >
              {count === null ? EM : count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function fmtReadAt(iso: string | null): string | null {
  if (!iso) return null;
  const t = new Date(iso);
  if (!Number.isFinite(t.getTime())) return null;
  return t.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * The line above the grid that says what the rung is showing, or why it is not
 * showing what the person expected. Never silent: a widened default says so, an
 * unanswerable menu rung says why, and a failed read says it failed.
 */
export function ScopeNotice<T>({ scopes }: { scopes: VendorScopes<T> }) {
  const { scope, reason, supply } = scopes;
  if (scope === 'find') return null;

  const readMenu = (
    <Link to="/house/menu" style={{ ...linkBtn, textDecoration: 'underline' }}>
      Read your menu
    </Link>
  );
  const retry = (
    <button type="button" style={linkBtn} onClick={scopes.refetchSupply}>
      Try again
    </button>
  );
  const why =
    reason === 'no-menu'
      ? 'No menu read yet'
      : reason === 'menu-unlinked'
        ? 'None of your current menu’s lines is linked to a wine yet, so no vendor can be matched to it'
        : reason === 'unreadable' && supply.status === 'error'
          ? `Which vendors supply your menu could not be worked out (${supply.message})`
          : null;

  if (scope === 'all') {
    // The banner is for the DEFAULT only: a person who picked "All my vendors"
    // knows what they asked for.
    if (!why || scopes.chosen) return null;
    return (
      <p role="status" data-testid="scope-widened" style={note}>
        {why} — showing all your vendors.{' '}
        {reason === 'no-menu' && readMenu}
        {reason === 'unreadable' && retry}
      </p>
    );
  }

  // scope === 'menu'
  if (supply.status === 'loading') {
    return (
      <p role="status" style={quiet}>
        Reading your current menu and what you have bought…
      </p>
    );
  }
  if (why) {
    return (
      <p role={reason === 'unreadable' ? 'alert' : 'status'} data-testid="scope-menu-unanswered" style={note}>
        {why}. Nothing below is claimed about who supplies it.{' '}
        {reason === 'no-menu' && readMenu}
        {reason === 'unreadable' && retry}
      </p>
    );
  }
  if (supply.status !== 'ready') return null;
  const { menu, windowDays } = supply.data;
  const readAt = fmtReadAt(menu.readAt);
  if ((scopes.visible ?? []).length === 0) {
    return (
      <p role="status" data-testid="scope-menu-empty" style={note}>
        None of your vendors has a price in the last {windowDays} days, an order, or a stock line
        for any of the {menu.wines} wine{menu.wines === 1 ? '' : 's'} on your current menu.{' '}
        <button type="button" style={linkBtn} onClick={() => scopes.choose('all')}>
          See all your vendors
        </button>
      </p>
    );
  }
  return (
    <p data-testid="scope-menu-basis" style={quiet}>
      Vendors with a price in the last {windowDays} days, an order, or a stock line for one of the{' '}
      {menu.wines} wine{menu.wines === 1 ? '' : 's'} on your current menu
      {menu.menus > 1 ? ` (${menu.menus} menus are marked current; all are read)` : ''}
      {readAt ? `, current since ${readAt}` : ''}.
    </p>
  );
}

const TYPE_WORD: Record<string, string> = {
  distributor: 'Distributor',
  importer: 'Importer',
  wholesaler: 'Wholesaler',
  winery_direct: 'Winery direct',
  broker: 'Broker',
  other: 'Other',
};

/** What a catalogue row draws — the search's rows and the wine search's vendors. */
type CatalogueVendorLike = Pick<
  VendorCatalogueEntry,
  'id' | 'name' | 'city' | 'state' | 'country' | 'wine_specialties'
> & { type: string | null };

function placeOf(v: CatalogueVendorLike): string {
  return [v.city, v.state, v.country].filter((x) => x && String(x).trim()).join(', ');
}

const quoted = (t: string) => `“${t}”`;

/**
 * "All my vendors"' search box — founder, 2026-09-26, round 7, item 48. It
 * matches a vendor's own name at once, and — once two letters of a wine's name
 * are typed — every vendor that sold the house ANY vintage of that wine (the
 * menu rung is the exact-vintage one). The status line says which half has
 * answered; a failed wine search is said, never shown as "nobody sold it".
 */
export function BookSearchBar({ book, shown }: { book: BookSearch; shown: number | null }) {
  const text = book.q.trim();
  const w = book.wine;
  let line: React.ReactNode = null;
  if (text !== '') {
    if (w.status === 'idle') {
      line = wineSearchable(text) ? null : (
        <p style={quiet}>Matching vendor names. Type two letters of a wine’s name to also find who sold it to you.</p>
      );
    } else if (w.status === 'loading') {
      line = <p role="status" style={quiet}>Matching vendor names; looking through what you have bought for {quoted(text)}…</p>;
    } else if (w.status === 'error') {
      line = (
        <p role="alert" data-testid="book-wine-failed" style={note}>
          The wine search could not run ({w.message}) — only vendor names are matched below. That is a failed
          search, not a wine nobody sold you.
        </p>
      );
    } else {
      const n = w.data.sellers.length;
      const which = w.data.query.vintages.length
        ? `the ${w.data.query.vintages.join(' or ')} vintage`
        : 'any vintage';
      line = (
        <p role="status" data-testid="book-wine-basis" style={quiet}>
          {n === 0
            ? `None of your vendors sold you a wine matching ${quoted(text)} (${which}) — prices, orders and stock lines of all time were read.`
            : `${n} of your vendors sold you a wine matching ${quoted(text)} — ${which}, from prices, orders and stock lines of all time. Vendors whose own name matches are shown too.`}
        </p>
      );
    }
  }
  return (
    <div style={{ fontFamily: SANS, margin: '0 0 10px' }}>
      <label style={{ display: 'grid', gap: 3, maxWidth: 420 }}>
        <span style={{ ...quiet, margin: 0 }}>A vendor’s name, or a wine they sold you (any vintage)</span>
        <input
          type="search"
          value={book.q}
          onChange={(e) => book.setQ(e.target.value)}
          placeholder="e.g. Opus One, Sancerre, a vendor’s name"
          data-testid="book-q"
          style={{
            fontFamily: SANS,
            fontSize: 13,
            padding: '7px 10px',
            borderRadius: 9,
            border: '1px solid var(--paper-2, #EAE4D8)',
            background: 'var(--paper-0, #FAF7F1)',
            color: 'var(--ink-1, #211C16)',
          }}
        />
      </label>
      {line}
      {text !== '' && shown === 0 && w.status !== 'loading' && w.status !== 'error' && (
        <p data-testid="book-q-empty" style={note}>
          No vendor’s name matches {quoted(text)}
          {w.status === 'ready' ? ', and none sold you a wine by that name.' : '.'}
        </p>
      )}
    </div>
  );
}

function countryHint(find: CatalogueSearch): string | null {
  const code = find.country.toUpperCase();
  switch (find.countryBasis) {
    case 'reading':
      return 'Reading your house’s country…';
    case 'house':
      return `Opens on your house’s country (${code}${find.countryWritten && find.countryWritten.toUpperCase() !== code ? `, from ${quoted(find.countryWritten)}` : ''}).`;
    case 'missing':
      return 'Your house has no country recorded, so this opens on US.';
    case 'unknown':
      return `Your house’s country (${quoted(find.countryWritten ?? '')}) is not one this list knows, so this opens on US.`;
    case 'unreadable':
      return 'Your house’s country could not be read, so this opens on US.';
    default:
      return null;
  }
}

/**
 * "Find new vendors" — the curated catalogue search (the one the add-vendor
 * modal always used), with its live total. A vendor already in the house's book
 * says so instead of offering an Add the server would refuse with 409.
 */
export function FindNewVendors({
  find,
  addedCatalogueIds,
}: {
  find: CatalogueSearch;
  addedCatalogueIds: Set<string>;
}) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(() => new Set());
  const [addError, setAddError] = useState<string | null>(null);

  const add = async (v: CatalogueVendorLike) => {
    setAdding(v.id);
    setAddError(null);
    try {
      await addProviderFromCatalogue(v.id);
      setAdded((s) => new Set(s).add(v.id));
    } catch (e) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      if (status === 409) {
        setAdded((s) => new Set(s).add(v.id));
      } else {
        const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
        setAddError(`${v.name} could not be added (${typeof msg === 'string' && msg ? msg : 'unknown error'}).`);
      }
    } finally {
      setAdding(null);
      void qc.invalidateQueries({ queryKey: queryKeys.providers.all });
    }
  };

  const input: React.CSSProperties = {
    fontFamily: SANS,
    fontSize: 13,
    padding: '7px 10px',
    borderRadius: 9,
    border: '1px solid var(--paper-2, #EAE4D8)',
    background: 'var(--paper-0, #FAF7F1)',
    color: 'var(--ink-1, #211C16)',
  };

  const result = find.result;
  return (
    <section aria-label="Find new vendors" style={{ fontFamily: SANS }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '0 0 8px' }}>
        <label style={{ flex: '1 1 240px', display: 'grid', gap: 3 }}>
          <span style={{ ...quiet, margin: 0 }}>Name or specialty</span>
          <input
            type="search"
            value={find.q}
            onChange={(e) => find.setQ(e.target.value)}
            placeholder="e.g. Burgundy, Rioja, a vendor’s name"
            style={input}
            data-testid="find-q"
          />
        </label>
        <label style={{ flex: '0 0 96px', display: 'grid', gap: 3 }}>
          <span style={{ ...quiet, margin: 0 }}>Country</span>
          <input
            value={find.country}
            onChange={(e) => find.setCountry(e.target.value.slice(0, 2))}
            maxLength={2}
            aria-describedby="find-country-hint"
            style={{ ...input, fontFamily: MONO, textTransform: 'uppercase' }}
            data-testid="find-country"
          />
        </label>
      </div>
      <p id="find-country-hint" style={quiet}>
        The curated catalogue — vendors a person has checked, listed by two-letter country code.
        Adding one puts it in your own book; nothing is sent to the vendor.{' '}
        <span data-testid="find-country-basis">{countryHint(find)}</span>
      </p>

      <CatalogueWineResults
        find={find}
        isYours={(id) => addedCatalogueIds.has(id) || added.has(id)}
        adding={adding}
        onAdd={(v) => void add(v)}
      />

      {find.status === 'loading' && !result && <p style={quiet}>Searching the catalogue…</p>}
      {find.status === 'error' && (
        <p role="alert" style={note}>
          The catalogue could not be searched ({find.message}). That is a failed search, not an empty
          catalogue.
        </p>
      )}
      {addError && (
        <p role="alert" style={note}>
          {addError}
        </p>
      )}
      {result && find.status !== 'error' && (
        <>
          <p data-testid="find-total" style={quiet}>
            {result.total === 0
              ? `No curated vendor in ${find.country.toUpperCase() || EM}${find.q.trim() ? ` matches “${find.q.trim()}”` : ''}.`
              : `${result.total} curated vendor${result.total === 1 ? '' : 's'} in ${find.country.toUpperCase()}${
                  find.q.trim() ? ` matching “${find.q.trim()}”` : ''
                }${result.total > result.data.length ? ` — showing the first ${result.data.length}; narrow the search to see others` : ''}.`}
          </p>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
            {result.data.map((v) => (
              <CatalogueRow
                key={v.id}
                v={v}
                yours={addedCatalogueIds.has(v.id) || added.has(v.id)}
                adding={adding}
                onAdd={() => void add(v)}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/**
 * One curated catalogue vendor: type, name, place and specialties, and either
 * "In your vendors" or "Add to my vendors". `tag` is the wine search's label.
 */
function CatalogueRow({
  v,
  yours,
  adding,
  onAdd,
  tag,
}: {
  v: CatalogueVendorLike;
  yours: boolean;
  adding: string | null;
  onAdd: () => void;
  tag?: string;
}) {
  return (
    <li
      data-testid={tag ? 'find-wine-row' : 'find-row'}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 8,
        padding: '10px 14px',
        borderRadius: 12,
        border: '1px solid var(--paper-2, #EAE4D8)',
        background: 'var(--paper-1, #F3EFE6)',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <span
          style={{
            fontFamily: MONO,
            fontSize: 8.5,
            fontWeight: 600,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--seal-deep, #14515C)',
          }}
        >
          {(v.type && TYPE_WORD[v.type]) ?? v.type ?? EM}
        </span>
        <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: 'var(--ink-1, #211C16)' }}>
          {v.name}
        </span>
        {tag && (
          <span data-testid="find-wine-tag" style={{ display: 'block', fontSize: 11.5, color: 'var(--ink-2, #4F473C)' }}>
            {tag}
          </span>
        )}
        <span style={{ display: 'block', fontSize: 11.5, color: 'var(--ink-3, #7C7365)' }}>
          {[placeOf(v), v.wine_specialties].filter(Boolean).join(' · ') || EM}
        </span>
      </div>
      {yours ? (
        <span style={{ fontSize: 12, color: 'var(--ink-3, #7C7365)' }}>In your vendors</span>
      ) : (
        <button
          type="button"
          onClick={onAdd}
          disabled={adding !== null}
          style={{
            fontSize: 12,
            fontWeight: 600,
            padding: '5px 12px',
            borderRadius: 8,
            border: '1px solid var(--seal-ring, rgba(26,94,107,.32))',
            background: 'transparent',
            color: 'var(--seal-deep, #14515C)',
            cursor: adding ? 'progress' : 'pointer',
          }}
        >
          {adding === v.id ? 'Adding…' : 'Add to my vendors'}
        </button>
      )}
    </li>
  );
}

/**
 * The name-only wine search on "Find new vendors" (item 48): curated vendors a
 * price sighting ties to ANY vintage of the wine typed, each labelled with how
 * it was seen — "Listed" on their site, "Quoted", or "Invoiced" — and the
 * vintage. Shown above the name/specialty results; never merged into their
 * total, because the two answer different questions.
 */
function CatalogueWineResults({
  find,
  isYours,
  adding,
  onAdd,
}: {
  find: CatalogueSearch;
  isYours: (id: string) => boolean;
  adding: string | null;
  onAdd: (v: CatalogueVendorLike) => void;
}) {
  const w = find.wine;
  if (w.status === 'idle') return null;
  const text = find.q.trim();
  const where = find.country.toUpperCase();
  if (w.status === 'loading') {
    return (
      <p role="status" style={quiet}>
        Looking for curated vendors in {where} seen pricing a wine matching {quoted(text)}…
      </p>
    );
  }
  if (w.status === 'error') {
    return (
      <p role="alert" data-testid="find-wine-failed" style={note}>
        The wine search could not run ({w.message}). That is a failed search, not a wine no vendor lists.
      </p>
    );
  }
  const which = w.data.query.vintages.length ? `the ${w.data.query.vintages.join(' or ')} vintage` : 'any vintage';
  if (w.data.listers.length === 0) {
    return (
      <p data-testid="find-wine-none" style={quiet}>
        No curated vendor in {where} has been seen pricing a wine matching {quoted(text)} ({which}).
      </p>
    );
  }
  return (
    <section aria-label="Vendors seen pricing this wine" style={{ margin: '0 0 14px' }}>
      <p data-testid="find-wine-basis" style={quiet}>
        {w.data.listers.length} curated vendor{w.data.listers.length === 1 ? '' : 's'} in {where} seen pricing a wine
        matching {quoted(text)} — {which}. A price on a vendor’s list is not a sale; each says how it was seen.
      </p>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
        {w.data.listers.map((l) => (
          <CatalogueRow
            key={l.vendor.id}
            v={l.vendor}
            yours={isYours(l.vendor.id)}
            adding={adding}
            onAdd={() => onAdd(l.vendor)}
            tag={listedTag(l.wines)}
          />
        ))}
      </ul>
    </section>
  );
}
