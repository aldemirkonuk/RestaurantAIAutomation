/**
 * "Describe the taste" (TasteCard): any person who works here may say how a
 * good tastes. Nothing is prefilled; an axis left at "Not said" stays unknown
 * and is not sent. Choosing "none" is a statement and sends a real 0.
 */
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { addHouseTaste, AXIS_KEYS, type AxisKey, type HouseTasteBody, type TasteData } from '../../../services/api/taste';
import { AXIS_LABEL, DESCRIPTOR_GROUPS, ORDINAL_STEPS, TEXTURE_IDS, type Band } from './taste-words';

/** The axes grouped for the form; aroma sits behind a disclosure so the first view stays short. */
const GROUPS: Array<{ title: string; keys: AxisKey[]; folded?: boolean }> = [
  { title: 'Basic tastes', keys: ['sweet', 'sour', 'salty', 'bitter', 'umami'] },
  { title: 'Feel', keys: ['fat', 'heat', 'alcohol', 'astringency', 'body', 'carbonation'] },
  { title: 'Aroma', keys: AXIS_KEYS.filter((k) => !['sweet', 'sour', 'salty', 'bitter', 'umami', 'fat', 'heat', 'alcohol', 'astringency', 'body', 'carbonation'].includes(k)), folded: true },
];

const NOT_SAID = '';
const NOTHING_SET = 'Pick a word, set a level or write a note to save.';
const UNCONFIRMED = 'The answer did not come back, so it may or may not have been saved. Look at the card before trying again.';

export interface TasteFormProps {
  restaurantId: string | null;
  itemId: string;
  onSaved: (fresh: TasteData) => void;
  onCancel: () => void;
  /** A save whose outcome is unknown: the card re-reads. */
  onUnconfirmed: () => void;
}

export function buildBody(levels: Partial<Record<AxisKey, Band>>, chosen: string[], note: string): HouseTasteBody | null {
  const axes: NonNullable<HouseTasteBody['axes']> = {};
  for (const k of AXIS_KEYS) {
    const step = ORDINAL_STEPS.find((s) => s.word === levels[k]);
    if (step) axes[k] = { v: step.v };
  }
  const descriptors = chosen.filter((c) => !TEXTURE_IDS.has(c));
  const texture = chosen.filter((c) => TEXTURE_IDS.has(c));
  const text = note.trim();
  const anyAxis = Object.keys(axes).length > 0;
  if (!anyAxis && chosen.length === 0 && text === '') return null;
  return {
    ...(anyAxis ? { axes } : {}),
    ...(descriptors.length ? { descriptors } : {}),
    ...(texture.length ? { texture } : {}),
    ...(text ? { note: text } : {}),
    method: anyAxis ? 'ordinal' : 'cata',
  };
}

export default function TasteForm({ restaurantId, itemId, onSaved, onCancel, onUnconfirmed }: TasteFormProps) {
  const [levels, setLevels] = useState<Partial<Record<AxisKey, Band>>>({});
  const [chosen, setChosen] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [said, setSaid] = useState<string | null>(null);
  const body = buildBody(levels, chosen, note);

  const save = useMutation({
    mutationFn: (b: HouseTasteBody) => addHouseTaste('good', itemId, b, restaurantId ?? undefined),
    onSuccess: (r) => {
      if (r.state === 'ready') return onSaved(r.data);
      if (r.state === 'absent') return setSaid('Taste notes are not switched on for this house yet. Nothing was saved.');
      if (r.reason) return setSaid(`${r.reason} Nothing was saved.`);
      if (r.status !== null && r.status >= 400 && r.status < 500) return setSaid('That was not accepted. Nothing was saved.');
      onUnconfirmed();
      return setSaid(UNCONFIRMED);
    },
    onError: () => {
      onUnconfirmed();
      setSaid(UNCONFIRMED);
    },
  });

  const toggle = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  return (
    <form
      className="tf"
      data-testid="taste-form"
      onSubmit={(ev) => {
        ev.preventDefault();
        if (body && !save.isPending) {
          setSaid(null);
          save.mutate(body);
        }
      }}
    >
      <h4 className="ivd-used-h">Describe the taste</h4>
      {DESCRIPTOR_GROUPS.map((g) => (
        <fieldset key={g.title} className="tf-set">
          <legend>{g.title}</legend>
          <div className="tf-chips">
            {g.items.map((i) => (
              <button
                key={i.id}
                type="button"
                className="iv-btn iv-focus tf-chip"
                aria-pressed={chosen.includes(i.id)}
                data-on={chosen.includes(i.id) ? 'true' : undefined}
                data-testid={`taste-chip-${i.id}`}
                onClick={() => toggle(i.id)}
              >
                {i.label}
              </button>
            ))}
          </div>
        </fieldset>
      ))}
      {GROUPS.map((g) => {
        const fields = (
          <div className="tf-grid">
            {g.keys.map((k) => (
              <label key={k} className="tf-level">
                <span>{AXIS_LABEL[k]}</span>
                <select
                  className="iv-focus"
                  value={levels[k] ?? NOT_SAID}
                  data-testid={`taste-level-${k}`}
                  onChange={(ev) => {
                    const w = ev.target.value as Band | '';
                    setLevels((l) => {
                      const next = { ...l };
                      if (w === NOT_SAID) delete next[k];
                      else next[k] = w;
                      return next;
                    });
                  }}
                >
                  <option value={NOT_SAID}>Not said</option>
                  {ORDINAL_STEPS.map((s) => (
                    <option key={s.word} value={s.word}>
                      {s.word}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        );
        return g.folded ? (
          <details key={g.title} className="tf-set">
            <summary className="iv-focus">{g.title}</summary>
            {fields}
          </details>
        ) : (
          <fieldset key={g.title} className="tf-set">
            <legend>{g.title}</legend>
            {fields}
          </fieldset>
        );
      })}
      <label className="tf-note">
        <span>A note (optional)</span>
        <textarea className="iv-focus" rows={3} maxLength={1000} value={note} data-testid="taste-note" onChange={(ev) => setNote(ev.target.value)} />
      </label>
      {body === null ? (
        <p className="iv-note" data-testid="taste-form-hint">
          {NOTHING_SET}
        </p>
      ) : null}
      {said ? (
        <p role="alert" className="iv-said iv-said-alarm" data-testid="taste-form-said">
          {said}
        </p>
      ) : null}
      <p className="tc-acts">
        <button type="submit" className="iv-btn iv-focus" data-seal="true" disabled={body === null || save.isPending} data-testid="taste-save">
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="iv-btn iv-focus" onClick={onCancel} disabled={save.isPending}>
          Cancel
        </button>
      </p>
    </form>
  );
}
