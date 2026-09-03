/**
 * The wine register — the child the founder actually uses.
 *
 * The verdict says the redesign was rejected for crowding and today's page was
 * liked "where we could see everything". So the breadth is kept in full —
 * every title, every column, search, six filters, sortable headers, two view
 * modes — and the crowding is removed by moving *depth* off the row: a row
 * carries only facts of record, and everything learned about a bottle opens on
 * the reading stand above the register (BottleLeaf), one bottle at a time.
 *
 * Every filter here is built from values that arrived in the data. The legacy
 * Body filter is gone on purpose: `body` was hard-coded to 'medium' for all 442
 * rows, so the control could only ever match everything or nothing
 * (lib/wine-library.ts:32, useWineLibraryPage.ts:204-206).
 */

import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { animate, turn } from '../../../lib/mudavym/motion';
import { queryKeys } from '../../../lib/query-keys';
import BottleLeaf from './BottleLeaf';
import { BOOK_READ_LIMIT, type BottleVM, type CellarData } from './useCellarNextData';
import { EM, money, volume, year } from './cellar-format';

/**
 * The menu scanner ships today and its detection half is real (`scanMenuImage`
 * → the orchestrator's 4-layer pipeline). Its *add* half is not: both the
 * scanner tab's approve handler and the legacy page's `onWinesDetected` only
 * move rows around in component state — nothing is written to the library
 * (MenuScannerTab.tsx:160-172, WineLibrary.tsx:1813-1822). So the control here
 * is called "Read a menu", not "add wines", and says exactly what did not
 * happen when it finishes.
 *
 * DISCLOSED EXCEPTION — framer-motion. This is the ONE import on the page that
 * reaches a motion library, and it is deliberate and bounded:
 *
 *  - it is **shipped legacy code**, not new work — `MenuScannerModal.tsx:1` and
 *    `MenuScannerTab.tsx:2` both `import { motion } from 'framer-motion'`
 *    already, and they are outside this page's owned paths;
 *  - there is **no lighter path inside this directory**: dropping the modal
 *    wrapper and rendering `MenuScannerTab` in a Mudavym dialog would not help,
 *    because the tab imports framer-motion itself. Removing it means rebuilding
 *    the scanner, which is a separate piece of work (page note §13.8);
 *  - it is **code-split** (`lazy()`), so nothing about it reaches this page's
 *    first paint or its bundle until an operator opens the scanner;
 *  - it is **not part of this page's motion system**. Every motion CellarNext
 *    owns comes from `lib/mudavym/motion.ts` and is listed in MOTIONS.md; the
 *    scanner's animations are the legacy component's own and are not in that
 *    table, not tuned here, and not claimed as house motion.
 *
 * Its legacy white/indigo chrome inside the İznik page is filed in the page
 * note §9.8 rather than patched over with CSS overrides.
 */
const MenuScannerModal = lazy(() =>
  import('../../../components/wines/MenuScannerModal').then((m) => ({ default: m.MenuScannerModal })),
);

type SortKey = 'name' | 'style' | 'vintage' | 'country' | 'format' | 'list' | 'market' | 'onhand';
type Cellar = 'all' | 'in' | 'out' | 'par';

/**
 * The register's columns. A UI vocabulary, not a table of rows — `kind` says
 * whether the cell is a figure (right-aligned, tabular mono) or a word.
 */
const COLUMNS: { id: SortKey; label: string; kind: 'figure' | 'word' }[] = [
  { id: 'name', label: 'Bottle', kind: 'word' },
  { id: 'style', label: 'Style', kind: 'word' },
  { id: 'vintage', label: 'Vintage', kind: 'figure' },
  { id: 'country', label: 'Origin', kind: 'word' },
  { id: 'format', label: 'Format', kind: 'figure' },
  { id: 'list', label: 'List', kind: 'figure' },
  { id: 'market', label: 'Market', kind: 'figure' },
  { id: 'onhand', label: 'On hand', kind: 'figure' },
];

/** Sort value, or null for unknown. Unknowns sink in BOTH directions. */
function sortValue(b: BottleVM, key: SortKey): string | number | null {
  switch (key) {
    case 'style': return b.style?.toLowerCase() ?? null;
    case 'vintage': return b.vintage;
    case 'country': return b.country?.toLowerCase() ?? null;
    case 'format': return b.bottleSizeMl;
    case 'list': return b.listPrice;
    case 'market': return b.marketPrice;
    case 'onhand': return b.cellar ? b.cellar.stockLive : null;
    default: return b.name.toLowerCase();
  }
}

function distinct(bottles: BottleVM[], pick: (b: BottleVM) => string | null): string[] {
  const s = new Set<string>();
  for (const b of bottles) {
    const v = pick(b);
    if (v) s.add(v);
  }
  return [...s].sort((a, z) => a.localeCompare(z));
}

function Sift({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <label htmlFor={id} className="cl-dim" style={{ fontSize: 11 }}>
        {label}
      </label>
      <select id={id} className="cl-field cl-focus" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </span>
  );
}

const ANY = { value: 'all', label: 'Any' };

export default function WineRegister({ data }: { data: CellarData }) {
  const [query, setQuery] = useState('');
  const [style, setStyle] = useState('all');
  const [country, setCountry] = useState('all');
  const [region, setRegion] = useState('all');
  const [vintage, setVintage] = useState('all');
  const [format, setFormat] = useState('all');
  const [cellarFilter, setCellarFilter] = useState<Cellar>('all');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [asc, setAsc] = useState(true);
  const [shelf, setShelf] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanSaid, setScanSaid] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const bottles = data.bottles;
  const leafRef = useRef<HTMLDivElement | null>(null);

  // "The page turns" — the stand's contents change when another bottle is
  // opened. The stand itself expands on `settle` (CSS, .cl-stand).
  useEffect(() => {
    if (openId && leafRef.current) {
      animate(
        leafRef.current,
        [{ opacity: 0.2, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }],
        turn,
      );
    }
  }, [openId]);

  const facets = useMemo(() => {
    const bs = bottles ?? [];
    return {
      styles: distinct(bs, (b) => b.style),
      countries: distinct(bs, (b) => b.country),
      regions: distinct(bs, (b) => (country === 'all' || b.country === country ? b.region : null)),
      vintages: distinct(bs, (b) => (b.vintage === null ? null : String(b.vintage))).reverse(),
      formats: distinct(bs, (b) => (b.bottleSizeMl === null ? null : String(b.bottleSizeMl))).sort(
        (a, z) => Number(a) - Number(z),
      ),
    };
  }, [bottles, country]);

  const shown = useMemo(() => {
    if (!bottles) return null;
    const q = query.trim().toLowerCase();
    const rows = bottles.filter((b) => {
      if (q) {
        const hay = [b.name, b.producer, b.grape, b.region, b.country, b.appellation, b.style]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (style !== 'all' && b.style !== style) return false;
      if (country !== 'all' && b.country !== country) return false;
      if (region !== 'all' && b.region !== region) return false;
      if (vintage !== 'all' && String(b.vintage) !== vintage) return false;
      if (format !== 'all' && String(b.bottleSizeMl) !== format) return false;
      if (cellarFilter === 'in' && !b.cellar) return false;
      if (cellarFilter === 'out' && b.cellar) return false;
      if (cellarFilter === 'par') {
        const c = b.cellar;
        if (!c || c.thresholdMin === null || c.stockLive > c.thresholdMin) return false;
      }
      return true;
    });
    return rows.sort((a, z) => {
      const av = sortValue(a, sortKey);
      const zv = sortValue(z, sortKey);
      if (av === null && zv === null) return a.name.localeCompare(z.name);
      if (av === null) return 1; // unknowns sink in both directions
      if (zv === null) return -1;
      const c =
        typeof av === 'number' && typeof zv === 'number' ? av - zv : String(av).localeCompare(String(zv));
      return asc ? c : -c;
    });
  }, [bottles, query, style, country, region, vintage, format, cellarFilter, sortKey, asc]);

  const open = shown?.find((b) => b.id === openId) ?? null;
  const choose = (id: string) => setOpenId((cur) => (cur === id ? null : id));
  const toggleSort = (k: SortKey) => {
    if (k === sortKey) setAsc((v) => !v);
    else {
      setSortKey(k);
      setAsc(true);
    }
  };

  return (
    <div data-testid="wine-register">
      <p className="cl-crumb">
        <Link to="/cellar" className="cl-focus">
          The Cellar
        </Link>{' '}
        · register
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 12 }}>
        <h1 className="cl-h1">Wines</h1>
        <p className="cl-dim" style={{ margin: 0, fontSize: 12.5 }}>
          {shown === null
            ? 'Opening the book…'
            : `${shown.length.toLocaleString('en-US')} of ${(bottles?.length ?? 0).toLocaleString('en-US')} titles`}
          {data.bookTruncated
            ? ` · this read is capped at ${BOOK_READ_LIMIT}, so a title past that is not on this page`
            : ''}
        </p>
      </div>

      <hr className="cl-rule" style={{ margin: '14px 0' }} />

      {/* ── the control rail ─────────────────────────────────────────────── */}
      <div className="cl-row-controls">
        <label htmlFor="cl-search" className="cl-sr">
          Search the register
        </label>
        <input
          id="cl-search"
          className="cl-field cl-focus"
          type="search"
          placeholder="Search bottle, producer, grape, region…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ minWidth: 240, flex: '1 1 240px' }}
        />
        <Sift
          id="cl-f-style"
          label="Style"
          value={style}
          onChange={setStyle}
          options={[ANY, ...facets.styles.map((v) => ({ value: v, label: v }))]}
        />
        <Sift
          id="cl-f-country"
          label="Country"
          value={country}
          onChange={(v) => {
            setCountry(v);
            setRegion('all');
          }}
          options={[ANY, ...facets.countries.map((v) => ({ value: v, label: v }))]}
        />
        <Sift
          id="cl-f-region"
          label="Region"
          value={region}
          onChange={setRegion}
          options={[ANY, ...facets.regions.map((v) => ({ value: v, label: v }))]}
        />
        <Sift
          id="cl-f-vintage"
          label="Vintage"
          value={vintage}
          onChange={setVintage}
          options={[ANY, ...facets.vintages.map((v) => ({ value: v, label: v }))]}
        />
        <Sift
          id="cl-f-format"
          label="Format"
          value={format}
          onChange={setFormat}
          options={[ANY, ...facets.formats.map((v) => ({ value: v, label: volume(Number(v)) }))]}
        />
        <Sift
          id="cl-f-cellar"
          label="Cellar"
          value={cellarFilter}
          onChange={(v) => setCellarFilter(v as Cellar)}
          options={[
            { value: 'all', label: 'Everything' },
            { value: 'in', label: 'In the building' },
            { value: 'out', label: 'Not in the building' },
            { value: 'par', label: 'At or under par' },
          ]}
        />
        <span style={{ display: 'inline-flex', gap: 4, marginLeft: 'auto' }}>
          <button type="button" className="cl-btn cl-focus" onClick={() => setScanning(true)}>
            Read a menu
          </button>
          <button type="button" className="cl-btn cl-focus" data-on={!shelf} onClick={() => setShelf(false)}>
            Register
          </button>
          <button type="button" className="cl-btn cl-focus" data-on={shelf} onClick={() => setShelf(true)}>
            Shelf
          </button>
        </span>
      </div>

      {scanSaid ? (
        <p role="status" className="cl-note">
          {scanSaid}
        </p>
      ) : null}
      {scanning ? (
        <Suspense fallback={null}>
          <MenuScannerModal
            isOpen
            onClose={() => setScanning(false)}
            onWinesDetected={(detected: unknown[]) => {
              const n = Array.isArray(detected) ? detected.length : 0;
              setScanSaid(
                `The scanner read ${n} ${n === 1 ? 'title' : 'titles'} off that menu. Nothing was written: ` +
                  'the scanner detects, and no path from a detected title into the library or the cellar ' +
                  'exists on this page yet. The book has been re-read in case something landed elsewhere.',
              );
              void queryClient.invalidateQueries({ queryKey: queryKeys.wines.all });
            }}
          />
        </Suspense>
      ) : null}

      {/* ── honesty notices ──────────────────────────────────────────────── */}
      {data.bookError ? (
        <div role="alert" className="cl-panel" style={{ marginTop: 12, padding: '10px 14px' }}>
          <span className="cl-said">
            The book could not be read ({data.bookError}) — nothing below is claimed, and an empty
            register here would be a lie.
          </span>{' '}
          <button type="button" className="cl-btn cl-focus" onClick={data.refetch}>
            Try again
          </button>
        </div>
      ) : null}
      {!data.cellarKnown && !data.cellarError && bottles ? (
        <p className="cl-note">The cellar has not answered yet — every “on hand” reads {EM} until it does.</p>
      ) : null}
      {data.cellarError ? (
        <p role="status" className="cl-note">
          The cellar could not be read ({data.cellarError}) — “on hand” is unknown for every title
          below, not zero.
        </p>
      ) : null}

      {/* ── the reading stand ────────────────────────────────────────────── */}
      <div className="cl-stand" data-open={open ? 'true' : 'false'} style={{ marginTop: open ? 14 : 0 }}>
        <div>
          <div ref={leafRef}>
            {open ? (
              <BottleLeaf
                bottle={open}
                providers={data.providers}
                vendorsError={data.vendorsError}
                restaurantId={data.activeRestaurantId}
                onClose={() => setOpenId(null)}
              />
            ) : null}
          </div>
        </div>
      </div>

      {/* ── the register itself ──────────────────────────────────────────── */}
      <div style={{ marginTop: 14 }}>
        {shown === null ? (
          <p className="cl-said cl-dim">{data.bookError ? 'The register is unread.' : 'Opening the book…'}</p>
        ) : shown.length === 0 ? (
          <p className="cl-said cl-dim">
            {(bottles?.length ?? 0) === 0
              ? 'The book is open and empty — the library holds no titles.'
              : 'No title in the book matches this reading. Widen the filters.'}
          </p>
        ) : shelf ? (
          <div className="cl-shelf">
            {shown.map((b) => (
              <button
                key={b.id}
                type="button"
                className="cl-bottle cl-ink cl-focus"
                data-selected={b.id === openId}
                onClick={() => choose(b.id)}
              >
                <span className="cl-serif" style={{ fontSize: 14.5, fontWeight: 600, lineHeight: 1.25 }}>
                  {b.name}
                </span>
                <span className="cl-dim" style={{ fontSize: 11 }}>
                  {[b.producer, b.style].filter(Boolean).join(' · ') || 'unattributed'}
                </span>
                <span className="cl-num" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                  <span>{year(b.vintage)}</span>
                  <span>{money(b.listPrice)}</span>
                  <span>{b.cellar ? `${b.cellar.stockLive} on hand` : EM}</span>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div style={{ overflowX: 'auto', border: '1px solid var(--paper-2)', borderRadius: 10 }}>
            <table className="cl-table">
              <thead>
                <tr>
                  {COLUMNS.map((c) => (
                    <th key={c.id} style={{ textAlign: c.kind === 'figure' ? 'right' : 'left' }}>
                      <button
                        type="button"
                        className="cl-focus"
                        onClick={() => toggleSort(c.id)}
                        aria-label={`Sort by ${c.label}`}
                        style={{
                          background: 'none',
                          border: 0,
                          padding: 0,
                          font: 'inherit',
                          cursor: 'pointer',
                          color: sortKey === c.id ? 'var(--seal-deep)' : 'inherit',
                        }}
                      >
                        {c.label}
                        {sortKey === c.id ? (asc ? ' ▲' : ' ▼') : ''}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((b) => (
                  <tr
                    key={b.id}
                    data-selected={b.id === openId}
                    tabIndex={0}
                    onClick={() => choose(b.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        choose(b.id);
                      }
                    }}
                  >
                    <td>
                      <span style={{ display: 'block', fontWeight: 600 }}>{b.name}</span>
                      <span className="cl-dim" style={{ fontSize: 11 }}>
                        {[b.producer, b.grape].filter(Boolean).join(' · ') || 'unattributed'}
                      </span>
                    </td>
                    <td>{b.style ?? <span className="cl-dim">{EM}</span>}</td>
                    <td className="cl-num" style={{ textAlign: 'right' }}>
                      {year(b.vintage)}
                    </td>
                    <td>{[b.region, b.country].filter(Boolean).join(', ') || <span className="cl-dim">{EM}</span>}</td>
                    <td className="cl-num" style={{ textAlign: 'right' }}>
                      {volume(b.bottleSizeMl)}
                    </td>
                    <td className="cl-num" style={{ textAlign: 'right' }}>
                      {money(b.listPrice)}
                    </td>
                    <td className="cl-num cl-dim" style={{ textAlign: 'right' }}>
                      {money(b.marketPrice)}
                    </td>
                    <td className="cl-num" style={{ textAlign: 'right' }}>
                      {!data.cellarKnown ? (
                        <span className="cl-dim">{EM}</span>
                      ) : b.cellar ? (
                        b.cellar.stockLive
                      ) : (
                        <span className="cl-dim">not in the cellar</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
