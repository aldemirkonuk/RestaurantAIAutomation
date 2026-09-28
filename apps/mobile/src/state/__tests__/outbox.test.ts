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
import { useOutbox } from "../outbox";
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
