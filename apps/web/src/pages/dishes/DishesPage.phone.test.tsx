/**
 * /dishes on a phone (r34 walk w1 F11): an opened dish's sheet is never wider
 * than the screen.
 *
 * jsdom draws no layout, so the two halves are pinned separately:
 *  - the page puts the open sheet in the one cell that spans every column,
 *    inside the scroll box that carries `dishes-scroll`;
 *  - `dishes-page.css` makes that box a size container and each child of
 *    that cell exactly as wide as the box, stuck to its left edge.
 * The walker's check (every control's right edge <= 375 at 375 px) is the
 * browser half; it is listed in the PR body.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const RID = '11111111-1111-4111-8111-111111111111';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const h = vi.hoisted(() => ({ get: vi.fn(), auth: {} as Record<string, unknown> }));
vi.mock('../../services/api/client', () => ({
  apiClient: { get: h.get, post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  getErrorStatus: () => null,
}));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => h.auth }));

import DishesPage from './DishesPage';

const full = { perServe: 300, perServeExact: 300, priced: 2, of: 2, complete: true, partial: 0 };

beforeEach(() => {
  h.get.mockReset();
  h.auth = { activeRestaurantId: RID, activeRole: 'manager', user: { userId: 'u1', role: 'manager' } };
  h.get.mockImplementation(async (url: string) => {
    if (url === '/settings/currency') return { data: { restaurantId: RID, code: 'TRY', country: 'Turkey', readable: true, reason: null, statedAt: null } };
    if (url === `/recipes/${RID}/dishes`) {
      return { data: [{ id: A, name: 'Lamb shank', section: 'Mains', price: 900, hasRecipe: true, yieldServes: 1, lineCount: 2, cost: full }] };
    }
    if (url.endsWith(`/dishes/${A}`)) {
      return { data: { dish: { id: A, name: 'Lamb shank', section: null, price: null, description: null }, current: null, cost: null, versionCount: 0, legacyLines: [] } };
    }
    return { data: null };
  });
});

function mount(at: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[at]}>
        <DishesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('/dishes: the open sheet is drawn where the phone rule reaches it', () => {
  it('the scroll box carries dishes-scroll, and the sheet is a child of the one cell spanning every column', async () => {
    mount(`/dishes?open=${A}`);
    const leaf = await screen.findByTestId(`dish-leaf-${A}`);
    const box = screen.getByTestId('dishes-scroll');
    expect(box).toHaveClass('dishes-scroll');
    expect(box.style.overflowX).toBe('auto');
    expect(box.contains(leaf)).toBe(true);
    const cell = leaf.querySelector(':scope > td');
    expect(cell).not.toBeNull();
    const headers = box.querySelectorAll('thead th').length;
    expect(cell!.getAttribute('colspan')).toBe(String(headers));
    // Every part of the sheet is a DIRECT child of that cell, which is what
    // the rule `.dishes-scroll td[colspan] > *` reaches.
    expect(cell!.children.length).toBeGreaterThan(0);
    // No other cell in the table spans columns, so the rule reaches nothing else.
    expect(box.querySelectorAll('td[colspan]')).toHaveLength(1);
  });
});

describe('dishes-page.css: the sheet is as wide as the box and stays in view', () => {
  const css = readFileSync(join(__dirname, 'dishes-page.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = (selector: string) => {
    const at = css.indexOf(`${selector} {`);
    expect(at, `no rule for ${selector}`).toBeGreaterThanOrEqual(0);
    const body = css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
    return Object.fromEntries(
      body
        .split(';')
        .map((d) => d.trim())
        .filter(Boolean)
        .map((d) => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim()]),
    );
  };

  it('the scroll box is a size container, so 100cqw is its width', () => {
    expect(rule('.dishes-scroll')).toMatchObject({ 'container-type': 'inline-size' });
  });

  it('each child of the spanning cell is the box wide, less the cell padding, and sticks at the left', () => {
    const r = rule('.dishes-scroll td[colspan] > *');
    expect(r).toMatchObject({
      position: 'sticky',
      left: '10px',
      'box-sizing': 'border-box',
      width: 'calc(100cqw - 20px)',
      'max-width': 'calc(100cqw - 20px)',
    });
  });

  it('the page imports the rule', () => {
    const page = readFileSync(join(__dirname, 'DishesPage.tsx'), 'utf8');
    expect(page).toMatch(/^import '\.\/dishes-page\.css';$/m);
  });
});
