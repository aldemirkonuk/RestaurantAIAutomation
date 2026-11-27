/**
 * The loose lines of every drink, in one queue (r108 drinks-g9). Above the
 * /cocktails list an owner or manager reads "9 lines in 5 drinks are not
 * linked to your shelf. Link them"; the sheet lists each name once, with the
 * one shelf good of that name proposed, and links it in every drink that has
 * it through that drink's own save (linkLines.ts). Each drink says its own
 * outcome; then the queue and the list's figures are read again.
 *
 * MOTION (MOTIONS.md, ADR 0112). A linked group leaves the list at once, with
 * no exit animation. The groups that stay slide to their new place with the
 * list's own FLIP (`useSortFlip`, #2128): 180 ms of transform on the house
 * curve. Under reduced motion nothing animates at all.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Sheet } from '../../../../components/mudavym/Sheet';
import { useAuth } from '../../../../contexts/AuthContext';
import type { LooseLineGroup, LooseLines as Answer, ShelfItem } from '../../../../services/api/recipes';
import { useSortFlip } from '../useSortFlip';
import { drinkFiguresKey, recipeKey } from './useRecipe';
import ShelfPicker from './ShelfPicker';
import { count, linkBody, looseLinesKey, saveEach, useLooseLines, type LinkOutcome } from './linkLines';

export const LOOSE_UNREAD = 'Which lines are not linked to your shelf could not be read just now.';

export function looseSentence(a: Pick<Answer, 'lineCount' | 'drinkCount'>): string {
  return `${count(a.lineCount, 'line', 'lines')} in ${count(a.drinkCount, 'drink', 'drinks')} ${a.lineCount === 1 ? 'is' : 'are'} not linked to your shelf.`;
}

function GroupRow({ g, busy, onLink }: { g: LooseLineGroup; busy: boolean; onLink: (g: LooseLineGroup, item: ShelfItem) => void }) {
  const [chosen, setChosen] = useState<ShelfItem | null>(g.proposed);
  const [picking, setPicking] = useState(!g.proposed);
  return (
    <tr data-row={g.key} data-testid={`loose-group-${g.key}`}>
      <td style={{ padding: '8px 0', verticalAlign: 'top' }}>
        <strong>{g.label}</strong>{' '}
        <span className="cl-dim">
          {count(g.lines.length, 'line', 'lines')} in {count(g.drinkCount, 'drink', 'drinks')}
        </span>
        {g.sameName > 1 && !chosen ? (
          <p className="cl-note">{g.sameName} goods on your shelf have this name; choose the one these lines pour from.</p>
        ) : null}
        {chosen ? (
          <p className="cl-said" style={{ margin: '4px 0' }} data-testid="loose-chosen">
            Link to {chosen.name}{' '}
            <button type="button" className="cl-btn cl-focus" onClick={() => setPicking(true)} disabled={busy}>
              Choose another
            </button>
          </p>
        ) : null}
        {picking ? (
          <ShelfPicker
            initial={g.label}
            onPick={(item) => {
              setChosen(item);
              setPicking(false);
            }}
            onClose={() => setPicking(false)}
          />
        ) : null}
        <button
          type="button"
          className="cl-btn cl-focus"
          data-testid="loose-link"
          disabled={!chosen || busy}
          onClick={() => chosen && onLink(g, chosen)}
        >
          Link in {count(g.drinkCount, 'drink', 'drinks')}
        </button>
      </td>
    </tr>
  );
}

function LooseSheet({ data, onClose }: { data: Answer; onClose: () => void }) {
  const { activeRestaurantId } = useAuth();
  const qc = useQueryClient();
  const [shown, setShown] = useState(data);
  const [outcomes, setOutcomes] = useState<LinkOutcome[]>([]);
  const [busy, setBusy] = useState(false);
  const body = useRef<HTMLTableSectionElement | null>(null);
  const order = useMemo(() => shown.groups.map((g) => g.key).join('|'), [shown]);
  const flip = useSortFlip(body, order);
  // A new read: measure where each group is, then draw the new list, so the groups that stay slide.
  useEffect(() => {
    if (data === shown) return;
    flip.before();
    setShown(data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const link = async (g: LooseLineGroup, item: ShelfItem) => {
    if (!activeRestaurantId) return;
    setBusy(true);
    const byDrink = new Map<string, number[]>();
    for (const l of g.lines) byDrink.set(l.cocktailId, [...(byDrink.get(l.cocktailId) ?? []), l.index]);
    const jobs = [...byDrink.entries()].flatMap(([cocktailId, indices]) => {
      const drink = shown.drinks.find((d) => d.cocktailId === cocktailId);
      return drink ? [{ drink, body: linkBody(drink, indices, item.id) }] : [];
    });
    const out = await saveEach(activeRestaurantId, jobs, `${g.label} linked to ${item.name}`);
    setOutcomes(out);
    setBusy(false);
    // The queue, the list's figures and each saved drink's sheet are read again.
    await Promise.all([
      qc.invalidateQueries({ queryKey: looseLinesKey(activeRestaurantId) }),
      qc.invalidateQueries({ queryKey: drinkFiguresKey(activeRestaurantId) }),
      ...out.filter((o) => o.ok).map((o) => qc.invalidateQueries({ queryKey: recipeKey(activeRestaurantId, o.cocktailId) })),
    ]);
  };

  return (
    <Sheet
      open
      onClose={onClose}
      label="Link your drinks' loose lines to your shelf. Each link saves a new version of that drink; closing saves nothing."
      eyebrow="Recipes"
      title="Lines not linked to your shelf"
      closeLabel="Close"
    >
      <p className="cl-said" data-testid="loose-sheet-count">
        {shown.lineCount ? looseSentence(shown) : 'Every counted line of your drinks is linked to your shelf.'}
      </p>
      <p className="cl-note">Each drink keeps its earlier version.</p>
      {outcomes.length ? (
        <ul role="status" data-testid="loose-outcomes" style={{ listStyle: 'none', padding: 0, margin: '8px 0' }}>
          {outcomes.map((o) => (
            <li key={o.cocktailId} data-ok={o.ok ? 'true' : 'false'} style={o.ok ? undefined : { color: 'var(--warn)' }}>
              {o.said}
            </li>
          ))}
        </ul>
      ) : null}
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody ref={body}>
          {shown.groups.map((g) => (
            <GroupRow key={g.key} g={g} busy={busy} onLink={link} />
          ))}
        </tbody>
      </table>
    </Sheet>
  );
}

/** The line above the /cocktails list, and its sheet; for owners and managers only. */
export default function LooseLines({ manages }: { manages: boolean }) {
  const q = useLooseLines(manages);
  const [open, setOpen] = useState(false);
  if (!manages) return null;
  const a = q.data;
  return (
    <>
      <p className="cl-said cl-offer-room cl-loose-room" data-testid="loose-lines" style={{ marginTop: 12 }}>
        {q.isError ? (
          LOOSE_UNREAD
        ) : a && a.lineCount > 0 ? (
          <>
            {looseSentence(a)}{' '}
            <button type="button" className="cl-btn cl-focus" data-testid="loose-open" onClick={() => setOpen(true)}>
              Link them
            </button>
          </>
        ) : null}
      </p>
      {open && a ? <LooseSheet data={a} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
