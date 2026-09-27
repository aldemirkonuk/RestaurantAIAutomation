/**
 * useAskNextData — the three reads `/ask` makes, each keyed by the active
 * house so a switch never shows the previous house's shelf or book (the W6
 * rule every rebuilt page keeps).
 *
 *   shelf  GET /ask/catalogue   — already filtered to the asking role
 *   book   GET /ask/folios      — this person's newest 50 asks in this house
 *   folio  GET /ask/folios/:id  — one folio, when the URL names one
 *
 * Each lands in one of three states the page says in words: loading, a
 * failure (named, never drawn as an empty shelf or an empty book), or a real
 * answer, including a real empty book.
 */

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { askApi } from '@/services/api/ask';

export function askKeys(restaurantId: string | null) {
  return {
    shelf: ['ask', restaurantId, 'catalogue'] as const,
    book: ['ask', restaurantId, 'folios'] as const,
    folio: (id: string) => ['ask', restaurantId, 'folio', id] as const,
  };
}

export function useAskNextData(folioId: string | null) {
  const { activeRestaurantId } = useAuth();
  const rid = activeRestaurantId ?? null;
  const keys = askKeys(rid);
  const shelf = useQuery({ queryKey: keys.shelf, queryFn: askApi.catalogue, enabled: !!rid, retry: false, staleTime: 5 * 60_000 });
  const book = useQuery({ queryKey: keys.book, queryFn: askApi.folios, enabled: !!rid, retry: false });
  const folio = useQuery({
    queryKey: keys.folio(folioId ?? ''),
    queryFn: () => askApi.folio(folioId as string),
    enabled: !!rid && !!folioId,
    retry: false,
    // A finished folio is not written again (`reading-folio.store.ts`
    // `finish` updates only a row still `pending`), so the copy the submit
    // just returned is not re-fetched on arrival; a pending one is re-read by
    // the page's own "Check again".
    staleTime: 5 * 60_000,
  });
  return { restaurantId: rid, keys, shelf, book, folio };
}
