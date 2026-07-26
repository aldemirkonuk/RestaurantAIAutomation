import React, { useEffect } from "react";
import { ScrollView, Switch, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import Constants from "expo-constants";
import { Ionicons } from "@expo/vector-icons";
import { AppText } from "@/components/ui/AppText";
import { PressableScale } from "@/components/ui/PressableScale";
import { Card, Hairline } from "@/components/ui/Screen";
import { color, font, radius, space } from "@/design/tokens";
import { useSession } from "@/state/session";
import { clearPersistedQueries } from "@/lib/queryClient";
import { registerPush, unregisterPush } from "@/lib/push";
import { trackGuidance } from "@/guidance/analytics";
import { useGuidanceOptional } from "@/guidance/GuidanceProvider";

export default function SettingsScreen() {
  const router = useRouter();
  const user = useSession((s) => s.user);
  const signOut = useSession((s) => s.signOut);
  const guidance = useGuidanceOptional();

  useEffect(() => {
    trackGuidance("services_visited", { source: "settings" });
  }, []);

  const handleSignOut = async () => {
    await unregisterPush().catch(() => {});
    clearPersistedQueries();
    await signOut();
  };

  const perms = guidance?.servicePermissions ?? {
    email: true,
    web: true,
    privacy_analytics: true,
    privacy_sharing: false,
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
            Grant or revoke access only. Wine Agent does not grant email access — manage Agent
            from Help & Learn.
          </AppText>

          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <View style={{ flex: 1, paddingRight: space.md }}>
              <AppText variant="bodyMedium">Push notifications</AppText>
              <AppText variant="caption" tone="tertiary">
                Criticals instantly; rest follows your web schedule.
              </AppText>
            </View>
            <Switch
              value={!!perms.push}
              onValueChange={async (v) => {
                guidance?.setServicePermission("push", v);
                if (v) await registerPush().catch(() => {});
                else await unregisterPush().catch(() => {});
              }}
              trackColor={{ true: color.wineStrong }}
            />
          </View>

          <Hairline />

          {(
            [
              ["email", "Email access", "Operational email from connected sender"],
              ["web", "Web / connected apps", "Calendar feeds and vendor links"],
              ["privacy_analytics", "Product analytics", "Anonymous usage signals"],
              ["privacy_sharing", "Partner data sharing", "Off by default"],
            ] as const
          ).map(([key, title, desc]) => (
            <View key={key}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  paddingVertical: space.xs,
                }}
              >
                <View style={{ flex: 1, paddingRight: space.md }}>
                  <AppText variant="bodyMedium">{title}</AppText>
                  <AppText variant="caption" tone="tertiary">
                    {desc}
                  </AppText>
                </View>
                <Switch
                  value={!!perms[key]}
                  onValueChange={(v) => guidance?.setServicePermission(key, v)}
                  trackColor={{ true: color.wineStrong }}
                />
              </View>
              <Hairline />
            </View>
          ))}
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
          WineOps {Constants.expoConfig?.version ?? ""}
        </AppText>
      </ScrollView>
    </>
  );
}
