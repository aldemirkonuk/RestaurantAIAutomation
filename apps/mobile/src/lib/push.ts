import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { api } from "@/api/client";
import { queryClient } from "@/lib/queryClient";
import { feedKey, pulseKey } from "@/api/queries";
import { color } from "@/design/tokens";

let registeredToken: string | null = null;

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
        name: "WineOps",
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

    const projectId =
      Constants.easConfig?.projectId ??
      (Constants.expoConfig as any)?.extra?.eas?.projectId;
    const token = (
      await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)
    ).data;

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

export async function unregisterPush(): Promise<void> {
  if (!registeredToken) return;
  await api(`/mobile/devices/${encodeURIComponent(registeredToken)}`, {
    method: "DELETE",
  }).catch(() => {});
  registeredToken = null;
}

/** Map a notification's payload to an in-app route. */
export function routeForNotification(data: Record<string, any>): string | null {
  const orderId = data.orderId ?? data.order_id;
  const type = String(data.type ?? "");
  if (type === "invoice_received" && orderId) return `/cellar/receive/${orderId}`;
  if (orderId) return `/supply/${orderId}`;
  const inventoryId = data.inventoryId ?? data.inventory_id;
  if (inventoryId) return `/cellar/${inventoryId}`;
  return "/";
}

/** Cache-warm on every incoming push so the feed is fresh before open. */
export function attachPushListeners(onNavigate: (route: string) => void): () => void {
  const received = Notifications.addNotificationReceivedListener(() => {
    queryClient.invalidateQueries({ queryKey: [...feedKey] });
    queryClient.invalidateQueries({ queryKey: [...pulseKey] });
  });
  const response = Notifications.addNotificationResponseReceivedListener((res) => {
    const data = res.notification.request.content.data ?? {};
    const route = routeForNotification(data as Record<string, any>);
    if (route) onNavigate(route);
  });
  return () => {
    received.remove();
    response.remove();
  };
}
