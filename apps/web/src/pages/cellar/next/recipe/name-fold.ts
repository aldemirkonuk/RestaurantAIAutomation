/**
 * How a typed search meets a drink's name: spaces trimmed and collapsed, case,
 * the dotless ı read as i, accents dropped (ş->s, ü->u, the dot of İ). This is
 * the rule the gateway's shelf search takes in draft PR #1410 (`foldName`), so
 * the two searches agree. `toLowerCase()` alone lowers "RAKI" to "raki", which
 * never finds "Rakı" (r41 recipes audit, gap 13).
 */
export function foldName(s: string): string {
  return s
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/ı/g, 'i')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .normalize('NFC');
}
