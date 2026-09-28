import { draftReplyApproval } from '../draftReplyApproval';

// Not the real `ApiError` (`../../api/client`): that module imports
// `react-native`, which the pure-module test transform here cannot parse.
// `draftReplyApproval` only duck-types `.status`, so a plain shape suffices.
class FakeApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

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
  it('reports a refused seal as refused, not as unconfirmed (lane E audit D9)', async () => {
    const s = setup();
    s.request.mockReset()
      .mockResolvedValueOnce({ challenge: 'proof' })
      .mockRejectedValueOnce(new FakeApiError(403, 'The letter changed after the hold began.'));
    s.control.begin(false);
    await s.control.confirm();
    expect(s.onApproved).not.toHaveBeenCalled();
    const [, message] = s.state.mock.calls[s.state.mock.calls.length - 1];
    expect(message).toContain('refused');
    expect(message).toContain('nothing was sent');
    expect(message).not.toContain('could not be confirmed');
  });
  it('reports a refused seal readably even when the gateway rejects with a plain shape, not an Error (mobile tsc audit)', async () => {
    // `error` in the catch is statically `unknown`. Before the fix this branch
    // read `error.message` unguarded, which is `undefined` on a rejection
    // that is not an Error instance (any client that rejects with a plain
    // `{status}` body, not just `FakeApiError`/`ApiError`) -- the refusal
    // note would then read "...nothing was sent: undefined" instead of a
    // sentence. `tsc --noEmit` also flags the unguarded access (TS18046).
    const s = setup();
    s.request.mockReset()
      .mockResolvedValueOnce({ challenge: 'proof' })
      .mockRejectedValueOnce({ status: 403 });
    s.control.begin(false);
    await s.control.confirm();
    expect(s.onApproved).not.toHaveBeenCalled();
    const [, message] = s.state.mock.calls[s.state.mock.calls.length - 1];
    expect(message).toContain('refused');
    expect(message).not.toContain('undefined');
  });
});
