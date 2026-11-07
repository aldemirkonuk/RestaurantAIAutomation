/**
 * The /inventory item drawer (proposal §2 S2, §3 I13, §4 K1-K2): one item in
 * a right-side sheet over the list, the whole screen on a phone. The head says
 * what it is, where it sits and when it was last counted; then eight cards
 * (ItemCards), the evidence a card opens, and where it is used (ItemUsedIn). The evidence is the row's own
 * dropdown, unchanged, with its Count / Write off / Order acts, until each
 * card gets its own panel (I14).
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Sheet } from '@/components/mudavym';
import { getItemFigures, getItemUsedIn, inventoryItemKeys, type HouseFields } from '../../../services/api/inventory';
import { fmtWhen } from '../../../lib/mudavym/format';
import type { Provider } from '../../../services/api/providers';
import type { StorageLocation } from '../../../hooks/useStorageLocations';
import ItemCards, { CARD_TITLE, type CardId, type FiguresLoad } from './ItemCards';
import ItemUsedIn, { type UsedInLoad } from './ItemUsedIn';
import RowDropdown from './RowDropdown';
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
}

export default function ItemDrawer(props: ItemDrawerProps) {
  const { row, house, canManage, currency, zoneName, restaurantId, onClose } = props;
  const [evidence, setEvidence] = useState<CardId | 'all' | null>(null);
  const id = row?.id ?? '';

  const enabled = row !== null && restaurantId !== null;
  const figuresQ = useQuery({
    queryKey: inventoryItemKeys.figures(restaurantId ?? '', id),
    queryFn: () => getItemFigures(id, restaurantId ?? undefined),
    enabled,
    staleTime: 30_000,
    retry: false,
  });
  const usedInQ = useQuery({
    queryKey: inventoryItemKeys.usedIn(restaurantId ?? '', id),
    queryFn: () => getItemUsedIn(id, restaurantId ?? undefined),
    enabled,
    staleTime: 60_000,
    retry: false,
  });

  if (row === null) {
    return (
      <Sheet open onClose={onClose} label="This item is not on the list any more. Closing writes nothing." title="Not on the list" spine="Item" wide detents={['full']} className="iv-drawer">
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
  const usedIn: UsedInLoad = usedInQ.isError
    ? { status: 'failed', reason: failureReason(usedInQ.error) }
    : usedInQ.data
      ? { status: 'ready', data: usedInQ.data }
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
    >
      <p className="ivd-head" data-testid="ivd-head">
        {head}
      </p>
      <ItemCards
        row={row}
        uom={house.uom}
        canManage={canManage}
        currency={currency}
        figures={figures}
        open={evidence === 'all' ? null : evidence}
        onOpen={toggle}
      />
      <p className="ivd-evbar">
        <button
          type="button"
          className="iv-linkish iv-focus"
          aria-expanded={evidence !== null}
          aria-controls="ivd-evidence"
          onClick={() => toggle('all')}
        >
          {evidence !== null ? 'Hide the evidence' : 'Evidence and actions'}
        </button>
      </p>
      {evidence !== null ? (
        <section id="ivd-evidence" className="ivd-evidence" aria-label="Evidence and actions" data-testid="ivd-evidence">
          {evidence !== 'all' ? <h3 className="iv-sec">{CARD_TITLE[evidence]}: where it comes from</h3> : null}
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
          />
        </section>
      ) : null}
      <ItemUsedIn load={usedIn} canManage={canManage} currency={currency} onRetry={() => void usedInQ.refetch()} />
    </Sheet>
  );
}
