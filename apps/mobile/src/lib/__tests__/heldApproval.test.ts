import { heldApproval } from "../heldApproval";
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
