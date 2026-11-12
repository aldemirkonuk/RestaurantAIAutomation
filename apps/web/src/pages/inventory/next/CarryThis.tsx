/**
 * "Carry this" — the house starts keeping a good the wine library does not
 * hold: a food, a supply, or a drink outside the library (proposal §3 I12).
 *
 * POST /inventory/:rid/house-items. Stock is never entered here; it arrives
 * as a received lot, so the new row starts at none on hand. Stock is kept in
 * whole small units (ADR 0070): grams, millilitres or a count. A person picks
 * kg or l as well, and types the par in it; the form turns it into g or ml.
 */
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Select, Sheet } from '@/components/mudavym';
import { carryHouseItem, type CarryHouseItemBody, type CarriedHouseItem } from '../../../services/api/inventory';
import { getErrorStatus } from '../../../services/api/client';
import { writeFailure } from './iv-failure';
import { amountInChosenUnit, chosenUnitWhy, MEASURE_WORDS } from './iv-amount';

export type CarryKind = 'food' | 'supply' | 'other';
/** What the book keeps (ADR 0070): whole grams, millilitres or a count. The server refuses kg and l. */
export type CarryUom = 'g' | 'ml' | 'each';
/** What a person picks: a kitchen weighs in kg and a bar measures in litres, so those are offered too. */
export type CarryPick = 'kg' | 'g' | 'l' | 'ml' | 'each';

const KINDS: { value: CarryKind; label: string }[] = [
  { value: 'food', label: 'Food' },
  { value: 'supply', label: 'Supply' },
  { value: 'other', label: 'Other drink' },
];

/**
 * Each pick, the book unit it is kept in, and how big one of it is in that
 * unit. kg and l are not stored: 1.25 kg is kept as 1,250 g, so nothing the
 * person typed is rounded and the ledger stays in whole small units.
 */
const PICKS: Record<CarryPick, { label: string; short: string; base: CarryUom; size: number }> = {
  kg: { label: 'kilograms (kg)', short: 'kg', base: 'g', size: 1000 },
  g: { label: 'grams (g)', short: 'g', base: 'g', size: 1 },
  l: { label: 'litres (l)', short: 'l', base: 'ml', size: 1000 },
  ml: { label: 'millilitres (ml)', short: 'ml', base: 'ml', size: 1 },
  each: { label: 'each', short: 'each', base: 'each', size: 1 },
};
const UNITS = (Object.keys(PICKS) as CarryPick[]).map((value) => ({ value, label: PICKS[value].label }));
/** The unit a kind is usually weighed or measured in, until the person picks one. */
const UNIT_FOR: Record<CarryKind, CarryPick> = { food: 'kg', supply: 'each', other: 'l' };
const UNIT_HINT: Record<CarryPick, string> = {
  kg: 'Weighed in kilograms. We keep it in grams, so 1.25 kg is kept as 1,250 g; the list shows kg.',
  g: 'Weighed in grams; the list shows kg once it passes 1,000 g.',
  l: 'Measured in litres. We keep it in millilitres, so 0.75 l is kept as 750 ml; the list shows l.',
  ml: 'Measured in millilitres; the list shows l once it passes 1,000 ml.',
  each: 'We keep a count of each one.',
};

/**
 * The par as typed, in the picked unit, as a whole amount of the book's unit:
 * "2.5" with kg picked is 2,500 g, "500 g" is 500 g, "75 cl" with l picked is
 * 750 ml. Null when it is not one (a negative, a part of a gram, a word).
 */
export function parInBook(typed: string, pick: CarryPick): number | null {
  const p = PICKS[pick];
  if (p.base === 'each') return /^\d{1,6}$/.test(typed.trim()) ? Number(typed.trim()) : null;
  return amountInChosenUnit(typed, { ...MEASURE_WORDS[p.base], '': p.size });
}

/** "2.5 kg, kept as 2,500 g": what the par will be, said back before anything is added. */
function parSaidBack(n: number, pick: CarryPick): string {
  const p = PICKS[pick];
  const inPick = (n / p.size).toLocaleString('en-GB', { maximumFractionDigits: 3 });
  if (p.base === 'each') return `Par ${inPick} each.`;
  return p.size === 1
    ? `Par ${inPick} ${p.short}.`
    : `Par ${inPick} ${p.short}, kept as ${n.toLocaleString('en-GB')} ${p.base}.`;
}

export default function CarryThis({
  restaurantId,
  onClose,
  onCarried,
}: {
  restaurantId: string | null;
  onClose: () => void;
  onCarried: (item: CarriedHouseItem) => void;
}) {
  const [kind, setKind] = useState<CarryKind>('food');
  const [picked, setPicked] = useState<CarryPick | null>(null);
  const [name, setName] = useState('');
  const [par, setPar] = useState('');
  const [said, setSaid] = useState<string | null>(null);
  const unit = picked ?? UNIT_FOR[kind];
  const pick = PICKS[unit];
  const trimmed = name.trim();
  const parN = par.trim() === '' ? null : parInBook(par, unit);
  const parBad = par.trim() !== '' && parN === null;

  const carry = useMutation({
    mutationFn: (body: CarryHouseItemBody) => carryHouseItem(body, restaurantId ?? undefined),
    onSuccess: (item) => onCarried(item),
    onError: (e) => {
      const status = getErrorStatus(e);
      if (status === 409) setSaid(`This house already carries ${trimmed}. Nothing was added.`);
      else if (status === 400)
        setSaid('The server did not accept it: stock is kept in whole small units (grams, millilitres or each). Nothing was added.');
      else setSaid(writeFailure(e, { refused: 'Nothing was added', act: `${trimmed} was added`, check: 'Look for it on the list before trying again.' }).text);
    },
  });

  const blocked =
    restaurantId === null
      ? 'No house is open, so nothing can be added.'
      : trimmed === ''
        ? 'Give it a name.'
        : trimmed.length > 120
          ? 'Keep the name to 120 characters.'
          : parBad
            ? pick.base === 'each'
              ? 'A par is a whole number, or leave it empty.'
              : (chosenUnitWhy(par, pick.short) ??
                `A par is an amount in ${pick.short}, as 2.5 or 500 g, down to a whole ${pick.base}; or leave it empty.`)
            : null;

  const submit = () => {
    if (blocked || carry.isPending) return;
    setSaid(null);
    const body: CarryHouseItemBody = { kind, uom: pick.base, displayName: trimmed };
    if (parN !== null) body.thresholdMin = parN;
    carry.mutate(body);
  };

  return (
    <Sheet
      open
      onClose={onClose}
      label="Carry a food, a supply or another drink. Adding writes one item with nothing on hand; leaving writes nothing."
      eyebrow="Carry this"
      title="A good the library does not hold"
      footer={<span>Stock is not entered here: it arrives with a delivery or a count.</span>}
    >
      <form
        className="ivc-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Select
          label="Kind"
          value={kind}
          onChange={(v) => setKind((v || 'food') as CarryKind)}
          options={KINDS}
        />
        <div>
          <Select label="Unit" value={unit} onChange={(v) => setPicked((v || null) as CarryPick | null)} options={UNITS} />
          <p className="iv-note" data-testid="ivc-unit-hint">
            {UNIT_HINT[unit]}
          </p>
        </div>
        <label className="ivc-label">
          Name
          <input
            className="iv-field iv-focus"
            value={name}
            maxLength={160}
            onChange={(e) => setName(e.target.value)}
            placeholder="Flour, napkins, house lemonade…"
          />
        </label>
        <label className="ivc-label">
          Par <span className="ivd-dim">(optional, in {pick.short})</span>
          <input
            className="iv-field iv-focus"
            inputMode={pick.base === 'each' ? 'numeric' : 'decimal'}
            value={par}
            onChange={(e) => setPar(e.target.value)}
          />
        </label>
        {parN !== null && parN > 0 ? (
          <p className="iv-note" data-testid="ivc-par-said">
            {parSaidBack(parN, unit)}
          </p>
        ) : null}
        {blocked && trimmed !== '' ? <p className="iv-note">{blocked}</p> : null}
        <button type="submit" className="iv-btn iv-focus" data-seal="true" disabled={blocked !== null || carry.isPending}>
          {carry.isPending ? 'Adding…' : 'Carry this'}
        </button>
        {said ? (
          <p role="alert" className="iv-said iv-said-alarm">
            {said}
          </p>
        ) : null}
      </form>
    </Sheet>
  );
}
