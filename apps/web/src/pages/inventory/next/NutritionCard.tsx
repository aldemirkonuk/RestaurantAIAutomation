/**
 * "What's in it": one item's nutrition and allergens, mounted in the drawer's
 * NutritionCard slot, at the top of the detail card every KPI card opens
 * (founder /goal 2026-11-07: "a nutrition card of the item").
 *
 * Simple for people: energy, protein, fat, carbohydrate, sugar and salt per
 * 100 g or 100 ml, and the allergens as words. The rules it keeps:
 * - a figure nobody stated reads "not known", never 0;
 * - every figure says per 100 g or per 100 ml;
 * - energy worked out from ABV says it is the alcohol alone;
 * - an allergen nobody stated is "not stated", and "free of" is only ever a
 *   person's statement;
 * - a failed read says so and shows nothing as known (ADR 0020).
 * Owners and managers can edit, or fill a draft from the label lookup; a
 * draft is saved only when they save it.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { StoredNutrition } from '../../../services/api/inventory';
import { nutritionQuery } from './item-queries';
import { fmtWhen } from '../../../lib/mudavym/format';
import { failureReason } from './iv-failure';
import NutritionForm from './NutritionForm';
import HeldReading from './HeldReading';
import './nutrition-card.css';
import { allergenLines, figureWords, PER, SOURCE_WORDS } from './nutrition-words';
import { packNutrition, packSizeMl, type PackHouse, type PackSource } from './pack-nutrition';

/** One whole container, under the per-100 table (DD-r108-37); nothing when no size is recorded. */
function PackLine({ f, sizeMl, container }: { f: StoredNutrition; sizeMl: number | null; container: string }) {
  const pack = packNutrition(f, sizeMl);
  if (!pack) return null;
  const head = `A ${pack.sizeMl.toLocaleString('en-GB')} ml ${container}`;
  if (pack.kind === 'needs_weight') {
    return (
      <p className="iv-note" data-testid="ivn-pack">
        {head}: these figures are per 100 g, so it needs a stated weight of one ml.
      </p>
    );
  }
  const p = pack.figures;
  const parts = [
    `${figureWords(p.energyKcal, 'kcal')}${pack.energyFromAbv && p.energyKcal !== null ? ' (from the alcohol alone; the energy in any sugar is not added)' : ''}`,
    `protein ${figureWords(p.proteinG, 'g')}`,
    `fat ${figureWords(p.fatG, 'g')}`,
    `carbohydrate ${figureWords(p.carbohydrateG, 'g')}`,
    `sugar ${figureWords(p.sugarsG, 'g')}`,
    `salt ${figureWords(p.saltG, 'g')}`,
  ];
  return (
    <p className="iv-note" data-testid="ivn-pack">
      {head}: {parts.join(', ')}.
    </p>
  );
}

function Figures({ f, sizeMl, container }: { f: StoredNutrition; sizeMl: number | null; container: string }) {
  const rows: Array<[string, string, string?]> = [
    ['Energy', figureWords(f.energyKcal, 'kcal'), f.energyFromAbv ? 'from the alcohol alone, at least: any sugar is not counted' : undefined],
    ['Protein', figureWords(f.proteinG, 'g')],
    ['Fat', figureWords(f.fatG, 'g')],
    ['Carbohydrate', figureWords(f.carbohydrateG, 'g')],
    ['Sugar', figureWords(f.sugarsG, 'g')],
    ['Salt', figureWords(f.saltG, 'g')],
  ];
  if (f.abvPct !== null) rows.push(['Alcohol', figureWords(f.abvPct, '%')]);
  return (
    <>
      <h4 className="ivd-used-h">{PER[f.basis]}</h4>
      <dl className="ivn-figs" data-testid="ivn-figures">
        {rows.map(([k, v, note]) => (
          <div key={k} className="ivn-fig">
            <dt>{k}</dt>
            <dd data-unknown={v === 'not known' ? 'true' : undefined}>
              {v}
              {note ? <span className="ivd-dim"> · {note}</span> : null}
            </dd>
          </div>
        ))}
      </dl>
      <PackLine f={f} sizeMl={sizeMl} container={container} />
      <p className="iv-note" data-testid="ivn-source">
        {SOURCE_WORDS[f.source](f.sourceRef)}, stated by {f.statedByName} {fmtWhen(f.statedAt)}.
      </p>
    </>
  );
}

/** The drawer's slot hands it the row; the id and the recorded size are read here. */
export interface WhatIsInItProps {
  row: { id: string } & PackSource;
  house?: PackHouse;
  restaurantId: string | null;
  canManage: boolean;
}

export default function NutritionCard({ row, house, restaurantId, canManage }: WhatIsInItProps) {
  const itemId = row.id;
  const sizeMl = packSizeMl(row, house);
  const container = house?.uom === 'keg' ? 'keg' : 'bottle';
  const [editing, setEditing] = useState<false | 'edit' | 'lookup'>(false);
  const q = useQuery({
    ...nutritionQuery(restaurantId ?? '', itemId),
    enabled: restaurantId !== null && itemId !== '',
  });

  if (q.isError) {
    return (
      <div className="ivn ivd-arrive" data-testid="ivn">
        <p role="alert" className="iv-said iv-said-alarm" data-testid="ivn-unread">
          What is in this item could not be read: {failureReason(q.error)}. Nothing is shown as known.
        </p>
        <button type="button" className="iv-btn iv-focus" onClick={() => void q.refetch()}>
          Try again
        </button>
      </div>
    );
  }
  if (!q.data) {
    return (
      <div data-testid="ivn">
        <HeldReading say="Reading what is in it…" hold="nutrition" />
      </div>
    );
  }
  const data = q.data;
  if (editing && canManage) {
    return (
      <NutritionForm
        restaurantId={restaurantId}
        itemId={itemId}
        data={data}
        startWithLookup={editing === 'lookup'}
        onDone={() => setEditing(false)}
      />
    );
  }
  return (
    <div className="ivn ivd-arrive" data-testid="ivn">
      {data.figures ? (
        <Figures f={data.figures} sizeMl={sizeMl} container={container} />
      ) : (
        <p className="iv-note" data-testid="ivn-none">
          Nothing is recorded yet about what is in this item.
        </p>
      )}
      <h4 className="ivd-used-h">Allergens</h4>
      <ul className="ivn-allergens" data-testid="ivn-allergens">
        {allergenLines(data.allergens).map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      {canManage ? (
        <p className="ivn-acts">
          <button type="button" className="iv-btn iv-focus" onClick={() => setEditing('edit')}>
            Edit
          </button>
          <button type="button" className="iv-btn iv-focus" onClick={() => setEditing('lookup')}>
            Fill from the label lookup
          </button>
        </p>
      ) : (
        <p className="iv-note">Only an owner or manager can change what is recorded here.</p>
      )}
    </div>
  );
}
