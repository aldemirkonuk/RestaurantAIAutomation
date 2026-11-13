/**
 * Letters Unicode NFD cannot reach, folded to the letter their capital spells.
 *
 * Every name normaliser here does NFD, strips the combining marks, lowercases
 * and turns what is left outside [a-z0-9] into a space. That folds "Château",
 * "İstanbul" (I + U+0307) and "ş ğ ç ö ü" (base letter + combining mark). It
 * cannot fold a letter that has no decomposition at all: Turkish dotless "ı"
 * (U+0131) survived the strip and became a space, so a menu's "Kavaklıdere"
 * keyed as "kavakl dere" while the invoice's "KAVAKLIDERE" keyed as
 * "kavaklidere" -- one wine, two keys (QA round 1, B-1).
 *
 * One table, applied after the diacritic strip and before lowercasing, by
 * the TypeScript normalisers that key a library wine, normalizeSignatureText
 * (wines/wine-signature.ts), and a vendor sighting or bottle identity,
 * normalizeIdentityText (vendor-intel/wine-identity.ts). The SQL twin is public.fold_undecomposable_letters(), called by
 * wine_normalize_text() and beverage_normalize_text(). The Python mirrors are
 * listed in MIRRORS in fold-letters.spec.ts, which reads every one of them and
 * fails when any drifts from this table.
 *
 * Only "ı" is here. ß, ø, ł, đ, æ, œ have the same defect, but each needs a
 * choice (ß -> "ss" or "s", ø -> "o" or "oe") and moves more stored keys; they
 * are filed in .planning/tech-debt.d, not guessed.
 */
export const UNDECOMPOSABLE_LETTERS: ReadonlyArray<readonly [string, string]> =
  [
    ["\u0131", "i"], // ı LATIN SMALL LETTER DOTLESS I
  ];

/** Replace each letter in UNDECOMPOSABLE_LETTERS with its fold. */
export function foldUndecomposableLetters(value: string): string {
  let s = value;
  for (const [letter, fold] of UNDECOMPOSABLE_LETTERS) {
    s = s.split(letter).join(fold);
  }
  return s;
}
