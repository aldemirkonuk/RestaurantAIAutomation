/**
 * The cocktail list's failure sentences (F-338).
 *
 * Only a definite refusal may say "nothing was written". A timeout or a server
 * fault can land after the cocktail, its recipe, or its retirement did — and
 * telling the owner nothing happened invites a second press that writes twice.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, cleanup, render, screen, fireEvent } from '@testing-library/react';
import { AxiosError } from 'axios';

const mock = vi.hoisted(() => ({
  create: vi.fn(),
  amend: vi.fn(),
  retire: vi.fn(),
  setRecipe: vi.fn(),
  price: null as number | null,
  recipeRows: [] as { quantity: number | null; unit: string | null; free_text: string | null }[],
  // F-1329: the first cocktail's cost per serve, the list's withholding, and
  // the recipe the leaf reads.
  serve: undefined as Record<string, unknown> | null | undefined,
  withheld: false,
  recipe: { cocktailId: 'c1', rows: [], count: 0, writable: true } as Record<string, unknown>,
}));

// The house's thousands mark and the screen's (F-879), held per test.
const marks = vi.hoisted(() => ({ house: null as '.' | ',' | null, screen: null as '.' | ',' | null }));
vi.mock('@/hooks/useHouseGroupMark', () => ({ useHouseGroupMark: () => marks.house }));
vi.mock('@/lib/parseDecimal', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/parseDecimal')>()),
  displayGroupMark: () => marks.screen,
}));

vi.mock('./useCellarNextData', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  // An owner here (F-270's role read needs no AuthProvider in this suite).
  useMayPriceCocktails: () => true,
  useCocktailRegister: () => ({
    loading: false,
    error: null,
    data: {
      rows: [{
        id: 'c1', name: 'Negroni', display_name: null, menu_section: null,
        method: null, glass: null, garnish: null, price: mock.price, description: null,
        serve: mock.serve,
      }, {
        id: 'c2', name: 'Rakı Sour', display_name: null, menu_section: 'İmza',
        method: null, glass: null, garnish: null, price: null, description: null,
      }],
      count: 2, truncated: false, referenceRows: null, recipesAvailable: false,
      scopeNote: 'Only cocktails this restaurant owns.',
      ...(mock.withheld ? { amountsWithheld: true } : {}),
    },
  }),
  useCocktailRecipe: () => ({
    // Integ: F-1393's `recipeRows` and F-1329's `recipe` both feed the leaf.
    data: mock.recipeRows.length
      ? { cocktailId: 'c1', rows: mock.recipeRows, count: mock.recipeRows.length, writable: true }
      : mock.recipe,
    loading: false,
    error: null,
  }),
  useCocktailWrites: () => ({
    create: { mutateAsync: mock.create, isPending: false },
    amend: { mutateAsync: mock.amend, isPending: false },
    retire: { mutateAsync: mock.retire, isPending: false },
    setRecipe: { mutateAsync: mock.setRecipe, isPending: false },
  }),
}));

import CocktailRegister from './CocktailRegister';

/** A request that went out and never got an answer — the real axios shape. */
const timeout = () =>
  new AxiosError('timeout of 30000ms exceeded', 'ECONNABORTED', undefined, {});
const serverFault = () =>
  Object.assign(new Error('Request failed with status code 502'), { response: { status: 502 } });
const refusal = () =>
  Object.assign(new Error('name taken'), { response: { status: 409 } });

const draw = () => render(<CocktailRegister register={null} registerLoading={false} />);

async function addOne() {
  fireEvent.click(screen.getByRole('button', { name: /Add a cocktail/ }));
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Paloma' } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /Put it on the list/ }));
  });
}

beforeEach(() => {
  mock.create.mockReset();
  mock.amend.mockReset();
  mock.retire.mockReset();
  mock.setRecipe.mockReset();
  mock.price = null;
  mock.recipeRows = [];
  mock.serve = undefined;
  mock.withheld = false;
  mock.recipe = { cocktailId: 'c1', rows: [], count: 0, writable: true };
  marks.house = null;
  marks.screen = null;
});

describe('adding a cocktail', () => {
  it.each([['a timeout', timeout], ['a server fault', serverFault]])(
    'after %s, says it may already be on the list, never "nothing was written"',
    async (_, err) => {
      mock.create.mockRejectedValue(err());
      draw();
      await addOne();
      const said = screen.getByTestId('cocktail-said');
      expect(said).toHaveTextContent(/may already be on the list.*Check the list before pressing again/s);
      expect(said).not.toHaveTextContent(/Nothing was written|30000ms/);
      expect(screen.getByLabelText('Name')).toHaveValue('Paloma');
    },
  );

  it('a definite refusal still says nothing was written', async () => {
    mock.create.mockRejectedValue(refusal());
    draw();
    await addOne();
    expect(screen.getByTestId('cocktail-said')).toHaveTextContent(/Nothing was written — name taken/);
  });
});

// F-879: the price was a number input. "12,50" in a browser whose number input
// does not take a comma came back as '', which an amend sends as null -- the
// stored price was erased while the page said "amended".
describe('the price on an amend', () => {
  async function amendWith(price: string) {
    mock.price = 18;
    mock.amend.mockResolvedValue({ id: 'c1' });
    draw();
    fireEvent.click(screen.getByText('Negroni'));
    fireEvent.click(screen.getByRole('button', { name: /^Amend$/ }));
    const field = screen.getByLabelText('Price');
    expect(field).toHaveAttribute('type', 'text');
    expect(field).toHaveValue('18');
    fireEvent.change(field, { target: { value: price } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Record the amendment/ }));
    });
  }

  it('text that is not a price is refused, and the stored price is not touched', async () => {
    await amendWith('12,5,0');
    expect(mock.amend).not.toHaveBeenCalled();
    expect(screen.getByTestId('cocktail-said')).toHaveTextContent(/Nothing was written — “12,5,0” is not a price/);
    expect(screen.getByLabelText('Price')).toHaveValue('12,5,0');
  });

  it('"12,50" is read the way the house writes it', async () => {
    await amendWith('12,50');
    expect(mock.amend).toHaveBeenCalledWith({ id: 'c1', input: expect.objectContaining({ price: 12.5 }) });
  });

  it('a figure that reads two ways is asked, and nothing is sent', async () => {
    marks.house = '.';
    marks.screen = ',';
    await amendWith('1,250');
    expect(mock.amend).not.toHaveBeenCalled();
    expect(screen.getByTestId('cocktail-said')).toHaveTextContent(/“1,250” could be 1\.25 or 1,250\.00/);
  });

  it('only a truly empty field clears the price', async () => {
    await amendWith('');
    expect(mock.amend).toHaveBeenCalledWith({ id: 'c1', input: expect.objectContaining({ price: null }) });
  });
});

describe('recording a recipe', () => {
  async function record() {
    fireEvent.click(screen.getByText('Negroni'));
    fireEvent.click(screen.getByRole('button', { name: /Write the recipe/ }));
    fireEvent.change(screen.getByLabelText('Recipe lines'), { target: { value: '30 ml gin' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Record the recipe/ }));
    });
  }

  it('after a timeout, says the recipe may have been recorded, never "nothing was changed"', async () => {
    mock.setRecipe.mockRejectedValue(timeout());
    draw();
    await record();
    const note = screen.getByText(/No answer came back/);
    expect(note).toHaveTextContent(/may have been recorded.*before recording it again/s);
    expect(screen.queryByText(/Nothing was changed/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Recipe lines')).toHaveValue('30 ml gin');
  });

  it('a definite refusal still says nothing was changed', async () => {
    mock.setRecipe.mockRejectedValue(refusal());
    draw();
    await record();
    expect(screen.getByText(/The recipe was NOT recorded — name taken\. Nothing was changed\./)).toBeInTheDocument();
  });

  // F-917: the line is said from what was saved — no "first recipe ever"
  // claim on an amend, and a clearing save says it cleared.
  it('says how many lines were recorded, and nothing about a first recipe', async () => {
    mock.setRecipe.mockResolvedValue({ lines: 1 });
    draw();
    await record();
    expect(screen.getByText('Recipe recorded: 1 line.')).toBeInTheDocument();
    expect(screen.queryByText(/first recipe/)).not.toBeInTheDocument();
  });

  it('a save with no lines says the recipe was cleared', async () => {
    mock.setRecipe.mockResolvedValue({ lines: 0 });
    draw();
    fireEvent.click(screen.getByText('Negroni'));
    fireEvent.click(screen.getByRole('button', { name: /Write the recipe/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Record the recipe/ }));
    });
    expect(mock.setRecipe).toHaveBeenCalledWith({ id: 'c1', lines: [] });
    expect(screen.getByText(/Recipe cleared/)).toBeInTheDocument();
    expect(screen.queryByText(/0 lines recorded|first recipe/)).not.toBeInTheDocument();
  });
});

// F-1327: measures were read with a bare Number() on "1.5"/"1,5" only, so
// "1.000 ml" was 1 ml in a house that groups with "." and "1 1/2 oz" was 1.
describe('reading a recipe measure', () => {
  async function recordLines(value: string) {
    mock.setRecipe.mockResolvedValue({ lines: value.split('\n').length });
    draw();
    fireEvent.click(screen.getByText('Negroni'));
    fireEvent.click(screen.getByRole('button', { name: /Write the recipe/ }));
    fireEvent.change(screen.getByLabelText('Recipe lines'), { target: { value } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Record the recipe/ }));
    });
    return mock.setRecipe.mock.calls[0][0].lines;
  }

  it('reads the house thousands mark, a b/c, and ½ ¾ as one measure', async () => {
    marks.house = '.';
    const lines = await recordLines('1.000 ml su\n1 1/2 oz bourbon\n½ oz lime\n1¾ oz rye\n30 ml gin\norange peel');
    expect(lines).toEqual([
      expect.objectContaining({ quantity: 1000, unit: 'ml', freeText: 'su' }),
      expect.objectContaining({ quantity: 1.5, unit: 'oz', freeText: 'bourbon' }),
      expect.objectContaining({ quantity: 0.5, unit: 'oz', freeText: 'lime' }),
      expect.objectContaining({ quantity: 1.75, unit: 'oz', freeText: 'rye' }),
      expect.objectContaining({ quantity: 30, unit: 'ml', freeText: 'gin' }),
      { quantity: undefined, unit: undefined, freeText: 'orange peel', sortOrder: 5 },
    ]);
  });

  it('keeps a measure it cannot read as written, with no quantity, and says so', async () => {
    const lines = await recordLines('1.2.3 ml gin');
    expect(lines).toEqual([{ quantity: undefined, unit: undefined, freeText: '1.2.3 ml gin', sortOrder: 0 }]);
    expect(screen.getByText(/“1\.2\.3 ml gin” could not be read as a number.*kept as written/)).toBeInTheDocument();
  });
});

// F-1393: the editor was refilled with the stored number as "1.125", which a
// house that groups with "." read back as 1125 on the next save.
describe('amending a recorded recipe in a house that groups with "."', () => {
  it('1⅛ oz and 1 1/3 oz come back as written and are re-sent unchanged', async () => {
    marks.house = '.';
    draw();
    fireEvent.click(screen.getByText('Negroni'));
    fireEvent.click(screen.getByRole('button', { name: /Write the recipe/ }));
    fireEvent.change(screen.getByLabelText('Recipe lines'), { target: { value: '1⅛ oz gin\n1 1/3 oz rye' } });
    mock.setRecipe.mockResolvedValue({ lines: 2 });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Record the recipe/ }));
    });
    const first = mock.setRecipe.mock.calls[0][0].lines;
    expect(first.map((l: { quantity: number }) => l.quantity)).toEqual([1.125, 1.333]);
    mock.recipeRows = first.map((l: { quantity: number; unit: string; freeText: string }) => ({
      quantity: l.quantity, unit: l.unit, free_text: l.freeText,
    }));
    cleanup();

    draw();
    fireEvent.click(screen.getByText('Negroni'));
    expect(screen.getByText('1,125 oz')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Amend the recipe/ }));
    expect(screen.getByLabelText('Recipe lines')).toHaveValue('1,125 oz gin\n1,333 oz rye');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Record the recipe/ }));
    });
    expect(mock.setRecipe.mock.calls[1][0].lines).toEqual(first);
  });
});

// F-1325: the recipe editor was not keyed on the cocktail, so a draft typed
// for one followed the owner to the next row and was recorded as its recipe.
describe('an unrecorded recipe draft when another cocktail is opened', () => {
  function typeForNegroni() {
    draw();
    fireEvent.click(screen.getByText('Negroni'));
    fireEvent.click(screen.getByRole('button', { name: /Write the recipe/ }));
    fireEvent.change(screen.getByLabelText('Recipe lines'), { target: { value: '30 ml gin' } });
  }

  it('asks first, and staying keeps the lines on Negroni', () => {
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false);
    typeForNegroni();
    fireEvent.click(screen.getByText('Rakı Sour'));
    expect(ask).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { name: 'Negroni' })).toBeInTheDocument();
    expect(screen.getByLabelText('Recipe lines')).toHaveValue('30 ml gin');
    ask.mockRestore();
  });

  it('leaving drops the draft — the next cocktail never inherits it', async () => {
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(true);
    typeForNegroni();
    fireEvent.click(screen.getByText('Rakı Sour'));
    expect(screen.getByRole('heading', { name: 'Rakı Sour' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Recipe lines')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Write the recipe/ })).toBeInTheDocument();
    expect(mock.setRecipe).not.toHaveBeenCalled();
    ask.mockRestore();
  });

  it('does not ask when nothing was typed', () => {
    const ask = vi.spyOn(window, 'confirm');
    draw();
    fireEvent.click(screen.getByText('Negroni'));
    fireEvent.click(screen.getByRole('button', { name: /Write the recipe/ }));
    fireEvent.click(screen.getByText('Rakı Sour'));
    expect(ask).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Rakı Sour' })).toBeInTheDocument();
    ask.mockRestore();
  });
});

describe('taking one off the list', () => {
  it('after a server fault, never says it was not retired', async () => {
    mock.retire.mockRejectedValue(serverFault());
    draw();
    fireEvent.click(screen.getByText('Negroni'));
    fireEvent.click(screen.getByRole('button', { name: /Take it off the list/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /confirm/ }));
    });
    const said = screen.getByTestId('cocktail-said');
    expect(said).toHaveTextContent(/“Negroni” may already be off the list/);
    expect(said).not.toHaveTextContent(/NOT retired/);
  });
});

// F-1179 (rehit of F-362): the register's search lowercased bare, so "raki"
// missed "Rakı" and "imza" missed "İmza".
describe('the register search folds Turkish letters', () => {
  it('finds Rakı by "raki" and its İmza section by "imza"', () => {
    draw();
    const box = screen.getByRole('searchbox');
    fireEvent.change(box, { target: { value: 'raki' } });
    expect(screen.getByText('Rakı Sour')).toBeInTheDocument();
    expect(screen.queryByText('Negroni')).not.toBeInTheDocument();
    fireEvent.change(box, { target: { value: 'IMZA' } });
    expect(screen.getByText('Rakı Sour')).toBeInTheDocument();
    expect(screen.queryByText('Negroni')).not.toBeInTheDocument();
  });
});

// F-1329 (OD-113): a recipe line picks the stock row it takes from, and the
// list shows what a serve costs and the margin on its price.
describe('a recipe linked to stock', () => {
  const GIN = 'inv-gin';
  const linked = () => {
    mock.recipe = {
      cocktailId: 'c1',
      count: 2,
      writable: true,
      rows: [
        { id: 'l1', free_text: 'gin', quantity: 30, unit: 'ml', inventory_id: GIN, stockName: 'Tanqueray', cost: { state: 'costed', cost: 30 } },
        { id: 'l2', free_text: 'orange peel', quantity: null, unit: null, inventory_id: null, cost: { state: 'not_linked' } },
      ],
      stockRows: [
        { id: GIN, name: 'Tanqueray', kind: 'spirit', bottleMl: 700 },
        { id: 'inv-campari', name: 'Campari', kind: 'spirit', bottleMl: 700 },
      ],
      stockRowsUnread: null,
      costsUnread: null,
    };
  };

  it('shows each cocktail’s cost a serve and margin', () => {
    mock.price = 400;
    mock.serve = { costPerServe: 30, margin: 370, marginPct: 92.5, linked: 1, notLinked: 1, withheldReason: null };
    draw();
    expect(screen.getAllByTestId('cocktail-cost')[0]).toHaveTextContent('30');
    expect(screen.getAllByTestId('cocktail-margin')[0]).toHaveTextContent(/370.*92\.5%/);
  });

  it('says a cost is withheld when one is unknown, and not linked when nothing is', () => {
    mock.serve = { costPerServe: null, linked: 1, notLinked: 0, withheldReason: 'its stock row has no recorded cost' };
    draw();
    const cost = screen.getAllByTestId('cocktail-cost')[0];
    expect(cost).toHaveTextContent('withheld');
    expect(cost).toHaveAttribute('title', 'its stock row has no recorded cost');
    expect(screen.getAllByTestId('cocktail-cost')[1]).toHaveTextContent('—');
  });

  it('shows staff no cost columns, and says they are kept', () => {
    mock.withheld = true;
    draw();
    expect(screen.queryByTestId('cocktail-cost')).toBeNull();
    expect(screen.getByText(/kept for the owner and managers/)).toBeInTheDocument();
  });

  it('a line picks the stock row it takes from; the rest of the recipe is written as it stands', async () => {
    linked();
    mock.setRecipe.mockResolvedValue({ lines: 2 });
    draw();
    fireEvent.click(screen.getByText('Negroni'));
    const lines = screen.getAllByTestId('recipe-line');
    expect(lines[1]).toHaveTextContent(/Not linked — the till takes nothing off stock/);
    await act(async () => {
      fireEvent.change(screen.getAllByLabelText('Takes from')[1], { target: { value: 'inv-campari' } });
    });
    expect(mock.setRecipe).toHaveBeenCalledWith({
      id: 'c1',
      lines: [
        { freeText: 'gin', quantity: 30, unit: 'ml', sortOrder: 0, inventoryId: GIN },
        { freeText: 'orange peel', quantity: undefined, unit: undefined, sortOrder: 1, inventoryId: 'inv-campari' },
      ],
    });
    expect(screen.getByText(/“orange peel” now takes from Campari/)).toBeInTheDocument();
  });

  it('a retyped recipe keeps a line’s stock while its words stay the same', async () => {
    linked();
    mock.setRecipe.mockResolvedValue({ lines: 2 });
    draw();
    fireEvent.click(screen.getByText('Negroni'));
    fireEvent.click(screen.getByRole('button', { name: /Amend the recipe/ }));
    fireEvent.change(screen.getByLabelText('Recipe lines'), { target: { value: '40 ml Gin\n2 dashes bitters' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Record the recipe/ }));
    });
    const sent = mock.setRecipe.mock.calls[0][0].lines;
    expect(sent[0]).toMatchObject({ freeText: 'Gin', quantity: 40, inventoryId: GIN });
    expect(sent[1].inventoryId).toBeUndefined();
  });
});
