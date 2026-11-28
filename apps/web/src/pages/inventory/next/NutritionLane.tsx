/**
 * "Fill what's in it" (r108 inventory g14): the goods under the "Nutrition not
 * recorded" chip, one at a time inside one sheet, for owners and managers.
 *
 * - The first screen says, once, that each lookup sends the good's name to
 *   Open Food Facts and USDA FoodData Central, as the single lookup does.
 * - A step runs the existing label lookup when it opens, never ahead: only the
 *   step on screen is looked up. Going back to a step does not send it again.
 * - The draft is shown in NutritionForm with its source named. Nothing is saved
 *   without Save; Skip saves nothing. A lookup never states an allergen free:
 *   the form adds only "contains" and "may contain" from it.
 * - J and K (and Next / Previous) move through the lane; "N of M filled"
 *   counts the saves.
 * - A failed lookup says it could not be reached and leaves the form to type.
 *
 * Motion: a step enters +12 px on Y over 160 ms; under reduced motion nothing
 * moves or fades (nutrition-card.css). The sheet is the house Sheet.
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Sheet } from '@/components/mudavym';
import {
  getItemNutrition,
  inventoryItemKeys,
  lookupItemNutrition,
  type NutritionLookup,
} from '../../../services/api/inventory';
import NutritionForm from './NutritionForm';
import { holdsContents } from './useInventoryNextData';
import { failureReason } from './iv-failure';
import './nutrition-card.css';

export interface LaneGood {
  id: string;
  name: string;
  /** The good's kind; a supply holds nothing to state and is never looked up. */
  kind?: string | null;
}

export interface NutritionLaneProps {
  goods: LaneGood[];
  restaurantId: string | null;
  /** Owners and managers only; anyone else is shown nothing. */
  canManage: boolean;
  onClose: () => void;
}

export const LANE_SENDS_NAMES =
  'Each good is looked up by its name when its step opens. The name is sent to Open Food Facts and to USDA FoodData Central, as the single lookup does. A lookup only fills a draft: nothing is saved until you press Save, and a lookup never says a good is free of an allergen.';

export const LANE_UNREACHED =
  'The label lookup could not be reached, so nothing was looked up. You can type the figures from the pack instead.';

const SOURCE_WORDS = { open_food_facts: 'Open Food Facts', usda_fdc: 'USDA FoodData Central' } as const;

/** A key that moves the lane, unless the person is typing or choosing. */
function laneKey(e: KeyboardEvent): 'next' | 'prev' | null {
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  const t = e.target instanceof HTMLElement ? e.target : null;
  if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.closest('[role="listbox"],[role="combobox"]'))) return null;
  if (e.key === 'j' || e.key === 'J') return 'next';
  if (e.key === 'k' || e.key === 'K') return 'prev';
  return null;
}

export default function NutritionLane(props: NutritionLaneProps) {
  // Staff never see the lane, whoever mounts it. A supply is never in it: its
  // name would be sent to Open Food Facts and USDA for a thing nobody eats.
  const goods = props.goods.filter((g) => holdsContents(g.kind));
  if (!props.canManage || goods.length === 0) return null;
  return <Lane {...props} goods={goods} />;
}

function Lane({ goods, restaurantId, onClose }: NutritionLaneProps) {
  const [started, setStarted] = useState(false);
  const [at, setAt] = useState(0);
  const [filled, setFilled] = useState<ReadonlySet<string>>(() => new Set());
  const done = at >= goods.length;
  const move = (by: 1 | -1) => setAt((i) => Math.max(0, Math.min(goods.length, i + by)));

  useEffect(() => {
    if (!started) return;
    const onKey = (e: KeyboardEvent) => {
      const k = laneKey(e);
      if (!k) return;
      e.preventDefault();
      move(k === 'next' ? 1 : -1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const count = `${filled.size} of ${goods.length} filled`;
  return (
    <Sheet
      open
      onClose={onClose}
      label="Fill what is in each good whose nutrition is not recorded, one at a time"
      eyebrow="Nutrition not recorded"
      title="Fill what’s in it"
      footer={
        <span role="status" aria-live="polite" data-testid="ivn-lane-count">
          {count}
        </span>
      }
    >
      {!started ? (
        <div data-testid="ivn-lane-start">
          <p className="iv-said">{LANE_SENDS_NAMES}</p>
          <p className="iv-note">
            {goods.length === 1 ? 'One good' : `${goods.length} goods`} to go through. J and K move to the next and the previous one.
          </p>
          <p className="ivn-acts">
            <button type="button" className="iv-btn iv-focus" data-seal="true" onClick={() => setStarted(true)}>
              Start with {goods[0].name}
            </button>
          </p>
        </div>
      ) : done ? (
        <div className="ivn-lane-step" data-testid="ivn-lane-done">
          <p className="iv-said">That was the last one: {count}.</p>
          <p className="ivn-acts">
            <button type="button" className="iv-btn iv-focus" onClick={() => move(-1)}>
              Previous
            </button>
            <button type="button" className="iv-btn iv-focus" data-seal="true" onClick={onClose}>
              Close
            </button>
          </p>
        </div>
      ) : (
        <Step
          key={goods[at].id}
          good={goods[at]}
          index={at}
          of={goods.length}
          restaurantId={restaurantId}
          filled={filled.has(goods[at].id)}
          onSaved={() => setFilled((s) => new Set(s).add(goods[at].id))}
          onNext={() => move(1)}
          onPrev={() => move(-1)}
        />
      )}
    </Sheet>
  );
}

function Step({
  good,
  index,
  of,
  restaurantId,
  filled,
  onSaved,
  onNext,
  onPrev,
}: {
  good: LaneGood;
  index: number;
  of: number;
  restaurantId: string | null;
  filled: boolean;
  onSaved: () => void;
  onNext: () => void;
  onPrev: () => void;
}) {
  const rid = restaurantId ?? '';
  const name = good.name.trim().slice(0, 100);
  const nut = useQuery({
    queryKey: inventoryItemKeys.nutrition(rid, good.id),
    queryFn: () => getItemNutrition(good.id, rid),
    enabled: Boolean(restaurantId),
    retry: false,
  });
  // Its own key, apart from the nutrition read, so nothing that refreshes the
  // card sends the name out again; kept for the lane so going back reuses it.
  const look = useQuery<NutritionLookup>({
    queryKey: ['inventory-next', 'nutrition-lane-lookup', rid, good.id],
    queryFn: () => lookupItemNutrition(good.id, { name }, rid),
    enabled: Boolean(restaurantId) && name.length >= 2,
    retry: false,
    staleTime: Infinity,
  });
  const lookupSettled = name.length < 2 || look.isSuccess || look.isError;
  const seed = look.isSuccess ? look.data : undefined;
  const source = seed?.kind === 'draft' ? SOURCE_WORDS[seed.draft.source] : null;

  return (
    <div className="ivn-lane-step" data-testid="ivn-lane-step">
      <p className="ivn-lane-h">
        <strong>{good.name}</strong> <span className="ivd-dim">· {index + 1} of {of}</span>
        {filled ? <span className="ivd-dim"> · saved</span> : null}
      </p>
      {nut.isError ? (
        <p role="alert" className="iv-said iv-said-alarm" data-testid="ivn-lane-unread">
          What is recorded for this good could not be read — {failureReason(nut.error)}. Nothing can be filled here; skip it or read it again.{' '}
          <button type="button" className="iv-linkish iv-focus" onClick={() => void nut.refetch()}>
            Read again
          </button>
        </p>
      ) : !nut.data || !lookupSettled ? (
        <p className="iv-note" data-testid="ivn-lane-looking">
          Looking up {good.name} on Open Food Facts and USDA FoodData Central…
        </p>
      ) : (
        <>
          {look.isError ? (
            <p role="alert" className="iv-said iv-said-alarm" data-testid="ivn-lane-unreached">
              {LANE_UNREACHED}
            </p>
          ) : source ? (
            <p className="iv-note" data-testid="ivn-lane-source">
              From {source}.
            </p>
          ) : null}
          <NutritionForm
            restaurantId={restaurantId}
            itemId={good.id}
            data={nut.data}
            startWithLookup={false}
            seed={seed}
            onSaved={onSaved}
            onDone={onNext}
            cancelLabel={null}
          />
        </>
      )}
      <p className="ivn-acts">
        <button type="button" className="iv-btn iv-focus" onClick={onPrev} disabled={index === 0}>
          Previous
        </button>
        <button type="button" className="iv-btn iv-focus" onClick={onNext}>
          {filled ? 'Next' : 'Skip'}
        </button>
      </p>
    </div>
  );
}
