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
import { useQuery } from '@tanstack/react-query';
import { Sheet } from '@/components/mudavym';
import { getItemFigures, getItemNutrition, getItemUsedIn, inventoryItemKeys, type HouseFields } from '../../../services/api/inventory';
import { getItemDishes, getItemDrinks } from '../../../services/api/itemDishes';
import { fmtWhen } from '../../../lib/mudavym/format';
import type { Provider } from '../../../services/api/providers';
import type { StorageLocation } from '../../../hooks/useStorageLocations';
import ItemCards, { CARD_TITLE, type CardId, type FiguresLoad, type InsideLoad } from './ItemCards';
import ItemUsedIn, { type DishesLoad, type DrinksLoad, type UsedInLoad } from './ItemUsedIn';
import WhatIsInIt from './NutritionCard';
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
}

export default function ItemDrawer(props: ItemDrawerProps) {
  const { row, house, canManage, currency, zoneName, restaurantId, onClose } = props;
  const NutritionCard = props.NutritionCard ?? WhatIsInIt;
  const [evidence, setEvidence] = useState<CardId | 'all' | null>(null);
  // One sheet for the drawer: the evidence's "Record a count" opens the sheet the acts own.
  const [sheet, setSheet] = useState<SheetId | null>(null);
  const detailRef = useRef<HTMLElement | null>(null);
  // On a phone the detail card opens below the fold: bring it into view.
  useEffect(() => {
    if (evidence !== null) detailRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [evidence]);
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

  const toggle = (next: CardId | 'all') => setEvidence((cur) => (cur === next ? null : next));

  return (
    <Sheet
      open
      onClose={onClose}
      label={`${name}: its figures, their evidence and where it is used. Closing writes nothing.`}
      eyebrow="Item"
      title={name}
      spine={name}
      wide
      detents={['full']}
      className="iv-drawer"
      // The body's side gutter: without it the head, the evidence and "Used in"
      // sat flush on the sheet's edge (browser walk 2026-11-11).
      bodyClassName="iv-sheet-body"
    >
      <p className="ivd-head" data-testid="ivd-head">
        {head}
      </p>
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
      {evidence !== null ? (
        <section
          ref={detailRef}
          id="ivd-evidence"
          className="ivd-evidence"
          aria-label={`${name}: detail card`}
          data-testid="ivd-evidence"
          data-card={evidence}
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
        </section>
      ) : null}
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
    </Sheet>
  );
}
