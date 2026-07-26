import React from "react";
import { Linking, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { AppText } from "@/components/ui/AppText";
import { PressableScale } from "@/components/ui/PressableScale";
import { WEB_URL } from "@/config";
import { color, font, radius, space } from "@/design/tokens";
import { trackGuidance } from "@/guidance/analytics";

/**
 * Placeholder — no agent product. Deep-links to web /wineagent when configured.
 */
export default function WineAgentScreen() {
  const router = useRouter();

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: "Wine Agent",
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
      <View
        style={{
          flex: 1,
          backgroundColor: color.surfaceSecondary,
          padding: space.lg,
          justifyContent: "center",
          gap: space.md,
        }}
      >
        <View
          style={{
            alignSelf: "center",
            width: 64,
            height: 64,
            borderRadius: 999,
            backgroundColor: color.wineStrong,
            alignItems: "center",
            justifyContent: "center",
            marginBottom: space.sm,
          }}
        >
          <Ionicons name="wine" size={28} color="#fff" />
        </View>
        <AppText variant="title" align="center">
          Wine Agent
        </AppText>
        <AppText variant="body" tone="secondary" align="center">
          Inventory & ordering help. This entry does not grant email access — manage privacy under
          Settings → Services.
        </AppText>
        {WEB_URL ? (
          <PressableScale
            onPress={async () => {
              trackGuidance("wine_agent_fab_clicked", { source: "placeholder" });
              await Linking.openURL(`${WEB_URL}/wineagent`);
            }}
            style={{
              marginTop: space.md,
              backgroundColor: color.wineStrong,
              borderRadius: radius.control,
              paddingVertical: 14,
              alignItems: "center",
            }}
          >
            <AppText variant="bodyMedium" style={{ color: "#fff" }}>
              Open in browser
            </AppText>
          </PressableScale>
        ) : (
          <AppText variant="footnote" tone="tertiary" align="center">
            Set EXPO_PUBLIC_WEB_URL to open the web Wine Agent from this screen.
          </AppText>
        )}
      </View>
    </>
  );
}
