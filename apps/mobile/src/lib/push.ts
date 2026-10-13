import { Alert, Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { api } from "@/api/client";
import { queryClient } from "@/lib/queryClient";
import { feedKey, pulseKey } from "@/api/queries";
import {
  LEAVE_COUNT_WORDS,
  openNotificationTap,
  routeForNotificationData,
  unsavedCount,
} from "@/lib/notificationRoute";
import { useSession } from "@/state/session";
import { color } from "@/design/tokens";
import { afterSignIn, beforeSignOutRequest } from "@/state/session";

let registeredToken: string | null = null;

function projectIdOption() {
  const projectId =
    Constants.easConfig?.projectId ??
    (Constants.expoConfig as any)?.extra?.eas?.projectId;
  return projectId ? { projectId } : undefined;
}

/**
 * This phone's Expo token. `registeredToken` lives in memory, so after any
 * restart it is null even though the gateway still holds the device (F-406);
 * ask Expo again instead — the token is stable per install and asking never
 * prompts. Null on a simulator or when Expo cannot answer.
 */
async function deviceToken(): Promise<string | null> {
  if (registeredToken) return registeredToken;
  try {
    if (!Device.isDevice) return null;
    return (await Notifications.getExpoPushTokenAsync(projectIdOption())).data || null;
  } catch {
    return null;
  }
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: true,
  }),
});

/**
 * What turning Push on came to (F-1571): `registered` only when the phone
 * allowed notifications AND the gateway took the device. `refused` is the
 * phone's own setting; `failed` is a step that threw; `unavailable` is a
 * device with no push at all (a simulator).
 */
export type PushOutcome = "registered" | "refused" | "failed" | "unavailable";

/**
 * Ask for permission, fetch the Expo push token, and register it with the
 * gateway. Every push also warms the cache: by the time the manager opens
 * the app from a notification, the feed is already fresh.
 */
export async function registerPush(opts: { ask?: boolean } = {}): Promise<PushOutcome> {
  const ask = opts.ask ?? true;
  try {
    if (!Device.isDevice) return "unavailable"; // simulators have no push

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "Mudavym",
        importance: Notifications.AndroidImportance.HIGH,
        lightColor: color.wineStrong,
      });
    }

    const { status } = await Notifications.getPermissionsAsync();
    let granted = status === "granted";
    if (!granted && ask) {
      const req = await Notifications.requestPermissionsAsync();
      granted = req.status === "granted";
    }
    if (!granted) return "refused";

    const token = (await Notifications.getExpoPushTokenAsync(projectIdOption())).data;

    if (token && token !== registeredToken) {
      await api("/mobile/devices", {
        method: "POST",
        body: {
          expoPushToken: token,
          platform: Platform.OS,
          appVersion: Constants.expoConfig?.version,
        },
      });
      registeredToken = token;
    }
    return token ? "registered" : "failed";
  } catch {
    // Push is additive; the app must never fail because of it. The caller is
    // told, so the switch does not say on when this phone gets nothing.
    return "failed";
  }
}

/**
 * Whether the phone still allows Mudavym's notifications, read without
 * asking. Null when it cannot be read (a simulator, or the read threw).
 */
export async function pushAllowedByPhone(): Promise<boolean | null> {
  try {
    if (!Device.isDevice) return null;
    return (await Notifications.getPermissionsAsync()).status === "granted";
  } catch {
    return null;
  }
}

/** Push off in Settings: the signed-in person's device stops receiving. */
export async function unregisterPush(): Promise<void> {
  const token = await deviceToken();
  if (!token) return;
  await api(`/mobile/devices/${encodeURIComponent(token)}`, {
    method: "DELETE",
  }).catch(() => {});
  registeredToken = null;
}

// Every sign-out — Settings, lock, choose-house, no-access, a dead session —
// unregisters the device under the outgoing session, so the next person on a
// shared phone does not get the last person's pushes (F-406).
beforeSignOutRequest(async (send) => {
  const token = await deviceToken();
  if (!token) return;
  await send(`/mobile/devices/${encodeURIComponent(token)}`, "DELETE");
  registeredToken = null;
});

// Every sign-in registers the device again when the person's saved Push
// setting is on (F-801): sign-out unregistered it above, and nothing else
// would. Never asks the phone's permission here; Settings does that.
afterSignIn(async () => {
  const userId = useSession.getState().user?.id;
  if (!userId) return;
  const res = await api<{ preferences?: { servicePermissions?: Record<string, unknown> } }>(
    `/users/${userId}/preferences`,
  );
  if (res?.preferences?.servicePermissions?.push !== true) return;
  if (useSession.getState().user?.id !== userId) return;
  await registerPush({ ask: false });
});

/**
 * Map a notification's payload to an in-app route.
 * @deprecated kept as the module's public name; the logic lives in
 * `src/lib/notificationRoute.ts` so both the banner and the inbox agree.
 */
export function routeForNotification(data: Record<string, any>): string {
  return routeForNotificationData(data);
}

/**
 * Cache-warm on every incoming push so the feed is fresh before open, and
 * deep-link when one is tapped.
 *
 * Also handles the cold-start case: a notification tapped while the app was
 * dead is delivered through `getLastNotificationResponseAsync`, not through
 * the response listener, so without it the tap is silently lost.
 *
 * F-679: Expo keeps that last response for the life of the process, and the
 * listeners re-attach at every sign-in, so the morning's tap was replayed at
 * the next sign-in — into another account or house, where its order cannot
 * load. A tap is handled once: its id is remembered, from either path.
 */
let handledResponseId: string | null = null;

function openTapped(
  res: Notifications.NotificationResponse,
  open: (data: Record<string, any>) => void,
): void {
  const id = res.notification.request.identifier ?? null;
  if (id !== null && id === handledResponseId) return;
  handledResponseId = id;
  const data = res.notification.request.content.data ?? {};
  open(data as Record<string, any>);
}

export function attachPushListeners(onNavigate: (route: string) => void): () => void {
  // A push of another of the person's houses opens there, never under this
  // one (F-523).
  const open = (data: Record<string, any>) =>
    void openNotificationTap(data, {
      currentHouse: useSession.getState().user?.restaurantId,
      chooseHouse: (houseId) => useSession.getState().chooseHouse(houseId),
      navigate: onNavigate,
      refused: (message) => Alert.alert("Not opened", message),
      // F-1452: a count being typed in is not dropped without asking.
      unsavedCount,
      confirmLeaveCount: () =>
        new Promise<boolean>((resolve) =>
          Alert.alert(
            LEAVE_COUNT_WORDS.title,
            LEAVE_COUNT_WORDS.message,
            [
              { text: LEAVE_COUNT_WORDS.stay, style: "cancel", onPress: () => resolve(false) },
              { text: LEAVE_COUNT_WORDS.leave, style: "destructive", onPress: () => resolve(true) },
            ],
            { cancelable: true, onDismiss: () => resolve(false) },
          ),
        ),
      // F-1309: a delivery notice opens the order it belongs to.
      deliveryOrder: async (deliveryId) => {
        const res = await api<{ event?: { order_id?: unknown; orderId?: unknown } }>(
          `/procurement/deliveries/${encodeURIComponent(deliveryId)}`,
        );
        const order = res?.event?.order_id ?? res?.event?.orderId;
        return typeof order === "string" && order ? order : null;
      },
    });
  const received = Notifications.addNotificationReceivedListener(() => {
    queryClient.invalidateQueries({ queryKey: [...feedKey] });
    queryClient.invalidateQueries({ queryKey: [...pulseKey] });
    queryClient.invalidateQueries({ queryKey: ["notifications"] });
  });
  const response = Notifications.addNotificationResponseReceivedListener((res) =>
    openTapped(res, open),
  );

  let cancelled = false;
  Notifications.getLastNotificationResponseAsync()
    .then((res) => {
      if (cancelled || !res) return;
      openTapped(res, open);
    })
    .catch(() => {});

  return () => {
    cancelled = true;
    received.remove();
    response.remove();
  };
}
