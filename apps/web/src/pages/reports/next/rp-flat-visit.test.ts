import { describe, expect, it } from 'vitest';
import { flatAsked, flatVisit, refusedFlatSentence } from './rp-flat-visit';
import type { AnalysisId } from './rp-sheet';

const sheet = (...ids: AnalysisId[]) => new Set<AnalysisId>(ids);

describe('which full-screen link opens what (r36 reports gap 9)', () => {
  it('reads only an analysis with a register', () => {
    expect(flatAsked('ledger')).toBe('ledger');
    expect(flatAsked('writing')).toBeNull();
    expect(flatAsked('ledgr')).toBeNull();
    expect(flatAsked(null)).toBeNull();
  });

  it('visits an analysis off the sheet, and leaves one on it to the sheet', () => {
    expect(flatVisit('ledger', sheet('till'), true, false)).toEqual({ kind: 'visit', id: 'ledger' });
    expect(flatVisit('ledger', sheet('ledger'), true, false)).toEqual({ kind: 'none' });
  });

  it('decides nothing with no link, while arranging, or before the sheet is decided', () => {
    expect(flatVisit(null, sheet(), true, false)).toEqual({ kind: 'none' });
    expect(flatVisit('', sheet(), true, false)).toEqual({ kind: 'none' });
    expect(flatVisit('ledger', sheet(), true, true)).toEqual({ kind: 'none' });
    expect(flatVisit('ledger', sheet(), false, false)).toEqual({ kind: 'none' });
    expect(flatVisit('ledgr', sheet(), false, false)).toEqual({ kind: 'none' });
  });

  it('refuses a name it does not know, and the desk, in words', () => {
    const unknown = flatVisit('ledgr', sheet(), true, false);
    expect(unknown).toEqual({ kind: 'refused', asked: 'ledgr', title: null });
    const desk = flatVisit('writing', sheet('writing'), true, false);
    expect(desk).toMatchObject({ kind: 'refused', asked: 'writing' });
    if (unknown.kind !== 'refused' || desk.kind !== 'refused') throw new Error('refused');
    expect(refusedFlatSentence(unknown)).toBe(
      'The link asked to show “ledgr” full screen, and this page has no analysis by that name.',
    );
    expect(refusedFlatSentence(desk)).toMatch(/^The link asked to show .+ full screen\. It is a desk, not a register/);
  });
});
