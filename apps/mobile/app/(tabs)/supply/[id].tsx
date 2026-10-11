import React, { useCallback, useState } from "react";
import { Alert, ScrollView, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { AppText } from "@/components/ui/AppText";
import { PressableScale } from "@/components/ui/PressableScale";
import { Card, Hairline, Screen } from "@/components/ui/Screen";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/StateViews";
import { orderAmount } from "@/components/supply/OrderRow";
import {
  STATUS_LABEL,
  TIMELINE,
  deliverWithCountPath,
  orderUnitWords,
  receiveActionLabel,
  timelineIndex,
} from "@/lib/orderStatus";
import { color, radius, space } from "@/design/tokens";
import { haptic } from "@/design/haptics";
import {
  feedKey,
  pulseKey,
  useHouseMoneyFrame,
  useOrder,
  useOrderConversations,
} from "@/api/queries";
import { OrderApprovalSeal } from "@/components/supply/OrderApprovalSeal";
import {
  DELIVERED_WAITING_WORDS,
  NOT_SAVED_WORDS,
  useOutbox,
  waitingFor,
} from "@/state/outbox";
import { useSession } from "@/state/session";
import { houseDay } from "@/lib/houseMoney";

export default function OrderDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: order, isLoading, isError, refetch } = useOrder(id);
  const { data: conversations } = useOrderConversations(id);
  const house = useHouseMoneyFrame();
  // The delivery mark still on this phone (F-956): shown under the order, and
  // the button stays shut so a second tap cannot queue it again.
  const user = useSession((s) => s.user);
  const deliverPath = `/procurement/orders/${id}/deliver`;
  const deliverWaiting = useOutbox(
    (s) => waitingFor(s.entries, user, deliverPath) != null,
  );

  const approved = useCallback(() => {
    void refetch();
  }, [refetch]);

  // What came off the truck, in the order's unit (F-1182). Null until "It
  // arrived" is pressed; the ordered figure is only where the count starts,
  // and nothing is marked until the person says it is their count.
  const [arrivedCount, setArrivedCount] = useState<number | null>(null);

  const markDelivered = () => {
    if (!order || deliverWaiting || arrivedCount == null) return;
    const path = deliverWithCountPath(order.id, arrivedCount);
    if (!path) return;
    const saved = useOutbox.getState().enqueue({
      path,
      label: "Marked delivered",
      graceMs: 0,
      // Names the truck on the waiting and parked rows (F-1408).
      about: {
        orderId: order.id,
        orderNumber: order.orderNumber,
        subject: order.wineName ?? order.providerName,
      },
      invalidate: [
        [...feedKey],
        ["orders", "pending"],
        ["orders", "history"],
        ["orders", "item", order.id],
      ],
    });
    if (!saved) {
      Alert.alert(NOT_SAVED_WORDS);
      return;
    }
    haptic.confirm();
    setArrivedCount(null);
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
  // DELIVERED counts the truck; PARTIALLY_RECEIVED adds its invoice (F-589).
  const receiveLabel = order ? receiveActionLabel(order.status) : null;
  const step = order ? timelineIndex(order.status) : 0;
  const amount = order ? orderAmount(order, house) : null;

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
                    {order.quantity ? orderUnitWords(order.unitType, order.quantity) : ""}
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
                <View style={{ gap: space.sm }}>
                  {arrivedCount != null && !deliverWaiting ? (
                    <>
                      <AppText variant="footnote" tone="secondary">
                        How many came off the truck? It starts at what was
                        ordered; change it if the truck was short.
                      </AppText>
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: space.lg,
                        }}
                      >
                        <CountStep
                          label="−"
                          onPress={() =>
                            setArrivedCount((n) => Math.max(0, (n ?? 0) - 1))
                          }
                          disabled={arrivedCount <= 0}
                        />
                        <AppText
                          variant="title"
                          style={{
                            fontVariant: ["tabular-nums"],
                            minWidth: 120,
                            textAlign: "center",
                          }}
                        >
                          {orderUnitWords(order.unitType, arrivedCount)}
                        </AppText>
                        <CountStep
                          label="+"
                          onPress={() => setArrivedCount((n) => (n ?? 0) + 1)}
                        />
                      </View>
                      <PressableScale
                        onPress={markDelivered}
                        style={{
                          backgroundColor: color.wine,
                          borderRadius: radius.control,
                          paddingVertical: 13,
                          alignItems: "center",
                        }}
                      >
                        <AppText variant="bodyMedium" tone="onWine">
                          That's my count — mark delivered
                        </AppText>
                      </PressableScale>
                    </>
                  ) : (
                    <PressableScale
                      onPress={() =>
                        setArrivedCount(
                          Number.isSafeInteger(order.quantity) &&
                            (order.quantity as number) >= 0
                            ? (order.quantity as number)
                            : 0,
                        )
                      }
                      disabled={deliverWaiting}
                      style={{
                        backgroundColor: color.fill,
                        borderRadius: radius.control,
                        paddingVertical: 13,
                        alignItems: "center",
                        opacity: deliverWaiting ? 0.6 : 1,
                      }}
                    >
                      <AppText variant="bodyMedium">
                        {deliverWaiting
                          ? "Saved on this phone"
                          : "It arrived — count it in"}
                      </AppText>
                    </PressableScale>
                  )}
                  {deliverWaiting ? (
                    <AppText variant="caption" tone="tertiary" align="center">
                      {DELIVERED_WAITING_WORDS}
                    </AppText>
                  ) : null}
                </View>
              ) : receiveLabel ? (
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
                    {receiveLabel}
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
                          ? // The house's day, in its zone and words (F-1029).
                            `  ·  ${houseDay(c.created_at, house.locale, house.timeZone, {
                              month: "short",
                              day: "numeric",
                            })}`
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

function CountStep({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={label === "+" ? "One more" : "One fewer"}
      style={{
        width: 44,
        height: 44,
        borderRadius: 999,
        backgroundColor: color.fill,
        alignItems: "center",
        justifyContent: "center",
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <AppText variant="title">{label}</AppText>
    </PressableScale>
  );
}
