/**
 * Editing "What's in it" (NutritionCard), for owners and managers.
 *
 * A box left empty is "not known" and is sent as null, never 0. The label
 * lookup only fills this form as a DRAFT: nothing is saved until the person
 * reads it against the pack and presses Save. A lookup can add "contains" or
 * "may contain"; it never states an allergen free.
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Select } from '@/components/mudavym';
import {
  ALLERGENS,
  inventoryItemKeys,
  lookupItemNutrition,
  saveItemNutrition,
  type Allergen,
  type AllergenStatus,
  type ItemNutrition,
  type NutritionBasis,
  type NutritionDraft,
  type NutritionFigures,
  type NutritionLookup,
  type NutritionSource,
  type SaveItemNutritionBody,
} from '../../../services/api/inventory';
import { getErrorStatus } from '../../../services/api/client';
import { failureReason, writeFailure } from './iv-failure';
import { kcalDisagrees, macrosOver100g } from './nutrition-check';
import { ALLERGEN_WORDS, PER } from './nutrition-words';

type Key = keyof NutritionFigures;
const FIELDS: Array<[Key, string]> = [
  ['energyKcal', 'Energy (kcal)'],
  ['proteinG', 'Protein (g)'],
  ['fatG', 'Fat (g)'],
  ['saturatesG', 'of which saturates (g)'],
  ['carbohydrateG', 'Carbohydrate (g)'],
  ['sugarsG', 'of which sugar (g)'],
  ['saltG', 'Salt (g)'],
  ['abvPct', 'Alcohol (% by volume)'],
];

const STATUS_OPTIONS = [
  { value: 'not_stated', label: 'Not stated' },
  { value: 'contains', label: 'Contains' },
  { value: 'may_contain', label: 'May contain' },
  { value: 'free', label: 'Free of it' },
];

export const LOOKUP_UNREACHED =
  'The label lookup could not reach Open Food Facts, so nothing was looked up. You can type the figures from the pack instead.';

/** '' is not known (null); "1,5" reads as 1.5; anything else is refused. */
export function readFigure(s: string): number | null | 'bad' {
  const t = s.trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : 'bad';
}

const asText = (v: number | null) => (v === null ? '' : String(v));

export interface NutritionFormProps {
  restaurantId: string | null;
  itemId: string;
  data: ItemNutrition;
  startWithLookup: boolean;
  onDone: () => void;
}

export default function NutritionForm({ restaurantId, itemId, data, startWithLookup, onDone }: NutritionFormProps) {
  const qc = useQueryClient();
  const f = data.figures;
  const [basis, setBasis] = useState<string>(f?.basis ?? data.suggestedBasis ?? '');
  const [vals, setVals] = useState<Record<Key, string>>(() => {
    const out = {} as Record<Key, string>;
    for (const [k] of FIELDS) out[k] = f ? asText(f[k]) : '';
    // Energy worked out from ABV is worked out again on save, not kept as typed.
    if (f?.energyFromAbv) out.energyKcal = '';
    return out;
  });
  const [source, setSource] = useState<{ source: NutritionSource; ref: string | null }>({
    source: f?.source ?? 'pack_label',
    ref: f?.sourceRef ?? null,
  });
  const [allergens, setAllergens] = useState<Record<Allergen, AllergenStatus>>(
    () => Object.fromEntries(data.allergens.map((a) => [a.allergen, a.status])) as Record<Allergen, AllergenStatus>,
  );
  const [draft, setDraft] = useState<NutritionDraft | null>(null);
  const [lookupOpen, setLookupOpen] = useState(startWithLookup);
  const [by, setBy] = useState('');
  const [found, setFound] = useState<NutritionLookup | null>(null);
  const [lookupSaid, setLookupSaid] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);

  const fill = (d: NutritionDraft) => {
    setDraft(d);
    setBasis(d.basis);
    setVals(Object.fromEntries(FIELDS.map(([k]) => [k, asText(d.figures[k])])) as Record<Key, string>);
    setSource({ source: d.source, ref: d.sourceRef });
    setAllergens((cur) => {
      const next = { ...cur };
      for (const a of d.allergens) next[a.allergen] = a.status;
      return next;
    });
    setLookupOpen(false);
    setFound(null);
  };

  const lookup = useMutation({
    mutationFn: (q: { barcode?: string; name?: string; fdcId?: string }) => lookupItemNutrition(itemId, q, restaurantId ?? undefined),
    onMutate: () => setLookupSaid(null),
    onSuccess: (r) => (r.kind === 'draft' ? fill(r.draft) : setFound(r)),
    onError: (e) =>
      setLookupSaid(getErrorStatus(e) === 502 ? LOOKUP_UNREACHED : `The lookup did not run — ${failureReason(e)}.`),
  });

  const save = useMutation({
    mutationFn: (body: SaveItemNutritionBody) => saveItemNutrition(itemId, body, restaurantId ?? undefined),
    onSuccess: (fresh) => {
      qc.setQueryData(inventoryItemKeys.nutrition(restaurantId ?? '', itemId), fresh);
      onDone();
    },
    onError: (e) =>
      setSaid(
        writeFailure(e, {
          refused: 'Nothing was saved',
          act: 'what is in it was saved',
          check: 'Close this and open the card again to see what is recorded before trying again.',
        }).text,
      ),
  });

  const read = Object.fromEntries(FIELDS.map(([k]) => [k, readFigure(vals[k])])) as Record<Key, number | null | 'bad'>;
  if (basis !== '100ml') read.abvPct = null;
  const numbers = Object.fromEntries(FIELDS.map(([k]) => [k, read[k] === 'bad' ? null : read[k]])) as Record<Key, number | null>;
  const bad = FIELDS.find(([k]) => read[k] === 'bad');
  const anyFigure = FIELDS.some(([k]) => read[k] !== null);
  const blocked =
    restaurantId === null
      ? 'No house is open, so nothing can be saved.'
      : bad
        ? `${bad[1]} must be a number of 0 or more, or left empty.`
        : anyFigure && basis === ''
          ? 'Choose per 100 g or per 100 ml.'
          : macrosOver100g(basis as NutritionBasis | '', numbers);
  const warning = blocked === null ? kcalDisagrees(basis as NutritionBasis | '', numbers) : null;

  const submit = () => {
    if (blocked || save.isPending) return;
    setSaid(null);
    const figures = anyFigure
      ? {
          basis: basis as '100g' | '100ml',
          source: source.source,
          sourceRef: source.ref,
          ...(Object.fromEntries(FIELDS.map(([k]) => [k, read[k]])) as Record<Key, number | null>),
        }
      : null;
    save.mutate({ figures, allergens: ALLERGENS.map((a) => ({ allergen: a, status: allergens[a] ?? 'not_stated' })) });
  };

  const runLookup = () => {
    const t = by.trim();
    if (/^\d{6,14}$/.test(t)) lookup.mutate({ barcode: t });
    else if (t.length >= 2) lookup.mutate({ name: t });
    else setLookupSaid('Type the barcode from the pack, or a name of at least two letters.');
  };

  const sourceOptions = [
    { value: 'pack_label', label: 'The pack’s label' },
    { value: 'house', label: 'The house’s own figures' },
    ...(source.source === 'open_food_facts' || source.source === 'usda_fdc'
      ? [{ value: source.source, label: source.source === 'open_food_facts' ? `Open Food Facts (${source.ref})` : `FoodData Central (${source.ref})` }]
      : []),
  ];

  return (
    <div className="ivn" data-testid="ivn-form">
      {lookupOpen ? (
        <form
          className="ivc-form"
          data-testid="ivn-lookup"
          onSubmit={(e) => {
            e.preventDefault();
            runLookup();
          }}
        >
          <label className="ivc-label">
            Barcode or name
            <input className="iv-field iv-focus" value={by} maxLength={100} onChange={(e) => setBy(e.target.value)} />
          </label>
          <button type="submit" className="iv-btn iv-focus" disabled={lookup.isPending}>
            {lookup.isPending ? 'Looking it up…' : 'Look it up'}
          </button>
          {lookupSaid ? (
            <p role="alert" className="iv-said iv-said-alarm" data-testid="ivn-lookup-said">
              {lookupSaid}
            </p>
          ) : null}
          {found && found.kind !== 'draft' ? (
            <div data-testid="ivn-found">
              {found.said.map((s) => (
                <p key={s} className="iv-note">
                  {s}
                </p>
              ))}
              {found.kind === 'none' ? (
                <p className="iv-note">{found.why}</p>
              ) : (
                <ul className="ivd-used-list">
                  {found.choices.map((c) => (
                    <li key={`${c.source}-${c.ref}`}>
                      <button
                        type="button"
                        className="iv-linkish iv-focus"
                        onClick={() => lookup.mutate(c.source === 'open_food_facts' ? { barcode: c.ref } : { fdcId: c.ref })}
                      >
                        {c.name}
                        {c.brand ? ` · ${c.brand}` : ''}
                      </button>
                      <span className="ivd-dim">{c.source === 'open_food_facts' ? 'Open Food Facts' : 'FoodData Central'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </form>
      ) : (
        <p className="ivn-acts">
          <button type="button" className="iv-linkish iv-focus" onClick={() => setLookupOpen(true)}>
            Fill from the label lookup
          </button>
        </p>
      )}

      {draft ? (
        <div className="iv-said" data-testid="ivn-draft">
          <p>
            A draft{draft.productName ? ` from ${draft.productName}` : ''}. Check each figure against the pack: nothing is saved until you
            press Save.
          </p>
          {(draft.notes ?? []).map((n) => (
            <p key={n} className="iv-note">
              {n}
            </p>
          ))}
          <p className="iv-note">{draft.attribution}</p>
        </div>
      ) : null}

      <form
        className="ivc-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Select
          label="The figures are"
          value={basis}
          onChange={setBasis}
          placeholder="Choose per 100 g or per 100 ml"
          options={[
            { value: '100g', label: PER['100g'] },
            { value: '100ml', label: PER['100ml'] },
          ]}
        />
        <p className="iv-note">Leave a box empty when it is not known. It is then shown as not known, never as 0.</p>
        <div className="ivn-grid">
          {FIELDS.filter(([k]) => k !== 'abvPct' || basis === '100ml').map(([k, label]) => (
            <label key={k} className="ivc-label">
              {label}
              <input
                className="iv-field iv-focus"
                inputMode="decimal"
                value={vals[k]}
                onChange={(e) => setVals((cur) => ({ ...cur, [k]: e.target.value }))}
              />
            </label>
          ))}
        </div>
        {basis === '100ml' && vals.energyKcal.trim() === '' ? (
          <p className="iv-note">With energy empty and the alcohol given, energy is worked out from the alcohol alone.</p>
        ) : null}
        <Select
          label="Where the figures come from"
          value={source.source}
          onChange={(v) => setSource({ source: v as NutritionSource, ref: v === source.source ? source.ref : null })}
          options={sourceOptions}
        />
        <fieldset className="ivn-allergen-set">
          <legend className="ivd-used-h">Allergens</legend>
          <div className="ivn-grid">
            {ALLERGENS.map((a) => (
              <Select
                key={a}
                label={ALLERGEN_WORDS[a][0].toUpperCase() + ALLERGEN_WORDS[a].slice(1)}
                value={allergens[a] ?? 'not_stated'}
                onChange={(v) => setAllergens((cur) => ({ ...cur, [a]: v as AllergenStatus }))}
                options={STATUS_OPTIONS}
              />
            ))}
          </div>
        </fieldset>
        {blocked && restaurantId !== null ? <p className="iv-note">{blocked}</p> : null}
        {warning ? (
          <p role="status" className="iv-said" data-testid="ivn-kcal-warning">
            {warning}
          </p>
        ) : null}
        <p className="ivn-acts">
          <button type="submit" className="iv-btn iv-focus" data-seal="true" disabled={blocked !== null || save.isPending}>
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
          <button type="button" className="iv-btn iv-focus" onClick={onDone}>
            Cancel
          </button>
        </p>
        {said ? (
          <p role="alert" className="iv-said iv-said-alarm">
            {said}
          </p>
        ) : null}
      </form>
    </div>
  );
}
