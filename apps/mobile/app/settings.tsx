import React from "react";
import { ScrollView, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import Constants from "expo-constants";
import { Ionicons } from "@expo/vector-icons";
import { AppText } from "@/components/ui/AppText";
import { PressableScale } from "@/components/ui/PressableScale";
import { Card, Hairline } from "@/components/ui/Screen";
import { color, font, radius, space } from "@/design/tokens";
import { useSession } from "@/state/session";
import { clearPersistedQueries } from "@/lib/queryClient";
import { unregisterPush } from "@/lib/push";

export default function SettingsScreen() {
  const router = useRouter();
  const user = useSession((s) => s.user);
  const signOut = useSession((s) => s.signOut);

  const handleSignOut = async () => {
    await unregisterPush().catch(() => {});
    clearPersistedQueries();
    await signOut();
  };

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: "Settings",
          headerStyle: { backgroundColor: color.surface },
          headerTitleStyle: { fontFamily: font.sansSemiBold, fontSize: 17, color: color.ink },
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
              <View style={{ flexDirection: "row", justifyContent: "space-between", paddingTop: space.xs }}>
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

        <Card style={{ gap: space.xs }}>
          <AppText variant="caption" tone="tertiary">
            Notifications
          </AppText>
          <AppText variant="footnote" tone="secondary">
            What lands in your notification center lands here too — criticals instantly, the rest
            batched by the schedule you set on the web dashboard.
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
          WineOps {Constants.expoConfig?.version ?? ""}
        </AppText>
      </ScrollView>
    </>
  );
}
