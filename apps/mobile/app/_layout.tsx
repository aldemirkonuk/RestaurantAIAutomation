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
import { resolveAuthRedirect } from "@/auth/routes";
import { clearPendingRoute, peekPendingRoute } from "@/auth/pendingRoute";
import { color } from "@/design/tokens";
import { GuidanceProvider } from "@/guidance/GuidanceProvider";
import { TourSheet } from "@/guidance/TourSheet";
import { WineAgentFab } from "@/guidance/WineAgentFab";

SplashScreen.preventAutoHideAsync().catch(() => {});

// Disk cache first, so the first frame after splash is real data.
hydrateQueryCache();

/**
 * One rule, one place, and that place has tests.
 *
 * What was here bounced every signed-out session that was not literally on
 * `login` — which meant a public screen could exist, be registered, compile,
 * and still be replaced on the frame it mounted, forever, with nothing in the
 * build able to say so. That is the same shape as three of the four defects
 * P3.A found by measuring: something exported and never reached.
 * `resolveAuthRedirect` lives in `src/auth/routes.ts` so the decision can be
 * exercised without a renderer, and `src/auth/__tests__/routes.test.ts` reads
 * *this file* to check the hand-rolled version has not grown back.
 *
 * This is also the **only** thing that navigates between auth states. A screen
 * that replaced the route itself on a successful sign-in would be racing this
 * effect for the same transition, and the loser would be `?redirect=` —
 * silently. Screens leave a target in `src/auth/pendingRoute.ts`; this reads it
 * and clears it.
 *
 * **Deep links are not handled here either, and that is deliberate.**
 * `wineops://reset-password?token=…` already reaches the right screen:
 * expo-router installs its own `getInitialURL` and URL subscription into the
 * navigation container's linking config
 * (`expo-router/build/getLinkingConfig.js:52-68`) and resolves the URL against
 * the file route tree. A second handler here pushed every screen twice.
 *
 * What the phone still cannot catch is the link people are actually sent: every
 * auth link the gateway mints points at the *web* origin (`auth.service.ts:705,
 * 893, 1596`), and catching those needs Universal Links — an
 * `associatedDomains` entry here **and** an `apple-app-site-association` file
 * served from that origin. The second half is outside `apps/mobile`, so it is
 * recorded as a blocker (parity spec §5.6) and each affected screen carries a
 * paste box instead.
 */
function useAuthRouting() {
  const status = useSession((s) => s.status);
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    const target = resolveAuthRedirect(status, segments, peekPendingRoute());
    if (!target) return;
    clearPendingRoute();
    router.replace(target as never);
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
              {/* The way in. Every one of these is reachable with no session,
                  which is enforced by `resolveAuthRedirect` and asserted in
                  `src/auth/__tests__/routes.test.ts` — a public screen the
                  router bounces is a screen that does not exist. */}
              <Stack.Screen name="register" />
              <Stack.Screen name="forgot-password" />
              <Stack.Screen name="reset-password" />
              <Stack.Screen name="verify-email" />
              <Stack.Screen name="invite" />
              <Stack.Screen name="no-access" />
              <Stack.Screen
                name="privacy"
                options={{ presentation: "modal", animation: "slide_from_bottom" }}
              />
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
