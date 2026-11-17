import { describe, expect, it } from 'vitest';
import { fold, lineMatches } from './menu-find';
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
