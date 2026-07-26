import React from "react";
import { View } from "react-native";
import { AppText } from "@/components/ui/AppText";
import { PressableScale } from "@/components/ui/PressableScale";
import { color, radius, space } from "@/design/tokens";
import { TIP_REGISTRY } from "./content";
import { useGuidanceOptional } from "./GuidanceProvider";
import type { PageTourId } from "./types";

export function TipStrip({ pageId }: { pageId: PageTourId }) {
  const guidance = useGuidanceOptional();
  if (!guidance || guidance.tipVisibleFor !== pageId) return null;
  const tip = TIP_REGISTRY[pageId];

  return (
    <View
      style={{
        marginHorizontal: space.lg,
        marginBottom: space.md,
        padding: space.md,
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: color.wineTintStrong,
        backgroundColor: color.wineTint,
        gap: space.sm,
      }}
    >
      <AppText variant="bodyMedium">{tip.title}</AppText>
      <AppText variant="footnote" tone="secondary">
        {tip.body}
      </AppText>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
        <PressableScale
          onPress={() => guidance.completeTipViaTour(pageId)}
          style={{
            backgroundColor: color.wineStrong,
            paddingHorizontal: 14,
            paddingVertical: 10,
            borderRadius: radius.control,
            minHeight: 44,
            justifyContent: "center",
          }}
        >
          <AppText variant="footnote" style={{ color: "#fff", fontWeight: "600" }}>
            Take tour
          </AppText>
        </PressableScale>
        <PressableScale
          onPress={() => guidance.snoozeTip(pageId)}
          style={{
            paddingHorizontal: 14,
            paddingVertical: 10,
            borderRadius: radius.control,
            minHeight: 44,
            justifyContent: "center",
            backgroundColor: color.surface,
          }}
        >
          <AppText variant="footnote" tone="secondary">
            Later
          </AppText>
        </PressableScale>
        <PressableScale
          onPress={() => guidance.dismissTip(pageId)}
          style={{
            paddingHorizontal: 14,
            paddingVertical: 10,
            borderRadius: radius.control,
            minHeight: 44,
            justifyContent: "center",
          }}
        >
          <AppText variant="footnote" tone="tertiary">
            Don't show
          </AppText>
        </PressableScale>
      </View>
    </View>
  );
}
