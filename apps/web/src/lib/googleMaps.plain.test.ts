import { describe, expect, it } from 'vitest';
import { describeMapsError } from './googleMaps';

describe('describeMapsError speaks to the owner (r58 N-04)', () => {
  it.each([
    ['VITE_GOOGLE_MAPS_API_KEY not set', /not set up for this house yet/],
    ['BillingNotEnabledMapError', /whoever set this app up/i],
    ['ApiNotActivatedMapError', /whoever set this app up/i],
    ['RefererNotAllowedMapError', /whoever set this app up/i],
    ['InvalidKeyMapError', /whoever set this app up/i],
    ['network down', /try again in a moment/i],
  ])('%s', (raw, expected) => {
    const out = describeMapsError(new Error(raw));
    expect(out).toMatch(expected);
    expect(out).not.toMatch(/VITE_|Google Cloud|API key|allowlist|billing/i);
  });
});
