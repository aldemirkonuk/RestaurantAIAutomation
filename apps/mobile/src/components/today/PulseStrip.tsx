import React from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { AppText } from "@/components/ui/AppText";
import { PressableScale } from "@/components/ui/PressableScale";
import { Card } from "@/components/ui/Screen";
import { Skeleton } from "@/components/ui/Skeleton";
import { color, space } from "@/design/tokens";
import { useTodayPulse } from "@/api/queries";
import { houseMoney } from "@/lib/houseMoney";
import { resolvePulseStripView } from "./pulseStripView";

/**
 * The glance that costs zero taps: tonight's revenue, checks, the delta
 * against the same window last week, and how many decisions are pending.
 * Sales data needs a POS feed; when it is not available the strip says so in
 * plain language rather than falling back to a reassuring "All clear" it
 * cannot support (ADR 0020). Tapping the strip opens the Insights tab — the
 * plain-language conclusions + goals home.
 */
export function PulseStrip() {
  const router = useRouter();
  const { data, isLoading, isError, dataUpdatedAt } = useTodayPulse();

  if (isLoading && !data) {
    return (
      <Card style={{ marginHorizontal: space.lg, marginBottom: space.md }}>
        <Skeleton width={90} height={12} />
        <View style={{ height: space.sm }} />
        <Skeleton width={160} height={26} />
      </Card>
    );
  }

  if (!data) return null;

  // F-676: a failed refresh keeps the saved figures; the strip says so and
  // says when they are from, rather than presenting them as tonight's.
  const view = resolvePulseStripView(data, {
    fetchedAt: dataUpdatedAt || undefined,
    refreshFailed: isError,
  });

  return (
    <PressableScale onPress={() => router.push("/insights")}>
      <Card
        style={{
          marginHorizontal: space.lg,
          marginBottom: space.md,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
      <View>
        <AppText variant="caption" tone="tertiary">
          {view.heading}
        </AppText>
        {view.revenue.status === "known" ? (
          <>
            <AppText variant="display" style={{ marginTop: 2 }}>
              {houseMoney(view.revenue.amount, data)}
            </AppText>
            <AppText variant="footnote" tone="secondary">
              {view.revenue.checksLabel}
            </AppText>
          </>
        ) : (
          <AppText variant="footnote" tone="tertiary" style={{ marginTop: 6, maxWidth: 220 }}>
            {view.revenue.message}
          </AppText>
        )}
        {view.decisionsLabel != null ? (
          <AppText variant="headline" style={{ marginTop: space.xs }}>
            {view.decisionsLabel}
          </AppText>
        ) : null}
        {view.freshness != null ? (
          <AppText
            variant="caption"
            tone={view.stale ? undefined : "tertiary"}
            style={view.stale ? { color: color.danger, marginTop: 2 } : { marginTop: 2 }}
          >
            {view.freshness}
          </AppText>
        ) : null}
      </View>

      {view.revenue.status === "known" && view.revenue.deltaPct != null ? (
        <View
          style={{
            backgroundColor: view.revenue.deltaPct >= 0 ? color.successTint : color.dangerTint,
            paddingHorizontal: space.md,
            paddingVertical: space.xs,
            borderRadius: 999,
          }}
        >
          <AppText
            variant="caption"
            style={{ color: view.revenue.deltaPct >= 0 ? color.success : color.danger }}
          >
            {view.revenue.deltaPct >= 0 ? "+" : ""}
            {view.revenue.deltaPct}% vs last week
          </AppText>
        </View>
        ) : null}
      </Card>
    </PressableScale>
  );
}
