/**
 * The Insights goal bars (F-1304), drawn from GET /analytics/goals/:rid/progress.
 *
 * The goal list's `current_value` is a stored column only the hourly sweep
 * refreshes (goals.service.ts says a bar must not be drawn off it), and a
 * "keep at most" goal is met by staying UNDER its target, so a fuller bar is
 * not better there. Each bar here is the server's recomputed progressPct, and
 * a goal the server could not read says so — never 0%.
 */

export const GOAL_NOT_READ = "This goal could not be read just now.";

export type GoalBar =
  | { id: string; name: string; kind: "pending" }
  | { id: string; name: string; kind: "unreadable"; message: string }
  | {
      id: string;
      name: string;
      kind: "bar";
      /** 0..1, the drawn width. */
      fill: number;
      label: string;
      /** A "keep at most" goal that is past its limit. */
      over: boolean;
      onTrack: boolean | null;
      daysLeft: number | null;
      lever: string | null;
    };

interface ProgressRead {
  data?: { goals?: any[] } | null;
  isLoading: boolean;
  isError: boolean;
}

export function goalBars(goals: any[], progress: ProgressRead): GoalBar[] {
  const byId = new Map<string, any>();
  for (const entry of progress.data?.goals ?? []) {
    const id = entry?.goal?.id;
    if (id) byId.set(String(id), entry);
  }
  return goals.map((g) => {
    const id = String(g.id);
    const name = String(g.name ?? "");
    if (progress.isLoading && !progress.data) return { id, name, kind: "pending" };
    const entry = byId.get(id);
    const pct = entry?.unreadable ? null : Number(entry?.progressPct);
    if (!entry || pct === null || !Number.isFinite(pct)) {
      return { id, name, kind: "unreadable", message: GOAL_NOT_READ };
    }
    const atMost = (entry.goal?.direction ?? g.direction) === "at_most";
    const over = atMost && pct > 1;
    const whole = Math.round(pct * 100);
    return {
      id,
      name,
      kind: "bar",
      fill: Math.min(1, Math.max(0, pct)),
      label: atMost
        ? over
          ? `Over the limit (${whole}%)`
          : `${whole}% of the limit`
        : `${whole}%`,
      over,
      onTrack: typeof entry.onTrack === "boolean" ? entry.onTrack : null,
      daysLeft: typeof entry.daysLeft === "number" ? entry.daysLeft : null,
      lever: entry.suggestedActions?.[0]?.sentence ?? null,
    };
  });
}
