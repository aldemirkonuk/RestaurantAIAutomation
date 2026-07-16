import React, { useCallback, useEffect, useRef, useState } from "react";
import { RefreshControl, View } from "react-native";
import { useRouter } from "expo-router";
import Animated, {
  FadeInDown,
  LinearTransition,
} from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { AppText } from "@/components/ui/AppText";
import { PressableScale } from "@/components/ui/PressableScale";
import { Screen } from "@/components/ui/Screen";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState, ErrorState, FreshnessLabel } from "@/components/ui/StateViews";
import { PulseStrip } from "@/components/today/PulseStrip";
import { DecisionCard } from "@/components/today/DecisionCard";
import { FeedZero } from "@/components/today/FeedZero";
import { color, space } from "@/design/tokens";
import { useFeed } from "@/api/queries";
import { useFeedLocal } from "@/state/feedLocal";
import { useOutbox } from "@/state/outbox";
import { useSession } from "@/state/session";
import type { FeedItem } from "@/api/types";

/** Sediment Settle — remaining cards drift down and settle after a removal. */
const sedimentTransition = LinearTransition.springify()
  .damping(30)
  .stiffness(180)
  .mass(1.1);

export default function TodayScreen() {
  const router = useRouter();
  const user = useSession((s) => s.user);
  const { data, isLoading, isError, refetch, isRefetching, dataUpdatedAt } = useFeed();
  const hidden = useFeedLocal((s) => s.hidden);
  const clearedThisSession = useFeedLocal((s) => s.clearedThisSession);
  const entries = useOutbox((s) => s.entries);

  // Locally-dismissed items that the server hasn't confirmed yet stay hidden.
  const [locallyGone, setLocallyGone] = useState<Set<string>>(new Set());
  const onHidden = useCallback((item: FeedItem) => {
    setLocallyGone((prev) => new Set(prev).add(item.id));
  }, []);

  // A permanent server rejection resurrects its card with a warning row.
  const failed = entries.filter((e) => e.status === "failed");
  useEffect(() => {
    if (!failed.length) return;
    setLocallyGone((prev) => {
      const next = new Set(prev);
      for (const f of failed) {
        if (f.feedItemId) {
          next.delete(f.feedItemId);
          useFeedLocal.getState().unhide(f.feedItemId);
        }
      }
      return next;
    });
  }, [failed.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // hidden = items being handled outside their card (e.g. the draft screen).
  const items = (data?.items ?? []).filter(
    (i) => !locallyGone.has(i.id) && !hidden[i.id],
  );

  // Feed Zero fires when the last visible decision leaves — once per session.
  const [showZero, setShowZero] = useState(false);
  const firedZero = useRef(false);
  const prevCount = useRef(0);
  useEffect(() => {
    if (prevCount.current > 0 && items.length === 0 && !firedZero.current) {
      firedZero.current = true;
      setShowZero(true);
    }
    prevCount.current = items.length;
  }, [items.length]);

  const greeting = (() => {
    const h = new Date().getHours();
    const name = user?.name ? `, ${user.name.split(" ")[0]}` : "";
    if (h < 11) return `Morning${name}`;
    if (h < 17) return `Afternoon${name}`;
    return `Evening${name}`;
  })();

  return (
    <Screen>
      {/* Header */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: space.lg,
          paddingTop: space.sm,
          paddingBottom: space.md,
        }}
      >
        <View>
          <AppText variant="title">{greeting}</AppText>
          <FreshnessLabel updatedAt={dataUpdatedAt || null} />
        </View>
        <PressableScale
          onPress={() => router.push("/settings")}
          accessibilityLabel="Settings"
          style={{
            width: 38,
            height: 38,
            borderRadius: 999,
            backgroundColor: color.wineTint,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <AppText variant="bodyMedium" tone="wine">
            {(user?.name ?? user?.email ?? "W").slice(0, 1).toUpperCase()}
          </AppText>
        </PressableScale>
      </View>

      <Animated.FlatList
        data={items}
        keyExtractor={(item) => item.id}
        itemLayoutAnimation={sedimentTransition}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={color.wine}
          />
        }
        ListHeaderComponent={
          <>
            <PulseStrip />
            {failed.length > 0 ? (
              <View style={{ marginHorizontal: space.lg, marginBottom: space.md, gap: space.sm }}>
                {failed.map((f) => (
                  <View
                    key={f.id}
                    style={{
                      backgroundColor: color.dangerTint,
                      borderRadius: 12,
                      padding: space.md,
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <View style={{ flex: 1, paddingRight: space.sm }}>
                      <AppText variant="footnote" tone="danger">
                        {f.label} didn't go through
                      </AppText>
                      {f.lastError ? (
                        <AppText variant="caption" tone="tertiary" numberOfLines={1}>
                          {f.lastError}
                        </AppText>
                      ) : null}
                    </View>
                    <PressableScale onPress={() => useOutbox.getState().dismissFailed(f.id)}>
                      <Ionicons name="close" size={18} color={color.inkTertiary} />
                    </PressableScale>
                  </View>
                ))}
              </View>
            ) : null}
          </>
        }
        renderItem={({ item, index }) => (
          <Animated.View entering={FadeInDown.delay(Math.min(index * 40, 240)).duration(300)}>
            <DecisionCard item={item} onHidden={onHidden} />
          </Animated.View>
        )}
        ListEmptyComponent={
          isLoading ? (
            <View style={{ paddingHorizontal: space.lg, gap: space.md }}>
              {[0, 1, 2].map((i) => (
                <View
                  key={i}
                  style={{
                    backgroundColor: color.surface,
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: color.hairline,
                    padding: space.lg,
                    gap: space.sm,
                  }}
                >
                  <Skeleton width={80} height={11} />
                  <Skeleton width={220} height={18} />
                  <Skeleton width={160} height={13} />
                </View>
              ))}
            </View>
          ) : isError ? (
            <ErrorState
              title="Couldn't reach the cellar"
              message="Check your connection. Anything you approve meanwhile is queued safely."
              onAction={() => refetch()}
            />
          ) : (
            <EmptyState
              title="Nothing needs you"
              message="New approvals, deliveries, and alerts land here the moment they exist."
            />
          )
        }
        contentContainerStyle={{ paddingBottom: space.huge }}
        showsVerticalScrollIndicator={false}
      />

      {showZero ? (
        <FeedZero clearedCount={clearedThisSession} onDone={() => setShowZero(false)} />
      ) : null}
    </Screen>
  );
}
