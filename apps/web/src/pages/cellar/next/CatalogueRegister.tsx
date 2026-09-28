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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, BookOpen, ChevronDown, Search } from 'lucide-react';
import { animate, turn } from '../../../lib/mudavym/motion';
import CocktailRegister from './CocktailRegister';
import ColumnMenu from './ColumnMenu';
import HouseRecordLeaf from './HouseRecordLeaf';
import RegisterNotice from './NeedsItemsNotice';
import RegisterEvidenceLine from './RegisterEvidenceLine';
import RowExpander from './RowExpander';
import SeriesPanel from './SeriesPanel';
import {
  BOOK_LABEL,
  BOOK_ORDER,
  REGISTER_TITLE,
  count,
  noHouseRowsLine,
  type HouseBookId,
  type RegisterId,
} from './cellar-format';
import { houseNamingFor } from './cellar-format';
import { columnsFor, type CellarColumn } from './cellar-columns';
import { cellFor, sortValueFor } from './registerCells';
import { REGISTER_SOURCE } from './registerShapes';
import {
  useRegister,
  useRowRecord,
  type CellarData,
  type RegisterVM,
} from './useCellarNextData';

type Scope = 'all' | 'ours' | 'catalogue';
type MatchFilter = 'all' | 'exact' | 'contains' | 'none';

/** Where a column menu was opened from, so it can be drawn there. */
interface MenuAt {
  column: CellarColumn;
  x: number;
  y: number;
}

/** Which cell's series is open: one row, one column. */
interface OpenSeries {
  label: string;
  column: CellarColumn;
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
  // The parent's own name, not the literal "The Cellar": a house that pours no
  // wine reads "Drinks · register" here, because a breadcrumb that disagrees
  // with the page it points at is the same lie the root fix removed.
  const naming = houseNamingFor(readout);
  return (
    <>
      <p className="cl-crumb">
        <Link to="/cellar" className="cl-focus">{naming.name}</Link> · register
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
  const [sortKey, setSortKey] = useState<string>('books');
  const [asc, setAsc] = useState(false);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<MenuAt | null>(null);
  const [series, setSeries] = useState<OpenSeries | null>(null);
  const leafRef = useRef<HTMLDivElement | null>(null);

  // The column vocabulary for THIS register. Columns whose source has no
  // writer are off by default and offered from the header menu with the
  // measured reason beside them — never drawn as a file of em dashes.
  const vocabulary = useMemo(() => columnsFor(id), [id]);
  const columns = useMemo(
    () => vocabulary.filter((c) => (c.on && !hidden.has(c.id)) || (!c.on && hidden.has(`show:${c.id}`))),
    [vocabulary, hidden],
  );

  const register = useRegister(id);
  const reg = register.data;

  // One read serves both the expanded row and the series a cell opens, because
  // both are the same question about the same line. Opening a row therefore
  // costs one request, and opening a cell on that row costs none.
  const openedRow = (reg?.rows ?? []).find((r) => r.key === openKey) ?? null;
  const record = useRowRecord(series?.label ?? openedRow?.name ?? null);

  const openSeriesFor = useCallback((label: string, column: CellarColumn) => {
    // A column with no series does not open one; the header menu says so
    // rather than opening an empty panel that looks like a failure.
    if (column.series === null) return;
    setSeries({ label, column });
    setMenu(null);
  }, []);

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
      const av = sortValueFor(a, sortKey);
      const zv = sortValueFor(z, sortKey);
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

  const toggleSort = (k: string) => {
    if (k === sortKey) setAsc((v) => !v);
    else {
      setSortKey(k);
      // Words read forwards, figures read biggest-first: the answer somebody
      // sorting by Paid wants is the most expensive line, not the cheapest.
      const col = vocabulary.find((c) => c.id === k);
      setAsc(col?.kind === 'word');
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
                      {columns.map((c) => (
                        <th
                          key={c.id}
                          style={{ textAlign: c.kind === 'figure' ? 'right' : 'left' }}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            setMenu({ column: c, x: e.clientX, y: e.clientY });
                          }}
                        >
                          <span
                            style={{
                              display: 'inline-flex',
                              gap: 3,
                              alignItems: 'center',
                              flexDirection: c.kind === 'figure' ? 'row-reverse' : 'row',
                            }}
                          >
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
                              {sortKey === c.id ? (asc ? ' \u25B2' : ' \u25BC') : ''}
                            </button>
                            {/* Right-click's keyboard- and touch-reachable twin.
                                Right-click alone would put the column's own
                                account behind a gesture a keyboard cannot make. */}
                            <button
                              type="button"
                              className="cl-caret cl-focus"
                              aria-haspopup="menu"
                              aria-label={`What ${c.label} is, and how to sort it`}
                              onClick={(e) => {
                                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                setMenu({ column: c, x: r.left, y: r.bottom + 4 });
                              }}
                            >
                              <ChevronDown size={11} aria-hidden />
                            </button>
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {shown.flatMap((r) => [
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
                        {columns.map((c) => (
                          <td
                            key={c.id}
                            className={c.kind === 'figure' ? 'cl-num' : undefined}
                            style={{ textAlign: c.kind === 'figure' ? 'right' : 'left' }}
                            data-series={c.series !== null ? 'true' : undefined}
                            title={
                              c.series === null
                                ? undefined
                                : `Double-click for ${c.label.toLowerCase()} — the whole record behind this line`
                            }
                            onDoubleClick={(e) => {
                              e.stopPropagation();
                              openSeriesFor(r.name, c);
                            }}
                            onContextMenu={(e) => {
                              if (c.series === null) return;
                              e.preventDefault();
                              e.stopPropagation();
                              openSeriesFor(r.name, c);
                            }}
                          >
                            {cellFor(r, c.id)}
                          </td>
                        ))}
                      </tr>,
                      r.key === openKey ? (
                        /* THE DROPDOWN THE FOUNDER NAMED. `/inventory`'s row
                           expansion opens IN PLACE and "shows everything you
                           need to see" (MAKEOVER-VERDICTS.md:66-72); this is
                           that shape, with the cards this register's books can
                           actually fill and the two it cannot drawn as
                           withheld rather than dropped. */
                        <tr key={`${r.key}-open`} className="cl-openrow">
                          <td colSpan={columns.length}>
                            <div ref={leafRef}>
                              <RowExpander
                                row={r}
                                register={id}
                                record={record.data}
                                loading={record.loading}
                                error={record.error}
                                stockingReason={reg.stocking.reason}
                                onOpenSeries={(b) => {
                                  const col =
                                    vocabulary.find((c) => c.series === b) ?? null;
                                  if (col !== null) openSeriesFor(r.name, col);
                                }}
                              />
                              <HouseRecordLeaf
                                row={r}
                                stockingReason={reg.stocking.reason}
                                onClose={() => setOpenKey(null)}
                              />
                            </div>
                          </td>
                        </tr>
                      ) : null,
                    ])}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── the series behind a cell: the graph, then the ledger ─────── */}
          {series !== null ? (
            <div style={{ marginTop: 16 }}>
              <SeriesPanel
                label={series.label}
                columnLabel={series.column.label}
                columnId={series.column.id}
                book={series.column.series}
                record={record.data}
                loading={record.loading}
                error={record.error}
                onClose={() => setSeries(null)}
              />
            </div>
          ) : null}

          {menu !== null ? (
            <ColumnMenu
              column={menu.column}
              at={{ x: menu.x, y: menu.y }}
              sorted={sortKey === menu.column.id ? (asc ? 'asc' : 'desc') : null}
              onSort={(dir) => {
                setSortKey(menu.column.id);
                setAsc(dir === 'asc');
                setMenu(null);
              }}
              onOpenSeries={
                menu.column.series !== null && open !== null
                  ? () => openSeriesFor(open.name, menu.column)
                  : null
              }
              onHide={
                menu.column.on
                  ? () => {
                      setHidden((h) => new Set([...h, menu.column.id]));
                      setMenu(null);
                    }
                  : null
              }
              onClose={() => setMenu(null)}
            />
          ) : null}

          {/* Columns this register knows about and does not draw, each with the
              measured reason. An operator can turn one on and get the em dash
              WITH its explanation — which is a decision, not a blank cell. */}
          {vocabulary.some((c) => !columns.includes(c)) ? (
            <details className="cl-more" data-testid="register-more-columns">
              <summary className="cl-focus">
                Columns not drawn ({vocabulary.length - columns.length})
              </summary>
              <ul style={{ margin: '8px 0 0', paddingLeft: 16 }}>
                {vocabulary
                  .filter((c) => !columns.includes(c))
                  .map((c) => (
                    <li key={c.id} style={{ marginBottom: 6 }}>
                      <button
                        type="button"
                        className="cl-btn cl-focus"
                        onClick={() =>
                          setHidden((h) => {
                            const next = new Set(h);
                            next.delete(c.id);
                            if (!c.on) next.add(`show:${c.id}`);
                            return next;
                          })
                        }
                      >
                        {c.label}
                      </button>{' '}
                      <span className="cl-dim" style={{ fontSize: 11.5 }}>
                        {c.why || `Hidden by you. ${c.meaning}`}
                        {c.fill ? ` (${c.fill})` : ''}
                      </span>
                    </li>
                  ))}
              </ul>
            </details>
          ) : null}

          <p className="cl-note" style={{ marginTop: 18 }}>
            {reg.scopeNote}
          </p>
        </>
      )}
    </div>
  );
}
