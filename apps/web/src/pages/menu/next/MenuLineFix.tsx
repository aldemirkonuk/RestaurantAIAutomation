/**
 * Correct a line of a read menu, or leave it out, BEFORE the menu is made
 * current (r36 audit N2).
 *
 * A read menu used to be read-only until it was current: a misread name made a
 * second good beside the house's own when the menu was chosen, a misread price
 * went to Inventory, and a drink read as a dish (or a dish read as a drink)
 * could not be moved. The only ways out were to choose the menu and repair the
 * prices afterwards, or to read the file again.
 *
 * Here an owner or a manager corrects the name, the section, the producer, the
 * vintage or a price of any line of a menu that is not current, through the
 * same `PATCH /menus/items/:id` the current menu uses (on a kept menu it moves
 * no house price), or leaves a line out (`PATCH .../discard`, a soft remove:
 * the row stays on record and is never carried). The plan above is read again
 * after each change, so what choosing the menu would do is always the plan for
 * the lines as they now stand. A corrected name is matched to the house's goods
 * again by that plan ("fits the house's own goods"), so a misread wine can be
 * linked to the house's own before it becomes a twin.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  discardMenuItem,
  getMenuVersion,
  reviewMenuItem,
  type EditableMenuItemField,
  type MenuLine,
} from '../../../services/api/menus';
import { formatMoney } from '../../../lib/currency';
import { useHouseCurrencyCode } from '../../../hooks/queries/useHouseCurrencyCode';
import { useAuthStore } from '../../../stores';

/** The section a dish is filed under: the gateway's kitchen test reads "food" as a dish. */
export const DISH_SECTION = 'food';

/**
 * The drink sections a reader files a line under (the gateway's
 * MENU_CATEGORY_VOCABULARY), with the words a person reads.
 */
export const DRINK_SECTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'red', label: 'Red wine' },
  { value: 'white', label: 'White wine' },
  { value: 'rose', label: 'Rosé wine' },
  { value: 'sparkling', label: 'Sparkling wine' },
  { value: 'orange', label: 'Orange wine' },
  { value: 'dessert', label: 'Dessert wine' },
  { value: 'fortified', label: 'Fortified wine' },
  { value: 'beer', label: 'Beer' },
  { value: 'cider', label: 'Cider' },
  { value: 'sake', label: 'Sake' },
  { value: 'cocktail', label: 'Cocktail' },
  { value: 'spirit', label: 'Spirit' },
  { value: 'whiskey', label: 'Whiskey' },
  { value: 'soft drink', label: 'Soft drink' },
  { value: 'non-alcoholic', label: 'Non-alcoholic drink' },
];

/** The fields a person corrects here, in the order they are sent. */
const FIELDS: ReadonlyArray<{ field: EditableMenuItemField; words: string }> = [
  { field: 'name', words: 'name' },
  { field: 'category', words: 'section' },
  { field: 'producer', words: 'producer' },
  { field: 'vintage', words: 'vintage' },
  { field: 'bottle_price', words: 'bottle price' },
  { field: 'by_glass_price', words: 'glass price' },
];

export type Draft = Record<'name' | 'category' | 'producer' | 'vintage' | 'bottle_price' | 'by_glass_price', string>;

const text = (v: unknown) => (v === null || v === undefined ? '' : String(v));

/** The line as the form starts: what is stored, a price as its plain number. */
export function draftOf(line: MenuLine): Draft {
  return {
    name: text(line.name),
    category: text(line.category),
    producer: text(line.producer),
    vintage: text(line.vintage),
    bottle_price: text(line.bottle_price),
    by_glass_price: text(line.by_glass_price),
  };
}

/**
 * What a save sends: each field whose value changed, trimmed. A field that
 * held a value and is now empty cannot be sent (the gateway takes no empty
 * value), and is refused in words before anything is sent.
 */
export function changesOf(
  line: MenuLine,
  draft: Draft,
): { changes: Array<{ field: EditableMenuItemField; value: string; words: string }>; refused: string | null } {
  const was = draftOf(line);
  const changes: Array<{ field: EditableMenuItemField; value: string; words: string }> = [];
  const emptied: string[] = [];
  for (const { field, words } of FIELDS) {
    const key = field as keyof Draft;
    const now = draft[key].trim();
    if (now === was[key].trim()) continue;
    if (now === '') {
      emptied.push(words);
      continue;
    }
    changes.push({ field, value: now, words });
  }
  if (emptied.length > 0) {
    return {
      changes: [],
      refused: `The ${emptied.join(' and ')} cannot be emptied here. Leave the line out instead, or type what the menu says. Nothing was changed.`,
    };
  }
  return { changes, refused: null };
}

/** A line's section in words: a dish, a drink section, or as the reader wrote it. */
export function sectionWords(line: MenuLine): string {
  if (line.kitchen_line) return 'Dish';
  const known = DRINK_SECTIONS.find((s) => s.value === text(line.category).toLowerCase().trim());
  if (known) return known.label;
  return line.category ? `"${line.category}"` : 'No section';
}

/** The gateway's own words for a refusal, never a bare status. */
function reasonOf(err: unknown): string {
  const e = err as { response?: { status?: number; data?: { message?: unknown } }; message?: string };
  if (e?.response?.status === 403) return 'only an owner or a manager can do that';
  const m = e?.response?.data?.message;
  if (typeof m === 'string' && m) return m.replace(/\.$/, '');
  if (Array.isArray(m) && m.length) return String(m[0]);
  return e?.message || 'no reason was given';
}

function listWords(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

function LineForm({
  line,
  onSaved,
  onClose,
}: {
  line: MenuLine;
  onSaved: (said: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(line));
  const [refused, setRefused] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async (changes: Array<{ field: EditableMenuItemField; value: string; words: string }>) => {
      // One field at a time, in order: a refusal names what was already saved.
      const done: string[] = [];
      for (const c of changes) {
        try {
          await reviewMenuItem(line.id, c.field, c.value);
        } catch (err) {
          const saved = done.length ? ` The ${listWords(done)} ${done.length === 1 ? 'was' : 'were'} corrected.` : ' Nothing was changed.';
          throw new Error(`The ${c.words} was not corrected: ${reasonOf(err)}.${saved}`);
        }
        done.push(c.words);
      }
      return done;
    },
    onSuccess: (done) => {
      onSaved(`${draft.name.trim() || line.name}: ${listWords(done)} corrected. What choosing this menu would do is read again.`);
      onClose();
    },
    onError: (err) => {
      setRefused((err as Error).message);
      // A field saved before the refusal is on the line: the plan is read again.
      onSaved('');
    },
  });
  const id = (f: string) => `fix-${line.id}-${f}`;
  const sectionKnown = draft.category === DISH_SECTION || DRINK_SECTIONS.some((s) => s.value === draft.category);
  const set = (k: keyof Draft) => (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  return (
    <form
      className="cl-row-controls"
      style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginTop: 6 }}
      data-testid="menu-line-fix-form"
      onSubmit={(e) => {
        e.preventDefault();
        const { changes, refused: no } = changesOf(line, draft);
        if (no) return setRefused(no);
        if (changes.length === 0) return setRefused('Nothing differs from the line as read, so nothing was changed.');
        setRefused(null);
        save.mutate(changes);
      }}
    >
      <label className="cl-dim" style={{ fontSize: 12 }} htmlFor={id('name')}>
        Name
      </label>
      <input id={id('name')} className="cl-field cl-focus" value={draft.name} onChange={set('name')} style={{ minWidth: 160 }} />
      <label className="cl-dim" style={{ fontSize: 12 }} htmlFor={id('category')}>
        Section
      </label>
      <select id={id('category')} className="cl-field cl-focus" value={draft.category} onChange={set('category')}>
        {!sectionKnown ? <option value={draftOf(line).category}>{draftOf(line).category ? `As read: ${draftOf(line).category}` : 'No section'}</option> : null}
        <option value={DISH_SECTION}>Dish (kitchen)</option>
        {DRINK_SECTIONS.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
      <label className="cl-dim" style={{ fontSize: 12 }} htmlFor={id('producer')}>
        Producer
      </label>
      <input id={id('producer')} className="cl-field cl-focus" value={draft.producer} onChange={set('producer')} style={{ width: 140 }} />
      <label className="cl-dim" style={{ fontSize: 12 }} htmlFor={id('vintage')}>
        Vintage
      </label>
      <input id={id('vintage')} className="cl-field cl-focus cl-num" inputMode="numeric" value={draft.vintage} onChange={set('vintage')} style={{ width: 70 }} />
      <label className="cl-dim" style={{ fontSize: 12 }} htmlFor={id('bottle_price')}>
        Bottle price
      </label>
      <input
        id={id('bottle_price')}
        className="cl-field cl-focus cl-num"
        inputMode="decimal"
        autoComplete="off"
        value={draft.bottle_price}
        onChange={set('bottle_price')}
        style={{ width: 80 }}
      />
      <label className="cl-dim" style={{ fontSize: 12 }} htmlFor={id('by_glass_price')}>
        Glass price
      </label>
      <input
        id={id('by_glass_price')}
        className="cl-field cl-focus cl-num"
        inputMode="decimal"
        autoComplete="off"
        value={draft.by_glass_price}
        onChange={set('by_glass_price')}
        style={{ width: 80 }}
      />
      <button type="submit" className="cl-btn cl-ink cl-focus" disabled={save.isPending}>
        {save.isPending ? 'Saving…' : 'Save'}
      </button>
      <button type="button" className="cl-btn cl-focus" disabled={save.isPending} onClick={onClose}>
        Cancel
      </button>
      {refused ? (
        <span role="alert" className="cl-note" style={{ display: 'block', flexBasis: '100%' }} data-testid="menu-line-fix-refused">
          {refused}
        </span>
      ) : null}
    </form>
  );
}

export function MenuLineFix({ menuId, onChanged }: { menuId: string; onChanged: (said: string) => void }) {
  const queryClient = useQueryClient();
  const house = useAuthStore((s) => s.activeRestaurantId) ?? null;
  const currency = useHouseCurrencyCode();
  const [open, setOpen] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['menu', 'version', menuId], queryFn: () => getMenuVersion(menuId) });
  const reread = () => void queryClient.invalidateQueries({ queryKey: ['menu', 'version', menuId] });
  const leave = useMutation({
    mutationFn: (line: MenuLine) => {
      if (!house) throw new Error('this session names no house');
      return discardMenuItem(house, line.id);
    },
    onSuccess: (_r, line) => {
      setLeaving(null);
      reread();
      onChanged(`${line.name} is left out of this menu. It will not be carried.`);
    },
  });

  if (q.isLoading) return null;
  if (q.isError || !q.data) {
    return (
      <p className="cl-note" role="alert" style={{ marginTop: 12 }} data-testid="menu-line-fix-error">
        This menu&apos;s lines could not be read ({reasonOf(q.error)}), so none can be corrected here yet.
      </p>
    );
  }
  const lines = q.data.items;
  if (lines.length === 0) return null;
  const price = (n: number | null) => (n === null || n === undefined ? null : formatMoney(n, currency));
  return (
    <details style={{ marginTop: 12 }} data-testid="menu-line-fix">
      <summary className="cl-said cl-focus" style={{ cursor: 'pointer' }}>
        Correct a line before this menu is made current ({lines.length})
      </summary>
      <p className="cl-note" style={{ marginTop: 6 }}>
        A name, a section or a price read wrongly is corrected here, before anything reaches the house. Set a dish read as
        a drink to Dish, or the other way round. Leave a line out to drop it: it is not carried.
      </p>
      <ul className="cl-said" style={{ paddingLeft: 18, marginTop: 4 }}>
        {lines.map((l) => {
          const prices = [
            price(l.bottle_price) ? `bottle ${price(l.bottle_price)}` : null,
            price(l.by_glass_price) ? `glass ${price(l.by_glass_price)}` : null,
          ].filter(Boolean);
          return (
            <li key={l.id} data-testid="menu-line-fix-line" style={{ marginTop: 6 }}>
              <span>
                {l.name}
                {l.vintage ? ` ${l.vintage}` : ''}
              </span>
              <span className="cl-dim">
                {' '}
                · {sectionWords(l)}
                {l.producer ? ` · ${l.producer}` : ''} · {prices.length ? prices.join(', ') : 'no price'}
              </span>
              {l.price_flag_note ? (
                <span className="cl-note" style={{ display: 'block' }} data-testid="menu-line-fix-note">
                  {l.price_flag_note}
                </span>
              ) : null}
              {open === l.id ? (
                <LineForm
                  line={l}
                  onClose={() => setOpen(null)}
                  onSaved={(s) => {
                    reread();
                    onChanged(s);
                  }}
                />
              ) : leaving === l.id ? (
                <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginTop: 4 }}>
                  <span className="cl-dim">Leave {l.name} out? It is not carried, and it cannot be brought back on this menu.</span>
                  <button
                    type="button"
                    className="cl-btn cl-ink cl-focus"
                    disabled={leave.isPending}
                    onClick={() => leave.mutate(l)}
                  >
                    {leave.isPending ? 'Leaving it out…' : 'Leave it out'}
                  </button>
                  <button type="button" className="cl-btn cl-focus" disabled={leave.isPending} onClick={() => setLeaving(null)}>
                    Keep it
                  </button>
                </span>
              ) : (
                <span style={{ display: 'inline-flex', gap: 6, marginLeft: 8 }}>
                  <button
                    type="button"
                    className="cl-btn cl-focus"
                    onClick={() => {
                      setLeaving(null);
                      setOpen(l.id);
                    }}
                    aria-label={`Correct ${l.name}`}
                  >
                    Correct
                  </button>
                  <button
                    type="button"
                    className="cl-btn cl-focus"
                    onClick={() => {
                      setOpen(null);
                      setLeaving(l.id);
                    }}
                    aria-label={`Leave ${l.name} out of this menu`}
                  >
                    Leave out
                  </button>
                </span>
              )}
              {leave.isError && leave.variables?.id === l.id ? (
                <span role="alert" className="cl-note" style={{ display: 'block' }} data-testid="menu-line-fix-leave-refused">
                  It was not left out: {reasonOf(leave.error)}. Nothing was changed.
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

export default MenuLineFix;
