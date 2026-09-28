import { draftSendRequest } from '../draftSendRequest';
import { holdAct, standingLines, type SendOrAsk } from '../sendStanding';

/**
 * "Staff ask, manager sends" on the phone (founder, 2026-09-21): a staff
 * member's hold records a request over the exact words shown, spends no seal,
 * and asks nothing when the hold is released early.
 */
describe('a staff hold on the phone asks a manager', () => {
  function setup() {
    const request = jest.fn().mockResolvedValue({ says: 'Asked. Your version is saved exactly as you wrote it.' });
    const onAsked = jest.fn();
    const state = jest.fn();
    const scope = { userId: 'staff-1', restaurantId: 'house' };
    const control = draftSendRequest({
      orderId: 'order', body: 'Six cases, Tuesday.', ccEmails: ['ops@house.example'], scope, request, onAsked, state,
    });
    return { request, onAsked, state, scope, control };
  }

  it('records the request over the shown words and copies, with no seal, and says the gateway’s sentence', async () => {
    const s = setup();
    s.control.begin(false);
    expect(s.request).not.toHaveBeenCalled();
    await s.control.confirm();
    expect(s.request).toHaveBeenCalledTimes(1);
    expect(s.request.mock.calls[0]).toEqual([
      '/procurement/orders/order/draft-send-request',
      { method: 'POST', scope: { userId: 'staff-1', restaurantId: 'house' }, body: { content: 'Six cases, Tuesday.', ccEmails: ['ops@house.example'] } },
    ]);
    expect(s.onAsked).toHaveBeenCalledWith('Asked. Your version is saved exactly as you wrote it.');
    expect(JSON.stringify(s.request.mock.calls)).not.toContain('seal');
  });

  it('asks nothing when the hold is released early', async () => {
    const s = setup();
    s.control.begin(false);
    s.control.cancel();
    await s.control.confirm();
    expect(s.request).not.toHaveBeenCalled();
  });

  it('a refused request says nobody was asked and nothing was sent', async () => {
    const s = setup();
    s.request.mockReset().mockRejectedValue(new Error('You may send this yourself'));
    s.control.begin(false);
    await s.control.confirm();
    expect(s.onAsked).not.toHaveBeenCalled();
    const [, message] = s.state.mock.calls[s.state.mock.calls.length - 1];
    expect(message).toContain('Nobody was asked, and nothing was sent');
  });
});

describe('what the phone says before the hold', () => {
  const MANAGER: SendOrAsk = { readable: true, maySend: true, mode: 'send', basis: 'manager', grant: null, sentence: null };
  const STAFF: SendOrAsk = {
    readable: true, maySend: false, mode: 'ask', basis: null, grant: null,
    sentence: 'Your hold will ask a manager to send it; your version is kept exactly as you wrote it.',
  };

  it('reads send, ask, and unknown — never guessing send', () => {
    expect(holdAct(MANAGER)).toBe('send');
    expect(holdAct(STAFF)).toBe('ask');
    expect(holdAct({ ...MANAGER, readable: false })).toBeNull();
    expect(holdAct(null)).toBeNull();
  });

  it('says the ask, the grant, and who asked', () => {
    expect(standingLines(STAFF, null)).toEqual([STAFF.sentence]);
    expect(
      standingLines(
        { ...MANAGER, basis: 'grant', grant: { id: 'g', grantedBy: { userId: 'o', name: 'Olcay' }, expiresAt: null, limitAmount: null, limitCurrency: null } },
        null,
      ),
    ).toEqual(['You send under a grant from Olcay, until an owner revokes it.']);
    const request = { requestedBy: 's', requestedByName: 'Ayşe', requestedAt: '2026-09-21T11:00:00Z', current: true, ccEmails: [] };
    expect(standingLines(MANAGER, request)[0]).toMatch(/Ayşe asked for this to be sent\. This is their version/);
    expect(standingLines(MANAGER, { ...request, current: false })[0]).toMatch(/no longer their version/);
  });

  it('a failed read is said as a failure', () => {
    expect(standingLines(null, null, { failed: true })[0]).toMatch(/could not be read/);
  });
});
