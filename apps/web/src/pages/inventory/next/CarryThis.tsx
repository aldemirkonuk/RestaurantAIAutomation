/**
 * "Carry this" — the house starts keeping a good the wine library does not
 * hold: a food, a supply, or a drink outside the library (proposal §3 I12).
 *
 * POST /inventory/:rid/house-items. Stock is never entered here; it arrives
 * as a received lot, so the new row starts at none on hand. Stock is kept in
 * whole small units (ADR 0070): grams, millilitres or a count.
 */
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Select, Sheet } from '@/components/mudavym';
import { carryHouseItem, type CarryHouseItemBody, type CarriedHouseItem } from '../../../services/api/inventory';
import { getErrorStatus } from '../../../services/api/client';
import { writeFailure } from './iv-failure';

export type CarryKind = 'food' | 'supply' | 'other';
export type CarryUom = 'g' | 'ml' | 'each';

const KINDS: { value: CarryKind; label: string }[] = [
  { value: 'food', label: 'Food' },
  { value: 'supply', label: 'Supply' },
  { value: 'other', label: 'Other drink' },
];
const UNITS: { value: CarryUom; label: string }[] = [
  { value: 'g', label: 'grams' },
  { value: 'ml', label: 'millilitres' },
  { value: 'each', label: 'each' },
];
/** The unit a kind usually counts in, until the person picks one. */
const UNIT_FOR: Record<CarryKind, CarryUom> = { food: 'g', supply: 'each', other: 'ml' };
const UNIT_HINT: Record<CarryUom, string> = {
  g: 'We keep it in grams; the list shows kg.',
  ml: 'We keep it in millilitres; the list shows l.',
  each: 'We keep a count of each one.',
};

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
  const [uom, setUom] = useState<CarryUom | null>(null);
  const [name, setName] = useState('');
  const [par, setPar] = useState('');
  const [said, setSaid] = useState<string | null>(null);
  const unit = uom ?? UNIT_FOR[kind];
  const trimmed = name.trim();
  const parN = par.trim() === '' ? null : Number(par);
  const parBad = parN !== null && (!Number.isInteger(parN) || parN < 0);

  const carry = useMutation({
    mutationFn: (body: CarryHouseItemBody) => carryHouseItem(body, restaurantId ?? undefined),
    onSuccess: (item) => onCarried(item),
    onError: (e) => {
      const status = getErrorStatus(e);
      if (status === 409) setSaid(`This house already carries ${trimmed}. Nothing was added.`);
      else if (status === 400)
        setSaid('The server did not accept it: stock is kept in whole small units, so choose grams, millilitres or each. Nothing was added.');
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
            ? 'A par is a whole number, or leave it empty.'
            : null;

  const submit = () => {
    if (blocked || carry.isPending) return;
    setSaid(null);
    const body: CarryHouseItemBody = { kind, uom: unit, displayName: trimmed };
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
          <Select label="Unit" value={unit} onChange={(v) => setUom((v || null) as CarryUom | null)} options={UNITS} />
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
          Par <span className="ivd-dim">(optional, in {UNITS.find((u) => u.value === unit)?.label})</span>
          <input className="iv-field iv-focus" inputMode="numeric" value={par} onChange={(e) => setPar(e.target.value)} />
        </label>
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
