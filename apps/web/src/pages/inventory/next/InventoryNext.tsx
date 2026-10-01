/**
 * /inventory, reworked — sketch INV-W4 (approved 2026-10-01), on the
 * makeover-B "Editorial" base the founder picked (inventory.md §14 INV-W4,
 * §15 "Build rulings").
 *
 * /inventory vs /cellar, in one sentence: /inventory is every title on the
 * books and the truth of its stock; /cellar is what the house pours. They
 * share the velocity helpers, the order ceremony and the bring-in sheet
 * rather than keeping two copies.
 *
 * THE TOP IS ONE SENTENCE AND ONE ROW OF CHIPS. No KPI tiles: at 7pm the first
 * thing a manager needs — what is out — has to be above the fold, so the
 * chrome is capped and the table sorts by severity (dossier E §1).
 *
 * FOUR STATES, NEVER BLURRED (ADRs 0020, 0067, 0149):
 *  - reading  — nothing for 400ms, then "Reading the cellar…", then after 12s
 *               "Still reading…" (the HousePageLoader ladder);
 *  - failed   — "The stock could not be read." and nothing else is claimed;
 *  - empty    — the read answered with no titles: the first-steps card;
 *  - ready    — the book.
 * A figure that is pending or failed is "—", never 0.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Select } from '@/components/mudavym';
import { DeliveriesToName } from '@/components/mudavym/DeliveriesToName';
import { StorageLocationManager } from '../../../components/inventory/StorageLocationManager';
import { PosMappingPanel } from '../../../components/inventory/PosMappingPanel';
import { MenuScannerFlow } from '../../../components/scanner/MenuScannerFlow';
import { summarizeMenuScanPersist } from '../../../lib/menuScannerPersistence';
import { exportTable, type TableExportColumn } from '../../../lib/tableExport';
import { fmtWhen } from '../../../lib/mudavym/format';
import { queryKeys } from '../../../lib/query-keys';
import { getInventory } from '../../../services/api/inventory';
import { CellarMapView } from '../command/CellarMapView';
import type { InventoryItem as LegacyItem } from '../useInventoryPage';
import InventoryTable from './InventoryTable';
import {
  CHIPS,
  chipMatch,
  EM,
  inZone,
  latestCount,
  matchesSearch,
  ofType,
  readSentence,
  sortRows,
  toRow,
  useInventoryNextData,
  type ChipId,
  type InvRow,
  type SortId,
  type Waiting,
} from './useInventoryNextData';
import './inventory-next.css';

const SANS = "'DM Sans', system-ui, sans-serif";
const MARK_AFTER_MS = 400;
const SLOW_AFTER_MS = 12_000;

/** The HousePageLoader ladder (HousePageLoader.tsx:21-37), for a read rather than a chunk. */
function useLadder(active: boolean): 'silent' | 'reading' | 'slow' {
  const [stage, setStage] = useState<'silent' | 'reading' | 'slow'>('silent');
  useEffect(() => {
    if (!active) {
      setStage('silent');
      return;
    }
    const a = setTimeout(() => setStage('reading'), MARK_AFTER_MS);
    const b = setTimeout(() => setStage('slow'), SLOW_AFTER_MS);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, [active]);
  return stage;
}

function Headline() {
  return (
    <h1 className="iv-h1" data-testid="inventory-headline">
      Inventory<span style={{ color: 'var(--seal)' }}>.</span>
    </h1>
  );
}

/* ── the quiet line ─────────────────────────────────────────────────────── */

function QuietLine({
  invoices,
  deliveries,
  outbox,
  onName,
  naming,
}: {
  invoices: Waiting;
  deliveries: Waiting;
  outbox: Waiting;
  onName: () => void;
  naming: boolean;
}) {
  const bits: JSX.Element[] = [];
  if (invoices.n !== null && invoices.n > 0) {
    bits.push(
      <span key="inv">
        {invoices.capped ? `${invoices.n} or more` : invoices.n} invoice{invoices.n === 1 ? '' : 's'}{' '}
        {invoices.n === 1 ? 'waits' : 'wait'} for a match ·{' '}
        <Link to="/receipts" className="iv-linkish iv-focus">
          Open in Receipts
        </Link>
      </span>,
    );
  } else if (invoices.failed) {
    bits.push(<span key="inv">Whether invoices wait for a match could not be read.</span>);
  }
  if (deliveries.n !== null && deliveries.n > 0) {
    bits.push(
      <span key="del">
        {deliveries.n} delivered line{deliveries.n === 1 ? '' : 's'} {deliveries.n === 1 ? 'waits' : 'wait'} for
        {deliveries.n === 1 ? ' its' : ' their'} item ·{' '}
        <button type="button" className="iv-linkish iv-focus" aria-expanded={naming} onClick={onName}>
          {naming ? 'Hide' : 'Name them'}
        </button>
      </span>,
    );
  } else if (deliveries.failed) {
    bits.push(<span key="del">Whether delivered lines wait for their item could not be read.</span>);
  }
  if (outbox.n !== null && outbox.n > 0) {
    bits.push(
      <span key="out">
        {outbox.n} spot count{outbox.n === 1 ? '' : 's'} {outbox.n === 1 ? 'waits' : 'wait'} on this device; queued is
        never confirmed
      </span>,
    );
  } else if (outbox.failed) {
    bits.push(<span key="out">The counts held on this device could not be read.</span>);
  }
  if (bits.length === 0) return null;
  return (
    <p className="iv-quiet" role="status" data-testid="inventory-quiet-line">
      {bits.map((b, i) => (
        <span key={i} className="iv-quiet-bit">
          {b}
        </span>
      ))}
    </p>
  );
}

/* ── exports ────────────────────────────────────────────────────────────── */

function blank(v: number | null): number | string {
  return v === null ? '' : v;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function runExport<T>(rows: T[], columns: TableExportColumn<T>[], filename: string, title: string) {
  try {
    await exportTable({ format: 'csv', rows, columns, filename, title });
    toast.success(`Exported ${rows.length} rows`);
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'The export failed');
  }
}

/* ── the page ───────────────────────────────────────────────────────────── */

export default function InventoryNext() {
  const data = useInventoryNextData();
  const queryClient = useQueryClient();
  const [chip, setChip] = useState<ChipId>('all');
  const [query, setQuery] = useState('');
  const [zone, setZone] = useState('');
  const [type, setType] = useState('');
  const [sort, setSort] = useState<SortId>('needs');
  const [view, setView] = useState<'table' | 'map'>('table');
  const [openId, setOpenId] = useState<string | null>(null);
  const [panel, setPanel] = useState<null | 'scanner' | 'locations' | 'pos'>(null);
  const [naming, setNaming] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const toolsRef = useRef<HTMLElement>(null);
  const ladder = useLadder(data.state === 'reading');

  const rows = data.rows;
  const locs = data.locations;
  const zoneName = (id: string | null): string => {
    if (id === null) return 'Unassigned';
    if (locs.unavailable) return 'a zone (names unread)';
    return locs.list.find((l) => l.id === id)?.name ?? 'a zone not on the list';
  };

  // "/" jumps to search, as the legacy page and the sketch's key line have it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const chipCounts = useMemo(() => {
    const now = Date.now();
    const m = new Map<ChipId, number>();
    for (const c of CHIPS) m.set(c.id, (rows ?? []).filter((r) => chipMatch(r, c.id, now)).length);
    return m;
  }, [rows]);

  const typeOptions = useMemo(() => {
    const types = [...new Set((rows ?? []).map((r) => r.type).filter((t): t is string => t !== null))].sort();
    const opts = types.map((t) => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1) }));
    if ((rows ?? []).some((r) => r.type === null)) opts.push({ value: 'none', label: 'Type not recorded' });
    return opts;
  }, [rows]);

  const visible = useMemo(() => {
    if (!rows) return [];
    const now = Date.now();
    const zn = (id: string | null) => (id === null ? 'Unassigned' : (locs.list.find((l) => l.id === id)?.name ?? null));
    return sortRows(
      rows.filter(
        (r) => chipMatch(r, chip, now) && inZone(r, zone) && ofType(r, type) && matchesSearch(r, query, zn),
      ),
      sort,
    );
  }, [rows, chip, zone, type, query, sort, locs.list]);

  const zoneUnread = zone !== '' ? (rows ?? []).filter((r) => r.zones === null).length : 0;
  const filtered = chip !== 'all' || zone !== '' || type !== '' || query.trim() !== '';

  const clearFilters = () => {
    setChip('all');
    setZone('');
    setType('');
    setQuery('');
  };

  const refreshStock = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.inventory.all });
  };

  const exportCountSheet = () =>
    runExport<InvRow>(
      visible,
      [
        {
          header: 'Location',
          value: (r) => {
            if (r.zones === null) return '';
            const first = r.zones.find((z) => z.locationId !== null && z.qty > 0);
            return first ? zoneName(first.locationId) : 'Unassigned';
          },
        },
        { header: 'Wine', value: (r) => r.name ?? '' },
        { header: 'Producer', value: (r) => r.producer ?? '' },
        { header: 'Vintage', value: (r) => blank(r.vintage) },
        { header: 'Type', value: (r) => r.type ?? '' },
        { header: 'Bottle size (ml)', value: (r) => blank(r.bottleSizeMl) },
        { header: 'System qty (live)', value: (r) => blank(r.stock) },
        { header: 'System qty (shadow)', value: (r) => blank(r.shadow) },
        { header: 'Par', value: (r) => blank(r.par) },
        { header: 'Counted qty', value: () => '' },
        { header: 'Variance', value: () => '' },
        { header: 'Last counted', value: (r) => r.lastCountedAt ?? '' },
      ],
      `inventory-count-${today()}`,
      'Inventory count sheet',
    );

  const valuationColumns: TableExportColumn<InvRow>[] = [
    { header: 'Wine', value: (r) => r.name ?? '' },
    { header: 'Producer', value: (r) => r.producer ?? '' },
    { header: 'Type', value: (r) => r.type ?? '' },
    { header: 'Live', value: (r) => blank(r.stock) },
    { header: 'Shadow', value: (r) => blank(r.shadow) },
    { header: 'Par', value: (r) => blank(r.par) },
    { header: 'Velocity/day', value: (r) => (r.velocity === null ? '' : r.velocity.toFixed(2)) },
    { header: 'Runway d', value: (r) => (r.runway === null ? '' : Math.round(r.runway)) },
    { header: 'WAC', value: (r) => blank(r.wac) },
    { header: 'Your bottle price', value: (r) => blank(r.bottle) },
    { header: 'Your glass price', value: (r) => blank(r.glass) },
    { header: 'Value at cost', value: (r) => (r.value === null ? '' : r.value.toFixed(2)) },
    { header: 'Currency', value: () => data.currency.code ?? '' },
  ];

  const exportValuation = () =>
    runExport(visible, valuationColumns, `inventory-valuation-${today()}`, 'Inventory valuation');

  const exportAllLocations = async () => {
    try {
      const merged: { branch: string; row: InvRow }[] = [];
      for (const branch of data.branches) {
        const items = await getInventory(branch.id);
        for (const item of items) merged.push({ branch: branch.name, row: toRow(item) });
      }
      await exportTable({
        format: 'csv',
        rows: merged,
        columns: [
          { header: 'Location', value: (m) => m.branch },
          ...valuationColumns.map((c) => ({ header: c.header, value: (m: { row: InvRow }) => c.value(m.row) })),
        ],
        filename: `inventory-all-locations-${today()}`,
        title: 'Inventory valuation — all locations',
      });
      toast.success(`Exported ${merged.length} rows across ${data.branches.length} locations`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The export failed');
    }
  };

  const showTools = () => toolsRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });

  const nameable = useMemo(() => data.rawItems.map((i) => ({ inventoryId: i.id, name: i.wineName ?? null })), [data.rawItems]);

  const crumb = rows === null ? null : latestCount(rows);

  return (
    <div className="mudavym iv-page min-h-full" style={{ background: 'var(--paper-0)', color: 'var(--ink-1)', fontFamily: SANS }}>
      <div className="iv-wrap">
        <p className="iv-crumb">
          The cellar · Inventory
          {data.state === 'ready' && rows !== null
            ? crumb
              ? ` · last count ${fmtWhen(crumb)}`
              : ' · nothing counted yet'
            : ''}
        </p>
        <Headline />

        {data.state === 'reading' ? (
          <div role="status" aria-live="polite" data-testid="inventory-reading">
            {ladder === 'silent' ? null : (
              <p className="iv-said" style={{ marginTop: 8 }}>
                {ladder === 'slow' ? 'Still reading — this is taking longer than usual.' : 'Reading the cellar…'}
              </p>
            )}
          </div>
        ) : data.state === 'nohouse' ? (
          <p className="iv-said" role="status" style={{ marginTop: 8 }} data-testid="inventory-no-house">
            No restaurant is active on this account, so there is no building whose stock to read. The book is unread —
            not empty. Choose a branch, or ask an owner for access.
          </p>
        ) : data.state === 'failed' ? (
          <div role="alert" data-testid="inventory-failed">
            <p className="iv-lead">The stock could not be read.</p>
            <p className="iv-said">
              The stock list did not answer, so this page claims nothing: not zero titles, and not an empty cellar.
              {data.error ? ` (${data.error})` : ''}
            </p>
            <button type="button" className="iv-btn iv-focus" style={{ marginTop: 10 }} onClick={data.refetch}>
              Read again
            </button>
          </div>
        ) : rows !== null && rows.length === 0 ? (
          /* ── the empty house (sketch frame 2) ───────────────────────── */
          <div data-testid="inventory-empty">
            <p className="iv-lead">No bottles on the books yet.</p>
            <p className="iv-said">
              The cellar starts with its first evidence: a delivery at the door, or the invoice that came with it.
              Figures appear once there is something to count. Until then the page shows nothing it would have to state
              as zero.
            </p>
            <QuietLine {...data.waiting} naming={naming} onName={() => setNaming((v) => !v)} />
            {naming ? <DeliveriesToName items={nameable} /> : null}
            <section className="iv-card iv-card-lead">
              <h2 className="iv-h2">Receive a delivery or upload an invoice</h2>
              <p className="iv-said">
                Count the cases at the door, or photograph or forward the invoice. The bottles on it arrive as shadow
                stock, and they become live when someone counts them onto the shelf. Nothing enters the cellar without a
                person’s seal.
              </p>
              <div className="iv-row-controls">
                <Link to="/receiving" className="iv-btn iv-focus" data-seal="true">
                  Receive a delivery
                </Link>
                <Link to="/receiving" className="iv-btn iv-focus">
                  Upload an invoice
                </Link>
              </div>
              <p className="iv-note">An invoice is uploaded at the door of its delivery, on Receiving.</p>
            </section>
            <div className="iv-starts">
              <section className="iv-card">
                <h3 className="iv-h3">Add one bottle</h3>
                <p className="iv-said">
                  Carry one title into the book with its first count. It is the cellar’s own “Bring into the cellar”,
                  and it makes one write.
                </p>
                <Link to="/wines" className="iv-btn iv-focus">
                  Add a bottle
                </Link>
              </section>
              <section className="iv-card">
                <h3 className="iv-h3">Scan your wine list</h3>
                <p className="iv-said">
                  Read your list into the book. Each title comes in with no count until someone counts it. It is never
                  set to zero.
                </p>
                <button type="button" className="iv-btn iv-focus" onClick={() => setPanel('scanner')}>
                  Scan your wine list
                </button>
              </section>
            </div>
            <p className="iv-said">
              Want the rooms first?{' '}
              <button type="button" className="iv-linkish iv-focus" onClick={() => setPanel('locations')}>
                Set up storage locations
              </button>
              . Zones and racks are yours to name, and the page never invents one.
            </p>
          </div>
        ) : rows !== null ? (
          /* ── the book ───────────────────────────────────────────────── */
          <>
            <p className="iv-read" data-testid="inventory-read-sentence">
              {readSentence(rows, data.currency, !locs.unavailable)}
            </p>
            {data.stale ? (
              <p className="iv-note" role="status">
                The last re-read of the stock failed, so these figures are from the read before it.{' '}
                <button type="button" className="iv-linkish iv-focus" onClick={data.refetch}>
                  Read again
                </button>
              </p>
            ) : null}

            <div className="iv-chips" role="group" aria-label="Show only" data-testid="inventory-chips">
              {CHIPS.map((c) =>
                c.id === 'price' ? (
                  <button
                    key={c.id}
                    type="button"
                    className="iv-chip"
                    disabled
                    title="Price signals need a price feed, and none is read"
                  >
                    {c.label} <span className="iv-num">{EM}</span>
                  </button>
                ) : (
                  <button
                    key={c.id}
                    type="button"
                    className="iv-chip iv-focus"
                    aria-pressed={chip === c.id}
                    data-on={chip === c.id}
                    onClick={() => setChip(c.id)}
                  >
                    {c.label} <span className="iv-num">{chipCounts.get(c.id) ?? EM}</span>
                  </button>
                ),
              )}
            </div>

            <div className="iv-toolbar" data-testid="inventory-toolbar">
              <label className="iv-search">
                <span className="iv-sr">Search titles, producers, grapes</span>
                <input
                  ref={searchRef}
                  type="search"
                  className="iv-field iv-focus"
                  placeholder="Search titles, producers, grapes"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <span className="iv-hint">accents ignored · /</span>
              </label>
              <Select
                label="Zone"
                value={zone}
                onChange={setZone}
                placeholder="All"
                disabled={locs.unavailable || locs.loading}
                options={[
                  ...locs.list.map((l) => ({ value: l.id, label: l.name })),
                  { value: 'none', label: 'Unassigned' },
                ]}
              />
              <Select label="Type" value={type} onChange={setType} placeholder="All" options={typeOptions} />
              <Select
                label="Sort"
                value={sort}
                onChange={(v) => setSort((v || 'needs') as SortId)}
                options={[
                  { value: 'needs', label: 'Needs you first' },
                  { value: 'name', label: 'Name' },
                  { value: 'value', label: 'Value at cost' },
                ]}
              />
              <span className="iv-toggle" role="group" aria-label="View">
                <button type="button" className="iv-btn iv-focus" aria-pressed={view === 'table'} data-on={view === 'table'} onClick={() => setView('table')}>
                  Table
                </button>
                <button type="button" className="iv-btn iv-focus" aria-pressed={view === 'map'} data-on={view === 'map'} onClick={() => setView('map')}>
                  Cellar map
                </button>
              </span>
              <button type="button" className="iv-btn iv-focus" onClick={showTools}>
                Tools
              </button>
              <Link to="/wines" className="iv-btn iv-focus" data-seal="true" title="Opens the wine register, where a bottle is brought into the cellar">
                Add a bottle
              </Link>
            </div>
            {locs.unavailable ? (
              <p className="iv-note">The storage locations could not be read, so zones show — and the zone filter is off.</p>
            ) : null}

            <QuietLine {...data.waiting} naming={naming} onName={() => setNaming((v) => !v)} />
            {naming ? <DeliveriesToName items={nameable} /> : null}

            {view === 'map' ? (
              <div className="iv-map">
                <CellarMapView
                  items={visible.map(
                    (r) =>
                      ({
                        inventoryId: r.id,
                        name: r.name ?? 'Unnamed title',
                        liveStock: r.stock,
                        shadowStock: r.shadow,
                        threshold: r.par,
                        locations: r.zones ?? [],
                      }) as unknown as LegacyItem,
                  )}
                  locations={locs.list}
                  locationsLoading={locs.loading}
                  locationsUnavailable={locs.unavailable}
                  onOpenInTable={(locationId) => {
                    setZone(locationId);
                    setView('table');
                  }}
                  onManageLocations={() => setPanel('locations')}
                />
              </div>
            ) : visible.length === 0 ? (
              <div className="iv-none" data-testid="inventory-none-match">
                <p className="iv-said">
                  No title matches {filtered ? 'this search and these filters' : 'here'}; {rows.length}{' '}
                  {rows.length === 1 ? 'title is' : 'titles are'} on the books.
                </p>
                {filtered ? (
                  <button type="button" className="iv-btn iv-focus" onClick={clearFilters}>
                    Clear the filters
                  </button>
                ) : null}
              </div>
            ) : (
              <InventoryTable
                rows={visible}
                grouped={sort === 'needs'}
                openId={openId}
                onToggle={(id) => setOpenId((cur) => (cur === id ? null : id))}
                canManage={data.canManage}
                currency={data.currency}
                zoneName={zoneName}
                locations={locs.list}
                locationsUnavailable={locs.unavailable}
                providers={data.providers.list}
                providersError={data.providers.error}
                restaurantId={data.rid}
                advice={data.advice}
                onPriceChanged={() => {
                  refreshStock();
                  data.refetchAdvice();
                }}
              />
            )}
            {zoneUnread > 0 ? (
              <p className="iv-note">
                {zoneUnread} {zoneUnread === 1 ? 'title whose zones' : 'titles whose zones'} could not be read{' '}
                {zoneUnread === 1 ? 'is' : 'are'} not shown under this zone.
              </p>
            ) : null}

            {/* ── tools ──────────────────────────────────────────────── */}
            <section ref={toolsRef} id="iv-tools" className="iv-tools" aria-labelledby="iv-tools-h">
              <h2 id="iv-tools-h" className="iv-sec">
                Tools
              </h2>
              <div className="iv-row-controls">
                <button type="button" className="iv-btn iv-focus" onClick={() => setPanel('scanner')}>
                  Scan a wine list
                </button>
                <button type="button" className="iv-btn iv-focus" onClick={() => setPanel('locations')}>
                  Storage locations
                </button>
                <button type="button" className="iv-btn iv-focus" onClick={() => setPanel('pos')}>
                  Map POS buttons
                </button>
                <button type="button" className="iv-btn iv-focus" onClick={() => void exportCountSheet()}>
                  Export count sheet
                </button>
                <button type="button" className="iv-btn iv-focus" onClick={() => void exportValuation()}>
                  Export valuation
                </button>
                {data.branches.length > 1 ? (
                  <button type="button" className="iv-btn iv-focus" onClick={() => void exportAllLocations()}>
                    Export all locations
                  </button>
                ) : null}
              </div>
              <p className="iv-note">
                Exports are CSV of the titles listed above. A figure that could not be read is left blank in the file,
                never written as 0.
              </p>
            </section>

            <p className="iv-footer" data-testid="inventory-footer">
              {visible.length === rows.length ? `All ${rows.length}` : `${visible.length}`} of {rows.length} titles are
              listed{sort === 'needs' ? ', sorted Needs you first' : ''}.
              {data.currency.state === 'recorded' ? ` Money is shown in the house’s currency, ${data.currency.code}.` : ''}{' '}
              Market reads — on every line because no title here has a market price yet. Every figure on this page was
              read. A figure the house could not read is —, never 0, and nothing on this page is a default.
            </p>
          </>
        ) : null}
      </div>

      {/* ── panels reused from the legacy page ──────────────────────────── */}
      {panel === 'scanner' ? (
        <MenuScannerFlow
          isOpen
          onClose={() => setPanel(null)}
          restaurantId={data.rid ?? undefined}
          onWinesAdded={(_wines, result) => {
            if (result) toast.success(`Menu scan: ${summarizeMenuScanPersist(result)}`);
            refreshStock();
          }}
        />
      ) : null}
      {panel === 'locations' ? (
        <StorageLocationManager
          isOpen
          onClose={() => setPanel(null)}
          inventoryItems={(rows ?? []).map((r) => ({
            id: r.id,
            name: r.name ?? 'Unnamed title',
            producer: r.producer ?? '',
            liveStock: r.stock ?? undefined,
            shadowStock: r.shadow ?? undefined,
          }))}
          onSelectLocation={(location) => {
            setZone(location.id);
            setView('table');
            setPanel(null);
          }}
          onLocationsChange={(updated) => locs.setLocations(updated)}
        />
      ) : null}
      {panel === 'pos' ? (
        <PosMappingPanel
          isOpen
          onClose={() => setPanel(null)}
          restaurantId={data.rid ?? undefined}
          inventory={(rows ?? []).map((r) => ({
            id: r.id,
            wineName: r.name ?? undefined,
            bottleSizeMl: r.bottleSizeMl,
            pourSizeMl: r.pourMl,
          }))}
          onChanged={refreshStock}
        />
      ) : null}
    </div>
  );
}
