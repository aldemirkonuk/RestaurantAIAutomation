/**
 * The taste client: what a 200 parses to, and which failures are "not switched
 * on" (absent) and which are "could not be read" (failed). K8 of the design's
 * kill pass: Nest's own 404 for a missing route carries a JSON message, so a
 * 404 is absent unless the body says `code: 'subject_not_in_house'`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addHouseTaste, AXIS_KEYS, getTaste, parseTasteBody, rollupTaste, ROLLUP_ABSENT, ROLLUP_FAILED, ROLLUP_RECIPES_UNAVAILABLE, ROLLUP_UNREACHABLE, ROLLUP_UNREADABLE } from './taste';
import { apiClient } from './client';

vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client');
  return { ...actual, apiClient: { get: vi.fn(), post: vi.fn() } };
});
const http = vi.mocked(apiClient) as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
beforeEach(() => {
  http.get.mockReset();
  http.post.mockReset();
});

const refused = (status: number, data?: unknown) => Object.assign(new Error(`status ${status}`), { response: { status, data } });
const R = 'r1';

const axis = (over: Record<string, unknown> = {}) => ({ v: 5, lo: 4, hi: 6, conf: 0.6, prov: [{ kind: 'staff_note', share: 1 }], ...over });
const body = (axes: Record<string, unknown> = { salty: axis() }, extra: Record<string, unknown> = {}) => ({
  subject: { kind: 'good', id: 'i1' },
  effective: { axes, descriptors: ['savoury'], texture: [], summary: 'x', confidence: 0.6, conflicts: [], ...extra },
  layers: [{ source: 'house', version: 1, method: 'ordinal', statedByName: 'Ayşe', statedAt: '2026-11-19T10:00:00Z', hasNote: false, noteText: null }],
});

describe('getTaste reads a 200', () => {
  it('parses axes, layers and the route it asked', async () => {
    http.get.mockResolvedValue({ data: body() });
    const r = await getTaste('good', 'i1', R);
    expect(http.get).toHaveBeenCalledWith('/taste/r1/good/i1');
    expect(r.state).toBe('ready');
    if (r.state !== 'ready') return;
    expect(r.data.effective?.axes.salty).toMatchObject({ v: 5, lo: 4, hi: 6, conf: 0.6, bandOnly: false });
    expect(r.data.layers[0].statedByName).toBe('Ayşe');
  });

  it('an effective of null is a ready profile nobody has described', async () => {
    http.get.mockResolvedValue({ data: { subject: {}, effective: null, layers: [] } });
    expect(await getTaste('good', 'i1', R)).toEqual({ state: 'ready', data: { effective: null, layers: [] } });
  });

  it('drops a value outside 0..10 and an unknown axis key, keeps the rest', async () => {
    http.get.mockResolvedValue({ data: body({ salty: axis({ v: 11 }), sweet: axis({ v: -1 }), spicy_level: axis(), sour: axis({ v: 3 }) }) });
    const r = await getTaste('good', 'i1', R);
    if (r.state !== 'ready') throw new Error('not ready');
    expect(Object.keys(r.data.effective?.axes ?? {})).toEqual(['sour']);
  });

  it('drops an axis with no confidence or no source, and a range that is upside down is not drawn', async () => {
    http.get.mockResolvedValue({ data: body({ salty: axis({ conf: undefined }), sour: axis({ prov: [] }), bitter: axis({ lo: 7, hi: 2 }) }) });
    const r = await getTaste('good', 'i1', R);
    if (r.state !== 'ready') throw new Error('not ready');
    expect(Object.keys(r.data.effective?.axes ?? {})).toEqual(['bitter']);
    expect(r.data.effective?.axes.bitter).toMatchObject({ lo: null, hi: null });
  });

  it('flags conf below 0.4 as band-only, 0.4 itself is not', async () => {
    http.get.mockResolvedValue({ data: body({ salty: axis({ conf: 0.39 }), sour: axis({ conf: 0.4 }) }) });
    const r = await getTaste('good', 'i1', R);
    if (r.state !== 'ready') throw new Error('not ready');
    expect(r.data.effective?.axes.salty?.bandOnly).toBe(true);
    expect(r.data.effective?.axes.sour?.bandOnly).toBe(false);
  });

  it('an unparseable 200 is failed, not empty', async () => {
    for (const data of ['<html>', null, {}, { effective: null }, { layers: [] }, { effective: 'x', layers: [] }]) {
      http.get.mockResolvedValue({ data });
      expect((await getTaste('good', 'i1', R)).state).toBe('failed');
    }
  });
});

describe('getTaste tells "not switched on" from "could not be read"', () => {
  it('Nest\'s plain 404 for an unregistered route (it has a message) is absent', async () => {
    http.get.mockRejectedValue(refused(404, { statusCode: 404, message: 'Cannot GET /taste/r1/good/i1', error: 'Not Found' }));
    expect((await getTaste('good', 'i1', R)).state).toBe('absent');
  });
  it('a 404 with no body is absent', async () => {
    http.get.mockRejectedValue(refused(404));
    expect((await getTaste('good', 'i1', R)).state).toBe('absent');
  });
  it('a 404 that says the subject is not in this house is failed', async () => {
    http.get.mockRejectedValue(refused(404, { code: 'subject_not_in_house', message: 'That good is not in this house.' }));
    expect((await getTaste('good', 'i1', R)).state).toBe('failed');
  });
  it('405 and 501 are absent', async () => {
    for (const s of [405, 501]) {
      http.get.mockRejectedValue(refused(s));
      expect((await getTaste('good', 'i1', R)).state).toBe('absent');
    }
  });
  it('500, 502, 400, 401, 403 are failed', async () => {
    for (const s of [500, 502, 400, 401, 403]) {
      http.get.mockRejectedValue(refused(s, { message: 'x' }));
      expect((await getTaste('good', 'i1', R)).state).toBe('failed');
    }
  });
  it('a thrown network error is failed and nothing throws', async () => {
    http.get.mockRejectedValue(new Error('Network Error'));
    await expect(getTaste('good', 'i1', R)).resolves.toMatchObject({ state: 'failed' });
  });
  it('failed never carries a server or axios sentence', async () => {
    http.get.mockRejectedValue(refused(500, { message: 'relation "taste_profile" does not exist' }));
    const r = await getTaste('good', 'i1', R);
    expect(r).toEqual({ state: 'failed', reason: 'Taste could not be read just now.' });
  });
});

describe('getTaste: unreachable and the roll-up basis', () => {
  it('a dropped connection (no response) is failed with the unreachable words', async () => {
    http.get.mockRejectedValue(Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' }));
    expect(await getTaste('cocktail', 'c1', R)).toEqual({ state: 'failed', reason: 'Mudavym could not be reached just now.' });
  });
  it('a network-worded error that did get an answer keeps the card\u2019s own sentence', async () => {
    http.get.mockRejectedValue(Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK', response: { status: 502, data: {} } }));
    expect(await getTaste('cocktail', 'c1', R)).toEqual({ state: 'failed', reason: 'Taste could not be read just now.' });
  });
  it('a recipe layer carries its basis; axes and sources it cannot read are dropped, a layer without one has null', async () => {
    const b = body();
    b.layers.push({
      source: 'recipe', version: 1, method: 'computed', statedByName: null, statedAt: '2026-11-19T10:00:00Z', hasNote: false, noteText: null,
      basis: { notKnown: ['sour', 'nonsense', 4], lineSources: [{ name: 'Gin', from: 'good' }, { name: 'Lime', from: 'class_prior' }, { name: 'Tomato', from: 'class_prior_estimate' }, { name: 'Foo', from: 'unknown' }, { name: 'Bad', from: 'wat' }, { name: '', from: 'good' }], unknownNames: ['Foo', 7], unquantified: 2 },
    } as never);
    const r = await (async () => { http.get.mockResolvedValue({ data: b }); return getTaste('cocktail', 'c1', R); })();
    if (r.state !== 'ready') throw new Error('not ready');
    expect(r.data.layers[0].basis).toBeNull();
    expect(r.data.layers[1].basis).toEqual({
      notKnown: ['sour'],
      lineSources: [{ name: 'Gin', from: 'good' }, { name: 'Lime', from: 'class_prior' }, { name: 'Tomato', from: 'class_prior_estimate' }, { name: 'Foo', from: 'unknown' }],
      unknownNames: ['Foo'],
      unweighed: 2,
    });
  });
});

describe('addHouseTaste', () => {
  it('posts the body to the house route and parses the re-read', async () => {
    http.post.mockResolvedValue({ status: 201, data: body() });
    const b = { axes: { salty: { v: 5 } }, method: 'ordinal' as const };
    const r = await addHouseTaste('good', 'i1', b, R);
    expect(http.post).toHaveBeenCalledWith('/taste/r1/good/i1/house', b);
    expect(r.state).toBe('ready');
  });
  it('a 400 keeps the gateway\'s own sentence', async () => {
    http.post.mockRejectedValue(refused(400, { message: 'Salty must be between 0 and 10.' }));
    expect(await addHouseTaste('good', 'i1', { method: 'cata' }, R)).toEqual({ state: 'failed', reason: 'Salty must be between 0 and 10.', status: 400 });
  });
  it('a 500 carries no sentence: the outcome is unknown', async () => {
    http.post.mockRejectedValue(refused(500, { message: 'boom' }));
    expect(await addHouseTaste('good', 'i1', { method: 'cata' }, R)).toEqual({ state: 'failed', reason: null, status: 500 });
  });
  it('a missing route is absent', async () => {
    http.post.mockRejectedValue(refused(404, { message: 'Cannot POST /taste/r1/good/i1/house' }));
    expect((await addHouseTaste('good', 'i1', { method: 'cata' }, R)).state).toBe('absent');
  });
});

describe('the axis list', () => {
  it('is lane B\'s list, in order', () => {
    expect([...AXIS_KEYS].join(' ')).toBe(
      'sweet sour salty bitter umami fat heat alcohol astringency body carbonation aroma_intensity fruit citrus floral herbal spice nutty roasted smoky savoury earthy dairy woody funky',
    );
  });
  it('parseTasteBody reads the same shape the client parses', () => {
    expect(parseTasteBody(body())?.layers).toHaveLength(1);
  });
});

describe('rollupTaste: work a cocktail\u2019s or dish\u2019s taste out of its saved recipe', () => {
  it('POSTs to the subject\u2019s rollup route and parses what came back', async () => {
    http.post.mockResolvedValue({ data: body({ sour: axis({ prov: [{ kind: 'recipe', share: 1 }] }) }) });
    const r = await rollupTaste('cocktail', 'c1', R);
    expect(http.post).toHaveBeenCalledWith('/taste/r1/cocktail/c1/rollup', {});
    expect(r.state).toBe('ready');
    await rollupTaste('dish', 'd1', R);
    expect(http.post).toHaveBeenLastCalledWith('/taste/r1/dish/d1/rollup', {});
  });

  it('503 recipes_unavailable is a sentence, not absent', async () => {
    http.post.mockRejectedValue(refused(503, { code: 'recipes_unavailable', message: 'x' }));
    expect(await rollupTaste('cocktail', 'c1', R)).toEqual({ state: 'failed', sentence: ROLLUP_RECIPES_UNAVAILABLE });
  });

  it('no answer at all is the unreachable sentence, never the transport\u2019s word', async () => {
    http.post.mockRejectedValue(Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' }));
    const r = await rollupTaste('cocktail', 'c1', R);
    expect(r).toEqual({ state: 'failed', sentence: ROLLUP_UNREACHABLE });
    expect(JSON.stringify(r)).not.toMatch(/Network Error/);
  });

  it('a 5xx that arrived is not called unreachable', async () => {
    http.post.mockRejectedValue(Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK', response: { status: 502, data: {} } }));
    expect(await rollupTaste('cocktail', 'c1', R)).toEqual({ state: 'failed', sentence: ROLLUP_FAILED });
  });

  it('404 recipe_not_written is the gateway\u2019s sentence (a real answer), but a bare 404 is absent', async () => {
    http.post.mockRejectedValue(refused(404, { code: 'recipe_not_written', message: 'This has no recipe yet, so there is nothing to work a taste from.' }));
    expect(await rollupTaste('cocktail', 'c1', R)).toEqual({ state: 'failed', sentence: 'This has no recipe yet, so there is nothing to work a taste from.' });
    http.post.mockRejectedValue(refused(404, { message: 'Cannot POST /taste/r1/cocktail/c1/rollup' }));
    expect(await rollupTaste('cocktail', 'c1', R)).toEqual({ state: 'absent' });
    expect(ROLLUP_ABSENT).toMatch(/not switched on/);
  });

  it('a 400 refusal shows its sentence; a 500 with a message shows only the generic one', async () => {
    http.post.mockRejectedValue(refused(400, { message: 'This recipe has no lines, so there is nothing to work a taste from.' }));
    expect(await rollupTaste('cocktail', 'c1', R)).toEqual({ state: 'failed', sentence: 'This recipe has no lines, so there is nothing to work a taste from.' });
    http.post.mockRejectedValue(refused(500, { message: 'relation "recipe_lines" does not exist' }));
    expect(await rollupTaste('cocktail', 'c1', R)).toEqual({ state: 'failed', sentence: ROLLUP_FAILED });
  });

  it('a 201 that cannot be read says so, never ready', async () => {
    http.post.mockResolvedValue({ data: { nope: true } });
    expect(await rollupTaste('cocktail', 'c1', R)).toEqual({ state: 'failed', sentence: ROLLUP_UNREADABLE });
  });
});
