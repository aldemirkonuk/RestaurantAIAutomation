import React from "react";
import { Linking, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { usePathname, useRouter } from "expo-router";
import { PressableScale } from "@/components/ui/PressableScale";
import { WEB_URL } from "@/config";
import { color } from "@/design/tokens";
import { trackGuidance } from "./analytics";
import { useGuidanceOptional } from "./GuidanceProvider";

export function WineAgentFab() {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const router = useRouter();
  const guidance = useGuidanceOptional();

  const activated = !!(
    guidance?.onboarding?.menu_uploaded ||
    guidance?.onboarding?.completed_at ||
    guidance?.state.global.wine_agent_fab_unlocked
  );
  const showPref = guidance?.state.global.show_wine_agent_fab !== false;
  const tipOffset = !!guidance?.tipVisibleFor;
  const hidden =
    pathname.includes("get-started") ||
    pathname.includes("login") ||
    pathname.includes("settings");

  if (!activated || !showPref || hidden) return null;

  const open = async () => {
    trackGuidance("wine_agent_fab_clicked");
    if (WEB_URL) {
      // Web `/wineagent` is retired (ADR 0019 §B); `/sommelier` is the real
      // inventory & ordering help surface.
      await Linking.openURL(`${WEB_URL}/sommelier`);
      return;
    }
    router.push("/wine-agent");
  };

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        right: 20,
        bottom: (tipOffset ? 96 : 72) + insets.bottom,
        zIndex: 40,
      }}
    >
      <PressableScale
        onPress={open}
        accessibilityLabel="Wine Agent — inventory and ordering help"
        style={{
          width: 52,
          height: 52,
          borderRadius: 999,
          backgroundColor: color.wineStrong,
          alignItems: "center",
          justifyContent: "center",
          shadowColor: color.wineDeep,
          shadowOpacity: 0.25,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 4 },
          elevation: 4,
        }}
      >
        <Ionicons name="wine" size={22} color="#fff" />
      </PressableScale>
    </View>
  );
}
