/**
 * The four location dialogs, both branches.
 *
 * The gate's promise (ADR 0112 / ADR 0042) is that with no Mudavym page on
 * screen these render byte for byte as `origin/main` has them. "Looks the same"
 * is not a test — a class string that drifted by one utility would pass it — so
 * these assertions pin the LITERAL class strings, and one test reads
 * `git show origin/main:<path>` and fails (never skips) if a pinned string is
 * no longer in the committed legacy source. A skip there would be an absence
 * reported as health, which is the fault this repo measures most (ADR 0020).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AddLocationDialog } from './AddLocationDialog';
import { CreateChainDialog } from './CreateChainDialog';
import { AssignToChainDialog } from './AssignToChainDialog';
import { EditLocationChainDialog } from './EditLocationChainDialog';
import { claimMudavymShell, resetMudavymShell } from '../../lib/mudavym/shellGround';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const post = vi.fn();
const patch = vi.fn();
const get = vi.fn();
vi.mock('../../services/api/client', () => ({
  apiClient: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    patch: (...a: unknown[]) => patch(...a),
  },
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { restaurantId: 'r1' } }),
}));
vi.mock('../../hooks/queries', () => ({ useProviders: () => ({ data: [] }) }));
vi.mock('../providers/BranchProviderTransferModal', () => ({
  BranchProviderTransferModal: () => null,
}));

/* ── the legacy class strings, transcribed from origin/main ─────────────── */
const LEGACY = {
  AddLocationDialog:
    'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-white rounded-2xl shadow-xl p-6 w-full max-w-md max-h-[min(90vh,calc(100vh-5rem))] overflow-y-auto',
  CreateChainDialog:
    'fixed left-1/2 top-1/2 z-50 bg-white rounded-2xl shadow-lg w-full max-w-sm border border-gray-100 flex flex-col max-h-[min(90vh,520px)]',
  AssignToChainDialog:
    'fixed left-1/2 top-1/2 z-50 bg-white rounded-2xl shadow-lg w-full max-w-sm border border-gray-100 flex flex-col max-h-[min(90vh,480px)]',
  EditLocationChainDialog:
    'fixed left-1/2 top-1/2 z-50 bg-white rounded-2xl shadow-lg w-full max-w-sm border border-gray-100 flex flex-col max-h-[min(90vh,560px)]',
} as const;

const BRANCH = {
  id: 'b1',
  name: 'Uptown',
  city: 'Chicago',
  chain_id: null,
  chain_name: null,
} as never;

const STANDALONE = [
  { id: 'l1', name: 'Uptown', city: 'Chicago' },
  { id: 'l2', name: 'Loop', city: null },
];

beforeEach(() => {
  resetMudavymShell();
  get.mockResolvedValue({ data: [] });
  post.mockResolvedValue({ data: { id: 'c1', name: 'The Grill Co.' } });
  patch.mockResolvedValue({ data: {} });
});
afterEach(() => {
  vi.clearAllMocks();
});

/* The rendered legacy surface, whichever portal it landed in. */
function legacyCard(cls: string): HTMLElement | null {
  return document.querySelector(`[class="${cls}"]`);
}

describe('the pinned strings are the ones origin/main actually ships', () => {
  it.each(Object.entries(LEGACY))('%s', (file, cls) => {
    const src = execFileSync(
      'git',
      ['show', `origin/main:apps/web/src/components/locations/${file}.tsx`],
      { encoding: 'utf8', cwd: process.cwd() },
    );
    expect(src).toContain(cls);
  });
});

describe('with no Mudavym page on screen — the legacy dialog, class string for class string', () => {
  it('AddLocationDialog', () => {
    render(<AddLocationDialog open onClose={() => {}} />);
    expect(legacyCard(LEGACY.AddLocationDialog)).not.toBeNull();
    expect(document.querySelector('.mdv-ovl')).toBeNull();
  });

  it('CreateChainDialog', () => {
    render(
      <CreateChainDialog open onClose={() => {}} onCreated={() => {}} standaloneLocations={STANDALONE} />,
    );
    expect(legacyCard(LEGACY.CreateChainDialog)).not.toBeNull();
    expect(document.querySelector('.mdv-ovl')).toBeNull();
  });

  it('AssignToChainDialog', () => {
    render(
      <AssignToChainDialog
        open
        onClose={() => {}}
        onSaved={() => {}}
        onCreateNew={() => {}}
        chainId="c1"
        chainName="The Grill Co."
        standaloneLocations={STANDALONE}
      />,
    );
    expect(legacyCard(LEGACY.AssignToChainDialog)).not.toBeNull();
    expect(document.querySelector('.mdv-ovl')).toBeNull();
  });

  it('EditLocationChainDialog', () => {
    render(
      <EditLocationChainDialog open branch={BRANCH} chains={[]} onClose={() => {}} onSaved={() => {}} />,
    );
    expect(legacyCard(LEGACY.EditLocationChainDialog)).not.toBeNull();
    expect(document.querySelector('.mdv-ovl')).toBeNull();
  });
});

describe('with a Mudavym page on screen — the house shape', () => {
  beforeEach(() => {
    claimMudavymShell(Symbol('locations-page'), 'paper');
  });

  it('AddLocationDialog is a Sheet — it authors one object', () => {
    render(<AddLocationDialog open onClose={() => {}} />);
    expect(document.querySelector('.mdv-ovl--sheet')).not.toBeNull();
    expect(legacyCard(LEGACY.AddLocationDialog)).toBeNull();
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
  });

  it('CreateChainDialog is a Sheet — it authors one object', () => {
    render(
      <CreateChainDialog open onClose={() => {}} onCreated={() => {}} standaloneLocations={STANDALONE} />,
    );
    expect(document.querySelector('.mdv-ovl--sheet')).not.toBeNull();
    expect(legacyCard(LEGACY.CreateChainDialog)).toBeNull();
  });

  it('AssignToChainDialog is a Panel — it asks one question and has no anchor', () => {
    render(
      <AssignToChainDialog
        open
        onClose={() => {}}
        onSaved={() => {}}
        onCreateNew={() => {}}
        chainId="c1"
        chainName="The Grill Co."
        standaloneLocations={STANDALONE}
      />,
    );
    expect(document.querySelector('.mdv-ovl--panel')).not.toBeNull();
    expect(document.querySelector('.mdv-ovl--popover')).toBeNull();
  });

  it('EditLocationChainDialog is a Sheet — it edits one object', () => {
    render(
      <EditLocationChainDialog open branch={BRANCH} chains={[]} onClose={() => {}} onSaved={() => {}} />,
    );
    expect(document.querySelector('.mdv-ovl--sheet')).not.toBeNull();
  });

  it('closes with a word, not a glyph', () => {
    const onClose = vi.fn();
    render(
      <EditLocationChainDialog open branch={BRANCH} chains={[]} onClose={onClose} onSaved={() => {}} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('Esc closes', () => {
    const onClose = vi.fn();
    render(
      <CreateChainDialog open onClose={onClose} onCreated={() => {}} standaloneLocations={[]} />,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('focus lands on the form field, not the Close control, and returns to the opener', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();

    const { rerender } = render(
      <EditLocationChainDialog open branch={BRANCH} chains={[]} onClose={() => {}} onSaved={() => {}} />,
    );
    expect(document.activeElement).toBe(screen.getByLabelText('Name'));

    rerender(
      <EditLocationChainDialog
        open={false}
        branch={BRANCH}
        chains={[]}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('carries a charcoal page ground through the portal', () => {
    resetMudavymShell();
    claimMudavymShell(Symbol('charcoal'), 'charcoal');
    render(
      <CreateChainDialog open onClose={() => {}} onCreated={() => {}} standaloneLocations={[]} />,
    );
    expect(document.querySelector('.mdv-ovl')).toHaveAttribute('data-ground', 'charcoal');
  });

  it('a chain is picked as a radio group — one true at a time, not independent toggles', () => {
    render(
      <EditLocationChainDialog
        open
        branch={BRANCH}
        chains={[{ id: 'c1', name: 'The Grill Co.', locationCount: 2 }]}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(2);
    expect(radios[0]).toHaveAttribute('aria-checked', 'true'); // Standalone
    fireEvent.click(radios[1]);
    expect(radios[1]).toHaveAttribute('aria-checked', 'true');
    expect(radios[0]).toHaveAttribute('aria-checked', 'false');
  });

  it('says the failure in words, on the surface that caused it', async () => {
    post.mockRejectedValueOnce(new Error('chain name already taken'));
    render(
      <CreateChainDialog open onClose={() => {}} onCreated={() => {}} standaloneLocations={[]} />,
    );
    fireEvent.change(screen.getByLabelText('Chain name'), { target: { value: 'Dup' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create chain' }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('chain name already taken');
    });
  });

  it('AssignToChainDialog commits the picked locations and says how many', async () => {
    const onSaved = vi.fn();
    render(
      <AssignToChainDialog
        open
        onClose={() => {}}
        onSaved={onSaved}
        onCreateNew={() => {}}
        chainId="c1"
        chainName="The Grill Co."
        standaloneLocations={STANDALONE}
      />,
    );
    expect(screen.getByText('None selected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Uptown/ }));
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add to chain' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(patch).toHaveBeenCalledWith('/organizations/locations/l1', { chainId: 'c1' });
  });
});

/**
 * None of the four deletes anything — measured, not assumed. Clearing a chain
 * writes `chainId: null` on the location row; the location and the chain both
 * survive. That is why no hold-to-approve seal appears in any of them: the seal
 * marks an irreversible act, and a PATCH you can undo by re-picking is not one.
 */
describe('the seal, and why none of the four wears it', () => {
  beforeEach(() => {
    claimMudavymShell(Symbol('locations-page'), 'paper');
  });

  it('removing a location from its chain is a PATCH to null, not a delete', async () => {
    const onSaved = vi.fn();
    render(
      <EditLocationChainDialog
        open
        branch={{ ...(BRANCH as object), chain_id: 'c1', chain_name: 'The Grill Co.' } as never}
        chains={[{ id: 'c1', name: 'The Grill Co.' }]}
        onClose={() => {}}
        onSaved={onSaved}
      />,
    );
    fireEvent.click(screen.getAllByRole('radio')[0]); // Standalone
    expect(screen.getByText(/This will remove/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(patch).toHaveBeenCalledWith(
      '/organizations/locations/b1',
      expect.objectContaining({ chainId: null }),
    );
  });

  it('no dialog of the four issues a DELETE', () => {
    for (const file of Object.keys(LEGACY)) {
      const src = readFileSync(
        resolve(process.cwd(), 'src/components/locations', `${file}.tsx`),
        'utf8',
      );
      expect(src).not.toMatch(/apiClient\.delete|method:\s*'DELETE'/);
    }
  });
});
