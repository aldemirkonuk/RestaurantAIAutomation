import React, { useEffect } from "react";
import { AppState } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  useFonts,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";
import {
  CormorantGaramond_600SemiBold,
  CormorantGaramond_500Medium_Italic,
} from "@expo-google-fonts/cormorant-garamond";
import {
  hydrateQueryCache,
  queryClient,
  startQueryPersistence,
} from "@/lib/queryClient";
import { useOutbox } from "@/state/outbox";
import { useSession } from "@/state/session";
import { connectSocket, disconnectSocket } from "@/lib/socket";
import { attachPushListeners } from "@/lib/push";
import { color } from "@/design/tokens";
import { GuidanceProvider } from "@/guidance/GuidanceProvider";
import { TourSheet } from "@/guidance/TourSheet";
import { WineAgentFab } from "@/guidance/WineAgentFab";

SplashScreen.preventAutoHideAsync().catch(() => {});

// Disk cache first, so the first frame after splash is real data.
hydrateQueryCache();

function useAuthRouting() {
  const status = useSession((s) => s.status);
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (status === "booting") return;
    const inAuthGroup = segments[0] === "login" || segments[0] === "lock";
    if (status === "signedOut" && segments[0] !== "login") {
      router.replace("/login");
    } else if (status === "locked" && segments[0] !== "lock") {
      router.replace("/lock");
    } else if (status === "signedIn" && inAuthGroup) {
      router.replace("/");
    }
  }, [status, segments, router]);
}

/**
 * The live pipe follows the session, not the mount: it opens once the session
 * is usable (signed in *and* past the biometric gate) and closes on sign-out
 * or lock, so a locked phone holds no authenticated socket. A token refresh
 * re-handshakes, because the gateway derives room membership from the token
 * at connect time and never re-derives it.
 */
function useLiveChannel() {
  const status = useSession((s) => s.status);
  const token = useSession((s) => s.accessToken);

  useEffect(() => {
    if (status === "signedIn" && token) {
      connectSocket(token);
    } else {
      disconnectSocket();
    }
  }, [status, token]);

  useEffect(() => () => disconnectSocket(), []);
}

/**
 * Push taps deep-link. Without this the listeners in `lib/push.ts` were never
 * attached at all, so a tapped banner only opened the app to wherever it had
 * been left.
 */
function usePushRouting() {
  const router = useRouter();
  const status = useSession((s) => s.status);

  useEffect(() => {
    if (status !== "signedIn") return;
    return attachPushListeners((route) => {
      router.push(route as any);
    });
  }, [status, router]);
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    CormorantGaramond_600SemiBold,
    CormorantGaramond_500Medium_Italic,
  });

  const status = useSession((s) => s.status);
  useAuthRouting();
  useLiveChannel();
  usePushRouting();

  useEffect(() => {
    useSession.getState().hydrate();
    useOutbox.getState().hydrate();
    const stopPersist = startQueryPersistence();
    // Foregrounding flushes queued actions and refreshes what's on screen.
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        useOutbox.getState().flush();
        queryClient.invalidateQueries();
      }
    });
    return () => {
      stopPersist();
      sub.remove();
    };
  }, []);

  useEffect(() => {
    if (fontsLoaded && status !== "booting") {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsLoaded, status]);

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <GuidanceProvider>
            <StatusBar style="dark" />
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: color.surfaceSecondary },
              }}
            >
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="login" options={{ animation: "fade" }} />
              <Stack.Screen name="lock" options={{ animation: "fade" }} />
              <Stack.Screen
                name="settings"
                options={{ presentation: "modal", animation: "slide_from_bottom" }}
              />
              <Stack.Screen
                name="get-started"
                options={{ presentation: "modal", animation: "slide_from_bottom" }}
              />
              <Stack.Screen
                name="help"
                options={{ presentation: "modal", animation: "slide_from_bottom" }}
              />
              <Stack.Screen
                name="notifications"
                options={{ presentation: "modal", animation: "slide_from_bottom" }}
              />
              <Stack.Screen
                name="wine-agent"
                options={{ presentation: "modal", animation: "slide_from_bottom" }}
              />
            </Stack>
            <TourSheet />
            <WineAgentFab />
          </GuidanceProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
