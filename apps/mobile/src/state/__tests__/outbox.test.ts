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
import {
  signOutWords,
  unsentAtSignOut,
  useOutbox,
  receiptWaitingFor,
  waitingFeedItems,
  waitingFor,
  waitingWork,
  waitingWords,
} from "../outbox";
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

it("does not park after offline misses and one 5xx; parks only after 5 server errors (F-798)", async () => {
  const { ApiError } = jest.requireMock("@/api/client");
  const serverDown = Object.assign(new ApiError("Request failed (502)"), { status: 502 });
  const offline = new TypeError("Network request failed");
  let call = 0;
  (api as jest.Mock).mockImplementation(() => {
    call += 1;
    return Promise.reject(call <= 4 ? offline : serverDown);
  });
  useOutbox.getState().enqueue({ path: "/orders/one/receive", label: "Receipt" });
  // Four offline misses then one 5xx.
  while (call < 5) await jest.advanceTimersByTimeAsync(500);
  expect(call).toBe(5);
  expect(useOutbox.getState().entries[0]).toMatchObject({ status: "pending", serverAttempts: 1 });
  // Four more server errors make five: now it is parked.
  await jest.advanceTimersByTimeAsync(300_000);
  expect(call).toBe(9);
  expect(useOutbox.getState().entries[0]).toMatchObject({ status: "failed", serverAttempts: 5 });
  (api as jest.Mock).mockResolvedValue({});
});

it("keeps waiting, without parking, while the phone gets no answer at all", async () => {
  (api as jest.Mock).mockRejectedValue(new TypeError("Network request failed"));
  useOutbox.getState().enqueue({ path: "/offline", label: "Count" });
  await jest.advanceTimersByTimeAsync(300_000);
  expect(useOutbox.getState().entries[0].status).not.toBe("failed");
  (api as jest.Mock).mockResolvedValue({});
});

// F-882: the client answers 503 when the sign-in refresh got no answer. That
// is the phone being offline, not the house failing: it must not park.
it("keeps waiting, without parking, while the sign-in refresh gets no answer", async () => {
  const { ApiError } = jest.requireMock("@/api/client");
  const noAnswer = Object.assign(new ApiError("Could not reach Mudavym."), {
    status: 503,
    body: { reason: "refresh_not_reached" },
  });
  (api as jest.Mock).mockRejectedValue(noAnswer);
  useOutbox.getState().enqueue({ path: "/orders/one/receive", label: "Receipt" });
  await jest.advanceTimersByTimeAsync(300_000);
  expect((api as jest.Mock).mock.calls.length).toBeGreaterThan(5);
  expect(useOutbox.getState().entries[0]).toMatchObject({ status: "pending", serverAttempts: 0 });
  (api as jest.Mock).mockResolvedValue({});
});

describe("a receipt refused for its price keeps its count (F-806)", () => {
  // clearAllMocks keeps unconsumed once-values; start each case clean.
  beforeEach(() => (api as jest.Mock).mockReset().mockResolvedValue({}));
  // The mocked ApiError takes no arguments; the dispatcher reads `.status`.
  const refusal = (message: string) =>
    Object.assign(new (jest.requireMock("@/api/client").ApiError)(message), {
      status: 403,
    });
  const path = "/procurement/orders/o1/verify-receipt";
  const pricedBody = {
    countedUom: "bottle",
    acceptedQuantityInCountedUom: 12,
    invoiceUnitPrice: 9.5,
    invoiceCurrency: "USD",
  };

  it("re-sends a refused priced receipt once with the count alone", async () => {
    (api as jest.Mock)
      .mockRejectedValueOnce(refusal("owner's or a manager's act"))
      .mockResolvedValueOnce({});
    useOutbox.getState().enqueue({ path, body: pricedBody, label: "Receipt" });
    await jest.advanceTimersByTimeAsync(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(api).toHaveBeenCalledTimes(2);
    expect((api as jest.Mock).mock.calls[1][1].body).toEqual({
      countedUom: "bottle",
      acceptedQuantityInCountedUom: 12,
    });
    expect(useOutbox.getState().entries).toEqual([]);
  });

  it("parks with a sentence naming it when the count alone is refused too", async () => {
    (api as jest.Mock)
      .mockRejectedValueOnce(refusal("money"))
      .mockRejectedValueOnce(refusal("Not your house."));
    useOutbox.getState().enqueue({ path, body: pricedBody, label: "Receipt" });
    await jest.advanceTimersByTimeAsync(1);
    await jest.advanceTimersByTimeAsync(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(api).toHaveBeenCalledTimes(2);
    expect(useOutbox.getState().entries[0]).toMatchObject({
      status: "failed",
      moneyStripped: true,
      lastError:
        "This count was sent again without the invoice price and was still refused. Not your house.",
    });
  });

  it("parks a refused receipt that carried no price as before", async () => {
    (api as jest.Mock).mockRejectedValueOnce(refusal("Not your house."));
    useOutbox.getState().enqueue({
      path,
      body: { acceptedQuantityInCountedUom: 12 },
      label: "Receipt",
    });
    await jest.advanceTimersByTimeAsync(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(api).toHaveBeenCalledTimes(1);
    expect(useOutbox.getState().entries[0]).toMatchObject({
      status: "failed",
      lastError: "Not your house.",
    });
  });
});

// F-337: "Session expired" parked the action as failed, and sign-in resumed
// only pending entries, so the receiver had to find it and press retry.
it("keeps an action that met 'sign in again' and sends it after sign-in", async () => {
  const { ApiError } = jest.requireMock("@/api/client");
  (api as jest.Mock).mockImplementationOnce(async () => {
    useSession.setState({ status: "signedOut" });
    throw Object.assign(new ApiError("Session expired. Sign in again."), {
      status: 401,
    });
  });
  useOutbox
    .getState()
    .enqueue({ path: "/orders/one/receive", label: "Receipt" });
  await jest.advanceTimersByTimeAsync(1);
  expect(api).toHaveBeenCalledTimes(1);
  expect(useOutbox.getState().entries[0]).toMatchObject({ status: "pending" });

  useSession.setState({ status: "signedIn" });
  await jest.advanceTimersByTimeAsync(1);
  expect(api).toHaveBeenCalledTimes(2);
  expect(useOutbox.getState().entries).toHaveLength(0);
});

it("still parks a refusal the server meant (a 4xx other than 401 and 429)", async () => {
  const { ApiError } = jest.requireMock("@/api/client");
  (api as jest.Mock).mockRejectedValueOnce(
    Object.assign(new ApiError("Not allowed"), { status: 403 }),
  );
  useOutbox.getState().enqueue({ path: "/x", label: "X" });
  await jest.advanceTimersByTimeAsync(1);
  expect(useOutbox.getState().entries[0]).toMatchObject({ status: "failed" });
});

// F-950: the gateway's "still being saved from your last try" is not a no.
it("waits, without parking, while the same key is still running on the server", async () => {
  const { ApiError } = jest.requireMock("@/api/client");
  const stillRunning = Object.assign(
    new ApiError("This is still being saved from your last try."),
    { status: 409, body: { reason: "still_running" } },
  );
  (api as jest.Mock)
    .mockReset()
    .mockRejectedValueOnce(stillRunning)
    .mockRejectedValueOnce(stillRunning)
    .mockResolvedValue({});
  useOutbox.getState().enqueue({ path: "/procurement/orders/o1/verify-receipt", label: "Receipt" });
  await jest.advanceTimersByTimeAsync(1);
  expect(useOutbox.getState().entries[0].status).toBe("pending");
  expect(useOutbox.getState().entries[0].serverAttempts ?? 0).toBe(0);
  await jest.advanceTimersByTimeAsync(10_000);
  expect(api).toHaveBeenCalledTimes(3);
  expect(new Set((api as jest.Mock).mock.calls.map((c) => c[1].idempotencyKey)).size).toBe(1);
  expect(useOutbox.getState().entries).toEqual([]);
});

describe("a manager's price the house refuses keeps the count and says why (F-949)", () => {
  beforeEach(() => (api as jest.Mock).mockReset().mockResolvedValue({}));
  const path = "/procurement/orders/o1/verify-receipt";
  const pricedBody = {
    countedUom: "bottle",
    acceptedQuantityInCountedUom: 12,
    invoiceUnitPrice: 1250,
    invoiceCurrency: "TRY",
  };
  const refused = (status: number, message: string) =>
    Object.assign(new (jest.requireMock("@/api/client").ApiError)(message), { status });

  it.each([
    [409, "The unit price was NOT accepted, because the money on invoice 7 is not filed under any currency."],
    [400, "TRL is three letters but names no currency, so nothing was recorded."],
  ])("a %i on the price sends the count alone once and keeps the sentence", async (status, message) => {
    (api as jest.Mock).mockRejectedValueOnce(refused(status, message)).mockResolvedValueOnce({});
    useOutbox.getState().enqueue({ path, body: pricedBody, label: "Receipt", feedItemId: "card-1" });
    await jest.advanceTimersByTimeAsync(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(api).toHaveBeenCalledTimes(2);
    expect((api as jest.Mock).mock.calls[1][1].body).toEqual({
      countedUom: "bottle",
      acceptedQuantityInCountedUom: 12,
    });
    // Done, dismiss-only (no Try again), with the house's reason kept.
    expect(useOutbox.getState().entries).toEqual([
      expect.objectContaining({
        status: "failed",
        alreadyDone: true,
        priceRefused: message,
        lastError: `The count was saved without the price. ${message}`,
      }),
    ]);
    // Nothing more is sent on its own.
    await jest.advanceTimersByTimeAsync(60_000);
    expect(api).toHaveBeenCalledTimes(2);
  });
});

it("keeps a card hidden while its action waits, also after a restart (F-951)", () => {
  const entries = [
    { id: "a", actorUserId: "alice", restaurantId: "r1", status: "pending", feedItemId: "card-1" },
    { id: "b", actorUserId: "alice", restaurantId: "r1", status: "holding", feedItemId: "card-2" },
    { id: "c", actorUserId: "alice", restaurantId: "r1", status: "failed", feedItemId: "card-3" },
    { id: "d", actorUserId: "bob", restaurantId: "r1", status: "pending", feedItemId: "card-4" },
    { id: "e", actorUserId: "alice", restaurantId: "r1", status: "pending" },
  ] as any;
  expect([...waitingFeedItems(entries, { id: "alice" })].sort()).toEqual(["card-1", "card-2"]);
  expect(waitingFeedItems(entries, null).size).toBe(0);
});

it("counts what signing out leaves on this phone and says so (F-952)", () => {
  const entries = [
    { id: "a", actorUserId: "alice", status: "pending" },
    { id: "b", actorUserId: "alice", status: "failed" },
    { id: "c", actorUserId: "alice", status: "failed", alreadyDone: true },
    { id: "d", actorUserId: "bob", status: "pending" },
  ] as any;
  expect(unsentAtSignOut(entries, "alice")).toBe(2);
  expect(unsentAtSignOut(entries, null)).toBe(0);
  expect(signOutWords(0)).toBeNull();
  expect(signOutWords(1)).toBe(
    "1 thing you did has not been sent yet. It stays on this phone and sends only when you sign in here again; nobody else who signs in will see it.",
  );
  expect(signOutWords(2)).toMatch(/^2 things you did have not been sent yet\. They stay/);
});

it("finds this person's waiting entry for one action in this house (F-956, F-951)", () => {
  const path = "/procurement/orders/o1/verify-receipt";
  const entries = [
    { id: "a", actorUserId: "alice", restaurantId: "r1", status: "failed", path },
    { id: "b", actorUserId: "bob", restaurantId: "r1", status: "pending", path },
    { id: "c", actorUserId: "alice", restaurantId: "r2", status: "pending", path },
    { id: "d", actorUserId: "alice", restaurantId: "r1", status: "pending", path: "/procurement/orders/o2/verify-receipt" },
  ] as any;
  const alice = { id: "alice", restaurantId: "r1" };
  // Refused, another person's, another house's, another order's: none waits here.
  expect(waitingFor(entries, alice, path)).toBeNull();
  for (const status of ["holding", "pending", "inflight"]) {
    const waiting = [...entries, { id: "e", actorUserId: "alice", restaurantId: "r1", status, path }];
    expect(waitingFor(waiting, alice, path)?.id).toBe("e");
  }
  expect(waitingFor(entries, null, path)).toBeNull();
});

it("a Today card knows its order's count already waits on this phone (F-980)", () => {
  const receipt = "/procurement/orders/order-1/verify-receipt";
  const alice = { id: "alice", restaurantId: "r1" };
  const entry = (over: Record<string, unknown>) =>
    ({ id: "e", actorUserId: "alice", restaurantId: "r1", status: "pending", path: receipt, ...over }) as any;
  for (const status of ["holding", "pending", "inflight"]) {
    expect(receiptWaitingFor({ orderId: "order-1" }, [entry({ status })], alice)).toBe(true);
  }
  // Refused, another person's, another house's, another order's, another action: the tap goes through.
  const others = [
    entry({ status: "failed" }),
    entry({ actorUserId: "bob" }),
    entry({ restaurantId: "r2" }),
    entry({ path: "/procurement/orders/order-2/verify-receipt" }),
    entry({ path: "/procurement/orders/order-1/deliver" }),
  ];
  expect(receiptWaitingFor({ orderId: "order-1" }, others, alice)).toBe(false);
  expect(receiptWaitingFor({ orderId: null }, [entry({})], alice)).toBe(false);
  expect(receiptWaitingFor({ orderId: "order-1" }, [entry({})], null)).toBe(false);
});
