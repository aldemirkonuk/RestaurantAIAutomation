/**
 * A draft the gateway refused to build is closed and was never sent (founder
 * answer 6, 2026-09-21; SEND_REFUSED). It may read as neither a draft (that
 * invites another tap that fails the same way) nor as sent.
 */
import { describe, expect, it } from 'vitest';
import { sendState } from './cm-format';
import { draftStatusLabel } from '../../../lib/conversationGrouping';

describe('SEND_REFUSED', () => {
  it('is a failed send, never a draft and never sent', () => {
    expect(sendState('SEND_REFUSED')).toBe('failed');
    expect(sendState('send_refused')).toBe('failed');
  });

  it('is labelled as refused and closed on the grouped ledger', () => {
    expect(draftStatusLabel({ status: 'SEND_REFUSED' } as never)).toBe('Refused before sending — draft closed');
  });
});
