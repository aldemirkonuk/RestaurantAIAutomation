import React from "react";
import { View } from "react-native";
import { AppText } from "@/components/ui/AppText";
import { PressableScale } from "@/components/ui/PressableScale";
import { color, space } from "@/design/tokens";
import type { ProcurementOrder } from "@/api/types";

export const STATUS_LABEL: Record<string, string> = {
  PENDING: "Awaiting approval",
  APPROVAL_NEEDED: "Awaiting approval",
  NEGOTIATING: "Negotiating",
  APPROVED: "Approved",
  CONFIRMED: "Confirmed",
  IN_TRANSIT: "On its way",
  DELIVERED: "Delivered — verify",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  REJECTED: "Rejected",
  FAILED: "Failed",
};

const STATUS_TONE: Record<string, string> = {
  PENDING: color.wine,
  APPROVAL_NEEDED: color.wine,
  NEGOTIATING: color.warning,
  APPROVED: color.success,
  CONFIRMED: color.success,
  IN_TRANSIT: color.warning,
  DELIVERED: color.warning,
  COMPLETED: color.inkQuaternary,
  CANCELLED: color.inkQuaternary,
  REJECTED: color.danger,
  FAILED: color.danger,
};

function money(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(Number(value))) return null;
  return `$${Number(value).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export function orderAmount(order: ProcurementOrder): string | null {
  return money(
    order.totalCost ?? order.finalPrice ?? order.negotiatedPrice ?? order.quotedPrice,
  );
}

export function OrderRow({
  order,
  onPress,
}: {
  order: ProcurementOrder;
  onPress: () => void;
}) {
  const tone = STATUS_TONE[order.status] ?? color.inkQuaternary;
  const amount = orderAmount(order);

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
        {order.wineName ? (
          <AppText variant="wineName" numberOfLines={1} style={{ fontSize: 17, lineHeight: 22 }}>
            {order.wineName}
          </AppText>
        ) : (
          <AppText variant="headline" numberOfLines={1}>
            {order.orderNumber ?? "Order"}
          </AppText>
        )}
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: 2 }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: tone }} />
          <AppText variant="caption" tone="tertiary">
            {STATUS_LABEL[order.status] ?? order.status}
            {order.quantity ? `  ·  ${order.quantity} btl` : ""}
          </AppText>
        </View>
      </View>
      {amount ? (
        <AppText variant="bodyMedium" style={{ fontVariant: ["tabular-nums"] }}>
          {amount}
        </AppText>
      ) : null}
    </PressableScale>
  );
}
