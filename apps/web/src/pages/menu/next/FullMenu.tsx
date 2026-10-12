/**
 * The Full menu (ADR 0340 rule 22; lane 7): every live kind of the house as
 * one document, in the house's order (default Drinks, Food, Desserts), each in
 * its own sections and order. The gateway composes it (`GET
 * /menus/:rid/full`, §F10); this file only lays it out and asks for changes.
 *
 * - Every member reads it with the prices they read on /menu (rule 23).
 * - An owner or a manager renames a section, moves a section among its
 *   siblings and moves a kind block, by drag (the browser's own, as the kind
 *   strip does) or by the Earlier / Later buttons, so a keyboard, a screen
 *   reader or a phone does it too. These are the edits rule 9 allows on a live
 *   menu; the gateway refuses anything else.
 * - 86 marks show on drink lines only; the gateway never marks a dish.
 * - Once a Food menu is live, legacy dishes on the Drinks menu are left off
 *   and a card says so, once per house on this device.
 * - Print is the browser's: a print stylesheet that prints only the document,
 *   headed "House copy — no allergen information".
 * - The last Full menu read is kept on this device (the read cache in
 *   `lib/offline-storage.ts`, cleared at sign-out) and shown, with its "as
 *   of" time, when a read fails.
 */
import { useState, type DragEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getFullMenu,
  kindName,
  renameMenuSection,
  reorderMenuSections,
  setMenuKindOrder,
  type FullMenu as FullMenuDoc,
  type FullMenuKind,
  type FullMenuSection,
  type MenuLine,
} from '../../../services/api/menus';
import { offlineStorage } from '../../../lib/offline-storage';
import { formatMoney } from '../../../lib/currency';
import { formatVenueTime } from '../../../lib/venueTime';
import { reasonOf } from './MenuVersions';

export const FULL_MENU_PRINT_LABEL = 'House copy — no allergen information';

/**
 * The read's key, under `['menu']`. Every change made on /menu to a line, a
 * price or a section refreshes it, so what shows here and what Print prints
 * are the menu as it now stands (F-1560).
 */
export const fullMenuKey = (house: string) => ['menu', 'full', house] as const;

const DRAG_TYPE = 'text/plain';

/** A refusal in words; a 403 here is about the Full menu, not choosing the current one. */
export function fullMenuReason(err: unknown): string {
  const status = (err as { response?: { status?: number } })?.response?.status;
  return status === 403 ? 'only an owner or a manager can change the full menu' : reasonOf(err);
}

/** The read-cache key of a house's last Full menu: one house never reads another's. */
export function fullMenuCacheKey(house: string): string {
  return `full-menu:${house}`;
}

/** What is kept on the device: the menu, and when the gateway read it. */
export interface KeptFullMenu {
  asOf: string;
  menu: FullMenuDoc;
}

/** What the page shows: the menu, and `asOf` when it is the copy kept on this device. */
export interface FullMenuRead {
  menu: FullMenuDoc;
  asOf: string | null;
  /** Why the live read failed, when the kept copy is shown. */
  failure: string | null;
}

/**
 * Reads the Full menu and keeps it on this device. When the read fails, the
 * copy kept last is shown with its "as of" time and the reason; with no copy
 * kept, the failure stands (never an empty menu).
 */
export async function loadFullMenu(house: string): Promise<FullMenuRead> {
  try {
    const menu = await getFullMenu(house);
    try {
      await offlineStorage.cacheEntity<KeptFullMenu>(fullMenuCacheKey(house), { asOf: menu.readAt, menu });
    } catch {
      // A copy not kept leaves the live read standing; the next read keeps it.
    }
    return { menu, asOf: null, failure: null };
  } catch (err) {
    let kept: KeptFullMenu | null = null;
    try {
      kept = await offlineStorage.getCachedEntity<KeptFullMenu>(fullMenuCacheKey(house));
    } catch {
      kept = null;
    }
    if (kept?.menu && kept.asOf) return { menu: kept.menu, asOf: kept.asOf, failure: fullMenuReason(err) };
    throw err;
  }
}

/** `list` with `item` moved one place earlier (-1) or later (+1); unchanged at an end. */
export function movedBy<T>(list: readonly T[], item: T, by: -1 | 1): T[] {
  const at = list.indexOf(item);
  const to = at + by;
  if (at === -1 || to < 0 || to >= list.length) return [...list];
  const out = [...list];
  out.splice(at, 1);
  out.splice(to, 0, item);
  return out;
}

/** `list` with `item` placed where `before` is (a drop on `before`). */
export function droppedOn<T>(list: readonly T[], item: T, before: T): T[] {
  if (item === before || !list.includes(item) || !list.includes(before)) return [...list];
  const out = list.filter((x) => x !== item);
  out.splice(out.indexOf(before), 0, item);
  return out;
}

/** The whole kind order with `kind` moved; kinds that are not live keep their places. */
export function kindOrderWith(order: readonly string[], liveOrder: readonly string[], next: readonly string[]): string[] {
  const queue = [...next];
  return order.map((k) => (liveOrder.includes(k) ? (queue.shift() ?? k) : k));
}

/** A line's price in words: a dish's price, else glass and bottle. */
export function linePriceWords(line: MenuLine, currency?: string | null): string {
  if (line.line_kind === 'dish' || (line.price != null && line.bottle_price == null && line.by_glass_price == null)) {
    return line.price == null ? '' : formatMoney(line.price, currency);
  }
  const parts: string[] = [];
  if (line.by_glass_price != null) parts.push(`glass ${formatMoney(line.by_glass_price, currency)}`);
  if (line.bottle_price != null) parts.push(`bottle ${formatMoney(line.bottle_price, currency)}`);
  return parts.join(' · ');
}

/**
 * "the copy kept on this device, as of Mon, Oct 12, 2:05 PM GMT+3": on the
 * house's clock (the zone the gateway sent with the copy), never the
 * device's; with no zone kept, the device's clock is named as such (F-1563).
 */
export function asOfWords(asOf: string, zone?: string | null): string {
  if (Number.isNaN(new Date(asOf).getTime())) return asOf;
  const at = formatVenueTime(asOf, zone ?? null);
  return at.inVenueZone ? at.text : `${at.text} on this device's clock`;
}

const DISMISS_KEY = (house: string) => `full-menu:dishes-card-dismissed:${house}`;

function readDismissed(house: string): boolean {
  try {
    return window.localStorage.getItem(DISMISS_KEY(house)) === '1';
  } catch {
    return false;
  }
}

function writeDismissed(house: string): void {
  try {
    window.localStorage.setItem(DISMISS_KEY(house), '1');
  } catch {
    // Not kept: the card shows again next time, which is harmless.
  }
}

/*
 * Only the document prints. Everything that neither holds it nor is in it is
 * taken out of the layout (display: none), and what holds it loses its own
 * spacing, so the rest of /menu adds no blank pages (F-1564). `visibility:
 * hidden` kept the hidden page's height and printed it as empty paper.
 */
export const PRINT_CSS = `
@media print {
  body *:not(:has(.fm-doc)):not(.fm-doc):not(.fm-doc *) { display: none !important; }
  body *:has(.fm-doc) { margin: 0 !important; padding: 0 !important; border: 0 !important; min-height: 0 !important; height: auto !important; overflow: visible !important; box-shadow: none !important; }
  .fm-doc { width: 100%; }
  .fm-noprint { display: none !important; }
  .fm-kind { break-inside: auto; page-break-before: auto; }
  .fm-section h4, .fm-section h5, .fm-section h6 { break-after: avoid; }
}
`;

function LineRow({ line, currency }: { line: MenuLine; currency?: string | null }) {
  const price = linePriceWords(line, currency);
  const detail = [line.producer, line.vintage].filter(Boolean).join(', ');
  return (
    <li data-testid="full-menu-line" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '3px 0' }}>
      <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
        {line.name}
        {detail ? <span className="cl-dim"> · {detail}</span> : null}
        {line.sold_out ? (
          <span className="cl-chip" data-testid="full-menu-sold-out" style={{ marginLeft: 6 }}>
            86&apos;d
          </span>
        ) : null}
        {line.sold_out_because?.length ? (
          <span className="cl-note" style={{ display: 'block' }}>
            {line.sold_out_because.join(', ')} {line.sold_out_because.length === 1 ? 'is' : 'are'} sold out (86)
          </span>
        ) : null}
      </span>
      <span style={{ whiteSpace: 'nowrap' }}>{price}</span>
    </li>
  );
}

function SectionBlock({
  section,
  siblings,
  depth,
  menuId,
  canEdit,
  busy,
  currency,
  onRename,
  onReorder,
}: {
  section: FullMenuSection
  siblings: FullMenuSection[]
  depth: number
  menuId: string
  canEdit: boolean
  busy: boolean
  currency?: string | null
  onRename: (menuId: string, sectionId: string, title: string) => void
  onReorder: (menuId: string, parentId: string | null, ids: string[]) => void
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(section.title);
  const ids = siblings.map((s) => s.id);
  const Heading = depth === 0 ? 'h4' : depth === 1 ? 'h5' : 'h6';
  const at = ids.indexOf(section.id);
  return (
    <div
      className="fm-section"
      data-testid="full-menu-section"
      style={{ marginTop: depth === 0 ? 14 : 8, paddingLeft: depth === 0 ? 0 : 12 }}
      draggable={canEdit && !busy && !editing}
      onDragStart={(e: DragEvent<HTMLDivElement>) => {
        e.stopPropagation();
        e.dataTransfer.setData(DRAG_TYPE, `section:${section.id}`);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDragOver={canEdit ? (e) => e.preventDefault() : undefined}
      onDrop={
        canEdit
          ? (e) => {
              const raw = e.dataTransfer.getData(DRAG_TYPE);
              if (!raw.startsWith('section:')) return;
              const id = raw.slice('section:'.length);
              if (!ids.includes(id) || id === section.id) return;
              e.preventDefault();
              e.stopPropagation();
              onReorder(menuId, section.parentId, droppedOn(ids, id, section.id));
            }
          : undefined
      }
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        {editing ? (
          <form
            className="fm-noprint"
            style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}
            onSubmit={(e) => {
              e.preventDefault();
              const t = title.trim();
              if (t && t !== section.title) onRename(menuId, section.id, t);
              setEditing(false);
            }}
          >
            <input aria-label={`New name for ${section.title}`} value={title} onChange={(e) => setTitle(e.target.value)} />
            <button type="submit" className="cl-btn cl-focus" disabled={!title.trim()}>
              Save
            </button>
            <button type="button" className="cl-btn cl-focus" onClick={() => { setTitle(section.title); setEditing(false); }}>
              Cancel
            </button>
          </form>
        ) : (
          <Heading className="cl-crumb" style={{ margin: 0 }}>
            {section.title}
          </Heading>
        )}
        {canEdit && !editing ? (
          <span className="fm-noprint" style={{ display: 'inline-flex', gap: 4 }}>
            <button type="button" className="cl-btn cl-focus" disabled={busy} onClick={() => setEditing(true)} aria-label={`Rename ${section.title}`}>
              Rename
            </button>
            <button
              type="button"
              className="cl-btn cl-focus"
              disabled={busy || at <= 0}
              onClick={() => onReorder(menuId, section.parentId, movedBy(ids, section.id, -1))}
              aria-label={`Move ${section.title} earlier`}
            >
              Earlier
            </button>
            <button
              type="button"
              className="cl-btn cl-focus"
              disabled={busy || at === ids.length - 1}
              onClick={() => onReorder(menuId, section.parentId, movedBy(ids, section.id, 1))}
              aria-label={`Move ${section.title} later`}
            >
              Later
            </button>
          </span>
        ) : null}
      </div>
      {section.lines.length > 0 ? (
        <ul style={{ listStyle: 'none', padding: 0, margin: '4px 0 0' }}>
          {section.lines.map((l) => (
            <LineRow key={l.id} line={l} currency={currency} />
          ))}
        </ul>
      ) : section.sections.length === 0 && canEdit ? (
        <p className="cl-note fm-noprint" style={{ margin: '4px 0 0' }}>
          No line in this section.
        </p>
      ) : null}
      {section.sections.map((child) => (
        <SectionBlock
          key={child.id}
          section={child}
          siblings={section.sections}
          depth={depth + 1}
          menuId={menuId}
          canEdit={canEdit}
          busy={busy}
          currency={currency}
          onRename={onRename}
          onReorder={onReorder}
        />
      ))}
    </div>
  );
}

function KindBlock({
  block,
  liveKinds,
  canEdit,
  busy,
  currency,
  onMoveKind,
  onRename,
  onReorder,
}: {
  block: FullMenuKind
  liveKinds: string[]
  canEdit: boolean
  busy: boolean
  currency?: string | null
  onMoveKind: (next: string[]) => void
  onRename: (menuId: string, sectionId: string, title: string) => void
  onReorder: (menuId: string, parentId: string | null, ids: string[]) => void
}) {
  const name = kindName(block.kind) ?? block.kind;
  const at = liveKinds.indexOf(block.kind);
  return (
    <section
      className="fm-kind"
      data-testid={`full-menu-kind-${block.kind}`}
      aria-label={name}
      style={{ marginTop: 22 }}
      draggable={canEdit && !busy}
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, `kind:${block.kind}`);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDragOver={canEdit ? (e) => e.preventDefault() : undefined}
      onDrop={
        canEdit
          ? (e) => {
              const raw = e.dataTransfer.getData(DRAG_TYPE);
              if (!raw.startsWith('kind:')) return;
              e.preventDefault();
              const kind = raw.slice('kind:'.length);
              if (kind !== block.kind && liveKinds.includes(kind)) onMoveKind(droppedOn(liveKinds, kind, block.kind));
            }
          : undefined
      }
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 8, borderBottom: '1px solid var(--paper-2)' }}>
        <h3 style={{ margin: 0 }}>{name}</h3>
        {canEdit && liveKinds.length > 1 ? (
          <span className="fm-noprint" style={{ display: 'inline-flex', gap: 4 }}>
            <button
              type="button"
              className="cl-btn cl-focus"
              disabled={busy || at <= 0}
              onClick={() => onMoveKind(movedBy(liveKinds, block.kind, -1))}
              aria-label={`Move ${name} earlier`}
            >
              Earlier
            </button>
            <button
              type="button"
              className="cl-btn cl-focus"
              disabled={busy || at === liveKinds.length - 1}
              onClick={() => onMoveKind(movedBy(liveKinds, block.kind, 1))}
              aria-label={`Move ${name} later`}
            >
              Later
            </button>
          </span>
        ) : null}
      </div>
      {block.sections.map((s) => (
        <SectionBlock
          key={s.id}
          section={s}
          siblings={block.sections}
          depth={0}
          menuId={block.menuId}
          canEdit={canEdit}
          busy={busy}
          currency={currency}
          onRename={onRename}
          onReorder={onReorder}
        />
      ))}
      {block.unsorted.length > 0 ? (
        <div className="fm-section" data-testid="full-menu-unsorted" style={{ marginTop: 14 }}>
          {block.sections.length > 0 ? (
            <h4 className="cl-crumb" style={{ margin: 0 }}>
              Not in a section
            </h4>
          ) : null}
          <ul style={{ listStyle: 'none', padding: 0, margin: '4px 0 0' }}>
            {block.unsorted.map((l) => (
              <LineRow key={l.id} line={l} currency={currency} />
            ))}
          </ul>
        </div>
      ) : null}
      {block.sections.length === 0 && block.unsorted.length === 0 ? (
        <p className="cl-note">No line on this menu.</p>
      ) : null}
    </section>
  );
}

export function FullMenu({ house, canManage, currency }: {
  /** The house of the session; every read and write is this house's. */
  house: string
  canManage: boolean
  currency?: string | null
}) {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: fullMenuKey(house), queryFn: () => loadFullMenu(house) });
  const [failed, setFailed] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(() => readDismissed(house));
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['menu'] });
  const settle = {
    onSuccess: () => {
      setFailed(null);
      refresh();
    },
    onError: (err: unknown) => setFailed(fullMenuReason(err)),
  };
  const rename = useMutation({
    mutationFn: (v: { menuId: string; sectionId: string; title: string }) => renameMenuSection(v.menuId, v.sectionId, v.title),
    ...settle,
  });
  const reorder = useMutation({
    mutationFn: (v: { menuId: string; parentId: string | null; ids: string[] }) => reorderMenuSections(v.menuId, v.parentId, v.ids),
    ...settle,
  });
  const order = useMutation({
    mutationFn: (next: string[]) => setMenuKindOrder(house, next),
    ...settle,
  });

  const read = q.data;
  const menu = read?.menu;
  // A kept copy is read only: nothing is sent from a page the gateway did not just answer.
  const canEdit = canManage && read?.asOf === null;
  const busy = rename.isPending || reorder.isPending || order.isPending;
  const liveKinds = menu ? menu.kinds.map((k) => k.kind) : [];
  const hidden = menu?.hiddenDishes ?? [];
  const toMove = hidden.filter((d) => !d.onFood);

  return (
    <section style={{ marginTop: 32 }} aria-labelledby="full-menu-h" data-testid="full-menu">
      <style>{PRINT_CSS}</style>
      <div className="fm-noprint" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <h2 id="full-menu-h" className="cl-crumb" style={{ margin: 0 }}>
          Full menu
        </h2>
        {menu && menu.kinds.length > 0 ? (
          // Not while a fresh read is on its way: Print prints the menu as it now stands.
          <button type="button" className="cl-btn cl-focus" disabled={q.isFetching} onClick={() => window.print()}>
            {q.isFetching ? 'Reading the latest prices…' : 'Print'}
          </button>
        ) : null}
      </div>
      <p className="cl-note fm-noprint">
        Every live menu of the house as one document, in the house&apos;s order.
        {canManage ? ' Drag a menu or a section, or use Earlier and Later, to change the order; Rename changes a section’s name.' : ''}
      </p>

      {q.isLoading ? (
        <p className="cl-said" role="status">
          Reading the full menu…
        </p>
      ) : q.isError ? (
        <p className="cl-said" role="alert" data-testid="full-menu-error">
          The full menu could not be read ({fullMenuReason(q.error)}), and no copy is kept on this device. This is not the same
          as having no menu.
        </p>
      ) : menu ? (
        <>
          {read?.asOf ? (
            <p className="cl-said fm-noprint" role="status" data-testid="full-menu-as-of">
              The full menu could not be read now ({read.failure}). This is the copy kept on this device, as of{' '}
              {asOfWords(read.asOf, menu.timezone)}; it may be out of date.
            </p>
          ) : null}
          {failed ? (
            <p className="cl-said fm-noprint" role="alert" data-testid="full-menu-write-error">
              Not changed: {failed}.
            </p>
          ) : null}
          {menu.soldOutReadable === false ? (
            <p className="cl-note fm-noprint">{menu.soldOutReason ?? 'Which drinks are sold out could not be read, so none is marked.'}</p>
          ) : null}
          {canManage && toMove.length > 0 && !dismissed ? (
            <div className="fm-noprint" role="note" data-testid="full-menu-dishes-card" style={{ border: '1px solid var(--paper-2)', borderRadius: 10, padding: 12, marginTop: 10 }}>
              <p className="cl-said" style={{ margin: 0 }}>
                {toMove.length} {toMove.length === 1 ? 'dish' : 'dishes'} on your Drinks menu {toMove.length === 1 ? 'is' : 'are'} not
                shown here, because your Food menu is live: {toMove.map((d) => d.name).join(', ')}. To move{' '}
                {toMove.length === 1 ? 'it' : 'them'} to Food, read a Food menu that lists {toMove.length === 1 ? 'it' : 'them'} under
                Menus kept and make it live through its review. Nothing is deleted; the Drinks menu keeps{' '}
                {toMove.length === 1 ? 'it' : 'them'} in the record.
              </p>
              <button
                type="button"
                className="cl-btn cl-focus"
                style={{ marginTop: 8 }}
                onClick={() => {
                  writeDismissed(house);
                  setDismissed(true);
                }}
              >
                Got it
              </button>
            </div>
          ) : null}

          {menu.kinds.length === 0 ? (
            <p className="cl-said" data-testid="full-menu-none">
              No menu is live yet.
            </p>
          ) : (
            <div className="fm-doc">
              <p className="cl-note" data-testid="full-menu-print-label" style={{ marginTop: 10 }}>
                {FULL_MENU_PRINT_LABEL}
              </p>
              {menu.kinds.map((block) => (
                <KindBlock
                  key={block.menuId}
                  block={block}
                  liveKinds={liveKinds}
                  canEdit={canEdit}
                  busy={busy}
                  currency={currency}
                  onMoveKind={(next) => order.mutate(kindOrderWith(menu.kindOrder, liveKinds, next))}
                  onRename={(menuId, sectionId, title) => rename.mutate({ menuId, sectionId, title })}
                  onReorder={(menuId, parentId, ids) => reorder.mutate({ menuId, parentId, ids })}
                />
              ))}
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}

export default FullMenu;
