import React, { useState } from "react";
import { Alert, RefreshControl, ScrollView, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { AppText } from "@/components/ui/AppText";
import { PressableScale } from "@/components/ui/PressableScale";
import { Hairline, Screen } from "@/components/ui/Screen";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState, ErrorState, FreshnessLabel } from "@/components/ui/StateViews";
import { color, font, radius, space } from "@/design/tokens";
import {
  useNotificationActions,
  useNotifications,
  type InboxFilter,
} from "@/api/queries";
import { routeForActionUrl } from "@/lib/notificationRoute";
import type { AppNotification } from "@/api/types";

const TABS: Array<{ key: InboxFilter; label: string }> = [
  { key: "unread", label: "Unread" },
  { key: "read", label: "Read" },
  { key: "archived", label: "Archived" },
];

const PRIORITY_TONE: Record<string, string> = {
  critical: color.danger,
  high: color.warning,
  medium: color.inkTertiary,
  low: color.inkQuaternary,
};

function relative(iso?: string | null): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.round((Date.now() - then) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function NotificationRow({
  item,
  filter,
  onOpen,
  onRead,
  onUnread,
  onArchive,
  onDelete,
}: {
  item: AppNotification;
  filter: InboxFilter;
  onOpen: () => void;
  onRead: () => void;
  onUnread: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const destination = routeForActionUrl(item.actionUrl);
  const dot = PRIORITY_TONE[String(item.priority ?? "medium")] ?? color.inkTertiary;

  return (
    <View style={{ backgroundColor: color.surface }}>
      <PressableScale
        onPress={() => {
          setExpanded((v) => !v);
        }}
        accessibilityLabel={item.title}
        style={{
          flexDirection: "row",
          gap: space.md,
          paddingHorizontal: space.lg,
          paddingVertical: space.md,
        }}
      >
        <View
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            marginTop: 6,
            backgroundColor: filter === "unread" ? dot : "transparent",
            borderWidth: filter === "unread" ? 0 : 1,
            borderColor: color.fillStrong,
          }}
        />
        <View style={{ flex: 1, gap: 2 }}>
          <AppText
            variant={filter === "unread" ? "bodyMedium" : "body"}
            numberOfLines={expanded ? undefined : 1}
          >
            {item.title}
          </AppText>
          <AppText
            variant="footnote"
            tone="secondary"
            numberOfLines={expanded ? undefined : 2}
          >
            {item.message}
          </AppText>
          <AppText variant="caption" tone="tertiary">
            {relative(item.timestamp ?? item.createdAt)}
          </AppText>
        </View>
        <Ionicons
          name={expanded ? "chevron-up" : "chevron-down"}
          size={16}
          color={color.inkQuaternary}
          style={{ marginTop: 3 }}
        />
      </PressableScale>

      {expanded ? (
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            gap: space.sm,
            paddingHorizontal: space.lg,
            paddingBottom: space.md,
            paddingLeft: space.lg + 8 + space.md,
          }}
        >
          {destination ? (
            <Action label={item.actionLabel || "Open"} primary onPress={onOpen} />
          ) : null}
          {filter === "unread" ? (
            <Action label="Mark read" onPress={onRead} />
          ) : (
            <Action label="Mark unread" onPress={onUnread} />
          )}
          {filter !== "archived" ? (
            <Action label="Archive" onPress={onArchive} />
          ) : null}
          <Action label="Delete" destructive onPress={onDelete} />
        </View>
      ) : null}
      <Hairline inset={space.lg} />
    </View>
  );
}

function Action({
  label,
  onPress,
  primary,
  destructive,
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
  destructive?: boolean;
}) {
  return (
    <PressableScale
      onPress={onPress}
      accessibilityLabel={label}
      style={{
        paddingHorizontal: space.lg,
        paddingVertical: 7,
        borderRadius: radius.pill,
        backgroundColor: primary ? color.wine : color.fill,
      }}
    >
      <AppText
        variant="caption"
        tone={primary ? "onWine" : destructive ? "danger" : "secondary"}
      >
        {label}
      </AppText>
    </PressableScale>
  );
}

export default function NotificationsScreen() {
  const router = useRouter();
  const [filter, setFilter] = useState<InboxFilter>("unread");
  const { data, isLoading, isError, refetch, isRefetching, dataUpdatedAt } =
    useNotifications(filter);
  const actions = useNotificationActions();

  const items = data ?? [];

  const open = (item: AppNotification) => {
    const destination = routeForActionUrl(item.actionUrl);
    if (!destination) return;
    if (item.status === "unread") actions.markRead.mutate(item.id);
    router.push(destination as any);
  };

  const confirmDelete = (item: AppNotification) => {
    Alert.alert("Delete notification?", "This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => actions.remove.mutate(item.id),
      },
    ]);
  };

  return (
    <Screen edgeTop={false}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: "Notifications",
          headerStyle: { backgroundColor: color.surface },
          headerTitleStyle: {
            fontFamily: font.sansSemiBold,
            fontSize: 17,
            color: color.ink,
          },
          headerLeft: () => (
            <PressableScale onPress={() => router.back()} accessibilityLabel="Close">
              <Ionicons name="close" size={24} color={color.inkSecondary} />
            </PressableScale>
          ),
          headerRight: () =>
            filter === "unread" && items.length > 0 ? (
              <PressableScale
                onPress={() => {
                  actions.markAllRead.mutate();
                }}
                accessibilityLabel="Mark all read"
              >
                <AppText variant="caption" tone="wine">
                  Mark all read
                </AppText>
              </PressableScale>
            ) : null,
        }}
      />

      <View
        style={{
          flexDirection: "row",
          gap: space.sm,
          paddingHorizontal: space.lg,
          paddingVertical: space.md,
        }}
      >
        {TABS.map((t) => {
          const active = filter === t.key;
          return (
            <PressableScale
              key={t.key}
              onPress={() => setFilter(t.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              style={{
                paddingHorizontal: space.lg,
                paddingVertical: 7,
                borderRadius: radius.pill,
                backgroundColor: active ? color.wine : color.surface,
                borderWidth: 1,
                borderColor: active ? color.wine : color.hairline,
              }}
            >
              <AppText variant="caption" tone={active ? "onWine" : "secondary"}>
                {t.label}
              </AppText>
            </PressableScale>
          );
        })}
      </View>

      {isLoading && !data ? (
        <View style={{ paddingHorizontal: space.lg, gap: space.lg }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <View key={i} style={{ gap: 6 }}>
              <Skeleton width={220} height={16} />
              <Skeleton width={150} height={12} />
            </View>
          ))}
        </View>
      ) : isError && !data ? (
        <ErrorState
          title="Couldn't load notifications"
          message="Check your connection and try again."
          onAction={() => refetch()}
        />
      ) : (
        <ScrollView
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={color.inkQuaternary}
            />
          }
          contentContainerStyle={{ paddingBottom: space.huge }}
        >
          <FreshnessLabel updatedAt={dataUpdatedAt || null} />
          {items.length === 0 ? (
            <EmptyState
              title={
                filter === "unread"
                  ? "Nothing needs you"
                  : filter === "read"
                    ? "Nothing read yet"
                    : "Nothing archived"
              }
              message={
                filter === "unread"
                  ? "New alerts land here and on Today."
                  : undefined
              }
            />
          ) : (
            items.map((item) => (
              <NotificationRow
                key={item.id}
                item={item}
                filter={filter}
                onOpen={() => open(item)}
                onRead={() => actions.markRead.mutate(item.id)}
                onUnread={() => actions.markUnread.mutate(item.id)}
                onArchive={() => actions.archive.mutate(item.id)}
                onDelete={() => confirmDelete(item)}
              />
            ))
          )}
        </ScrollView>
      )}
    </Screen>
  );
}
