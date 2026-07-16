import React, { useMemo } from "react";
import { ScrollView, View } from "react-native";
import { AppText } from "@/components/ui/AppText";
import { Card, Hairline, Screen } from "@/components/ui/Screen";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState, FreshnessLabel } from "@/components/ui/StateViews";
import { color, space } from "@/design/tokens";
import {
  useTeamMembers,
  useTeamWeek,
  useTodaySchedule,
  useUpcomingSchedule,
} from "@/api/queries";

function fmtTime(value?: string): string {
  if (!value) return "";
  // Accept "HH:MM[:SS]" or ISO strings.
  const hm = /^(\d{2}):(\d{2})/.exec(value);
  if (hm) {
    const h = Number(hm[1]);
    const suffix = h >= 12 ? "pm" : "am";
    const hour12 = h % 12 === 0 ? 12 : h % 12;
    return hm[2] === "00" ? `${hour12}${suffix}` : `${hour12}:${hm[2]}${suffix}`;
  }
  const d = new Date(value);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export default function TeamScreen() {
  const week = useTeamWeek();
  const members = useTeamMembers();
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

  const todayKey = new Date().toISOString().slice(0, 10);
  const todaysShifts = useMemo(() => {
    const shifts: any[] = week.data?.shifts ?? [];
    return shifts
      .filter((s) => String(s.shift_date ?? "").slice(0, 10) === todayKey)
      .sort((a, b) => String(a.start_time ?? "").localeCompare(String(b.start_time ?? "")));
  }, [week.data, todayKey]);

  // The Team domain is new; if the week endpoint isn't reachable yet the tab
  // still lives on real calendar data.
  const teamAvailable = !week.isError;

  return (
    <Screen>
      <View style={{ paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.md }}>
        <AppText variant="title">Team</AppText>
        <FreshnessLabel updatedAt={week.dataUpdatedAt || todayEvents.dataUpdatedAt || null} />
      </View>

      <ScrollView contentContainerStyle={{ padding: space.lg, paddingTop: 0, gap: space.md, paddingBottom: space.huge }}>
        {/* Who's on tonight */}
        <Card style={{ gap: space.sm }}>
          <AppText variant="caption" tone="tertiary">
            On tonight
          </AppText>
          {week.isLoading && !week.data ? (
            <View style={{ gap: space.sm }}>
              <Skeleton width={190} height={15} />
              <Skeleton width={150} height={15} />
            </View>
          ) : !teamAvailable ? (
            <AppText variant="footnote" tone="tertiary">
              Shift schedules arrive here as soon as this restaurant's team space is set up on the
              web dashboard.
            </AppText>
          ) : todaysShifts.length === 0 ? (
            <AppText variant="footnote" tone="tertiary">
              No shifts scheduled today.
            </AppText>
          ) : (
            todaysShifts.map((s, i) => (
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
                      {memberName.get(s.member_id ?? s.user_id) ??
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
                      {new Date(e.start_time).toLocaleDateString(undefined, {
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

        {!teamAvailable && (todayEvents.data ?? []).length === 0 && (upcoming.data ?? []).length === 0 ? (
          <EmptyState
            title="Quiet in here"
            message="Schedule shifts and events from the web dashboard; they show up here live."
          />
        ) : null}
      </ScrollView>
    </Screen>
  );
}
