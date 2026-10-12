/**
 * F-1571: the Push switch says ON only when this phone allowed notifications
 * and the device was registered. A refusal or a failed registration is told
 * to the screen, which says what happened and how to fix it.
 */
import fs from "fs";
import path from "path";

jest.mock("react-native", () => ({ Platform: { OS: "ios" } }));
const perms = { status: "granted", asked: "granted" };
jest.mock("expo-notifications", () => ({
  setNotificationHandler: jest.fn(),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: "ExponentPushToken[abc]" })),
  getPermissionsAsync: jest.fn(async () => ({ status: perms.status })),
  requestPermissionsAsync: jest.fn(async () => ({ status: perms.asked })),
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
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

import { pushSwitchOn, savedPushProblem, turnPushOn, PUSH_PROBLEM_WORDS } from "../pushSwitch";

function load(): typeof import("../push") {
  let mod!: { session: typeof import("@/state/session"); push: typeof import("../push") };
  jest.isolateModules(() => {
    mod = { session: require("@/state/session"), push: require("../push") };
  });
  mod.session.useSession.setState({
    status: "signedIn",
    accessToken: "a1",
    user: { id: "alice", email: "a@example.com", restaurantId: "r1" },
  });
  return mod.push;
}

function serve(ok: boolean) {
  global.fetch = jest.fn(async () => ({
    ok,
    status: ok ? 204 : 500,
    json: async () => ({}),
  })) as unknown as typeof fetch;
}

beforeEach(() => {
  perms.status = "granted";
  perms.asked = "granted";
});

describe("registerPush says what it came to", () => {
  it("registered: the phone allowed it and the gateway took the device", async () => {
    serve(true);
    expect(await load().registerPush()).toBe("registered");
  });

  it("refused: the phone said no to notifications", async () => {
    serve(true);
    perms.status = "denied";
    perms.asked = "denied";
    expect(await load().registerPush()).toBe("refused");
  });

  it("failed: the gateway did not take the device", async () => {
    serve(false);
    expect(await load().registerPush()).toBe("failed");
  });
});

describe("the switch follows the real state", () => {
  it("saves on only after a registration", async () => {
    const saved: boolean[] = [];
    const save = (on: boolean) => void saved.push(on);
    expect(await turnPushOn({ register: async () => "refused", save })).toBe("refused");
    expect(await turnPushOn({ register: async () => "failed", save })).toBe("failed");
    expect(await turnPushOn({ register: async () => Promise.reject(new Error("x")), save })).toBe(
      "failed",
    );
    expect(saved).toEqual([]);
    expect(await turnPushOn({ register: async () => "registered", save })).toBeNull();
    expect(saved).toEqual([true]);
  });

  it("shows off, with the reason, while something stands in the way", () => {
    expect(pushSwitchOn(true, null)).toBe(true);
    expect(pushSwitchOn(true, "refused")).toBe(false);
    expect(pushSwitchOn(true, "failed")).toBe(false);
    expect(pushSwitchOn(false, null)).toBe(false);
  });

  it("a saved on that the phone has since turned off reads as refused", async () => {
    expect(await savedPushProblem(true, async () => false)).toBe("refused");
    expect(await savedPushProblem(true, async () => true)).toBeNull();
    expect(await savedPushProblem(true, async () => null)).toBeNull();
    expect(await savedPushProblem(false, async () => false)).toBeNull();
  });

  it("offers a fix for a refusal and a retry for a failure, in plain words", () => {
    expect(PUSH_PROBLEM_WORDS.refused.message).toMatch(/off for Mudavym in your phone's settings/);
    expect(PUSH_PROBLEM_WORDS.refused.action).toBe("Open phone settings");
    expect(PUSH_PROBLEM_WORDS.failed.action).toBe("Try again");
  });

  it("the Settings screen saves Push only through turnPushOn and links the phone's settings", () => {
    const screen = fs.readFileSync(path.resolve(__dirname, "../../../app/settings.tsx"), "utf8");
    expect(screen).toMatch(/turnPushOn\(/);
    expect(screen).toMatch(/Linking\.openSettings\(\)/);
    expect(screen).not.toMatch(/setServicePermission\("push", v\)/);
    expect(screen).toMatch(/value=\{pushOn\}/);
    expect(screen).toMatch(/pushSwitchOn\(pushSaved, pushProblem\)/);
  });
});
