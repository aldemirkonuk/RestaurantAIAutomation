jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@/config", () => ({ API_URL: "https://example.invalid/api" }));
jest.mock("@/lib/queryClient", () => ({ clearPersistedQueries: jest.fn() }));
import * as SecureStore from "expo-secure-store";
import { api, ApiError } from "../client";
import { useSession } from "@/state/session";

/**
 * F-336: only a refused refresh token (401 from /auth/refresh) signs the
 * person out. No signal, a 503 ("Nothing was done; try again") or a 429 keeps
 * the sign-in, and the request fails as "try again".
 */

const signedIn = () =>
  useSession.setState({
    generation: 0,
    status: "signedIn",
    accessToken: "old",
    user: { id: "alice", email: "a@example.com", restaurantId: "r1" },
  });

/** The request answers 401; the refresh answers `refresh`. */
function gateway(refresh: () => Promise<unknown>) {
  global.fetch = jest.fn((url: string) =>
    String(url).endsWith("/auth/refresh")
      ? refresh()
      : Promise.resolve({ status: 401, ok: false, json: async () => ({}) }),
  ) as unknown as typeof fetch;
}

beforeEach(() => {
  jest.clearAllMocks();
  (SecureStore.getItemAsync as jest.Mock).mockResolvedValue("refresh-1");
  signedIn();
});

it.each([
  ["no signal", () => Promise.reject(new TypeError("Network request failed"))],
  ["a 503", () => Promise.resolve({ status: 503, ok: false, json: async () => ({}) })],
  ["a 429", () => Promise.resolve({ status: 429, ok: false, json: async () => ({}) })],
])("keeps the sign-in when the refresh meets %s", async (_label, refresh) => {
  gateway(refresh);
  const err: ApiError = await api<ApiError>("/orders").catch((e: ApiError) => e);
  expect(err).toBeInstanceOf(ApiError);
  expect(err.status).toBe(503);
  expect(err.message).toMatch(/still signed in/);
  expect(useSession.getState()).toMatchObject({
    status: "signedIn",
    accessToken: "old",
  });
  expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
});

it("signs out when the refresh token is refused", async () => {
  gateway(() =>
    Promise.resolve({
      status: 401,
      ok: false,
      json: async () => ({ code: "SESSION_ENDED" }),
    }),
  );
  const err: ApiError = await api<ApiError>("/orders").catch((e: ApiError) => e);
  expect(err).toBeInstanceOf(ApiError);
  expect(err.status).toBe(401);
  expect(useSession.getState().status).toBe("signedOut");
  expect(SecureStore.deleteItemAsync).toHaveBeenCalled();
});
