/**
 * Two of the house's goods a menu line fits, told apart (r37 walk w1 M-F1):
 * no two goods offered for one line are ever named alike.
 */
import { describe, expect, it } from 'vitest';
import type { HouseCandidate } from '../../../services/api/menus';
import { houseCandidateWords } from './house-candidate-words';

const say = (n: number) => `$${n.toFixed(2)}`;
const g = (over: Partial<HouseCandidate>): HouseCandidate => ({ inventoryItemId: 'x', name: 'House White', kind: 'wine', ...over });

describe('houseCandidateWords', () => {
  it('one good is named by its kind only', () => {
    expect(houseCandidateWords([g({ bottleSizeMl: 750, bottlePrice: 30 })], say)).toEqual(['House White (wine)']);
  });

  it('names only what differs, each detail in its place', () => {
    expect(
      houseCandidateWords(
        [
          g({ vintage: '2021', producer: 'Kavaklidere', bottleSizeMl: 750, bottlePrice: 30, glassPrice: 8, source: 'wine_library' }),
          g({ vintage: '2022', producer: 'Kavaklidere', bottleSizeMl: 1000, bottlePrice: 30, glassPrice: 8, source: 'wine_library' }),
        ],
        say,
      ),
    ).toEqual(['House White (wine, 2021, 750 ml)', 'House White (wine, 2022, 1000 ml)']);
  });

  it('says a differing detail one good lacks as missing, never as a blank', () => {
    expect(
      houseCandidateWords(
        [g({ producer: 'Doluca', bottlePrice: 30, glassPrice: null }), g({ producer: null, bottlePrice: null, glassPrice: 7.5 })],
        say,
      ),
    ).toEqual([
      'House White (wine, Doluca, $30.00 a bottle, no glass price)',
      'House White (wine, no producer, no bottle price, $7.50 a glass)',
    ]);
  });

  it('names where each good came from when that is all that differs', () => {
    expect(
      houseCandidateWords(
        [g({ source: 'house_declared' }), g({ source: 'beverage_catalogue' }), g({ source: 'backfill' }), g({ source: null })],
        say,
      ),
    ).toEqual([
      'House White (wine, added by hand)',
      'House White (wine, from the drinks catalogue)',
      'House White (wine, kept from before)',
      'House White (wine, source not recorded)',
    ]);
  });

  it('says the place of each when nothing the page holds tells them apart (an older gateway)', () => {
    const words = houseCandidateWords([g({}), g({}), g({ name: 'House white.' })], say);
    expect(words).toEqual(['House White (wine, 1 of 2 alike)', 'House White (wine, 2 of 2 alike)', 'House white. (wine)']);
    expect(new Set(words).size).toBe(3);
  });

  it('a good with no kind and nothing else differing is its bare name', () => {
    expect(houseCandidateWords([g({ kind: null }), g({ name: 'House red.', kind: null })], say)).toEqual(['House White', 'House red.']);
  });
});
