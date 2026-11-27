/**
 * The newer-in-thread notice (r110 mail-gap g2). The gateway answers a reply
 * 409 NEWER_IN_THREAD when someone wrote on the thread after the composer
 * opened it; the sheet says who and when, in one line, and offers "Send mine
 * as well" or "Read it first". A warning, never a lock.
 */
import { fmtClock } from './compose-format';

export interface NewerItem {
  id: string;
  /** A house member's name; null when the gateway names no member. */
  who: string | null;
  at: string;
  direction: 'inbound' | 'outbound';
  status: string;
  firstLine: string;
}

export interface SeenThrough {
  id: string;
  createdAt: string;
}

/** The newer letters a 409 names, or null when the error is something else. */
export function newerFrom(e: unknown): NewerItem[] | null {
  const res = (e as { response?: { status?: number; data?: { code?: unknown; items?: unknown } } } | null)?.response;
  if (res?.status !== 409 || res.data?.code !== 'NEWER_IN_THREAD' || !Array.isArray(res.data.items)) return null;
  const items = (res.data.items as NewerItem[]).filter((i) => i && typeof i.id === 'string');
  return items.length ? items : null;
}

/** "Ayşe answered at 14:05: <first line>" or "They wrote again at 14:07". */
export function newerLine(item: NewerItem, clock: (iso: string) => string = fmtClock): string {
  if (item.direction === 'inbound') return `They wrote again at ${clock(item.at)}`;
  const head = `${item.who ?? 'Someone in the house'} answered at ${clock(item.at)}`;
  return item.firstLine ? `${head}: ${item.firstLine}` : head;
}

/**
 * Bring a letter into view once the thread shows it: the page reads the
 * thread again, so the letter may not be drawn yet. No smooth scroll: a jump
 * is the reduced-motion end state and the default alike.
 */
export function revealLetter(id: string, tries = 30): void {
  const el = document.querySelector<HTMLElement>(`[data-letter-id="${CSS.escape(id)}"]`);
  if (el) {
    el.scrollIntoView({ block: 'center', behavior: 'auto' });
    el.focus({ preventScroll: true });
    return;
  }
  if (tries > 0) window.setTimeout(() => revealLetter(id, tries - 1), 100);
}

export const NEWER_CSS = `
  @keyframes cmp-newer-in { from { opacity: 0 } to { opacity: 1 } }
  .cmp-newer { animation: cmp-newer-in 160ms cubic-bezier(0.16,1,0.3,1) both }
  @media (prefers-reduced-motion: reduce) { .cmp-newer { animation: none } }
`;
