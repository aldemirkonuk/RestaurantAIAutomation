import React, { useCallback, useEffect, useState } from "react";
import { AppState, Linking, ScrollView, Switch, View } from "react-native";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import Constants from "expo-constants";
import { Ionicons } from "@expo/vector-icons";
import { AppText } from "@/components/ui/AppText";
import { PressableScale } from "@/components/ui/PressableScale";
import { Card, Hairline } from "@/components/ui/Screen";
import { color, font, radius, space } from "@/design/tokens";
import { useSession } from "@/state/session";
import { useHouses } from "@/api/queries";
import { openHouse } from "@/auth/houseChoice";
import { clearPersistedQueries } from "@/lib/queryClient";
import { confirmSignOut } from "@/lib/confirmSignOut";
import { pushAllowedByPhone, registerPush, unregisterPush } from "@/lib/push";
import {
  PUSH_PROBLEM_WORDS,
  pushProblemOnRecheck,
  pushSwitchOn,
  turnPushOn,
  type PushProblem,
} from "@/lib/pushSwitch";
import { trackGuidance } from "@/guidance/analytics";
import { useGuidanceOptional } from "@/guidance/GuidanceProvider";

export default function SettingsScreen() {
  const router = useRouter();
  const user = useSession((s) => s.user);
  const signOut = useSession((s) => s.signOut);
  const guidance = useGuidanceOptional();
  const houses = useHouses();
  // F-675: name the open house, and let an owner of several switch.
  const house = openHouse(houses.data, user?.restaurantId);

  useEffect(() => {
    trackGuidance("services_visited", { source: "settings" });
  }, []);

  const handleSignOut = () =>
    // Unsent work is named before it is left behind (F-952).
    confirmSignOut(async () => {
      // The push device is unregistered by signOut itself (src/lib/push.ts).
      clearPersistedQueries();
      await signOut();
    });

  // F-1571: the switch says what this phone really gets. Saved on but refused
  // by the phone, or not taken by the gateway, it shows off with the reason.
  const pushSaved = !!guidance?.servicePermissions?.push;
  const [pushProblem, setPushProblem] = useState<PushProblem>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const pushOn = pushSwitchOn(pushSaved, pushProblem);
  const pushWords = pushProblem ? PUSH_PROBLEM_WORDS[pushProblem] : null;

  // The phone's answer is read on open, whenever the app comes back to the
  // front (say, from "Open phone settings") and whenever this screen is shown
  // again, so allowing notifications in the phone clears the refusal (F-1583).
  const recheckPush = useCallback(() => {
    let live = true;
    void pushAllowedByPhone()
      .catch(() => null)
      .then((allowed) => {
        if (live) setPushProblem((p) => pushProblemOnRecheck(p, pushSaved, allowed));
      });
    return () => {
      live = false;
    };
  }, [pushSaved]);

  useFocusEffect(recheckPush);

  useEffect(() => {
    let stop: (() => void) | null = null;
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      stop?.();
      stop = recheckPush();
    });
    return () => {
      stop?.();
      sub.remove();
    };
  }, [recheckPush]);

  const turnOn = async () => {
    setPushBusy(true);
    const problem = await turnPushOn({
      register: () => registerPush(),
      save: (on) => guidance?.setServicePermission("push", on),
    });
    setPushProblem(problem);
    setPushBusy(false);
  };

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: "Settings",
          headerStyle: { backgroundColor: color.surface },
          headerTitleStyle: {
            fontFamily: font.sansSemiBold,
            fontSize: 17,
            color: color.ink,
          },
          headerLeft: () => (
            <PressableScale onPress={() => router.back()} accessibilityLabel="Close">
              <Ionicons name="close" size={24} color={color.inkSecondary} />
            </PressableScale>
          ),
        }}
      />
      <ScrollView
        style={{ backgroundColor: color.surfaceSecondary }}
        contentContainerStyle={{ padding: space.lg, gap: space.md }}
      >
        <Card style={{ gap: space.sm }}>
          <AppText variant="caption" tone="tertiary">
            Signed in as
          </AppText>
          <AppText variant="headline">{user?.name ?? user?.email ?? ""}</AppText>
          {user?.name && user?.email ? (
            <AppText variant="footnote" tone="secondary">
              {user.email}
            </AppText>
          ) : null}
          {user?.role ? (
            <>
              <Hairline />
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  paddingTop: space.xs,
                }}
              >
                <AppText variant="body" tone="secondary">
                  Role
                </AppText>
                <AppText variant="bodyMedium" style={{ textTransform: "capitalize" }}>
                  {user.role}
                </AppText>
              </View>
            </>
          ) : null}
        </Card>

        <Card style={{ gap: space.sm }}>
          <AppText variant="caption" tone="tertiary">
            House
          </AppText>
          <AppText variant={house.name ? "headline" : "footnote"} tone={house.name ? "primary" : "secondary"}>
            {house.name ??
              (houses.isError
                ? "Couldn't read your houses just now."
                : houses.isLoading
                  ? "Reading your houses…"
                  : "No house open.")}
          </AppText>
          {house.canSwitch ? (
            <>
              <Hairline />
              <PressableScale
                onPress={() => router.push("/choose-house" as never)}
                accessibilityRole="button"
                style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
              >
                <AppText variant="body">Switch house</AppText>
                <Ionicons name="chevron-forward" size={18} color={color.inkQuaternary} />
              </PressableScale>
            </>
          ) : null}
        </Card>

        <Card style={{ gap: space.sm }}>
          <AppText variant="caption" tone="tertiary">
            Learn
          </AppText>
          <PressableScale
            onPress={() => {
              trackGuidance("learn_opened", { mode: "settings" });
              router.push("/help");
            }}
            style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
          >
            <AppText variant="body">Help & Learn</AppText>
            <Ionicons name="chevron-forward" size={18} color={color.inkQuaternary} />
          </PressableScale>
          <Hairline />
          <PressableScale
            onPress={() => router.push("/get-started")}
            style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
          >
            <AppText variant="body">Get started guide</AppText>
            <Ionicons name="chevron-forward" size={18} color={color.inkQuaternary} />
          </PressableScale>
        </Card>

        <Card style={{ gap: space.md }}>
          <AppText variant="caption" tone="tertiary">
            Services & permissions
          </AppText>
          <AppText variant="footnote" tone="secondary">
            Turn alerts on this phone on or off. Everything else about your restaurant is set on
            the web, under Settings.
          </AppText>

          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <View style={{ flex: 1, paddingRight: space.md }}>
              <AppText variant="bodyMedium">Push notifications</AppText>
              <AppText variant="caption" tone="tertiary">
                Criticals instantly; rest follows your web schedule.
              </AppText>
            </View>
            <Switch
              value={pushOn}
              disabled={pushBusy}
              onValueChange={async (v) => {
                if (v) return turnOn();
                setPushProblem(null);
                guidance?.setServicePermission("push", false);
                await unregisterPush().catch(() => {});
              }}
              trackColor={{ true: color.wineStrong }}
            />
          </View>

          {pushWords ? (
            <View style={{ gap: space.sm }}>
              <AppText variant="footnote" tone="warning">
                {pushWords.message}
              </AppText>
              {pushWords.action ? (
                <PressableScale
                  disabled={pushBusy}
                  onPress={() =>
                    pushProblem === "refused" ? void Linking.openSettings() : void turnOn()
                  }
                  accessibilityLabel={pushWords.action}
                >
                  <AppText variant="bodyMedium" tone="wine">
                    {pushWords.action}
                  </AppText>
                </PressableScale>
              ) : null}
            </View>
          ) : null}

          <Hairline />

          {/* F-624: the four switches that stood here (email access, web access,
              product analytics, partner sharing) were saved and read by nothing,
              the same four the web consent panel declines to draw. */}
          <AppText variant="caption" tone="tertiary">
            Email access, web access, product analytics and partner sharing are not switches here.
            Nothing in Mudavym reads any of them, so a switch would promise something it could not
            keep.
          </AppText>
        </Card>

        <PressableScale
          onPress={handleSignOut}
          style={{
            backgroundColor: color.surface,
            borderWidth: 1,
            borderColor: color.hairline,
            borderRadius: radius.control,
            paddingVertical: 14,
            alignItems: "center",
          }}
        >
          <AppText variant="bodyMedium" tone="danger">
            Sign out
          </AppText>
        </PressableScale>

        <AppText variant="caption" tone="tertiary" align="center">
          Mudavym {Constants.expoConfig?.version ?? ""}
        </AppText>
      </ScrollView>
    </>
  );
}
