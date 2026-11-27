/**
 * "Named in recipes, not in the book" (r109 g4): dish recipe lines that name
 * no good, grouped by name, each one added as a food good and linked in every
 * dish that names it, behind a hold.
 *
 * The add is the inventory's own "carry this" route (recipesApi.addToShelf),
 * so there is one writer of a house good. It sends no par: the gateway decides
 * it. Each affected dish is then re-saved from the version it was read at,
 * through the dish PUT, so a dish changed since the read answers 409 and keeps
 * its loose line. Nothing guesses: a group whose lines disagree on a unit
 * family asks for one.
 *
 * Owner or manager only (the read and the PUT both are). An unread read is
 * said, never shown as none.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { HoldToApprove, Select, Sheet } from '@/components/mudavym';
import {
  getLooseDishLines,
  recipesApi,
  type LooseDish,
  type LooseDishAnswer,
  type LooseDishGroup,
} from '../../../services/api/recipes';
import { statusOf } from '../../../lib/queue-owner';
import { EM, fmtCount } from './useInventoryNextData';

export const looseFoodsKey = (rid: string | null) => ['recipes', 'loose-lines', 'dish', rid] as const;

/** The read, only for someone who may act on it. */
export function useLooseFoods(rid: string | null, canManage: boolean) {
  return useQuery({
    queryKey: looseFoodsKey(rid),
    queryFn: () => getLooseDishLines(rid as string),
    enabled: Boolean(rid) && canManage,
    staleTime: 60_000,
    retry: false,
  });
}

type Unit = 'g' | 'ml' | 'each';
const UNIT_WORDS: Record<Unit, string> = { g: 'grams', ml: 'millilitres', each: 'pieces' };
const plural = (n: number, one: string, many: string) => `${fmtCount(n)} ${n === 1 ? one : many}`;

/**
 * The chip. While reading, or when the read failed, it keeps its place with no
 * count and cannot be pressed: an unread read is not "none".
 */
export function LooseFoodsChip({
  load,
  onOpen,
}: {
  load: { isPending: boolean; isError: boolean; data?: LooseDishAnswer };
  onOpen: () => void;
}) {
  const label = 'Named in recipes, not in the book';
  if (load.isError || load.isPending || !load.data) {
    return (
      <button
        type="button"
        className="iv-chip"
        disabled
        data-testid="iv-loose-foods-chip"
        title={load.isError ? 'Which recipe lines name no good could not be read. That is not a claim that none do.' : 'Reading the recipes…'}
      >
        {label} <span className="iv-num">{EM}</span>
      </button>
    );
  }
  const n = load.data.groups.length;
  return (
    <button
      type="button"
      className="iv-chip iv-focus"
      disabled={n === 0}
      data-testid="iv-loose-foods-chip"
      onClick={onOpen}
    >
      {label} <span className="iv-num">({fmtCount(n)})</span>
    </button>
  );
}

export interface LinkOutcome {
  itemId: string | null;
  linked: string[];
  kept: Array<{ name: string; why: string }>;
}

/**
 * Adds the good (or takes the one same-named good), then re-saves each dish
 * that names the group, from the version it was read at. A failed re-save is
 * named; the others are not undone, since each dish is its own version.
 */
export async function linkGroup(rid: string, answer: LooseDishAnswer, group: LooseDishGroup, uom: Unit): Promise<LinkOutcome> {
  let itemId: string;
  if (group.shelf) itemId = group.shelf.id;
  else {
    try {
      itemId = (await recipesApi.addToShelf(rid, { kind: 'food', uom, displayName: group.label })).id;
    } catch {
      return { itemId: null, linked: [], kept: [] };
    }
  }
  const byDish = new Map<string, number[]>();
  for (const l of group.lines) byDish.set(l.dishId, [...(byDish.get(l.dishId) ?? []), l.index]);
  const dishes = new Map<string, LooseDish>(answer.dishes.map((d) => [d.dishId, d]));
  const out: LinkOutcome = { itemId, linked: [], kept: [] };
  for (const [dishId, indexes] of byDish) {
    const d = dishes.get(dishId);
    if (!d) {
      out.kept.push({ name: 'A dish', why: 'it was not in the read' });
      continue;
    }
    const lines = d.lines.map((l, i) => (indexes.includes(i) ? { ...l, inventoryId: itemId } : l));
    try {
      const saved = await recipesApi.save(
        rid,
        { kind: 'dish', id: dishId },
        {
          expectedVersionId: d.versionId,
          yieldServes: d.yieldServes,
          method: d.method ?? undefined,
          glass: d.glass ?? undefined,
          garnish: d.garnish ?? undefined,
          lines,
        },
      );
      // The next name linked in this dish starts from what was just saved,
      // so it is not refused as stale by this sheet's own write.
      d.versionId = saved.versionId;
      d.lines = lines;
      out.linked.push(d.name);
    } catch (err) {
      out.kept.push({
        name: d.name,
        why: statusOf(err) === 409 ? 'its recipe changed since it was read' : 'it could not be saved',
      });
    }
  }
  return out;
}

function outcomeWords(label: string, o: LinkOutcome, added: boolean): { text: string; alarm: boolean } {
  if (o.itemId === null) return { text: `${label} could not be added, so no dish was changed.`, alarm: true };
  const head = added ? `${label} is in the book` : `${label} was already in the book`;
  const linked = o.linked.length ? ` and is linked in ${plural(o.linked.length, 'dish', 'dishes')}` : '';
  if (!o.kept.length) return { text: `${head}${linked}.`, alarm: false };
  const kept = o.kept.map((k) => `${k.name} (${k.why})`).join(', ');
  return { text: `${head}${linked}. These kept their loose line: ${kept}. Open each recipe to link it.`, alarm: true };
}

function Row({
  group,
  picked,
  onPick,
  rid,
  answer,
  onDone,
}: {
  group: LooseDishGroup;
  picked: boolean;
  onPick: () => void;
  rid: string;
  answer: LooseDishAnswer;
  onDone: () => void;
}) {
  const [unit, setUnit] = useState<Unit | ''>(group.proposed ?? '');
  const [said, setSaid] = useState<{ text: string; alarm: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const where = `in ${plural(group.dishCount, 'dish', 'dishes')}`;
  const twins = !group.shelf && group.sameName >= 2;
  const verb = group.shelf ? `Link to ${group.shelf.name}` : 'Add as a good';

  return (
    <li className="iv-loose-row" data-testid="iv-loose-group">
      <div>
        <strong>{group.label}</strong> <span className="iv-note">{where}</span>
      </div>
      {twins ? (
        <p className="iv-note">
          {fmtCount(group.sameName)} goods already have this name, so none is added here. Link it from each dish’s recipe.
        </p>
      ) : group.shelf ? (
        <p className="iv-note">{group.shelf.name} is already in the book: the lines are linked to it, nothing is added.</p>
      ) : group.proposed ? (
        <p className="iv-note">Kept in {UNIT_WORDS[group.proposed]}: every line names it by {group.proposed === 'each' ? 'the piece' : group.proposed === 'g' ? 'weight' : 'volume'}.</p>
      ) : (
        <Select
          label={`Unit for ${group.label}`}
          value={unit}
          onChange={(v) => setUnit(v as Unit | '')}
          placeholder="The lines disagree: pick a unit"
          options={[
            { value: 'g', label: 'Grams' },
            { value: 'ml', label: 'Millilitres' },
            { value: 'each', label: 'Pieces' },
          ]}
        />
      )}
      {twins || said ? null : picked ? (
        <HoldToApprove
          label={unit === '' && !group.shelf ? 'Pick a unit first' : `Hold to ${group.shelf ? 'link' : 'add'} ${group.label} ${where}`}
          approvedLabel="Done"
          disabled={busy || (unit === '' && !group.shelf)}
          onApprove={async () => {
            setBusy(true);
            const o = await linkGroup(rid, answer, group, (unit || 'each') as Unit);
            setBusy(false);
            setSaid(outcomeWords(group.label, o, !group.shelf));
            onDone();
          }}
        />
      ) : (
        <button type="button" className="iv-btn iv-focus" onClick={onPick}>
          {verb}
        </button>
      )}
      {said ? (
        <p className={said.alarm ? 'iv-note' : 'iv-said'} role="status" data-testid="iv-loose-said">
          {said.text}
        </p>
      ) : null}
    </li>
  );
}

export function LooseFoodsSheet({
  rid,
  answer,
  onClose,
}: {
  rid: string;
  answer: LooseDishAnswer;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [picked, setPicked] = useState<string | null>(null);
  // The list is the one read at open: a row stays (with what was done) after
  // its hold, so nothing jumps under the next hold. Closing reads it again.
  const [snapshot] = useState(answer);
  const onDone = () => {
    void qc.invalidateQueries({ queryKey: ['inventory-next'] });
  };
  const close = () => {
    void qc.invalidateQueries({ queryKey: looseFoodsKey(rid) });
    onClose();
  };
  return (
    <Sheet
      open
      onClose={close}
      bodyClassName="iv-sheet-body"
      label="Names in dish recipes that no good in the book carries. Each is added and linked only after a hold. Leaving changes nothing."
      eyebrow="Named in recipes"
      title="Not in the book"
      footer={<span>A good is added with no stock: stock arrives with a delivery or a count.</span>}
    >
      <p className="iv-said">
        {plural(snapshot.lineCount, 'line', 'lines')} in {plural(snapshot.dishCount, 'dish', 'dishes')} name a food the book does not carry.
      </p>
      <ul className="iv-loose-list" data-testid="iv-loose-list">
        {snapshot.groups.map((g) => (
          <Row
            key={g.key}
            group={g}
            picked={picked === g.key}
            onPick={() => setPicked(g.key)}
            rid={rid}
            answer={snapshot}
            onDone={onDone}
          />
        ))}
      </ul>
    </Sheet>
  );
}
