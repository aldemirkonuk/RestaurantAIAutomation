/**
 * OneTapSheet — the owed act on `/`, proved.
 *
 * THE REGRESSION. Four of these fail against the pre-packet rail, and each one
 * names a thing the rebuilt page could not do that its legacy page could:
 *
 *   - `carries the mark over` — the legacy panel had an icon picker
 *     (`QuickActionsPanel.tsx:332`); the rebuilt rail sent no `icon` at all.
 *   - `changes an action already on the rail` — legacy could EDIT a custom
 *     action; the rebuilt rail had no edit path and never called `PUT`.
 *   - `takes one off the rail` — legacy could DELETE one; the rebuilt rail
 *     could only `cancel` it (a status change), never `DELETE`.
 *   - `refuses a place an action cannot go` — legacy validated the href
 *     (`data/quickActions.ts:206`); the rebuilt rail posted whatever was typed.
 *
 * Proved against a COPY of the pre-packet file, never by stashing a worktree
 * several sessions share: see the report's verification table.
 *
 * The rest of the file is the "done" list for one overlay: the shape, the
 * primitive's contract (focus in, Esc out, focus back), the four honest states,
 * the unbuilt triggers saying so, and the stub that survives Esc.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('@/services/api/client', () => ({
  apiClient: {
    get: (...args: unknown[]) => api.get(...args),
    post: (...args: unknown[]) => api.post(...args),
    put: (...args: unknown[]) => api.put(...args),
    delete: (...args: unknown[]) => api.delete(...args),
  },
  getErrorMessage: (e: unknown) => (e as { message?: string })?.message ?? 'unknown error',
}));

import OneTapPanel from './OneTapPanel';
import { isPlaceAnActionCanGo, draftHasWords, draftOf, EMPTY_DRAFT } from './OneTapSheet';

const mine = {
  id: 'p1',
  restaurantId: 'rest-A',
  userId: 'user-1',
  actionType: 'custom',
  title: 'Call the cellar about Thursday',
  description: 'Ask whether the Chablis landed.',
  actionUrl: '/inventory',
  priority: 'high',
  icon: 'Wine',
  status: 'pending' as const,
  createdAt: new Date().toISOString(),
};

function serve(rows: unknown[]) {
  api.get.mockResolvedValue({ data: { actions: rows } });
}

function draw() {
  return render(
    <MemoryRouter>
      <OneTapPanel restaurantId="rest-A" />
    </MemoryRouter>,
  );
}

async function openSheet() {
  await waitFor(() => expect(api.get).toHaveBeenCalled());
  fireEvent.click(screen.getByTestId('one-tap-open-sheet'));
  return screen.getByRole('dialog');
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  api.put.mockReset();
  api.delete.mockReset();
  api.post.mockResolvedValue({ data: {} });
  api.put.mockResolvedValue({ data: {} });
  api.delete.mockResolvedValue({ data: { success: true } });
});

describe('the shape and the primitive', () => {
  it('is a sheet on the shared primitive, named by its contract', async () => {
    serve([]);
    draw();
    const dialog = await openSheet();
    // The census gives this act a SHEET; the primitive stamps the shape.
    expect(dialog.closest('.mdv-ovl')).toHaveAttribute('data-shape', 'sheet');
    // The contract IS the accessible name (sketch 103, 1e): what it asks, what
    // it writes, what leaving costs.
    expect(dialog.getAttribute('aria-label')).toBeNull();
    expect(
      screen.getByRole('dialog', { name: /A one-tap action of your own/ }),
    ).toBeInTheDocument();
    // Motion is the house token, not a hand-rolled keyframe.
    expect(dialog).toHaveAttribute('data-motion', 'tuck');
  });

  it('closes with words, never a glyph', async () => {
    serve([]);
    draw();
    await openSheet();
    expect(screen.getByRole('button', { name: 'Leave it' })).toBeInTheDocument();
  });

  it('moves focus in on open, and Esc returns it to the opener', async () => {
    serve([]);
    draw();
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    const opener = screen.getByTestId('one-tap-open-sheet');
    // `fireEvent.click` does not move focus in jsdom the way a real pointer
    // does, and the primitive remembers `document.activeElement`. Focus it the
    // way a browser would before the click, or the assertion below tests jsdom.
    opener.focus();
    fireEvent.click(opener);
    await waitFor(() => expect(screen.getByTestId('one-tap-title')).toHaveFocus());
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(opener).toHaveFocus();
  });
});

describe('the act, against the real routes', () => {
  it('writes a new action, sending no restaurant and no author', async () => {
    serve([]);
    draw();
    await openSheet();
    fireEvent.change(screen.getByTestId('one-tap-title'), {
      target: { value: 'Chase the Chablis invoice' },
    });
    fireEvent.click(screen.getByTestId('one-tap-save'));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const [path, body] = api.post.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe('/one-tap-actions');
    expect(body.title).toBe('Chase the Chablis invoice');
    // Tenant and author come from the token, never from here.
    expect(body).not.toHaveProperty('restaurantId');
    expect(body).not.toHaveProperty('userId');
  });

  it('carries the mark over — the field the rebuilt rail had dropped', async () => {
    serve([]);
    draw();
    await openSheet();
    fireEvent.change(screen.getByTestId('one-tap-title'), { target: { value: 'Rack the Rioja' } });
    fireEvent.click(screen.getByRole('button', { name: 'A delivery' }));
    fireEvent.click(screen.getByTestId('one-tap-save'));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        '/one-tap-actions',
        expect.objectContaining({ icon: 'Truck' }),
      ),
    );
  });

  it('changes an action already on the rail — PUT, not a second POST', async () => {
    serve([mine]);
    draw();
    await waitFor(() => expect(screen.getByTestId('one-tap-edit')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('one-tap-edit'));
    const title = screen.getByTestId('one-tap-title') as HTMLInputElement;
    // It reads back what is on the rail, mark included.
    expect(title.value).toBe('Call the cellar about Thursday');
    expect(screen.getByRole('button', { name: 'A bottle' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.change(title, { target: { value: 'Call the cellar about Friday' } });
    fireEvent.click(screen.getByTestId('one-tap-save'));
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith(
        '/one-tap-actions/p1',
        expect.objectContaining({ title: 'Call the cellar about Friday' }),
      ),
    );
    expect(api.post).not.toHaveBeenCalled();
  });

  it('takes one off the rail — DELETE, which the rebuilt rail never called', async () => {
    serve([mine]);
    draw();
    await waitFor(() => expect(screen.getByTestId('one-tap-edit')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('one-tap-edit'));
    fireEvent.click(screen.getByTestId('one-tap-remove'));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/one-tap-actions/p1'));
  });

  it('offers no change control on an action the house raised', async () => {
    serve([{ ...mine, id: 'h1', userId: null }]);
    draw();
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(screen.queryByTestId('one-tap-edit')).toBeNull();
  });
});

describe('four states, honestly', () => {
  it('refuses a place an action cannot go, and writes nothing', async () => {
    serve([]);
    draw();
    await openSheet();
    fireEvent.change(screen.getByTestId('one-tap-title'), { target: { value: 'Somewhere' } });
    fireEvent.change(screen.getByTestId('one-tap-url'), { target: { value: 'inventory' } });
    expect(screen.getByTestId('one-tap-url-problem')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('one-tap-save'));
    expect(api.post).not.toHaveBeenCalled();
  });

  it('says what did not happen when the write is refused, and keeps the words', async () => {
    serve([]);
    api.post.mockRejectedValue(
      Object.assign(new Error('duplicate title'), { response: { status: 400 } }),
    );
    draw();
    await openSheet();
    fireEvent.change(screen.getByTestId('one-tap-title'), { target: { value: 'Rack the Rioja' } });
    fireEvent.click(screen.getByTestId('one-tap-save'));
    await waitFor(() =>
      expect(screen.getByTestId('one-tap-failure')).toHaveTextContent(/nothing was created/),
    );
    // The sheet is still open and still holds the words — a refusal never
    // empties the form on the way out.
    expect((screen.getByTestId('one-tap-title') as HTMLInputElement).value).toBe('Rack the Rioja');
  });

  it('names a refusal as a refusal when a change is denied', async () => {
    serve([mine]);
    api.put.mockRejectedValue(Object.assign(new Error('nope'), { response: { status: 403 } }));
    draw();
    await waitFor(() => expect(screen.getByTestId('one-tap-edit')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('one-tap-edit'));
    fireEvent.click(screen.getByTestId('one-tap-save'));
    await waitFor(() =>
      expect(screen.getByTestId('one-tap-failure')).toHaveTextContent(
        /may not change actions on this rail \(403\)\. The action is unchanged\./,
      ),
    );
  });

  it('never draws an unreadable rail as an empty one', async () => {
    api.get.mockRejectedValue(Object.assign(new Error('no route'), { response: { status: 500 } }));
    draw();
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('one-tap-open-sheet'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/this is not an empty rail/)).toBeInTheDocument();
  });
});

describe('what is not built says so', () => {
  it('shuts the two triggers that have no engine behind them', async () => {
    serve([]);
    draw();
    const dialog = await openSheet();
    expect(within(dialog).getByTestId('one-tap-trigger-tap')).toBeInTheDocument();
    for (const label of ['On a threshold', 'On a schedule']) {
      const chip = within(dialog).getByRole('button', { name: label });
      expect(chip).toBeDisabled();
    }
    expect(within(dialog).getByTestId('one-tap-trigger-note')).toHaveTextContent(/is not built/);
  });

  it('carries no colour theme — this house has one chromatic colour', async () => {
    serve([]);
    draw();
    const dialog = await openSheet();
    for (const gone of ['Emerald', 'Amber', 'Rose', 'Purple', 'Colour theme', 'Color Theme']) {
      expect(within(dialog).queryByText(gone)).toBeNull();
    }
  });
});

describe('the stub survives Esc (sketch 103, 1b)', () => {
  it('holds the words on the rail and finds them again', async () => {
    serve([]);
    draw();
    await openSheet();
    fireEvent.change(screen.getByTestId('one-tap-title'), {
      target: { value: 'Ask about the Narince' },
    });
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByTestId('one-tap-stub')).toHaveTextContent('Ask about the Narince');
    fireEvent.click(screen.getByTestId('one-tap-open-sheet'));
    expect((await screen.findByTestId('one-tap-title')) as HTMLInputElement).toHaveValue(
      'Ask about the Narince',
    );
  });
});

describe('both grounds, measured', () => {
  /**
   * The ground is a DOM FACT (ADR 0042 / ADR 0112): tokens live on `.mudavym`,
   * never `:root`, so a portalled overlay has no colours unless its own root
   * carries the class AND, on charcoal, `data-ground` on that same element.
   *
   * A screenshot is the ideal proof and was NOT taken this session (the local
   * worktree server lands on the sign-in wall and entering credentials is not
   * something this session may do). This asserts the mechanism instead: the
   * overlay resolves the ground from the opener's own ancestor, both ways.
   */
  it('wears the ground of the page that opened it — paper and charcoal', async () => {
    serve([]);
    const { unmount } = render(
      <MemoryRouter>
        <div className="mudavym">
          <OneTapPanel restaurantId="rest-A" />
        </div>
      </MemoryRouter>,
    );
    await openSheet();
    expect(screen.getByRole('dialog').closest('.mdv-ovl')).not.toHaveAttribute('data-ground');
    unmount();

    render(
      <MemoryRouter>
        <div className="mudavym" data-ground="charcoal">
          <OneTapPanel restaurantId="rest-A" />
        </div>
      </MemoryRouter>,
    );
    await openSheet();
    expect(screen.getByRole('dialog').closest('.mdv-ovl')).toHaveAttribute(
      'data-ground',
      'charcoal',
    );
  });
});

describe('the pure parts', () => {
  it('keeps the legacy href rule, all four cases', () => {
    expect(isPlaceAnActionCanGo('/inventory')).toBe(true);
    expect(isPlaceAnActionCanGo('https://example.com')).toBe(true);
    expect(isPlaceAnActionCanGo('http://example.com')).toBe(true);
    expect(isPlaceAnActionCanGo('inventory')).toBe(false);
  });

  it('reads an action back as its own draft', () => {
    expect(draftOf(mine)).toEqual({
      title: 'Call the cellar about Thursday',
      description: 'Ask whether the Chablis landed.',
      actionUrl: '/inventory',
      priority: 'high',
      mark: 'Wine',
    });
    expect(draftHasWords(EMPTY_DRAFT)).toBe(false);
    expect(draftHasWords({ ...EMPTY_DRAFT, title: ' ' })).toBe(false);
    expect(draftHasWords({ ...EMPTY_DRAFT, title: 'x' })).toBe(true);
  });
});
