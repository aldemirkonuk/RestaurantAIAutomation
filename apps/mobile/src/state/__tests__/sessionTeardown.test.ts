jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@/config", () => ({ API_URL: "https://example.invalid/api" }));
jest.mock("@/lib/queryClient", () => ({ clearPersistedQueries: jest.fn() }));
import { clearPersistedQueries } from "@/lib/queryClient";
import { useSession, refreshAccessToken } from "../session";
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
