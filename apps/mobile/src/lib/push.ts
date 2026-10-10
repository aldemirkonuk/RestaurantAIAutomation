import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { api } from "@/api/client";
import { queryClient } from "@/lib/queryClient";
import { feedKey, pulseKey } from "@/api/queries";
import { routeForNotificationData } from "@/lib/notificationRoute";
import { color } from "@/design/tokens";
import { beforeSignOutRequest } from "@/state/session";

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
 * Ask for permission, fetch the Expo push token, and register it with the
 * gateway. Every push also warms the cache: by the time the manager opens
 * the app from a notification, the feed is already fresh.
 */
export async function registerPush(): Promise<void> {
  try {
    if (!Device.isDevice) return; // simulators have no push

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "Mudavym",
        importance: Notifications.AndroidImportance.HIGH,
        lightColor: color.wineStrong,
      });
    }

    const { status } = await Notifications.getPermissionsAsync();
    let granted = status === "granted";
    if (!granted) {
      const req = await Notifications.requestPermissionsAsync();
      granted = req.status === "granted";
    }
    if (!granted) return;

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
  } catch {
    // Push is additive; the app must never fail because of it.
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
  onNavigate: (route: string) => void,
): void {
  const id = res.notification.request.identifier ?? null;
  if (id !== null && id === handledResponseId) return;
  handledResponseId = id;
  const data = res.notification.request.content.data ?? {};
  onNavigate(routeForNotificationData(data as Record<string, any>));
}

export function attachPushListeners(onNavigate: (route: string) => void): () => void {
  const received = Notifications.addNotificationReceivedListener(() => {
    queryClient.invalidateQueries({ queryKey: [...feedKey] });
    queryClient.invalidateQueries({ queryKey: [...pulseKey] });
    queryClient.invalidateQueries({ queryKey: ["notifications"] });
  });
  const response = Notifications.addNotificationResponseReceivedListener((res) =>
    openTapped(res, onNavigate),
  );

  let cancelled = false;
  Notifications.getLastNotificationResponseAsync()
    .then((res) => {
      if (cancelled || !res) return;
      openTapped(res, onNavigate);
    })
    .catch(() => {});

  return () => {
    cancelled = true;
    received.remove();
    response.remove();
  };
}
