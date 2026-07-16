import React, { useMemo, useState } from "react";
import { TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { FlashList } from "@shopify/flash-list";
import { Ionicons } from "@expo/vector-icons";
import { AppText } from "@/components/ui/AppText";
import { PressableScale } from "@/components/ui/PressableScale";
import { Screen } from "@/components/ui/Screen";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState, ErrorState, FreshnessLabel } from "@/components/ui/StateViews";
import { WineRow } from "@/components/cellar/WineRow";
import { color, font, radius, space } from "@/design/tokens";
import { useInventory } from "@/api/queries";
import type { InventoryItem } from "@/api/types";

type Filter = "all" | "low" | "reorder" | "dead";

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "all", label: "All" },
  { key: "low", label: "Low" },
  { key: "reorder", label: "Reorder" },
  { key: "dead", label: "Still" },
];

export default function CellarScreen() {
  const router = useRouter();
  const { data, isLoading, isError, refetch, dataUpdatedAt } = useInventory();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const items = useMemo(() => {
    let list = data ?? [];
    if (filter === "low") {
      list = list.filter((i) => {
        const qty = i.quantity ?? i.lotLiveQty ?? 0;
        return qty <= (i.minimum_stock ?? 0) || qty <= 0;
      });
    } else if (filter === "reorder") {
      list = list.filter((i) => i.reorderSuggested);
    } else if (filter === "dead") {
      list = list.filter((i) => i.deadStock);
    }
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((i) =>
        [i.wineName ?? i.wine_name, i.producer, i.region, i.varietal]
          .filter(Boolean)
          .some((f) => String(f).toLowerCase().includes(q)),
      );
    }
    return [...list].sort((a, b) =>
      String(a.wineName ?? a.wine_name ?? "").localeCompare(
        String(b.wineName ?? b.wine_name ?? ""),
      ),
    );
  }, [data, query, filter]);

  return (
    <Screen>
      <View style={{ paddingHorizontal: space.lg, paddingTop: space.sm, gap: space.md }}>
        <AppText variant="title">Cellar</AppText>

        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            backgroundColor: color.surface,
            borderRadius: radius.control,
            borderWidth: 1,
            borderColor: color.hairline,
            paddingHorizontal: space.md,
            gap: space.sm,
          }}
        >
          <Ionicons name="search" size={17} color={color.inkQuaternary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search wine, producer, region"
            placeholderTextColor={color.inkQuaternary}
            style={{
              flex: 1,
              paddingVertical: 11,
              fontSize: 15,
              fontFamily: font.sans,
              color: color.ink,
            }}
            autoCorrect={false}
            clearButtonMode="while-editing"
          />
        </View>

        <View style={{ flexDirection: "row", gap: space.sm, paddingBottom: space.sm }}>
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <PressableScale
                key={f.key}
                onPress={() => setFilter(f.key)}
                style={{
                  paddingHorizontal: space.lg,
                  paddingVertical: 7,
                  borderRadius: 999,
                  backgroundColor: active ? color.wine : color.surface,
                  borderWidth: 1,
                  borderColor: active ? color.wine : color.hairline,
                }}
              >
                <AppText variant="caption" tone={active ? "onWine" : "secondary"}>
                  {f.label}
                </AppText>
              </PressableScale>
            );
          })}
        </View>
      </View>

      {isLoading && !data ? (
        <View style={{ paddingHorizontal: space.lg, gap: space.md, paddingTop: space.md }}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <View key={i} style={{ gap: 6 }}>
              <Skeleton width={210} height={17} />
              <Skeleton width={130} height={12} />
            </View>
          ))}
        </View>
      ) : isError && !data ? (
        <ErrorState
          title="Couldn't load the cellar"
          message="Check your connection and try again."
          onAction={() => refetch()}
        />
      ) : (
        <FlashList
          data={items}
          keyExtractor={(item: InventoryItem) => item.id}
          renderItem={({ item }) => (
            <WineRow
              item={item}
              onPress={() =>
                router.push({ pathname: "/cellar/[id]", params: { id: item.id } })
              }
            />
          )}
          ListHeaderComponent={<FreshnessLabel updatedAt={dataUpdatedAt || null} />}
          ListEmptyComponent={
            <EmptyState
              title={query ? "No matches" : "The cellar is empty"}
              message={
                query
                  ? "Try a producer or region instead."
                  : "Add wines from the web dashboard to see them here."
              }
            />
          }
          contentContainerStyle={{ paddingBottom: space.huge }}
        />
      )}
    </Screen>
  );
}
