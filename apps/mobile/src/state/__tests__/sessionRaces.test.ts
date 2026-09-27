/**
 * A sign-out must win against every request that was in flight when it was
 * pressed: the in-memory session stays signed out AND no token is left in
 * SecureStore for the next launch to find (audit of PR #436, 2026-09-27).
 */
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@/config", () => ({ API_URL: "https://example.invalid/api" }));
jest.mock("@/lib/queryClient", () => ({ clearPersistedQueries: jest.fn() }));
import * as SecureStore from "expo-secure-store";
import { useSession } from "../session";

const ACCESS_KEY = "wineops_access_token";
const REFRESH_KEY = "wineops_refresh_token";

/** The SecureStore contents after replaying every set/delete in call order. */
function storedTokens(): Record<string, string> {
  const ops: Array<[string, string, string | undefined, number]> = [];
  (SecureStore.setItemAsync as jest.Mock).mock.calls.forEach((c, i) =>
    ops.push(["set", c[0], c[1], (SecureStore.setItemAsync as jest.Mock).mock.invocationCallOrder[i]]),
  );
  (SecureStore.deleteItemAsync as jest.Mock).mock.calls.forEach((c, i) =>
    ops.push(["del", c[0], undefined, (SecureStore.deleteItemAsync as jest.Mock).mock.invocationCallOrder[i]]),
  );
  ops.sort((a, b) => a[3] - b[3]);
  const store: Record<string, string> = {};
  for (const [op, key, value] of ops) {
    if (key !== ACCESS_KEY && key !== REFRESH_KEY) continue;
    if (op === "set") store[key] = value as string;
    else delete store[key];
  }
  return store;
}

type Pending = { url: string; resolve: (r: unknown) => void };
let pending: Pending[] = [];

function json(body: unknown) {
  return { ok: true, json: async () => body };
}

async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

beforeEach(() => {
  jest.clearAllMocks();
  pending = [];
  global.fetch = jest.fn().mockImplementation(
    (url: string) =>
      new Promise((resolve) => {
        if (String(url).endsWith("/auth/logout")) return resolve({ ok: true });
        pending.push({ url: String(url), resolve });
      }),
  ) as unknown as typeof fetch;
  useSession.setState({
    generation: 0,
    status: "signedOut",
    user: null,
    accessToken: null,
  });
});

function answer(suffix: string, body: unknown) {
  const i = pending.findIndex((p) => p.url.endsWith(suffix));
  if (i < 0) throw new Error(`no pending request for ${suffix}`);
  const [p] = pending.splice(i, 1);
  p.resolve(json(body));
}

it("a sign-in whose login answer lands after sign-out persists nothing", async () => {
  const signingIn = useSession.getState().signIn("a@example.com", "pw");
  await flush();
  await useSession.getState().signOut();
  answer("/auth/login", { accessToken: "late-access", refreshToken: "late-refresh" });
  await flush();
  if (pending.some((p) => p.url.endsWith("/auth/me"))) {
    answer("/auth/me", { id: "alice", email: "a@example.com" });
  }
  await signingIn;
  expect(useSession.getState()).toMatchObject({ status: "signedOut", accessToken: null });
  expect(storedTokens()).toEqual({});
});

it("a sign-out during a sign-in's profile read deletes the tokens it had written", async () => {
  const signingIn = useSession.getState().signIn("a@example.com", "pw");
  await flush();
  answer("/auth/login", { accessToken: "access-1", refreshToken: "refresh-1" });
  await flush();
  expect(storedTokens()).toEqual({ [ACCESS_KEY]: "access-1", [REFRESH_KEY]: "refresh-1" });
  await useSession.getState().signOut();
  answer("/auth/me", { id: "alice", email: "a@example.com" });
  await signingIn;
  expect(useSession.getState()).toMatchObject({ status: "signedOut", accessToken: null });
  expect(storedTokens()).toEqual({});
});

it("a house switch that answers after sign-out does not bring the session back", async () => {
  useSession.setState({
    generation: 3,
    status: "signedIn",
    accessToken: "house-a",
    user: { id: "alice", email: "a@example.com", restaurantId: "a" },
  });
  const switching = useSession.getState().chooseHouse("b");
  await flush();
  await useSession.getState().signOut();
  answer("/auth/switch-restaurant", {
    accessToken: "house-b",
    refreshToken: "house-b-refresh",
    restaurantId: "b",
  });
  await expect(switching).resolves.toBe(false);
  await flush();
  expect(pending.filter((p) => p.url.endsWith("/auth/me"))).toHaveLength(0);
  expect(useSession.getState()).toMatchObject({ status: "signedOut", accessToken: null, user: null });
  expect(storedTokens()).toEqual({});
});

it("a house switch with no sign-out still lands in the new house", async () => {
  useSession.setState({
    generation: 3,
    status: "signedIn",
    accessToken: "house-a",
    user: { id: "alice", email: "a@example.com", restaurantId: "a" },
  });
  const switching = useSession.getState().chooseHouse("b");
  await flush();
  answer("/auth/switch-restaurant", {
    accessToken: "house-b",
    refreshToken: "house-b-refresh",
    restaurantId: "b",
  });
  await flush();
  answer("/auth/me", { id: "alice", email: "a@example.com", restaurantId: "b" });
  await expect(switching).resolves.toBe(true);
  expect(useSession.getState()).toMatchObject({ status: "signedIn", accessToken: "house-b" });
  expect(storedTokens()).toEqual({ [ACCESS_KEY]: "house-b", [REFRESH_KEY]: "house-b-refresh" });
});

it("a sign-out pressed while a token write is still in flight deletes after that write lands", async () => {
  // SecureStore modelled by completion order: a set lands when it resolves,
  // a delete lands at once. Without one queue for both, the delete would land
  // first and the slow write would leave the token behind.
  const store: Record<string, string> = {};
  const slowWrites: Array<() => void> = [];
  (SecureStore.setItemAsync as jest.Mock).mockImplementation(
    (key: string, value: string) =>
      new Promise<void>((resolve) => {
        slowWrites.push(() => {
          store[key] = value;
          resolve();
        });
      }),
  );
  (SecureStore.deleteItemAsync as jest.Mock).mockImplementation(async (key: string) => {
    delete store[key];
  });
  const signingIn = useSession.getState().signIn("a@example.com", "pw");
  await flush();
  answer("/auth/login", { accessToken: "access-1", refreshToken: "refresh-1" });
  await flush();
  expect(slowWrites).toHaveLength(2);
  const signingOut = useSession.getState().signOut();
  await flush();
  slowWrites.splice(0).forEach((land) => land());
  await signingOut;
  await flush();
  if (pending.some((p) => p.url.endsWith("/auth/me"))) {
    answer("/auth/me", { id: "alice", email: "a@example.com" });
  }
  await signingIn;
  (SecureStore.setItemAsync as jest.Mock).mockResolvedValue(undefined);
  (SecureStore.deleteItemAsync as jest.Mock).mockResolvedValue(undefined);
  expect(store[ACCESS_KEY]).toBeUndefined();
  expect(store[REFRESH_KEY]).toBeUndefined();
  expect(useSession.getState().status).toBe("signedOut");
});
