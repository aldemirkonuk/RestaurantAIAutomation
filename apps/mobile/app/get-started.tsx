import React, { useState } from "react";
import { Linking, ScrollView, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { AppText } from "@/components/ui/AppText";
import { PressableScale } from "@/components/ui/PressableScale";
import { WEB_URL } from "@/config";
import { color, font, radius, space } from "@/design/tokens";
import { trackGuidance } from "@/guidance/analytics";
import { useGuidanceOptional } from "@/guidance/GuidanceProvider";

type TabId = "activate" | "use";

const USE_CARDS = [
  {
    id: "import",
    title: "Import your wine list",
    description: "Scan or upload on the web — Activate tab opens the browser.",
    icon: "wine" as const,
    action: "activate" as const,
  },
  {
    id: "today",
    title: "Check Today decisions",
    description: "Act on stock risk and orders from your feed.",
    icon: "sunny" as const,
    href: "/",
  },
  {
    id: "cellar",
    title: "Browse the cellar",
    description: "See stock, low bottles, and wine detail.",
    icon: "grid" as const,
    href: "/cellar",
  },
  {
    id: "supply",
    title: "Track supply orders",
    description: "Open POs from approval through delivery.",
    icon: "cart" as const,
    href: "/supply",
  },
  {
    id: "wine-agent",
    title: "Wine Agent",
    description:
      "After setup, the wine circle bottom-right opens inventory help. It does not access email.",
    icon: "chatbubble-ellipses" as const,
    href: "/wine-agent",
  },
  {
    id: "services",
    title: "Services & permissions",
    description: "Push, privacy, and access toggles — optional.",
    icon: "shield-checkmark" as const,
    href: "/settings",
  },
];

export default function GetStartedScreen() {
  const router = useRouter();
  const guidance = useGuidanceOptional();
  const [tab, setTab] = useState<TabId>(
    guidance?.onboarding?.menu_uploaded ? "use" : "activate",
  );

  const openWebActivate = async () => {
    trackGuidance("guide_card_clicked", { cardId: "activate-web" });
    if (WEB_URL) {
      await Linking.openURL(`${WEB_URL}/get-started?tab=activate`);
      return;
    }
    setTab("use");
  };

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: "Get started",
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
      <View style={{ flexDirection: "row", borderBottomWidth: 1, borderColor: color.hairline }}>
        {(["activate", "use"] as const).map((id) => (
          <PressableScale
            key={id}
            onPress={() => setTab(id)}
            style={{
              flex: 1,
              paddingVertical: 14,
              alignItems: "center",
              borderBottomWidth: 2,
              borderBottomColor: tab === id ? color.wineStrong : "transparent",
            }}
          >
            <AppText
              variant="bodyMedium"
              style={{ color: tab === id ? color.wineStrong : color.inkTertiary }}
            >
              {id === "activate" ? "Activate" : "Use the app"}
            </AppText>
          </PressableScale>
        ))}
      </View>

      <ScrollView
        style={{ backgroundColor: color.surfaceSecondary }}
        contentContainerStyle={{ padding: space.lg, gap: space.md }}
      >
        {tab === "activate" ? (
          <View style={{ gap: space.md }}>
            <AppText variant="title">Set up your wine list</AppText>
            <AppText variant="body" tone="secondary">
              Menu import (scan / CSV / manual) runs on the web dashboard. Open Activate there,
              then come back here for day-to-day ops.
            </AppText>
            <PressableScale
              onPress={openWebActivate}
              style={{
                backgroundColor: color.wineStrong,
                borderRadius: radius.control,
                paddingVertical: 14,
                alignItems: "center",
                minHeight: 48,
                justifyContent: "center",
              }}
            >
              <AppText variant="bodyMedium" style={{ color: "#fff" }}>
                {WEB_URL ? "Open web Activate" : "Continue to Use the app"}
              </AppText>
            </PressableScale>
            <PressableScale onPress={() => setTab("use")}>
              <AppText variant="footnote" tone="wine" align="center">
                Skip to app guide →
              </AppText>
            </PressableScale>
          </View>
        ) : (
          <View style={{ gap: space.sm }}>
            <AppText variant="title">How to use WineOps</AppText>
            <AppText variant="body" tone="secondary" style={{ marginBottom: space.sm }}>
              Short paths for busy shifts — open a surface, get the job done.
            </AppText>
            {USE_CARDS.map((card) => (
              <PressableScale
                key={card.id}
                onPress={() => {
                  trackGuidance("guide_card_clicked", { cardId: card.id });
                  if ("action" in card && card.action === "activate") {
                    setTab("activate");
                    return;
                  }
                  if (card.id === "wine-agent") {
                    guidance?.unlockWineAgentFab();
                  }
                  if (card.id === "services") {
                    trackGuidance("services_visited", { source: "get-started" });
                  }
                  if ("href" in card && card.href) {
                    router.push(card.href as any);
                  }
                }}
                style={{
                  backgroundColor: color.surface,
                  borderRadius: radius.card,
                  borderWidth: 1,
                  borderColor: color.hairline,
                  padding: space.md,
                  flexDirection: "row",
                  gap: space.md,
                  alignItems: "center",
                  minHeight: 72,
                }}
              >
                <View
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 12,
                    backgroundColor: color.wineTint,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons name={card.icon} size={20} color={color.wineStrong} />
                </View>
                <View style={{ flex: 1 }}>
                  <AppText variant="bodyMedium">{card.title}</AppText>
                  <AppText variant="footnote" tone="secondary">
                    {card.description}
                  </AppText>
                </View>
                <Ionicons name="chevron-forward" size={18} color={color.inkQuaternary} />
              </PressableScale>
            ))}
          </View>
        )}
      </ScrollView>
    </>
  );
}
