jest.mock("@/config", () => ({ API_URL: "https://example.invalid/api" }));
jest.mock("@/state/session", () => {
  // jest.mock factories are hoisted above imports, so the module is required here.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { create } = require("zustand");
  return {
    useSession: create(() => ({
      generation: 0,
      status: "signedIn",
      accessToken: "alice-token",
      user: { id: "alice", restaurantId: "r1" },
      signOut: jest.fn(),
    })),
    refreshAccessToken: jest.fn(),
  };
});
import { api } from "../client";
import { useSession, refreshAccessToken } from "@/state/session";

it("does not retry an old account's mutation with a new account's refreshed token", async () => {
  global.fetch = jest.fn().mockResolvedValue({ status: 401, ok: false });
  (refreshAccessToken as jest.Mock).mockImplementation(async () => {
    useSession.setState({
      generation: 1,
      accessToken: "bob-token",
      user: { id: "bob", email: "b@example.com", restaurantId: "r2" },
    });
    return "bob-token";
  });
  await expect(
    api("/action", {
      method: "POST",
      scope: { userId: "alice", restaurantId: "r1" },
    }),
  ).rejects.toThrow(/active account or branch changed/);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(useSession.getState().signOut).not.toHaveBeenCalled();
});

it("does not return private query data after a logout or account transition", async () => {
  let complete!: (response: any) => void;
  global.fetch = jest.fn().mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const request = api("/private-data");
  useSession.setState({
    generation: useSession.getState().generation + 1,
    status: "signedOut",
    user: null,
    accessToken: null,
  });
  complete({ status: 200, ok: true, json: async () => ({ private: true }) });
  await expect(request).rejects.toThrow(/active account or branch changed/);
});
