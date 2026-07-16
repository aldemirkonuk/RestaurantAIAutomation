import React from "react";
import { View } from "react-native";
import { AppText } from "./AppText";
import { PressableScale } from "./PressableScale";
import { color, radius, space } from "@/design/tokens";

interface StateViewProps {
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ title, message, actionLabel, onAction }: StateViewProps) {
  return (
    <View style={{ alignItems: "center", paddingVertical: space.huge, paddingHorizontal: space.xxl, gap: space.sm }}>
      <AppText variant="headline" align="center">
        {title}
      </AppText>
      {message ? (
        <AppText variant="footnote" tone="tertiary" align="center">
          {message}
        </AppText>
      ) : null}
      {actionLabel && onAction ? (
        <PressableScale
          onPress={onAction}
          style={{
            marginTop: space.md,
            paddingHorizontal: space.xl,
            paddingVertical: space.md,
            borderRadius: radius.control,
            backgroundColor: color.fill,
          }}
        >
          <AppText variant="bodyMedium">{actionLabel}</AppText>
        </PressableScale>
      ) : null}
    </View>
  );
}

export function ErrorState({ title, message, actionLabel = "Try again", onAction }: StateViewProps) {
  return (
    <View style={{ alignItems: "center", paddingVertical: space.huge, paddingHorizontal: space.xxl, gap: space.sm }}>
      <AppText variant="headline" align="center">
        {title}
      </AppText>
      {message ? (
        <AppText variant="footnote" tone="tertiary" align="center">
          {message}
        </AppText>
      ) : null}
      {onAction ? (
        <PressableScale
          onPress={onAction}
          style={{
            marginTop: space.md,
            paddingHorizontal: space.xl,
            paddingVertical: space.md,
            borderRadius: radius.control,
            backgroundColor: color.wine,
          }}
        >
          <AppText variant="bodyMedium" tone="onWine">
            {actionLabel}
          </AppText>
        </PressableScale>
      ) : null}
    </View>
  );
}

/** Freshness label for offline-persisted data: "as of 18 min ago". */
export function FreshnessLabel({ updatedAt }: { updatedAt: number | null }) {
  if (!updatedAt) return null;
  const ageMin = Math.round((Date.now() - updatedAt) / 60_000);
  if (ageMin < 2) return null;
  const label =
    ageMin < 60
      ? `as of ${ageMin} min ago`
      : `as of ${Math.round(ageMin / 60)}h ago`;
  return (
    <AppText variant="caption" tone="tertiary" align="center" style={{ paddingVertical: space.xs }}>
      {label}
    </AppText>
  );
}
