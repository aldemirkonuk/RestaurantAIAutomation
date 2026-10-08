import { describe, expect, it } from 'vitest';
import { houseMessage, visibleRegions } from './pv-format';

describe('visibleRegions (VEN-W8)', () => {
  it('hides bare weekday names the old picker left behind', () => {
    expect(visibleRegions(['Monday', 'tuesday ', 'Chicago', 'SUNDAY'])).toEqual(['Chicago']);
  });

  it('keeps a place whose name only contains a weekday', () => {
    expect(visibleRegions(['Sunday River', 'Monday Creek'])).toEqual(['Sunday River', 'Monday Creek']);
  });

  it('is empty when only weekdays were stored, so the sheet draws its dash', () => {
    expect(visibleRegions(['Monday', 'Friday'])).toEqual([]);
  });
});

describe('houseMessage (VEN-W27)', () => {
  const fb = 'The scorecard could not be read.';
  it('passes on a refusal the gateway wrote for a person', () => {
    const e = { response: { status: 403, data: { message: 'Only an owner or manager can confirm this.' } } };
    expect(houseMessage(e, fb)).toBe('Only an owner or manager can confirm this.');
  });
  it('never shows a server failure or a transport error code', () => {
    expect(houseMessage({ response: { status: 500, data: { message: 'Internal server error' } } }, fb)).toBe(fb);
    expect(houseMessage(new Error('Request failed with status code 500'), fb)).toBe(fb);
    expect(houseMessage(new Error('Network Error'), fb)).toBe(fb);
    expect(houseMessage({ response: { status: 404, data: {} } }, fb)).toBe(fb);
  });
});

describe('houseMessage ends its sentence (VEN-W31)', () => {
  const said = (message: string) => ({ response: { status: 404, data: { message } } });
  it('adds a full stop to a server sentence that has none, so the next words do not run into it', () => {
    expect(houseMessage(said('That branch is gone'), 'x')).toBe('That branch is gone.');
  });
  it('leaves a sentence that already ends', () => {
    expect(houseMessage(said('Nothing was added.'), 'x')).toBe('Nothing was added.');
    expect(houseMessage(said('Is it yours?'), 'x')).toBe('Is it yours?');
  });
});
