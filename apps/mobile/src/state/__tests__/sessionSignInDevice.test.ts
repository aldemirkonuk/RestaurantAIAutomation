/**
 * The known-device token for the login rate limit (QA round 19, #906): kept
 * after a sign-in, sent back for the same email only, and kept across sign-out.
 */
const mockStore: Record<string, string> = {};
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (k: string) => mockStore[k] ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => {
    mockStore[k] = v;
  }),
  deleteItemAsync: jest.fn(async (k: string) => {
    delete mockStore[k];
  }),
}));
jest.mock("@/config", () => ({ API_URL: "https://example.invalid/api" }));
jest.mock("@/lib/queryClient", () => ({ clearPersistedQueries: jest.fn() }));
import { useSession } from "../session";

const KEY = "mudavym.signInDevices";
let sent: Array<Record<string, unknown>> = [];

beforeEach(() => {
  for (const k of Object.keys(mockStore)) delete mockStore[k];
  sent = [];
  global.fetch = jest.fn(async (url: string, init?: { body?: string }) => {
    if (String(url).endsWith("/auth/login")) {
      sent.push(JSON.parse(init?.body ?? "{}"));
      return {
        ok: true,
        json: async () => ({ accessToken: "a", refreshToken: "r", signInDevice: "tok-owner" }),
      };
    }
    if (String(url).endsWith("/auth/logout")) return { ok: true };
    return { ok: true, json: async () => ({ id: "u", email: "owner@x.com" }) };
  }) as unknown as typeof fetch;
  useSession.setState({ generation: 0, status: "signedOut", user: null, accessToken: null });
});

it("stores the token, sends it for the same email only, and keeps it after sign-out", async () => {
  await useSession.getState().signIn(" Owner@X.com", "pw");
  expect(sent[0]).not.toHaveProperty("signInDevice");
  expect(JSON.parse(mockStore[KEY])).toEqual({ "owner@x.com": "tok-owner" });

  await useSession.getState().signIn("owner@x.com", "pw");
  expect(sent[1]).toMatchObject({ signInDevice: "tok-owner" });

  await useSession.getState().signIn("other@x.com", "pw");
  expect(sent[2]).not.toHaveProperty("signInDevice");

  await useSession.getState().signOut();
  expect(JSON.parse(mockStore[KEY])).toMatchObject({ "owner@x.com": "tok-owner" });
});

it("keeps the newest five", async () => {
  for (let i = 0; i < 7; i++) await useSession.getState().signIn(`u${i}@x.com`, "pw");
  expect(Object.keys(JSON.parse(mockStore[KEY]))).toEqual(
    [2, 3, 4, 5, 6].map((i) => `u${i}@x.com`),
  );
});
