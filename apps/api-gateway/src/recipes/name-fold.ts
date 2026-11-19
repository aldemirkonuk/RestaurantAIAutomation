/**
 * How a recipe line's name meets a shelf good's name, and how the shelf
 * search reads what was typed (r28 recipes audit, gap 14).
 *
 * WHY. JavaScript's `toLowerCase()` and PostgreSQL's `ilike` fold case the
 * English way: "RAKI" lowers to "raki" while the house's good is "Rakı", and
 * "İSOT" lowers to "i̇sot" (an i with a combining dot). A Turkish house typing
 * in capitals, or on an English keyboard ("seker" for "Şeker"), was told
 * "Nothing on your shelf matches", and a pasted line never proposed its link.
 *
 * THE FOLD. Two names are the same name when they agree after: spaces trimmed
 * and runs collapsed; case; the dotless ı read as i; and accents dropped
 * (ş->s, ü->u, é->e, and the dot of İ, so "İ" and "I" both read i). The
 * menu lane reads the dotless ı and accents the same way (house-good-match.ts,
 * r28 G6), so a dish and its menu line fold alike. Nothing else is folded: "Flour" and "Flours" stay two names.
 * Folding wider can only make two shelf goods share a name, and two goods of
 * one name never match a line (the caller counts them and links neither).
 */
export function foldName(s: string): string {
  return s
    .normalize("NFC")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/ı/g, "i")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .normalize("NFC");
}

/** Every way a folded letter can be written on a shelf name, both cases. */
const VARIANTS: Record<string, string> = {
  a: "aàáâäãåAÀÁÂÄÃÅ",
  c: "cçCÇ",
  e: "eèéêëEÈÉÊË",
  g: "gğGĞ",
  i: "iìíîïıIÌÍÎÏİ",
  n: "nñNÑ",
  o: "oòóôöõOÒÓÔÖÕ",
  s: "sşSŞ",
  u: "uùúûüUÙÚÛÜ",
  y: "yÿYŸ",
};

const REGEX_SPECIAL = /[\\^$.|?*+()[\]{}-]/;

/**
 * A PostgreSQL regular expression (for `~*`, PostgREST `imatch`) that finds a
 * typed term anywhere in a shelf name under `foldName`'s rules. Each folded
 * letter becomes the class of every way it is written; every other character
 * is matched as itself, so "%", "_" or "." typed are searched as characters,
 * never as wildcards. A run of spaces matches any run of spaces. Null when the
 * term folds to nothing.
 *
 * The regex is a plain sequence of literals and classes, with no repetition
 * except `\s+`, so it runs in linear time whatever is typed.
 */
export function shelfSearchPattern(term: string): string | null {
  const folded = foldName(term);
  if (!folded) return null;
  let out = "";
  for (const ch of folded) {
    if (ch === " ") out += "\\s+";
    else if (VARIANTS[ch]) out += `[${VARIANTS[ch]}]`;
    else if (REGEX_SPECIAL.test(ch)) out += `\\${ch}`;
    else out += ch;
  }
  return out;
}
