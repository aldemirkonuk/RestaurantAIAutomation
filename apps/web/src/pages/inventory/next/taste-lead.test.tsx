/**
 * r97: the line a recipe's taste opens with names what the roll-up led with
 * (basis.lead), in a cook's words, with no confidence gate; a dish does not
 * draw an alcohol row and says what it does not know in one quiet line.
 * Fixtures are synthetic.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { parseTasteBody, type SubjectKind, type TasteAxis, type TasteData } from '../../../services/api/taste';

const api = vi.hoisted(() => ({ get: vi.fn(), add: vi.fn() }));
vi.mock('../../../services/api/taste', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getTaste: api.get,
  addHouseTaste: api.add,
}));

import TasteCard from './TasteCard';
import { leadLine, summaryFor } from './taste-words';

const ax = (v: number, over: Partial<TasteAxis> = {}): TasteAxis => ({
  v, lo: null, hi: null, conf: 0.3, prov: [{ kind: 'recipe', share: 1 }], bandOnly: false, ...over,
});
const data = (axes: Record<string, TasteAxis>, lead: string[] | null | undefined, notKnown: string[] = []): TasteData => ({
  effective: { axes, descriptors: [], texture: [], conflicts: [] },
  layers: [{
    source: 'recipe', version: 1, method: 'computed', statedByName: null, statedAt: null, hasNote: false, noteText: null,
    basis: lead === undefined ? undefined : { notKnown: notKnown as never, lineSources: [], unknownNames: [], lead },
  }],
});

// The three subjects the r95 walk read: priors-only, so every axis sits under 0.4 confidence.
const NEGRONI = data({ sweet: ax(5.1), bitter: ax(4.0), herbal: ax(6.8) }, ['sweet', 'bitter']);
const KOFTA = data({ fat: ax(8.5), umami: ax(6.5), salty: ax(4.2) }, ['fat', 'umami', 'salty']);
const CAESAR = data({ fat: ax(6.0), salty: ax(4.8), savoury: ax(4.4) }, ['fat', 'salty', 'savoury']);

describe('the lead names the loudest tastes', () => {
  it.each([
    ['Negroni', NEGRONI, 'Mainly sweet and bitter.'],
    ['Kofta', KOFTA, 'Mainly rich, savoury and salty.'],
    ['Caesar', CAESAR, 'Mainly rich, salty and savoury.'],
  ])('%s: the top line and the card header say the same sentence, with no confidence gate', (_n, d, said) => {
    expect(leadLine(d)!.sentence).toBe(said);
    expect(summaryFor(d)).toBe(said);
  });
  it('keeps the recipe mark when the lead has no axis of its own to take marks from', () => {
    expect(leadLine(data({}, ['sweet']))!.kinds).toEqual(['recipe']);
  });
  it('a stale layer (no lead) reads the axes as before, and an empty lead does too', () => {
    const axes = { sweet: ax(8, { conf: 0.9 }) };
    expect(leadLine(data(axes, undefined))!.sentence).toBe('Mainly sweet.');
    expect(leadLine(data({ sweet: ax(8, { conf: 0.2, bandOnly: true }) }, undefined))).toBeNull();
    expect(leadLine(data({ sweet: ax(3, { conf: 0.9 }) }, []))!.sentence).toBe('Gently sweet.');
  });
  it('an unknown key in the lead is dropped, never shown raw', () => {
    expect(leadLine(data({ sweet: ax(5) }, ['sweet', 'mystery_key']))!.sentence).toBe('Mainly sweet.');
  });
  it('the wire body carries lead through, and a body without it reads as no lead', () => {
    const wire = (basis: object) => ({ effective: null, layers: [{ source: 'recipe', basis }] });
    expect(parseTasteBody(wire({ notKnown: [], lineSources: [], unknownNames: [], lead: ['fat', 'umami'] }))!.layers[0].basis!.lead).toEqual(['fat', 'umami']);
    expect(parseTasteBody(wire({ notKnown: [], lineSources: [], unknownNames: [] }))!.layers[0].basis!.lead).toBeNull();
  });
});

function mount(d: TasteData, subject: SubjectKind) {
  api.get.mockResolvedValue({ state: 'ready', data: d });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TasteCard row={{ id: 'i1' }} restaurantId="r1" subject={subject} describe={false} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  cleanup();
  api.get.mockReset();
});

describe('the card header', () => {
  it('says the lead sentence for a cocktail with priors-only axes', async () => {
    mount(NEGRONI, 'cocktail');
    expect((await screen.findByTestId('taste-summary')).textContent).toBe('Mainly sweet and bitter.');
  });
});

describe('what a dish does not know', () => {
  const KNOWN = ['sweet', 'sour', 'bitter', 'alcohol'];
  it('draws no alcohol row and one quiet line for the rest', async () => {
    mount(data({ fat: ax(8.5) }, ['fat'], KNOWN), 'dish');
    const line = await screen.findByTestId('taste-notknown-line');
    expect(line.textContent).toBe('Not known yet: sweet, sour, bitter.');
    expect(screen.queryByTestId('taste-notknown-alcohol')).toBeNull();
    expect(screen.queryByTestId('taste-notknown-sweet')).toBeNull();
    expect(document.body.textContent).not.toMatch(/Alcohol warmth/);
  });
  it('a dish with only alcohol unknown says nothing about it', async () => {
    mount(data({ fat: ax(8.5) }, ['fat'], ['alcohol']), 'dish');
    await screen.findByTestId('taste-summary');
    expect(screen.queryByTestId('taste-notknown-line')).toBeNull();
    expect(screen.queryByTestId('taste-notknown-alcohol')).toBeNull();
  });
  it('a cocktail keeps one row each, alcohol included, and no collapsed line', async () => {
    mount(data({ bitter: ax(4) }, ['bitter'], KNOWN), 'cocktail');
    for (const k of ['sweet', 'sour', 'alcohol']) expect(await screen.findByTestId(`taste-notknown-${k}`)).toBeTruthy();
    expect(screen.getByTestId('taste-notknown-alcohol').textContent).toMatch(/Alcohol warmth/);
    expect(screen.queryByTestId('taste-notknown-line')).toBeNull();
  });
  it('a dish whose alcohol only reads none draws no alcohol row, and one that cooks with wine keeps it', async () => {
    mount(data({ fat: ax(6), alcohol: ax(0) }, ['fat']), 'dish');
    await screen.findByTestId('taste-summary');
    expect(document.body.textContent).not.toMatch(/Alcohol warmth/);
    cleanup();
    mount(data({ fat: ax(6), alcohol: ax(4) }, ['fat']), 'dish');
    await screen.findByTestId('taste-summary');
    expect(document.body.textContent).toMatch(/Alcohol warmth/);
  });
  it('a cocktail keeps an alcohol row that reads none', async () => {
    mount(data({ sweet: ax(5), alcohol: ax(0) }, ['sweet']), 'cocktail');
    await screen.findByTestId('taste-summary');
    expect(document.body.textContent).toMatch(/Alcohol warmth/);
  });
});
