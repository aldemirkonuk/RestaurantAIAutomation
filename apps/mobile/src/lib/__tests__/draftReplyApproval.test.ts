import { draftReplyApproval } from '../draftReplyApproval';

describe('native draft send proof', () => {
  function setup() {
    const request = jest.fn().mockResolvedValueOnce({ challenge: 'one-use-proof' }).mockResolvedValue({ sentAt: '2026-09-13' });
    const onApproved = jest.fn().mockResolvedValue(undefined);
    const state = jest.fn();
    const scope = { userId: 'writer', restaurantId: 'house' };
    return { request, onApproved, state, scope, control: draftReplyApproval({ orderId: 'order', body: 'The reviewed letter', recipient: 'vendor@example.test', scope, request, onApproved, state }) };
  }
  it('issues at review, then submits the same shown letter and captured scope only after confirmation', async () => {
    const s = setup(); s.control.begin(false);
    expect(s.request).toHaveBeenCalledTimes(1);
    expect(s.request.mock.calls[0][1]).toEqual({ method: 'POST', scope: { userId: 'writer', restaurantId: 'house' }, body: { content: 'The reviewed letter', to: 'vendor@example.test', ccEmails: [] } });
    s.scope.restaurantId = 'another-house';
    await s.control.confirm();
    expect(s.request.mock.calls[1][1]).toEqual({ method: 'POST', scope: { userId: 'writer', restaurantId: 'house' }, body: { modifiedContent: 'The reviewed letter', ccEmails: [] }, sealChallenge: 'one-use-proof' });
    expect(s.onApproved).toHaveBeenCalledTimes(1);
    await s.control.confirm(); expect(s.request).toHaveBeenCalledTimes(2);
  });
  it('never dispatches after the review is cancelled', async () => {
    const s = setup(); s.control.begin(false); s.control.cancel(); await s.control.confirm();
    expect(s.request).toHaveBeenCalledTimes(1); expect(s.onApproved).not.toHaveBeenCalled();
  });
  it('does not report sent or requeue a timed-out send', async () => {
    const s = setup(); s.request.mockReset().mockResolvedValueOnce({ challenge: 'proof' }).mockRejectedValueOnce(new Error('response lost'));
    s.control.begin(false); await s.control.confirm();
    expect(s.onApproved).not.toHaveBeenCalled();
    expect(s.state).toHaveBeenLastCalledWith('idle', expect.stringContaining('could not be confirmed'));
    await s.control.confirm(); expect(s.request).toHaveBeenCalledTimes(2);
  });
});
