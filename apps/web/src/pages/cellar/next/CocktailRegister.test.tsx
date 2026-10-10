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
}));

vi.mock('./useCellarNextData', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useCocktailRegister: () => ({
    loading: false,
    error: null,
    data: {
      rows: [{
        id: 'c1', name: 'Negroni', display_name: null, menu_section: null,
        method: null, glass: null, garnish: null, price: null, description: null,
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
  for (const f of Object.values(mock)) f.mockReset();
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
