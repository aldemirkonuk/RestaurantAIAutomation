/**
 * F-404: a cold start after the 15-minute access token lapsed, or with no
 * signal, must still come up with the person's user — before this the
 * session ran a whole shift with `user = null`: every tab empty, every action
 * refused, the outbox never drained.
 */
const store = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => void store.set(k, v)),
  deleteItemAsync: jest.fn(async (k: string) => void store.delete(k)),
}));
jest.mock("@/config", () => ({ API_URL: "https://example.invalid/api" }));
jest.mock("@/lib/queryClient", () => ({ clearPersistedQueries: jest.fn() }));
import { useSession } from "../session";

const ME = { id: "alice", email: "a@example.com", restaurantId: "r1", role: "manager" };
const res = (status: number, body?: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

beforeEach(() => {
  store.clear();
  useSession.setState({ generation: 0, status: "booting", user: null, accessToken: null });
});

it("refreshes a lapsed access token at launch and reads the user again", async () => {
  store.set("wineops_access_token", "stale");
  store.set("wineops_refresh_token", "refresh-1");
  global.fetch = jest.fn(async (url: string, init?: any) => {
    const auth = init?.headers?.Authorization;
    if (url.endsWith("/auth/me")) return auth === "Bearer fresh" ? res(200, ME) : res(401);
    if (url.endsWith("/auth/refresh")) return res(200, { accessToken: "fresh" });
    throw new Error(`unexpected ${url}`);
  }) as unknown as typeof fetch;
  await useSession.getState().hydrate();
  expect(useSession.getState()).toMatchObject({
    status: "locked",
    accessToken: "fresh",
    user: { id: "alice", restaurantId: "r1", role: "manager" },
  });
  expect(store.get("wineops_access_token")).toBe("fresh");
});

it("keeps the last known user when the phone starts with no signal", async () => {
  store.set("wineops_access_token", "a");
  store.set("wineops_refresh_token", "r");
  global.fetch = jest.fn(async () => res(200, ME)) as unknown as typeof fetch;
  await useSession.getState().hydrate();
  expect(JSON.parse(store.get("wineops_session_user")!)).toMatchObject({ id: "alice" });

  // Next launch: no network at all.
  useSession.setState({ generation: 0, status: "booting", user: null, accessToken: null });
  global.fetch = jest.fn(async () => {
    throw new TypeError("Network request failed");
  }) as unknown as typeof fetch;
  await useSession.getState().hydrate();
  expect(useSession.getState().user).toMatchObject({ id: "alice", restaurantId: "r1" });
});

it("forgets the last known user on sign-out", async () => {
  store.set("wineops_session_user", JSON.stringify(ME));
  store.set("wineops_access_token", "a");
  global.fetch = jest.fn(async () => res(200, {})) as unknown as typeof fetch;
  useSession.setState({ status: "signedIn", accessToken: "a", user: ME });
  await useSession.getState().signOut();
  expect(store.has("wineops_session_user")).toBe(false);
});
