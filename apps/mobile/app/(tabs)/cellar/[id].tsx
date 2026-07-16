import React from "react";
import { ScrollView, View, useWindowDimensions } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { AppText } from "@/components/ui/AppText";
import { PressableScale } from "@/components/ui/PressableScale";
import { Card, Hairline, Screen } from "@/components/ui/Screen";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/StateViews";
import { SparklineBlock } from "@/components/cellar/Sparkline";
import { ProvenanceStitch } from "@/components/cellar/ProvenanceStitch";
import { color, space } from "@/design/tokens";
import { useInventoryItem, useItemActivity } from "@/api/queries";

function money(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(Number(value))) return null;
  return `$${Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

export default function WineDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { width } = useWindowDimensions();
  const { data: item, isLoading, isError, refetch } = useInventoryItem(id);
  const { data: activity } = useItemActivity(id);

  const contentWidth = width - space.lg * 2 - space.lg * 2;

  if (isError && !item) {
    return (
      <Screen>
        <ErrorState title="Couldn't load this wine" onAction={() => refetch()} />
      </Screen>
    );
  }

  const name = item?.wineName ?? item?.wine_name ?? "";
  const qty = item?.quantity ?? item?.lotLiveQty ?? 0;

  const dailyRaw: any[] = activity?.daily ?? activity?.series ?? [];
  const dailyValues = dailyRaw.map((d) =>
    Number(d.qty ?? d.total ?? d.depleted ?? d.count ?? d.value ?? 0),
  );

  const facts: Array<{ label: string; value: string }> = [];
  if (item?.vintage) facts.push({ label: "Vintage", value: String(item.vintage) });
  if (item?.region) facts.push({ label: "Region", value: String(item.region) });
  if (item?.varietal) facts.push({ label: "Varietal", value: String(item.varietal) });
  const wac = money(item?.wac);
  if (wac) {
    facts.push({
      label: item?.costProvenance === "invoice" ? "Cost (invoice)" : "Cost (est.)",
      value: wac,
    });
  }

  return (
    <Screen>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: space.md,
          paddingVertical: space.sm,
          gap: space.sm,
        }}
      >
        <PressableScale
          onPress={() => router.back()}
          accessibilityLabel="Back"
          style={{ padding: space.sm }}
        >
          <Ionicons name="chevron-back" size={24} color={color.inkSecondary} />
        </PressableScale>
        <AppText variant="caption" tone="tertiary">
          Cellar
        </AppText>
      </View>

      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.huge }}>
        {isLoading && !item ? (
          <Card style={{ gap: space.md }}>
            <Skeleton width={240} height={26} />
            <Skeleton width={150} height={14} />
            <Skeleton width="100%" height={56} />
          </Card>
        ) : (
          <>
            <Card style={{ gap: space.lg }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                <View style={{ flex: 1, paddingRight: space.lg }}>
                  <AppText variant="wineNameLarge">{name}</AppText>
                  {item?.producer ? (
                    <AppText variant="footnote" tone="secondary">
                      {String(item.producer)}
                    </AppText>
                  ) : null}
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <AppText variant="display" style={{ fontVariant: ["tabular-nums"] }}>
                    {qty}
                  </AppText>
                  <AppText variant="caption" tone="tertiary">
                    in stock
                  </AppText>
                </View>
              </View>

              <ProvenanceStitch wineId={id} facts={facts} width={contentWidth} />
            </Card>

            <Card style={{ gap: space.md }}>
              <SparklineBlock values={dailyValues} width={contentWidth} />
              <Hairline />
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Metric
                  label="Velocity"
                  value={
                    item?.velocityPerDay != null
                      ? `${Number(item.velocityPerDay).toFixed(1)}/day`
                      : "–"
                  }
                />
                <Metric
                  label="Days of cover"
                  value={item?.daysOfCover != null ? `${Math.round(Number(item.daysOfCover))}d` : "–"}
                />
                <Metric label="Class" value={item?.abcClass ?? "–"} />
              </View>
              {item?.reorderSuggested ? (
                <View
                  style={{
                    backgroundColor: color.wineTint,
                    borderRadius: 12,
                    padding: space.md,
                  }}
                >
                  <AppText variant="footnote" tone="wine">
                    Below its reorder point — expect it in the Today feed as an order proposal.
                  </AppText>
                </View>
              ) : null}
            </Card>

            {item?.locations && item.locations.length > 0 ? (
              <Card style={{ gap: space.sm }}>
                <AppText variant="caption" tone="tertiary">
                  Locations
                </AppText>
                {item.locations.map((loc, i) => (
                  <View key={loc.locationId ?? i}>
                    {i > 0 ? <Hairline /> : null}
                    <View
                      style={{
                        flexDirection: "row",
                        justifyContent: "space-between",
                        paddingVertical: space.sm,
                      }}
                    >
                      <AppText variant="body">
                        {loc.locationName ?? `Location ${i + 1}`}
                      </AppText>
                      <AppText variant="bodyMedium" style={{ fontVariant: ["tabular-nums"] }}>
                        {loc.qty}
                      </AppText>
                    </View>
                  </View>
                ))}
              </Card>
            ) : null}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
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
