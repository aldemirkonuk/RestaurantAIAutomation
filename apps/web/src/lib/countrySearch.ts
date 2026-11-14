import { COUNTRIES, type Country } from './countries'

/**
 * What the country box offers for what a person typed (r31 walk F4).
 *
 * The box matched only the English display name, letter for letter: "Türkiye"
 * found nothing, because the row is named "Turkey"; "USA", "UK" and "England"
 * found nothing; "cote" did not find a name written with a circumflex. The
 * table already records every alias (countries.ts), and `countryByName` reads
 * them all, so the box now searches the same words.
 *
 * Order: a typed code ("TR", "us") or a whole name or alias ("UK", "Holland")
 * first, then names and aliases that start with the text, then those that
 * hold it, each group in the table's order. So "uk" offers United Kingdom
 * before Ukraine.
 * The box still shows and picks the display name, so what is saved is the
 * same string as before.
 */

/** Lower case, accents off, dotless i as i, punctuation and spaces as one space. */
export function foldCountry(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i')
    .replace(/[.'’‘`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** The display names that match `query`, best first. Every name for an empty query. */
export function matchCountries(query: string, countries: readonly Country[] = COUNTRIES): string[] {
  const text = foldCountry(query)
  if (text === '') return countries.map((c) => c.name)
  const exact: string[] = []
  const starts: string[] = []
  const holds: string[] = []
  for (const country of countries) {
    const words = [country.name, ...(country.aliases ?? [])].map(foldCountry)
    if (country.code.toLowerCase() === text || words.includes(text)) exact.push(country.name)
    else if (words.some((word) => word.startsWith(text))) starts.push(country.name)
    else if (words.some((word) => word.includes(text))) holds.push(country.name)
  }
  return [...exact, ...starts, ...holds]
}
