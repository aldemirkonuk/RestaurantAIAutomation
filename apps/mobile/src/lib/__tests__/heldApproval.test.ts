import {
  approveOrSettle,
  heldApproval,
  OFFLINE_REFUSAL,
  UNCERTAIN_APPROVAL,
} from "../heldApproval";
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());
it("issues at the start, cancels on early release and never approves later", async () => {
  let issue!: (proof: string) => void;
  const approve = jest.fn();
  const control = heldApproval({
    issue: () =>
      new Promise((resolve) => {
        issue = resolve;
      }),
    approve,
    state: jest.fn(),
  });
  control.begin();
  control.cancel();
  issue("one-time-proof");
  await jest.advanceTimersByTimeAsync(1000);
  expect(approve).not.toHaveBeenCalled();
});
it("holds before spending the returned seal exactly once", async () => {
  const approve = jest.fn().mockResolvedValue(undefined);
  const control = heldApproval({
    issue: async () => "proof",
    approve,
    state: jest.fn(),
  });
  control.begin();
  await jest.advanceTimersByTimeAsync(619);
  expect(approve).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(1);
  await control.confirm();
  expect(approve.mock.calls).toEqual([["proof"]]);
});
it("does not mint or retry approval in a background queue after a seal refusal", async () => {
  const approve = jest.fn();
  const state = jest.fn();
  const control = heldApproval({
    issue: async () => {
      throw new Error("Role refused");
    },
    approve,
    state,
  });
  control.begin();
  await jest.advanceTimersByTimeAsync(1000);
  expect(approve).not.toHaveBeenCalled();
  expect(state).toHaveBeenLastCalledWith("idle", "Role refused");
});
it("accessible confirmation waits for the second explicit action", async () => {
  const approve = jest.fn().mockResolvedValue(undefined);
  const control = heldApproval({
    issue: async () => "proof",
    approve,
    state: jest.fn(),
  });
  control.begin(false);
  await jest.advanceTimersByTimeAsync(10000);
  expect(approve).not.toHaveBeenCalled();
  await control.confirm();
  expect(approve).toHaveBeenCalledWith("proof");
});

// F-678: offline, the hold showed fetch's raw "Network request failed".
it("says plainly that nothing was approved when the phone is offline", async () => {
  const approve = jest.fn();
  const state = jest.fn();
  const control = heldApproval({
    issue: async () => {
      throw new TypeError("Network request failed");
    },
    approve,
    state,
  });
  control.begin();
  await jest.advanceTimersByTimeAsync(1000);
  expect(approve).not.toHaveBeenCalled();
  expect(state).toHaveBeenLastCalledWith("idle", OFFLINE_REFUSAL);
});

it("does not claim 'not approved' when the connection drops after sending", async () => {
  const state = jest.fn();
  const control = heldApproval({
    issue: async () => "proof",
    approve: async () => {
      throw new TypeError("Network request failed");
    },
    state,
  });
  control.begin();
  await jest.advanceTimersByTimeAsync(1000);
  expect(state).toHaveBeenLastCalledWith("idle", UNCERTAIN_APPROVAL);
});

// F-830: a second hold on an order someone already approved read as an error
// and left the stale list on screen.
function refusal(status: number, body: unknown) {
  return Object.assign(new Error("refused"), { status, body });
}

it("treats an 'already approved' 409 as done: refreshes and shows no error", async () => {
  const settle = jest.fn();
  const state = jest.fn();
  const control = heldApproval({
    issue: async () => "proof",
    approve: () =>
      approveOrSettle(async () => {
        throw refusal(409, {
          reason: "order_already_approved",
          message: "This order is already approved.",
        });
      }, settle),
    state,
  });
  control.begin();
  await jest.advanceTimersByTimeAsync(1000);
  expect(settle).toHaveBeenCalledTimes(1);
  expect(state).toHaveBeenLastCalledWith("approved");
});

it("still shows any other 409 as the refusal it is", async () => {
  const settle = jest.fn();
  const state = jest.fn();
  const control = heldApproval({
    issue: async () => "proof",
    approve: () =>
      approveOrSettle(async () => {
        throw refusal(409, {
          reason: "order_changed_while_approving",
          message: "The order changed while you were approving it.",
        });
      }, settle),
    state,
  });
  control.begin();
  await jest.advanceTimersByTimeAsync(1000);
  expect(settle).not.toHaveBeenCalled();
  expect(state).toHaveBeenLastCalledWith("idle", "refused");
});
