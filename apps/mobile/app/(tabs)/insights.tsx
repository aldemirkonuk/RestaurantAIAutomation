import React, { useMemo } from "react";
import { Linking, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { AppText } from "@/components/ui/AppText";
import { PressableScale } from "@/components/ui/PressableScale";
import { Card, Hairline, Screen } from "@/components/ui/Screen";
import { Skeleton } from "@/components/ui/Skeleton";
import { FreshnessLabel } from "@/components/ui/StateViews";
import { color, space } from "@/design/tokens";
import {
  useGoalProgress,
  useGoals,
  useInsightFeed,
  useInventory,
  useInventorySummary,
  useTodayPulse,
} from "@/api/queries";
import type { InventoryItem } from "@/api/types";

const WEB_URL = process.env.EXPO_PUBLIC_WEB_URL;

function money(value: number): string {
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function itemName(i: InventoryItem): string {
  return String(i.wineName ?? i.wine_name ?? "Unnamed");
}

const CATEGORY_LABEL: Record<string, string> = {
  sales: "Sales",
  purchasing: "Purchasing",
  inventory: "Inventory",
  efficiency: "Efficiency",
  tables: "Tables",
  staff: "Staff",
  basket: "Pairings",
  risk: "Risk",
  forecast: "Forecast",
  goals: "Goals",
};

export default function InsightsScreen() {
  const router = useRouter();
  const pulse = useTodayPulse();
  const inventory = useInventory();
  const summary = useInventorySummary();
  const insights = useInsightFeed();
  const goals = useGoals();
  const activeGoals = (goals.data ?? []).filter(
    (g: any) => g.status === "active",
  );
  const topGoalProgress = useGoalProgress(activeGoals[0]?.id);

  const analytics = useMemo(() => {
    const items = inventory.data ?? [];
    const movers = items
      .filter((i) => (i.velocityPerDay ?? 0) > 0)
      .sort((a, b) => (b.velocityPerDay ?? 0) - (a.velocityPerDay ?? 0))
      .slice(0, 5);
    const reorder = items.filter((i) => i.reorderSuggested);
    const dead = items.filter((i) => i.deadStock);
    const deadValue = dead.reduce(
      (sum, i) => sum + (i.quantity ?? i.lotLiveQty ?? 0) * (i.wac ?? 0),
      0,
    );
    const abc = { A: 0, B: 0, C: 0 } as Record<"A" | "B" | "C", number>;
    for (const i of items) {
      if (i.abcClass && abc[i.abcClass] != null) abc[i.abcClass] += 1;
    }
    const abcTotal = abc.A + abc.B + abc.C;
    return { movers, reorder, dead, deadValue, abc, abcTotal };
  }, [inventory.data]);

  const maxVelocity = analytics.movers[0]?.velocityPerDay ?? 1;

  return (
    <Screen>
      <View style={{ paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.md }}>
        <AppText variant="title">Insights</AppText>
        <FreshnessLabel updatedAt={inventory.dataUpdatedAt || pulse.dataUpdatedAt || null} />
      </View>

      <ScrollView contentContainerStyle={{ padding: space.lg, paddingTop: 0, gap: space.md, paddingBottom: space.huge }}>
        {/* Conclusions — the plain-language insight box */}
        <Card style={{ gap: space.md }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <AppText variant="caption" tone="tertiary">
              What the numbers say
            </AppText>
            {WEB_URL ? (
              <PressableScale onPress={() => Linking.openURL(`${WEB_URL}/reports`)}>
                <AppText variant="caption" style={{ color: color.wine }}>
                  Full reports →
                </AppText>
              </PressableScale>
            ) : null}
          </View>
          {insights.isLoading && !insights.data ? (
            <View style={{ gap: space.sm }}>
              <Skeleton width="100%" height={15} />
              <Skeleton width="90%" height={15} />
              <Skeleton width="70%" height={15} />
            </View>
          ) : (insights.data?.length ?? 0) === 0 ? (
            <AppText variant="footnote" tone="tertiary">
              Conclusions appear as sales, pours, and orders accumulate — the
              engine turns your data into 1–2 sentence takeaways here.
            </AppText>
          ) : (
            insights.data!.slice(0, 6).map((ins, idx) => (
              <View key={`${ins.category}-${idx}`} style={{ gap: 4 }}>
                {idx > 0 ? <Hairline /> : null}
                <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingTop: idx > 0 ? space.xs : 0 }}>
                  <View
                    style={{
                      backgroundColor: color.wineTintStrong,
                      paddingHorizontal: space.sm,
                      paddingVertical: 2,
                      borderRadius: 999,
                    }}
                  >
                    <AppText variant="caption" style={{ color: color.wine }}>
                      {CATEGORY_LABEL[ins.category] ?? ins.category}
                    </AppText>
                  </View>
                </View>
                <AppText variant="body">{ins.sentence}</AppText>
              </View>
            ))
          )}
        </Card>

        {/* Goals — work toward a target with AI assistance */}
        <Card style={{ gap: space.md }}>
          <AppText variant="caption" tone="tertiary">
            Goals
          </AppText>
          {goals.isLoading && !goals.data ? (
            <Skeleton width="100%" height={15} />
          ) : activeGoals.length === 0 ? (
            <AppText variant="footnote" tone="tertiary">
              No active goals yet. Create one on the web dashboard — pick a
              metric, a target, and a deadline; the engine tracks pace and
              suggests levers here.
            </AppText>
          ) : (
            activeGoals.slice(0, 3).map((g: any, idx: number) => {
              const target = Number(g.target_value) || 0;
              const current = Number(g.current_value) || 0;
              const pct = target > 0 ? Math.min(1, current / target) : 0;
              const detail =
                idx === 0 && topGoalProgress.data ? topGoalProgress.data : null;
              return (
                <View key={g.id} style={{ gap: space.xs }}>
                  {idx > 0 ? <Hairline /> : null}
                  <View style={{ flexDirection: "row", justifyContent: "space-between", paddingTop: idx > 0 ? space.xs : 0 }}>
                    <AppText variant="bodyMedium" numberOfLines={1} style={{ flex: 1, paddingRight: space.md }}>
                      {g.name}
                    </AppText>
                    <AppText variant="footnote" tone="secondary" style={{ fontVariant: ["tabular-nums"] }}>
                      {Math.round(pct * 100)}%
                    </AppText>
                  </View>
                  <View style={{ height: 6, backgroundColor: color.fill, borderRadius: 3 }}>
                    <View
                      style={{
                        height: 6,
                        borderRadius: 3,
                        backgroundColor:
                          detail?.onTrack === false ? color.danger : color.wine,
                        width: `${Math.max(4, pct * 100)}%`,
                      }}
                    />
                  </View>
                  {detail ? (
                    <AppText variant="footnote" tone="secondary">
                      {detail.onTrack === false
                        ? `Behind pace${detail.daysLeft != null ? ` with ${detail.daysLeft} days left` : ""}.`
                        : detail.onTrack === true
                          ? `On pace${detail.daysLeft != null ? ` — ${detail.daysLeft} days left` : ""}.`
                          : ""}
                      {detail.suggestedActions?.[0]?.sentence
                        ? ` Lever: ${detail.suggestedActions[0].sentence}`
                        : ""}
                    </AppText>
                  ) : null}
                </View>
              );
            })
          )}
        </Card>

        {/* Sales */}
        <Card style={{ gap: space.md }}>
          <AppText variant="caption" tone="tertiary">
            Sales tonight
          </AppText>
          {pulse.isLoading && !pulse.data ? (
            <Skeleton width={170} height={26} />
          ) : pulse.data?.revenueToday != null ? (
            <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" }}>
              <View>
                <AppText variant="display">{money(pulse.data.revenueToday)}</AppText>
                <AppText variant="footnote" tone="secondary">
                  {pulse.data.checksToday != null ? `${pulse.data.checksToday} checks` : ""}
                </AppText>
              </View>
              {pulse.data.deltaPct != null ? (
                <View
                  style={{
                    backgroundColor:
                      pulse.data.deltaPct >= 0 ? color.successTint : color.dangerTint,
                    paddingHorizontal: space.md,
                    paddingVertical: space.xs,
                    borderRadius: 999,
                  }}
                >
                  <AppText
                    variant="caption"
                    style={{
                      color: pulse.data.deltaPct >= 0 ? color.success : color.danger,
                    }}
                  >
                    {pulse.data.deltaPct >= 0 ? "+" : ""}
                    {pulse.data.deltaPct}% vs last week
                  </AppText>
                </View>
              ) : null}
            </View>
          ) : (
            <AppText variant="footnote" tone="tertiary">
              Connect Toast on the web dashboard to see live sales here.
            </AppText>
          )}
        </Card>

        {/* Cellar value */}
        {summary.data ? (
          <Card style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <SummaryMetric
              label="Bottles"
              value={String(
                summary.data.totalBottles ?? summary.data.total_bottles ?? summary.data.totalItems ?? "–",
              )}
            />
            <SummaryMetric
              label="Cellar value"
              value={
                summary.data.totalValue ?? summary.data.total_value
                  ? money(Number(summary.data.totalValue ?? summary.data.total_value))
                  : "–"
              }
            />
            <SummaryMetric
              label="Low stock"
              value={String(summary.data.lowStockCount ?? summary.data.low_stock_count ?? "–")}
            />
          </Card>
        ) : null}

        {/* Movers */}
        <Card style={{ gap: space.md }}>
          <AppText variant="caption" tone="tertiary">
            Moving fastest
          </AppText>
          {inventory.isLoading && !inventory.data ? (
            <View style={{ gap: space.sm }}>
              <Skeleton width="100%" height={15} />
              <Skeleton width="80%" height={15} />
            </View>
          ) : analytics.movers.length === 0 ? (
            <AppText variant="footnote" tone="tertiary">
              Velocity appears after a few days of pours and sales.
            </AppText>
          ) : (
            analytics.movers.map((i) => (
              <PressableScale
                key={i.id}
                onPress={() => router.push({ pathname: "/cellar/[id]", params: { id: i.id } })}
                style={{ gap: 4 }}
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <AppText variant="body" numberOfLines={1} style={{ flex: 1, paddingRight: space.md }}>
                    {itemName(i)}
                  </AppText>
                  <AppText variant="footnote" tone="secondary" style={{ fontVariant: ["tabular-nums"] }}>
                    {Number(i.velocityPerDay).toFixed(1)}/day
                  </AppText>
                </View>
                <View style={{ height: 4, backgroundColor: color.fill, borderRadius: 2 }}>
                  <View
                    style={{
                      height: 4,
                      borderRadius: 2,
                      backgroundColor: color.wine,
                      width: `${Math.max(6, ((i.velocityPerDay ?? 0) / maxVelocity) * 100)}%`,
                    }}
                  />
                </View>
              </PressableScale>
            ))
          )}
        </Card>

        {/* Attention: reorder + dead stock */}
        <Card style={{ gap: space.sm }}>
          <AppText variant="caption" tone="tertiary">
            Needs attention
          </AppText>
          <Row
            label="Below reorder point"
            value={`${analytics.reorder.length} wine${analytics.reorder.length === 1 ? "" : "s"}`}
          />
          <Hairline />
          <Row
            label="Sitting still"
            value={
              analytics.dead.length
                ? `${analytics.dead.length} wines · ${money(analytics.deadValue)} idle`
                : "None"
            }
          />
          {analytics.abcTotal > 0 ? (
            <>
              <Hairline />
              <View style={{ gap: space.xs, paddingTop: space.xs }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <AppText variant="body" tone="secondary">
                    ABC mix
                  </AppText>
                  <AppText variant="caption" tone="tertiary">
                    A {analytics.abc.A} · B {analytics.abc.B} · C {analytics.abc.C}
                  </AppText>
                </View>
                <View style={{ flexDirection: "row", height: 6, borderRadius: 3, overflow: "hidden" }}>
                  <View style={{ flex: Math.max(analytics.abc.A, 0.01), backgroundColor: color.wine }} />
                  <View style={{ flex: Math.max(analytics.abc.B, 0.01), backgroundColor: color.wineTintStrong }} />
                  <View style={{ flex: Math.max(analytics.abc.C, 0.01), backgroundColor: color.fillStrong }} />
                </View>
              </View>
            </>
          ) : null}
        </Card>
      </ScrollView>
    </Screen>
  );
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <View>
      <AppText variant="caption" tone="tertiary">
        {label}
      </AppText>
      <AppText variant="headline" style={{ fontVariant: ["tabular-nums"] }}>
        {value}
      </AppText>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: space.xs }}>
      <AppText variant="body" tone="secondary">
        {label}
      </AppText>
      <AppText variant="bodyMedium">{value}</AppText>
    </View>
  );
}
