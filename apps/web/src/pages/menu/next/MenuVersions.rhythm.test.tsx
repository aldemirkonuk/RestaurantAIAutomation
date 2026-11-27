/**
 * /menu rhythm (r61, critic round 2, item 7): no void under the drop zone, the
 * page's explanation folded under "How this works", and "Read this menu" a live
 * 48 px primary once a file is held.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MenuVersions } from './MenuVersions';
import { listMenuVersions } from '../../../services/api/menus';

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRole: 'owner', user: { role: 'owner' } }),
}));
vi.mock('../../../services/api/menus', async () => {
  const actual = await vi.importActual<typeof import('../../../services/api/menus')>(
    '../../../services/api/menus',
  );
  return {
    ...actual,
    listMenuVersions: vi.fn(),
    makeMenuCurrent: vi.fn(),
    importMenu: vi.fn(),
    getMenuSourceUrl: vi.fn(),
    getMenuPlan: vi.fn(),
    reviewMenuItem: vi.fn(),
  };
});

const css = readFileSync(resolve(__dirname, '../../../components/mudavym/drop-zone.css'), 'utf8');

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MenuVersions canManage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(listMenuVersions).mockReset();
  vi.mocked(listMenuVersions).mockResolvedValue({ current: null, lastUsed: null, versions: [] });
});

describe('the explanation folds', () => {
  it('is closed until asked, and opens by the cue', async () => {
    mount();
    const cue = await screen.findByTestId('menu-how-cue');
    expect(cue.textContent).toContain('How this works');
    expect(cue.getAttribute('aria-expanded')).toBe('false');
    const body = document.getElementById('menu-how-this-works')!;
    expect(body.getAttribute('data-open')).toBe('false');
    expect(cue.getAttribute('aria-controls')).toBe('menu-how-this-works');
    fireEvent.click(cue);
    expect(cue.getAttribute('aria-expanded')).toBe('true');
    expect(body.getAttribute('data-open')).toBe('true');
    expect(body.textContent).toContain('Every menu this house reads is kept');
    expect(body.textContent).toContain('Several photos make one menu');
  });

  it('keeps no explanatory paragraph outside the fold above the zone', async () => {
    mount();
    await screen.findByTestId('menu-how-cue');
    const form = screen.getByTestId('menu-read-form');
    const outside = Array.from(document.querySelectorAll('p.cl-note')).filter(
      (p) => !p.closest('#menu-how-this-works') && !!(p.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING),
    );
    expect(outside).toHaveLength(0);
  });
});

describe('Read this menu', () => {
  it('is the full-width 48 px primary once a file is held, a quiet chip before', async () => {
    mount();
    const go = (await screen.findByRole('button', { name: 'Read this menu' })) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    expect(go.getAttribute('data-held')).toBe('false');
    fireEvent.change(screen.getByLabelText('Menu to read'), {
      target: { files: [new File(['a,b\n'], 'menu.csv', { type: 'text/csv' })] },
    });
    expect(go.getAttribute('data-held')).toBe('true');
    expect(go.disabled).toBe(false);
  });
});

describe('the stylesheet', () => {
  it('does not give the zone a 360 px height in the column form', () => {
    expect(css).toMatch(/\.mdv-dropwrap\s*\{[^}]*flex: 0 0 auto/);
    expect(css).not.toMatch(/\.mdv-dropwrap\s*\{[^}]*flex: 1 1 360px/);
  });

  it('makes the held button 48 px, full width, on the seal', () => {
    expect(css).toMatch(/\.cl-btn\.mdv-read__go\s*\{[^}]*width: 100%[^}]*height: 48px/);
    expect(css).toMatch(/\.mdv-read__go\[data-held='true'\]\s*\{[^}]*background: var\(--seal\)/);
  });

  it('folds by grid rows and animates only transform, opacity and grid-template-rows', () => {
    expect(css).toMatch(/\.mdv-fold__body\s*\{[^}]*grid-template-rows: 0fr/);
    expect(css).toMatch(/\.mdv-fold__body\[data-open='true'\]\s*\{[^}]*grid-template-rows: 1fr/);
    expect(css).not.toMatch(/transition:\s*all/);
    const mine = css.slice(css.indexOf('"How this works"'));
    for (const m of mine.match(/transition:[^;]+;/g) ?? [])
      expect(m).not.toMatch(/\b(width|height|top|left|margin|padding|background|border)/);
  });

  it('stops the fold, the chevron and the rise under reduced motion', () => {
    const reduced = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toMatch(/\.mdv-fold__chev[\s\S]*\.mdv-fold__body[\s\S]*transition: none/);
    expect(reduced).toMatch(/\[data-held='true'\]\s*\{\s*animation: none/);
  });
});
