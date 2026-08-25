import React from "react";
import { View } from "react-native";
import { AppText } from "@/components/ui/AppText";
import { PressableScale } from "@/components/ui/PressableScale";
import { color, space } from "@/design/tokens";
import type { InventoryItem } from "@/api/types";

function stockTone(item: InventoryItem): "primary" | "warning" | "danger" {
  const qty = item.quantity ?? item.lotLiveQty ?? 0;
  const min = item.minimum_stock ?? 0;
  if (qty <= 0) return "danger";
  if (min > 0 && qty <= min) return "warning";
  return "primary";
}

export function WineRow({
  item,
  onPress,
}: {
  item: InventoryItem;
  onPress: () => void;
}) {
  const qty = item.quantity ?? item.lotLiveQty ?? 0;
  const name = item.wineName ?? item.wine_name ?? "Unnamed wine";
  const facts = [item.vintage, item.region, item.varietal]
    .filter(Boolean)
    .join(" · ");
  const tone = stockTone(item);

  return (
    <PressableScale
      onPress={onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: color.surface,
        paddingHorizontal: space.lg,
        paddingVertical: space.md,
        borderBottomWidth: 1,
        borderBottomColor: color.hairline,
      }}
    >
      <View style={{ flex: 1, paddingRight: space.md }}>
        <AppText variant="wineName" numberOfLines={1} style={{ fontSize: 17, lineHeight: 22 }}>
          {name}
        </AppText>
        {facts ? (
          <AppText variant="caption" tone="tertiary" numberOfLines={1}>
            {facts}
          </AppText>
        ) : null}
        {item.reorderSuggested || item.deadStock ? (
          <View style={{ flexDirection: "row", gap: space.xs, marginTop: 3 }}>
            {item.reorderSuggested ? (
              <View
                style={{
                  backgroundColor: color.wineTint,
                  paddingHorizontal: space.sm,
                  paddingVertical: 1,
                  borderRadius: 999,
                }}
              >
                <AppText variant="caption" tone="wine" style={{ fontSize: 10.5 }}>
                  reorder
                </AppText>
              </View>
            ) : null}
            {item.deadStock ? (
              <View
                style={{
                  backgroundColor: color.fill,
                  paddingHorizontal: space.sm,
                  paddingVertical: 1,
                  borderRadius: 999,
                }}
              >
                <AppText variant="caption" tone="tertiary" style={{ fontSize: 10.5 }}>
                  {item.daysSinceSale ? `${item.daysSinceSale}d still` : "still"}
                </AppText>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>

      <View style={{ alignItems: "flex-end" }}>
        <AppText
          variant="headline"
          tone={tone === "primary" ? "primary" : tone}
          style={{ fontVariant: ["tabular-nums"] }}
        >
          {qty}
        </AppText>
        <AppText variant="caption" tone="tertiary">
          {qty === 1 ? "bottle" : "bottles"}
        </AppText>
      </View>
    </PressableScale>
  );
}
