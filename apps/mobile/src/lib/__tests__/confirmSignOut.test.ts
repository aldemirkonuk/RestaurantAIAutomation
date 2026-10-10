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
import fs from "fs";
import path from "path";
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
  useOutbox.setState({ entries: [{ id: "a", actorUserId: "alice", restaurantId: "r1", status: "holding", holdUntil: Infinity }] as any, flush });
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

// F-1026: refused work never sends on its own, and Send now sends only the
// open house's work; the warning says both, and is not offered for nothing.
it("tells refused work and another house's work apart from what Send now sends", () => {
  useSession.setState({ status: "signedIn" });
  useOutbox.setState({
    entries: [
      { id: "a", actorUserId: "alice", restaurantId: "r1", status: "pending" },
      { id: "b", actorUserId: "alice", restaurantId: "r2", status: "pending" },
      { id: "c", actorUserId: "alice", restaurantId: "r1", status: "failed" },
    ] as any,
  });
  confirmSignOut(jest.fn());
  const [, words, buttons] = (Alert.alert as jest.Mock).mock.calls[0];
  expect(words).toBe(
    "2 things you did have not been sent yet. They stay on this phone and send only when you sign in here again. " +
      "1 of them is for another of your houses and sends once you open that house. " +
      "1 thing the house refused waits on this phone for you to look at; it does not send on its own. " +
      "Nobody else who signs in will see any of it. Send now sends only what is for the house you are in.",
  );
  expect(buttons.map((b: { text: string }) => b.text)).toEqual(["Cancel", "Send now", "Sign out anyway"]);
});

it("does not offer Send now when nothing of this house's waits", () => {
  useSession.setState({ status: "signedIn" });
  useOutbox.setState({
    entries: [{ id: "c", actorUserId: "alice", restaurantId: "r1", status: "failed" }] as any,
  });
  confirmSignOut(jest.fn());
  const [, words, buttons] = (Alert.alert as jest.Mock).mock.calls[0];
  expect(words).not.toMatch(/sign in here again/);
  expect(buttons.map((b: { text: string }) => b.text)).toEqual(["Cancel", "Sign out anyway"]);
});

it("every sign-out button on the phone goes through the warning (F-1026)", () => {
  const appDir = path.resolve(__dirname, "../../../app");
  const screens: string[] = [];
  const walk = (dir: string) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (full.endsWith(".tsx")) screens.push(full);
    }
  };
  walk(appDir);
  const signingOut = screens.filter((f) => /\bsignOut\(\)/.test(fs.readFileSync(f, "utf8")));
  expect(signingOut.length).toBeGreaterThanOrEqual(4);
  for (const f of signingOut) {
    expect([path.relative(appDir, f), fs.readFileSync(f, "utf8").includes("confirmSignOut(")]).toEqual([
      path.relative(appDir, f),
      true,
    ]);
  }
});
