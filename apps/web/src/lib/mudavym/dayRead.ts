/**
 * The day line's read model — `GET /house/day` as the page understands it
 * (sketch 119 §E, built as a PAGE element, not chrome — the founder's pick of
 * 2026-09-21). Mirrors `apps/api-gateway/src/house/house-day.types.ts`; the
 * gateway is the source of the shape.
 *
 * REDUCED SCOPE — see `house-day.types.ts`'s own doc comment for the full
 * reasoning. Three registers this session (`deliveryArrived`, `calendar`,
 * `reminders`); `deliveryExpected`, `shifts` and `market` are not built, so
 * they are not in the count — "3 of 3", never "3 of 6".
 */

export type DayRegisterKey = 'deliveryArrived' | 'calendar' | 'reminders';

export interface DayTick {
  id: string;
  at: string;
  label: string;
  href: string | null;
}

interface DayRegisterBase {
  key: DayRegisterKey;
  readAt: string;
  ms: number;
}

export interface DayRegisterAnswered extends DayRegisterBase {
  state: 'answered';
  count: number;
  complete: boolean;
  ticks: DayTick[];
}

export interface DayRegisterRefused extends DayRegisterBase {
  state: 'refused';
  sentence: string;
}

export interface DayRegisterUnreadable extends DayRegisterBase {
  state: 'unreadable';
  status: number | null;
  sentence: string;
}

export type DayRegister = DayRegisterAnswered | DayRegisterRefused | DayRegisterUnreadable;

export interface DayHours {
  state: 'recorded' | 'not_recorded' | 'unreadable';
  windows: Array<{ startAt: string; endAt: string }>;
  sentence?: string;
}

export interface HouseDayRead {
  readAt: string;
  house: { id: string; timezone: string | null };
  hours: DayHours;
  registers: DayRegister[];
}

const REGISTER_WORD: Record<DayRegisterKey, string> = {
  deliveryArrived: 'deliveries that arrived',
  calendar: 'the calendar',
  reminders: 'reminders',
};

/**
 * The line's head, computed from the registers actually returned — never a
 * constant (`counterHead`'s own rule, `counterRead.ts`). "N of 3", never a
 * bigger denominator for a register this build does not read.
 */
export function dayHead(registers: readonly DayRegister[]): string {
  const n = registers.length;
  if (n === 0) return 'no registers read';
  const answered = registers.filter((r) => r.state === 'answered').length;
  const refused = registers.filter((r) => r.state === 'refused').length;
  const unread = registers.filter((r) => r.state === 'unreadable').length;
  const parts = [`${answered} of ${n} registers`];
  if (refused) parts.push(`${refused} refused`);
  if (unread) parts.push(`${unread} not read`);
  return parts.join(' · ');
}

/** Every tick across every ANSWERED register, oldest first. A register that
 * did not answer contributes no ticks — never a guess at what it would have
 * held. */
export function allTicks(registers: readonly DayRegister[]): Array<DayTick & { register: DayRegisterKey }> {
  const out: Array<DayTick & { register: DayRegisterKey }> = [];
  for (const r of registers) {
    if (r.state !== 'answered') continue;
    for (const t of r.ticks) out.push({ ...t, register: r.key });
  }
  return out.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

/** The registers that did NOT answer, for the "N not read" row with its
 * "Read again" affordance — the day line's analogue of the counter's ring. */
export function unreadRegisters(registers: readonly DayRegister[]): DayRegister[] {
  return registers.filter((r) => r.state !== 'answered');
}

export function registerWord(key: DayRegisterKey): string {
  return REGISTER_WORD[key];
}

/** The hours line, in words — never silent about which fact is missing. */
export function hoursSentence(hours: DayHours): string | null {
  if (hours.state === 'recorded') return null; // the bands speak for themselves
  return hours.sentence ?? (hours.state === 'unreadable' ? 'Hours could not be read.' : 'Hours not set.');
}

/**
 * "14:02" in the HOUSE's own timezone — never the viewer's device zone. A
 * manager reading the day line from another city must see the house's day,
 * not their own (the same reason `house.timezone` travels in the response at
 * all). Falls back to the browser's local zone only when the house has none.
 */
export function dayClockOf(iso: string, timezone: string | null): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      ...(timezone ? { timeZone: timezone } : {}),
    }).format(d);
  } catch {
    // An invalid/unknown IANA zone string — degrade to the viewer's own zone
    // rather than throw and take the whole line down with it.
    return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  }
}
