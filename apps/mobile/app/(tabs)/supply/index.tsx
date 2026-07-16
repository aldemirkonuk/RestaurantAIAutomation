import React, { useMemo } from "react";
import { SectionList, View } from "react-native";
import { useRouter } from "expo-router";
import { AppText } from "@/components/ui/AppText";
import { Screen } from "@/components/ui/Screen";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState, ErrorState, FreshnessLabel } from "@/components/ui/StateViews";
import { OrderRow } from "@/components/supply/OrderRow";
import { color, space } from "@/design/tokens";
import { useOrderHistory, usePendingOrders } from "@/api/queries";
import type { ProcurementOrder } from "@/api/types";

const OPEN_STATUSES = new Set([
  "PENDING",
  "APPROVAL_NEEDED",
  "NEGOTIATING",
  "APPROVED",
  "CONFIRMED",
  "IN_TRANSIT",
  "DELIVERED",
]);

export default function SupplyScreen() {
  const router = useRouter();
  const pending = usePendingOrders();
  const history = useOrderHistory();

  const sections = useMemo(() => {
    const all = new Map<string, ProcurementOrder>();
    for (const o of pending.data ?? []) all.set(o.id, o);
    for (const o of history.data ?? []) if (!all.has(o.id)) all.set(o.id, o);
    const orders = [...all.values()];
    const open = orders.filter((o) => OPEN_STATUSES.has(o.status));
    const closed = orders.filter((o) => !OPEN_STATUSES.has(o.status));
    const result = [];
    if (open.length) result.push({ title: "Open", data: open });
    if (closed.length) result.push({ title: "Done", data: closed.slice(0, 30) });
    return result;
  }, [pending.data, history.data]);

  const isLoading = (pending.isLoading || history.isLoading) && sections.length === 0;
  const isError = pending.isError && history.isError && sections.length === 0;

  return (
    <Screen>
      <View style={{ paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.md }}>
        <AppText variant="title">Supply</AppText>
        <FreshnessLabel updatedAt={pending.dataUpdatedAt || history.dataUpdatedAt || null} />
      </View>

      {isLoading ? (
        <View style={{ paddingHorizontal: space.lg, gap: space.md }}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={{ gap: 6 }}>
              <Skeleton width={200} height={17} />
              <Skeleton width={130} height={12} />
            </View>
          ))}
        </View>
      ) : isError ? (
        <ErrorState
          title="Couldn't load orders"
          onAction={() => {
            pending.refetch();
            history.refetch();
          }}
        />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <OrderRow
              order={item}
              onPress={() => router.push({ pathname: "/supply/[id]", params: { id: item.id } })}
            />
          )}
          renderSectionHeader={({ section }) => (
            <View
              style={{
                paddingHorizontal: space.lg,
                paddingTop: space.lg,
                paddingBottom: space.sm,
                backgroundColor: color.surfaceSecondary,
              }}
            >
              <AppText variant="caption" tone="tertiary">
                {section.title}
              </AppText>
            </View>
          )}
          ListEmptyComponent={
            <EmptyState
              title="No orders yet"
              message="Reorder proposals appear in Today; approved orders live here."
            />
          }
          stickySectionHeadersEnabled={false}
          contentContainerStyle={{ paddingBottom: space.huge }}
        />
      )}
    </Screen>
  );
}
