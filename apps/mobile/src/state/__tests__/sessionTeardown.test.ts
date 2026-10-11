jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@/config", () => ({ API_URL: "https://example.invalid/api" }));
jest.mock("@/lib/queryClient", () => ({ clearPersistedQueries: jest.fn() }));
import { clearPersistedQueries } from "@/lib/queryClient";
import { useSession, refreshAccessToken } from "../session";
import { useFeedLocal } from "../feedLocal";
import * as SecureStore from "expo-secure-store";

it("tears down in-memory identity and private persisted queries before secure deletion finishes", async () => {
  useSession.setState({
    status: "signedIn",
    accessToken: "old",
    user: { id: "alice", email: "a@example.com", restaurantId: "r1" },
  });
  global.fetch = jest.fn().mockResolvedValue({ ok: true });
  const logout = useSession.getState().signOut();
  expect(useSession.getState()).toMatchObject({
    status: "signedOut",
    user: null,
    accessToken: null,
  });
  expect(clearPersistedQueries).toHaveBeenCalled();
  await logout;
});

it("does not restore a token from a refresh that finishes after logout", async () => {
  (SecureStore.getItemAsync as jest.Mock).mockResolvedValue("refresh-old");
  let complete!: (response: any) => void;
  global.fetch = jest.fn().mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const pending = refreshAccessToken();
  await Promise.resolve();
  await useSession.getState().signOut();
  complete({ ok: true, json: async () => ({ accessToken: "late-token" }) });
  await expect(pending).resolves.toBeNull();
  expect(useSession.getState().accessToken).toBeNull();
});

// F-1349: a removal is not a sign-out, but the removed house's orders,
// calendar and feed must leave the phone all the same. Their query keys name
// no house, so a refetch that now fails would keep drawing the old rows.
it("forgets the removed house's cached reads and feed state when a refresh says its access ended", async () => {
  (clearPersistedQueries as jest.Mock).mockClear();
  (SecureStore.getItemAsync as jest.Mock).mockResolvedValue("refresh-old");
  useSession.setState({
    status: "signedIn",
    accessToken: "old",
    user: { id: "alice", email: "a@example.com", restaurantId: "r1" },
  });
  useFeedLocal.setState({ hidden: { "feed-1": "entry-1" }, clearedThisSession: 3 });
  const refreshUser = jest.fn(async () => {
    // The re-read comes after the wipe, so it never reads the old house's rows.
    expect(clearPersistedQueries).toHaveBeenCalled();
  });
  useSession.setState({ refreshUser } as never);
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      accessToken: "houseless",
      refreshToken: "refresh-new",
      houseAccessEnded: { restaurantId: "r1" },
    }),
  });

  await expect(refreshAccessToken()).resolves.toBe("houseless");

  expect(clearPersistedQueries).toHaveBeenCalledTimes(1);
  expect(useFeedLocal.getState()).toMatchObject({ hidden: {}, clearedThisSession: 0 });
  expect(refreshUser).toHaveBeenCalledTimes(1);
});
