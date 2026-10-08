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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Select } from '@/components/mudavym';
import { DeliveriesToName } from '@/components/mudavym/DeliveriesToName';
import { readView, writeView, type IvView } from './iv-url';
import { StorageLocationManager } from '../../../components/inventory/StorageLocationManager';
import { PosMappingPanel } from '../../../components/inventory/PosMappingPanel';
import { MenuScannerFlow } from '../../../components/scanner/MenuScannerFlow';
import { summarizeMenuScanPersist } from '../../../lib/menuScannerPersistence';
import { exportTable, type TableExportColumn } from '../../../lib/tableExport';
import { fmtWhen } from '../../../lib/mudavym/format';
import { queryKeys } from '../../../lib/query-keys';
import { CellarMapView } from '../command/CellarMapView';
import type { InventoryItem as LegacyItem } from '../useInventoryPage';
import InventoryTable from './InventoryTable';
import { plainText } from './iv-failure';
import {
  CHIPS,
  chipMatch,
  EM,
  inZone,
  latestCount,
  noZoneWord,
  matchesSearch,
  ofType,
  ALL_WINE,
  typeLabel,
  readSentence,
  MAP_WORDS,
  mapTone,
  sortRows,
  sortWords,
  fmtCount,
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
        {invoices.capped ? `${fmtCount(invoices.n)} or more` : fmtCount(invoices.n)} invoice{invoices.n === 1 ? '' : 's'}{' '}
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
    toast.success(`Exported ${fmtCount(rows.length)} rows`);
  } catch (err) {
    // Only a sentence written for a person is shown (INV-W31).
    toast.error(err instanceof Error && plainText(err.message) ? err.message : 'The export could not be made.');
  }
}

/* ── the page ───────────────────────────────────────────────────────────── */

export default function InventoryNext() {
  const data = useInventoryNextData();
  const queryClient = useQueryClient();
  // INV-W38: the view is the URL (iv-url.ts), so a reload, Back or a sent
  // link keeps it, and the links other pages send here land where they say.
  const [params, setParams] = useSearchParams();
  const { chip, q: query, zone, type, sort, view, open: openParam } = useMemo(() => readView(params), [params]);
  const setV = useCallback(
    (patch: Partial<IvView>) => setParams((cur) => writeView(cur, { ...readView(cur), ...patch }), { replace: true }),
    [setParams],
  );
  const [panel, setPanel] = useState<null | 'scanner' | 'locations' | 'pos'>(null);
  // The delivered-order bell links to ?name-delivery=<order>; the card opens for it.
  const [naming, setNaming] = useState(() => params.has('name-delivery'));
  const searchRef = useRef<HTMLInputElement>(null);
  const toolsRef = useRef<HTMLElement>(null);
  const ladder = useLadder(data.state === 'reading');

  const rows = data.rows;
  const locs = data.locations;
  // ?highlight= may carry a wine id; the open row is always a row id.
  const openId = useMemo(() => {
    if (openParam === null || !rows) return openParam;
    return (rows.find((r) => r.id === openParam) ?? rows.find((r) => r.wineId === openParam))?.id ?? openParam;
  }, [openParam, rows]);
  // A title opened by a link is brought into view once, when its row is drawn.
  const linkedOpen = useRef(openParam);
  useEffect(() => {
    if (linkedOpen.current === null || openId === null || !rows?.some((r) => r.id === openId)) return;
    linkedOpen.current = null;
    document.getElementById(`iv-row-${openId}`)?.scrollIntoView?.({ block: 'center' });
  }, [openId, rows]);
  const zoneName = (id: string | null): string => {
    if (id === null) return 'Unassigned';
    // Failed or still reading: either way the names are unread, so "not on the list" would be a guess.
    if (locs.unavailable || locs.loading) return 'a zone (names unread)';
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

  // A chip whose count could not be read cannot hold the list (INV-W29).
  const activeChip: ChipId = chip === 'dead' && data.paceUnread ? 'all' : chip;
  const chipCounts = useMemo(() => {
    const now = Date.now();
    const m = new Map<ChipId, number>();
    for (const c of CHIPS) m.set(c.id, (rows ?? []).filter((r) => chipMatch(r, c.id, now)).length);
    return m;
  }, [rows]);
  const chipCount = (id: ChipId) => {
    const k = chipCounts.get(id);
    return k === undefined ? EM : fmtCount(k);
  };

  // INV-W30: wines first by style, then every other drink by its kind. The
  // shared Select has no option groups, so when the house holds more than
  // wine the group is said in the label ("Wine · Red") and one "All wine"
  // choice leads it; a house of wine alone keeps the plain style words.
  const typeOptions = useMemo(() => {
    const all = rows ?? [];
    const keys = (wine: boolean) =>
      [...new Set(all.filter((r) => (r.kind === 'wine') === wine).map((r) => r.type))]
        .filter((t): t is string => t !== null && t !== 'unclassified')
        .sort(); // keys are folded and lower-case, so key order is label order
    const wines = keys(true);
    const others = keys(false);
    const mixed = wines.length > 0 && others.length > 0;
    const wineWord = (t: string) =>
      t === 'wine' ? (mixed ? 'Wine · style not recorded' : 'Wine, style not recorded') : mixed ? `Wine · ${typeLabel(t)}` : typeLabel(t);
    const opts = [
      ...(mixed ? [{ value: ALL_WINE, label: 'All wine' }] : []),
      ...wines.map((t) => ({ value: t, label: wineWord(t) })),
      ...others.map((t) => ({ value: t, label: typeLabel(t) })),
    ];
    if (all.some((r) => r.type === 'unclassified')) opts.push({ value: 'unclassified', label: 'Not classified' });
    // With the library unread a missing type is unknown, not "not recorded" (INV-W28).
    if (data.libraryAnswered && all.some((r) => r.type === null)) opts.push({ value: 'none', label: 'Type not recorded' });
    return opts;
  }, [rows, data.libraryAnswered]);

  const visible = useMemo(() => {
    if (!rows) return [];
    const now = Date.now();
    const zn = (id: string | null) => (id === null ? 'Unassigned' : (locs.list.find((l) => l.id === id)?.name ?? null));
    return sortRows(
      rows.filter(
        (r) => chipMatch(r, activeChip, now) && inZone(r, zone) && ofType(r, type) && matchesSearch(r, query, zn),
      ),
      sort,
    );
  }, [rows, activeChip, zone, type, query, sort, locs.list]);

  const zoneUnread = zone !== '' ? (rows ?? []).filter((r) => r.zones === null).length : 0;
  const filtered = activeChip !== 'all' || zone !== '' || type !== '' || query.trim() !== '';
  /** The filters in force, named in the footer beside a way out (INV-W25). */
  const filterWords = [
    activeChip !== 'all' ? (CHIPS.find((c) => c.id === activeChip)?.label ?? null) : null,
    zone !== '' ? (zone === 'none' ? 'Unassigned' : (locs.list.find((l) => l.id === zone)?.name ?? 'a zone')) : null,
    type !== '' ? (typeOptions.find((o) => o.value === type)?.label ?? type) : null,
    query.trim() !== '' ? `“${query.trim()}”` : null,
  ]
    .filter((w): w is string => w !== null)
    .join(' · ');

  const clearFilters = () => {
    setV({ chip: 'all', zone: '', type: '', q: '' });
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
            if (first) return zoneName(first.locationId);
            if (r.zones.some((z) => z.qty > 0)) return 'Unassigned';
            return noZoneWord(r.stock) ?? '';
          },
        },
        { header: 'Title', value: (r) => r.name ?? '' },
        { header: 'Producer', value: (r) => r.producer ?? '' },
        { header: 'Vintage', value: (r) => blank(r.vintage) },
        { header: 'Type', value: (r) => (r.type === null ? '' : typeLabel(r.type)) },
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
    { header: 'Title', value: (r) => r.name ?? '' },
    { header: 'Producer', value: (r) => r.producer ?? '' },
    { header: 'Type', value: (r) => (r.type === null ? '' : typeLabel(r.type)) },
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

  const showTools = () => toolsRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });

  const nameable = useMemo(() => data.rawItems.map((i) => ({ inventoryId: i.id, name: i.wineName ?? null })), [data.rawItems]);

  const crumb = rows === null ? null : latestCount(rows);

  // The bell's older ?verify=<order> link: a delivery is checked at the door
  // now, on Receiving, which opens that order (ReceivingNext reads ?order=).
  const verifyOrder = params.get('verify');
  if (verifyOrder) return <Navigate to={`/receiving?order=${encodeURIComponent(verifyOrder)}`} replace />;

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
                  Carry one wine into the book with its first count. It is the wine register’s own “Bring into the
                  cellar”, and it makes one write. Other drinks come in from a scanned menu.
                </p>
                <Link to="/wines" className="iv-btn iv-focus">
                  Add a bottle
                </Link>
              </section>
              <section className="iv-card">
                <h3 className="iv-h3">Scan your menu</h3>
                <p className="iv-said">
                  Read your menu into the book. Each title comes in with no count until someone counts it. It is never
                  set to zero.
                </p>
                <button type="button" className="iv-btn iv-focus" onClick={() => setPanel('scanner')}>
                  Scan your menu
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
                c.id === 'dead' && data.paceUnread ? (
                  <button
                    key={c.id}
                    type="button"
                    className="iv-chip"
                    disabled
                    title="Whether a title is dead stock could not be read: the selling pace did not answer"
                  >
                    {c.label} <span className="iv-num">{EM}</span>
                  </button>
                ) : c.id === 'price' ? (
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
                    aria-pressed={activeChip === c.id}
                    data-on={activeChip === c.id}
                    onClick={() => setV({ chip: c.id })}
                  >
                    {c.label} <span className="iv-num">{chipCount(c.id)}</span>
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
                  onChange={(e) => setV({ q: e.target.value })}
                />
                <span className="iv-hint">
                  accents ignored<span className="iv-key"> · /</span>
                </span>
              </label>
              <Select
                label="Zone"
                value={zone}
                onChange={(v) => setV({ zone: v })}
                placeholder="All"
                disabled={locs.unavailable || locs.loading}
                options={[
                  ...locs.list.map((l) => ({ value: l.id, label: l.name })),
                  { value: 'none', label: 'Unassigned' },
                ]}
              />
              <Select
                label="Type"
                value={type}
                onChange={(v) => setV({ type: v })}
                placeholder="All"
                disabled={!data.libraryAnswered}
                options={typeOptions}
              />
              <Select
                label="Sort"
                value={sort}
                onChange={(v) => setV({ sort: (v || 'needs') as SortId })}
                options={[
                  { value: 'needs', label: 'Needs you first' },
                  { value: 'name', label: 'Name' },
                  { value: 'value', label: 'Value at cost' },
                ]}
              />
              <span className="iv-toggle" role="group" aria-label="View">
                <button type="button" className="iv-btn iv-focus" aria-pressed={view === 'table'} data-on={view === 'table'} onClick={() => setV({ view: 'table' })}>
                  Table
                </button>
                <button type="button" className="iv-btn iv-focus" aria-pressed={view === 'map'} data-on={view === 'map'} onClick={() => setV({ view: 'map' })}>
                  Cellar map
                </button>
              </span>
              <button type="button" className="iv-btn iv-focus" onClick={showTools}>
                Tools
              </button>
              <Link to="/wines" className="iv-btn iv-focus" data-seal="true" title="Opens the wine register, where a wine is brought into the cellar. Other drinks come in from a scanned menu.">
                Add a bottle
              </Link>
            </div>
            {data.unread.length > 0 ? (
              <p className="iv-note" data-testid="inv-unread">
                {data.unread.length === 1 ? 'One read did not answer: ' : 'Some reads did not answer: '}
                {data.unread.join('; ')}.{' '}
                <button type="button" className="iv-linkish iv-focus" onClick={data.rereadUnread}>
                  Read again
                </button>
              </p>
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
                  onOpenInTable={(locationId) => setV({ zone: locationId, view: 'table' })}
                  onManageLocations={() => setPanel('locations')}
                  toneOf={mapTone}
                  toneWords={MAP_WORDS}
                />
              </div>
            ) : visible.length === 0 ? (
              <div className="iv-none" data-testid="inventory-none-match">
                <p className="iv-said">
                  No title matches {filtered ? 'this search and these filters' : 'here'}; {fmtCount(rows.length)}{' '}
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
                libraryUnread={!data.libraryAnswered}
                grouped={sort === 'needs'}
                openId={openId}
                onToggle={(id) => setV({ open: openId === id ? null : id })}
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
                  Scan a menu
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
                {/* INV-W18: "Export all locations" read every house from this one session; since
                    ADR 0164 a session reads only its own house, so it failed on the first other
                    house every time. A cross-house export is gateway work (F-10). */}
              </div>
              <p className="iv-note">
                Exports are CSV of the titles listed above. A figure that could not be read is left blank in the file,
                never written as 0.
              </p>
            </section>

            <p className="iv-footer" data-testid="inventory-footer">
              {visible.length === rows.length ? `All ${fmtCount(rows.length)}` : fmtCount(visible.length)} of {fmtCount(rows.length)} titles are
              listed{filterWords ? ` (${filterWords})` : ''}, {sortWords(sort, visible)}.
              {filtered && visible.length > 0 ? (
                <>
                  {' '}
                  <button type="button" className="iv-linkish iv-focus" onClick={clearFilters}>
                    Clear the filters
                  </button>
                  <br />
                </>
              ) : null}
              {data.currency.state === 'recorded' ? ` Money is shown in the house’s currency, ${data.currency.code}.` : ''}{' '}
              Market reads — in every title's details because this page does not read a market price yet.
              {data.unread.length > 0 || data.stale
                ? ' Not every read answered; each one that did not is named above the table.'
                : data.pending.length > 0
                  ? ` Still reading: ${data.pending.join(', ')}.`
                  : ' Every figure on this page was read.'}{' '}
              A figure the house could not read is —, never 0, and nothing on this page is a default.
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
            setV({ zone: location.id, view: 'table' });
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
