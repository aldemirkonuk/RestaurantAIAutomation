/**
 * The formatters that carry the house's record.
 *
 * The first test here pins a defect this pass CAUGHT IN TEST, not on screen:
 * `procurement_documents.doc_date` is a Postgres `date`, arrives as
 * `2026-03-02`, and `new Date(...)` parses it as UTC midnight — so rendering it
 * in any timezone west of UTC printed "1 Mar 2026" for an invoice dated the
 * 2nd. A date of record that silently moves by a day is the same fault as a
 * fabricated one, in a smaller coat.
 */

import { describe, expect, it } from 'vitest';
import { EM, matchNote, quoteSource, shortDate } from './cellar-format';

describe('shortDate', () => {
  it('holds a calendar date on the day the document says, in any timezone', () => {
    // `doc_date` is a `date` column: no instant, no zone, no shifting.
    expect(shortDate('2026-03-02')).toBe('2 Mar 2026');
    expect(shortDate('2026-01-01')).toBe('1 Jan 2026');
    expect(shortDate('2026-12-31')).toBe('31 Dec 2026');
  });

  it('renders an instant in the reader’s own timezone', () => {
    // `created_at` is a `timestamptz`: "when did we last sell it" is a question
    // about the reader's evening, so this one is deliberately local.
    const at = '2026-09-01T22:11:00Z';
    expect(shortDate(at)).toBe(
      new Date(at).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }),
    );
  });

  it('is the em dash for absent or unparseable input, never today', () => {
    expect(shortDate(null)).toBe(EM);
    expect(shortDate(undefined)).toBe(EM);
    expect(shortDate('')).toBe(EM);
    expect(shortDate('not a date')).toBe(EM);
  });
});

describe('quoteSource', () => {
  it('speaks the /vendor-prices vocabulary', () => {
    expect(quoteSource('rep_message')).toBe('a rep’s message');
    expect(quoteSource('invoice')).toBe('an invoice');
  });

  it('shows a value it does not recognise verbatim rather than bucketing it', () => {
    // `source_type` has no CHECK constraint, so renaming an unknown value would
    // be inventing provenance.
    expect(quoteSource('edi_feed')).toBe('“edi_feed”');
    expect(quoteSource(null)).toBe('an unstated source');
  });
});

describe('matchNote', () => {
  it('says a loose match is loose', () => {
    expect(matchNote('contains')).toMatch(/would match too/);
  });
  it('says nothing at all when there was no match to describe', () => {
    expect(matchNote(null)).toBeNull();
  });
});
