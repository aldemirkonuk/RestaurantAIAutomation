/**
 * Whether this wine's house price is locked, said beside the price on the
 * cellar's reading stand (ADR 0193 round 3, L8: everyone of the house sees a
 * lock read-only wherever they see the price; L26: at this house only).
 *
 * THE FOUNDER, 2026-09-21, verbatim: "add a section to that where you can lock
 * price". The section itself is on /menu (Locked prices, and the plan before a
 * menu is chosen); this note only says what holds the price here, so a person
 * reading the cellar never takes a locked price for one the next menu will
 * set.
 *
 * READS: GET /pricing/locks (anyone of the house). A failed read, or an answer
 * that says the locks could not be read, is said as such -- never shown as
 * "not locked" (L25). No lock is the ordinary state, so nothing is shown then.
 * No action here: changing a lock is an owner's or a manager's act on /menu.
 *
 * F-618 (the founder's answer S202, an amendment to ADR 0193): when the
 * current menu prints another price for this wine than the house charges (a
 * lock, or a price set after the menu became current), the stand says so,
 * "Locked at X — the menu says Y", and an owner or a manager picks one with a
 * tap (WineMenuPrices, the same pick as /menu).
 */
import { useQuery } from '@tanstack/react-query';
import { listPriceLocks, type PriceLock } from '../../../services/api/pricing';
import { useAuthStore } from '../../../stores';
import { money } from './cellar-format';
import { WineMenuPrices } from '../../menu/next/PricePick';

function day(iso: string): string {
  return String(iso).slice(0, 10);
}

/** One lock, in words a person reads at the price. */
export function lockWords(l: PriceLock, namesReadable = true): string {
  const who =
    l.lockedBy.name ?? (namesReadable ? 'someone whose name is not on record' : 'someone whose name could not be read');
  return `The ${l.kind} price is locked at ${money(l.lockedPrice)} at this house, by ${who} since ${day(l.lockedAt)}. No menu, correction or advice changes it; an owner or a manager does, on Menu, under Locked prices.`;
}

export default function PriceLockNote({ inventoryId }: { inventoryId: string }) {
  const house = useAuthStore((s) => s.activeRestaurantId) ?? null;
  // The gateway refuses a pick from anyone else; this only hides the buttons.
  const role = useAuthStore((s) => s.user?.role) ?? null;
  return (
    <>
      <LockLines inventoryId={inventoryId} house={house} />
      <WineMenuPrices
        house={house}
        inventoryId={inventoryId}
        canPick={role === 'owner' || role === 'manager'}
        fmt={(v) => money(v)}
      />
    </>
  );
}

function LockLines({ inventoryId, house }: { inventoryId: string; house: string | null }) {
  // Same key as Menu's Locked prices, house included (MENU-01).
  const q = useQuery({ queryKey: ['pricing', 'locks', house], queryFn: listPriceLocks });
  if (q.isLoading) return null;
  if (q.isError || !q.data || q.data.readable === false) {
    const why = q.data?.reason ?? (q.error instanceof Error ? q.error.message : null);
    return (
      <p className="cl-note" role="alert" data-testid="bottle-leaf-lock-unread" style={{ marginTop: 4 }}>
        Whether this price is locked could not be read{why ? ` (${why})` : ''}. This is not the same as not locked.
      </p>
    );
  }
  const namesReadable = q.data.namesReadable !== false;
  const mine = q.data.locks
    .filter((l) => l.inventoryId === inventoryId)
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'bottle' ? -1 : 1));
  if (mine.length === 0) return null;
  return (
    <div data-testid="bottle-leaf-locks" style={{ marginTop: 4 }}>
      {mine.map((l) => (
        <p key={l.lockId} className="cl-note" data-testid={`bottle-leaf-lock-${l.kind}`}>
          {lockWords(l, namesReadable)}
        </p>
      ))}
    </div>
  );
}
