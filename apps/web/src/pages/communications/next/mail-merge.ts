/**
 * Folding the newest page of a Mail list into the pages already loaded
 * (r104 mail-gap g4). A change on the summary used to re-read every page of
 * every open list, one after another; now page 1 is read once and merged here,
 * by key. Pure: no request, no cache. The full re-read stays on the 120 s
 * fallback and a manual refresh. Paging never caps: no loaded row is dropped,
 * and a page's own `next` cursor is never rewritten.
 */
import type { InfiniteData } from '@tanstack/react-query';
import type { MailPeoplePage, MailThreadPage, MailThreadsPage } from './mail-format';

type Keyed = { key: string; lastAt: string };

/**
 * A row of the fresh first page that is new, or newer than the loaded copy,
 * goes to the top in the fresh page's order. A row that is the same age is
 * updated where it stands (no reorder); a loaded row the fresh page does not
 * hold stays as it is.
 */
function mergeRows<R extends Keyed>(loadedPages: R[][], fresh: R[]): R[][] {
  const loaded = new Map<string, string>();
  for (const page of loadedPages) for (const r of page) loaded.set(r.key, r.lastAt);
  const freshBy = new Map(fresh.map((r) => [r.key, r]));
  const moved = (r: R) => !loaded.has(r.key) || loaded.get(r.key) !== r.lastAt;
  const top = fresh.filter(moved);
  const topKeys = new Set(top.map((r) => r.key));
  const pages = loadedPages.map((page) =>
    page.flatMap((r) => (topKeys.has(r.key) ? [] : [freshBy.get(r.key) ?? r])),
  );
  pages[0] = [...top, ...pages[0]];
  return pages;
}

/**
 * True when a row of the fresh first page is older than the loaded copy of it:
 * its newest letter went away (a revoked grant, a category clean). Merged as
 * "moved" it would jump above newer rows, so the caller reads the list whole.
 */
export function headWentBack(
  cur: InfiniteData<MailPeoplePage | MailThreadsPage, string | null>,
  fresh: MailPeoplePage | MailThreadsPage,
): boolean {
  const loaded = new Map<string, number>();
  for (const page of cur.pages) {
    for (const r of 'people' in page ? page.people : page.threads) loaded.set(r.key, Date.parse(r.lastAt));
  }
  return ('people' in fresh ? fresh.people : fresh.threads).some((r) => {
    const was = loaded.get(r.key);
    return was !== undefined && Date.parse(r.lastAt) < was;
  });
}

export function mergePeopleHead(
  cur: InfiniteData<MailPeoplePage, string | null>,
  fresh: MailPeoplePage,
): InfiniteData<MailPeoplePage, string | null> {
  const rows = mergeRows(
    cur.pages.map((p) => p.people),
    fresh.people,
  );
  return {
    ...cur,
    pages: cur.pages.map((p, i) => ({
      ...p,
      people: rows[i],
      storedKinds: i === 0 ? fresh.storedKinds : p.storedKinds,
    })),
  };
}

export function mergeThreadsHead(
  cur: InfiniteData<MailThreadsPage, string | null>,
  fresh: MailThreadsPage,
): InfiniteData<MailThreadsPage, string | null> {
  const rows = mergeRows(
    cur.pages.map((p) => p.threads),
    fresh.threads,
  );
  return {
    ...cur,
    pages: cur.pages.map((p, i) => ({ ...p, threads: rows[i], person: i === 0 ? fresh.person : p.person })),
  };
}

/**
 * An open thread: the newest page is the newest letters. The fresh page and
 * the loaded one overlap when fewer letters arrived than a page holds; the
 * union, oldest first, is the new first page and keeps the loaded page's
 * `before`. No overlap means a gap between them: null, and the caller reads
 * the thread again whole.
 */
export function mergeThreadHead(
  cur: InfiniteData<MailThreadPage, string | null>,
  fresh: MailThreadPage,
): InfiniteData<MailThreadPage, string | null> | null {
  const first = cur.pages[0];
  if (!first) return null;
  const held = first.messages ?? [];
  const arrived = fresh.messages ?? [];
  const freshIds = new Set(arrived.map((m) => m.id));
  const older = held.filter((m) => !freshIds.has(m.id));
  if (held.length > 0 && older.length === held.length) return null;
  return {
    ...cur,
    pages: [
      { ...fresh, messages: [...older, ...arrived], before: first.before },
      ...cur.pages.slice(1),
    ],
  };
}
