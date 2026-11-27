/**
 * A drink's photo on its sheet and its recipe card (r110 drinks-g3): the 4/3 frame is held before the image
 * loads, the fade is 150 ms on the house curve with none under reduced motion and no exit, staff see it with no
 * controls, an owner or manager adds it re-encoded to WebP at most 1600 px, and paper waits for it.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactNode } from 'react';
import type { CocktailRecipe } from '../../../../services/api/recipes';

const RID = '11111111-1111-4111-8111-111111111111';
const CID = '22222222-2222-4222-8222-222222222222';
const PHOTO = `https://signed/${RID}/${CID}/a.webp?t=600`;

const h = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), del: vi.fn(), auth: {} as Record<string, unknown>, photo: null as string | null }));
vi.mock('../../../../services/api/client', () => ({ apiClient: { get: h.get, put: h.put, post: vi.fn(), delete: h.del }, getErrorStatus: () => null }));
vi.mock('../../../../contexts/AuthContext', () => ({ useAuth: () => h.auth }));
vi.mock('../../../../services/api/taste', async (orig) => ({ ...(await orig<Record<string, unknown>>()), getTaste: vi.fn().mockResolvedValue({ state: 'absent' }), rollupTaste: vi.fn() }));

import RecipeSheet from './RecipeSheet';
import { forgetDrafts } from './drafts';

const negroni = (): CocktailRecipe => ({
  cocktail: { id: CID, name: 'Negroni', price: 12, glass: 'Rocks', garnish: null, method: null, description: null, photoUrl: h.photo },
  current: {
    versionId: '44444444-4444-4444-8444-444444444444', version: 1, yieldServes: 1, method: null, glass: 'Rocks', garnish: null,
    createdAt: '2026-11-07T10:00:00Z',
    lines: [{ id: 'l', position: 0, role: 'untracked', inventoryId: null, label: 'Gin', itemName: null, itemKind: null, qtyEntered: 30, unitCode: 'ml', qtyBase: 300, baseUnit: 'ml10', status: 'untracked', costPerServe: null, costBasis: null }],
  },
  cost: null,
  whatIsIn: { readable: false, sentence: 'not read' },
  versionCount: 1,
  legacyLines: [],
});

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrap = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return render(<RecipeSheet cocktailId={CID} />, { wrapper: wrap });
}

const css = () => readFileSync(join(__dirname, '../cellar-next.css'), 'utf8').replace(/\s+/g, ' ');

beforeEach(() => {
  h.photo = PHOTO;
  h.get.mockReset().mockImplementation(async (url: string) => {
    if (url === '/settings/currency') return { data: { restaurantId: RID, code: 'GBP', country: 'GB', readable: true, reason: null, statedAt: null } };
    if (url === `/recipes/${RID}/cocktails/${CID}`) return { data: negroni() };
    if (url === `/recipes/${RID}/shelf`) return { data: [] };
    throw new Error(`unexpected GET ${url}`);
  });
  h.put.mockReset();
  h.del.mockReset();
  h.auth = { activeRestaurantId: RID, activeRole: 'manager', user: { userId: 'u1', role: 'manager' } };
  forgetDrafts();
  window.print = vi.fn();
  window.localStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

describe('a drink photo on the sheet (r110 drinks-g3)', () => {
  it('holds the 4/3 frame before the image loads, and shows it only once decoded', async () => {
    mount();
    const frame = await screen.findByTestId('recipe-photo-frame');
    const img = frame.querySelector('img')!;
    expect(frame.className).toBe('cl-photo');
    expect(img.getAttribute('src')).toBe(PHOTO);
    expect(img.getAttribute('decoding')).toBe('async');
    expect(img.dataset.loaded).toBe('false');
    expect(css()).toContain('.cl-photo { aspect-ratio: 4 / 3; width: 100%;');
    expect(css()).toContain('.cl-photo img { display: block; width: 100%; height: 100%; object-fit: cover; opacity: 0; }');
    fireEvent.load(img);
    expect(img.dataset.loaded).toBe('true');
    expect(screen.getByTestId('recipe-photo-frame')).toBe(frame);
  });

  it('fades in over 150 ms on the house curve, has no fade under reduced motion, and nothing animates out', () => {
    const c = css();
    expect(c).toContain(".cl-photo img[data-loaded='true'] { opacity: 1; transition: opacity 150ms cubic-bezier(0.16, 1, 0.3, 1); }");
    expect(c).toContain("@media (prefers-reduced-motion: reduce) { .cl-photo img[data-loaded='true'] { transition: none; } }");
    // The only transition is on the loaded image: an image taken away goes at once.
    expect(c.match(/\.cl-photo[^{]*\{[^}]*transition: (?!none)/g)).toEqual([".cl-photo img[data-loaded='true'] { opacity: 1; transition: "]);
  });

  it('staff see the photo with no controls, and no frame when there is none', async () => {
    h.auth = { activeRestaurantId: RID, activeRole: 'staff', user: { userId: 'u2', role: 'staff' } };
    const first = mount();
    await screen.findByTestId('recipe-photo-frame');
    expect(screen.queryByTestId('photo-controls')).toBeNull();
    first.unmount();
    h.photo = null;
    mount();
    await screen.findByTestId('recipe-print');
    expect(screen.queryByTestId('recipe-photo')).toBeNull();
  });

  it('a manager adds a photo re-encoded to WebP at most 1600 px, and can remove it', async () => {
    h.photo = null;
    const drawn: number[][] = [];
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 4032, height: 3024, close: () => undefined })));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
      return { drawImage: (_b: unknown, _x: number, _y: number, w: number, hh: number) => drawn.push([w, hh]) } as never;
    });
    const types: string[] = [];
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb: BlobCallback, type?: string) => {
      types.push(String(type));
      cb(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' }));
    });
    h.put.mockImplementation(async () => ((h.photo = PHOTO), { data: { photoUrl: PHOTO } }));
    mount();
    fireEvent.click(await screen.findByTestId('photo-add'));
    const file = new File([new Uint8Array(10)], 'negroni.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByTestId('photo-input'), { target: { files: [file] } });
    await waitFor(() => expect(h.put).toHaveBeenCalledTimes(1));
    expect(h.put).toHaveBeenCalledWith(`/recipes/${RID}/cocktails/${CID}/photo`, { imageBase64: 'AQID' });
    expect(drawn).toEqual([[1600, 1200]]);
    expect(types).toEqual(['image/webp']);
    await waitFor(() => expect(screen.getByTestId('photo-remove')).toBeTruthy());
    h.del.mockResolvedValue({ data: { photoUrl: null } });
    fireEvent.click(screen.getByTestId('photo-remove'));
    await waitFor(() => expect(h.del).toHaveBeenCalledWith(`/recipes/${RID}/cocktails/${CID}/photo`));
  });

  it('the card prints the photo at 60 mm and paper waits until it is decoded', async () => {
    let decoded: () => void = () => undefined;
    Object.defineProperty(HTMLImageElement.prototype, 'decode', { configurable: true, writable: true, value: () => Promise.resolve() });
    vi.spyOn(HTMLImageElement.prototype, 'decode').mockImplementation(() => new Promise<void>((res) => (decoded = res)));
    mount();
    await screen.findByTestId('recipe-card-photo');
    fireEvent.click(screen.getByTestId('recipe-print-button'));
    expect(window.print).not.toHaveBeenCalled();
    decoded();
    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1));
    expect(css()).toContain('.cl-print-card .cl-photo, .cl-print-book .cl-photo { width: 60mm; max-width: 60mm;');
  });
});
