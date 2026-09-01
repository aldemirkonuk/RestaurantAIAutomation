/**
 * EngineInsightsPanel — plain-language conclusions + goals, powered by the
 * analytics insight engine (/analytics/insights, /analytics/goals).
 *
 * Self-contained: fetches its own data so the 1,000-line Reports page doesn't
 * grow more prop plumbing. Deterministic sentences only — every number comes
 * from the engine's math, never from an LLM.
 */

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Lightbulb,
  Target,
  RefreshCw,
  Plus,
  ChevronDown,
  ChevronUp,
  ArrowRight,
  X,
  Pin,
  Undo2,
} from "lucide-react";
import { useAuth } from "../../../contexts/AuthContext";
import { useToast } from "../../../contexts/ToastContext";
import { apiClient, getErrorMessage } from "../../../services/api/client";

interface EngineInsight {
  sentence: string;
  category: string;
  score: number;
  /** Stable disposition key shared with the Recommendations action store. */
  ruleKey: string;
  effectPct: number | null;
  zScore: number | null;
  evidence?: Record<string, unknown>;
  entityLabel?: string | null;
  pinned?: boolean;
}

/** NEW-434 — where an insight's "Act" takes you (parity w/ Recommendations). */
const CATEGORY_ROUTE: Record<string, string> = {
  sales: "/reports",
  purchasing: "/orders",
  inventory: "/inventory",
  efficiency: "/reports",
  tables: "/reports",
  staff: "/team",
  basket: "/promotions",
  risk: "/orders",
  forecast: "/inventory",
  goals: "/reports",
};

interface Goal {
  id: string;
  name: string;
  metric_key: string;
  target_value: number;
  current_value: number;
  deadline: string | null;
  status: string;
}

interface GoalProgress {
  progressPct: number;
  onTrack: boolean | null;
  daysLeft: number | null;
  projectedAtDeadline: number | null;
  projectionHitsTarget: boolean | null;
  suggestedActions: Array<{ sentence: string; category: string }>;
}

const METRIC_OPTIONS = [
  { key: "wine_revenue", label: "Wine revenue ($)" },
  { key: "bottles_sold", label: "Bottles sold" },
  { key: "purchase_spend", label: "Purchasing spend ($)" },
  { key: "checks", label: "Checks served" },
  { key: "avg_check", label: "Average check ($)" },
  { key: "wine_attach_rate", label: "Wine attach rate (%)" },
];

const CATEGORY_COLORS: Record<string, string> = {
  sales: "bg-emerald-100 text-emerald-700",
  purchasing: "bg-blue-100 text-blue-700",
  inventory: "bg-amber-100 text-amber-700",
  efficiency: "bg-indigo-100 text-indigo-700",
  tables: "bg-purple-100 text-purple-700",
  staff: "bg-pink-100 text-pink-700",
  basket: "bg-rose-100 text-rose-700",
  risk: "bg-red-100 text-red-700",
  forecast: "bg-cyan-100 text-cyan-700",
  goals: "bg-gray-100 text-gray-700",
};

export function EngineInsightsPanel({
  className = "",
}: {
  className?: string;
}) {
  const { user } = useAuth();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const restaurantId = user?.restaurantId;
  const [insights, setInsights] = useState<EngineInsight[]>([]);
  const [expandedInsight, setExpandedInsight] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ ruleKey: string } | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [progressByGoal, setProgressByGoal] = useState<
    Record<string, GoalProgress>
  >({});
  const [expandedGoal, setExpandedGoal] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showGoalForm, setShowGoalForm] = useState(false);
  const [goalForm, setGoalForm] = useState({
    name: "",
    metricKey: "wine_revenue",
    targetValue: "",
    deadline: "",
  });

  // Deep-link support for Quick Actions: /reports?focus=insights scrolls here,
  // /reports?openGoal=true additionally opens the "Add Goal" form.
  //
  // This used to fire on ANY `focus` value and then delete the parameter, so
  // `/reports?focus=revenue` (Dashboard.tsx:1162, "View full spend report")
  // scrolled to the insight list instead of the spend report and consumed the
  // parameter before Reports.tsx could see it. It now claims only the value it
  // actually serves; Reports.tsx owns the rest (see its own focus effect).
  useEffect(() => {
    const focus = searchParams.get("focus");
    const openGoal = searchParams.get("openGoal") === "true";
    const focusesInsights = focus === "insights";
    if (!focusesInsights && !openGoal) return;

    if (openGoal) setShowGoalForm(true);

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    requestAnimationFrame(() => {
      document
        .getElementById("engine-insights")
        ?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    });

    const next = new URLSearchParams(searchParams);
    // Only what this panel consumed. A `focus` naming another section must
    // survive for the page that owns it.
    if (focusesInsights) next.delete("focus");
    next.delete("openGoal");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const base = "/analytics";

  const loadAll = useCallback(
    async (refresh = false) => {
      if (!restaurantId) return;
      if (refresh) setRefreshing(true);
      setError(null);
      try {
        // allSettled, not all: goals/disposition failing must not blank the
        // insight list (fetch never rejected on 4xx — axios does).
        const [insRes, goalsRes, dispRes] = await Promise.allSettled([
          apiClient.get<any>(
            `${base}/insights/${restaurantId}${refresh ? "?refresh=true" : "?limit=12"}`,
          ),
          apiClient.get<Goal[]>(`${base}/goals/${restaurantId}`),
          apiClient.get<any>(
            `${base}/recommendations/${restaurantId}/actions?status=all`,
          ),
        ]);

        // Manager disposition on insight cards (hidden + pinned).
        const hidden = new Set<string>();
        const pinnedSet = new Set<string>();
        if (dispRes.status === "fulfilled") {
          const now = Date.now();
          const items: any[] = dispRes.value.data?.items ?? [];
          for (const it of items) {
            if (!String(it.ruleKey ?? "").startsWith("insight:")) continue;
            if (it.pinned) pinnedSet.add(it.ruleKey);
            const snoozedActive =
              it.status === "snoozed" &&
              it.snoozeUntil &&
              new Date(it.snoozeUntil).getTime() > now;
            if (it.status === "dismissed" || it.status === "done" || snoozedActive)
              hidden.add(it.ruleKey);
          }
        }

        if (insRes.status === "rejected") throw insRes.reason;
        {
          const body = insRes.value.data ?? {};
          const rows: any[] = body.insights ?? [];
          const mapped = rows
            .map((r) => {
              const candidateKey = r.candidate_key ?? r.candidateKey ?? "";
              const entityKey = r.entity_key ?? r.entityKey ?? "";
              const ruleKey = `insight:${candidateKey}${entityKey ? ":" + entityKey : ""}`;
              return {
                sentence: r.sentence,
                category: r.category,
                score: Number(r.score ?? 0),
                ruleKey,
                effectPct: r.effect_pct ?? r.effectPct ?? null,
                zScore: r.z_score ?? r.z ?? null,
                evidence: r.evidence,
                entityLabel: r.entity_label ?? r.entityLabel ?? null,
                pinned: pinnedSet.has(ruleKey),
              } as EngineInsight;
            })
            .filter((r) => r.sentence && !hidden.has(r.ruleKey));
          // Pinned float to the top; then by score.
          mapped.sort((a, b) =>
            !!a.pinned !== !!b.pinned
              ? a.pinned
                ? -1
                : 1
              : b.score - a.score,
          );
          setInsights(mapped);
        }
        if (goalsRes.status === "fulfilled") setGoals(goalsRes.value.data);
      } catch (e) {
        setInsights([]);
        setError(getErrorMessage(e));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [restaurantId, base],
  );

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const toggleGoal = async (goalId: string) => {
    if (expandedGoal === goalId) {
      setExpandedGoal(null);
      return;
    }
    setExpandedGoal(goalId);
    if (!progressByGoal[goalId] && restaurantId) {
      try {
        const { data: p } = await apiClient.get<GoalProgress>(
          `${base}/goals/${restaurantId}/${goalId}/progress`,
        );
        setProgressByGoal((prev) => ({ ...prev, [goalId]: p }));
      } catch {
        /* quiet */
      }
    }
  };

  const createGoal = async () => {
    if (!restaurantId || !goalForm.name || !Number(goalForm.targetValue))
      return;
    try {
      await apiClient.post(`${base}/goals/${restaurantId}`, {
        name: goalForm.name,
        metricKey: goalForm.metricKey,
        targetValue: Number(goalForm.targetValue),
        deadline: goalForm.deadline || undefined,
      });
      setShowGoalForm(false);
      setGoalForm({
        name: "",
        metricKey: "wine_revenue",
        targetValue: "",
        deadline: "",
      });
      loadAll();
    } catch (e) {
      // The form used to just sit there when the POST failed.
      toast.error(`Couldn't save that goal — ${getErrorMessage(e)}`);
    }
  };

  // ---- NEW-434: insight card actions (Act / Dismiss / Explain / Pin) ------
  const insightAction = useCallback(
    async (ins: EngineInsight, patch: Record<string, unknown>) => {
      if (!restaurantId) return;
      try {
        await apiClient.post(
          `${base}/recommendations/${restaurantId}/action`,
          {
            ruleKey: ins.ruleKey,
            ...patch,
            snapshot: {
              observation: ins.sentence,
              recommendation: ins.sentence,
              category: ins.category,
            },
          },
        );
      } catch {
        toast.error("Couldn't save that");
      }
    },
    [restaurantId, base, toast],
  );

  const dismissInsight = async (ins: EngineInsight) => {
    setInsights((prev) => prev.filter((i) => i.ruleKey !== ins.ruleKey));
    setUndo({ ruleKey: ins.ruleKey });
    await insightAction(ins, { status: "dismissed", reason: "not_relevant" });
  };

  const restoreInsight = async (ruleKey: string) => {
    setUndo(null);
    await apiClient
      .post(`${base}/recommendations/${restaurantId}/action`, {
        ruleKey,
        status: "active",
      })
      .catch(() => {});
    loadAll();
  };

  const pinInsight = async (ins: EngineInsight) => {
    const next = !ins.pinned;
    setInsights((prev) => {
      const updated = prev.map((i) =>
        i.ruleKey === ins.ruleKey ? { ...i, pinned: next } : i,
      );
      updated.sort((a, b) =>
        !!a.pinned !== !!b.pinned ? (a.pinned ? -1 : 1) : b.score - a.score,
      );
      return updated;
    });
    await insightAction(ins, { pinned: next });
  };

  const actInsight = (ins: EngineInsight) => {
    insightAction(ins, { acted: true });
    const route = CATEGORY_ROUTE[ins.category] ?? "/recommendations";
    window.location.href = `${route}?insight=${encodeURIComponent(ins.ruleKey)}&from=reports`;
  };

  const activeGoals = goals.filter((g) => g.status === "active");

  return (
    <div
      className={`bg-white rounded-2xl border border-gray-200 overflow-hidden ${className}`}
    >
      {/* Conclusions */}
      <div className="p-5 border-b border-gray-100">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-100 rounded-lg">
              <Lightbulb className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-900">
                What the numbers say
              </h3>
              <p className="text-xs text-gray-500">
                Deterministic conclusions from the analytics engine
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="/recommendations"
              className="px-3 py-1.5 text-xs font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-lg transition-colors"
            >
              Recommendations →
            </a>
            <button
              onClick={() => loadAll(true)}
              disabled={refreshing}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-colors disabled:opacity-50"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`}
              />
              Recompute
            </button>
          </div>
        </div>

        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-4 bg-gray-100 rounded animate-pulse"
                style={{ width: `${90 - i * 15}%` }}
              />
            ))}
          </div>
        ) : error ? (
          /* A failed request must never read as "nothing to report yet". */
          <p className="text-sm text-red-700">
            Couldn't load insights — {error}
            <button
              onClick={() => void loadAll()}
              className="ml-1 font-medium underline hover:no-underline"
            >
              Retry
            </button>
          </p>
        ) : insights.length === 0 ? (
          <p className="text-sm text-gray-500">
            Conclusions appear as sales, pours, and orders accumulate — the
            engine turns your data into 1–2 sentence takeaways here.
          </p>
        ) : (
          <ul className="space-y-3">
            {insights.slice(0, 8).map((ins) => {
              const open = expandedInsight === ins.ruleKey;
              return (
                <li key={ins.ruleKey} className="group">
                  <div className="flex items-start gap-3">
                    <span
                      className={`shrink-0 mt-0.5 px-2 py-0.5 rounded-full text-[11px] font-semibold ${CATEGORY_COLORS[ins.category] ?? "bg-gray-100 text-gray-700"}`}
                    >
                      {ins.category}
                    </span>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-gray-800 leading-snug flex items-center gap-1.5">
                        {ins.pinned && (
                          <Pin className="w-3 h-3 text-amber-500 shrink-0" />
                        )}
                        {ins.sentence}
                      </span>
                      {/* Actions — appear on hover / focus (NEW-434) */}
                      <div className="flex items-center gap-1 mt-1.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                        <button
                          onClick={() => actInsight(ins)}
                          className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-md"
                        >
                          Act <ArrowRight className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() =>
                            setExpandedInsight(open ? null : ins.ruleKey)
                          }
                          className="px-2 py-0.5 text-[11px] font-medium text-gray-500 hover:bg-gray-100 rounded-md"
                        >
                          Explain
                        </button>
                        <button
                          onClick={() => pinInsight(ins)}
                          title={ins.pinned ? "Unpin" : "Pin"}
                          className={`p-0.5 rounded-md hover:bg-gray-100 ${ins.pinned ? "text-amber-600" : "text-gray-300"}`}
                        >
                          <Pin className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => dismissInsight(ins)}
                          title="Dismiss"
                          className="p-0.5 rounded-md text-gray-300 hover:bg-gray-100 hover:text-gray-600"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      {open && (
                        <div className="mt-2 p-2.5 bg-gray-50 rounded-lg text-xs text-gray-500 leading-relaxed space-y-0.5">
                          {ins.effectPct != null && (
                            <p>
                              Effect size:{" "}
                              {(Math.abs(ins.effectPct) * 100).toFixed(0)}%
                            </p>
                          )}
                          {ins.zScore != null && (
                            <p>Signal (z): {Number(ins.zScore).toFixed(2)}</p>
                          )}
                          {ins.entityLabel && <p>Entity: {ins.entityLabel}</p>}
                          <p className="font-mono text-gray-400">
                            [{ins.ruleKey}]
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {/* Undo snackbar for dismissed insights (NEW-434) */}
        {undo && (
          <div className="mt-3 flex items-center justify-between gap-3 px-3 py-2 bg-gray-900 text-white rounded-lg text-xs">
            <span>Insight dismissed</span>
            <button
              onClick={() => restoreInsight(undo.ruleKey)}
              className="flex items-center gap-1 font-semibold text-amber-300 hover:text-amber-200"
            >
              <Undo2 className="w-3.5 h-3.5" /> Undo
            </button>
          </div>
        )}
      </div>

      {/* Goals */}
      <div className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-100 rounded-lg">
              <Target className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-900">Goals</h3>
              <p className="text-xs text-gray-500">
                Metric-linked targets with pace tracking
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowGoalForm((s) => !s)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            New goal
          </button>
        </div>

        {showGoalForm && (
          <div className="mb-4 p-4 bg-gray-50 rounded-xl grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              className="px-3 py-2 text-sm border border-gray-200 rounded-lg"
              placeholder="Goal name (e.g. July wine push)"
              value={goalForm.name}
              onChange={(e) =>
                setGoalForm((f) => ({ ...f, name: e.target.value }))
              }
            />
            <select
              className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white"
              value={goalForm.metricKey}
              onChange={(e) =>
                setGoalForm((f) => ({ ...f, metricKey: e.target.value }))
              }
            >
              {METRIC_OPTIONS.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
            <input
              className="px-3 py-2 text-sm border border-gray-200 rounded-lg"
              placeholder="Target value"
              type="number"
              value={goalForm.targetValue}
              onChange={(e) =>
                setGoalForm((f) => ({ ...f, targetValue: e.target.value }))
              }
            />
            <input
              className="px-3 py-2 text-sm border border-gray-200 rounded-lg"
              type="date"
              value={goalForm.deadline}
              onChange={(e) =>
                setGoalForm((f) => ({ ...f, deadline: e.target.value }))
              }
            />
            <button
              onClick={createGoal}
              className="sm:col-span-2 px-4 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors"
            >
              Create goal
            </button>
          </div>
        )}

        {activeGoals.length === 0 && !showGoalForm ? (
          <p className="text-sm text-gray-500">
            No active goals. Pick a metric, a target, and a deadline — the
            engine tracks your pace and suggests levers from the insight feed.
          </p>
        ) : (
          <ul className="space-y-3">
            {activeGoals.map((g) => {
              const target = Number(g.target_value) || 0;
              const current = Number(g.current_value) || 0;
              const pct = target > 0 ? Math.min(1, current / target) : 0;
              const detail = progressByGoal[g.id];
              const expanded = expandedGoal === g.id;
              return (
                <li
                  key={g.id}
                  className="border border-gray-100 rounded-xl p-3"
                >
                  <button
                    onClick={() => toggleGoal(g.id)}
                    className="w-full text-left"
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm font-semibold text-gray-900">
                        {g.name}
                      </span>
                      <span className="flex items-center gap-2 text-xs text-gray-500 tabular-nums">
                        {Math.round(pct * 100)}%
                        {expanded ? (
                          <ChevronUp className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5" />
                        )}
                      </span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`h-2 rounded-full ${detail?.onTrack === false ? "bg-red-500" : "bg-emerald-500"}`}
                        style={{ width: `${Math.max(3, pct * 100)}%` }}
                      />
                    </div>
                  </button>
                  {expanded && detail && (
                    <div className="mt-3 pt-3 border-t border-gray-100 text-sm text-gray-700 space-y-1.5">
                      <p>
                        {detail.onTrack === false ? "Behind pace" : "On pace"}
                        {detail.daysLeft != null
                          ? ` · ${detail.daysLeft} days left`
                          : ""}
                        {detail.projectedAtDeadline != null
                          ? ` · projected ${Math.round(detail.projectedAtDeadline).toLocaleString()} at deadline${detail.projectionHitsTarget === false ? " (short of target)" : ""}`
                          : ""}
                      </p>
                      {detail.suggestedActions?.slice(0, 2).map((s, i) => (
                        <p key={i} className="text-xs text-gray-500">
                          Lever: {s.sentence}
                        </p>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
