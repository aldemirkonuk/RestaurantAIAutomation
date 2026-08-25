import React from "react";
import { Modal, View } from "react-native";
import { AppText } from "@/components/ui/AppText";
import { PressableScale } from "@/components/ui/PressableScale";
import { color, radius, space } from "@/design/tokens";
import { TOUR_REGISTRY } from "./content";
import { useGuidanceOptional } from "./GuidanceProvider";

export function TourSheet() {
  const guidance = useGuidanceOptional();
  if (!guidance?.activeTour) return null;

  const steps = TOUR_REGISTRY[guidance.activeTour] ?? [];
  const step = steps[guidance.tourStepIndex];
  if (!step) return null;

  const isLast = guidance.tourStepIndex >= steps.length - 1;

  return (
    <Modal transparent animationType="fade" visible onRequestClose={guidance.skipTour}>
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(15,23,42,0.45)",
          justifyContent: "flex-end",
          padding: space.lg,
        }}
      >
        <View
          style={{
            backgroundColor: color.surface,
            borderRadius: radius.card,
            padding: space.lg,
            gap: space.md,
            borderLeftWidth: 4,
            borderLeftColor: color.wineStrong,
          }}
        >
          <AppText variant="caption" tone="tertiary">
            {guidance.tourStepIndex + 1}/{steps.length}
          </AppText>
          <AppText variant="headline">{step.title}</AppText>
          <AppText variant="body" tone="secondary">
            {step.description}
          </AppText>
          <View style={{ flexDirection: "row", gap: space.sm, marginTop: space.sm }}>
            <PressableScale
              onPress={guidance.skipTour}
              style={{
                flex: 1,
                minHeight: 48,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: radius.control,
                backgroundColor: color.fill,
              }}
            >
              <AppText variant="bodyMedium" tone="secondary">
                Skip
              </AppText>
            </PressableScale>
            <PressableScale
              onPress={guidance.nextTourStep}
              style={{
                flex: 1,
                minHeight: 48,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: radius.control,
                backgroundColor: color.wineStrong,
              }}
            >
              <AppText variant="bodyMedium" style={{ color: "#fff" }}>
                {isLast ? "Done" : "Next"}
              </AppText>
            </PressableScale>
          </View>
        </View>
      </View>
    </Modal>
  );
}
