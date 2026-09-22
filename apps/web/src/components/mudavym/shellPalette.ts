/**
 * What the app shell hands the ⌘K palette (sketch 119 D: the palette "reads
 * the same rooms table as the rail and adds On the counter as its first
 * section").
 *
 * `null` outside the shell — which is every tree while the `shell` gate is
 * off — and the palette then renders exactly as it always has: its own
 * Navigation list, no counter section (CommandPalette.tsx).
 *
 * Pure builders, so what the palette lists is testable without mounting it:
 *   - `counterPaletteRows` turns the counter's last read into rows. A register
 *     that answered contributes its acts; one that could not be read
 *     contributes ONE row saying so, whose action reads again — never a
 *     silent absence, and never a zero; one refused for this role contributes
 *     nothing (the counter itself says "refused" in words).
 *   - `roomPaletteRows` is the rooms table as this person may enter it — the
 *     same `visibleGroups` / `visibleFoot` the rail and the phone's Rooms
 *     sheet call, so the three can never list different rooms.
 */

import { createContext, useContext } from 'react';
import {
  REGISTER_WORD,
  VERB_WORD,
  clockOf,
  type CounterRegisterAnswered,
  type HouseCounterRead,
} from '../../lib/mudavym/counterRead';
import { actLine } from '../../lib/mudavym/counterRows';
import type { CounterFailure } from '../../lib/mudavym/useHouseCounter';
import { visibleFoot, visibleGroups, type RoomFlags, type ShellRole } from '../../lib/mudavym/rooms';
import type { CounterActTarget } from './CounterActSheet';

export interface PaletteCounterRow {
  id: string;
  title: string;
  subtitle: string;
  /** Extra terms for the fuzzy matcher: the verb and the register's name. */
  keywords: string;
  /** `act` opens the act in place; `read` reads the counter again. */
  kind: 'act' | 'read';
  run: () => void;
}

export interface PaletteRoomRow {
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

export interface ShellPaletteValue {
  counter: PaletteCounterRow[];
  rooms: PaletteRoomRow[];
}

export const ShellPaletteContext = createContext<ShellPaletteValue | null>(null);

export function useShellPalette(): ShellPaletteValue | null {
  return useContext(ShellPaletteContext);
}

export function counterPaletteRows(
  last: HouseCounterRead | null,
  failure: CounterFailure | null,
  openAct: (t: CounterActTarget) => void,
  readNow: () => void,
): PaletteCounterRow[] {
  if (!last) {
    // Nothing has landed. A failed first read is said; one still in flight
    // is not listed at all (the counter's own hairline covers it).
    return failure
      ? [
          {
            id: 'counter-read',
            title: 'The counter was not read',
            subtitle: `${failure.sentence} · Read again`,
            keywords: 'counter read again not read',
            kind: 'read',
            run: readNow,
          },
        ]
      : [];
  }
  const out: PaletteCounterRow[] = [];
  for (const r of last.registers) {
    if (r.state === 'unreadable') {
      out.push({
        id: `counter-unread-${r.key}`,
        title: `${REGISTER_WORD[r.key]} · not read`,
        subtitle: `${r.status ?? 'no answer'} at ${clockOf(r.readAt)} · Read again`,
        keywords: `${VERB_WORD[r.verb]} ${REGISTER_WORD[r.key]} not read again`,
        kind: 'read',
        run: readNow,
      });
      continue;
    }
    if (r.state !== 'answered') continue;
    const answered: CounterRegisterAnswered = r;
    for (const row of answered.rows) {
      const line = actLine(answered.key, row, last);
      out.push({
        id: `counter-${answered.key}-${line.id}`,
        title: line.what,
        subtitle: `${VERB_WORD[answered.verb]} · ${line.detail}`,
        keywords: `${VERB_WORD[answered.verb]} ${REGISTER_WORD[answered.key]}`,
        kind: 'act',
        run: () => openAct({ register: answered, row }),
      });
    }
  }
  return out;
}

export function roomPaletteRows(role: ShellRole, flags: RoomFlags): PaletteRoomRow[] {
  const rows: PaletteRoomRow[] = [];
  for (const g of visibleGroups(role, flags)) {
    for (const r of g.rooms) {
      rows.push({ id: `room-${r.path}`, title: r.name, subtitle: g.name, href: r.path });
    }
  }
  for (const r of visibleFoot(role, flags)) {
    rows.push({ id: `room-${r.path}`, title: r.name, subtitle: 'The house', href: r.path });
  }
  return rows;
}
