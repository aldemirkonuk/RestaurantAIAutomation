/**
 * InsightCatalog — "Browse all 375 insight types" explorer.
 *
 * UX paths (UX_PATHS_CATALOG.md §Z1):
 *   NEW-707 full-screen explorer · NEW-708 dimensions w/ counts
 *   NEW-709 measures per dimension · NEW-710 comparators per dimension
 *   NEW-711 select a cell → type key + category · NEW-712 hover detail
 *   NEW-713 detail pane (desc, requirements, example) · NEW-718 fuzzy search
 *   NEW-719 category filter + readiness · NEW-720 blocked → what's missing
 *   NEW-722 coverage meter · NEW-724 deep-link ?type= · NEW-727 export JSON/CSV
 *
 * Backed by GET /analytics/insight-catalog/types (pure enumeration + optional
 * per-restaurant data availability). No fabricated numbers.
 */

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Boxes,
  Copy,
  Download,
  Layers,
  Lock,
  Search,
  Sparkles,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../contexts/ToastContext";
import { Header } from "../components/layout/Header";

const API_URL = import.meta.env.VITE_API_GATEWAY_URL || "http://localhost:4000";

interface Candidate {
  key: string;
  dimension: string;
  measure: string;
  comparator: string;
  category: string;
  template: string;
  requires: string[];
}
interface Dim {
  key: string;
  label: string;
  entityScoped: boolean;
  requires: string[];
}
interface Measure {
  key: string;
  label: string;
  unit: string;
  requires: string[];
}
interface Comparator {
  key: string;
  label: string;
  template: string;
}
interface Catalog {
  total: number;
  byCategory: Record<string, number>;
  dimensions: Dim[];
  measures: Measure[];
  comparators: Comparator[];
  candidates: Candidate[];
  available: string[] | null;
}

const CATEGORY_CHIP: Record<string, string> = {
  sales: "bg-emerald-50 text-emerald-700 border-emerald-200",
  purchasing: "bg-blue-50 text-blue-700 border-blue-200",
  inventory: "bg-amber-50 text-amber-700 border-amber-200",
  efficiency: "bg-indigo-50 text-indigo-700 border-indigo-200",
  tables: "bg-purple-50 text-purple-700 border-purple-200",
  staff: "bg-pink-50 text-pink-700 border-pink-200",
  basket: "bg-rose-50 text-rose-700 border-rose-200",
  risk: "bg-red-50 text-red-700 border-red-200",
  forecast: "bg-cyan-50 text-cyan-700 border-cyan-200",
  goals: "bg-gray-50 text-gray-700 border-gray-200",
};

export default function InsightCatalog() {
  const { user } = useAuth();
  const toast = useToast();
  const restaurantId = user?.restaurantId;
  const [searchParams, setSearchParams] = useSearchParams();

  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [dim, setDim] = useState<string>(searchParams.get("dim") || "overall");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<Set<string>>(new Set());
  const [selectedKey, setSelectedKey] = useState<string | null>(
    searchParams.get("type"),
  );

  useEffect(() => {
    const params = restaurantId ? `?restaurantId=${restaurantId}` : "";
    fetch(`${API_URL}/api/v1/analytics/insight-catalog/types${params}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (!body) return;
        setCatalog(body);
        // Deep-link (?type=): jump to that cell's dimension.
        const t = searchParams.get("type");
        if (t) {
          const c = body.candidates.find((x: Candidate) => x.key === t);
          if (c) setDim(c.dimension);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantId]);

  const measureByKey = useMemo(
    () => new Map((catalog?.measures ?? []).map((m) => [m.key, m])),
    [catalog],
  );
  const comparatorByKey = useMemo(
    () => new Map((catalog?.comparators ?? []).map((c) => [c.key, c])),
    [catalog],
  );
  const available = useMemo(
    () => new Set(catalog?.available ?? []),
    [catalog],
  );

  const dimCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of catalog?.candidates ?? [])
      m[c.dimension] = (m[c.dimension] || 0) + 1;
    return m;
  }, [catalog]);

  const isComputable = (c: Candidate) =>
    catalog?.available == null ? null : c.requires.every((r) => available.has(r));

  const computableTotal = useMemo(() => {
    if (catalog?.available == null) return null;
    return (catalog.candidates ?? []).filter((c) =>
      c.requires.every((r) => available.has(r)),
    ).length;
  }, [catalog, available]);

  const rows = useMemo(() => {
    if (!catalog) return [];
    const q = search.trim().toLowerCase();
    return catalog.candidates
      .filter((c) => c.dimension === dim)
      .filter((c) => !categoryFilter.size || categoryFilter.has(c.category))
      .filter((c) => {
        if (!q) return true;
        const meas = measureByKey.get(c.measure)?.label ?? c.measure;
        const cmp = comparatorByKey.get(c.comparator)?.label ?? c.comparator;
        return `${c.key} ${c.category} ${meas} ${cmp}`.toLowerCase().includes(q);
      });
  }, [catalog, dim, search, categoryFilter, measureByKey, comparatorByKey]);

  // Global search across ALL dimensions (not only the selected one).
  const globalMatches = useMemo(() => {
    if (!catalog) return [];
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return catalog.candidates
      .filter((c) => `${c.key} ${c.category}`.toLowerCase().includes(q))
      .slice(0, 40);
  }, [catalog, search]);

  const selected = useMemo(
    () => catalog?.candidates.find((c) => c.key === selectedKey) ?? null,
    [catalog, selectedKey],
  );

  const selectType = (key: string) => {
    setSelectedKey(key);
    const next = new URLSearchParams(searchParams);
    next.set("type", key);
    setSearchParams(next, { replace: true });
  };

  const copyLink = (key: string) => {
    navigator.clipboard?.writeText(
      `${window.location.origin}/recommendations/catalog?type=${key}`,
    );
    toast.success("Type link copied");
  };

  const exportCatalog = (fmt: "json" | "csv") => {
    if (!catalog) return;
    let blob: Blob;
    if (fmt === "json") {
      blob = new Blob([JSON.stringify(catalog.candidates, null, 2)], {
        type: "application/json",
      });
    } else {
      const head = "key,dimension,measure,comparator,category,requires";
      const lines = catalog.candidates.map(
        (c) =>
          `${c.key},${c.dimension},${c.measure},${c.comparator},${c.category},${c.requires.join("|")}`,
      );
      blob = new Blob([[head, ...lines].join("\n")], { type: "text/csv" });
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `insight-catalog.${fmt}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const categories = Object.keys(catalog?.byCategory ?? {}).sort();

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Layers className="w-6 h-6 text-indigo-500" />
              Insight Catalog
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Every insight type the engine can compute — dimension × measure ×
              comparator.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="/recommendations"
              className="px-3 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-xl hover:bg-gray-50"
            >
              ← Recommendations
            </a>
            <button
              onClick={() => exportCatalog("csv")}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-xl hover:bg-gray-50"
            >
              <Download className="w-4 h-4" /> CSV
            </button>
            <button
              onClick={() => exportCatalog("json")}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-xl hover:bg-gray-50"
            >
              <Download className="w-4 h-4" /> JSON
            </button>
          </div>
        </div>

        {/* Coverage meter (NEW-722) */}
        {catalog && (
          <div className="flex items-center gap-4 mb-4 px-4 py-3 bg-white border border-gray-200 rounded-2xl text-sm">
            <span className="flex items-center gap-1.5 font-semibold text-gray-900">
              <Boxes className="w-4 h-4 text-indigo-500" />
              {catalog.total} types
            </span>
            <span className="text-gray-300">·</span>
            <span className="text-gray-600">
              {computableTotal == null ? (
                "sign in to see what's computable with your data"
              ) : (
                <>
                  <span className="font-semibold text-emerald-600">
                    {computableTotal}
                  </span>{" "}
                  computable now ·{" "}
                  <span className="font-semibold text-amber-600">
                    {catalog.total - computableTotal}
                  </span>{" "}
                  blocked on missing data
                </>
              )}
            </span>
          </div>
        )}

        {/* Search + category filters */}
        <div className="flex items-center gap-2 flex-wrap mb-4">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search all ${catalog?.total ?? ""} types (key, category, measure…)`}
              className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-200"
            />
          </div>
          {categories.map((c) => (
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
              {c} {catalog?.byCategory[c] ?? 0}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="h-64 bg-white rounded-2xl border border-gray-200 animate-pulse" />
        ) : !catalog ? (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-sm text-red-700">
            Couldn't load the catalog.
          </div>
        ) : search.trim() ? (
          /* Global search results across every dimension */
          <div className="bg-white rounded-2xl border border-gray-200 divide-y divide-gray-100">
            <div className="px-4 py-2 text-xs font-medium text-gray-400">
              {globalMatches.length} match{globalMatches.length === 1 ? "" : "es"} across all dimensions
            </div>
            {globalMatches.map((c) => (
              <TypeRow
                key={c.key}
                c={c}
                measureByKey={measureByKey}
                comparatorByKey={comparatorByKey}
                computable={isComputable(c)}
                selected={selectedKey === c.key}
                onSelect={() => selectType(c.key)}
              />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr_320px] gap-4">
            {/* Dimensions rail (NEW-708) */}
            <div className="bg-white rounded-2xl border border-gray-200 p-2 h-fit">
              {catalog.dimensions.map((d) => (
                <button
                  key={d.key}
                  onClick={() => setDim(d.key)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm transition-colors ${
                    dim === d.key
                      ? "bg-indigo-50 text-indigo-700 font-semibold"
                      : "text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  <span>{d.label}</span>
                  <span className="text-xs text-gray-400 tabular-nums">
                    {dimCounts[d.key] ?? 0}
                  </span>
                </button>
              ))}
            </div>

            {/* Candidate types for the selected dimension */}
            <div className="bg-white rounded-2xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">
              {rows.length === 0 ? (
                <p className="p-6 text-sm text-gray-500">
                  No types match those filters for this dimension.
                </p>
              ) : (
                rows.map((c) => (
                  <TypeRow
                    key={c.key}
                    c={c}
                    measureByKey={measureByKey}
                    comparatorByKey={comparatorByKey}
                    computable={isComputable(c)}
                    selected={selectedKey === c.key}
                    onSelect={() => selectType(c.key)}
                  />
                ))
              )}
            </div>

            {/* Detail pane (NEW-711/713) */}
            <div className="h-fit lg:sticky lg:top-4">
              {selected ? (
                <DetailPane
                  c={selected}
                  dim={catalog.dimensions.find((d) => d.key === selected.dimension)}
                  measure={measureByKey.get(selected.measure)}
                  comparator={comparatorByKey.get(selected.comparator)}
                  available={catalog.available}
                  onCopyLink={() => copyLink(selected.key)}
                />
              ) : (
                <div className="bg-white rounded-2xl border border-gray-200 p-6 text-sm text-gray-500">
                  <Sparkles className="w-5 h-5 text-indigo-400 mb-2" />
                  Select a type to see its definition, data requirements, and a
                  stable deep link.
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function TypeRow({
  c,
  measureByKey,
  comparatorByKey,
  computable,
  selected,
  onSelect,
}: {
  c: Candidate;
  measureByKey: Map<string, Measure>;
  comparatorByKey: Map<string, Comparator>;
  computable: boolean | null;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors ${selected ? "bg-indigo-50/60" : ""}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-gray-900">
          {measureByKey.get(c.measure)?.label ?? c.measure}{" "}
          <span className="text-gray-400">·</span>{" "}
          {comparatorByKey.get(c.comparator)?.label ?? c.comparator}
        </span>
        <span className="flex items-center gap-1.5 shrink-0">
          {computable === false && (
            <Lock className="w-3.5 h-3.5 text-amber-500" aria-label="Blocked" />
          )}
          <span
            className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${CATEGORY_CHIP[c.category] ?? "bg-gray-50 text-gray-600 border-gray-200"}`}
          >
            {c.category}
          </span>
        </span>
      </div>
      <span className="font-mono text-[11px] text-gray-400">{c.key}</span>
    </button>
  );
}

function DetailPane({
  c,
  dim,
  measure,
  comparator,
  available,
  onCopyLink,
}: {
  c: Candidate;
  dim?: Dim;
  measure?: Measure;
  comparator?: Comparator;
  available: string[] | null;
  onCopyLink: () => void;
}) {
  const availSet = new Set(available ?? []);
  const missing = available == null ? [] : c.requires.filter((r) => !availSet.has(r));
  const blocked = missing.length > 0;
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4">
      <div>
        <span
          className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${CATEGORY_CHIP[c.category] ?? "bg-gray-50 text-gray-600 border-gray-200"}`}
        >
          {c.category}
        </span>
        <p className="font-mono text-xs text-gray-500 mt-2 break-all">{c.key}</p>
      </div>

      <dl className="text-sm space-y-1.5">
        <Row label="Dimension" value={`${dim?.label ?? c.dimension}${dim?.entityScoped ? " (per entity)" : ""}`} />
        <Row label="Measure" value={`${measure?.label ?? c.measure}${measure?.unit ? ` · ${measure.unit}` : ""}`} />
        <Row label="Comparator" value={comparator?.label ?? c.comparator} />
        <Row label="Template" value={c.template} />
      </dl>

      <div>
        <p className="text-xs font-semibold text-gray-500 mb-1.5">Data required</p>
        <div className="flex flex-wrap gap-1.5">
          {c.requires.length === 0 ? (
            <span className="text-xs text-gray-400">None (always computable)</span>
          ) : (
            c.requires.map((r) => {
              const ok = available == null ? null : availSet.has(r);
              return (
                <span
                  key={r}
                  className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${
                    ok === false
                      ? "bg-amber-100 text-amber-700"
                      : ok === true
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {r}
                </span>
              );
            })
          )}
        </div>
      </div>

      {/* Blocked explainer (NEW-720) */}
      {blocked && (
        <div className="p-3 bg-amber-50 rounded-xl text-xs text-amber-800">
          Blocked — needs <b>{missing.join(", ")}</b>. Connect your POS or import
          this data to unlock this type.{" "}
          <a href="/settings" className="underline font-medium">
            Open Settings
          </a>
        </div>
      )}

      <button
        onClick={onCopyLink}
        className="flex items-center gap-1.5 w-full justify-center px-3 py-2 text-sm font-medium text-gray-600 bg-gray-50 hover:bg-gray-100 rounded-xl"
      >
        <Copy className="w-4 h-4" /> Copy deep link
      </button>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-gray-400">{label}</dt>
      <dd className="text-gray-800 font-medium text-right">{value}</dd>
    </div>
  );
}
