/**
 * The /inventory item drawer (proposal §2 S2, §3 I13, §4 K1-K2): one item in
 * a right-side sheet over the list, the whole screen on a phone. The head says
 * what it is, where it sits and when it was last counted; then eight cards
 * (ItemCards), the item's acts (Count, Order more, Write off, More) always
 * under them, and the detail card a card opens: that card's own evidence
 * (CARD_EVIDENCE) and the NutritionCard slot. Below them is where it is used
 * (ItemUsedIn).
 */
import { useEffect, useRef, useState, type ComponentType } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Sheet } from '@/components/mudavym';
import { getItemFigures, getItemNutrition, getItemUsedIn, inventoryItemKeys, type HouseFields } from '../../../services/api/inventory';
import { getItemDishes, getItemDrinks } from '../../../services/api/itemDishes';
import { fmtWhen } from '../../../lib/mudavym/format';
import type { Provider } from '../../../services/api/providers';
import type { StorageLocation } from '../../../hooks/useStorageLocations';
import ItemCards, { CARD_TITLE, type CardId, type FiguresLoad, type InsideLoad } from './ItemCards';
import ItemUsedIn, { type DishesLoad, type DrinksLoad, type UsedInLoad } from './ItemUsedIn';
import WhatIsInIt from './NutritionCard';
import HowItTastes from './TasteCard';
import TasteSummary from './TasteSummary';
import RowDropdown, { type EvidenceSection, type SheetId } from './RowDropdown';
import { failureReason } from './iv-failure';
import { noZoneWord, typeLabel, type HouseCurrency, type InvRow } from './useInventoryNextData';
import './item-drawer.css';

const KIND_WORDS: Record<string, string> = {
  food: 'Food',
  supply: 'Supply',
  other: 'Other drink',
  non_alcoholic: 'Non-alcoholic drink',
  soft_drink: 'Soft drink',
};

const DRINK_UNITS = new Set(['bottle', 'case', 'keg', 'glass', 'shot']);

/**
 * What each card's own evidence is. A card opens its panel first and the
 * nutrition card under it (founder /goal 2026-11-07: a KPI card opens the
 * good's nutrition card); "What's in it" opens the nutrition card alone, and
 * "All the evidence" opens every panel.
 */
export const CARD_EVIDENCE: Record<CardId | 'all', ReadonlyArray<EvidenceSection>> = {
  onhand: ['where', 'facts'],
  value: ['cost', 'paper'],
  usage: ['pace'],
  cover: ['pace', 'where'],
  cost: ['cost', 'paper'],
  waste: ['where'],
  gap: ['where'],
  inside: [],
  all: ['facts', 'where', 'pace', 'cost', 'paper'],
};

/** The kind in words: a wine's style, else the house's own kind. */
export function kindWords(row: InvRow, house: HouseFields): string {
  const k = house.kind ?? row.kind;
  if (k === null || k === 'wine') {
    if (row.kind === 'wine' && row.type && row.type !== 'wine' && row.type !== 'unclassified') return `${typeLabel(row.type)} wine`;
    return k === null ? 'Kind not recorded' : 'Wine';
  }
  return KIND_WORDS[k] ?? typeLabel(k);
}

function bottleWords(row: InvRow, house: HouseFields): string | null {
  // The list fills a missing bottle size with 750 for every row, so a size is
  // said only for a good kept in bottles.
  if (row.bottleSizeMl === null || house.kind === 'food' || house.kind === 'supply') return null;
  if (house.uom !== null && !DRINK_UNITS.has(house.uom)) return null;
  return `${row.bottleSizeMl} ml bottle`;
}

/** What the NutritionCard slot is handed: the item as the drawer knows it. */
export interface NutritionCardProps {
  row: InvRow;
  house: HouseFields;
  restaurantId: string | null;
  /** Owners and managers may change what is recorded; staff read it. */
  canManage: boolean;
}

export interface ItemDrawerProps {
  /** The row the URL opened, or null when its id is not on the list. */
  row: InvRow | null;
  house: HouseFields;
  canManage: boolean;
  currency: HouseCurrency;
  zoneName: (id: string | null) => string;
  locations: StorageLocation[];
  locationsUnavailable: boolean;
  providers: Provider[] | null;
  providersError: string | null;
  restaurantId: string | null;
  onClose: () => void;
  /** NutritionCard slot: what mounts in the detail card a KPI card opens. */
  NutritionCard?: ComponentType<NutritionCardProps>;
  /** TasteCard slot: how it tastes, mounted directly after the nutrition card. */
  TasteCard?: ComponentType<NutritionCardProps>;
  /** A sheet to open with the drawer: the staff "Count" bar opens it on the count. */
  startWith?: SheetId;
  /** The list's "Used in" count opened this: scroll to where the good is used once it is open. */
  scrollToUsed?: boolean;
  /**
   * The visible rows, in the order the list shows them (after the filter and the sort), and what stepping to one
   * does. Absent: the drawer has no step buttons (a drawer opened from anywhere that has no list behind it).
   */
  steps?: { ids: readonly string[]; onStep: (id: string) => void };
}

/** How long the evidence takes to open: its 200 ms tween, or none when the person asked for reduced motion. */
function openMs(): number {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : 220;
  } catch {
    return 220;
  }
}

type EvidenceId = CardId | 'all' | null;

function DrawerBody(props: ItemDrawerProps & { row: InvRow; evidence: EvidenceId; setEvidence: (next: EvidenceId | ((cur: EvidenceId) => EvidenceId)) => void }) {
  const { row, house, canManage, currency, zoneName, restaurantId, evidence, setEvidence } = props;
  const NutritionCard = props.NutritionCard ?? WhatIsInIt;
  const TasteCard = props.TasteCard ?? HowItTastes;
  // A card kept open across a step (r109 g6): this body mounted with it open, so its detail rides the body's own
  // entry and does not also fade in, and the sheet is not scrolled again. The first press of anything ends it.
  const [instant, setInstant] = useState(evidence !== null);
  const carried = useRef(evidence !== null);
  // One sheet for the drawer: the evidence's "Record a count" opens the sheet the acts own.
  const [sheet, setSheet] = useState<SheetId | null>(props.startWith ?? null);
  const detailRef = useRef<HTMLElement | null>(null);
  const clipRef = useRef<HTMLDivElement | null>(null);
  const [switched, setSwitched] = useState(false);
  // The held height is let go one frame after the swap was drawn.
  useEffect(() => {
    const clip = clipRef.current;
    if (!clip || clip.style.minHeight === '') return;
    const f = window.requestAnimationFrame(() => {
      clip.style.minHeight = '';
    });
    return () => window.cancelAnimationFrame(f);
  }, [evidence]);
  const tasteRef = useRef<HTMLDivElement | null>(null);
  // The first-screen taste line opens the evidence and brings the taste card into view.
  const [wantTaste, setWantTaste] = useState(false);
  // On a phone the detail card opens below the fold: bring it into view, smoothly like "Used in" (r109 g7).
  // It waits for the open to finish (200 ms), so the page does not scroll toward a card still at 0 height.
  useEffect(() => {
    if (evidence === null) return;
    if (carried.current) {
      carried.current = false;
      return;
    }
    const t = window.setTimeout(() => detailRef.current?.scrollIntoView?.({ block: 'nearest', behavior: openMs() === 0 ? 'auto' : 'smooth' }), openMs());
    return () => window.clearTimeout(t);
  }, [evidence]);
  useEffect(() => {
    if (!wantTaste || evidence === null) return;
    const t = window.setTimeout(() => {
      tasteRef.current?.scrollIntoView?.({ block: 'nearest', behavior: openMs() === 0 ? 'auto' : 'smooth' });
      setWantTaste(false);
    }, openMs());
    return () => window.clearTimeout(t);
  }, [wantTaste, evidence]);
  const scrollToUsed = props.scrollToUsed === true;
  useEffect(() => {
    if (!scrollToUsed) return;
    const t = window.setTimeout(
      () => document.getElementById('ivd-used')?.scrollIntoView?.({ block: 'start', behavior: openMs() === 0 ? 'auto' : 'smooth' }),
      openMs(),
    );
    return () => window.clearTimeout(t);
  }, [scrollToUsed]);
  const id = row?.id ?? '';
  // A supply (napkins, foil) is not eaten or drunk: it has no nutrition or
  // allergens to state, so the drawer neither reads nor offers them.
  const hasContents = (house.kind ?? row?.kind ?? null) !== 'supply';

  const enabled = row !== null && restaurantId !== null;
  const figuresQ = useQuery({
    queryKey: inventoryItemKeys.figures(restaurantId ?? '', id),
    queryFn: () => getItemFigures(id, restaurantId ?? undefined),
    enabled,
    staleTime: 30_000,
    retry: false,
  });
  // The same query the slot's card reads, so the KPI card and the card agree.
  const nutritionQ = useQuery({
    queryKey: inventoryItemKeys.nutrition(restaurantId ?? '', id),
    queryFn: () => getItemNutrition(id, restaurantId ?? undefined),
    enabled: enabled && hasContents,
    staleTime: 60_000,
    retry: false,
  });
  const usedInQ = useQuery({
    queryKey: inventoryItemKeys.usedIn(restaurantId ?? '', id),
    queryFn: () => getItemUsedIn(id, restaurantId ?? undefined),
    enabled,
    staleTime: 60_000,
    retry: false,
  });
  const dishesQ = useQuery({
    queryKey: [...inventoryItemKeys.usedIn(restaurantId ?? '', id), 'dishes'],
    queryFn: () => getItemDishes(id, restaurantId ?? undefined),
    enabled,
    staleTime: 60_000,
    retry: false,
  });
  // The drinks that use it, with the cards a dish has (founder /goal 2026-11-07).
  const drinksQ = useQuery({
    queryKey: [...inventoryItemKeys.usedIn(restaurantId ?? '', id), 'drinks'],
    queryFn: () => getItemDrinks(id, restaurantId ?? undefined),
    enabled,
    staleTime: 60_000,
    retry: false,
  });

  const figures: FiguresLoad = figuresQ.isError
    ? { status: 'failed', reason: failureReason(figuresQ.error) }
    : figuresQ.data
      ? { status: 'ready', data: figuresQ.data }
      : { status: 'reading' };
  const inside: InsideLoad = nutritionQ.isError
    ? { status: 'failed' }
    : nutritionQ.data
      ? { status: 'ready', data: nutritionQ.data }
      : { status: 'reading' };
  const usedIn: UsedInLoad = usedInQ.isError
    ? { status: 'failed', reason: failureReason(usedInQ.error) }
    : usedInQ.data
      ? { status: 'ready', data: usedInQ.data }
      : { status: 'reading' };
  const dishes: DishesLoad = dishesQ.isError
    ? { status: 'failed', reason: failureReason(dishesQ.error) }
    : dishesQ.data
      ? { status: 'ready', data: dishesQ.data }
      : { status: 'reading' };
  const drinks: DrinksLoad = drinksQ.isError
    ? { status: 'failed', reason: failureReason(drinksQ.error) }
    : drinksQ.data
      ? { status: 'ready', data: drinksQ.data }
      : { status: 'reading' };
  // Where a good is used is the first question and the last block: one line up top says how many and goes
  // there. Said only when all three reads answered with something; a pending or failed read says nothing here.
  // A drink counts once whether its recipe line or a catalogue cocktail card names the good (the block below
  // lists both), so the line never says fewer than the block shows.
  const cardsRead = usedIn.status === 'ready' && usedIn.data.inCocktails.readable && usedIn.data.inCocktails.lines !== null;
  const drinkIds = new Set<string>();
  if (drinks.status === 'ready') for (const d of drinks.data.drinks) drinkIds.add(d.cocktailId);
  if (usedIn.status === 'ready' && cardsRead) for (const c of usedIn.data.inCocktails.lines ?? []) drinkIds.add(c.cocktailId);
  const nDishes = dishes.status === 'ready' ? dishes.data.dishes.length : 0;
  const nDrinks = drinkIds.size;
  const usedChip =
    dishes.status === 'ready' && drinks.status === 'ready' && cardsRead && nDishes + nDrinks > 0
      ? `Used in ${[nDishes > 0 ? `${nDishes} ${nDishes === 1 ? 'dish' : 'dishes'}` : '', nDrinks > 0 ? `${nDrinks} ${nDrinks === 1 ? 'drink' : 'drinks'}` : ''].filter(Boolean).join(', ')}`
      : null;

  const name = row.name ?? house.displayName ?? 'Unnamed item';
  const held = row.zones?.filter((z) => z.qty > 0) ?? null;
  const where =
    row.zones === null || props.locationsUnavailable
      ? 'where it sits could not be read'
      : held && held.length > 0
        ? held.map((z) => zoneName(z.locationId)).join(' · ')
        : (noZoneWord(row.stock) ?? 'in no zone');
  const counted = row.lastCountedAt ? `counted ${fmtWhen(row.lastCountedAt)}` : 'never counted';
  const head = [kindWords(row, house), bottleWords(row, house), where, counted].filter(Boolean).join(' · ');

  // Pressing a second card swaps the detail card's content in one frame. Its clip holds the height it had for
  // that one frame, so the block under it (Used in) is not dropped under the reader, then lets go (r108 g15).
  const toggle = (next: CardId | 'all') => {
    const switching = evidence !== null && evidence !== next;
    setSwitched(switching);
    setInstant(false);
    if (switching && clipRef.current) clipRef.current.style.minHeight = `${clipRef.current.offsetHeight}px`;
    setEvidence((cur) => (cur === next ? null : next));
  };

  return (
    <>
      <p className="ivd-head" data-testid="ivd-head">
        {head}
      </p>
      {usedChip ? (
        <button
          type="button"
          className="ivd-usedchip iv-focus"
          data-testid="ivd-used-chip"
          onClick={() =>
            document.getElementById('ivd-used')?.scrollIntoView?.({ block: 'start', behavior: openMs() === 0 ? 'auto' : 'smooth' })
          }
        >
          {usedChip}
        </button>
      ) : null}
      {hasContents ? (
        <TasteSummary
          id={id}
          restaurantId={restaurantId}
          placement="head"
          open={evidence !== null}
          onOpen={() => {
            setInstant(false);
            setEvidence('all');
            setWantTaste(true);
          }}
        />
      ) : null}
      <ItemCards
        row={row}
        uom={house.uom}
        kind={house.kind ?? row.kind}
        canManage={canManage}
        currency={currency}
        figures={figures}
        inside={inside}
        open={evidence === 'all' ? null : evidence}
        onOpen={toggle}
      />
      {/* The acts sit under the cards, always: a count or a write-off never waits on opening a card. */}
      <RowDropdown
        row={row}
        canManage={canManage}
        currency={currency}
        zoneName={zoneName}
        locations={props.locations}
        locationsUnavailable={props.locationsUnavailable}
        providers={props.providers}
        providersError={props.providersError}
        restaurantId={restaurantId}
        uom={house.uom}
        kind={house.kind ?? row.kind}
        sections={[]}
        sheet={sheet}
        onSheet={setSheet}
      />
      {hasContents ? (
        <TasteSummary
          id={id}
          restaurantId={restaurantId}
          open={evidence !== null}
          onOpen={() => {
            setInstant(false);
            setEvidence('all');
            setWantTaste(true);
          }}
        />
      ) : null}
      <p className="ivd-evbar">
        <button
          type="button"
          className="iv-linkish iv-focus"
          aria-expanded={evidence !== null}
          aria-controls={evidence !== null ? 'ivd-evidence' : undefined}
          onClick={() => toggle('all')}
        >
          {evidence !== null ? 'Hide the evidence' : 'All the evidence'}
        </button>
      </p>
      <div className="ivd-evwrap" data-open={evidence !== null} data-testid="ivd-evwrap">
        <div ref={clipRef} className="ivd-evclip">
      {evidence !== null ? (
        <section
          key={evidence}
          ref={detailRef}
          id="ivd-evidence"
          className="ivd-evidence"
          aria-label={`${name}: detail card`}
          data-testid="ivd-evidence"
          data-card={evidence}
          data-switched={switched ? 'true' : undefined}
          data-instant={instant ? 'true' : undefined}
        >
          <h3 className="iv-sec">{evidence === 'all' ? 'All the evidence' : `${CARD_TITLE[evidence]}: where it comes from`}</h3>
          {CARD_EVIDENCE[evidence].length > 0 ? (
            <RowDropdown
              row={row}
              canManage={canManage}
              currency={currency}
              zoneName={zoneName}
              locations={props.locations}
              locationsUnavailable={props.locationsUnavailable}
              providers={props.providers}
              providersError={props.providersError}
              restaurantId={restaurantId}
              uom={house.uom}
              kind={house.kind ?? row.kind}
              sections={CARD_EVIDENCE[evidence]}
              actions={false}
              settled={figures.status === 'ready' ? (figures.data.costTrend.points ?? null) : figures.status}
              sheet={sheet}
              onSheet={setSheet}
            />
          ) : null}
          {hasContents ? (
            <div className="ivd-nutrition" data-slot="NutritionCard" data-testid="ivd-nutrition-slot">
              {evidence !== 'inside' ? <h4 className="ivd-used-h">{CARD_TITLE.inside}</h4> : null}
              <NutritionCard row={row} house={house} restaurantId={restaurantId} canManage={canManage} />
            </div>
          ) : null}
          {hasContents ? (
            <div ref={tasteRef} className="ivd-taste" data-slot="TasteCard" data-testid="ivd-taste-slot">
              <h4 className="ivd-used-h">How it tastes</h4>
              <TasteCard row={row} house={house} restaurantId={restaurantId} canManage={canManage} />
            </div>
          ) : null}
        </section>
      ) : null}
        </div>
      </div>
      <ItemUsedIn
        load={usedIn}
        dishes={dishes}
        drinks={drinks}
        canManage={canManage}
        currency={currency}
        onRetry={() => void usedInQ.refetch()}
        onRetryDishes={() => void dishesQ.refetch()}
        onRetryDrinks={() => void drinksQ.refetch()}
      />
    </>
  );
}

/** The shortcut keys the sheet answers to while focus is in it and not in a field or a menu. */
const STEP_KEYS: Record<string, 'next' | 'prev'> = { j: 'next', J: 'next', ArrowDown: 'next', k: 'prev', K: 'prev', ArrowUp: 'prev' };

/**
 * The drawer: one Sheet that stays up while the good in it changes. Stepping to the next or the previous good
 * swaps the body (keyed by the good) under the same head and the same buttons, so focus stays where it was
 * pressed (r108 g12; SOTA: Linear's peek, J and K move the preview through the list).
 */
export default function ItemDrawer(props: ItemDrawerProps) {
  const { row, house, onClose, steps, restaurantId } = props;
  const qc = useQueryClient();
  const [dir, setDir] = useState<'next' | 'prev' | null>(null);
  // The open card lives here, above the body that is remounted per good, so a step keeps it (r109 g6). A supply has
  // no 'inside' card, so it falls back to closed there.
  const [evidence, setEvidence] = useState<EvidenceId>(null);
  const noInside = (house.kind ?? row?.kind ?? null) === 'supply';
  const shownEvidence: EvidenceId = noInside && evidence === 'inside' ? null : evidence;
  useEffect(() => {
    if (shownEvidence !== evidence) setEvidence(shownEvidence);
  }, [shownEvidence, evidence]);
  const at = steps && row ? steps.ids.indexOf(row.id) : -1;
  const prevId = steps && at > 0 ? steps.ids[at - 1] : null;
  const nextId = steps && at >= 0 && at < steps.ids.length - 1 ? steps.ids[at + 1] : null;
  const stepRef = useRef<(d: 'next' | 'prev') => void>(() => {});
  stepRef.current = (d) => {
    const to = d === 'next' ? nextId : prevId;
    if (to === null || !steps) return;
    setDir(d);
    steps.onStep(to);
  };
  useEffect(() => {
    if (!steps) return;
    const onKey = (e: KeyboardEvent) => {
      const d = STEP_KEYS[e.key];
      if (!d || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (!t?.closest?.('.iv-drawer')) return;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable) return;
      if (t.closest('[role="menu"],[role="listbox"]')) return;
      e.preventDefault();
      stepRef.current(d);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [steps !== undefined]);
  // The next row's reads are warmed once the drawer is on a row, so the swap lands on an answered body.
  useEffect(() => {
    if (restaurantId === null) return;
    for (const other of [prevId, nextId]) {
      if (other === null) continue;
      void qc.prefetchQuery({
        queryKey: inventoryItemKeys.figures(restaurantId, other),
        queryFn: () => getItemFigures(other, restaurantId),
        staleTime: 30_000,
      });
      void qc.prefetchQuery({
        queryKey: inventoryItemKeys.usedIn(restaurantId, other),
        queryFn: () => getItemUsedIn(other, restaurantId),
        staleTime: 60_000,
      });
    }
  }, [qc, restaurantId, prevId, nextId]);

  if (row === null) {
    return (
      <Sheet open onClose={onClose} label="This item is not on the list any more. Closing writes nothing." title="Not on the list" spine="Item" wide detents={['full']} className="iv-drawer" bodyClassName="iv-sheet-body">
        <p className="iv-said" data-testid="ivd-gone">
          This item is not on the list any more. It may have been removed, or the link is from another house.
          Close returns to the list.
        </p>
      </Sheet>
    );
  }
  const name = row.name ?? house.displayName ?? 'Unnamed item';
  return (
    <Sheet
      open
      onClose={onClose}
      label={`${name}: its figures, their evidence and where it is used. Closing writes nothing.`}
      eyebrow="Item"
      title={name}
      spine={name}
      wide
      className="iv-drawer"
      // The body's side gutter: without it the head, the evidence and "Used in"
      // sat flush on the sheet's edge (browser walk 2026-11-11).
      bodyClassName="iv-sheet-body"
    >
      {steps && at >= 0 ? (
        <div className="ivd-steps" role="group" aria-label="Step through the list">
          <button type="button" className="ivd-step iv-focus" data-testid="ivd-prev" aria-keyshortcuts="K" disabled={prevId === null} onClick={() => stepRef.current('prev')}>
            Previous good
          </button>
          <button type="button" className="ivd-step iv-focus" data-testid="ivd-next" aria-keyshortcuts="J" disabled={nextId === null} onClick={() => stepRef.current('next')}>
            Next good
          </button>
        </div>
      ) : null}
      <div key={row.id} className="ivd-stepbody" data-step={dir ?? undefined} data-testid="ivd-stepbody">
        <DrawerBody {...props} row={row} evidence={shownEvidence} setEvidence={setEvidence} />
      </div>
    </Sheet>
  );
}
