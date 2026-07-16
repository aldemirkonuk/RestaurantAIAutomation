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
import { color } from "@/design/tokens";

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
          </Stack>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
