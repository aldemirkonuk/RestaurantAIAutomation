import React from "react";
import { View } from "react-native";
import { AppText } from "@/components/ui/AppText";
import { Card } from "@/components/ui/Screen";
import { Skeleton } from "@/components/ui/Skeleton";
import { color, space } from "@/design/tokens";
import { useTodayPulse } from "@/api/queries";

function money(value: number): string {
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

/**
 * The glance that costs zero taps: tonight's revenue, checks, and the delta
 * against the same window last week. Sales data needs Toast; without it the
 * strip quietly shows only the decision count.
 */
export function PulseStrip() {
  const { data, isLoading } = useTodayPulse();

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

  const hasSales = data.revenueToday != null;

  return (
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
          Tonight
        </AppText>
        {hasSales ? (
          <>
            <AppText variant="display" style={{ marginTop: 2 }}>
              {money(data.revenueToday!)}
            </AppText>
            <AppText variant="footnote" tone="secondary">
              {data.checksToday != null ? `${data.checksToday} checks` : "sales so far"}
            </AppText>
          </>
        ) : (
          <AppText variant="headline" style={{ marginTop: 2 }}>
            {data.pendingDecisions === 0
              ? "All clear"
              : `${data.pendingDecisions} decision${data.pendingDecisions === 1 ? "" : "s"} waiting`}
          </AppText>
        )}
      </View>

      {hasSales && data.deltaPct != null ? (
        <View
          style={{
            backgroundColor: data.deltaPct >= 0 ? color.successTint : color.dangerTint,
            paddingHorizontal: space.md,
            paddingVertical: space.xs,
            borderRadius: 999,
          }}
        >
          <AppText
            variant="caption"
            style={{ color: data.deltaPct >= 0 ? color.success : color.danger }}
          >
            {data.deltaPct >= 0 ? "+" : ""}
            {data.deltaPct}% vs last week
          </AppText>
        </View>
      ) : null}
    </Card>
  );
}
