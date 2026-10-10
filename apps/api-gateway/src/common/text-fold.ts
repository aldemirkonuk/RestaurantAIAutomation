/**
 * Fold text for matching: case and accents stop mattering, in any locale.
 *
 * The dotless "ı" (Rakı, Kavaklıdere) has no NFD decomposition, so an accent
 * strip alone leaves it in place and a later `[^a-z0-9]` pass deletes it:
 * "Rakı" became "rak" and never met the word "raki". The capital "İ" lowercases
 * to an i with a combining dot. So ı and İ become i first, then NFD splits every
 * other accented letter into its base plus a mark, the marks go, and the rest
 * lowercases. Locale-independent on purpose.
 *
 * The web twin is `apps/web/src/lib/textFold.ts`.
 */
export function foldText(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .replace(/[ıİ]/g, "i")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}
