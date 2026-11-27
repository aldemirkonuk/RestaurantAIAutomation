/**
 * Correct a current line's name or section in place (r108 menu-g15).
 *
 * The current menu offered only "Change price", so a misspelt dish on the live
 * menu needed a whole new read. The two boxes open in the row (at once, no
 * height animation), Enter saves, Escape restores, as the price boxes do
 * (#1340). They go through the same PATCH /menus/items/:id (name, category).
 *
 * Two things are said, not done silently:
 *  - a name change on a line linked to an inventory good renames that good, so
 *    the row says so BEFORE saving;
 *  - a move between drinks and the kitchen is refused, because it changes what
 *    is carried to the house (a dish has no house price): read or add it again.
 */
import type { KeyboardEvent, RefObject } from 'react';
import { isKitchenLine } from '../../../lib/firstProof';
import type { MenuLine } from '../../../services/api/menus';

export interface CorrectDraft {
  name: string;
  category: string;
}

export type CorrectField = 'name' | 'category';

export const KIND_MOVE_REFUSED =
  'Moving a line between drinks and the kitchen changes what is carried; read or add it again.';

export function correctDraftOf(line: MenuLine): CorrectDraft {
  return { name: line.name, category: line.category ?? '' };
}

export interface CorrectionPlan {
  /** Only what differs, in the order it is sent. */
  changes: Array<{ field: CorrectField; value: string }>;
  /** Why nothing may be sent, in words; null when it may. */
  refused: string | null;
  /** The linked inventory good that a new name would also rename; null when none. */
  renamesGood: string | null;
}

/**
 * What saving this draft would do. `wasKitchen` is the page's own test of the
 * line as it stands (isKitchenMenuLine); the new section is tested the same
 * way the page tests a line without the gateway's flag.
 */
export function planCorrection(line: MenuLine, draft: CorrectDraft, wasKitchen: boolean): CorrectionPlan {
  const name = draft.name.trim();
  const category = draft.category.trim();
  const changes: CorrectionPlan['changes'] = [];
  if (name !== line.name) changes.push({ field: 'name', value: name });
  // A blank section keeps the section: the gateway cannot clear one.
  if (category !== '' && category !== (line.category ?? '')) changes.push({ field: 'category', value: category });

  if (name === '') return { changes: [], refused: 'A line needs a name.', renamesGood: null };

  const sectionMoves = changes.some((c) => c.field === 'category');
  if (sectionMoves) {
    const nowKitchen = isKitchenLine({
      category,
      rawText: null,
      name,
      producer: line.producer,
      vintage: line.vintage,
      region: line.region,
      grapeVariety: line.grape_variety,
    });
    if (nowKitchen !== wasKitchen) return { changes: [], refused: KIND_MOVE_REFUSED, renamesGood: null };
  }
  const renames = changes.some((c) => c.field === 'name') && !!line.inventory_item_id;
  return { changes, refused: null, renamesGood: renames ? line.name : null };
}

export function CorrectBox({
  line,
  field,
  value,
  onChange,
  onKeyDown,
  inputRef,
}: {
  line: MenuLine;
  field: CorrectField;
  value: string;
  onChange: (v: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  inputRef?: RefObject<HTMLInputElement>;
}) {
  return (
    <input
      ref={inputRef}
      className="cl-field cl-focus"
      aria-label={`${field === 'name' ? 'Name' : 'Section'} of ${line.name}`}
      data-testid={`menu-correct-${field}`}
      value={value}
      placeholder={field === 'category' ? 'keep' : undefined}
      enterKeyHint="done"
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      style={{ width: field === 'name' ? 180 : 120, maxWidth: '100%' }}
    />
  );
}

/** What saving would also do, said while the person is still typing. */
export function CorrectNote({ plan }: { plan: CorrectionPlan }) {
  if (plan.refused && plan.refused !== 'A line needs a name.') {
    return (
      <span role="alert" className="cl-said" style={{ display: 'block', fontSize: 12 }} data-testid="menu-correct-refused">
        {plan.refused}
      </span>
    );
  }
  if (plan.renamesGood) {
    return (
      <span className="cl-note" style={{ display: 'block' }} data-testid="menu-correct-inventory">
        This also renames {plan.renamesGood} on Inventory.
      </span>
    );
  }
  return null;
}
