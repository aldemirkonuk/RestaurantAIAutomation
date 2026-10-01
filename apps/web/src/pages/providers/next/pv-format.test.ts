import { describe, expect, it } from 'vitest';
import { visibleRegions } from './pv-format';

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
