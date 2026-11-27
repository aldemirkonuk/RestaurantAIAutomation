/**
 * mail-format — the Mail tab's words, as pure functions (spec j). The rules
 * they hold: an unknown figure is an em dash, never 0 (ADR 0051); a failed
 * read says it failed (ADR 0020); a draft never looks sent (prc-02); a door
 * with no durable record of its reads is never "reading" (proposal L3).
 */

import { describe, expect, it } from 'vitest';
import {
  doorWords,
  emptyListWords,
  headerSentence,
  houseMailboxStatus,
  intakeLine,
  lastStoredWords,
  lastWriterWords,
  letterAt,
  letterLook,
  mailTabLabel,
  READING_WITHIN_MIN,
  spanWords,
  storedKindsLine,
  todayLine,
  unrecordedDoorStatus,
  type MailboxReader,
  type MailMessage,
  type MailSummary,
} from './mail-format';

const NOW = Date.parse('2026-11-07T12:00:00Z');
const MIN = 60_000;

const summary = (over: Partial<MailSummary> = {}): MailSummary => ({
  waitingPeople: 0,
  oldestWaitAt: null,
  inToday: 0,
  outToday: 0,
  heldAtDoor: null,
  doors: {
    houseMailbox: { lastStoredAt: null },
    whatsapp: { lastStoredAt: null },
    mudavymMail: { lastStoredAt: null },
  },
  address: { configured: true, address: null },
  ...over,
});

const reader = (over: Partial<MailboxReader> = {}): MailboxReader => ({
  granted: true,
  enabled: true,
  lastReadAt: new Date(NOW - 3 * MIN).toISOString(),
  lastError: null,
  ...over,
});

const msg = (over: Partial<MailMessage> = {}): MailMessage => ({
  id: 'm1',
  direction: 'outbound',
  channel: 'email',
  text: 'Six cases, as every week.',
  aiGenerated: false,
  status: 'SENT',
  sentAt: '2026-11-06T09:00:00Z',
  receivedAt: null,
  createdAt: '2026-11-06T08:59:00Z',
  rawDeletedAt: null,
  door: 'from_house',
  ...over,
});

describe('the header sentence', () => {
  it('names how many vendors wait and how long the oldest has', () => {
    const s = summary({ waitingPeople: 3, oldestWaitAt: new Date(NOW - 2 * 86_400_000).toISOString() });
    expect(headerSentence(s, { failed: false, now: NOW })).toBe(
      '3 vendors are waiting on you. The oldest has been waiting 2 days.',
    );
  });

  it('says one vendor in the singular', () => {
    const s = summary({ waitingPeople: 1, oldestWaitAt: new Date(NOW - 90 * MIN).toISOString() });
    expect(headerSentence(s, { failed: false, now: NOW })).toBe(
      '1 vendor is waiting on you. They have been waiting 1 hour.',
    );
  });

  it('says plainly when no one waits', () => {
    expect(headerSentence(summary(), { failed: false, now: NOW })).toBe('No one is waiting on you.');
  });

  // Spec (g): a failed summary is an em dash and words, never 0.
  it('a failed read is an em dash and words, never a zero', () => {
    const s = headerSentence(null, { failed: true, reason: 'Service unavailable', now: NOW });
    expect(s).toBe(
      '— Who is waiting on you could not be read (Service unavailable). That does not mean no one is.',
    );
    expect(s).not.toMatch(/\b0\b|No one is waiting/);
  });

  it('an unanswered read is still reading, not none', () => {
    expect(headerSentence(null, { failed: false, now: NOW })).toBe('— Reading who is waiting on you…');
  });
});

describe('the today line and the tab label', () => {
  it('counts letters in and out today', () => {
    expect(todayLine(summary({ inToday: 4, outToday: 2 }))).toBe('Today: 4 letters in, 2 out.');
    expect(todayLine(summary({ inToday: 1, outToday: 0 }))).toBe('Today: 1 letter in, 0 out.');
  });

  it('an unknown day is an em dash', () => {
    expect(todayLine(null)).toBe('Today: —');
  });

  it("the tab carries the waiting count, an em dash while it is unknown", () => {
    expect(mailTabLabel(summary({ waitingPeople: 3 }))).toBe('Mail · 3');
    expect(mailTabLabel(null)).toBe('Mail · —');
  });

  it('spans read in whole units', () => {
    expect(spanWords(30_000)).toBe('less than a minute');
    expect(spanWords(5 * MIN)).toBe('5 minutes');
    expect(spanWords(25 * 60 * MIN)).toBe('1 day');
  });
});

describe('the house mailbox door', () => {
  it('is reading when the last read is recent', () => {
    const st = houseMailboxStatus(reader(), { readFailed: false, now: NOW });
    expect(st).toMatchObject({ state: 'reading', tone: 'seal' });
    expect(intakeLine(st, reader(), NOW)).toBe('Your mailbox was read 3 min ago');
  });

  it('is behind by N minutes past the reading window', () => {
    const r = reader({ lastReadAt: new Date(NOW - 40 * MIN).toISOString() });
    const st = houseMailboxStatus(r, { readFailed: false, now: NOW });
    expect(st).toMatchObject({ state: 'behind', words: 'Behind by 40 min.', tone: 'warn' });
    expect(intakeLine(st, r, NOW)).toBe('Your mailbox is behind by 40 min');
  });

  it('holds "reading" for exactly 15 minutes and no longer', () => {
    // The window is the brief's rule, pinned at both edges so it cannot drift.
    expect(READING_WITHIN_MIN).toBe(15);
    const atEdge = reader({ lastReadAt: new Date(NOW - 15 * MIN).toISOString() });
    expect(houseMailboxStatus(atEdge, { readFailed: false, now: NOW })).toMatchObject({
      state: 'reading',
      tone: 'seal',
    });
    const justPast = reader({ lastReadAt: new Date(NOW - 15 * MIN - 1).toISOString() });
    expect(houseMailboxStatus(justPast, { readFailed: false, now: NOW })).toMatchObject({
      state: 'behind',
      words: 'Behind by 15 min.',
      tone: 'warn',
    });
    const sixteen = reader({ lastReadAt: new Date(NOW - 16 * MIN).toISOString() });
    expect(houseMailboxStatus(sixteen, { readFailed: false, now: NOW })).toMatchObject({
      state: 'behind',
      words: 'Behind by 16 min.',
      tone: 'warn',
    });
  });

  it('is not connected when no grant exists', () => {
    expect(houseMailboxStatus(reader({ granted: false }), { readFailed: false, now: NOW }).state).toBe('not_connected');
  });

  it('is switched off when connected but not enabled', () => {
    const r = reader({ enabled: false });
    const st = houseMailboxStatus(r, { readFailed: false, now: NOW });
    expect(st.state).toBe('switched_off');
    expect(intakeLine(st, r, NOW)).toBe('Your mailbox is connected, but not being read');
  });

  it('cannot tell when no read was ever recorded, the last read failed, or the reader failed', () => {
    expect(houseMailboxStatus(reader({ lastReadAt: null }), { readFailed: false, now: NOW }).state).toBe('cannot_tell');
    expect(houseMailboxStatus(reader({ lastError: 'invalid_grant' }), { readFailed: false, now: NOW })).toMatchObject({
      state: 'cannot_tell',
      tone: 'alarm',
      words: 'Cannot tell: the last read failed (invalid_grant).',
    });
    expect(houseMailboxStatus(reader({ granted: 'unknown' }), { readFailed: false, now: NOW }).state).toBe('cannot_tell');
    expect(houseMailboxStatus(null, { readFailed: true, now: NOW })).toMatchObject({ state: 'cannot_tell', tone: 'alarm' });
    expect(intakeLine(houseMailboxStatus(null, { readFailed: true, now: NOW }), null, NOW)).toBe(
      'Mail arrival: cannot tell yet',
    );
  });

  // Spec (e): a door with no record of its reads says "cannot tell", never "reading".
  it('a door that keeps no record of its reads cannot tell', () => {
    const st = unrecordedDoorStatus();
    expect(st.state).toBe('cannot_tell');
    expect(st.words).toMatch(/^Cannot tell/);
    expect(st.words).not.toMatch(/reading/i);
  });

  it('the last letter a door stored is an em dash when it could not be read', () => {
    expect(lastStoredWords(null, false, NOW)).toBe('—');
    expect(lastStoredWords(null, true, NOW)).toBe('None stored yet');
    expect(lastStoredWords(new Date(NOW - 2 * 60 * MIN).toISOString(), true, NOW)).toMatch(/ago$/);
  });
});

describe('a letter in a thread', () => {
  it('an inbound letter says which door it came by', () => {
    expect(letterLook(msg({ direction: 'inbound', door: 'house_mailbox', status: 'DRAFT' }))).toMatchObject({
      chip: null,
      line: 'arrived in your mailbox',
      dashed: false,
    });
    expect(doorWords('mudavym_mail')).toBe("arrived at Mudavym's mailbox or your Mudavym address");
    expect(doorWords('whatsapp')).toBe('WhatsApp');
    expect(doorWords('from_house')).toBe('sent by the house');
  });

  // An inbound row's status defaults to 'DRAFT' in the table; a vendor's own
  // reply is never an unsent draft.
  it("never calls a vendor's own reply a draft", () => {
    const look = letterLook(msg({ direction: 'inbound', status: 'DRAFT', aiGenerated: true, door: 'mudavym_mail' }));
    expect(look.chip).toBeNull();
    expect(look.line).not.toMatch(/draft|not sent/i);
  });

  it('a draft can never look sent (prc-02)', () => {
    for (const status of ['DRAFT', 'PENDING_APPROVAL', 'HOUSE_DRAFT']) {
      const look = letterLook(msg({ status, aiGenerated: true }));
      expect(look).toMatchObject({ chip: 'Draft · not sent', dashed: true });
      expect(look.line).toBe('not sent · written by Mudavym');
    }
  });

  it('APPROVED is approval, never dispatch', () => {
    expect(letterLook(msg({ status: 'APPROVED' })).chip).toBe('Approved · not sent');
  });

  it('only a queued house letter is queued', () => {
    expect(letterLook(msg({ status: 'HOUSE_QUEUED' }))).toMatchObject({ chip: 'Queued · not sent yet', queued: true });
    expect(letterLook(msg({ status: 'SENT' })).queued).toBe(false);
    expect(letterLook(msg({ direction: 'inbound', status: 'HOUSE_QUEUED' })).queued).toBe(false);
  });

  it('a refused letter says it was not sent', () => {
    expect(letterLook(msg({ status: 'RELAY_REFUSED' })).chip).toBe('Not sent');
  });

  it('a null status claims nothing about sending', () => {
    expect(letterLook(msg({ status: null }))).toMatchObject({
      chip: null,
      line: 'from the house; whether it was sent was not recorded',
    });
  });

  it('a sent letter is sent by the house', () => {
    expect(letterLook(msg({ status: 'SENT' }))).toMatchObject({ chip: null, line: 'sent by the house' });
  });

  it('a removed original says so, and the facts stay', () => {
    expect(letterLook(msg({ rawDeletedAt: '2026-10-02T10:00:00Z' })).removed).toBe(
      'Original removed on 2 Oct 2026; the facts stay.',
    );
    expect(letterLook(msg()).removed).toBeNull();
  });

  it('dates a letter by the field its direction fills', () => {
    expect(letterAt(msg({ direction: 'inbound', receivedAt: '2026-11-01T00:00:00Z' }))).toBe('2026-11-01T00:00:00Z');
    expect(letterAt(msg({ sentAt: null }))).toBe('2026-11-06T08:59:00Z');
  });
});

describe('the list around the people', () => {
  it('says which kinds of mail are not stored', () => {
    expect(storedKindsLine(['vendor'])).toBe(
      'Only vendor mail reaches Mudavym for now; mail from your team and guests is not read yet.',
    );
  });

  it('an empty list names which doors are connected', () => {
    const words = emptyListWords(reader(), summary({ address: { configured: true, address: 'bodega@in.mudavym.com' } }), {
      waitingOnly: false,
    });
    expect(words).toContain('Mail is read from your mailbox and your Mudavym address (bodega@in.mudavym.com).');
    expect(emptyListWords(reader({ granted: false }), summary(), { waitingOnly: false })).toContain(
      'No door of this house is known to be connected. Your mailbox is not connected; the house has no Mudavym address.',
    );
    expect(emptyListWords(null, null, { waitingOnly: true })).toBe('No vendor is waiting on you.');
  });

  it('says who wrote last', () => {
    expect(lastWriterWords('inbound', 'Bodega Álvaro')).toBe('Bodega Álvaro wrote last');
    expect(lastWriterWords('outbound', null)).toBe('The house wrote last');
    expect(lastWriterWords(null, null)).toBe('Who wrote last was not recorded');
  });
});
