/**
 * ContextualInsights — the shared "insights in context" rail (NEW-729…NEW-760).
 *
 * One component embedded on /inventory, /orders, /providers. It scopes the
 * engine's insight feed to the host page's categories (optionally to one
 * entity), and offers Act / Explain / Pin / Dismiss with the SAME disposition
 * store as Recommendations + the Reports panel, so dismiss/snooze/pin sync
 * across every surface. Deep-links to Browse-All and Recommendations are
 * stable. Deterministic sentences only — no fabricated %.
 *
 * ADR 0191 (founder, 2026-09-21): the gateway resolves ONE shared per-item
 * state and withholds what it hides on the stored read this rail uses, so
 * the rail no longer filters by itself — its old client-side filter matched
 * `insight:<candidate>:<entity>`, a key nothing server-side ever wrote, so a
 * rail dismissal held on this rail and nowhere else. Every act goes to the
 * gateway-built key the row carries (`@/lib/recommendationState`), a
 * dismissal carries the reason the person picked (a labelled signal, never a
 * stamped `not_relevant`), and an item whose key is the whole type is not
 * offered a one-item Dismiss: that is the catalogue's owner/manager On/Off.
 *
 * NEW-729/738/748 host rails · NEW-730/739/749 entity scope · NEW-731 act
 * NEW-735/745/755 Browse-All deep link · NEW-736/746/756 dismiss syncs
 * NEW-758 shared contract · NEW-759 stable deep links · NEW-760 taught empty state
 */

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import "./contextual-insights.css";
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
import {
  DISMISS_CHOICES,
  choiceSaid,
  insightActKey,
  patchForChoice,
  undoOf,
  type DismissChoiceId,
} from "../../lib/recommendationState";

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
    actRoute: "/vendors",
  },
};

/**
 * Each category is a hue, drawn by `contextual-insights.css` from the page's own
 * paper and ink tokens, so a chip is a pale tint on paper and a deep tint on
 * Warm Charcoal. (Fixed pastel utilities were a light tile on a dark page.)
 */
const CATEGORY_HUES: Record<string, number> = {
  sales: 155,
  purchasing: 250,
  inventory: 75,
  efficiency: 275,
  tables: 305,
  staff: 350,
  basket: 15,
  risk: 27,
  forecast: 205,
  goals: 0,
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
  /** The gateway-built key an act on this item writes; null = not actable. */
  actKey: string | null;
  /** That key silences the whole type — no one-item Dismiss is offered. */
  ruleWide: boolean;
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
  // The last choice that landed, so Undo reverses the act it actually was
  // (round 3: "Not right now" is this person's own snooze, woken — not a
  // house restore).
  const [undo, setUndo] = useState<{ key: string; choice: DismissChoiceId } | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);
  // Which item's reason row is open, and the last write that did not land.
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  const [actError, setActError] = useState<string | null>(null);
  // The gateway could not read what has been dismissed, snoozed or done, so
  // the list below may hold items already put away. Said, never shown clean.
  const [stateUnread, setStateUnread] = useState(false);

  const load = useCallback(async () => {
    if (!restaurantId) return;
    setLoading(true);
    setError(null);
    setStateUnread(false);
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

      // Pins only. What is hidden the gateway has already withheld from the
      // list below, at every scope (ADR 0191) — filtering again here, on a
      // key of this page's own making, is how a dismissal used to hold on
      // one surface and nowhere else.
      const pinnedSet = new Set<string>();
      if (dispRes.status === "fulfilled") {
        const items: any[] = dispRes.value.data?.items ?? [];
        for (const it of items) {
          if (!String(it.ruleKey ?? "").startsWith("insight:")) continue;
          if (it.pinned) pinnedSet.add(it.ruleKey);
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
        // House state or this person's own snoozes (round 3): either unread
        // means some of these may be ones already put away.
        setStateUnread(
          body.suppressionsReadable === false || body.personalSnoozesReadable === false,
        );
        let mapped = rows
          .map((r) => {
            const candidateKey = r.candidate_key ?? r.candidateKey ?? "";
            const eKey = r.entity_key ?? r.entityKey ?? "";
            // Display identity only (React key, deep link, "Explain").
            const ruleKey = `insight:${candidateKey}${eKey ? ":" + eKey : ""}`;
            const item = insightActKey(r);
            return {
              sentence: r.sentence,
              category: r.category,
              score: Number(r.score ?? 0),
              ruleKey,
              effectPct: r.effect_pct ?? r.effectPct ?? null,
              zScore: r.z_score ?? r.z ?? null,
              entityKey: eKey || null,
              entityLabel: r.entity_label ?? r.entityLabel ?? null,
              pinned: item ? pinnedSet.has(item.key) : false,
              actKey: item?.key ?? null,
              ruleWide: item?.ruleWide ?? true,
            } as Insight;
          })
          .filter((r) => r.sentence);

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

  /** One write at the item's own key. Resolves false when it did not land. */
  const action = useCallback(
    async (ins: Insight, patch: Record<string, unknown>): Promise<boolean> => {
      if (!restaurantId || !ins.actKey) return false;
      try {
        await apiClient.post(`/analytics/recommendations/${restaurantId}/action`, {
          ruleKey: ins.actKey,
          ...patch,
          snapshot: {
            observation: ins.sentence,
            recommendation: ins.sentence,
            category: ins.category,
          },
        });
        return true;
      } catch (e) {
        // Said, never swallowed: a write that did not land is not a dismissal.
        setActError(getErrorMessage(e));
        return false;
      }
    },
    [restaurantId],
  );

  /**
   * One choice from the dismiss list (ADR 0191 round 3): a dismissal with its
   * label, "Already handled" as done, or "Not right now" as this person's own
   * snooze — `patchForChoice`, the same body every surface posts.
   */
  const dismiss = async (ins: Insight, choice: DismissChoiceId) => {
    if (!ins.actKey || ins.ruleWide) return;
    setReasonFor(null);
    setActError(null);
    setInsights((prev) => prev.filter((i) => i.ruleKey !== ins.ruleKey));
    const landed = await action(ins, patchForChoice(choice));
    if (landed) setUndo({ key: ins.actKey, choice });
    else load();
  };

  const restore = async (last: { key: string; choice: DismissChoiceId }) => {
    setUndo(null);
    setActError(null);
    if (!restaurantId) return;
    try {
      const { path, body } = undoOf(restaurantId, last.key, last.choice);
      await apiClient.post(path, body);
    } catch (e) {
      setActError(getErrorMessage(e));
    }
    load();
  };

  const pin = async (ins: Insight) => {
    if (!ins.actKey) return;
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
    const landed = await action(ins, { pinned: next });
    if (!landed)
      setInsights((prev) =>
        prev.map((i) => (i.ruleKey === ins.ruleKey ? { ...i, pinned: !next } : i)),
      );
  };

  /*
   * A hand-off: it only opens the page where the work is done, so it records
   * nothing (ADR 0112 F10, amended 2026-09-25 — the founder, sketch 122 Q2:
   * "A hand-off that only opens another page records nothing"). It used to
   * post an `acted` stamp fire-and-forget; since PR #483 that field is the
   * gated, audited "Mark as briefed" stamp, so the post would have named the
   * clicker as the briefer, or been refused (403 `not_your_note`) unseen
   * while the page navigated away (PR #483 audit, R4).
   */
  const act = (ins: Insight) => {
    window.location.href = `${cfg.actRoute}?insight=${encodeURIComponent(ins.ruleKey)}&from=${host}`;
  };

  const browseHref = `/recommendations/catalog?dim=${cfg.browseDims[0]}`;

  if (!restaurantId) return null;

  return (
    <div
      className={`ci-card rounded-2xl border overflow-hidden ${className}`}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        className="ci-head w-full flex items-center justify-between px-4 py-3"
      >
        <span className="flex items-center gap-2 text-sm font-bold text-[var(--ink-1,#1f2937)]">
          <span className="ci-chip p-1.5 rounded-lg" style={{ "--h": 75 } as CSSProperties}>
            <Lightbulb className="w-4 h-4" />
          </span>
          {cfg.title}
          {entityLabel ? (
            <span className="text-[var(--ink-4,#9ca3af)] font-normal">· {entityLabel}</span>
          ) : null}
          {insights.length > 0 && (
            <span className="ci-chip px-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ "--h": 75 } as CSSProperties}>
              {insights.length}
            </span>
          )}
        </span>
        {open ? (
          <ChevronUp className="w-4 h-4 text-[var(--ink-4,#9ca3af)]" />
        ) : (
          <ChevronDown className="w-4 h-4 text-[var(--ink-4,#9ca3af)]" />
        )}
      </button>

      {open && (
        <div className="px-4 pb-4">
          {loading ? (
            <div className="space-y-2 py-2">
              {[0, 1].map((i) => (
                <div key={i} className="h-4 bg-[var(--paper-1,#f3f4f6)] rounded animate-pulse" style={{ width: `${85 - i * 20}%` }} />
              ))}
            </div>
          ) : error ? (
            /* A failed request must never read as "you have no insights". */
            <div className="py-3 text-sm text-[var(--alarm,#b91c1c)]">
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
            <div className="py-3 text-sm text-[var(--ink-3,#6b7280)]">
              {available === false
                ? "Connect your POS / import checks to unlock insights for this page."
                : "No insights for this scope yet — they appear as sales, pours, and orders accumulate."}
              <a
                href={browseHref}
                className="inline-flex items-center gap-1 ml-1 text-[var(--warn,#b45309)] font-medium hover:underline"
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
                          className="ci-chip shrink-0 mt-0.5 px-2 py-0.5 rounded-full text-[11px] font-semibold"
                          style={{ "--h": CATEGORY_HUES[ins.category] ?? 0, "--c": ins.category in CATEGORY_HUES && ins.category !== "goals" ? 1 : 0 } as CSSProperties}
                        >
                          {ins.category}
                        </span>
                        <div className="flex-1 min-w-0">
                          <span className="text-sm text-[var(--ink-1,#1f2937)] leading-snug flex items-start gap-1.5">
                            {ins.pinned && <Pin className="w-3 h-3 text-[var(--warn,#b45309)] shrink-0 mt-1" />}
                            {ins.sentence}
                          </span>
                          <div className="flex items-center gap-1 mt-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                            <button
                              onClick={() => act(ins)}
                              className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold text-[var(--seal-deep,#047857)] bg-[var(--seal-tint,#ecfdf5)] hover:bg-[var(--seal-tint,#d1fae5)] rounded-md"
                            >
                              Act <ArrowRight className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => setExpanded(isOpen ? null : ins.ruleKey)}
                              className="px-2 py-0.5 text-[11px] font-medium text-[var(--ink-3,#6b7280)] hover:bg-[var(--paper-2,#e5e7eb)] rounded-md"
                            >
                              Explain
                            </button>
                            {ins.actKey && (
                              <button
                                onClick={() => pin(ins)}
                                title={ins.pinned ? "Unpin" : "Pin"}
                                className={`p-0.5 rounded-md hover:bg-[var(--paper-2,#e5e7eb)] ${ins.pinned ? "text-[var(--warn,#b45309)]" : "text-[var(--ink-4,#9ca3af)]"}`}
                              >
                                <Pin className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {ins.actKey && !ins.ruleWide && (
                              <button
                                onClick={() =>
                                  setReasonFor(reasonFor === ins.ruleKey ? null : ins.ruleKey)
                                }
                                title="Dismiss"
                                aria-label="Dismiss"
                                aria-expanded={reasonFor === ins.ruleKey}
                                className="p-0.5 rounded-md text-[var(--ink-4,#9ca3af)] hover:bg-[var(--paper-2,#e5e7eb)] hover:text-[var(--ink-1,#1f2937)]"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                          {reasonFor === ins.ruleKey && (
                            <div
                              role="group"
                              aria-label="Why dismiss it"
                              className="mt-1 flex flex-wrap items-center gap-1 text-[11px]"
                            >
                              <span className="text-[var(--ink-3,#6b7280)]">Why?</span>
                              {DISMISS_CHOICES.map((r) => (
                                <button
                                  key={r.id}
                                  title={r.note}
                                  onClick={() => void dismiss(ins, r.id)}
                                  className="px-2 py-0.5 rounded-md bg-[var(--paper-1,#f3f4f6)] text-[var(--ink-2,#374151)] hover:bg-[var(--paper-2,#e5e7eb)]"
                                >
                                  {r.label}
                                </button>
                              ))}
                            </div>
                          )}
                          {isOpen && (
                            <div className="mt-1.5 p-2 bg-[var(--paper-1,#f3f4f6)] rounded-lg text-xs text-[var(--ink-3,#6b7280)] space-y-0.5">
                              {ins.effectPct != null && (
                                <p>Effect: {(Math.abs(ins.effectPct) * 100).toFixed(0)}%</p>
                              )}
                              {ins.zScore != null && <p>Signal (z): {Number(ins.zScore).toFixed(2)}</p>}
                              <p className="font-mono text-[var(--ink-4,#9ca3af)]">[{ins.ruleKey}]</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-[var(--paper-2,#f3f4f6)]">
                <a href={browseHref} className="flex items-center gap-1 text-xs font-medium text-[var(--ink-3,#6b7280)] hover:text-[var(--ink-1,#1f2937)]">
                  <Layers className="w-3.5 h-3.5" /> Browse all types
                </a>
                <a href="/recommendations" className="text-xs font-medium text-[var(--warn,#b45309)] hover:underline">
                  Recommendations →
                </a>
              </div>
            </>
          )}

          {stateUnread && (
            <p role="status" className="mt-2 text-xs text-[var(--warn,#b45309)]">
              What was dismissed, snoozed or marked done could not be read just
              now, so some of these may be ones you already put away.
            </p>
          )}

          {actError && (
            <p role="alert" className="mt-2 text-xs text-[var(--alarm,#b91c1c)]">
              Not saved ({actError}) — the item is back where it was.
            </p>
          )}

          {undo && (
            <div className="mt-2 flex items-center justify-between gap-3 px-3 py-2 bg-gray-900 text-white rounded-lg text-xs">
              <span>{choiceSaid(undo.choice)}</span>
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
