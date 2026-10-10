/**
 * F-679: `attachPushListeners` navigated to `getLastNotificationResponseAsync`
 * on every attach, and it re-attaches at every sign-in. Expo keeps the last
 * response for the life of the process, so the morning's tap was replayed at
 * the next sign-in — on a shared phone, into another person's house.
 */
jest.mock("react-native", () => ({ Platform: { OS: "ios" } }));
let lastResponse: unknown = null;
let responseListener: ((res: unknown) => void) | null = null;
jest.mock("expo-notifications", () => ({
  setNotificationHandler: jest.fn(),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationResponseReceivedListener: jest.fn((cb: (res: unknown) => void) => {
    responseListener = cb;
    return { remove: jest.fn() };
  }),
  getLastNotificationResponseAsync: jest.fn(async () => lastResponse),
}));
jest.mock("expo-device", () => ({ isDevice: true }));
jest.mock("expo-constants", () => ({ __esModule: true, default: {} }));
jest.mock("@/api/client", () => ({ api: jest.fn() }));
jest.mock("@/api/queries", () => ({ feedKey: ["feed"], pulseKey: ["pulse"] }));
jest.mock("@/design/tokens", () => ({ color: {} }));
jest.mock("@/lib/notificationRoute", () => ({
  routeForNotificationData: (data: { orderId?: string }) => `/supply/${data.orderId}`,
}));
jest.mock("@/lib/queryClient", () => ({ queryClient: { invalidateQueries: jest.fn() } }));
jest.mock("@/state/session", () => ({ beforeSignOutRequest: jest.fn() }));

import { attachPushListeners } from "../push";

function tap(id: string, orderId: string) {
  return { notification: { request: { identifier: id, content: { data: { orderId } } } } };
}

async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

it("opens a cold-start tap once, not again at the next sign-in", async () => {
  lastResponse = tap("n-1", "o-morning");
  const first = jest.fn();
  const detach = attachPushListeners(first);
  await settle();
  expect(first.mock.calls).toEqual([["/supply/o-morning"]]);
  detach();

  // Sign out, sign in: the listeners attach again; Expo still holds n-1.
  const second = jest.fn();
  attachPushListeners(second);
  await settle();
  expect(second).not.toHaveBeenCalled();
});

it("does not replay a live tap when the listeners re-attach", async () => {
  const live = jest.fn();
  const detach = attachPushListeners(live);
  await settle();
  responseListener!(tap("n-2", "o-noon"));
  lastResponse = tap("n-2", "o-noon");
  expect(live.mock.calls.at(-1)).toEqual(["/supply/o-noon"]);
  detach();

  const again = jest.fn();
  attachPushListeners(again);
  await settle();
  expect(again).not.toHaveBeenCalled();
});

it("still opens a new tap", async () => {
  lastResponse = tap("n-3", "o-evening");
  const next = jest.fn();
  attachPushListeners(next);
  await settle();
  expect(next.mock.calls).toEqual([["/supply/o-evening"]]);
});
