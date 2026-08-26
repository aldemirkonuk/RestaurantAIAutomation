/**
 * ContextualInsights — the shared "insights in context" rail (NEW-729…NEW-760).
 *
 * One component embedded on /inventory, /orders, /providers. It scopes the
 * engine's insight feed to the host page's categories (optionally to one
 * entity), and offers Act / Explain / Pin / Dismiss with the SAME disposition
 * store as Recommendations + the Reports panel (keyed `insight:<candidate_key>`),
 * so dismiss/snooze/pin sync across every surface. Deep-links to Browse-All and
 * Recommendations are stable. Deterministic sentences only — no fabricated %.
 *
 * NEW-729/738/748 host rails · NEW-730/739/749 entity scope · NEW-731 act
 * NEW-735/745/755 Browse-All deep link · NEW-736/746/756 dismiss syncs
 * NEW-758 shared contract · NEW-759 stable deep links · NEW-760 taught empty state
 */

import { useCallback, useEffect, useState } from "react";
import {
  Lightbulb,
  ArrowRight,
  Pin,
  X,
  ChevronDown,
  ChevronUp,
  Undo2,
  Layers,
} from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { apiClient, getErrorMessage } from "../../services/api/client";

export type InsightHost = "inventory" | "orders" | "providers";

interface HostConfig {
  title: string;
  categories: string[];
  /** Dimensions to pre-filter Browse-All to. */
  browseDims: string[];
  /** Where "Act" routes for this host. */
  actRoute: string;
}

const HOST_CONFIG: Record<InsightHost, HostConfig> = {
  inventory: {
    title: "Inventory insights",
    categories: ["inventory", "risk", "forecast"],
    browseDims: ["wine", "wine_type"],
    actRoute: "/inventory",
  },
  orders: {
    title: "Purchasing insights",
    categories: ["purchasing", "risk"],
    browseDims: ["vendor"],
    actRoute: "/orders",
  },
  providers: {
    title: "Vendor insights",
    categories: ["purchasing", "risk"],
    browseDims: ["vendor"],
    actRoute: "/providers",
  },
};

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

interface Insight {
  sentence: string;
  category: string;
  score: number;
  ruleKey: string;
  effectPct: number | null;
  zScore: number | null;
  entityKey: string | null;
  entityLabel: string | null;
  pinned: boolean;
}

export function ContextualInsights({
  host,
  entityKey,
  entityLabel,
  defaultOpen = true,
  className = "",
}: {
  host: InsightHost;
  entityKey?: string;
  entityLabel?: string;
  defaultOpen?: boolean;
  className?: string;
}) {
  const { user } = useAuth();
  const restaurantId = user?.restaurantId;
  const cfg = HOST_CONFIG[host];

  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(defaultOpen);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [undo, setUndo] = useState<string | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    if (!restaurantId) return;
    setLoading(true);
    setError(null);
    try {
      // allSettled, not all: the disposition call failing must not blank the
      // insight list (fetch never rejected on 4xx — axios does).
      const [insRes, dispRes] = await Promise.allSettled([
        apiClient.get(
          `/analytics/insights/${restaurantId}?categories=${cfg.categories.join(",")}&limit=20`,
        ),
        apiClient.get(
          `/analytics/recommendations/${restaurantId}/actions?status=all`,
        ),
      ]);

      const hidden = new Set<string>();
      const pinnedSet = new Set<string>();
      if (dispRes.status === "fulfilled") {
        const now = Date.now();
        const items: any[] = dispRes.value.data?.items ?? [];
        for (const it of items) {
          if (!String(it.ruleKey ?? "").startsWith("insight:")) continue;
          if (it.pinned) pinnedSet.add(it.ruleKey);
          const snoozed =
            it.status === "snoozed" &&
            it.snoozeUntil &&
            new Date(it.snoozeUntil).getTime() > now;
          if (it.status === "dismissed" || it.status === "done" || snoozed)
            hidden.add(it.ruleKey);
        }
      }

      if (insRes.status === "rejected") {
        // Never imply "no insights" when we simply could not ask.
        throw insRes.reason;
      }
      {
        const body = insRes.value.data ?? {};
        const rows: any[] = body.insights ?? [];
        setAvailable(rows.length > 0 || body.source === "stored");
        let mapped = rows
          .map((r) => {
            const candidateKey = r.candidate_key ?? r.candidateKey ?? "";
            const eKey = r.entity_key ?? r.entityKey ?? "";
            const ruleKey = `insight:${candidateKey}${eKey ? ":" + eKey : ""}`;
            return {
              sentence: r.sentence,
              category: r.category,
              score: Number(r.score ?? 0),
              ruleKey,
              effectPct: r.effect_pct ?? r.effectPct ?? null,
              zScore: r.z_score ?? r.z ?? null,
              entityKey: eKey || null,
              entityLabel: r.entity_label ?? r.entityLabel ?? null,
              pinned: pinnedSet.has(ruleKey),
            } as Insight;
          })
          .filter((r) => r.sentence && !hidden.has(r.ruleKey));

        // Entity scope (NEW-730/739/749): narrow to one wine/vendor when given.
        if (entityKey) {
          mapped = mapped.filter(
            (m) =>
              m.entityKey === entityKey ||
              (entityLabel &&
                m.sentence.toLowerCase().includes(entityLabel.toLowerCase())),
          );
        }
        mapped.sort((a, b) =>
          !!a.pinned !== !!b.pinned ? (a.pinned ? -1 : 1) : b.score - a.score,
        );
        setInsights(mapped.slice(0, entityKey ? 4 : 8));
      }
    } catch (e) {
      setInsights([]);
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [restaurantId, cfg.categories, entityKey, entityLabel]);

  useEffect(() => {
    load();
  }, [load]);

  const action = useCallback(
    async (ins: Insight, patch: Record<string, unknown>) => {
      if (!restaurantId) return;
      await apiClient
        .post(`/analytics/recommendations/${restaurantId}/action`, {
          ruleKey: ins.ruleKey,
          ...patch,
          snapshot: {
            observation: ins.sentence,
            recommendation: ins.sentence,
            category: ins.category,
          },
        })
        .catch(() => {});
    },
    [restaurantId],
  );

  const dismiss = async (ins: Insight) => {
    setInsights((prev) => prev.filter((i) => i.ruleKey !== ins.ruleKey));
    setUndo(ins.ruleKey);
    await action(ins, { status: "dismissed", reason: "not_relevant" });
  };

  const restore = async (ruleKey: string) => {
    setUndo(null);
    await apiClient
      .post(`/analytics/recommendations/${restaurantId}/action`, {
        ruleKey,
        status: "active",
      })
      .catch(() => {});
    load();
  };

  const pin = async (ins: Insight) => {
    const next = !ins.pinned;
    setInsights((prev) => {
      const u = prev.map((i) =>
        i.ruleKey === ins.ruleKey ? { ...i, pinned: next } : i,
      );
      u.sort((a, b) =>
        !!a.pinned !== !!b.pinned ? (a.pinned ? -1 : 1) : b.score - a.score,
      );
      return u;
    });
    await action(ins, { pinned: next });
  };

  const act = (ins: Insight) => {
    action(ins, { acted: true });
    window.location.href = `${cfg.actRoute}?insight=${encodeURIComponent(ins.ruleKey)}&from=${host}`;
  };

  const browseHref = `/recommendations/catalog?dim=${cfg.browseDims[0]}`;

  if (!restaurantId) return null;

  return (
    <div
      className={`bg-white rounded-2xl border border-gray-200 overflow-hidden ${className}`}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
      >
        <span className="flex items-center gap-2 text-sm font-bold text-gray-900">
          <span className="p-1.5 bg-amber-100 rounded-lg">
            <Lightbulb className="w-4 h-4 text-amber-600" />
          </span>
          {cfg.title}
          {entityLabel ? (
            <span className="text-gray-400 font-normal">· {entityLabel}</span>
          ) : null}
          {insights.length > 0 && (
            <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700">
              {insights.length}
            </span>
          )}
        </span>
        {open ? (
          <ChevronUp className="w-4 h-4 text-gray-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-gray-400" />
        )}
      </button>

      {open && (
        <div className="px-4 pb-4">
          {loading ? (
            <div className="space-y-2 py-2">
              {[0, 1].map((i) => (
                <div key={i} className="h-4 bg-gray-100 rounded animate-pulse" style={{ width: `${85 - i * 20}%` }} />
              ))}
            </div>
          ) : error ? (
            /* A failed request must never read as "you have no insights". */
            <div className="py-3 text-sm text-red-700">
              Couldn't load insights — {error}
              <button
                onClick={() => void load()}
                className="ml-1 font-medium underline hover:no-underline"
              >
                Retry
              </button>
            </div>
          ) : insights.length === 0 ? (
            /* Taught empty state (NEW-760) — never a blank panel */
            <div className="py-3 text-sm text-gray-500">
              {available === false
                ? "Connect your POS / import checks to unlock insights for this page."
                : "No insights for this scope yet — they appear as sales, pours, and orders accumulate."}
              <a
                href={browseHref}
                className="inline-flex items-center gap-1 ml-1 text-amber-700 font-medium hover:underline"
              >
                <Layers className="w-3.5 h-3.5" /> Browse all types
              </a>
            </div>
          ) : (
            <>
              <ul className="space-y-2.5">
                {insights.map((ins) => {
                  const isOpen = expanded === ins.ruleKey;
                  return (
                    <li key={ins.ruleKey} className="group">
                      <div className="flex items-start gap-2.5">
                        <span
                          className={`shrink-0 mt-0.5 px-2 py-0.5 rounded-full text-[11px] font-semibold ${CATEGORY_COLORS[ins.category] ?? "bg-gray-100 text-gray-700"}`}
                        >
                          {ins.category}
                        </span>
                        <div className="flex-1 min-w-0">
                          <span className="text-sm text-gray-800 leading-snug flex items-start gap-1.5">
                            {ins.pinned && <Pin className="w-3 h-3 text-amber-500 shrink-0 mt-1" />}
                            {ins.sentence}
                          </span>
                          <div className="flex items-center gap-1 mt-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                            <button
                              onClick={() => act(ins)}
                              className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-md"
                            >
                              Act <ArrowRight className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => setExpanded(isOpen ? null : ins.ruleKey)}
                              className="px-2 py-0.5 text-[11px] font-medium text-gray-500 hover:bg-gray-100 rounded-md"
                            >
                              Explain
                            </button>
                            <button
                              onClick={() => pin(ins)}
                              title={ins.pinned ? "Unpin" : "Pin"}
                              className={`p-0.5 rounded-md hover:bg-gray-100 ${ins.pinned ? "text-amber-600" : "text-gray-300"}`}
                            >
                              <Pin className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => dismiss(ins)}
                              title="Dismiss"
                              className="p-0.5 rounded-md text-gray-300 hover:bg-gray-100 hover:text-gray-600"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          {isOpen && (
                            <div className="mt-1.5 p-2 bg-gray-50 rounded-lg text-xs text-gray-500 space-y-0.5">
                              {ins.effectPct != null && (
                                <p>Effect: {(Math.abs(ins.effectPct) * 100).toFixed(0)}%</p>
                              )}
                              {ins.zScore != null && <p>Signal (z): {Number(ins.zScore).toFixed(2)}</p>}
                              <p className="font-mono text-gray-400">[{ins.ruleKey}]</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
                <a href={browseHref} className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-800">
                  <Layers className="w-3.5 h-3.5" /> Browse all types
                </a>
                <a href="/recommendations" className="text-xs font-medium text-amber-700 hover:underline">
                  Recommendations →
                </a>
              </div>
            </>
          )}

          {undo && (
            <div className="mt-2 flex items-center justify-between gap-3 px-3 py-2 bg-gray-900 text-white rounded-lg text-xs">
              <span>Insight dismissed</span>
              <button onClick={() => restore(undo)} className="flex items-center gap-1 font-semibold text-amber-300 hover:text-amber-200">
                <Undo2 className="w-3.5 h-3.5" /> Undo
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
