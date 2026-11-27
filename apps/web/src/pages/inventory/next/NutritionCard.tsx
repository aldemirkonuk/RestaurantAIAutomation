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
 * - energy reads in kJ and kcal; a house in a country that labels by EU
 *   1169/2011 Annex XIII Part B also sees each figure's % RI per 100 g/ml,
 *   with the statement the annex requires (nutrition-ri.ts);
 * - an allergen nobody stated is "not stated", and "free of" is only ever a
 *   person's statement;
 * - a failed read says so and shows nothing as known (ADR 0020).
 * Owners and managers can edit, or fill a draft from the label lookup; a
 * draft is saved only when they save it.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getItemNutrition, inventoryItemKeys, type StoredNutrition } from '../../../services/api/inventory';
import { fmtWhen } from '../../../lib/mudavym/format';
import { failureReason } from './iv-failure';
import NutritionForm from './NutritionForm';
import './nutrition-card.css';
import { allergenLines, figureWords, PER, SOURCE_WORDS } from './nutrition-words';
import { packNutrition, packSizeMl, type PackHouse, type PackSource } from './pack-nutrition';
import { energyWords, referenceIntakes, RI_STATEMENT, type RiField } from './nutrition-ri';

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
    `${energyWords(p.energyKcal)}${pack.energyFromAbv && p.energyKcal !== null ? ' (from the alcohol alone; the energy in any sugar is not added)' : ''}`,
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

function Figures({ f, sizeMl, container, country }: { f: StoredNutrition; sizeMl: number | null; container: string; country: string | null }) {
  const ri = referenceIntakes(f, country);
  const rows: Array<[string, string, string | undefined, RiField?]> = [
    ['Energy', energyWords(f.energyKcal), f.energyFromAbv ? 'from the alcohol alone, at least: any sugar is not counted' : undefined, 'energyKcal'],
    ['Protein', figureWords(f.proteinG, 'g'), undefined, 'proteinG'],
    ['Fat', figureWords(f.fatG, 'g'), undefined, 'fatG'],
    ['Carbohydrate', figureWords(f.carbohydrateG, 'g'), undefined, 'carbohydrateG'],
    ['Sugar', figureWords(f.sugarsG, 'g'), undefined, 'sugarsG'],
    ['Salt', figureWords(f.saltG, 'g'), undefined, 'saltG'],
  ];
  if (f.abvPct !== null) rows.push(['Alcohol', figureWords(f.abvPct, '%'), undefined]);
  const anyRi = ri !== null && Object.keys(ri).length > 0;
  return (
    <>
      <h4 className="ivd-used-h">{PER[f.basis]}</h4>
      <dl className="ivn-figs" data-testid="ivn-figures">
        {rows.map(([k, v, note, field]) => (
          <div key={k} className="ivn-fig">
            <dt>{k}</dt>
            <dd data-unknown={v === 'not known' ? 'true' : undefined}>
              {v}
              {field && ri?.[field] ? <span className="ivn-ri"> {ri[field]} RI</span> : null}
              {note ? <span className="ivd-dim"> · {note}</span> : null}
            </dd>
          </div>
        ))}
      </dl>
      {anyRi ? (
        <p className="iv-note" data-testid="ivn-ri-statement">
          {RI_STATEMENT}
        </p>
      ) : null}
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
  /** restaurants.country as written; absent or unknown gives no % RI. */
  country?: string | null;
}

export default function NutritionCard({ row, house, restaurantId, canManage, country = null }: WhatIsInItProps) {
  const itemId = row.id;
  const sizeMl = packSizeMl(row, house);
  const container = house?.uom === 'keg' ? 'keg' : 'bottle';
  const [editing, setEditing] = useState<false | 'edit' | 'lookup'>(false);
  const q = useQuery({
    queryKey: inventoryItemKeys.nutrition(restaurantId ?? '', itemId),
    queryFn: () => getItemNutrition(itemId, restaurantId ?? undefined),
    enabled: restaurantId !== null && itemId !== '',
    staleTime: 60_000,
    retry: false,
  });

  if (q.isError) {
    return (
      <div className="ivn" data-testid="ivn">
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
      <p className="iv-note" data-testid="ivn">
        Reading what is in it…
      </p>
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
    <div className="ivn" data-testid="ivn">
      {data.figures ? (
        <Figures f={data.figures} sizeMl={sizeMl} container={container} country={country} />
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
