/**
 * Fold text for matching: case and accents stop mattering, in any locale.
 *
 * `toLowerCase()` alone is not enough for a Turkish house. "İzmir" lowercases
 * to "i̇zmir" (an i with a combining dot), so typing "izmir" finds nothing; the
 * dotless "ı" in "Kavaklıdere" has no accent to strip, so "kavaklidere" misses
 * it; and an accent strip without the ı→i step deletes the letter outright when
 * punctuation is cleared afterwards ("Rakı" → "rak").
 *
 * So: ı and İ become i first, then NFD splits every other accented letter into
 * its base plus a mark, the marks go, and the rest lowercases. Ö, ü, ç, ş, ğ, é
 * all come out as their plain letter. Locale-independent on purpose — the same
 * search must behave the same on a Turkish phone and an American one.
 *
 * The gateway's twin is `apps/api-gateway/src/common/text-fold.ts`.
 */
export function foldText(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .replace(/[ıİ]/g, 'i')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}
