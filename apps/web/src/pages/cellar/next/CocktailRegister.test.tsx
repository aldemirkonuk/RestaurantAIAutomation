/**
 * The cocktail list's failure sentences (F-338).
 *
 * Only a definite refusal may say "nothing was written". A timeout or a server
 * fault can land after the cocktail, its recipe, or its retirement did — and
 * telling the owner nothing happened invites a second press that writes twice.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { AxiosError } from 'axios';

const mock = vi.hoisted(() => ({
  create: vi.fn(),
  amend: vi.fn(),
  retire: vi.fn(),
  setRecipe: vi.fn(),
  price: null as number | null,
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
      }],
      count: 1, truncated: false, referenceRows: null, recipesAvailable: false,
      scopeNote: 'Only cocktails this restaurant owns.',
    },
  }),
  useCocktailRecipe: () => ({
    data: { cocktailId: 'c1', rows: [], count: 0, writable: true },
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
