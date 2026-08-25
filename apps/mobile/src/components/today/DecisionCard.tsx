import React, { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { AppText } from "@/components/ui/AppText";
import { PressableScale } from "@/components/ui/PressableScale";
import { color, radius, space } from "@/design/tokens";
import { GRACE_MS, spring } from "@/design/motion";
import { haptic } from "@/design/haptics";
import { feedKey, pulseKey } from "@/api/queries";
import { useOutbox } from "@/state/outbox";
import { useFeedLocal } from "@/state/feedLocal";
import type { FeedItem } from "@/api/types";

const KIND_LABEL: Record<FeedItem["kind"], string> = {
  order_approval: "Order",
  draft_approval: "Vendor reply",
  receipt_verification: "Delivery",
  alert: "Alert",
};

const KIND_ACCENT: Record<FeedItem["kind"], string> = {
  order_approval: color.wine,
  draft_approval: color.wine,
  receipt_verification: color.warning,
  alert: color.inkQuaternary,
};

interface DecisionCardProps {
  item: FeedItem;
  onHidden: (item: FeedItem) => void;
}

/**
 * One decision. Vendor-visible commits run the Ledger Fold: on approve the
 * card creases and a grace line drains for 8s (undo un-creases it, nothing
 * was sent); when the window expires the card folds closed and files itself
 * away with the commit thock — the moment the send actually fires.
 */
export function DecisionCard({ item, onHidden }: DecisionCardProps) {
  const router = useRouter();
  const enqueue = useOutbox((s) => s.enqueue);
  const undoEntry = useOutbox((s) => s.undo);
  const markCleared = useFeedLocal((s) => s.markCleared);

  const [holdingId, setHoldingId] = useState<string | null>(null);

  // Fold progress: 0 = flat, 0.1 = creased (holding), 1 = folded away.
  const fold = useSharedValue(0);
  const graceX = useSharedValue(1);
  const graceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (graceTimer.current) clearTimeout(graceTimer.current);
    },
    [],
  );

  const finishFold = useCallback(() => {
    haptic.commit();
    fold.value = withTiming(1, { duration: 380, easing: Easing.bezier(0.5, 0, 0.9, 0.4) }, (done) => {
      if (done) runOnJS(handleFolded)();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFolded = useCallback(() => {
    markCleared();
    onHidden(item);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item]);

  /** Vendor-visible commit: crease + grace window + fold on expiry. */
  const commitWithGrace = useCallback(
    (path: string, label: string, body?: unknown) => {
      const entryId = enqueue({
        path,
        body,
        label,
        graceMs: GRACE_MS,
        invalidate: [[...feedKey], [...pulseKey], ["orders", "pending"]],
        feedItemId: item.id,
      });
      setHoldingId(entryId);
      fold.value = withSpring(0.1, spring.gentle);
      graceX.value = 1;
      graceX.value = withTiming(0, { duration: GRACE_MS, easing: Easing.linear });
      graceTimer.current = setTimeout(finishFold, GRACE_MS);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [item.id],
  );

  const undo = useCallback(() => {
    if (!holdingId) return;
    if (graceTimer.current) clearTimeout(graceTimer.current);
    if (undoEntry(holdingId)) {
      useFeedLocal.getState().unhide(item.id);
      setHoldingId(null);
      fold.value = withSpring(0, spring.settle);
      graceX.value = withTiming(1, { duration: 180 });
      haptic.tick();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdingId, item.id]);

  /** Instant, not vendor-visible: quick file-away without the fold. */
  const instantAction = useCallback(
    (path: string, label: string, body?: unknown, method: "POST" | "PATCH" = "POST") => {
      enqueue({
        path,
        method,
        body,
        label,
        graceMs: 0,
        invalidate: [[...feedKey], [...pulseKey]],
        feedItemId: item.id,
      });
      haptic.confirm();
      fold.value = withTiming(1, { duration: 240, easing: Easing.bezier(0.4, 0, 1, 1) }, (done) => {
        if (done) runOnJS(handleFolded)();
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [item.id],
  );

  const open = useCallback(() => {
    if (holdingId) return;
    if (item.kind === "draft_approval" && item.orderId) {
      router.push({ pathname: "/draft/[orderId]", params: { orderId: item.orderId, feedItemId: item.id } });
    } else if (item.kind === "receipt_verification" && item.orderId) {
      router.push({
        pathname: "/cellar/receive/[orderId]",
        params: { orderId: item.orderId, feedItemId: item.id },
      });
    } else if (item.orderId) {
      router.push({ pathname: "/supply/[id]", params: { id: item.orderId } });
    }
  }, [holdingId, item, router]);

  const cardStyle = useAnimatedStyle(() => {
    const f = fold.value;
    return {
      opacity: 1 - Math.max(0, (f - 0.15) / 0.85) * 1,
      transform: [
        { perspective: 900 },
        { rotateX: `${-f * 82}deg` },
        { scale: 1 - f * 0.04 },
      ],
    };
  });

  const shadowStyle = useAnimatedStyle(() => ({
    opacity: fold.value * 0.5,
  }));

  const graceLineStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: graceX.value }],
  }));

  const primaryAction = (): { label: string; run: () => void; secondaryLabel?: string } => {
    switch (item.kind) {
      case "order_approval":
        return {
          label: "Approve",
          run: () =>
            commitWithGrace(
              `/procurement/orders/${item.orderId}/approve`,
              item.wineName ? `Order approved: ${item.wineName}` : "Order approved",
            ),
        };
      case "draft_approval":
        return { label: "Review & send", run: open };
      case "receipt_verification":
        return {
          label: "Counts match",
          run: () =>
            instantAction(
              `/procurement/orders/${item.orderId}/verify-receipt`,
              "Receipt verified",
              { adjustments: [] },
            ),
          secondaryLabel: "Count it",
        };
      case "alert":
        return {
          label: "Done",
          run: () =>
            instantAction(
              `/notifications/${item.notificationId}/read`,
              "Alert cleared",
              undefined,
              "PATCH",
            ),
        };
    }
  };

  const action = primaryAction();
  const holding = holdingId != null;

  return (
    <Animated.View style={[{ transformOrigin: "top" }, cardStyle]}>
      <PressableScale
        onPress={open}
        hapticTick={false}
        disabled={holding}
        style={{
          backgroundColor: color.surface,
          borderRadius: radius.card,
          borderWidth: 1,
          borderColor: holding ? color.wineTintStrong : color.hairline,
          marginHorizontal: space.lg,
          marginBottom: space.md,
          overflow: "hidden",
        }}
      >
        {/* Fold shading — deepens as the card closes */}
        <Animated.View
          pointerEvents="none"
          style={[
            { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: color.wineDeep, zIndex: 2 },
            shadowStyle,
          ]}
        />

        <View style={{ padding: space.lg, gap: space.xs }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <View
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: KIND_ACCENT[item.kind],
              }}
            />
            <AppText variant="caption" tone="tertiary">
              {KIND_LABEL[item.kind]}
              {item.priority === "critical" ? "  ·  needs you now" : ""}
            </AppText>
          </View>

          {item.wineName ? (
            <AppText variant="wineName">{item.wineName}</AppText>
          ) : (
            <AppText variant="headline">{item.title}</AppText>
          )}
          <AppText variant="footnote" tone="secondary" numberOfLines={2}>
            {item.subtitle}
          </AppText>

          <View style={{ flexDirection: "row", gap: space.sm, marginTop: space.sm }}>
            {!holding ? (
              <>
                <PressableScale
                  onPress={action.run}
                  style={{
                    backgroundColor: item.kind === "alert" ? color.fill : color.wine,
                    borderRadius: radius.control,
                    paddingVertical: 10,
                    paddingHorizontal: space.xl,
                  }}
                >
                  <AppText
                    variant="bodyMedium"
                    tone={item.kind === "alert" ? "primary" : "onWine"}
                  >
                    {action.label}
                  </AppText>
                </PressableScale>
                {item.kind !== "alert" && (item.orderId || item.conversationId) ? (
                  <PressableScale
                    onPress={open}
                    style={{
                      borderRadius: radius.control,
                      paddingVertical: 10,
                      paddingHorizontal: space.lg,
                      backgroundColor: color.fill,
                    }}
                  >
                    <AppText variant="bodyMedium">{action.secondaryLabel ?? "Details"}</AppText>
                  </PressableScale>
                ) : null}
              </>
            ) : (
              <PressableScale
                onPress={undo}
                style={{
                  borderRadius: radius.control,
                  paddingVertical: 10,
                  paddingHorizontal: space.xl,
                  backgroundColor: color.wineTint,
                  borderWidth: 1,
                  borderColor: color.wineTintStrong,
                }}
              >
                <AppText variant="bodyMedium" tone="wine">
                  Undo — sending…
                </AppText>
              </PressableScale>
            )}
          </View>
        </View>

        {/* Grace line: drains left-to-right while the send holds */}
        {holding ? (
          <Animated.View
            style={[
              {
                height: 2,
                backgroundColor: color.wine,
                transformOrigin: "left",
              },
              graceLineStyle,
            ]}
          />
        ) : null}
      </PressableScale>
    </Animated.View>
  );
}
