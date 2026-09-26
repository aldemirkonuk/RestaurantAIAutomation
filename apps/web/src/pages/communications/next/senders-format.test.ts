import { describe, expect, it } from 'vitest';
import type { ProspectDto, SenderReputationDto } from '../../../hooks/queries/usePromotionsQueries';
import {
  fmtCount,
  fmtDay,
  promoteOutcome,
  readFailure,
  readFailureSentence,
  senderState,
  strangerChips,
  whoIsWritingSummary,
  writeFailureSentence,
} from './senders-format';

const sender = (over: Partial<SenderReputationDto> = {}): SenderReputationDto => ({
  id: 's1',
  domain: 'winebow.com',
  provider_id: null,
  trusted: false,
  suspended: false,
  suspended_reason: null,
  injection_signals: 0,
  spam_signals: 0,
  completed_orders: 0,
  score: 0,
  updated_at: '2026-09-09T10:00:00Z',
  ...over,
});

const stranger = (over: Partial<ProspectDto> = {}): ProspectDto => ({
  id: 'p1',
  restaurant_id: 'r1',
  domain: 'tuscandirect.co',
  sender_email: 'sales@tuscandirect.co',
  sender_name: 'Tuscan Direct Imports',
  subject: 'Price list',
  snippet: null,
  body_preview: null,
  capture_reason: null,
  has_attachments: false,
  attachments: [],
  message_count: 1,
  status: 'open',
  first_seen_at: '2026-09-13T10:00:00Z',
  last_seen_at: '2026-09-15T10:00:00Z',
  ...over,
});

describe('senderState', () => {
  it('a suspended domain is never called trusted, whatever its flag says', () => {
    const s = senderState({ trusted: true, suspended: true, suspended_reason: 'spoof signal' });
    expect(s.tone).toBe('suspended');
    expect(s.word).toBe('suspended · spoof signal');
  });
  it('a suspension with no recorded reason says so instead of inventing one', () => {
    expect(senderState({ trusted: false, suspended: true, suspended_reason: '  ' }).word).toBe('suspended · no reason recorded');
  });
  it('trusted and plain', () => {
    expect(senderState({ trusted: true, suspended: false, suspended_reason: null }).word).toBe('trusted');
    expect(senderState({ trusted: false, suspended: false, suspended_reason: null }).word).toBe('not trusted');
  });
});

describe('unknowns are em dashes, never zeros', () => {
  it('fmtCount', () => {
    expect(fmtCount(0)).toBe('0');
    expect(fmtCount(undefined)).toBe('—');
    expect(fmtCount(NaN)).toBe('—');
  });
  it('fmtDay', () => {
    expect(fmtDay(null)).toBe('—');
    expect(fmtDay('not a date')).toBe('—');
    // en-GB ICU prints "Sept" on some Node builds, so the month is matched by prefix.
    expect(fmtDay('2026-09-09T10:00:00Z')).toMatch(/^9 Sep/);
  });
});

describe('strangerChips', () => {
  it('names the reasons in words, not the bridge tokens', () => {
    expect(strangerChips(stranger({ capture_reason: 'attachment+promotional', has_attachments: true }))).toEqual([
      'looks promotional',
      'has an attachment',
    ]);
  });
  it('counts real attachments and multiple emails', () => {
    const chips = strangerChips(
      stranger({ attachments: [{ filename: 'a.pdf', mime_type: null, size_bytes: null }], message_count: 3 }),
    );
    expect(chips).toEqual(['1 attachment', '3 emails']);
  });
  it('no recorded reason is plain vendor outreach', () => {
    expect(strangerChips(stranger())).toEqual(['vendor outreach']);
  });
});

describe('whoIsWritingSummary', () => {
  it('each half is an em dash until its own read answers', () => {
    expect(whoIsWritingSummary(undefined, undefined, 100)).toBe('— trusted senders · — suspended · — strangers waiting');
    expect(whoIsWritingSummary([sender({ trusted: true })], undefined, 100)).toBe(
      '1 trusted sender · 0 suspended · — strangers waiting',
    );
  });
  it('a suspended domain is counted suspended and not trusted', () => {
    expect(whoIsWritingSummary([sender({ trusted: true, suspended: true })], [], 100)).toBe(
      '0 trusted senders · 1 suspended · 0 strangers waiting',
    );
  });
  it('a full server window prints as a floor, not a total', () => {
    const full = Array.from({ length: 100 }, (_, i) => stranger({ id: `p${i}` }));
    expect(whoIsWritingSummary([], full, 100)).toContain('≥100 strangers waiting');
    expect(whoIsWritingSummary([], full.slice(0, 99), 100)).toContain(' 99 strangers waiting');
    expect(whoIsWritingSummary([], full.slice(0, 99), 100)).not.toContain('≥');
  });
});

describe('failures are said in words', () => {
  it('reads: 401, 403 and other are three different sentences, none an empty list', () => {
    const expired = readFailureSentence('the register', readFailure({ response: { status: 401 } }));
    const forbidden = readFailureSentence('the register', readFailure({ response: { status: 403 } }));
    const other = readFailureSentence('the register', readFailure({ message: 'boom' }));
    expect(new Set([expired, forbidden, other]).size).toBe(3);
    expect(forbidden).toMatch(/owner or manager/);
    expect(other).toMatch(/boom/);
    for (const s of [expired, forbidden, other]) expect(s).toMatch(/Nothing below is claimed/);
  });
  it('a validation array body is joined, not printed as [object]', () => {
    expect(readFailure({ response: { status: 400, data: { message: ['a', 'b'] } } }).message).toBe('a, b');
  });
  it('writes say "not saved"', () => {
    expect(writeFailureSentence('Trusting x', readFailure({ message: 'nope' }))).toBe('Trusting x was not saved (nope).');
    expect(writeFailureSentence('Trusting x', readFailure({ response: { status: 403 } }))).toMatch(/only an owner or manager/);
  });
});

describe('promoteOutcome', () => {
  it('a 200 with promoted:false is NOT an add', () => {
    expect(promoteOutcome({ promoted: false }, 'Acme').kind).toBe('not-added');
    expect(promoteOutcome(undefined, 'Acme').kind).toBe('not-added');
  });
  it('a reused vendor is linked, not called new', () => {
    const r = promoteOutcome({ promoted: true, reused: true }, 'Acme');
    expect(r.kind).toBe('reused');
    expect(r.sentence).toMatch(/already a vendor/);
  });
  it('an add says nothing about them is trusted', () => {
    expect(promoteOutcome({ promoted: true }, 'Acme').sentence).toMatch(/Nothing about them is trusted/);
  });
});
