import React, { useCallback } from "react";
import { ScrollView, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { AppText } from "@/components/ui/AppText";
import { PressableScale } from "@/components/ui/PressableScale";
import { Card, Hairline, Screen } from "@/components/ui/Screen";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/StateViews";
import { STATUS_LABEL, orderAmount } from "@/components/supply/OrderRow";
import { color, radius, space } from "@/design/tokens";
import { haptic } from "@/design/haptics";
import {
  feedKey,
  pulseKey,
  useOrder,
  useOrderConversations,
} from "@/api/queries";
import { OrderApprovalSeal } from "@/components/supply/OrderApprovalSeal";
import { useOutbox } from "@/state/outbox";

const TIMELINE: string[] = [
  "PENDING",
  "APPROVED",
  "CONFIRMED",
  "DELIVERED",
  "COMPLETED",
];

function timelineIndex(status: string): number {
  if (status === "APPROVAL_NEEDED" || status === "NEGOTIATING") return 0;
  if (status === "IN_TRANSIT") return 2;
  const i = TIMELINE.indexOf(status);
  return i === -1 ? 0 : i;
}

export default function OrderDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: order, isLoading, isError, refetch } = useOrder(id);
  const { data: conversations } = useOrderConversations(id);

  const approved = useCallback(() => {
    void refetch();
  }, [refetch]);

  const markDelivered = () => {
    if (!order) return;
    useOutbox.getState().enqueue({
      path: `/procurement/orders/${order.id}/deliver`,
      label: "Marked delivered",
      graceMs: 0,
      invalidate: [
        [...feedKey],
        ["orders", "pending"],
        ["orders", "history"],
        ["orders", "item", order.id],
      ],
    });
    haptic.confirm();
    setTimeout(() => refetch(), 600);
  };

  if (isError && !order) {
    return (
      <Screen>
        <ErrorState
          title="Couldn't load this order"
          onAction={() => refetch()}
        />
      </Screen>
    );
  }

  const canApprove =
    order && ["PENDING", "APPROVAL_NEEDED"].includes(order.status);
  const canDeliver =
    order && ["APPROVED", "CONFIRMED", "IN_TRANSIT"].includes(order.status);
  const canReceive = order && order.status === "DELIVERED";
  const step = order ? timelineIndex(order.status) : 0;
  const amount = order ? orderAmount(order) : null;

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
          {order?.orderNumber ?? "Order"}
        </AppText>
      </View>

      <ScrollView
        contentContainerStyle={{
          padding: space.lg,
          gap: space.md,
          paddingBottom: space.huge,
        }}
      >
        {isLoading && !order ? (
          <Card style={{ gap: space.md }}>
            <Skeleton width={220} height={22} />
            <Skeleton width={140} height={14} />
          </Card>
        ) : order ? (
          <>
            <Card style={{ gap: space.lg, overflow: "hidden" }}>
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                }}
              >
                <View style={{ flex: 1, paddingRight: space.md }}>
                  {order.wineName ? (
                    <AppText variant="wineName">{order.wineName}</AppText>
                  ) : (
                    <AppText variant="headline">{order.orderNumber}</AppText>
                  )}
                  <AppText variant="footnote" tone="secondary">
                    {order.quantity ? `${order.quantity} bottles` : ""}
                    {amount ? `  ·  ${amount}` : ""}
                  </AppText>
                </View>
                <AppText variant="caption" tone="wine">
                  {STATUS_LABEL[order.status] ?? order.status}
                </AppText>
              </View>

              {/* Status timeline */}
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                {TIMELINE.map((s, i) => (
                  <React.Fragment key={s}>
                    {i > 0 ? (
                      <View
                        style={{
                          flex: 1,
                          height: 2,
                          backgroundColor:
                            i <= step ? color.wine : color.fillStrong,
                        }}
                      />
                    ) : null}
                    <View
                      style={{
                        width: i === step ? 10 : 8,
                        height: i === step ? 10 : 8,
                        borderRadius: 5,
                        backgroundColor:
                          i <= step ? color.wine : color.fillStrong,
                      }}
                    />
                  </React.Fragment>
                ))}
              </View>

              {canApprove ? (
                <OrderApprovalSeal orderId={order.id} onApproved={approved} />
              ) : canDeliver ? (
                <PressableScale
                  onPress={markDelivered}
                  style={{
                    backgroundColor: color.fill,
                    borderRadius: radius.control,
                    paddingVertical: 13,
                    alignItems: "center",
                  }}
                >
                  <AppText variant="bodyMedium">
                    It arrived — mark delivered
                  </AppText>
                </PressableScale>
              ) : canReceive ? (
                <PressableScale
                  onPress={() =>
                    router.push({
                      pathname: "/cellar/receive/[orderId]",
                      params: { orderId: order.id },
                    })
                  }
                  style={{
                    backgroundColor: color.wine,
                    borderRadius: radius.control,
                    paddingVertical: 13,
                    alignItems: "center",
                  }}
                >
                  <AppText variant="bodyMedium" tone="onWine">
                    Count & verify receipt
                  </AppText>
                </PressableScale>
              ) : null}
            </Card>

            {conversations && conversations.length > 0 ? (
              <Card style={{ gap: space.sm }}>
                <AppText variant="caption" tone="tertiary">
                  Vendor thread
                </AppText>
                {conversations.slice(0, 12).map((c: any, i: number) => (
                  <View key={c.id ?? i}>
                    {i > 0 ? <Hairline /> : null}
                    <View style={{ paddingVertical: space.sm, gap: 2 }}>
                      <AppText
                        variant="caption"
                        tone={c.direction === "outbound" ? "wine" : "tertiary"}
                      >
                        {c.direction === "outbound"
                          ? "You / AI"
                          : (c.providers?.name ?? "Vendor")}
                        {c.created_at
                          ? `  ·  ${new Date(c.created_at).toLocaleDateString(
                              undefined,
                              {
                                month: "short",
                                day: "numeric",
                              },
                            )}`
                          : ""}
                      </AppText>
                      <AppText variant="footnote" numberOfLines={4}>
                        {String(c.content ?? c.summary ?? "").trim()}
                      </AppText>
                    </View>
                  </View>
                ))}
              </Card>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
