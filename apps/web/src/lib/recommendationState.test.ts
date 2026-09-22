import { describe, expect, it } from 'vitest';
import {
  DISMISS_CHOICES,
  DISMISS_REASONS,
  NOT_YOUR_ACT_SAID,
  insightActKey,
  mayActForTheHouse,
  maySnoozeForEveryone,
  notYourActOf,
  paperMissOf,
  patchForChoice,
} from './recommendationState';

/**
 * ADR 0191: one shared per-item state. A surface acts at the key the gateway
 * built for the row — never one of its own making — and never offers a
 * one-item act whose key is the whole type.
 */
describe('insightActKey', () => {
  it('reads the gateway-built key and whether it is the whole type', () => {
    expect(
      insightActKey({
        suppression: {
          key: 'insight:a#wednesday#d:2026-09-16',
          keys: { rule: 'insight:a' },
        },
      }),
    ).toEqual({ key: 'insight:a#wednesday#d:2026-09-16', ruleWide: false });
    expect(
      insightActKey({ suppression: { key: 'insight:a', keys: { rule: 'insight:a' } } }),
    ).toEqual({ key: 'insight:a', ruleWide: true });
  });

  it('a period with no subject is one finding, not the type', () => {
    expect(
      insightActKey({
        suppression: { key: 'insight:a#*#p7:2026-09-16', keys: { rule: 'insight:a' } },
      }),
    ).toEqual({ key: 'insight:a#*#p7:2026-09-16', ruleWide: false });
  });

  it('a row with no key is not actable — no key is invented', () => {
    expect(insightActKey({ candidate_key: 'a', entity_key: 'Caymus' })).toBeNull();
    expect(insightActKey(null)).toBeNull();
    expect(insightActKey({ suppression: { key: '' } })).toBeNull();
  });

  it('without the rule key, a bare key is still read as the whole type', () => {
    expect(insightActKey({ suppression: { key: 'insight:a' } })).toEqual({
      key: 'insight:a',
      ruleWide: true,
    });
  });
});

describe('DISMISS_REASONS', () => {
  it('is the gateway label set, in its order — two since round 3', () => {
    expect(DISMISS_REASONS.map((r) => r.id)).toEqual(['not_relevant', 'disagree']);
  });
});

/**
 * ADR 0191 round 3 (founder, 2026-09-21): the dismiss list keeps its four
 * choices, but "Already handled" is recorded as done and "Not right now" is
 * the person's own snooze.
 */
describe('DISMISS_CHOICES and what each posts', () => {
  const NOW = Date.parse('2026-09-21T12:00:00.000Z');

  it('keeps the four choices a person already knows, and says what each records', () => {
    expect(DISMISS_CHOICES.map((c) => [c.id, c.records])).toEqual([
      ['not_relevant', 'dismissed'],
      ['already_handled', 'done'],
      ['disagree', 'dismissed'],
      ['not_now', 'snoozed_for_you'],
    ]);
  });

  it("'Already handled' posts done, with no label", () => {
    expect(patchForChoice('already_handled', NOW)).toEqual({ status: 'done' });
  });

  it("'Not right now' posts a snooze for me, until tomorrow", () => {
    expect(patchForChoice('not_now', NOW)).toEqual({
      status: 'snoozed',
      snoozeFor: 'me',
      snoozeUntil: '2026-09-22T12:00:00.000Z',
    });
  });

  it('a real dismissal posts its label', () => {
    expect(patchForChoice('disagree', NOW)).toEqual({ status: 'dismissed', reason: 'disagree' });
  });

  it('snooze for everyone is offered to owners and managers only', () => {
    expect(maySnoozeForEveryone('owner')).toBe(true);
    expect(maySnoozeForEveryone('Manager')).toBe(true);
    expect(maySnoozeForEveryone('staff')).toBe(false);
    expect(maySnoozeForEveryone(null)).toBe(false);
    // Round 4, answer 7: the platform admin is not an owner or manager.
    expect(maySnoozeForEveryone('admin')).toBe(false);
  });
});

/**
 * ADR 0191 round 4 (the founder, 2026-09-21, "Take all seven" — the options
 * he picked): answer 7, the platform admin never acts for a house's cards;
 * answer 5, staff undo only their own acts, and that refusal has its own words.
 */
describe('round 4: who acts for the house, and the not-your-act refusal', () => {
  it('owners and managers act for the house; the platform admin and staff do not', () => {
    for (const r of ['owner', 'manager', 'Owner'])
      expect(mayActForTheHouse(r)).toBe(true);
    for (const r of ['admin', 'ADMIN', 'staff', '', null, undefined])
      expect(mayActForTheHouse(r)).toBe(false);
  });

  it("reads the gateway's not_your_act refusal, in its own sentence when it sent one", () => {
    const said = 'It is not recorded who did this, so only an owner or manager can undo it.';
    expect(
      notYourActOf({ response: { status: 403, data: { code: 'not_your_act', message: said } } }),
    ).toBe(said);
    expect(notYourActOf({ response: { status: 403, data: { code: 'not_your_act' } } })).toBe(
      NOT_YOUR_ACT_SAID,
    );
    expect(NOT_YOUR_ACT_SAID).toBe(
      'Only the person who did this, or an owner or manager, can undo it.',
    );
  });

  it('any other refusal is not this one', () => {
    expect(notYourActOf({ response: { status: 403, data: { message: 'no' } } })).toBeNull();
    expect(notYourActOf({ response: { status: 500 } })).toBeNull();
    expect(notYourActOf(null)).toBeNull();
    expect(notYourActOf(new Error('network'))).toBeNull();
  });
});

describe('paperMissOf', () => {
  it('says which record missed, and nothing when both landed', () => {
    expect(paperMissOf({ audit: null, history: { recorded: true, reason: null } })).toBeNull();
    expect(paperMissOf({ history: { recorded: false, reason: 'timeout' } })).toBe(
      'not kept in the history (timeout)',
    );
    expect(paperMissOf({ audit: { recorded: false, reason: 'x' }, history: { recorded: true } })).toBe(
      'not written to the house log (x)',
    );
  });
});
