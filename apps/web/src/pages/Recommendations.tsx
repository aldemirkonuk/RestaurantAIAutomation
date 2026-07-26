/**
 * Recommendations — the translation layer page, now actionable.
 *
 * Each card = one deterministic rule that fired: the observed number, the
 * concrete action, and why the action follows. Backed by
 * GET /analytics/recommendations/:restaurantId (no LLM — auditable rules).
 *
 * UX paths implemented (UX_PATHS_CATALOG.md):
 *   NEW-284 Act · NEW-285 Dismiss w/ reason · NEW-286 Snooze · NEW-287 Done
 *   NEW-288 Filter · NEW-289 Sort · NEW-290 Search · NEW-291 hover peek
 *   NEW-292 Expand · NEW-293 Bulk · NEW-294 Keyboard · NEW-295 Pin
 *   NEW-297 Why · NEW-298 Feedback · NEW-299/300/301 Act flows · NEW-302 History
 *   NEW-303 Digest toggle · NEW-305 R-Click · NEW-306 2×Click · NEW-307 Category
 *   NEW-308 Empty-state celebrate · NEW-759 stable ?insight= deep link
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  BellRing,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  Layers,
  Lightbulb,
  Link2,
  Mail,
  Pin,
  RefreshCw,
  Search,
  SlidersHorizontal,
  ThumbsDown,
  ThumbsUp,
  Undo2,
  UserPlus,
  X,
  Zap,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../contexts/ToastContext";
import { Header } from "../components/layout/Header";
import { getTeamMembers } from "../services/api/team";

const API_URL = import.meta.env.VITE_API_GATEWAY_URL || "http://localhost:4000";

type Urgency = "now" | "this_week" | "this_month";
type Status = "active" | "dismissed" | "snoozed" | "done";
type Tab = "active" | "snoozed" | "dismissed" | "done" | "history";

interface Card {
  observation: string;
  recommendation: string;
  rationale?: string;
  category: string;
  urgency: Urgency;
  ruleKey: string;
  score?: number;
  status?: Status;
  pinned?: boolean;
  acted?: boolean;
  reason?: string | null;
  snoozeUntil?: string | null;
  feedback?: "helpful" | "not_helpful" | null;
  assignedTo?: string | null;
  assignedName?: string | null;
  updatedAt?: string;
}

const URGENCY_META: Record<Urgency, { label: string; chip: string; icon: typeof Zap; rank: number }> = {
  now: { label: "Tonight", chip: "bg-red-100 text-red-700", icon: Zap, rank: 0 },
  this_week: { label: "This week", chip: "bg-amber-100 text-amber-700", icon: Clock, rank: 1 },
  this_month: { label: "This month", chip: "bg-blue-100 text-blue-700", icon: Clock, rank: 2 },
};

const CATEGORY_CHIP: Record<string, string> = {
  sales: "bg-emerald-50 text-emerald-700 border-emerald-200",
  inventory: "bg-amber-50 text-amber-700 border-amber-200",
  efficiency: "bg-indigo-50 text-indigo-700 border-indigo-200",
  risk: "bg-red-50 text-red-700 border-red-200",
  purchasing: "bg-blue-50 text-blue-700 border-blue-200",
  staff: "bg-pink-50 text-pink-700 border-pink-200",
  basket: "bg-rose-50 text-rose-700 border-rose-200",
  goals: "bg-gray-50 text-gray-700 border-gray-200",
};

const DISMISS_REASONS = [
  { code: "not_relevant", label: "Not relevant" },
  { code: "already_handled", label: "Already handled" },
  { code: "disagree", label: "I disagree" },
  { code: "not_now", label: "Not right now" },
];

const SORTS = [
  { key: "impact", label: "Impact" },
  { key: "urgency", label: "Urgency" },
  { key: "recency", label: "Recency" },
] as const;
type SortKey = (typeof SORTS)[number]["key"];

/** NEW-284 / NEW-299 / NEW-300 / NEW-301 — where "Act" takes you, with context. */
function actTarget(rec: Card): { href: string; label: string } {
  const q = `rec=${encodeURIComponent(rec.ruleKey)}&from=recommendations`;
  const byRule: Record<string, { href: string; label: string }> = {
    stockout_imminent: { href: `/orders?${q}&draft=1`, label: "Draft PO" },
    dead_stock_capital: { href: `/promotions?${q}`, label: "Create promo" },
    plowhorse_repricing: { href: `/reports?${q}`, label: "Open menu report" },
    puzzle_activation: { href: `/promotions?${q}`, label: "Feature by-the-glass" },
    vendor_concentration: { href: `/providers?${q}`, label: "Compare vendors" },
    revenue_concentration: { href: `/inventory?${q}`, label: "Protect top sellers" },
    spend_acceleration: { href: `/orders?${q}`, label: "Audit open orders" },
    pairing_promotion: { href: `/promotions?${q}`, label: "Promote pairing" },
    staff_spread: { href: `/team?${q}`, label: "Open Team" },
  };
  if (byRule[rec.ruleKey]) return byRule[rec.ruleKey];
  if (rec.ruleKey.startsWith("goal_behind"))
    return { href: `/reports?${q}`, label: "Open goal" };
  const byCategory: Record<string, { href: string; label: string }> = {
    inventory: { href: `/inventory?${q}`, label: "Open Inventory" },
    purchasing: { href: `/orders?${q}`, label: "Open Orders" },
    risk: { href: `/orders?${q}`, label: "Review risk" },
    sales: { href: `/reports?${q}`, label: "Open Reports" },
    efficiency: { href: `/reports?${q}`, label: "Open Reports" },
    staff: { href: `/team?${q}`, label: "Open Team" },
    basket: { href: `/promotions?${q}`, label: "Open Promotions" },
    goals: { href: `/reports?${q}`, label: "Open Goals" },
  };
  return byCategory[rec.category] ?? { href: `/reports?${q}`, label: "Open Reports" };
}

function snapshotOf(rec: Card) {
  return {
    observation: rec.observation,
    recommendation: rec.recommendation,
    category: rec.category,
    urgency: rec.urgency,
  };
}

export default function Recommendations() {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const restaurantId = user?.restaurantId;
  const base = `${API_URL}/api/v1/analytics/recommendations`;

  const [recs, setRecs] = useState<Card[]>([]);
  const [tabItems, setTabItems] = useState<Card[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({
    active: 0,
    snoozed: 0,
    dismissed: 0,
    done: 0,
  });
  const [rulesEvaluated, setRulesEvaluated] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [tab, setTab] = useState<Tab>("active");
  const [search, setSearch] = useState("");
  const [urgencyFilter, setUrgencyFilter] = useState<Set<Urgency>>(new Set());
  const [categoryFilter, setCategoryFilter] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<SortKey>("impact");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [focusedIdx, setFocusedIdx] = useState(-1);
  const [menu, setMenu] = useState<
    | { ruleKey: string; kind: "dismiss" | "snooze" | "context"; x?: number; y?: number }
    | null
  >(null);
  const [snoozeDate, setSnoozeDate] = useState("");
  const [digestEnabled, setDigestEnabled] = useState(false);
  const [undo, setUndo] = useState<{ ruleKey: string; label: string } | null>(null);
  /** NEW-296: assign to a teammate. Roster is loaded lazily on first use. */
  const [assignFor, setAssignFor] = useState<string | null>(null);
  const [teamMembers, setTeamMembers] = useState<Array<{ id: string; display_name: string }>>([]);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const highlightKey = searchParams.get("insight");

  // ---- Data loading -------------------------------------------------------
  const loadActive = useCallback(async () => {
    if (!restaurantId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${base}/${restaurantId}`);
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const body = await res.json();
      setRecs(body.recommendations ?? []);
      setRulesEvaluated(body.rulesEvaluated ?? 0);
      if (body.stateCounts)
        setCounts((c) => ({ ...c, ...body.stateCounts }));
    } catch (e: any) {
      setError(e?.message ?? "Failed to load recommendations");
    } finally {
      setLoading(false);
    }
  }, [restaurantId, base]);

  const loadTab = useCallback(
    async (which: Exclude<Tab, "active">) => {
      if (!restaurantId) return;
      setLoading(true);
      try {
        const url =
          which === "history"
            ? `${base}/${restaurantId}/history`
            : `${base}/${restaurantId}/actions?status=${which}`;
        const res = await fetch(url);
        const body = await res.json();
        const items: Card[] = (body.items ?? []).map((r: any) => ({
          observation: r.observation ?? "(no snapshot)",
          recommendation: r.recommendation ?? "",
          category: r.category ?? "goals",
          urgency: (r.urgency as Urgency) ?? "this_week",
          ruleKey: r.ruleKey,
          status: r.status,
          pinned: r.pinned,
          acted: !!r.actedAt,
          reason: r.reason,
          snoozeUntil: r.snoozeUntil,
          feedback: r.feedback,
          updatedAt: r.updatedAt,
        }));
        setTabItems(items);
      } catch {
        setTabItems([]);
      } finally {
        setLoading(false);
      }
    },
    [restaurantId, base],
  );

  useEffect(() => {
    if (tab === "active") loadActive();
    else loadTab(tab);
  }, [tab, loadActive, loadTab]);

  useEffect(() => {
    if (!restaurantId) return;
    fetch(`${base}/${restaurantId}/digest`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setDigestEnabled(!!d.digestEnabled))
      .catch(() => {});
  }, [restaurantId, base]);

  // ---- Mutations ----------------------------------------------------------
  const patchAction = useCallback(
    async (ruleKey: string, patch: Record<string, unknown>, snapshot?: unknown) => {
      if (!restaurantId) return;
      try {
        await fetch(`${base}/${restaurantId}/action`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ruleKey, ...patch, snapshot }),
        });
      } catch {
        toast.error("Couldn't save that — try again");
      }
    },
    [restaurantId, base, toast],
  );

  const showUndo = (ruleKey: string, label: string) => {
    setUndo({ ruleKey, label });
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndo(null), 8000);
  };

  const hideCard = (rec: Card) => {
    setRecs((prev) => prev.filter((r) => r.ruleKey !== rec.ruleKey));
    setSelected((prev) => {
      const n = new Set(prev);
      n.delete(rec.ruleKey);
      return n;
    });
  };

  const doDismiss = async (rec: Card, reasonCode: string) => {
    hideCard(rec);
    setCounts((c) => ({ ...c, active: Math.max(0, c.active - 1), dismissed: c.dismissed + 1 }));
    await patchAction(rec.ruleKey, { status: "dismissed", reason: reasonCode }, snapshotOf(rec));
    showUndo(rec.ruleKey, "Dismissed");
    setMenu(null);
  };

  const doSnooze = async (rec: Card, until: Date, label: string) => {
    hideCard(rec);
    setCounts((c) => ({ ...c, active: Math.max(0, c.active - 1), snoozed: c.snoozed + 1 }));
    await patchAction(
      rec.ruleKey,
      { status: "snoozed", snoozeUntil: until.toISOString(), reason: label },
      snapshotOf(rec),
    );
    showUndo(rec.ruleKey, `Snoozed ${label}`);
    setMenu(null);
  };

  const doDone = async (rec: Card) => {
    hideCard(rec);
    setCounts((c) => ({ ...c, active: Math.max(0, c.active - 1), done: c.done + 1 }));
    await patchAction(rec.ruleKey, { status: "done" }, snapshotOf(rec));
    showUndo(rec.ruleKey, "Marked done");
  };

  const doRestore = async (ruleKey: string) => {
    await patchAction(ruleKey, { status: "active" });
    setUndo(null);
    if (tab === "active") loadActive();
    else loadTab(tab);
    toast.success("Restored to your feed");
  };

  const doPin = async (rec: Card) => {
    const next = !rec.pinned;
    setRecs((prev) =>
      prev.map((r) => (r.ruleKey === rec.ruleKey ? { ...r, pinned: next } : r)),
    );
    await patchAction(rec.ruleKey, { pinned: next }, snapshotOf(rec));
  };

  const doFeedback = async (rec: Card, value: "helpful" | "not_helpful") => {
    const next = rec.feedback === value ? null : value;
    setRecs((prev) =>
      prev.map((r) => (r.ruleKey === rec.ruleKey ? { ...r, feedback: next } : r)),
    );
    await patchAction(rec.ruleKey, { feedback: next }, snapshotOf(rec));
  };

  const openAssign = useCallback(async (ruleKey: string) => {
    setAssignFor(ruleKey);
    setMenu(null);
    if (teamMembers.length === 0) {
      try {
        const rows = await getTeamMembers();
        setTeamMembers(rows.map((m: any) => ({ id: m.id, display_name: m.display_name })));
      } catch {
        toast.error("Couldn't load the team roster");
      }
    }
  }, [teamMembers.length, toast]);

  /** NEW-296: persist the assignment (or clear it) on the shared action store. */
  const doAssign = async (rec: Card, member: { id: string; display_name: string } | null) => {
    setRecs((prev) =>
      prev.map((r) =>
        r.ruleKey === rec.ruleKey
          ? { ...r, assignedTo: member?.id ?? null, assignedName: member?.display_name ?? null }
          : r,
      ),
    );
    setAssignFor(null);
    await patchAction(
      rec.ruleKey,
      { assignedTo: member?.id ?? null, assignedName: member?.display_name ?? null },
      snapshotOf(rec),
    );
    toast.success(member ? `Assigned to ${member.display_name}` : "Assignment cleared");
  };

  const doAct = (rec: Card) => {
    const { href } = actTarget(rec);
    patchAction(rec.ruleKey, { acted: true }, snapshotOf(rec));
    navigate(href);
  };

  const toggleDigest = async () => {
    if (!restaurantId) return;
    const next = !digestEnabled;
    setDigestEnabled(next);
    try {
      await fetch(`${base}/${restaurantId}/digest`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ digestEnabled: next }),
      });
      toast.success(next ? "Daily digest on — top actions to your inbox" : "Daily digest off");
    } catch {
      setDigestEnabled(!next);
      toast.error("Couldn't update digest preference");
    }
  };

  const bulkAction = async (patch: Record<string, unknown>, label: string) => {
    if (!restaurantId || selected.size === 0) return;
    const items = recs
      .filter((r) => selected.has(r.ruleKey))
      .map((r) => ({ ruleKey: r.ruleKey, snapshot: snapshotOf(r) }));
    setRecs((prev) => prev.filter((r) => !selected.has(r.ruleKey)));
    const n = items.length;
    setSelected(new Set());
    try {
      await fetch(`${base}/${restaurantId}/bulk-action`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items, ...patch }),
      });
      toast.success(`${label} ${n} recommendation${n === 1 ? "" : "s"}`);
      loadActive();
    } catch {
      toast.error("Bulk action failed");
    }
  };

  // ---- Derived (filter + sort + search) -----------------------------------
  const visible = useMemo(() => {
    const src = tab === "active" ? recs : tabItems;
    const q = search.trim().toLowerCase();
    let out = src.filter((r) => {
      if (urgencyFilter.size && !urgencyFilter.has(r.urgency)) return false;
      if (categoryFilter.size && !categoryFilter.has(r.category)) return false;
      if (q) {
        const hay = `${r.observation} ${r.recommendation} ${r.rationale ?? ""} ${r.category} ${r.ruleKey}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    out = [...out].sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      if (sort === "urgency")
        return URGENCY_META[a.urgency].rank - URGENCY_META[b.urgency].rank;
      if (sort === "recency")
        return (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "") ||
          (b.score ?? 0) - (a.score ?? 0);
      return (b.score ?? 0) - (a.score ?? 0);
    });
    return out;
  }, [tab, recs, tabItems, search, urgencyFilter, categoryFilter, sort]);

  const availableCategories = useMemo(() => {
    const set = new Set<string>();
    (tab === "active" ? recs : tabItems).forEach((r) => set.add(r.category));
    return Array.from(set).sort();
  }, [tab, recs, tabItems]);

  // ---- Keyboard (NEW-294) -------------------------------------------------
  useEffect(() => {
    if (tab !== "active") return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable))
        return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const list = visible;
      if (list.length === 0) return;
      const cur = Math.max(0, Math.min(focusedIdx, list.length - 1));
      const rec = list[cur];
      switch (e.key) {
        case "j":
          e.preventDefault();
          setFocusedIdx((i) => Math.min(list.length - 1, (i < 0 ? -1 : i) + 1));
          break;
        case "k":
          e.preventDefault();
          setFocusedIdx((i) => Math.max(0, (i < 0 ? 0 : i) - 1));
          break;
        case "a":
          if (rec) doAct(rec);
          break;
        case "d":
          if (rec) doDismiss(rec, "not_now");
          break;
        case "s":
          if (rec) doSnooze(rec, new Date(Date.now() + 864e5), "1 day");
          break;
        case "e":
          if (rec)
            setExpanded((prev) => {
              const n = new Set(prev);
              n.has(rec.ruleKey) ? n.delete(rec.ruleKey) : n.add(rec.ruleKey);
              return n;
            });
          break;
        case "x":
          if (rec)
            setSelected((prev) => {
              const n = new Set(prev);
              n.has(rec.ruleKey) ? n.delete(rec.ruleKey) : n.add(rec.ruleKey);
              return n;
            });
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tab, visible, focusedIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  // Deep-link highlight (NEW-759): scroll to & expand the linked card.
  useEffect(() => {
    if (!highlightKey || tab !== "active" || visible.length === 0) return;
    setExpanded((prev) => new Set(prev).add(highlightKey));
    const node = document.getElementById(`rec-${highlightKey}`);
    node?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightKey, tab, visible.length]);

  // Close context menu on any outside click.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menu]);

  const toggleSel = (k: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });

  const copyLink = (rec: Card) => {
    const link = `${window.location.origin}/recommendations?insight=${encodeURIComponent(rec.ruleKey)}`;
    navigator.clipboard?.writeText(link);
    toast.success("Link copied");
    setMenu(null);
  };

  // ---- Render -------------------------------------------------------------
  const tabDefs: { key: Tab; label: string }[] = [
    { key: "active", label: `Active${counts.active ? ` · ${counts.active}` : ""}` },
    { key: "snoozed", label: `Snoozed${counts.snoozed ? ` · ${counts.snoozed}` : ""}` },
    { key: "dismissed", label: `Dismissed${counts.dismissed ? ` · ${counts.dismissed}` : ""}` },
    { key: "done", label: `Done${counts.done ? ` · ${counts.done}` : ""}` },
    { key: "history", label: "History" },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        {/* Title row */}
        <div className="flex items-start justify-between mb-4 gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Lightbulb className="w-6 h-6 text-amber-500" />
              Recommendations
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              What your numbers mean, translated into actions.{" "}
              {rulesEvaluated > 0 && (
                <span className="text-gray-400">
                  {rulesEvaluated} rules evaluated · {counts.active} active
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="/recommendations/catalog"
              title="Explore every insight type the engine can compute"
              className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-xl hover:bg-indigo-100 transition-colors"
            >
              <Layers className="w-4 h-4" />
              Browse all types
            </a>
            <button
              onClick={toggleDigest}
              title="Email the top recommendations to your inbox each morning"
              className={`flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-xl border transition-colors ${
                digestEnabled
                  ? "bg-amber-50 border-amber-200 text-amber-700"
                  : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
              }`}
            >
              <Mail className="w-4 h-4" />
              Daily digest {digestEnabled ? "on" : "off"}
            </button>
            <button
              onClick={() => (tab === "active" ? loadActive() : loadTab(tab))}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              Recompute
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 border-b border-gray-200 mb-4 overflow-x-auto">
          {tabDefs.map((t) => (
            <button
              key={t.key}
              onClick={() => {
                setTab(t.key);
                setSelected(new Set());
                setFocusedIdx(-1);
              }}
              className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${
                tab === t.key
                  ? "border-amber-500 text-amber-700"
                  : "border-transparent text-gray-500 hover:text-gray-800"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Toolbar: search + sort + filters */}
        <div className="flex flex-col gap-3 mb-4">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search recommendations…"
                className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-200"
              />
            </div>
            <div className="flex items-center gap-1 text-sm">
              <SlidersHorizontal className="w-4 h-4 text-gray-400" />
              {SORTS.map((s) => (
                <button
                  key={s.key}
                  onClick={() => setSort(s.key)}
                  className={`px-2.5 py-1.5 rounded-lg font-medium transition-colors ${
                    sort === s.key
                      ? "bg-gray-900 text-white"
                      : "text-gray-600 hover:bg-gray-100"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          {/* Filter chips */}
          <div className="flex items-center gap-2 flex-wrap">
            {(["now", "this_week", "this_month"] as Urgency[]).map((u) => (
              <button
                key={u}
                onClick={() =>
                  setUrgencyFilter((prev) => {
                    const n = new Set(prev);
                    n.has(u) ? n.delete(u) : n.add(u);
                    return n;
                  })
                }
                className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${
                  urgencyFilter.has(u)
                    ? URGENCY_META[u].chip + " border-transparent"
                    : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50"
                }`}
              >
                {URGENCY_META[u].label}
              </button>
            ))}
            <span className="w-px h-4 bg-gray-200 mx-1" />
            {availableCategories.map((c) => (
              <button
                key={c}
                onClick={() =>
                  setCategoryFilter((prev) => {
                    const n = new Set(prev);
                    n.has(c) ? n.delete(c) : n.add(c);
                    return n;
                  })
                }
                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                  categoryFilter.has(c)
                    ? (CATEGORY_CHIP[c] ?? "bg-gray-100 text-gray-700 border-gray-200")
                    : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50"
                }`}
              >
                {c}
              </button>
            ))}
            {(urgencyFilter.size > 0 || categoryFilter.size > 0 || search) && (
              <button
                onClick={() => {
                  setUrgencyFilter(new Set());
                  setCategoryFilter(new Set());
                  setSearch("");
                }}
                className="px-2.5 py-1 rounded-full text-xs font-medium text-gray-500 hover:text-gray-800"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Bulk bar (NEW-293) */}
        {tab === "active" && selected.size > 0 && (
          <div className="sticky top-2 z-10 flex items-center justify-between gap-3 mb-4 px-4 py-2.5 bg-gray-900 text-white rounded-xl shadow-lg">
            <span className="text-sm font-medium">{selected.size} selected</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() =>
                  bulkAction(
                    { status: "snoozed", snoozeUntil: new Date(Date.now() + 7 * 864e5).toISOString(), reason: "1 week" },
                    "Snoozed",
                  )
                }
                className="px-3 py-1.5 text-sm font-medium bg-white/10 hover:bg-white/20 rounded-lg"
              >
                Snooze 1w
              </button>
              <button
                onClick={() => bulkAction({ status: "dismissed", reason: "not_now" }, "Dismissed")}
                className="px-3 py-1.5 text-sm font-medium bg-white/10 hover:bg-white/20 rounded-lg"
              >
                Dismiss
              </button>
              <button
                onClick={() => setSelected(new Set())}
                className="p-1.5 hover:bg-white/20 rounded-lg"
                aria-label="Clear selection"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Body */}
        {loading ? (
          <div className="space-y-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="bg-white rounded-2xl border border-gray-200 p-6 animate-pulse">
                <div className="h-4 bg-gray-100 rounded w-2/3 mb-3" />
                <div className="h-4 bg-gray-100 rounded w-full mb-2" />
                <div className="h-4 bg-gray-100 rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-sm text-red-700">
            {error}
          </div>
        ) : visible.length === 0 ? (
          <EmptyState tab={tab} filtered={search !== "" || urgencyFilter.size > 0 || categoryFilter.size > 0} />
        ) : (
          <div className="space-y-4">
            {visible.map((r, idx) => {
              const urgency = URGENCY_META[r.urgency] ?? URGENCY_META.this_week;
              const UrgencyIcon = urgency.icon;
              const isOpen = expanded.has(r.ruleKey);
              const isFocused = tab === "active" && idx === focusedIdx;
              const act = actTarget(r);
              const readonly = tab !== "active";
              return (
                <div
                  key={r.ruleKey}
                  id={`rec-${r.ruleKey}`}
                  onDoubleClick={() => !readonly && doAct(r)}
                  onContextMenu={(e) => {
                    if (readonly) return;
                    e.preventDefault();
                    setMenu({ ruleKey: r.ruleKey, kind: "context", x: e.clientX, y: e.clientY });
                  }}
                  className={`bg-white rounded-2xl border p-6 transition-shadow ${
                    isFocused ? "border-amber-400 ring-2 ring-amber-100" : "border-gray-200"
                  } ${highlightKey === r.ruleKey ? "ring-2 ring-amber-300" : ""}`}
                >
                  <div className="flex items-start gap-3">
                    {tab === "active" && (
                      <input
                        type="checkbox"
                        checked={selected.has(r.ruleKey)}
                        onChange={() => toggleSel(r.ruleKey)}
                        className="mt-1.5 w-4 h-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
                        aria-label="Select recommendation"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-3 flex-wrap">
                        <span className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${urgency.chip}`}>
                          <UrgencyIcon className="w-3 h-3" />
                          {urgency.label}
                        </span>
                        <span className={`px-2.5 py-1 rounded-full text-xs font-medium border ${CATEGORY_CHIP[r.category] ?? "bg-gray-50 text-gray-600 border-gray-200"}`}>
                          {r.category}
                        </span>
                        {r.pinned && (
                          <span className="flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                            <Pin className="w-3 h-3" /> Pinned
                          </span>
                        )}
                        {r.assignedName && (
                          <span className="flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-violet-50 text-violet-700">
                            <UserPlus className="w-3 h-3" /> {r.assignedName}
                          </span>
                        )}
                        {readonly && r.status && (
                          <span className="px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                            {r.status}
                            {r.status === "snoozed" && r.snoozeUntil
                              ? ` · until ${new Date(r.snoozeUntil).toLocaleDateString()}`
                              : ""}
                          </span>
                        )}
                        {readonly && r.acted && (
                          <span className="flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700">
                            <Check className="w-3 h-3" /> acted
                          </span>
                        )}
                      </div>

                      <p className="text-sm text-gray-500 mb-2">{r.observation}</p>
                      <div className="flex items-start gap-2 mb-1">
                        <ArrowRight className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
                        <p className="text-base font-medium text-gray-900">{r.recommendation}</p>
                      </div>

                      {/* Expandable rationale (NEW-292 / NEW-297) */}
                      <button
                        onClick={() =>
                          setExpanded((prev) => {
                            const n = new Set(prev);
                            n.has(r.ruleKey) ? n.delete(r.ruleKey) : n.add(r.ruleKey);
                            return n;
                          })
                        }
                        className="flex items-center gap-1 mt-2 text-xs font-medium text-gray-400 hover:text-gray-700"
                      >
                        {isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        Why am I seeing this?
                      </button>
                      {isOpen && (
                        <div className="mt-2 p-3 bg-gray-50 rounded-xl text-xs text-gray-500 leading-relaxed space-y-1">
                          {r.rationale && <p>{r.rationale}</p>}
                          <p className="font-mono text-gray-400">
                            rule [{r.ruleKey}]{r.score != null ? ` · score ${r.score}` : ""}
                          </p>
                          {r.reason && <p>Your note: {r.reason}</p>}
                        </div>
                      )}

                      {/* Action row (active tab only) */}
                      {!readonly && (
                        <div className="flex items-center gap-1.5 mt-4 flex-wrap">
                          <button
                            onClick={() => doAct(r)}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors"
                          >
                            {act.label}
                            <ArrowRight className="w-3.5 h-3.5" />
                          </button>
                          <div className="relative">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setMenu(menu?.ruleKey === r.ruleKey && menu.kind === "snooze" ? null : { ruleKey: r.ruleKey, kind: "snooze" });
                              }}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg"
                            >
                              <Clock className="w-3.5 h-3.5" /> Snooze
                            </button>
                            {menu?.ruleKey === r.ruleKey && menu.kind === "snooze" && (
                              <div className="absolute z-20 mt-1 w-44 bg-white border border-gray-200 rounded-xl shadow-lg p-1" onClick={(e) => e.stopPropagation()}>
                                <button className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 rounded-lg" onClick={() => doSnooze(r, new Date(Date.now() + 864e5), "1 day")}>1 day</button>
                                <button className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 rounded-lg" onClick={() => doSnooze(r, new Date(Date.now() + 7 * 864e5), "1 week")}>1 week</button>
                                <div className="flex items-center gap-1 px-2 py-1.5">
                                  <input type="date" value={snoozeDate} onChange={(e) => setSnoozeDate(e.target.value)} className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1" />
                                  <button
                                    disabled={!snoozeDate}
                                    onClick={() => snoozeDate && doSnooze(r, new Date(snoozeDate + "T09:00:00"), `until ${snoozeDate}`)}
                                    className="px-2 py-1 text-xs font-medium bg-gray-900 text-white rounded-lg disabled:opacity-40"
                                  >
                                    Set
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                          <div className="relative">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setMenu(menu?.ruleKey === r.ruleKey && menu.kind === "dismiss" ? null : { ruleKey: r.ruleKey, kind: "dismiss" });
                              }}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg"
                            >
                              <X className="w-3.5 h-3.5" /> Dismiss
                            </button>
                            {menu?.ruleKey === r.ruleKey && menu.kind === "dismiss" && (
                              <div className="absolute z-20 mt-1 w-44 bg-white border border-gray-200 rounded-xl shadow-lg p-1" onClick={(e) => e.stopPropagation()}>
                                {DISMISS_REASONS.map((d) => (
                                  <button key={d.code} className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 rounded-lg" onClick={() => doDismiss(r, d.code)}>
                                    {d.label}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                          <button
                            onClick={() => doDone(r)}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" /> Done
                          </button>
                          <button
                            onClick={() => doPin(r)}
                            title="Pin to top"
                            className={`p-1.5 rounded-lg hover:bg-gray-100 ${r.pinned ? "text-amber-600" : "text-gray-400"}`}
                          >
                            <Pin className="w-4 h-4" />
                          </button>
                          <div className="ml-auto flex items-center gap-0.5">
                            <button
                              onClick={() => doFeedback(r, "helpful")}
                              title="Helpful"
                              className={`p-1.5 rounded-lg hover:bg-gray-100 ${r.feedback === "helpful" ? "text-emerald-600" : "text-gray-300"}`}
                            >
                              <ThumbsUp className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => doFeedback(r, "not_helpful")}
                              title="Not helpful"
                              className={`p-1.5 rounded-lg hover:bg-gray-100 ${r.feedback === "not_helpful" ? "text-rose-600" : "text-gray-300"}`}
                            >
                              <ThumbsDown className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Restore (non-active tabs) */}
                      {readonly && (
                        <button
                          onClick={() => doRestore(r.ruleKey)}
                          className="flex items-center gap-1.5 mt-4 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg"
                        >
                          <Undo2 className="w-3.5 h-3.5" /> Restore to feed
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Right-click context menu (NEW-305) */}
      {menu?.kind === "context" && menu.x != null && menu.y != null && (
        <div
          className="fixed z-50 w-44 bg-white border border-gray-200 rounded-xl shadow-xl p-1"
          style={{ top: menu.y, left: Math.min(menu.x, window.innerWidth - 190) }}
          onClick={(e) => e.stopPropagation()}
        >
          {(() => {
            const rec = recs.find((r) => r.ruleKey === menu.ruleKey);
            if (!rec) return null;
            return (
              <>
                <MenuItem icon={ArrowRight} label={actTarget(rec).label} onClick={() => { doAct(rec); setMenu(null); }} />
                <MenuItem icon={Clock} label="Snooze 1 week" onClick={() => doSnooze(rec, new Date(Date.now() + 7 * 864e5), "1 week")} />
                <MenuItem icon={X} label="Dismiss" onClick={() => doDismiss(rec, "not_now")} />
                <MenuItem icon={Pin} label={rec.pinned ? "Unpin" : "Pin to top"} onClick={() => { doPin(rec); setMenu(null); }} />
                <MenuItem
                  icon={UserPlus}
                  label={rec.assignedName ? `Assigned: ${rec.assignedName}` : "Assign to…"}
                  onClick={() => openAssign(rec.ruleKey)}
                />
                <MenuItem icon={Copy} label="Copy link" onClick={() => copyLink(rec)} />
              </>
            );
          })()}
        </div>
      )}

      {/* Assignee picker (NEW-296) */}
      {assignFor && (() => {
        const rec = recs.find((r) => r.ruleKey === assignFor);
        if (!rec) return null;
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center px-4"
            onMouseDown={(e) => { if (e.target === e.currentTarget) setAssignFor(null); }}
          >
            <div className="absolute inset-0 bg-gray-900/40" aria-hidden />
            <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden" role="dialog" aria-modal="true">
              <div className="px-5 py-3 border-b border-gray-100">
                <p className="text-sm font-bold text-gray-900">Assign this recommendation</p>
                <p className="text-xs text-gray-400 truncate">{rec.recommendation}</p>
              </div>
              <div className="max-h-64 overflow-y-auto py-1">
                {teamMembers.length === 0 ? (
                  <p className="px-5 py-4 text-sm text-gray-400">Loading the roster…</p>
                ) : (
                  teamMembers.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => doAssign(rec, m)}
                      className={`w-full flex items-center gap-2 px-5 py-2 text-left text-sm hover:bg-gray-50 ${
                        rec.assignedTo === m.id ? "text-violet-700 font-semibold" : "text-gray-700"
                      }`}
                    >
                      <UserPlus className="w-4 h-4 text-gray-300" />
                      {m.display_name}
                      {rec.assignedTo === m.id && <Check className="w-4 h-4 ml-auto text-violet-600" />}
                    </button>
                  ))
                )}
              </div>
              <div className="flex items-center justify-between px-5 py-2.5 border-t border-gray-100">
                {rec.assignedTo ? (
                  <button onClick={() => doAssign(rec, null)} className="text-xs font-medium text-rose-600 hover:underline">
                    Clear assignment
                  </button>
                ) : <span />}
                <button onClick={() => setAssignFor(null)} className="text-xs font-medium text-gray-500 hover:text-gray-800">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Undo snackbar (NEW-285/286/287) */}
      {undo && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-3 bg-gray-900 text-white rounded-xl shadow-xl">
          <span className="text-sm">{undo.label}</span>
          <button
            onClick={() => doRestore(undo.ruleKey)}
            className="flex items-center gap-1.5 text-sm font-semibold text-amber-300 hover:text-amber-200"
          >
            <Undo2 className="w-4 h-4" /> Undo
          </button>
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof ArrowRight;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 rounded-lg"
    >
      <Icon className="w-4 h-4 text-gray-400" />
      {label}
    </button>
  );
}

function EmptyState({ tab, filtered }: { tab: Tab; filtered: boolean }) {
  if (filtered)
    return (
      <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center">
        <p className="text-gray-900 font-semibold mb-1">No matches</p>
        <p className="text-sm text-gray-500">Nothing fits those filters — clear them to see everything.</p>
      </div>
    );
  if (tab !== "active")
    return (
      <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center">
        <p className="text-gray-900 font-semibold mb-1">Nothing here yet</p>
        <p className="text-sm text-gray-500">
          {tab === "history"
            ? "Your acted, dismissed, and completed recommendations will collect here."
            : `No ${tab} recommendations.`}
        </p>
      </div>
    );
  // NEW-308 — celebrate the all-clear + point at more coverage.
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center">
      <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-emerald-100 flex items-center justify-center">
        <CheckCircle2 className="w-6 h-6 text-emerald-600" />
      </div>
      <p className="text-gray-900 font-semibold mb-1">You're all caught up</p>
      <p className="text-sm text-gray-500 mb-4">
        Rules fire when the numbers move — soft weekdays, stockout risk, plowhorse pricing,
        vendor concentration, behind-pace goals. Recompute after service, or widen coverage.
      </p>
      <div className="flex items-center justify-center gap-2">
        <a href="/reports" className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-lg">
          <BellRing className="w-4 h-4" /> Enable more insight types
        </a>
        <a href="/reports" className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg">
          <Link2 className="w-4 h-4" /> Open Reports
        </a>
      </div>
    </div>
  );
}
