import React, { useEffect, useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { AppText } from "@/components/ui/AppText";
import { Card, Hairline, Screen } from "@/components/ui/Screen";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState, FreshnessLabel } from "@/components/ui/StateViews";
import { color, space } from "@/design/tokens";
import {
  useHouseMoneyFrame,
  useMyTeamWeek,
  useTeamMembers,
  useTeamWeek,
  useTodaySchedule,
  useUpcomingSchedule,
} from "@/api/queries";
import { readsFullRota, resolveTonight, seesFullRota } from "@/components/team/teamTonight";
import { useSession } from "@/state/session";
import { houseClock, houseDay } from "@/lib/houseMoney";

export default function TeamScreen() {
  const role = useSession((s) => s.user?.role);
  // Shift times on the house's clock (F-953): "19:00" in a Turkish house.
  const { locale } = useHouseMoneyFrame();
  const fmtTime = (value?: string) => houseClock(value, locale);
  // The house's zone, once a week reply names it; until then the phone's own
  // date (F-252). A changed zone can move the week, which re-keys the read.
  const [houseZone, setHouseZone] = useState<string | null>(null);
  const week = useTeamWeek(houseZone, seesFullRota(role));
  const fullRota = readsFullRota(role, week.error);
  // Staff are refused the full rota, so they read their own week (F-251).
  const mine = useMyTeamWeek(houseZone, !fullRota);
  const members = useTeamMembers(fullRota);
  const replyZone: string | null =
    (fullRota ? week.data?.timezone : mine.data?.timezone) ?? null;
  useEffect(() => {
    if (replyZone && replyZone !== houseZone) setHouseZone(replyZone);
  }, [replyZone, houseZone]);
  const todayEvents = useTodaySchedule();
  const upcoming = useUpcomingSchedule();

  const memberName = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members.data ?? []) {
      map.set(
        m.id ?? m.member_id ?? m.user_id,
        m.display_name ?? m.name ?? m.full_name ?? m.email ?? "Team member",
      );
    }
    return map;
  }, [members.data]);

  const tonight = resolveTonight({ role, week, mine, now: new Date() });
  const ownName: string | undefined = mine.data?.member?.display_name ?? undefined;

  return (
    <Screen>
      <View style={{ paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.md }}>
        <AppText variant="title">Team</AppText>
        <FreshnessLabel
          updatedAt={
            (fullRota ? week.dataUpdatedAt : mine.dataUpdatedAt) || todayEvents.dataUpdatedAt || null
          }
        />
      </View>

      <ScrollView contentContainerStyle={{ padding: space.lg, paddingTop: 0, gap: space.md, paddingBottom: space.huge }}>
        {/* Who's on tonight */}
        <Card style={{ gap: space.sm }}>
          <AppText variant="caption" tone="tertiary">
            {tonight.caption}
          </AppText>
          {tonight.kind === "loading" ? (
            <View style={{ gap: space.sm }}>
              <Skeleton width={190} height={15} />
              <Skeleton width={150} height={15} />
            </View>
          ) : tonight.kind === "error" || tonight.kind === "none" ? (
            <AppText variant="footnote" tone="tertiary">
              {tonight.message}
            </AppText>
          ) : (
            tonight.shifts.map((s, i) => (
              <View key={s.id ?? i}>
                {i > 0 ? <Hairline /> : null}
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "center",
                    paddingVertical: space.sm,
                  }}
                >
                  <View style={{ flex: 1, paddingRight: space.md }}>
                    <AppText variant="bodyMedium" numberOfLines={1}>
                      {(tonight.own ? ownName : memberName.get(s.member_id ?? s.user_id)) ??
                        s.member_name ??
                        "Unassigned"}
                    </AppText>
                    {s.role || s.position ? (
                      <AppText variant="caption" tone="tertiary">
                        {s.role ?? s.position}
                      </AppText>
                    ) : null}
                  </View>
                  <AppText variant="footnote" tone="secondary" style={{ fontVariant: ["tabular-nums"] }}>
                    {fmtTime(s.start_time)}–{fmtTime(s.end_time)}
                  </AppText>
                </View>
              </View>
            ))
          )}
          {tonight.note ? (
            <AppText variant="caption" tone="tertiary">
              {tonight.note}
            </AppText>
          ) : null}
        </Card>

        {/* Today at the restaurant */}
        <Card style={{ gap: space.sm }}>
          <AppText variant="caption" tone="tertiary">
            Today at the restaurant
          </AppText>
          {todayEvents.isLoading && !todayEvents.data ? (
            <Skeleton width={210} height={15} />
          ) : (todayEvents.data ?? []).length === 0 ? (
            <AppText variant="footnote" tone="tertiary">
              No events on today's calendar.
            </AppText>
          ) : (
            (todayEvents.data ?? []).map((e, i) => (
              <View key={e.id ?? i}>
                {i > 0 ? <Hairline /> : null}
                <View style={{ paddingVertical: space.sm }}>
                  <AppText variant="bodyMedium" numberOfLines={1}>
                    {e.title ?? e.event_type ?? "Event"}
                  </AppText>
                  {e.start_time ? (
                    <AppText variant="caption" tone="tertiary">
                      {e.all_day ? "All day" : fmtTime(e.start_time)}
                    </AppText>
                  ) : null}
                </View>
              </View>
            ))
          )}
        </Card>

        {/* Coming up */}
        {(upcoming.data ?? []).length > 0 ? (
          <Card style={{ gap: space.sm }}>
            <AppText variant="caption" tone="tertiary">
              Coming up
            </AppText>
            {(upcoming.data ?? []).slice(0, 6).map((e, i) => (
              <View key={e.id ?? i}>
                {i > 0 ? <Hairline /> : null}
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    paddingVertical: space.sm,
                  }}
                >
                  <AppText variant="body" numberOfLines={1} style={{ flex: 1, paddingRight: space.md }}>
                    {e.title ?? e.event_type ?? "Event"}
                  </AppText>
                  {e.start_time ? (
                    <AppText variant="caption" tone="tertiary">
                      {/* The house's day, in its zone and words (F-1029). */}
                      {houseDay(e.start_time, locale, houseZone, {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                      })}
                    </AppText>
                  ) : null}
                </View>
              </View>
            ))}
          </Card>
        ) : null}

        {tonight.kind === "error" && (todayEvents.data ?? []).length === 0 && (upcoming.data ?? []).length === 0 ? (
          <EmptyState
            title="Quiet in here"
            message="Schedule shifts and events from the web dashboard; they show up here live."
          />
        ) : null}
      </ScrollView>
    </Screen>
  );
}
