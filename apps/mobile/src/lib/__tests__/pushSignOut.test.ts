/**
 * F-406: the push device must be unregistered on every sign-out and on Push
 * off, also after a restart — when nothing in memory remembers the token.
 * Each test loads push.ts fresh, which is what a restart is.
 */
jest.mock("react-native", () => ({ Platform: { OS: "ios" } }));
jest.mock("expo-notifications", () => ({
  setNotificationHandler: jest.fn(),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: "ExponentPushToken[abc]" })),
  getPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  requestPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
}));
jest.mock("expo-device", () => ({ isDevice: true }));
jest.mock("expo-constants", () => ({ __esModule: true, default: {} }));
jest.mock("@/api/queries", () => ({ feedKey: ["feed"], pulseKey: ["pulse"] }));
jest.mock("@/design/tokens", () => ({ color: {} }));
jest.mock("@/lib/notificationRoute", () => ({ routeForNotificationData: () => "/" }));
jest.mock("@/lib/queryClient", () => ({
  clearPersistedQueries: jest.fn(),
  queryClient: { invalidateQueries: jest.fn() },
}));
jest.mock("@/config", () => ({ API_URL: "https://example.invalid/api" }));
const store = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => void store.set(k, v)),
  deleteItemAsync: jest.fn(async (k: string) => void store.delete(k)),
}));

const DEVICE = "https://example.invalid/api/mobile/devices/ExponentPushToken%5Babc%5D";
type Call = { url: string; method?: string; auth?: string };
let calls: Call[];

function load() {
  let mod!: { session: typeof import("@/state/session"); push: typeof import("../push") };
  jest.isolateModules(() => {
    mod = { session: require("@/state/session"), push: require("../push") };
  });
  return mod;
}

async function settle() {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

beforeEach(() => {
  store.clear();
  calls = [];
});

function serve(live: Set<string>) {
  global.fetch = jest.fn(async (url: string, init?: any) => {
    const auth = init?.headers?.Authorization;
    calls.push({ url, method: init?.method, auth });
    if (url.endsWith("/auth/refresh")) {
      return { ok: true, status: 200, json: async () => ({ accessToken: "fresh" }) };
    }
    const ok = auth && live.has(auth.slice(7));
    return { ok, status: ok ? 204 : 401, json: async () => ({}) };
  }) as unknown as typeof fetch;
}

it("signing out after a restart unregisters the device, before logging out", async () => {
  const { session } = load();
  serve(new Set(["a1"]));
  session.useSession.setState({
    status: "signedIn",
    accessToken: "a1",
    user: { id: "alice", email: "a@example.com", restaurantId: "r1" },
  });
  await session.useSession.getState().signOut();
  await settle();
  const del = calls.findIndex((c) => c.url === DEVICE && c.method === "DELETE");
  const logout = calls.findIndex((c) => c.url.endsWith("/auth/logout"));
  expect(calls[del]).toMatchObject({ auth: "Bearer a1" });
  expect(logout).toBeGreaterThan(del);
});

it("a lapsed access token is refreshed once so the unregister still lands", async () => {
  const { session } = load();
  serve(new Set(["fresh"]));
  store.set("wineops_refresh_token", "r1");
  session.useSession.setState({
    status: "signedIn",
    accessToken: "lapsed",
    user: { id: "alice", email: "a@example.com", restaurantId: "r1" },
  });
  await session.useSession.getState().signOut();
  await settle();
  expect(calls.filter((c) => c.url === DEVICE).map((c) => c.auth)).toEqual([
    "Bearer lapsed",
    "Bearer fresh",
  ]);
  expect(calls.find((c) => c.url.endsWith("/auth/logout"))).toMatchObject({
    auth: "Bearer fresh",
  });
});

it("Push off after a restart unregisters the device", async () => {
  const { session, push } = load();
  serve(new Set(["a1"]));
  session.useSession.setState({
    status: "signedIn",
    accessToken: "a1",
    user: { id: "alice", email: "a@example.com", restaurantId: "r1" },
  });
  await push.unregisterPush();
  expect(calls).toContainEqual(
    expect.objectContaining({ url: DEVICE, method: "DELETE", auth: "Bearer a1" }),
  );
});

/** F-801: a sign-in brings the push device back when the saved setting is on. */
function serveSignIn(push: boolean | undefined) {
  global.fetch = jest.fn(async (url: string, init?: any) => {
    calls.push({ url, method: init?.method, auth: init?.headers?.Authorization });
    const json = url.endsWith("/auth/login")
      ? { accessToken: "a1", refreshToken: "r1" }
      : url.endsWith("/auth/me")
        ? { id: "alice", email: "a@example.com", restaurantId: "r1" }
        : url.endsWith("/users/alice/preferences")
          ? { preferences: push === undefined ? {} : { servicePermissions: { push } } }
          : {};
    return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) };
  }) as unknown as typeof fetch;
}
const REGISTER = "https://example.invalid/api/mobile/devices";

it("signing in registers the device again when Push is on (F-801)", async () => {
  const { session } = load();
  serveSignIn(true);
  await session.useSession.getState().signIn("a@example.com", "pw");
  await settle();
  expect(calls).toContainEqual(
    expect.objectContaining({ url: REGISTER, method: "POST", auth: "Bearer a1" }),
  );
  const notifications = jest.requireMock("expo-notifications");
  expect(notifications.requestPermissionsAsync).not.toHaveBeenCalled();
});

it("signing in leaves the device alone when Push is off or never set (F-801)", async () => {
  for (const push of [false, undefined]) {
    const { session } = load();
    calls = [];
    serveSignIn(push);
    await session.useSession.getState().signIn("a@example.com", "pw");
    await settle();
    expect(calls.some((c) => c.url.endsWith("/users/alice/preferences"))).toBe(true);
    expect(calls.some((c) => c.url === REGISTER)).toBe(false);
  }
});
