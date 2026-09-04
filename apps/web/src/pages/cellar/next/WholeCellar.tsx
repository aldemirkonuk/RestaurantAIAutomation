/**
 * THE WHOLE CELLAR AT ONCE — direction B, built, on the parent.
 *
 * The founder: *"We show more general columns when they want to see the whole
 * menu inventories at once right? research on what are them."* and, of the two
 * sketched directions, *"Both the direction A and B look great in their own
 * fields, research on it try to merge those two."*
 *
 * WHAT B CONTRIBUTED, AND WHAT IT COST. B's idea is that a whisky, a keg and a
 * Burgundy belong in one list with the kind as a facet, because that is what
 * "see everything" literally means. Its cost, stated in its own sketch, is one
 * row grammar for three kinds of thing — which is the thing the four-child IA
 * was chosen to avoid. The merge is therefore NOT "replace the registers with
 * one table". It is: the registers stay as the place a kind is worked, and this
 * is the place the whole book is READ, with only the columns that mean the same
 * thing everywhere (`cellar-columns.ts` → WHOLE_CELLAR_COLUMNS).
 *
 * WHY `On hand` IS NOT A COLUMN HERE. It is real for wines and structurally
 * absent for the other six — `restaurant_inventory` is keyed on
 * `master_wine_id` (OD-113) — so as a general column it would be an em dash on
 * most of the page. The section says that once, in a sentence, instead of
 * drawing a column of nothing.
 */

import { useMemo, useState } from 'react';
import { AlertTriangle, LayoutList } from 'lucide-react';
import ColumnMenu from './ColumnMenu';
import SeriesPanel from './SeriesPanel';
import { REGISTER_TITLE, count, type RegisterId } from './cellar-format';
import { WHOLE_CELLAR_COLUMNS, type CellarColumn } from './cellar-columns';
import { cellFor, sortValueFor } from './registerCells';
import { useRowRecord, useWholeCellar, type WholeRowVM } from './useCellarNextData';

function valueFor(r: WholeRowVM, id: string): string | number | null {
  if (id === 'register') return REGISTER_TITLE[r.register].toLowerCase();
  return sortValueFor(r, id);
}

export default function WholeCellar({ carried }: { carried: RegisterId[] | null }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [facet, setFacet] = useState<RegisterId | 'all'>('all');
  const [sortKey, setSortKey] = useState<string>('books');
  const [asc, setAsc] = useState(false);
  const [menu, setMenu] = useState<{ column: CellarColumn; x: number; y: number } | null>(null);
  const [series, setSeries] = useState<{ label: string; column: CellarColumn } | null>(null);

  const whole = useWholeCellar(open, carried);
  const record = useRowRecord(series?.label ?? null);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = whole.rows.filter((r) => {
      if (facet !== 'all' && r.register !== facet) return false;
      if (!q) return true;
      return [r.name, r.producer, REGISTER_TITLE[r.register]]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
    return rows.sort((a, z) => {
      const av = valueFor(a, sortKey);
      const zv = valueFor(z, sortKey);
      if (av === null && zv === null) return a.name.localeCompare(z.name);
      if (av === null) return 1;
      if (zv === null) return -1;
      const c =
        typeof av === 'number' && typeof zv === 'number'
          ? av - zv
          : String(av).localeCompare(String(zv));
      return asc ? c : -c;
    });
  }, [whole.rows, query, facet, sortKey, asc]);

  const facets = useMemo(
    () => (carried ?? []).filter((r) => r !== 'wines'),
    [carried],
  );

  return (
    <section style={{ marginTop: 26 }} data-testid="whole-cellar">
      <h2 className="cl-sec">Everything at once</h2>

      {!open ? (
        <>
          <p className="cl-said">
            One flat book across every register this house carries, with only the
            columns that mean the same thing in all of them — what we list it at,
            what we have paid, what the till sold and took, and who quoted it
            last.
          </p>
          <button
            type="button"
            className="cl-btn cl-focus"
            onClick={() => setOpen(true)}
            data-testid="whole-cellar-open"
          >
            <LayoutList size={13} aria-hidden style={{ verticalAlign: '-2px', marginRight: 5 }} />
            Open the whole cellar
            {facets.length > 0 ? ` (${facets.length} reads)` : ''}
          </button>
          <p className="cl-note">
            Not read on page load: this is one request per register, and a page
            does not spend that on somebody who came to look at one card.
          </p>
        </>
      ) : (
        <>
          <div className="cl-row-controls">
            <label htmlFor="cl-whole-search" className="cl-sr">
              Search the whole cellar
            </label>
            <input
              id="cl-whole-search"
              className="cl-field cl-focus"
              type="search"
              placeholder="Search every register…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ flex: '1 1 220px', minWidth: 200 }}
            />
            <label htmlFor="cl-whole-facet" className="cl-sr">
              Register
            </label>
            <select
              id="cl-whole-facet"
              className="cl-field cl-focus"
              value={facet}
              onChange={(e) => setFacet(e.target.value as RegisterId | 'all')}
            >
              <option value="all">Every register</option>
              {facets.map((r) => (
                <option key={r} value={r}>
                  {REGISTER_TITLE[r]}
                </option>
              ))}
            </select>
            <span className="cl-dim" style={{ fontSize: 12, marginLeft: 'auto' }}>
              {count(shown.length)} of {count(whole.rows.length)}
            </span>
          </div>

          {whole.loading ? (
            <p className="cl-said" role="status" data-testid="whole-loading">
              Reading every register this house carries…
            </p>
          ) : null}

          {whole.partial ? (
            <p className="cl-said" role="alert" data-testid="whole-partial">
              <AlertTriangle size={13} aria-hidden style={{ verticalAlign: '-2px', marginRight: 5 }} />
              {whole.reads
                .filter((r) => r.error !== null)
                .map((r) => `${REGISTER_TITLE[r.register]} could not be read (${r.error})`)
                .join('; ')}
              . Those registers are missing from the list below — it is short by
              an unknown amount, not complete.
            </p>
          ) : null}

          {shown.length === 0 && !whole.loading ? (
            <p className="cl-said cl-dim" data-testid="whole-empty">
              No row in any of this house’s registers matches this reading.
            </p>
          ) : (
            <div style={{ overflowX: 'auto', border: '1px solid var(--paper-2)', borderRadius: 10 }}>
              <table className="cl-table">
                <thead>
                  <tr>
                    {WHOLE_CELLAR_COLUMNS.map((c) => (
                      <th
                        key={c.id}
                        style={{ textAlign: c.kind === 'figure' ? 'right' : 'left' }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setMenu({ column: c, x: e.clientX, y: e.clientY });
                        }}
                      >
                        <button
                          type="button"
                          className="cl-focus"
                          onClick={() => {
                            if (c.id === sortKey) setAsc((v) => !v);
                            else {
                              setSortKey(c.id);
                              setAsc(c.kind === 'word');
                            }
                          }}
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
                  {shown.map((r) => (
                    <tr key={`${r.register}:${r.key}`} tabIndex={0}>
                      {WHOLE_CELLAR_COLUMNS.map((c) => (
                        <td
                          key={c.id}
                          className={c.kind === 'figure' ? 'cl-num' : undefined}
                          style={{ textAlign: c.kind === 'figure' ? 'right' : 'left' }}
                          data-series={c.series !== null ? 'true' : undefined}
                          onDoubleClick={() =>
                            c.series !== null && setSeries({ label: r.name, column: c })
                          }
                          onContextMenu={(e) => {
                            if (c.series === null) return;
                            e.preventDefault();
                            setSeries({ label: r.name, column: c });
                          }}
                        >
                          {c.id === 'register' ? REGISTER_TITLE[r.register] : cellFor(r, c.id)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="cl-note">
            Wines are not in this list. `/wines` is served by a different read
            with the cellar laid over it, so a wine row carries a stock figure
            and a beer row cannot — putting them in one table would mean one of
            the two columns lying. Nothing here can be counted into the cellar
            either: `restaurant_inventory` is keyed on the wine library, which is
            OD-113.
          </p>

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
              onOpenSeries={null}
              onHide={null}
              onClose={() => setMenu(null)}
            />
          ) : null}
        </>
      )}
    </section>
  );
}
