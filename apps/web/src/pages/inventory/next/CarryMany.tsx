/**
 * Carry many goods at once (inventory r40): paste a list, one good a line.
 *
 * WHY
 * A kitchen starts with dozens of goods the wine library does not hold: flour,
 * lemons, napkins. "Carry this" takes one good per sheet, so a house's first
 * thirty foods were thirty sheets before anything could be counted.
 *
 * WHAT IT KEEPS FROM THE ONE-GOOD SHEET
 *  - The same write, POST /inventory/:rid/house-items, once per good, with the
 *    same kind and book unit (ADR 0070: whole g, ml or a count). Nothing is
 *    put on hand: stock arrives with a delivery or a count.
 *  - The house's own rule that a name is carried once
 *    (restaurant_inventory_house_declared_uidx): a name already carried is
 *    answered 409 and said as already carried, so sending a line again can
 *    never add it twice.
 *
 * WHAT IS NEW
 *  - One kind and one way of keeping for the whole list. A line may end in its
 *    par after a comma or a tab ("Bread flour, 5 kg"), read the way a count is
 *    read (iv-amount): a bare "5" for a weighed good is asked about, never
 *    guessed as 5 g or 5 kg.
 *  - A line already on the list, or listed twice, is left out and says so
 *    before anything is sent.
 *  - The goods go out four at a time, each line says its own result, and the
 *    sheet says the whole. A refused line or one whose outcome is not known can
 *    be sent again; a carried one cannot be sent twice from this opening.
 */
import { useId, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Select, Sheet } from '@/components/mudavym';
import { carryHouseItem, type CarryHouseItemBody } from '../../../services/api/inventory';
import { getErrorStatus } from '../../../services/api/client';
import { queryKeys } from '../../../lib/query-keys';
import { fmtCount } from './useInventoryNextData';
import { amountUnit } from './iv-amount';
import { writeFailure } from './iv-failure';
import {
  CARRIED_ONCE,
  CARRY_MANY_AT_ONCE,
  CARRY_MANY_MAX,
  carryManySummary,
  inTurns,
  parWords,
  readCarryLines,
  type CarryLine,
  type CarryManyKind,
  type CarryManyUom,
  type CarryOutcome,
} from './carry-lines';
import './count-many.css';

const KINDS: { value: CarryManyKind; label: string }[] = [
  { value: 'food', label: 'Food' },
  { value: 'supply', label: 'Supply' },
  { value: 'other', label: 'Other drink' },
];
const KEPT: { value: CarryManyUom; label: string }[] = [
  { value: 'g', label: 'By weight (kept in grams)' },
  { value: 'ml', label: 'By volume (kept in millilitres)' },
  { value: 'each', label: 'By count (each)' },
];
/** How a kind is usually kept, until the person picks. */
const KEPT_FOR: Record<CarryManyKind, CarryManyUom> = { food: 'g', supply: 'each', other: 'ml' };

interface CarryManyProps {
  restaurantId: string | null;
  /** Every name on the list, as written; a pasted line with one of them is left out. */
  listedNames: ReadonlyArray<string | null>;
  onClose: () => void;
}

export default function CarryMany({ restaurantId, listedNames, onClose }: CarryManyProps) {
  const queryClient = useQueryClient();
  const baseId = useId();
  const [kind, setKind] = useState<CarryManyKind>('food');
  const [picked, setPicked] = useState<CarryManyUom | null>(null);
  const uom = picked ?? KEPT_FOR[kind];
  const [text, setText] = useState('');
  // Keyed by the lower-cased name: a line keeps its result while the list stands.
  const [outcomes, setOutcomes] = useState<Record<string, CarryOutcome>>({});
  const [sending, setSending] = useState(false);
  const [summary, setSummary] = useState<{ text: string; alarm: boolean } | null>(null);

  const listed = useMemo(
    () => new Set(listedNames.filter((n): n is string => typeof n === 'string').map((n) => n.trim().toLowerCase())),
    [listedNames],
  );
  const lines = useMemo(() => readCarryLines(text, uom, listed), [text, uom, listed]);
  const started = Object.keys(outcomes).length > 0;
  const done = (l: CarryLine) => {
    const k = outcomes[l.name.toLowerCase()]?.kind;
    return k === 'carried' || k === 'already';
  };
  const toSend = lines.filter((l) => l.skip === null && !done(l));
  const problems = toSend.filter((l) => l.problem !== null);
  const ready = toSend.filter((l) => l.problem === null);
  const tooMany = lines.length > CARRY_MANY_MAX;

  const send = async () => {
    if (restaurantId === null) return;
    const batch = ready;
    setSending(true);
    setSummary(null);
    const got: Record<string, CarryOutcome> = {};
    await inTurns(batch, CARRY_MANY_AT_ONCE, async (l) => {
      const body: CarryHouseItemBody = { kind, uom, displayName: l.name };
      if (l.par !== null) body.thresholdMin = l.par;
      let outcome: CarryOutcome;
      try {
        await carryHouseItem(body, restaurantId);
        outcome = { kind: 'carried' };
      } catch (e) {
        outcome =
          getErrorStatus(e) === 409
            ? { kind: 'already' }
            : (() => {
                const f = writeFailure(e, { refused: 'Not added', act: `${l.name} was added`, check: CARRIED_ONCE });
                return f.unknown ? { kind: 'unknown' as const, text: f.text } : { kind: 'refused' as const, text: f.text };
              })();
      }
      got[l.name.toLowerCase()] = outcome;
      setOutcomes((prev) => ({ ...prev, [l.name.toLowerCase()]: outcome }));
    });
    void queryClient.invalidateQueries({ queryKey: queryKeys.inventory.all });
    void queryClient.invalidateQueries({ queryKey: ['inventory-next'] });
    const sent = batch.map((l) => ({ name: l.name, outcome: got[l.name.toLowerCase()] }));
    const failed = sent.filter((s) => s.outcome.kind === 'refused' || s.outcome.kind === 'unknown').length;
    setSummary({
      text: carryManySummary(sent, {
        listed: lines.filter((l) => l.skip === 'listed').length,
        twice: lines.filter((l) => l.skip === 'twice').length,
      }),
      alarm: failed > 0,
    });
    setSending(false);
  };

  const n = ready.length;
  const blocked =
    restaurantId === null
      ? 'No house is open, so nothing can be added.'
      : tooMany
        ? `That is ${fmtCount(lines.length)} lines. Carry ${fmtCount(CARRY_MANY_MAX)} or fewer at a time.`
        : null;
  const label = sending
    ? 'Adding…'
    : problems.length > 0
      ? `Put right ${fmtCount(problems.length)} ${problems.length === 1 ? 'line' : 'lines'} first`
      : n === 0
        ? started
          ? 'Nothing left to carry'
          : 'Paste or type a list first'
        : started
          ? `Try the ${fmtCount(n)} again`
          : `Carry ${fmtCount(n)} ${n === 1 ? 'good' : 'goods'}`;

  return (
    <Sheet
      open
      wide
      bodyClassName="iv-sheet-body"
      onClose={onClose}
      label="Carry many goods at once: one good a line, each added with nothing on hand"
      eyebrow="Carry many"
      title="Goods the library does not hold"
      footer={<span>Stock is not entered here: it arrives with a delivery or a count.</span>}
    >
      <p className="iv-said">
        One good a line. End a line with its par after a comma if it has one, as “Bread flour, 5 kg”. A line already on the list, or
        listed twice, is left out.
      </p>
      <div className="ivc-form">
        {/* Fixed once anything is sent: a line sent again goes as the first was. */}
        <Select
          label="Kind"
          value={kind}
          disabled={sending || started}
          onChange={(v) => setKind((v || 'food') as CarryManyKind)}
          options={KINDS}
        />
        <div>
          <Select
            label="Kept"
            value={uom}
            disabled={sending || started}
            onChange={(v) => setPicked((v || null) as CarryManyUom | null)}
            options={KEPT}
          />
          <p className="iv-note" data-testid="carry-many-par-hint">
            A par: {amountUnit(uom).hint}
          </p>
        </div>
        <label className="ivc-label" htmlFor={`${baseId}-list`}>
          The list
        </label>
        <textarea
          id={`${baseId}-list`}
          className="iv-field iv-focus"
          rows={8}
          value={text}
          disabled={sending || started}
          onChange={(e) => setText(e.target.value)}
          placeholder={'Bread flour, 5 kg\nLemons\nNapkins, 200'}
        />
      </div>
      {lines.length > 0 && !tooMany ? (
        <ol className="cm-list" data-testid="carry-many-list">
          {lines.map((l) => {
            const outcome = outcomes[l.name.toLowerCase()];
            // What was sent says its own answer first: once the page re-reads,
            // a good just carried is on the list too, and must still read
            // "Carried.", never "left out".
            const said =
              l.skip === 'twice'
                ? 'Listed twice; carried once.'
                : outcome?.kind === 'carried'
                  ? 'Carried.'
                  : outcome?.kind === 'already'
                    ? listed.has(l.name.toLowerCase())
                      ? 'Already carried; nothing was added.'
                      : 'Already carried, though not on this list: it may have been removed. Nothing was added.'
                    : outcome
                      ? outcome.text
                      : l.skip === 'listed'
                        ? 'Already on the list; left out.'
                        : (l.problem ?? `Will be carried, ${parWords(uom, l.par)}.`);
            const alarm = l.problem !== null || outcome?.kind === 'refused' || outcome?.kind === 'unknown';
            return (
              <li key={`${l.line}-${l.name}`} className="cm-row" data-testid="carry-many-row">
                <span className="cm-name">
                  {l.name}
                  <span className="iv-note"> · line {fmtCount(l.line)}</span>
                </span>
                <span className={alarm ? 'iv-note iv-said-alarm cm-said' : 'iv-note cm-said'}>{said}</span>
              </li>
            );
          })}
        </ol>
      ) : null}
      {blocked ? (
        <p className="iv-note" data-testid="carry-many-blocked">
          {blocked}
        </p>
      ) : null}
      <div style={{ marginTop: 14 }}>
        <button
          type="button"
          className="iv-btn iv-focus"
          data-seal="true"
          disabled={sending || blocked !== null || problems.length > 0 || n === 0}
          onClick={() => void send()}
        >
          {label}
        </button>
      </div>
      {summary ? (
        <p
          role={summary.alarm ? 'alert' : 'status'}
          className={summary.alarm ? 'iv-said iv-said-alarm' : 'iv-said'}
          style={{ marginTop: 12 }}
          data-testid="carry-many-summary"
        >
          {summary.text}
        </p>
      ) : null}
    </Sheet>
  );
}
