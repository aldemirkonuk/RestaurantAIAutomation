import { describe, expect, it } from 'vitest';
import { addressWithFind, findFromAddress, fold, lineMatches } from './menu-find';
import type { MenuLine } from '../../../services/api/menus';

const l = (over: Partial<MenuLine>): MenuLine => ({ id: 'x', name: 'Chianti', producer: null, category: 'red', vintage: null, region: null, country: null, grape_variety: null, by_glass_price: null, bottle_price: 52, wine_library_id: null, inventory_item_id: null, source: 'manual', status: 'approved', ...over }) as MenuLine;

describe('menu-find', () => {
  it('folds case, accents and the Turkish dotless i', () => {
    expect(fold('RAKI')).toBe('raki');
    expect(fold('Rakı')).toBe('raki');
    expect(fold('İzmir Şarap')).toBe('izmir sarap');
    expect(fold('Côte-Rôtie')).toBe('cote-rotie');
  });
  it('matches on name, producer, section, region, grape and vintage', () => {
    const w = l({ name: 'Brunello', producer: 'Biondi-Santi', category: 'red', region: 'Toscana', grape_variety: 'Sangiovese', vintage: '2016' });
    for (const t of ['brun', 'biondi', 'RED', 'toscana', 'sangio', '2016']) expect(lineMatches(w, t)).toBe(true);
    expect(lineMatches(w, 'barolo')).toBe(false);
  });
  it('every typed word must be found, in any order; blank finds all', () => {
    const w = l({ name: 'Brunello', producer: 'Biondi-Santi' });
    expect(lineMatches(w, 'santi brun')).toBe(true);
    expect(lineMatches(w, 'santi barolo')).toBe(false);
    expect(lineMatches(w, '   ')).toBe(true);
  });
  it('finds rakı typed as raki', () => {
    expect(lineMatches(l({ name: 'Yeni Rakı' }), 'raki')).toBe(true);
  });
});

describe('the find words in the address', () => {
  it('reads them back, and nothing from an address without them', () => {
    expect(findFromAddress('?find=rak%C4%B1')).toBe('rakı');
    expect(findFromAddress('?x=1')).toBe('');
    expect(findFromAddress('')).toBe('');
  });
  it('puts them in and takes them out, leaving the rest of the address alone', () => {
    expect(addressWithFind('http://h/menu?tab=a#plan', 'raki')).toBe('/menu?tab=a&find=raki#plan');
    expect(addressWithFind('http://h/menu?find=raki', 'rakı balığı')).toBe('/menu?find=rak%C4%B1+bal%C4%B1%C4%9F%C4%B1');
    expect(addressWithFind('http://h/menu?find=raki&tab=a', '  ')).toBe('/menu?tab=a');
    expect(addressWithFind('http://h/menu?find=raki', '')).toBe('/menu');
  });
});
