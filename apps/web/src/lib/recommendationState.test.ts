import { describe, expect, it } from 'vitest';
import { DISMISS_REASONS, insightActKey } from './recommendationState';

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
  it('is the gateway label set, in its order', () => {
    expect(DISMISS_REASONS.map((r) => r.id)).toEqual([
      'not_relevant',
      'already_handled',
      'disagree',
      'not_now',
    ]);
  });
});
