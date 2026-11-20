/**
 * "How it tastes" on a recipe sheet: the summary line, the card, and the one
 * action. A failed read says so and shows nothing as known (ADR 0020); a
 * failed roll-up says why in words and leaves the taste as it was; no figure
 * from the 0..10 scale and no confidence is ever on screen (ADR 0104).
 * Fixtures are synthetic.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TasteData } from '../../../../services/api/taste';

const api = vi.hoisted(() => ({ get: vi.fn(), roll: vi.fn(), auth: { activeRole: 'manager', user: { role: 'manager' } } as Record<string, unknown> }));
vi.mock('../../../../contexts/AuthContext', () => ({ useAuth: () => api.auth }));
vi.mock('../../../../services/api/taste', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getTaste: api.get,
  rollupTaste: api.roll,
}));

import RecipeTaste, {
  RECIPE_TASTE_EMPTY,
  RECIPE_TASTE_EMPTY_READ,
  RECIPE_TASTE_LINE_FAILED,
  RECIPE_TASTE_LINE_NONE,
  RECIPE_TASTE_NO_RECIPE,
  RECIPE_TASTE_NO_RECIPE_READ,
  RECIPE_TASTE_UNSAVED,
  RecipeTasteLine,
  TASTE_CARD_RESERVE_PX,
  TASTE_LINE_RESERVE_PX,
} from './RecipeTaste';
import { ROLLUP_RECIPES_UNAVAILABLE, ROLLUP_UNREACHABLE } from '../../../../services/api/taste';

const recipeLayer = { source: 'recipe', version: 1, method: 'computed', statedByName: null, statedAt: '2026-11-19T10:00:00Z', hasNote: false, noteText: null };
const worked = (): TasteData => ({
  effective: {
    axes: {
      sour: { v: 7, lo: 6, hi: 8, conf: 0.55, prov: [{ kind: 'recipe', share: 1 }], bandOnly: false },
      sweet: { v: 5, lo: 4, hi: 6, conf: 0.55, prov: [{ kind: 'recipe', share: 1 }], bandOnly: false },
    },
    descriptors: [],
    texture: [],
    conflicts: [],
  },
  layers: [recipeLayer],
});
const none = (): TasteData => ({ effective: null, layers: [] });

function mount(over: Partial<{ kind: 'cocktail' | 'dish'; hasRecipe: boolean; unsaved: boolean }> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const kind = over.kind ?? 'cocktail';
  return render(
    <QueryClientProvider client={qc}>
      <RecipeTasteLine kind={kind} subjectId="c1" restaurantId="r1" hasRecipe={over.hasRecipe ?? true} />
      <RecipeTaste kind={kind} subjectId="c1" restaurantId="r1" hasRecipe={over.hasRecipe ?? true} unsaved={over.unsaved ?? false} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  cleanup();
  api.get.mockReset();
  api.roll.mockReset();
  api.auth = { activeRole: 'manager', user: { role: 'manager' } };
});

describe('RecipeTaste', () => {
  it('a worked-out drink says so in a line and a card, marked as from the recipe, and offers Read again', async () => {
    api.get.mockResolvedValue({ state: 'ready', data: worked() });
    mount();
    const line = await screen.findByTestId('recipe-taste-line');
    expect(line).toHaveTextContent(/How it tastes/);
    expect(screen.getByTestId('recipe-taste-line-marks').getAttribute('aria-label')).toMatch(/worked out from the recipe/);
    expect(await screen.findByTestId('taste-row-sour')).toBeInTheDocument();
    expect(screen.getByTestId('taste-mark-sour').getAttribute('aria-label')).toMatch(/recipe/);
    expect(screen.getByRole('button', { name: 'Read again' })).toBeEnabled();
    // Read once for both parts, for this drink, as a cocktail.
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledWith('cocktail', 'c1', 'r1');
    // No figure from the scale and no confidence.
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/\b\d+(\.\d+)?\s*\/\s*10\b|confidence|0\.55/i);
    // A recipe sheet does not offer the form that describes a good.
    expect(screen.queryByRole('button', { name: /Describe the taste/ })).toBeNull();
  });

  it('the line jump moves focus to the card heading without scrolling again', async () => {
    api.get.mockResolvedValue({ state: 'ready', data: worked() });
    mount();
    const open = await screen.findByTestId('recipe-taste-line-open');
    await screen.findByTestId('taste-row-sour');
    const heading = screen.getByRole('heading', { name: 'How it tastes' });
    expect(heading).toHaveAttribute('tabindex', '-1');
    const focus = vi.spyOn(heading, 'focus');
    fireEvent.click(open);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(document.activeElement).toBe(heading);
  });

  it('a drink with no taste yet says it is not worked out and offers Work it out; the answer replaces the card', async () => {
    api.get.mockResolvedValue({ state: 'ready', data: none() });
    // Once worked out, a read finds it (the gateway keeps the layer).
    api.roll.mockImplementation(async () => {
      api.get.mockResolvedValue({ state: 'ready', data: worked() });
      return { state: 'ready', data: worked() };
    });
    mount();
    expect(await screen.findByTestId('taste-empty')).toHaveTextContent(RECIPE_TASTE_EMPTY);
    expect(screen.queryByTestId('recipe-taste-line')).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'Work it out' })[1]);
    await waitFor(() => expect(api.roll).toHaveBeenCalledWith('cocktail', 'c1', 'r1'));
    expect(await screen.findByTestId('taste-row-sour')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Read again' })).toBeInTheDocument();
    expect(await screen.findByTestId('recipe-taste-line')).toBeInTheDocument();
  });

  it('asks as a dish for a dish', async () => {
    api.get.mockResolvedValue({ state: 'ready', data: none() });
    api.roll.mockResolvedValue({ state: 'ready', data: worked() });
    mount({ kind: 'dish' });
    fireEvent.click((await screen.findAllByRole('button', { name: 'Work it out' }))[0]);
    await waitFor(() => expect(api.roll).toHaveBeenCalledWith('dish', 'c1', 'r1'));
    expect(api.get).toHaveBeenCalledWith('dish', 'c1', 'r1');
  });

  it('recipes unavailable (503) is said in words and the taste stays as it was', async () => {
    api.get.mockResolvedValue({ state: 'ready', data: worked() });
    api.roll.mockResolvedValue({ state: 'failed', sentence: ROLLUP_RECIPES_UNAVAILABLE });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Read again' }));
    expect(await screen.findByTestId('recipe-taste-said')).toHaveTextContent(ROLLUP_RECIPES_UNAVAILABLE);
    expect(screen.getByRole('alert')).toBe(screen.getByTestId('recipe-taste-said'));
    expect(screen.getByTestId('taste-row-sour')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Read again' })).toBeEnabled();
  });

  it('an unreachable gateway is said in words, never as the transport’s "Network Error"', async () => {
    api.get.mockResolvedValue({ state: 'ready', data: none() });
    api.roll.mockResolvedValue({ state: 'failed', sentence: ROLLUP_UNREACHABLE });
    mount();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Work it out' }))[1]);
    const said = await screen.findByTestId('recipe-taste-said');
    expect(said).toHaveTextContent('Mudavym could not be reached just now.');
    expect(document.body.textContent).not.toMatch(/Network Error/);
  });

  it('a read that failed says so, shows nothing as known and offers no roll-up', async () => {
    api.get.mockResolvedValue({ state: 'failed', reason: 'x' });
    mount();
    expect(await screen.findByTestId('taste-failed')).toBeInTheDocument();
    expect(screen.getByTestId('recipe-taste-line')).toHaveTextContent(RECIPE_TASTE_LINE_FAILED);
    expect(screen.queryByTestId('taste-rows')).toBeNull();
    expect(screen.queryByTestId('recipe-taste-act')).toBeNull();
  });

  it('a read that could not be reached says so in the line and the card', async () => {
    api.get.mockResolvedValue({ state: 'failed', reason: 'Mudavym could not be reached just now.' });
    mount();
    expect(await screen.findByTestId('taste-failed')).toHaveTextContent('Mudavym could not be reached just now.');
    expect(screen.getByTestId('recipe-taste-line')).toHaveTextContent('Mudavym could not be reached just now.');
    expect(screen.getByTestId('recipe-taste-line')).not.toHaveTextContent(RECIPE_TASTE_LINE_FAILED);
  });

  it('taste notes not switched on: the card says so and there is no action', async () => {
    api.get.mockResolvedValue({ state: 'absent' });
    mount();
    expect(await screen.findByTestId('taste-absent')).toBeInTheDocument();
    expect(screen.queryByTestId('recipe-taste-act')).toBeNull();
    expect(screen.queryByTestId('recipe-taste-line')).toBeNull();
    // The line still keeps its one line, in words only: nothing to work out while it is off.
    expect(screen.getByTestId('recipe-taste-line-none-words')).toHaveTextContent(RECIPE_TASTE_LINE_NONE);
    expect(screen.queryByTestId('recipe-taste-line-work')).toBeNull();
  });

  it('a drink with no saved recipe says what to do instead of offering the roll-up', async () => {
    api.get.mockResolvedValue({ state: 'ready', data: none() });
    mount({ hasRecipe: false });
    expect(await screen.findByTestId('recipe-taste-norecipe')).toHaveTextContent(RECIPE_TASTE_NO_RECIPE);
    expect(screen.queryByTestId('recipe-taste-act')).toBeNull();
  });

  it('lines typed and not saved: says the taste is worked out from the saved recipe', async () => {
    api.get.mockResolvedValue({ state: 'ready', data: worked() });
    mount({ unsaved: true });
    expect(await screen.findByTestId('recipe-taste-unsaved')).toHaveTextContent(RECIPE_TASTE_UNSAVED);
  });

  it('the action is held while it works, so one tap is one request', async () => {
    api.get.mockResolvedValue({ state: 'ready', data: none() });
    let release: (v: unknown) => void = () => {};
    api.roll.mockReturnValue(new Promise((r) => { release = r; }));
    mount();
    const btn = (await screen.findAllByRole('button', { name: 'Work it out' }))[1];
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByTestId('recipe-taste-act')).toBeDisabled());
    fireEvent.click(screen.getByTestId('recipe-taste-act'));
    expect(api.roll).toHaveBeenCalledTimes(1);
    release({ state: 'ready', data: worked() });
    await waitFor(() => expect(screen.getByTestId('recipe-taste-act')).toBeEnabled());
  });

  it('staff see the card and the line but are not offered Work it out or Read again (the sheet is read-only to them)', async () => {
    api.auth = { activeRole: 'staff', user: { role: 'staff' } };
    api.get.mockResolvedValue({ state: 'ready', data: worked() });
    mount();
    expect(await screen.findByTestId('taste-row-sour')).toBeInTheDocument();
    expect(screen.getByTestId('recipe-taste-line')).toBeInTheDocument();
    expect(screen.queryByTestId('recipe-taste-act')).toBeNull();
    expect(screen.queryByRole('button', { name: /Work it out|Read again/ })).toBeNull();
  });

  it('staff on a drink not worked out yet are told who works it out, and given no instruction they cannot follow', async () => {
    api.auth = { activeRole: 'staff', user: { role: 'staff' } };
    api.get.mockResolvedValue({ state: 'ready', data: none() });
    mount();
    expect(await screen.findByTestId('taste-empty')).toHaveTextContent(RECIPE_TASTE_EMPTY_READ);
    expect(screen.queryByTestId('recipe-taste-act')).toBeNull();
    expect(document.body.textContent).not.toContain(RECIPE_TASTE_EMPTY);
  });

  it('staff on a drink with no recipe are not told to save one', async () => {
    api.auth = { activeRole: 'staff', user: { role: 'staff' } };
    api.get.mockResolvedValue({ state: 'ready', data: none() });
    mount({ hasRecipe: false });
    expect(await screen.findByTestId('recipe-taste-norecipe')).toHaveTextContent(RECIPE_TASTE_NO_RECIPE_READ);
    expect(document.body.textContent).not.toContain(RECIPE_TASTE_NO_RECIPE);
  });

  it('an owner is offered the action', async () => {
    api.auth = { activeRole: 'owner', user: { role: 'owner' } };
    api.get.mockResolvedValue({ state: 'ready', data: none() });
    mount();
    expect((await screen.findAllByRole('button', { name: 'Work it out' }))[1]).toBeEnabled();
  });

  it('while the taste is being read the line and the card already hold the height they will have, so nothing below moves', async () => {
    let release: (v: unknown) => void = () => {};
    api.get.mockReturnValue(new Promise((r) => { release = r; }));
    mount();
    const wait = await screen.findByTestId('recipe-taste-line-wait');
    expect(wait.style.minHeight).toBe(`${TASTE_LINE_RESERVE_PX}px`);
    const card = screen.getByTestId('recipe-taste');
    expect(card.getAttribute('data-state')).toBe('loading');
    expect(card.style.minHeight).toBe(`${TASTE_CARD_RESERVE_PX}px`);
    release({ state: 'ready', data: worked() });
    expect(await screen.findByTestId('recipe-taste-line')).toBeInTheDocument();
    expect(screen.queryByTestId('recipe-taste-line-wait')).toBeNull();
    expect(screen.getByTestId('recipe-taste').getAttribute('data-state')).toBe('settled');
    expect(screen.getByTestId('recipe-taste').style.minHeight).toBe('');
  });

  describe('the top line never collapses (r91)', () => {
    it('pending: a placeholder of the line height; a sentence: the sentence at that same height floor; no taste yet: words that keep it', async () => {
      let release: (v: unknown) => void = () => {};
      api.get.mockReturnValue(new Promise((r) => { release = r; }));
      mount();
      expect((await screen.findByTestId('recipe-taste-line-wait')).style.minHeight).toBe(`${TASTE_LINE_RESERVE_PX}px`);
      release({ state: 'ready', data: none() });
      const none_ = await screen.findByTestId('recipe-taste-line-none');
      expect(none_.style.minHeight).toBe(`${TASTE_LINE_RESERVE_PX}px`);
      expect(none_).toHaveTextContent(RECIPE_TASTE_LINE_NONE);
      expect(screen.queryByTestId('recipe-taste-line-wait')).toBeNull();
    });

    it('a sentence is shown as the sentence, with no "no taste" words', async () => {
      api.get.mockResolvedValue({ state: 'ready', data: worked() });
      mount();
      expect(await screen.findByTestId('recipe-taste-line')).toBeInTheDocument();
      expect(screen.queryByTestId('recipe-taste-line-none')).toBeNull();
      expect(document.body.textContent).not.toContain(RECIPE_TASTE_LINE_NONE);
    });

    it('no taste yet, manager: the words and a Work it out link that runs the roll-up and swaps in the sentence', async () => {
      api.get.mockResolvedValue({ state: 'ready', data: none() });
      api.roll.mockImplementation(async () => {
        api.get.mockResolvedValue({ state: 'ready', data: worked() });
        return { state: 'ready', data: worked() };
      });
      mount();
      const link = await screen.findByTestId('recipe-taste-line-work');
      expect(screen.getByTestId('recipe-taste-line-none')).toHaveTextContent(RECIPE_TASTE_LINE_NONE);
      fireEvent.click(link);
      await waitFor(() => expect(api.roll).toHaveBeenCalledWith('cocktail', 'c1', 'r1'));
      expect(await screen.findByTestId('recipe-taste-line')).toBeInTheDocument();
      expect(screen.queryByTestId('recipe-taste-line-none')).toBeNull();
    });

    it('no taste yet, owner: the same link', async () => {
      api.auth = { activeRole: 'owner', user: { role: 'owner' } };
      api.get.mockResolvedValue({ state: 'ready', data: none() });
      mount();
      expect(await screen.findByTestId('recipe-taste-line-work')).toBeEnabled();
    });

    it('no taste yet, staff: the words only, no link', async () => {
      api.auth = { activeRole: 'staff', user: { role: 'staff' } };
      api.get.mockResolvedValue({ state: 'ready', data: none() });
      mount();
      expect(await screen.findByTestId('recipe-taste-line-none')).toHaveTextContent(RECIPE_TASTE_LINE_NONE);
      expect(screen.queryByTestId('recipe-taste-line-work')).toBeNull();
    });

    it('no taste yet and no saved recipe: the words, and no link to a roll-up with nothing to work from', async () => {
      api.get.mockResolvedValue({ state: 'ready', data: none() });
      mount({ hasRecipe: false });
      expect(await screen.findByTestId('recipe-taste-line-none')).toHaveTextContent(RECIPE_TASTE_LINE_NONE);
      expect(screen.queryByTestId('recipe-taste-line-work')).toBeNull();
    });

    it('a roll-up that fails is said on the line and the words stay', async () => {
      api.get.mockResolvedValue({ state: 'ready', data: none() });
      api.roll.mockResolvedValue({ state: 'failed', sentence: ROLLUP_UNREACHABLE });
      mount();
      fireEvent.click(await screen.findByTestId('recipe-taste-line-work'));
      expect(await screen.findByTestId('recipe-taste-line-said')).toHaveTextContent('Mudavym could not be reached just now.');
      expect(screen.getByTestId('recipe-taste-line-none-words')).toHaveTextContent(RECIPE_TASTE_LINE_NONE);
    });
  });
});
