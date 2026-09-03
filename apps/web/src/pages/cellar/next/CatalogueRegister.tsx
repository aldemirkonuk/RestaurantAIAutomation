/**
 * A register of the cellar that is not the wine register — beer, whisky,
 * spirits, non-alcoholic, soft drinks — as a real register: searchable,
 * sortable, filterable, and carrying THE HOUSE'S OWN RECORD on every row.
 *
 * WHAT THIS REPLACES, AND WHY IT WAS WRONG
 * ----------------------------------------
 * Two builds ago this file said "the table exists and nothing serves it". One
 * build ago it said "the table is served, but `public.beverages` has no
 * `restaurant_id`, so nothing here is yours". Both were true. Both left a
 * whisky bar opening `/whiskey` looking at 211 strangers' bottles and none of
 * its own — a reference shelf wearing a register's clothes.
 *
 * DESIGN-FOUNDATION.md §6 names the answer for this page, and marks it *now*:
 * **the house's own record on every bottle — first bought, what we have paid,
 * what we poured, who quoted it.** So the spine is inverted. The house's own
 * books come first (`house_beverage_ledger`, migration 20260903120000, over
 * menu_items · procurement_document_lines · procurement_order_items ·
 * vendor_price_observations · pos_unresolved_lines), and the shared catalogue
 * is the lookup laid over them — not the other way round.
 *
 * THE THREE KINDS OF ROW, EACH A DIFFERENT SENTENCE
 *
 *   ours + catalogued  — the full record, with ABV and format from the library.
 *   ours only          — the full record and no catalogue entry. Still ours: a
 *                        bottle nobody catalogued is not a bottle nobody bought.
 *   catalogue only     — browsable reference, labelled as belonging to nobody.
 *
 * WHAT IS STILL WITHHELD, AND SAYS SO
 * -----------------------------------
 * Stocking. Every quantity path in the schema is keyed on `master_wine_id`, so
 * a keg has no stock row to write to; the "Count into the cellar" control is
 * rendered, disabled, with the gateway's own sentence beneath it. That is
 * OD-113, and it is a decision the founder has not made rather than a feature
 * nobody built.
 *
 * AND THIS PAGE IS NOT A SECOND SOURCE OF TRUTH. The menu-scenarios study
 * (§b.3) is explicit: the declared register set is Settings' job, and any other
 * surface "may display it and flag disagreement, never hold a competing copy".
 * This register reads `menu_items`; it never writes one.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, BookOpen, Search } from 'lucide-react';
import { animate, turn } from '../../../lib/mudavym/motion';
import CocktailRegister from './CocktailRegister';
import HouseRecordLeaf from './HouseRecordLeaf';
import RegisterNotice from './NeedsItemsNotice';
import RegisterEvidenceLine from './RegisterEvidenceLine';
import {
  BOOK_LABEL,
  BOOK_ORDER,
  EM,
  REGISTER_TITLE,
  count,
  money,
  noHouseRowsLine,
  shortDate,
  volume,
  type HouseBookId,
  type RegisterId,
} from './cellar-format';
import { REGISTER_SOURCE } from './registerShapes';
import {
  useRegister,
  type CellarData,
  type RegisterRowVM,
  type RegisterVM,
} from './useCellarNextData';

type SortKey =
  | 'name' | 'books' | 'first' | 'paid' | 'sold' | 'quote'
  | 'type' | 'origin' | 'abv' | 'format';
type Scope = 'all' | 'ours' | 'catalogue';
type MatchFilter = 'all' | 'exact' | 'contains' | 'none';

/**
 * The register's columns. A UI vocabulary, not a table of rows — `kind` says
 * whether the cell is a figure (right-aligned, tabular mono) or a word. The
 * same three keys `WineRegister.COLUMNS` uses, deliberately: one idea, one
 * shape, and a descriptor list that only describes.
 */
const COLUMNS: { id: SortKey; label: string; kind: 'figure' | 'word' }[] = [
  { id: 'name', label: 'Bottle', kind: 'word' },
  { id: 'books', label: 'Our record', kind: 'word' },
  { id: 'first', label: 'First bought', kind: 'figure' },
  { id: 'paid', label: 'Paid', kind: 'figure' },
  { id: 'sold', label: 'Sold', kind: 'figure' },
  { id: 'quote', label: 'Last quote', kind: 'figure' },
  { id: 'type', label: 'Type', kind: 'word' },
  { id: 'origin', label: 'Origin', kind: 'word' },
  { id: 'abv', label: 'ABV', kind: 'figure' },
  { id: 'format', label: 'Format', kind: 'figure' },
];

/** Sort value, or null for unknown. Unknowns sink in BOTH directions. */
function sortValue(r: RegisterRowVM, key: SortKey): string | number | null {
  const h = r.house;
  switch (key) {
    case 'books': return h ? h.books.length : null;
    case 'first': return h?.bought?.first ? Date.parse(h.bought.first) : null;
    case 'paid': return h?.bought?.paidTotal ?? null;
    case 'sold': return h?.poured?.qty ?? null;
    case 'quote': return h?.quoted?.lastPrice ?? null;
    case 'type': return r.catalogue?.beverageType?.toLowerCase() ?? null;
    case 'origin':
      return [r.catalogue?.region, r.catalogue?.country].filter(Boolean).join(', ').toLowerCase() || null;
    case 'abv': return r.catalogue?.abvPct ?? null;
    case 'format': return r.catalogue?.volumeMl ?? null;
    default: return r.name.toLowerCase();
  }
}

/**
 * The row's record, at a glance: one mark per book that names it. Ink, never a
 * semantic colour — the chip rule (contrast measured, ADR 0042).
 */
function Books({ books }: { books: HouseBookId[] }) {
  if (books.length === 0) return <span className="cl-dim">{EM}</span>;
  return (
    <span style={{ display: 'inline-flex', gap: 3 }}>
      {BOOK_ORDER.map((b) => (
        <span
          key={b}
          className="cl-mark"
          data-on={books.includes(b) ? 'true' : 'false'}
          title={books.includes(b) ? BOOK_LABEL[b] : `not ${BOOK_LABEL[b]}`}
          aria-hidden
        />
      ))}
      <span className="cl-sr">{books.map((b) => BOOK_LABEL[b]).join(', ')}</span>
    </span>
  );
}

function Sift({
  id, label, value, options, onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <label htmlFor={id} className="cl-dim" style={{ fontSize: 11 }}>{label}</label>
      <select id={id} className="cl-field cl-focus" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </span>
  );
}

const ANY = { value: 'all', label: 'Any' };

/* ── the register head: whose register this is, and how it was decided ───── */

function Head({ id, readout }: { id: RegisterId; readout: CellarData['registers'] }) {
  const r = readout?.registers.find((x) => x.id === id);
  const source = REGISTER_SOURCE[id];
  return (
    <>
      <p className="cl-crumb">
        <Link to="/cellar" className="cl-focus">The Cellar</Link> · register
      </p>
      <h1 className="cl-h1">{REGISTER_TITLE[id]}</h1>
      <p className="cl-standing">{source.oneLine}</p>
      {r ? (
        <>
          <p className="cl-said" style={{ marginTop: 6 }}>{r.basis}</p>
          <RegisterEvidenceLine evidence={r.evidence} confidence={r.confidence} />
        </>
      ) : null}
      {r?.needsEvidence ? <RegisterNotice registers={[id]} /> : null}
      {r?.carried === false && (r?.strandedItems ?? 0) > 0 ? (
        <RegisterNotice kind="stranded" registers={[id]} counts={{ [id]: r.strandedItems }} />
      ) : null}
      <hr className="cl-rule" style={{ margin: '16px 0 18px' }} />
    </>
  );
}

/* ── the four states of the two reads, each a different sentence ────────── */

function SourceLines({ data }: { data: RegisterVM }) {
  return (
    <>
      {!data.house.readable ? (
        <p className="cl-said" role="alert" data-testid="house-unread">
          <AlertTriangle size={13} aria-hidden style={{ verticalAlign: '-2px', marginRight: 5 }} />
          This house’s own record could not be read{data.house.reason ? ` — ${data.house.reason}` : ''}.
          Every “our record” below is unknown, not empty; the rows are the shared
          catalogue alone.
        </p>
      ) : null}
      {!data.catalogue.readable ? (
        <p className="cl-said" role="alert" data-testid="catalogue-unread">
          <AlertTriangle size={13} aria-hidden style={{ verticalAlign: '-2px', marginRight: 5 }} />
          The shared catalogue could not be read
          {data.catalogue.reason ? ` (${data.catalogue.reason})` : ''}. What is below
          is this house’s own record with nothing laid over it.
        </p>
      ) : null}
      <p className="cl-note">
        <BookOpen size={12} aria-hidden style={{ verticalAlign: '-2px', marginRight: 5 }} />
        {data.catalogue.servedByThisTable
          ? `Catalogue read on beverage_type in (${data.catalogue.matchedTypes.join(', ')}).`
          : data.catalogue.reason ?? 'The shared catalogue cannot answer for this register.'}{' '}
        {data.catalogue.truncated
          ? `That read is capped at ${data.catalogue.limit} rows and came back full, so the catalogue is larger than what is shown.`
          : null}{' '}
        {data.house.readable
          ? `${count(data.counts.houseRows)} of these rows are this house’s own, assembled from its menu, invoices, orders, quotes and till lines.`
          : null}{' '}
        {data.counts.matchedLoosely > 0
          ? `${count(data.counts.matchedLoosely)} reached the catalogue by the weaker rule and are marked.`
          : null}
      </p>
      {data.house.truncated ? (
        <p className="cl-note" data-testid="house-truncated">
          This house’s ledger read is capped at {data.house.limit} products and came
          back full, so its books hold more than this register shows.
        </p>
      ) : null}
      {data.unregistered.length > 0 ? (
        <p className="cl-note" data-testid="unregistered">
          {count(data.unregistered.length)}{' '}
          {data.unregistered.length === 1 ? 'line' : 'lines'} in this house’s books
          belong to no register this build knows —{' '}
          {data.unregistered.slice(0, 4).map((u) => u.label).join(', ')}
          {data.unregistered.length > 4 ? ', and others' : ''}. They are counted
          nowhere rather than folded into a neighbouring register.
        </p>
      ) : null}
    </>
  );
}

/* ── the register ───────────────────────────────────────────────────────── */

export default function CatalogueRegister({
  id,
  data,
}: {
  id: RegisterId;
  data: CellarData;
}) {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<Scope>('all');
  const [book, setBook] = useState<string>('all');
  const [type, setType] = useState('all');
  const [match, setMatch] = useState<MatchFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('books');
  const [asc, setAsc] = useState(false);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const leafRef = useRef<HTMLDivElement | null>(null);

  const register = useRegister(id);
  const reg = register.data;

  // "The page turns" — the stand's contents change when another row is opened.
  useEffect(() => {
    if (openKey && leafRef.current) {
      animate(
        leafRef.current,
        [{ opacity: 0.2, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }],
        turn,
      );
    }
  }, [openKey]);

  const types = useMemo(() => {
    const s = new Set<string>();
    for (const r of reg?.rows ?? []) if (r.catalogue?.beverageType) s.add(r.catalogue.beverageType);
    return [...s].sort((a, z) => a.localeCompare(z));
  }, [reg]);

  const shown = useMemo(() => {
    if (!reg) return null;
    const q = query.trim().toLowerCase();
    const rows = reg.rows.filter((r) => {
      if (q) {
        const hay = [r.name, r.producer, r.catalogue?.beverageType, r.catalogue?.region, r.catalogue?.country]
          .filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (scope === 'ours' && r.house === null) return false;
      if (scope === 'catalogue' && r.house !== null) return false;
      if (book !== 'all' && !(r.house?.books ?? []).includes(book as HouseBookId)) return false;
      if (type !== 'all' && r.catalogue?.beverageType !== type) return false;
      if (match === 'exact' && r.catalogue?.matchedBy !== 'exact') return false;
      if (match === 'contains' && r.catalogue?.matchedBy !== 'contains') return false;
      if (match === 'none' && r.catalogue !== null) return false;
      return true;
    });
    return rows.sort((a, z) => {
      const av = sortValue(a, sortKey);
      const zv = sortValue(z, sortKey);
      if (av === null && zv === null) return a.name.localeCompare(z.name);
      if (av === null) return 1; // unknowns sink in both directions
      if (zv === null) return -1;
      const c = typeof av === 'number' && typeof zv === 'number'
        ? av - zv
        : String(av).localeCompare(String(zv));
      return asc ? c : -c;
    });
  }, [reg, query, scope, book, type, match, sortKey, asc]);

  // Cocktails are the one register a house can WRITE, and their columns are a
  // recipe's, not a bottle's — so they get their own component rather than a
  // pile of conditionals in this one.
  if (id === 'cocktails') {
    return (
      <div data-testid="catalogue-cocktails">
        <Head id={id} readout={data.registers} />
        <CocktailRegister register={reg} registerLoading={register.loading} />
      </div>
    );
  }

  const toggleSort = (k: SortKey) => {
    if (k === sortKey) setAsc((v) => !v);
    else {
      setSortKey(k);
      setAsc(k === 'name' || k === 'type' || k === 'origin');
    }
  };
  const open = shown?.find((r) => r.key === openKey) ?? null;

  return (
    <div data-testid={`catalogue-${id}`}>
      <Head id={id} readout={data.registers} />

      {register.loading ? (
        <p className="cl-said" role="status" data-testid="register-loading">
          Reading this house’s books, and the shared catalogue…
        </p>
      ) : register.error || !reg ? (
        <p className="cl-said" role="alert" data-testid="register-error">
          <AlertTriangle size={13} aria-hidden style={{ verticalAlign: '-2px', marginRight: 5 }} />
          The {REGISTER_TITLE[id].toLowerCase()} register could not be read
          {register.error ? ` (${register.error})` : ''}. This is unread, not empty
          — an empty table here would say this house pours none, which is a claim
          nothing on this page can support.{' '}
          <button type="button" className="cl-btn cl-focus" onClick={register.refetch}>
            Try again
          </button>
        </p>
      ) : (
        <>
          {/* ── the control rail ─────────────────────────────────────────── */}
          <div className="cl-row-controls">
            <label htmlFor="cl-r-search" className="cl-sr">Search this register</label>
            <span style={{ position: 'relative', flex: '1 1 220px', minWidth: 200 }}>
              <Search
                size={13}
                aria-hidden
                style={{ position: 'absolute', left: 9, top: 8.5, color: 'var(--ink-3)' }}
              />
              <input
                id="cl-r-search"
                className="cl-field cl-focus"
                type="search"
                placeholder="Search bottle, producer, type, origin…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                style={{ width: '100%', paddingLeft: 27 }}
              />
            </span>
            <Sift
              id="cl-r-scope" label="Whose" value={scope}
              onChange={(v) => setScope(v as Scope)}
              options={[
                { value: 'all', label: 'Everything' },
                { value: 'ours', label: 'Ours' },
                { value: 'catalogue', label: 'Catalogue only' },
              ]}
            />
            <Sift
              id="cl-r-book" label="In" value={book} onChange={setBook}
              options={[ANY, ...BOOK_ORDER.map((b) => ({ value: b, label: BOOK_LABEL[b] }))]}
            />
            <Sift
              id="cl-r-type" label="Type" value={type} onChange={setType}
              options={[ANY, ...types.map((t) => ({ value: t, label: t }))]}
            />
            <Sift
              id="cl-r-match" label="Match" value={match}
              onChange={(v) => setMatch(v as MatchFilter)}
              options={[
                { value: 'all', label: 'Any' },
                { value: 'exact', label: 'Exact' },
                { value: 'contains', label: 'Loose' },
                { value: 'none', label: 'Not catalogued' },
              ]}
            />
            <span className="cl-dim" style={{ fontSize: 12, marginLeft: 'auto' }}>
              {count(shown?.length ?? null)} of {count(reg.counts.total)} ·{' '}
              {count(reg.counts.houseRows)} ours
            </span>
          </div>

          <SourceLines data={reg} />

          {/* ── the reading stand ────────────────────────────────────────── */}
          <div className="cl-stand" data-open={open ? 'true' : 'false'} style={{ marginTop: open ? 14 : 0 }}>
            <div>
              <div ref={leafRef}>
                {open ? (
                  <HouseRecordLeaf
                    row={open}
                    stockingReason={reg.stocking.reason}
                    onClose={() => setOpenKey(null)}
                  />
                ) : null}
              </div>
            </div>
          </div>

          {/* ── the register itself ──────────────────────────────────────── */}
          <div style={{ marginTop: 14 }}>
            {shown === null || shown.length === 0 ? (
              <p className="cl-said cl-dim" data-testid="register-empty">
                {reg.counts.total === 0
                  ? noHouseRowsLine(id)
                  : 'No row in this register matches this reading. Widen the filters.'}
              </p>
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
                              background: 'none', border: 0, padding: 0, font: 'inherit',
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
                    {shown.map((r) => (
                      <tr
                        key={r.key}
                        data-selected={r.key === openKey}
                        data-ours={r.house !== null ? 'true' : 'false'}
                        tabIndex={0}
                        onClick={() => setOpenKey((k) => (k === r.key ? null : r.key))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setOpenKey((k) => (k === r.key ? null : r.key));
                          }
                        }}
                      >
                        <td>
                          <span className="cl-serif" style={{ display: 'block', fontWeight: 600, fontSize: 13.5 }}>
                            {r.name}
                          </span>
                          <span className="cl-dim" style={{ fontSize: 11 }}>
                            {r.producer ?? (r.house ? 'this house’s own line' : 'unattributed')}
                            {r.catalogue?.matchedBy === 'contains' ? ' · matched loosely' : ''}
                          </span>
                        </td>
                        <td><Books books={r.house?.books ?? []} /></td>
                        <td className="cl-num" style={{ textAlign: 'right' }}>
                          {shortDate(r.house?.bought?.first)}
                        </td>
                        <td className="cl-num" style={{ textAlign: 'right' }}>
                          {money(r.house?.bought?.paidTotal)}
                        </td>
                        <td className="cl-num" style={{ textAlign: 'right' }}>
                          {count(r.house?.poured?.qty ?? null)}
                        </td>
                        <td className="cl-num" style={{ textAlign: 'right' }}>
                          {money(r.house?.quoted?.lastPrice)}
                        </td>
                        <td>{r.catalogue?.beverageType ?? <span className="cl-dim">{EM}</span>}</td>
                        <td>
                          {[r.catalogue?.region, r.catalogue?.country].filter(Boolean).join(', ') || (
                            <span className="cl-dim">{EM}</span>
                          )}
                        </td>
                        <td className="cl-num" style={{ textAlign: 'right' }}>
                          {r.catalogue?.abvPct === null || r.catalogue?.abvPct === undefined
                            ? EM
                            : `${r.catalogue.abvPct}%`}
                        </td>
                        <td className="cl-num" style={{ textAlign: 'right' }}>
                          {volume(r.catalogue?.volumeMl)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <p className="cl-note" style={{ marginTop: 18 }}>
            {reg.scopeNote}
          </p>
        </>
      )}
    </div>
  );
}
