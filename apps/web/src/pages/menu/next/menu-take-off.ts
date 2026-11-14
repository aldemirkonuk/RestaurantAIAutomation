/**
 * Taking a drink the new menu leaves out off sale (r35 G10, MU-12).
 *
 * The plan lists what the current menu has and the new one does not ("Not on
 * this file"). Silence still changes nothing (ADR 0193 L12): an owner or a
 * manager ticks a drink to take it off sale, and make-current clears its
 * bottle and glass price once the menu is current. Its row and stock stay; a
 * lock still holds its kind.
 */
import type { MakeCurrentResult, MenuPlan } from '../../../services/api/menus';
import { formatMoney } from '../../../lib/currency';

type Dropped = NonNullable<MenuPlan['notOnThisFile']>[number];

/**
 * Whether a dropped drink can be taken off sale from the plan: the house holds
 * its row, it has a price, and not every priced kind is locked.
 */
export function canTakeOff(n: Dropped): boolean {
  if (!n.inventoryId) return false;
  const priced = (['bottle', 'glass'] as const).filter((k) => n[k] !== null);
  return priced.some((k) => !n.locked.includes(k));
}

const KNOWN = new Set(['changed', 'unchanged', 'stale', 'locked']);

/** What taking drinks off sale did, as sentences after the choice's own; '' when none was named. */
export function takenOffSentence(r: Pick<MakeCurrentResult, 'takenOff'>, currency: string | null = null): string {
  const list = r.takenOff ?? [];
  if (list.length === 0) return '';
  const kinds = (t: (typeof list)[number], outcome: string) =>
    (['bottle', 'glass'] as const).filter((k) => t[k] === outcome);
  const named = (t: (typeof list)[number]) => [t.bottle, t.glass].filter((v): v is NonNullable<typeof v> => v !== null);
  const ok = list.filter((t) => !t.error);
  const parts: string[] = [];

  const cleared = ok.filter((t) => kinds(t, 'changed').length > 0);
  if (cleared.length)
    parts.push(
      `Taken off sale, its price cleared: ${cleared
        .map((t) => (kinds(t, 'locked').length || kinds(t, 'stale').length ? `${t.name} (${kinds(t, 'changed').join(' and ')})` : t.name))
        .join('; ')}.`,
    );
  const held = ok.flatMap((t) =>
    t.held.map((h) => `${t.name} (${h.kind}${h.lockedPrice === null ? '' : `, locked at ${formatMoney(h.lockedPrice, currency)}`})`),
  );
  if (held.length) parts.push(`Held by a lock, so the price stays: ${held.join('; ')}.`);
  const stale = ok.filter((t) => kinds(t, 'stale').length > 0);
  if (stale.length)
    parts.push(`Kept a price someone set after this menu was chosen: ${stale.map((t) => `${t.name} (${kinds(t, 'stale').join(' and ')})`).join('; ')}.`);
  const none = ok.filter((t) => named(t).length > 0 && named(t).every((v) => v === 'unchanged'));
  if (none.length) parts.push(`Had no price to take off: ${none.map((t) => t.name).join('; ')}.`);
  // An answer this page does not know is printed, never dropped (L15).
  const odd = ok.filter((t) => named(t).length === 0 || named(t).some((v) => !KNOWN.has(v)));
  if (odd.length)
    parts.push(
      `Whether the price was taken off is not known: ${odd
        .map((t) => `${t.name} (the price writer answered ${named(t).join(' and ') || 'nothing'})`)
        .join('; ')}.`,
    );
  const failed = list.filter((t) => t.error);
  if (failed.length)
    parts.push(
      `Not taken off sale, so the price stays: ${failed.map((t) => `${t.name} (${t.error})`).join('; ')}. Take ${failed.length === 1 ? 'it' : 'them'} off on Inventory.`,
    );
  return ` ${parts.join(' ')}`;
}
