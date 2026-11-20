import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import RegisterEvidenceLine, { evidenceVerdict } from './RegisterEvidenceLine';

const line = (ev: Partial<{ inventoryRows: number | null; menuRows: number | null; catalogueRows: number | null }>, c: 'certain' | 'likely' | 'none' | 'unknown') =>
  render(
    <RegisterEvidenceLine
      evidence={{ inventoryRows: 0, menuRows: 0, catalogueRows: 0, nameOnly: false, ...ev }}
      confidence={c}
    />,
  ).container.textContent ?? '';

describe('RegisterEvidenceLine (design critic N-20)', () => {
  it('says "none", not a bare 0, and never ends on a lone confidence word', () => {
    const t = line({ menuRows: 12 }, 'likely');
    expect(t).toContain('none in the shared catalogue');
    expect(t).toContain('12 on the menu');
    expect(t).not.toMatch(/\b0 in the shared catalogue/);
    expect(t).not.toMatch(/· likely$/);
    expect(t.endsWith('the books suggest it')).toBe(true);
  });

  it('keeps a figure that was read, and a dash for one that was not', () => {
    const t = line({ inventoryRows: 50, catalogueRows: 442, menuRows: null }, 'certain');
    expect(t).toMatch(/50 in the cellar/);
    expect(t).toMatch(/442 in the shared catalogue/);
    expect(t).toMatch(/— on the menu/);
  });

  it('has a sentence for every confidence', () => {
    expect(evidenceVerdict('none')).toBe('nothing found');
    expect(evidenceVerdict('unknown')).toBe('not known yet');
    expect(evidenceVerdict('certain')).toBe('the books settle it');
  });
});
