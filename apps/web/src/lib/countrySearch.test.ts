/** r31 walk F4: the country box finds a country by any name the table records. */
import { describe, expect, it } from 'vitest'
import { COUNTRY_NAMES, type Country } from './countries'
import { foldCountry, matchCountries } from './countrySearch'

describe('foldCountry', () => {
  it('drops case, accents, the dotless i and punctuation', () => {
    expect(foldCountry('  Türkiye ')).toBe('turkiye')
    expect(foldCountry('TURKIYE')).toBe('turkiye')
    expect(foldCountry('Türkıye')).toBe('turkiye')
    expect(foldCountry('U.S.')).toBe('us')
    expect(foldCountry("Côte d'Ivoire")).toBe('cote divoire')
    expect(foldCountry('Korea, South')).toBe('korea south')
  })
})

describe('matchCountries', () => {
  it('offers every name, in table order, for an empty query', () => {
    expect(matchCountries('')).toEqual([...COUNTRY_NAMES])
    expect(matchCountries('   ')).toEqual([...COUNTRY_NAMES])
  })

  it('finds a country by an alias and shows its display name', () => {
    expect(matchCountries('Türkiye')).toEqual(['Turkey'])
    expect(matchCountries('turkiye')).toEqual(['Turkey'])
    expect(matchCountries('Cape Verde')).toEqual(['Cabo Verde'])
    expect(matchCountries('czechia')).toEqual(['Czech Republic'])
    expect(matchCountries('Holland')).toEqual(['Netherlands'])
  })

  it('puts a whole code or alias before names that only start with it', () => {
    expect(matchCountries('uk')[0]).toBe('United Kingdom')
    expect(matchCountries('uk')).toContain('Ukraine')
    expect(matchCountries('us')[0]).toBe('United States')
    expect(matchCountries('USA')[0]).toBe('United States')
    expect(matchCountries('TR')[0]).toBe('Turkey')
    expect(matchCountries('England')).toEqual(['United Kingdom'])
  })

  it('puts a name that starts with the text before one that only holds it', () => {
    const found = matchCountries('ger')
    expect(found[0]).toBe('Germany')
    expect(found).toContain('Algeria')
    expect(found).toContain('Niger')
    expect(found.indexOf('Germany')).toBeLessThan(found.indexOf('Algeria'))
  })

  it('keeps the table order inside a group, and lists a country once', () => {
    const table: Country[] = [
      { code: 'CC', name: 'Cabana' },
      { code: 'BB', name: 'Abanana', aliases: ['Banana', 'Bananas'] },
      { code: 'AA', name: 'Banana Land', aliases: ['Ban'] },
    ]
    expect(matchCountries('bana', table)).toEqual(['Abanana', 'Banana Land', 'Cabana'])
    expect(matchCountries('ban', table)).toEqual(['Banana Land', 'Abanana', 'Cabana'])
    expect(matchCountries('aa', table)).toEqual(['Banana Land'])
  })

  it('finds nothing for text no name holds', () => {
    expect(matchCountries('zzz')).toEqual([])
  })
})
