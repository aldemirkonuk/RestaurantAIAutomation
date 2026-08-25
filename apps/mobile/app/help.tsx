import React from "react";
import { Linking, ScrollView, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { AppText } from "@/components/ui/AppText";
import { PressableScale } from "@/components/ui/PressableScale";
import { Card } from "@/components/ui/Screen";
import { WEB_URL } from "@/config";
import { color, font, space } from "@/design/tokens";
import { trackGuidance } from "@/guidance/analytics";
import { PAGE_TOUR_IDS, TOUR_LABELS } from "@/guidance/types";
import { useGuidanceOptional } from "@/guidance/GuidanceProvider";

export default function HelpScreen() {
  const router = useRouter();
  const guidance = useGuidanceOptional();

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: "Help & Learn",
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
          <AppText variant="headline">Get started guide</AppText>
          <AppText variant="footnote" tone="secondary">
            Activate your wine list and walk through how to use Today, Cellar, and Supply.
          </AppText>
          <PressableScale
            onPress={() => {
              trackGuidance("learn_opened", { mode: "help-get-started" });
              router.push("/get-started");
            }}
            style={{
              marginTop: space.xs,
              backgroundColor: color.wineStrong,
              paddingVertical: 12,
              borderRadius: 12,
              alignItems: "center",
            }}
          >
            <AppText variant="bodyMedium" style={{ color: "#fff" }}>
              Open app guide
            </AppText>
          </PressableScale>
        </Card>

        <Card style={{ gap: space.sm }}>
          <AppText variant="headline">Page tours</AppText>
          {PAGE_TOUR_IDS.map((id) => (
            <PressableScale
              key={id}
              onPress={() => {
                guidance?.startTour(id);
                router.back();
              }}
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                paddingVertical: 10,
              }}
            >
              <AppText variant="body">{TOUR_LABELS[id]}</AppText>
              <Ionicons name="play-circle" size={22} color={color.wineStrong} />
            </PressableScale>
          ))}
          <PressableScale onPress={() => guidance?.resetTips()}>
            <AppText variant="footnote" tone="wine">
              Reset page tips
            </AppText>
          </PressableScale>
        </Card>

        <Card style={{ gap: space.sm }}>
          <AppText variant="headline">Services & permissions</AppText>
          <AppText variant="footnote" tone="secondary">
            Push, privacy, and access — separate from tours. Wine Agent does not grant email
            access.
          </AppText>
          <PressableScale
            onPress={() => {
              trackGuidance("services_visited", { source: "help" });
              router.push("/settings");
            }}
          >
            <AppText variant="footnote" tone="wine">
              Manage in Settings →
            </AppText>
          </PressableScale>
        </Card>

        <Card style={{ gap: space.sm }}>
          <AppText variant="headline">Wine Agent</AppText>
          <AppText variant="footnote" tone="secondary">
            Inventory & ordering help entry. After activation, look for the circle bottom-right.
          </AppText>
          <PressableScale
            onPress={async () => {
              guidance?.unlockWineAgentFab();
              trackGuidance("wine_agent_fab_clicked", { source: "help" });
              if (WEB_URL) await Linking.openURL(`${WEB_URL}/wineagent`);
              else router.push("/wine-agent");
            }}
          >
            <AppText variant="footnote" tone="wine">
              Open Wine Agent →
            </AppText>
          </PressableScale>
          <PressableScale
            onPress={() =>
              guidance?.setShowWineAgentFab(!guidance.state.global.show_wine_agent_fab)
            }
          >
            <AppText variant="footnote" tone="secondary">
              {guidance?.state.global.show_wine_agent_fab === false
                ? "Show Wine Agent button"
                : "Hide Wine Agent button"}
            </AppText>
          </PressableScale>
        </Card>
      </ScrollView>
    </>
  );
}
