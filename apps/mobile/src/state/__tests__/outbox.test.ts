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
  RECEIPT_WAITING_WORDS,
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

it("Try again on a parked receipt is refused while a newer count for that order waits (F-1028)", async () => {
  const path = "/procurement/orders/one/verify-receipt";
  const base = { actorUserId: "alice", restaurantId: "r1", path, method: "POST" as const, label: "Receipt verification", createdAt: 0, holdUntil: Infinity, attempts: 0 };
  useOutbox.setState({
    entries: [
      { ...base, id: "old", status: "failed", body: { acceptedQuantityInCountedUom: 12 } },
      { ...base, id: "new", status: "holding", body: { adjustments: [] } },
    ],
  });
  expect(useOutbox.getState().retryFailed("old")).toBe(RECEIPT_WAITING_WORDS);
  await jest.advanceTimersByTimeAsync(1);
  expect(api).not.toHaveBeenCalled();
  expect(useOutbox.getState().entries.map((e) => [e.id, e.status])).toEqual([
    ["old", "failed"],
    ["new", "holding"],
  ]);
  // Once the newer count is gone, the parked one may be sent again.
  useOutbox.getState().undo("new");
  expect(useOutbox.getState().retryFailed("old")).toBeNull();
  expect(useOutbox.getState().entries[0].status).toBe("pending");
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

  it("re-sends a staff receipt refused for its billed quantity with the count alone (F-1180)", async () => {
    (api as jest.Mock)
      .mockRejectedValueOnce(refusal("Recording the invoice quantity is an owner's or a manager's job"))
      .mockResolvedValueOnce({});
    useOutbox.getState().enqueue({
      path,
      body: { countedUom: "bottle", acceptedQuantityInCountedUom: 12, invoiceQuantityInInvoiceUom: 12 },
      label: "Receipt",
    });
    await jest.advanceTimersByTimeAsync(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(api).toHaveBeenCalledTimes(2);
    expect((api as jest.Mock).mock.calls[1][1].body).toEqual({
      countedUom: "bottle",
      acceptedQuantityInCountedUom: 12,
    });
    expect(useOutbox.getState().entries).toEqual([]);
  });

  it("Try again sends a parked staff receipt without its money, never the same body (F-1180)", async () => {
    useSession.setState({
      status: "signedIn",
      user: { id: "alice", email: "a@example.com", restaurantId: "r1", role: "staff" },
    });
    const base = { actorUserId: "alice", restaurantId: "r1", path, method: "POST" as const, label: "Receipt", createdAt: 0, holdUntil: 0, attempts: 0, status: "failed" as const };
    useOutbox.setState({
      entries: [
        // Parked before F-1180: stripped of its price, refused for the billed quantity.
        { ...base, id: "a", moneyStripped: true, body: { acceptedQuantityInCountedUom: 12, invoiceQuantityInInvoiceUom: 12 } },
      ],
    });
    useOutbox.getState().retryFailed("a");
    await jest.advanceTimersByTimeAsync(1);
    expect((api as jest.Mock).mock.calls[0][1].body).toEqual({ acceptedQuantityInCountedUom: 12 });
    useOutbox.setState({
      entries: [
        // Parked before F-1180 with no price, so it was never stripped.
        { ...base, id: "b", body: { acceptedQuantityInCountedUom: 7, invoiceQuantityInInvoiceUom: 8, invoiceUnitPrice: 3 } },
      ],
    });
    useOutbox.getState().retryFailed("b");
    await jest.advanceTimersByTimeAsync(1);
    expect((api as jest.Mock).mock.calls[1][1].body).toEqual({ acceptedQuantityInCountedUom: 7 });
    expect(api).toHaveBeenCalledTimes(2);
  });

  it("Try again keeps a manager's figures as they were", async () => {
    useSession.setState({
      status: "signedIn",
      user: { id: "alice", email: "a@example.com", restaurantId: "r1", role: "manager" },
    });
    const body = { acceptedQuantityInCountedUom: 7, invoiceQuantityInInvoiceUom: 8, invoiceUnitPrice: 3, invoiceCurrency: "USD" };
    useOutbox.setState({
      entries: [
        { id: "m", actorUserId: "alice", restaurantId: "r1", path, method: "POST", label: "Receipt", createdAt: 0, holdUntil: 0, attempts: 0, status: "failed", body },
      ],
    });
    useOutbox.getState().retryFailed("m");
    await jest.advanceTimersByTimeAsync(1);
    expect((api as jest.Mock).mock.calls[0][1].body).toEqual(body);
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
    invoiceQuantityInInvoiceUom: 12,
    invoiceUnitPrice: 1250,
    invoiceCurrency: "TRY",
  };
  const refused = (status: number, message: string, body?: unknown) =>
    Object.assign(new (jest.requireMock("@/api/client").ApiError)(message), { status, body });
  const held = "The unit price was NOT accepted, because the money on invoice 7 is not filed under any currency.";
  const badCode = "TRL is three letters but names no currency, so nothing was recorded.";

  it.each([
    [409, held, { reason: "receipt_price_refused", message: held }],
    [400, badCode, { statusCode: 400, message: [badCode], error: "Bad Request" }],
  ])("a %i on the price sends the count alone once and keeps the sentence", async (status, message, body) => {
    (api as jest.Mock).mockRejectedValueOnce(refused(status, message, body)).mockResolvedValueOnce({});
    useOutbox.getState().enqueue({ path, body: pricedBody, label: "Receipt", feedItemId: "card-1" });
    await jest.advanceTimersByTimeAsync(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(api).toHaveBeenCalledTimes(2);
    // Only the price was refused: what the paper billed goes with the count.
    expect((api as jest.Mock).mock.calls[1][1].body).toEqual({
      countedUom: "bottle",
      acceptedQuantityInCountedUom: 12,
      invoiceQuantityInInvoiceUom: 12,
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

  // F-1025: a 400 or 409 that is not about the price keeps the price and parks.
  const meanwhile = "Someone else checked this delivery at the same moment, so this check was not written over theirs.";
  const scope = "The active account or branch changed. Review this action in its original branch.";
  const unit = "unitPrice must not be less than 0";
  it.each([
    [409, meanwhile, { reason: "receipt_checked_meanwhile", message: meanwhile }],
    [409, scope, undefined],
    [400, unit, { statusCode: 400, message: [unit, badCode], error: "Bad Request" }],
  ])("a %i not about the price parks with the price kept and is not sent again", async (status, message, body) => {
    (api as jest.Mock).mockRejectedValueOnce(refused(status, message, body));
    useOutbox.getState().enqueue({ path, body: pricedBody, label: "Receipt" });
    await jest.advanceTimersByTimeAsync(1);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(api).toHaveBeenCalledTimes(1);
    const [entry] = useOutbox.getState().entries;
    expect(entry).toMatchObject({ status: "failed", body: pricedBody, lastError: message });
    expect(entry.priceRefused).toBeUndefined();
    expect(entry.alreadyDone).toBeFalsy();
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

it("finds a waiting delivery mark that carries its count in the query (F-1182)", () => {
  const deliver = "/procurement/orders/o1/deliver";
  const entries = [
    { id: "a", actorUserId: "alice", restaurantId: "r1", status: "pending", path: `${deliver}?quantityReceivedInOrderUom=4` },
  ] as any;
  expect(waitingFor(entries, { id: "alice", restaurantId: "r1" }, deliver)?.id).toBe("a");
  expect(waitingFor(entries, { id: "alice", restaurantId: "r1" }, "/procurement/orders/o2/deliver")).toBeNull();
});

it("keeps a card hidden while its refused receipt is shown on Today (F-1028)", () => {
  const receipt = "/procurement/orders/o1/verify-receipt";
  const entries = [
    // Shown on Today with Try again: its card stays away.
    { id: "a", actorUserId: "alice", restaurantId: "r1", status: "failed", path: receipt, feedItemId: "card-1" },
    // Another house's refused receipt is not shown here: no reason to hold.
    { id: "b", actorUserId: "alice", restaurantId: "r2", status: "failed", path: receipt, feedItemId: "card-2" },
    // A refused action that is not a receipt still brings its card back.
    { id: "c", actorUserId: "alice", restaurantId: "r1", status: "failed", path: "/procurement/orders/o3/approve", feedItemId: "card-3" },
    // Somebody else's refusal.
    { id: "d", actorUserId: "bob", restaurantId: "r1", status: "failed", path: receipt, feedItemId: "card-4" },
  ] as any;
  expect([...waitingFeedItems(entries, { id: "alice", restaurantId: "r1" })]).toEqual(["card-1"]);
  // Dismissing the row gives the card back.
  expect(waitingFeedItems(entries.slice(1), { id: "alice", restaurantId: "r1" }).size).toBe(0);
});

it("counts what signing out leaves on this phone and says so (F-952, F-1026)", () => {
  const entries = [
    { id: "a", actorUserId: "alice", restaurantId: "r1", status: "pending" },
    { id: "b", actorUserId: "alice", restaurantId: "r1", status: "failed" },
    { id: "c", actorUserId: "alice", restaurantId: "r1", status: "failed", alreadyDone: true },
    { id: "d", actorUserId: "bob", restaurantId: "r1", status: "pending" },
    { id: "e", actorUserId: "alice", restaurantId: "r2", status: "holding" },
  ] as any;
  const alice = { id: "alice", restaurantId: "r1" };
  expect(unsentAtSignOut(entries, alice)).toEqual({ here: 1, otherHouses: 1, refused: 1 });
  expect(unsentAtSignOut(entries, null)).toEqual({ here: 0, otherHouses: 0, refused: 0 });
  expect(signOutWords({ here: 0, otherHouses: 0, refused: 0 })).toBeNull();
  expect(signOutWords({ here: 1, otherHouses: 0, refused: 0 })).toBe(
    "1 thing you did has not been sent yet. It stays on this phone and sends only when you sign in here again. Nobody else who signs in will see any of it.",
  );
  expect(signOutWords({ here: 2, otherHouses: 0, refused: 0 })).toMatch(/^2 things you did have not been sent yet\. They stay/);
  // A refused entry is never promised a send.
  expect(signOutWords({ here: 0, otherHouses: 0, refused: 1 })).toBe(
    "1 thing the house refused waits on this phone for you to look at; it does not send on its own. Nobody else who signs in will see any of it.",
  );
  expect(signOutWords({ here: 0, otherHouses: 1, refused: 0 })).toMatch(
    /sign in here again\. It is for another of your houses and sends once you open that house\./,
  );
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
