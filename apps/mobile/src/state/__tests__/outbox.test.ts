jest.mock("@/design/motion", () => ({ GRACE_MS: 8000 }));
jest.mock("@/api/client", () => ({
  api: jest.fn().mockResolvedValue({}),
  ApiError: class ApiError extends Error {},
}));
jest.mock("@/lib/queryClient", () => ({
  queryClient: { invalidateQueries: jest.fn() },
}));
jest.mock("@/lib/mmkv", () => {
  const values = new Map();
  return {
    outboxStorage: {
      getString: (key: string) => values.get(key),
      set: (key: string, value: string) => values.set(key, value),
      delete: (key: string) => values.delete(key),
    },
  };
});
jest.mock("@/state/session", () => {
  // jest.mock factories are hoisted above imports, so the module is required here.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { create } = require("zustand");
  return {
    useSession: create(() => ({
      status: "signedOut",
      user: null,
      generation: 0,
    })),
  };
});
import { api } from "@/api/client";
import { useSession } from "../session";
import { useOutbox, waitingWork, waitingWords } from "../outbox";
import { outboxStorage } from "@/lib/mmkv";

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  useOutbox.setState({ entries: [] });
  useSession.setState({
    status: "signedIn",
    user: { id: "alice", email: "a@example.com", restaurantId: "r1" },
  });
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

it("persists ownership and keeps a locked account's action unsent until unlock", async () => {
  useOutbox
    .getState()
    .enqueue({ path: "/orders/one/receive", label: "Receipt" });
  expect(useOutbox.getState().entries[0]).toMatchObject({
    actorUserId: "alice",
    restaurantId: "r1",
  });
  useSession.setState({ status: "locked" });
  await jest.advanceTimersByTimeAsync(1);
  expect(api).not.toHaveBeenCalled();
  useSession.setState({ status: "signedIn" });
  await jest.advanceTimersByTimeAsync(1);
  expect(api).toHaveBeenCalledWith(
    "/orders/one/receive",
    expect.objectContaining({ scope: { userId: "alice", restaurantId: "r1" } }),
  );
});

it("never sends Alice's saved work under Bob's token or under another house", async () => {
  useOutbox
    .getState()
    .enqueue({ path: "/orders/one/receive", label: "Receipt" });
  useSession.setState({
    user: { id: "bob", email: "b@example.com", restaurantId: "r1" },
  });
  await jest.advanceTimersByTimeAsync(1);
  useSession.setState({
    user: { id: "alice", email: "a@example.com", restaurantId: "r2" },
  });
  await jest.advanceTimersByTimeAsync(1);
  expect(api).not.toHaveBeenCalled();
  expect(useOutbox.getState().entries).toHaveLength(1);
});

it("retains old unscoped entries for review and does not send them on hydrate or retry", async () => {
  outboxStorage.set(
    "outbox:v1",
    JSON.stringify([
      { id: "old", status: "pending", path: "/old-action", holdUntil: 0 },
    ]),
  );
  useOutbox.getState().hydrate();
  useOutbox.getState().retryFailed("old");
  await jest.advanceTimersByTimeAsync(1);
  expect(api).not.toHaveBeenCalled();
  expect(useOutbox.getState().entries[0]).toMatchObject({
    id: "old",
    status: "failed",
    lastError: expect.stringMatching(/older app/),
  });
});

it("does not run two dispatches when a reconnect occurs during an in-flight action", async () => {
  let finish!: () => void;
  (api as jest.Mock).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = () => resolve({});
      }),
  );
  useOutbox.getState().enqueue({ path: "/first", label: "First" });
  useOutbox.getState().enqueue({ path: "/second", label: "Second" });
  await jest.advanceTimersByTimeAsync(1);
  useOutbox.getState().flush();
  await jest.advanceTimersByTimeAsync(1);
  expect(api).toHaveBeenCalledTimes(1);
  finish();
  await jest.advanceTimersByTimeAsync(1);
  expect(api).toHaveBeenCalledTimes(2);
});

it("saves nothing and does not throw from a press while the session has no house (F-404)", () => {
  useSession.setState({ status: "locked" });
  expect(
    useOutbox.getState().enqueue({ path: "/orders/one/receive", label: "Receipt" }),
  ).toBeNull();
  useSession.setState({ status: "signedIn", user: null });
  expect(
    useOutbox.getState().enqueue({ path: "/orders/one/receive", label: "Receipt" }),
  ).toBeNull();
  expect(useOutbox.getState().entries).toHaveLength(0);
});

it("counts the person's waiting work here and in their other houses, never another account's (F-407)", () => {
  const e = (id: string, actorUserId: string, restaurantId: string, status: any) =>
    ({ id, actorUserId, restaurantId, status, path: "/x", method: "POST", label: "Receipt", createdAt: 0, holdUntil: 0, attempts: 0 }) as any;
  const w = waitingWork(
    [
      e("1", "alice", "r1", "pending"),
      e("2", "alice", "r1", "holding"),
      e("3", "alice", "r1", "failed"),
      e("4", "alice", "r2", "pending"),
      e("5", "bob", "r1", "pending"),
    ],
    { id: "alice", restaurantId: "r1" },
  );
  expect(w).toEqual({ here: 2, otherHouses: 1 });
  expect(waitingWords(w)).toBe(
    "2 waiting to send from this phone. 1 saved for another of your houses; it sends when you open that house.",
  );
  expect(waitingWords({ here: 0, otherHouses: 0 })).toBeNull();
});

it("a failed receipt can be sent again with its figures kept (F-407)", async () => {
  useOutbox.setState({
    entries: [
      { id: "f1", actorUserId: "alice", restaurantId: "r1", status: "failed", path: "/orders/one/verify-receipt", method: "POST", body: { acceptedQuantityInCountedUom: 12 }, label: "Receipt verification", createdAt: 0, holdUntil: 0, attempts: 3 },
    ],
  });
  useOutbox.getState().retryFailed("f1");
  await jest.advanceTimersByTimeAsync(1);
  expect(api).toHaveBeenCalledWith(
    "/orders/one/verify-receipt",
    expect.objectContaining({ body: { acceptedQuantityInCountedUom: 12 } }),
  );
  expect(useOutbox.getState().entries).toHaveLength(0);
});

it("parks a write the server keeps refusing with 5xx so later work still sends (F-590)", async () => {
  const { ApiError } = jest.requireMock("@/api/client");
  const serverDown = Object.assign(new ApiError("Request failed (500)"), { status: 500 });
  (api as jest.Mock).mockImplementation((path: string) =>
    path === "/stuck" ? Promise.reject(serverDown) : Promise.resolve({}),
  );
  useOutbox.getState().enqueue({ path: "/stuck", label: "Count" });
  useOutbox.getState().enqueue({ path: "/later", label: "Receipt" });
  await jest.advanceTimersByTimeAsync(120_000);
  const calls = (api as jest.Mock).mock.calls.map((c) => c[0]);
  expect(calls.filter((p) => p === "/stuck")).toHaveLength(5);
  expect(calls).toContain("/later");
  expect(useOutbox.getState().entries).toEqual([
    expect.objectContaining({ path: "/stuck", status: "failed", lastError: expect.stringContaining("Try again") }),
  ]);
  (api as jest.Mock).mockResolvedValue({});
});

it("keeps waiting, without parking, while the phone gets no answer at all", async () => {
  (api as jest.Mock).mockRejectedValue(new TypeError("Network request failed"));
  useOutbox.getState().enqueue({ path: "/offline", label: "Count" });
  await jest.advanceTimersByTimeAsync(300_000);
  expect(useOutbox.getState().entries[0].status).not.toBe("failed");
  (api as jest.Mock).mockResolvedValue({});
});
