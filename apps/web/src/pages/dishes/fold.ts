/**
 * Search text as /dishes reads it: lower-cased, accents and combining marks
 * removed (which also turns İ into i), the Turkish dotless ı written as i. So "ISKENDER", "İskender" and
 * "iskender" find each other, and "Cafe" finds "Café".
 */
export function foldDishText(s: string | null | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i')
    .replace(/ß/g, 'ss')
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/ø/g, 'o')
    .replace(/ł/g, 'l');
}

/** A dish matches when every word typed is somewhere in its name or section. */
export function dishMatches(d: { name: string; section: string | null }, query: string): boolean {
  const words = foldDishText(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = foldDishText(`${d.name} ${d.section ?? ''}`);
  return words.every((w) => hay.includes(w));
}

/**
 * The sections already on the list, each once (spelt as first written, so
 * "Mains" and "mains " are one), in reading order. Offered to the Section box
 * so a house does not type one section two ways.
 */
export function sectionsOf(dishes: ReadonlyArray<{ section: string | null }>): string[] {
  const seen = new Map<string, string>();
  for (const d of dishes) {
    const s = (d.section ?? '').trim();
    if (s && !seen.has(foldDishText(s))) seen.set(foldDishText(s), s);
  }
  return [...seen.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, s]) => s);
}
