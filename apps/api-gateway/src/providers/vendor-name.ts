/**
 * When two vendor names are the same vendor's (r34 walk w1 F1).
 *
 * A house adding "ege supply" while "Ege Supply" is already on its vendors is
 * adding the same vendor twice: every later "which Ege Supply?" question
 * (orders, invoices, mail) becomes ambiguous. The fold is what a person
 * reading the two names would call "the same name":
 *
 *  - case, with Turkish i's as one letter: I, ı, İ and i all read as i, so
 *    "KAVAKLIDERE", "Kavaklıdere" and "kavaklidere" are one name;
 *  - marks: "Süt Evi" and "Sut Evi" are one name (ş, ç, ğ, ö, ü fold the same
 *    way; full-width letters fold through NFKD);
 *  - spaces and punctuation: runs of either read as one space, ends trimmed,
 *    so "Ege  Supply." and "Ege Supply" are one name.
 *
 * Letters and digits of every script are kept, so a name written in Cyrillic
 * or Arabic is compared as itself, never folded to nothing. A name with no
 * letter or digit at all folds to "" and is never called a duplicate: there
 * is nothing to compare.
 */
export function foldVendorName(raw: string | null | undefined): string {
  return String(raw ?? "")
    .replace(/[İIı]/g, "i")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
