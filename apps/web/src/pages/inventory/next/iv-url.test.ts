/** ?sort=used round-trips through the page's URL (r106 g5), like the other sorts. */
import { describe, expect, it } from 'vitest';
import { IV_DEFAULT, readView, writeView } from './iv-url';

describe('the sort in the URL', () => {
  it('?sort=used is read and written back', () => {
    const v = readView(new URLSearchParams('sort=used'));
    expect(v.sort).toBe('used');
    expect(writeView(new URLSearchParams(), v).get('sort')).toBe('used');
  });
  it('an unknown sort is the default, and the default is not written', () => {
    expect(readView(new URLSearchParams('sort=lucky')).sort).toBe(IV_DEFAULT.sort);
    expect(writeView(new URLSearchParams(), IV_DEFAULT).has('sort')).toBe(false);
  });
});
