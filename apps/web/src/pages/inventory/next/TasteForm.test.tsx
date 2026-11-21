/**
 * "Describe the taste": the flavour words offered follow the good's kind, so a
 * gin, a beer or a wine is never asked to be "creamy and savoury" only.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TasteForm, { buildBody } from './TasteForm';

function form(kind?: string | null) {
  const qc = new QueryClient();
  render(
    <QueryClientProvider client={qc}>
      <TasteForm restaurantId="r1" itemId="g1" kind={kind} onSaved={vi.fn()} onCancel={vi.fn()} onUnconfirmed={vi.fn()} />
    </QueryClientProvider>,
  );
  return [...document.querySelectorAll('[data-testid^="taste-chip-"]')].map((e) => e.getAttribute('data-testid')!.slice('taste-chip-'.length));
}

describe('TasteForm words by kind', () => {
  it('a wine offers fruit, oak and finish words and none of the food-only words', () => {
    const ids = form('wine');
    expect(ids).toEqual(expect.arrayContaining(['red-fruit', 'oak', 'long-finish']));
    expect(ids).not.toContain('savoury');
    expect(ids).not.toContain('chewy');
  });
  it('a beer offers malt, hop and yeast words; a gin offers juniper; coffee offers cocoa; a cocktail offers balance', () => {
    expect(form('beer')).toEqual(expect.arrayContaining(['bready', 'piney', 'fruity-yeast']));
    document.body.innerHTML = '';
    expect(form('spirit')).toContain('juniper');
    document.body.innerHTML = '';
    expect(form('soft_drink')).toContain('cocoa');
    document.body.innerHTML = '';
    expect(form('cocktail')).toContain('spirit-forward');
  });
  it('a food, an unclassified good and a good with no kind keep the original twelve food words', () => {
    for (const k of ['food', 'other', undefined, null]) {
      document.body.innerHTML = '';
      const ids = form(k);
      expect(ids).toEqual(expect.arrayContaining(['savoury', 'rich', 'tangy', 'chewy']));
      expect(ids).not.toContain('oak');
    }
  });
  it('a chip reads as words, not as its stored id', () => {
    form('wine');
    expect(screen.getByTestId('taste-chip-red-fruit').textContent).toBe('red fruit');
    fireEvent.click(screen.getByTestId('taste-chip-red-fruit'));
    expect(screen.getByTestId('taste-chip-red-fruit').getAttribute('aria-pressed')).toBe('true');
  });
});

describe('buildBody with drink words', () => {
  it('drink aromas go to descriptors and a texture word goes to texture', () => {
    expect(buildBody({}, ['oak', 'silky'], '')).toEqual({ descriptors: ['oak'], texture: ['silky'], method: 'cata' });
  });
});
