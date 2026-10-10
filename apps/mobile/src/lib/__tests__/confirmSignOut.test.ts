jest.mock("react-native", () => ({ Alert: { alert: jest.fn() } }));
jest.mock("@/state/session", () => {
  // jest.mock factories are hoisted above imports, so the module is required here.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { create } = require("zustand");
  return {
    useSession: create(() => ({
      status: "signedIn",
      user: { id: "alice", restaurantId: "r1" },
    })),
  };
});
jest.mock("@/design/motion", () => ({ GRACE_MS: 8000 }));
jest.mock("@/api/client", () => ({ api: jest.fn(), ApiError: class ApiError extends Error {} }));
jest.mock("@/lib/queryClient", () => ({ queryClient: { invalidateQueries: jest.fn() } }));
jest.mock("@/lib/mmkv", () => ({
  outboxStorage: { getString: () => undefined, set: () => undefined, delete: () => undefined },
}));
import { Alert } from "react-native";
import { confirmSignOut } from "../confirmSignOut";
import { useOutbox } from "@/state/outbox";
import { useSession } from "@/state/session";

beforeEach(() => jest.clearAllMocks());

// F-952: a shared door phone signed out mid-shift kept the receipt for that
// one person, with no word to them.
it("signs straight out when nothing of the person's waits", () => {
  const signOut = jest.fn();
  useOutbox.setState({ entries: [{ id: "b", actorUserId: "bob", status: "pending" }] as any });
  confirmSignOut(signOut);
  expect(signOut).toHaveBeenCalled();
  expect(Alert.alert).not.toHaveBeenCalled();
});

it("names the waiting work and offers to send it before signing out", () => {
  const signOut = jest.fn();
  const flush = jest.fn();
  useOutbox.setState({ entries: [{ id: "a", actorUserId: "alice", status: "holding", holdUntil: Infinity }] as any, flush });
  confirmSignOut(signOut);
  expect(signOut).not.toHaveBeenCalled();
  const [, words, buttons] = (Alert.alert as jest.Mock).mock.calls[0];
  expect(words).toMatch(/^1 thing you did has not been sent yet/);
  expect(buttons.map((b: { text: string }) => b.text)).toEqual(["Cancel", "Send now", "Sign out anyway"]);
  buttons[1].onPress();
  expect(flush).toHaveBeenCalled();
  expect(signOut).not.toHaveBeenCalled();
  buttons[2].onPress();
  expect(signOut).toHaveBeenCalled();
});

it("does not offer to send from a locked phone", () => {
  useSession.setState({ status: "locked" });
  useOutbox.setState({ entries: [{ id: "a", actorUserId: "alice", status: "failed" }] as any });
  confirmSignOut(jest.fn());
  const [, , buttons] = (Alert.alert as jest.Mock).mock.calls[0];
  expect(buttons.map((b: { text: string }) => b.text)).toEqual(["Cancel", "Sign out anyway"]);
});
