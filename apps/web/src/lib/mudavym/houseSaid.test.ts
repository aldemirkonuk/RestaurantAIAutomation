/**
 * "The house said" — the sitting's own log (sketch 119 D). It clears on reload
 * (module state, nothing stored) and starts again when the person or the house
 * changes without one.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { bindHouseSaid, getHouseSaid, houseSaid, resetHouseSaid, SAID_KEEP } from './houseSaid';

beforeEach(() => resetHouseSaid());

describe('houseSaid', () => {
  it('keeps the newest first and at most SAID_KEEP lines', () => {
    for (let i = 0; i < SAID_KEEP + 3; i++) houseSaid('sealed', `line ${i}`);
    const log = getHouseSaid();
    expect(log).toHaveLength(SAID_KEEP);
    expect(log[0].text).toBe(`line ${SAID_KEEP + 2}`);
  });

  it('the first binding names the sitting and keeps what it already holds', () => {
    houseSaid('not_read', 'The counter was not read');
    bindHouseSaid('u-1@r-1');
    expect(getHouseSaid()).toHaveLength(1);
  });

  it('the same person in the same house keeps the log', () => {
    bindHouseSaid('u-1@r-1');
    houseSaid('sealed', 'Order sealed');
    bindHouseSaid('u-1@r-1');
    expect(getHouseSaid()).toHaveLength(1);
  });

  it('another person, another house, or a sign-out starts it again', () => {
    bindHouseSaid('u-1@r-1');
    houseSaid('sealed', 'Order sealed');
    bindHouseSaid('u-2@r-1');
    expect(getHouseSaid()).toHaveLength(0);

    houseSaid('sealed', 'Order sealed');
    bindHouseSaid('u-2@r-9');
    expect(getHouseSaid()).toHaveLength(0);

    houseSaid('sealed', 'Order sealed');
    bindHouseSaid(null);
    expect(getHouseSaid()).toHaveLength(0);
  });
});
