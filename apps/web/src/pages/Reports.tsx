/**
 * Reports Page - Refactored with Notion-style DashboardCanvas
 * Uses react-grid-layout for drag/resize blocks with inline configuration.
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import { Link } from "react-router-dom";
import { Reorder } from "framer-motion";
import { useAuth } from "../contexts/AuthContext";
import { useRealtimeDispatch } from "../contexts/RealtimeContext";
import { useInventoryData } from "../hooks/useInventoryData";
import { useOrdersMetrics } from "../hooks/useOrdersMetrics";
import { useWinesByIds } from "../hooks/queries";
import { mapApiWinesToUiWines } from "../lib/wine-library";
import { Header } from "../components/layout/Header";
import {
  exportTable,
  type TableExportColumn,
  type TableExportFormat,
} from "../lib/tableExport";
import { AlertTriangle, Wine, Settings } from "lucide-react";
import { isInteractiveReorderSurfaceTarget } from "../lib/reports-drag";
import { ReportGenerator } from "../components/reports/ReportGenerator";
import { TopBar } from "../components/reports/organisms/TopBar";
import { HeadlineInsightsBar } from "../components/reports/organisms/HeadlineInsightsBar";
import { EngineInsightsPanel } from "../components/reports/organisms/EngineInsightsPanel";
import { SeatingDensityPanel } from "../components/reports/organisms/SeatingDensityPanel";
import {
  DataTablesSection,
  ExpandedSections,
} from "../components/reports/organisms/DataTablesSection";
import {
  AICommandPalette,
  AICommandPill,
} from "../components/reports/organisms/AICommandPalette";
import { MonthlyReconciliation } from "../components/reports/organisms/MonthlyReconciliation";
import { useQuery } from "@tanstack/react-query";
import { describeReportsGap } from "../lib/reportsDataGap";
import { getPosStatus } from "../services/api/posHub";
import { PeriodCompareBar } from "../components/reports/molecules/PeriodCompareBar";
import { formatMoney } from "../lib/utils";
// `bottlesToVolume` is gone on purpose: bottle volume is now the MEASURED
// `volume_ml` the POS recorded, not bottles × an assumed 750ml.
import {
  formatVolume,
  costPerGlass,
  glassMarginPercent,
  getGlassesPerBottle,
} from "../utils/volumeUtils";
import { useRestaurantSettingsStore } from "../stores/restaurantSettingsStore";
import {
  loadLayout,
  loadDashboardBlocks,
  parseLayoutFromPreferences,
  parseDashboardBlocksFromPreferences,
  serializeLayout,
  serializeDashboardBlocks,
} from "../lib/reports";
import { useUserPreferences } from "../hooks/useUserPreferences";
import {
  getPosRevenue,
  NO_POS_REVENUE,
  type PosRevenueWindow,
} from "../services/api/analytics";
import type { LayoutConfig } from "../lib/reports/types";
import type {
  WineTypeDistribution,
  TopWine,
  PurchaseMetrics,
  CheckScan,
} from "../components/reports/molecules";

// New dashboard system
import { DashboardCanvas } from "../components/reports/DashboardCanvas";
import { EditToolbar } from "../components/reports/EditToolbar";
import { DEFAULT_BLOCKS } from "../components/reports/dashboardMeta";
import type {
  DashboardBlock,
  LayoutPreset,
} from "../components/reports/dashboardTypes";
import { KPISpotlightView } from "../components/reports/molecules/KPISpotlightView";

// Default sections configuration
const DEFAULT_SECTIONS = [
  {
    id: "aiInsights",
    type: "aiInsights" as const,
    visible: true,
    expanded: true,
  },
  {
    id: "reportGenerator",
    type: "reportGenerator" as const,
    visible: true,
    expanded: false,
  },
  {
    id: "dailyBreakdown",
    type: "dailyBreakdown" as const,
    visible: true,
    expanded: true,
  },
  {
    id: "purchasedWines",
    type: "purchasedWines" as const,
    visible: true,
    expanded: false,
  },
  {
    id: "checkScanner",
    type: "checkScanner" as const,
    visible: true,
    expanded: false,
  },
];

/**
 * One day of PURCHASE-order activity. Every figure here is sourced from
 * `procurement_orders` (via useOrdersMetrics/ordersApi) — money the restaurant
 * PAYS its vendors. `spend` is not sales revenue; sales revenue lives in
 * `pos_checks` and is not read anywhere on this page.
 */
type PurchaseDay = {
  date: string;
  fullDate: string;
  /** Vendor spend for the day (sum of purchase-order totals). */
  spend: number;
  orders: number;
  bottles: number;
  avgOrderValue: number;
  red: number;
  white: number;
  sparkling: number;
  rose: number;
  dessert: number;
};

const formatShortDate = (date: Date) =>
  date.toLocaleDateString("en-US", { month: "short", day: "numeric" });

const createEmptyPurchaseDay = (date: Date): PurchaseDay => ({
  date: formatShortDate(date),
  fullDate: date.toISOString().split("T")[0],
  spend: 0,
  orders: 0,
  bottles: 0,
  avgOrderValue: 0,
  red: 0,
  white: 0,
  sparkling: 0,
  rose: 0,
  dessert: 0,
});

// Helper function to calculate margin
function calculateMargin(costPrice: number, menuPrice: number): number {
  if (!menuPrice || menuPrice === 0) return 0;
  return ((menuPrice - costPrice) / menuPrice) * 100;
}

// Helper function to get default menu price (3x markup as industry standard)
function getDefaultMenuPrice(costPrice: number): number {
  return Math.round(costPrice * 3);
}

// Generate metrics
const generateMetrics = (
  data: PurchaseDay[],
  inventoryData?: { inventory: any[]; summary: any },
  orderData?: {
    totalOrders: number;
    totalOrderValue: number;
    totalBottlesOrdered: number;
    avgOrderValue: number;
    spendThisMonth: number;
    monthOverMonthGrowth: number;
    ordersByWineType: {
      red: number;
      white: number;
      sparkling: number;
      rose: number;
      dessert: number;
    };
  },
) => {
  const totalSpend =
    orderData?.totalOrderValue || data.reduce((sum, d) => sum + d.spend, 0);
  const totalOrders =
    orderData?.totalOrders || data.reduce((sum, d) => sum + d.orders, 0);
  const totalBottles =
    orderData?.totalBottlesOrdered ||
    data.reduce((sum, d) => sum + d.bottles, 0);
  const avgOrderValue =
    orderData?.avgOrderValue ||
    (totalOrders > 0 ? Math.round(totalSpend / totalOrders) : 0);

  // Month-over-month change in vendor spend. A positive value means the
  // restaurant paid its vendors MORE, which is a cost increase, not growth.
  let spendChange: number;
  if (orderData) {
    spendChange = orderData.monthOverMonthGrowth;
  } else {
    const midpoint = Math.floor(data.length / 2);
    const firstHalf = data
      .slice(0, midpoint)
      .reduce((sum, d) => sum + d.spend, 0);
    const secondHalf = data
      .slice(midpoint)
      .reduce((sum, d) => sum + d.spend, 0);
    spendChange =
      firstHalf > 0
        ? parseFloat((((secondHalf - firstHalf) / firstHalf) * 100).toFixed(1))
        : 0;
  }

  let totalCost: number;
  let inventoryValue: number;
  let profitMargin: number;
  let totalMenuValue: number;

  if (inventoryData?.inventory && inventoryData.inventory.length > 0) {
    totalCost = inventoryData.inventory.reduce((sum, item) => {
      const stock = (item.stockLive || 0) + (item.shadowStock || 0);
      const cost = item.price || item.costPrice || 0;
      return sum + cost * stock;
    }, 0);
    totalMenuValue = inventoryData.inventory.reduce((sum, item) => {
      const stock = (item.stockLive || 0) + (item.shadowStock || 0);
      const cost = item.price || item.costPrice || 0;
      const menu = item.menuPrice || getDefaultMenuPrice(cost);
      return sum + menu * stock;
    }, 0);
    inventoryValue = totalMenuValue;
    profitMargin =
      totalMenuValue > 0 ? calculateMargin(totalCost, totalMenuValue) : 0;
  } else {
    // No inventory data - show zeroes instead of fabricated estimates
    totalCost = 0;
    inventoryValue = 0;
    totalMenuValue = 0;
    profitMargin = 0;
  }

  const profitValue = totalMenuValue - totalCost;

  return {
    totalSpend,
    totalOrders,
    totalBottles,
    avgOrderValue,
    spendChange,
    inventoryValue: Math.round(inventoryValue),
    profitMargin: parseFloat(profitMargin.toFixed(1)),
    profitValue: Math.round(profitValue),
    totalCost: Math.round(totalCost),
    totalMenuValue: Math.round(totalMenuValue),
    orderDataSource: orderData ? "real" : "synthetic",
  };
};

export function Reports() {
  const { user } = useAuth();
  const restaurantId = user?.restaurantId;
  const { measurementUnit } = useRestaurantSettingsStore();
  const { dispatchReportEvent } = useRealtimeDispatch();

  // Fetch real inventory data
  const { inventory, summary: inventorySummary } = useInventoryData();
  const { metrics: orderMetrics, orders: _ordersHistory } = useOrdersMetrics();
  const { preferences, updatePreferences } = useUserPreferences();

  const [timeRange, setTimeRange] = useState<"7d" | "30d" | "90d">("30d");
  const [loading, setLoading] = useState(true);
  const [exportSuccess, setExportSuccess] = useState<string | null>(null);

  // ── Real POS sales revenue (OD-85) ──────────────────────────────────
  // Everything else on this page is PURCHASE data (procurement_orders) — money
  // the restaurant pays out. This is the only sales figure on the page, and it
  // unblocks four surfaces that previously had nothing to read: the COGS ratio,
  // Wine Consumption Analytics, the labour overlay and the channel donut.
  //
  // `posRevenue: null` is load-bearing. A restaurant with no POS has no revenue
  // DATA — it did not sell $0 — so every consumer branches on `posConnected`
  // and shows an empty state (ADR 0020). `posError` is kept distinct so a failed
  // request never masquerades as "no POS connected".
  const [pos, setPos] = useState<PosRevenueWindow>(NO_POS_REVENUE);
  const [posError, setPosError] = useState<string | null>(null);

  // ── Legacy layout state (for sections - read-only) ──────────────────
  const [layout] = useState<LayoutConfig>(() => {
    const fromPrefs = parseLayoutFromPreferences(preferences.reportsLayout);
    return (
      fromPrefs ||
      loadLayout() || {
        kpiCards: [],
        charts: [],
        sections: DEFAULT_SECTIONS,
        version: 1,
      }
    );
  });

  // ── New dashboard blocks state ─────────────────────────────────────
  const [dashboardBlocks, setDashboardBlocks] = useState<DashboardBlock[]>(
    () => {
      const fromPrefs = parseDashboardBlocksFromPreferences(
        preferences.dashboardBlocks,
      );
      return fromPrefs || loadDashboardBlocks() || DEFAULT_BLOCKS;
    },
  );

  const [isEditMode, setIsEditMode] = useState(false);

  // Expanded sections state (includes extra keys beyond ExpandedSections for reconciliation)
  const [expandedSections, setExpandedSections] = useState<
    ExpandedSections & { reconciliation?: boolean }
  >({
    dailyBreakdown: true,
    purchasedWines: false,
    checkScanner: false,
    reconciliation: false,
  });

  // AI Insights state
  // (headline strip + EngineInsightsPanel; legacy AIInsightsSection removed)

  // KPI Spotlight state
  const [spotlightedKPI, setSpotlightedKPI] = useState<string | null>(null);

  // Period comparison state
  const [showComparison, setShowComparison] = useState(false);

  // AI Command Palette state
  const [showAIPalette, setShowAIPalette] = useState(false);

  // Reorderable section IDs (below the canvas)
  const [sectionOrder, setSectionOrder] = useState<string[]>([
    "aiInsights",
    "dataTable",
    "reconciliation",
    "consumption",
    "reportGenerator",
  ]);

  // Close spotlight / AI palette on Escape key, ⌘K to open palette
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showAIPalette) {
          setShowAIPalette(false);
          return;
        }
        if (spotlightedKPI) setSpotlightedKPI(null);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setShowAIPalette((v) => !v);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [spotlightedKPI, showAIPalette]);

  // ── Data derivation ────────────────────────────────────────────────

  const inventoryById = useMemo(() => {
    const map = new Map<string, { wineId?: string }>();
    inventory.forEach((item) => {
      map.set(item.id, { wineId: item.wineId });
    });
    return map;
  }, [inventory]);

  const orderMasterWineIds = useMemo(() => {
    const ids = new Set<string>();
    _ordersHistory.forEach((order) => {
      const masterId = inventoryById.get(order.wineId)?.wineId || order.wineId;
      if (masterId) ids.add(masterId);
    });
    return Array.from(ids);
  }, [_ordersHistory, inventoryById]);

  const { data: orderWines = [] } = useWinesByIds(orderMasterWineIds);
  const wineTypeById = useMemo(() => {
    const map = new Map<
      string,
      "red" | "white" | "sparkling" | "rose" | "dessert"
    >();
    mapApiWinesToUiWines(orderWines).forEach((wine) => {
      map.set(wine.id, wine.type);
    });
    return map;
  }, [orderWines]);

  const ordersWithType = useMemo(() => {
    return _ordersHistory.map((order) => {
      const masterId = inventoryById.get(order.wineId)?.wineId || order.wineId;
      const wineType = masterId ? wineTypeById.get(masterId) : undefined;
      return { ...order, wineType };
    });
  }, [_ordersHistory, inventoryById, wineTypeById]);

  // Bucket real PURCHASE orders by day. Every money figure below is vendor
  // spend from `procurement_orders`, never POS sales revenue.
  const purchaseDayData = useMemo(() => {
    const days = timeRange === "7d" ? 7 : timeRange === "30d" ? 30 : 90;
    const now = new Date();
    const buckets = new Map<string, PurchaseDay>();
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const day = createEmptyPurchaseDay(date);
      buckets.set(day.fullDate, day);
    }

    ordersWithType.forEach((order) => {
      const orderDate = order.createdAt?.split("T")[0];
      if (!orderDate || !buckets.has(orderDate)) return;
      const day = buckets.get(orderDate)!;
      day.orders += 1;
      day.bottles += order.quantity;
      day.spend += order.totalPrice;
      if (order.wineType) {
        day[order.wineType] += order.quantity;
      }
    });

    const result = Array.from(buckets.values());
    result.forEach((day) => {
      day.avgOrderValue =
        day.orders > 0 ? Math.round(day.spend / day.orders) : 0;
    });
    return result;
  }, [ordersWithType, timeRange]);

  const purchaseData = useMemo(() => {
    return purchaseDayData.map((day) => ({
      date: day.date,
      fullDate: day.fullDate,
      totalCost: day.spend,
      totalBottles: day.bottles,
      orderCount: day.orders,
      red: day.red,
      white: day.white,
      sparkling: day.sparkling,
      rose: day.rose,
      dessert: day.dessert,
    }));
  }, [purchaseDayData]);

  const wineTypeTotals = useMemo(
    () => ({
      red: purchaseDayData.reduce((sum, d) => sum + d.red, 0),
      white: purchaseDayData.reduce((sum, d) => sum + d.white, 0),
      sparkling: purchaseDayData.reduce((sum, d) => sum + d.sparkling, 0),
      rose: purchaseDayData.reduce((sum, d) => sum + d.rose, 0),
      dessert: purchaseDayData.reduce((sum, d) => sum + d.dessert, 0),
    }),
    [purchaseDayData],
  );

  const metrics = useMemo(
    () =>
      generateMetrics(
        purchaseDayData,
        { inventory, summary: inventorySummary },
        orderMetrics
          ? {
              totalOrders: orderMetrics.totalOrders,
              totalOrderValue: orderMetrics.totalOrderValue,
              totalBottlesOrdered: orderMetrics.totalBottlesOrdered,
              avgOrderValue: orderMetrics.avgOrderValue,
              spendThisMonth: orderMetrics.spendThisMonth,
              monthOverMonthGrowth: orderMetrics.monthOverMonthGrowth,
              ordersByWineType: wineTypeTotals,
            }
          : undefined,
      ),
    [
      purchaseDayData,
      inventory,
      inventorySummary,
      orderMetrics,
      wineTypeTotals,
    ],
  );

  const purchaseMetrics: PurchaseMetrics = useMemo(() => {
    const totalSpent = purchaseData.reduce((sum, p) => sum + p.totalCost, 0);
    const totalBottlesPurchased = purchaseData.reduce(
      (sum, p) => sum + p.totalBottles,
      0,
    );
    // `purchaseData.length` is one row per DAY of the selected window, so this
    // read "30 orders" over a tenant with zero `procurement_orders` — thirty
    // days wearing the word "orders" (intelligence lens, defect 2). Each day
    // already carries its own order count; summing those counts orders.
    const totalOrders = purchaseData.reduce(
      (sum, p) => sum + (p.orderCount || 0),
      0,
    );
    const avgCostPerBottle =
      totalBottlesPurchased > 0 ? totalSpent / totalBottlesPurchased : 0;
    return { totalSpent, totalBottlesPurchased, totalOrders, avgCostPerBottle };
  }, [purchaseData]);

  /**
   * Is a POS connected, and is it sending? Read so the empty-state banner can
   * name the RIGHT gap rather than always blaming the connection (defect 9).
   * A failed status read is its own case — never a guess in either direction.
   */
  const posStatusQuery = useQuery({
    queryKey: ["pos-hub", "status", "reports-banner"],
    queryFn: () => getPosStatus(),
    staleTime: 300_000,
    retry: false,
  });
  const dataGap = useMemo(
    () =>
      describeReportsGap({
        totalSpend: metrics.totalSpend,
        totalOrders: metrics.totalOrders,
        posChecks: posStatusQuery.data?.totalChecks ?? null,
        posStatusUnavailable:
          posStatusQuery.isError || posStatusQuery.data?.unavailable === true,
      }),
    [
      metrics.totalSpend,
      metrics.totalOrders,
      posStatusQuery.data,
      posStatusQuery.isError,
    ],
  );

  const checkScans: CheckScan[] = useMemo(() => [], []);

  const topWines: TopWine[] = useMemo(() => {
    const days = timeRange === "7d" ? 7 : timeRange === "30d" ? 30 : 90;
    const start = new Date();
    start.setDate(start.getDate() - (days - 1));
    const aggregation = new Map<string, TopWine>();
    ordersWithType.forEach((order) => {
      const orderDate = new Date(order.createdAt);
      if (orderDate < start) return;
      const key = order.wineId || order.wineName;
      const existing = aggregation.get(key) || {
        name: order.wineName,
        value: 0,
        orders: 0,
        red: 0,
        white: 0,
        sparkling: 0,
        rose: 0,
        dessert: 0,
      };
      existing.value += order.totalPrice;
      existing.orders += order.quantity;
      if (order.wineType) {
        existing[order.wineType] += order.quantity;
      }
      aggregation.set(key, existing);
    });
    return Array.from(aggregation.values())
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  }, [ordersWithType, timeRange]);

  const wineTypeDistribution: WineTypeDistribution[] = useMemo(() => {
    const total =
      wineTypeTotals.red +
      wineTypeTotals.white +
      wineTypeTotals.sparkling +
      wineTypeTotals.rose +
      wineTypeTotals.dessert;
    if (total <= 0) return [];
    return [
      {
        name: "Red",
        value: Math.round((wineTypeTotals.red / total) * 100),
        color: "#be123c",
      },
      {
        name: "White",
        value: Math.round((wineTypeTotals.white / total) * 100),
        color: "#fbbf24",
      },
      {
        name: "Sparkling",
        value: Math.round((wineTypeTotals.sparkling / total) * 100),
        color: "#facc15",
      },
      {
        name: "Rosé",
        value: Math.round((wineTypeTotals.rose / total) * 100),
        color: "#f472b6",
      },
      {
        name: "Dessert",
        value: Math.round((wineTypeTotals.dessert / total) * 100),
        color: "#a855f7",
      },
    ];
  }, [wineTypeTotals]);

  // ── Consumption Analytics ────────────────────────────────────────────
  // Real rows from `wine_consumption_log` via GET /analytics/pos-revenue —
  // this was hard-coded to `[]` until OD-85, which is why the section only ever
  // rendered its "connect your POS" state even for restaurants that had one.
  const consumptionData = pos.consumption;
  const hasConsumptionData = pos.posConnected && consumptionData.length > 0;

  const bottleConsumptionRows = useMemo(
    () => consumptionData.filter((d) => d.bottlesSold > 0),
    [consumptionData],
  );
  const glassConsumptionRows = useMemo(
    () => consumptionData.filter((d) => d.glassesSold > 0),
    [consumptionData],
  );

  const consumptionTotals = useMemo(() => {
    // Every figure is a SUM of what was recorded, not quantity × a single
    // price: a wine poured at two prices in the window has two real revenues,
    // and multiplying by one of them would invent a third. `null` revenues
    // (lines the POS gave us no price for) are skipped, never counted as $0.
    const sum = (fn: (d: (typeof consumptionData)[number]) => number | null) =>
      consumptionData.reduce((s, d) => s + (fn(d) ?? 0), 0);

    return {
      totalBottlesSold: sum((d) => d.bottlesSold),
      totalBottleRevenue: sum((d) => d.bottleRevenue),
      totalBottleVolumeMl: sum((d) => d.bottleVolumeMl),
      totalGlassesSold: sum((d) => d.glassesSold),
      totalGlassRevenue: sum((d) => d.glassRevenue),
      // Measured volumes, so a 500ml carafe counts as 500ml rather than as
      // "one glass" of an assumed 150ml pour.
      totalGlassBottleEquiv: consumptionData.reduce((s, d) => {
        if (!d.glassVolumeMl || !d.avgBottleMl) return s;
        return s + d.glassVolumeMl / d.avgBottleMl;
      }, 0),
      /** True when at least one sale had no price attached — totals understate. */
      revenueIncomplete: consumptionData.some(
        (d) => !d.bottleRevenueComplete || !d.glassRevenueComplete,
      ),
    };
  }, [consumptionData]);

  // Get KPI value based on key
  const getKPIValue = useCallback(
    (
      key: string,
    ): {
      value: string | number;
      change: number;
      changeType: "increase" | "decrease";
    } => {
      // All change values are 0 until real historical comparison data is available from POS
      switch (key) {
        // NOTE: the key string 'revenue' is a persisted layout key (saved into
        // user preferences as DashboardBlock.dataSource) and is frozen for
        // backwards compatibility. The VALUE it returns is vendor spend.
        case "revenue":
          return {
            value:
              metrics.totalSpend > 0
                ? formatMoney(metrics.totalSpend, "compact")
                : "--",
            change: metrics.spendChange,
            changeType: metrics.spendChange >= 0 ? "increase" : "decrease",
          };
        case "orders":
          return {
            value: metrics.totalOrders > 0 ? metrics.totalOrders : "--",
            change: 0,
            changeType: "increase" as const,
          };
        case "bottles":
          return {
            value: metrics.totalBottles > 0 ? metrics.totalBottles : "--",
            change: 0,
            changeType: "increase" as const,
          };
        case "avgOrder":
          return {
            value:
              metrics.avgOrderValue > 0
                ? formatMoney(metrics.avgOrderValue, "compact")
                : "--",
            change: 0,
            changeType: "increase" as const,
          };
        case "profitMargin":
          return {
            value: metrics.profitMargin > 0 ? `${metrics.profitMargin}%` : "--",
            change: 0,
            changeType: "increase" as const,
          };
        case "wineDistribution":
          return {
            value:
              wineTypeTotals.red + wineTypeTotals.white > 0
                ? `${wineTypeTotals.red + wineTypeTotals.white}`
                : "--",
            change: 0,
            changeType: "increase" as const,
          };
        case "topSellers":
          return {
            value: topWines.length > 0 ? `${topWines.length} wines` : "--",
            change: 0,
            changeType: "increase" as const,
          };
        case "inventoryValue":
          return {
            value:
              metrics.inventoryValue > 0
                ? formatMoney(metrics.inventoryValue, "compact")
                : "--",
            change: 0,
            changeType: "increase" as const,
          };
        case "purchaseCost":
          return {
            value:
              purchaseMetrics.totalSpent > 0
                ? formatMoney(purchaseMetrics.totalSpent, "compact")
                : "--",
            change: 0,
            changeType: "increase" as const,
          };
        default:
          return { value: "--", change: 0, changeType: "increase" as const };
      }
    },
    [metrics, wineTypeTotals, purchaseMetrics, topWines],
  );

  // ── Persistence via user preferences API ────────────────────────────

  useEffect(() => {
    updatePreferences({ reportsLayout: serializeLayout(layout) as any });
    // Persist only when the layout changes. updatePreferences is a per-render
    // action wrapper; adding it would re-persist on every render (mutation →
    // re-render loop) and is not the intended trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout]);

  useEffect(() => {
    updatePreferences({
      dashboardBlocks: serializeDashboardBlocks(dashboardBlocks) as any,
    });
    // Persist only when the dashboard blocks change (see note above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboardBlocks]);

  useEffect(() => {
    setLoading(true);
    const timer = setTimeout(() => setLoading(false), 500);
    return () => clearTimeout(timer);
  }, [timeRange]);

  // Fetch real POS sales revenue for the selected window. Goes through the
  // shared axios client, never `fetch`: /analytics/* is behind a class-level
  // JwtAuthGuard and a bare fetch sends no bearer token (see
  // src/__tests__/no-raw-gateway-fetch.test.ts).
  useEffect(() => {
    if (!restaurantId) {
      setPos(NO_POS_REVENUE);
      return;
    }
    let cancelled = false;
    const days = timeRange === "7d" ? 7 : timeRange === "30d" ? 30 : 90;
    getPosRevenue(restaurantId, days)
      .then((data) => {
        if (cancelled) return;
        setPos(data);
        setPosError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        // Do NOT fall back to a zero. A failed request and a restaurant with no
        // POS look identical to the reader otherwise, and only one of them is
        // something they can act on.
        setPos(NO_POS_REVENUE);
        setPosError(
          e instanceof Error ? e.message : "Could not load sales revenue",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [restaurantId, timeRange]);

  /**
   * POS revenue per day, keyed by the same short label `purchaseDayData` uses,
   * so the labour overlay can plot both series on one axis.
   */
  const posRevenueByDate = useMemo(() => {
    const byLabel: Record<string, number> = {};
    for (const point of pos.dailySeries) {
      const [y, m, d] = point.date.split("-").map(Number);
      if (!y || !m || !d) continue;
      byLabel[formatShortDate(new Date(y, m - 1, d))] = point.revenue;
    }
    return byLabel;
  }, [pos.dailySeries]);

  // ── Dashboard block handlers ────────────────────────────────────────

  const handleBlocksChange = useCallback((newBlocks: DashboardBlock[]) => {
    setDashboardBlocks(newBlocks);
  }, []);

  const handleAddBlock = useCallback((newBlock: DashboardBlock) => {
    setDashboardBlocks((prev) => [...prev, newBlock]);
  }, []);

  const handleApplyPreset = useCallback((preset: LayoutPreset) => {
    setDashboardBlocks(preset.blocks.map((b) => ({ ...b })));
  }, []);

  const handleResetBlocks = useCallback(() => {
    setDashboardBlocks(DEFAULT_BLOCKS.map((b) => ({ ...b })));
  }, []);

  // ── Export handler (shared formats via tableExport) ─────────────────

  const handleExport = useCallback(
    async (format: TableExportFormat) => {
      const reportId = `rpt-${Date.now()}`;
      const timestamp = new Date().toISOString();

      const columns: TableExportColumn<(typeof purchaseDayData)[number]>[] = [
        { header: "Date", value: (d) => d.date },
        { header: "Vendor Spend", value: (d) => d.spend },
        { header: "Orders", value: (d) => d.orders },
        { header: "Bottles", value: (d) => d.bottles },
        { header: "Avg Order", value: (d) => d.avgOrderValue },
        { header: "Red", value: (d) => d.red },
        { header: "White", value: (d) => d.white },
        { header: "Sparkling", value: (d) => d.sparkling },
        { header: "Rose", value: (d) => d.rose },
        { header: "Dessert", value: (d) => d.dessert },
      ];

      try {
        await exportTable({
          format,
          rows: purchaseDayData,
          columns,
          filename: `wineops-purchasing-report-${timeRange}-${new Date().toISOString().slice(0, 10)}`,
          title: `Mudavym Purchasing Report · ${timeRange}`,
        });
        setExportSuccess(format);
        setTimeout(() => setExportSuccess(null), 3000);
      } catch {
        setExportSuccess(null);
      }

      await dispatchReportEvent({
        type: "generated",
        reportId,
        reportType: "purchasing-summary",
        format:
          format === "excel" || format === "pdf" || format === "csv"
            ? format
            : "csv",
        timestamp,
      });
    },
    [purchaseDayData, timeRange, dispatchReportEvent],
  );

  // Section toggle handler
  const handleSectionToggle = useCallback((section: string) => {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section as keyof typeof prev],
    }));
  }, []);

  /** Renders one below-the-dashboard section (used both in static view and reorder mode). */
  function renderSectionContent(sectionId: string) {
    return (
      <>
        {sectionId === "aiInsights" && (
          <div className="space-y-4">
            <div id="engine-insights">
              <EngineInsightsPanel />
            </div>
            <SeatingDensityPanel />
          </div>
        )}

        {/* Real sales revenue from `pos_checks` (OD-85). Still null when no POS
            is connected, and the tile then says so rather than dividing
            procurement spend by itself and always printing ~100%. */}
        {sectionId === "dataTable" && (
          <DataTablesSection
            dailyData={purchaseDayData}
            purchaseData={purchaseData}
            purchaseMetrics={purchaseMetrics}
            posRevenue={pos.posConnected ? pos.revenue : null}
            checkScans={checkScans}
            expandedSections={expandedSections}
            onToggle={handleSectionToggle}
            onCheckUpload={(file) => console.log("Check uploaded:", file.name)}
          />
        )}

        {sectionId === "reconciliation" && (
          <MonthlyReconciliation
            totalBottlesSold={metrics.totalBottles}
            totalInventoryValue={metrics.inventoryValue}
          />
        )}

        {sectionId === "consumption" && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-purple-50 to-pink-50">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-purple-100 rounded-lg">
                  <Wine className="w-5 h-5 text-purple-600" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">
                    Wine Consumption Analytics
                  </h3>
                  <p className="text-sm text-gray-500">
                    Per-wine bottle and glass sales with volume tracking
                  </p>
                </div>
              </div>
            </div>
            <div className="p-6">
              {hasConsumptionData ? (
                <div className="space-y-8">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="p-4 bg-purple-50 rounded-lg border border-purple-100">
                      <p className="text-xs text-purple-600 font-medium uppercase tracking-wide">
                        Total Bottles Consumed
                      </p>
                      <p className="text-2xl font-bold text-gray-900 mt-1">
                        {consumptionTotals.totalBottlesSold} bottles
                      </p>
                      <p className="text-sm text-gray-500">
                        {formatVolume(
                          consumptionTotals.totalBottleVolumeMl,
                          measurementUnit,
                        )}
                      </p>
                    </div>
                    <div className="p-4 bg-pink-50 rounded-lg border border-pink-100">
                      <p className="text-xs text-pink-600 font-medium uppercase tracking-wide">
                        Total Glasses Consumed
                      </p>
                      <p className="text-2xl font-bold text-gray-900 mt-1">
                        {consumptionTotals.totalGlassesSold} glasses
                      </p>
                      <p className="text-sm text-gray-500">
                        = {consumptionTotals.totalGlassBottleEquiv.toFixed(1)}{" "}
                        bottle equivalent
                      </p>
                    </div>
                    <div className="p-4 bg-emerald-50 rounded-lg border border-emerald-100">
                      <p className="text-xs text-emerald-600 font-medium uppercase tracking-wide">
                        Combined Revenue
                      </p>
                      <p className="text-2xl font-bold text-gray-900 mt-1">
                        $
                        {(
                          consumptionTotals.totalBottleRevenue +
                          consumptionTotals.totalGlassRevenue
                        ).toLocaleString()}
                      </p>
                      <p className="text-sm text-gray-500">
                        bottles: $
                        {consumptionTotals.totalBottleRevenue.toLocaleString()}{" "}
                        + glasses: $
                        {consumptionTotals.totalGlassRevenue.toLocaleString()}
                      </p>
                      {consumptionTotals.revenueIncomplete && (
                        <p className="text-[11px] text-amber-600 mt-1 leading-tight">
                          Some sales reached us without a price — this is a
                          floor, not the full figure
                        </p>
                      )}
                    </div>
                  </div>
                  {bottleConsumptionRows.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
                        Bottles Consumed
                      </h4>
                      <div className="overflow-x-auto rounded-lg border border-gray-200">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-gray-200 bg-gray-50">
                              <th className="text-left py-2.5 px-3 font-medium text-gray-600">
                                Wine
                              </th>
                              <th className="text-left py-2.5 px-3 font-medium text-gray-600">
                                Format
                              </th>
                              <th className="text-right py-2.5 px-3 font-medium text-gray-600">
                                Bottles Sold
                              </th>
                              <th className="text-right py-2.5 px-3 font-medium text-gray-600">
                                Revenue
                              </th>
                              <th className="text-right py-2.5 px-3 font-medium text-gray-600">
                                Total Volume
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {bottleConsumptionRows.map((d) => (
                              <tr
                                key={d.wineName}
                                className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                              >
                                <td className="py-2.5 px-3 font-medium text-gray-900">
                                  {d.wineName}
                                </td>
                                <td className="py-2.5 px-3 text-gray-600">
                                  {d.avgBottleMl == null
                                    ? "—"
                                    : formatVolume(
                                        d.avgBottleMl,
                                        measurementUnit,
                                      )}
                                </td>
                                <td className="py-2.5 px-3 text-right text-gray-900">
                                  {d.bottlesSold}
                                </td>
                                {/* Summed real revenue. `—` means the POS sent no
                                    price for these lines, which is not $0. */}
                                <td className="py-2.5 px-3 text-right text-gray-900">
                                  {d.bottleRevenue == null
                                    ? "—"
                                    : `$${d.bottleRevenue.toLocaleString()}`}
                                </td>
                                <td className="py-2.5 px-3 text-right text-gray-600">
                                  {formatVolume(
                                    d.bottleVolumeMl,
                                    measurementUnit,
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr className="bg-gray-50 font-semibold border-t border-gray-200">
                              <td
                                className="py-2.5 px-3 text-gray-900"
                                colSpan={2}
                              >
                                Total
                              </td>
                              <td className="py-2.5 px-3 text-right text-gray-900">
                                {consumptionTotals.totalBottlesSold}
                              </td>
                              <td className="py-2.5 px-3 text-right text-gray-900">
                                $
                                {consumptionTotals.totalBottleRevenue.toLocaleString()}
                              </td>
                              <td className="py-2.5 px-3 text-right text-gray-900">
                                {formatVolume(
                                  consumptionTotals.totalBottleVolumeMl,
                                  measurementUnit,
                                )}
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </div>
                  )}
                  {glassConsumptionRows.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
                        Glasses Consumed
                      </h4>
                      <div className="overflow-x-auto rounded-lg border border-gray-200">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-gray-200 bg-gray-50">
                              <th className="text-left py-2.5 px-3 font-medium text-gray-600">
                                Wine
                              </th>
                              <th className="text-left py-2.5 px-3 font-medium text-gray-600">
                                Pour Size
                              </th>
                              <th className="text-right py-2.5 px-3 font-medium text-gray-600">
                                Glasses Sold
                              </th>
                              <th className="text-right py-2.5 px-3 font-medium text-gray-600">
                                Revenue
                              </th>
                              <th className="text-right py-2.5 px-3 font-medium text-gray-600">
                                Bottle Equiv.
                              </th>
                              <th className="text-right py-2.5 px-3 font-medium text-gray-600">
                                Cost/Glass
                              </th>
                              <th className="text-right py-2.5 px-3 font-medium text-gray-600">
                                Margin
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {glassConsumptionRows.map((d) => {
                              // Cost and margin are only computable when the
                              // inventory row records a purchase price AND the
                              // POS priced the pours. Missing either renders `—`:
                              // a $0 cost would otherwise print a 100% margin,
                              // which is the most flattering possible lie.
                              const gpb =
                                d.avgBottleMl && d.avgPourMl
                                  ? getGlassesPerBottle(
                                      d.avgBottleMl,
                                      d.avgPourMl,
                                    )
                                  : 0;
                              const cpg =
                                d.costPerBottle != null && gpb > 0
                                  ? costPerGlass(d.costPerBottle, gpb)
                                  : null;
                              const revenuePerGlass =
                                d.glassRevenue != null && d.glassesSold > 0
                                  ? d.glassRevenue / d.glassesSold
                                  : null;
                              const margin =
                                cpg != null && revenuePerGlass != null
                                  ? glassMarginPercent(cpg, revenuePerGlass)
                                  : null;
                              const bottleEquiv =
                                d.avgBottleMl && d.avgBottleMl > 0
                                  ? (d.glassVolumeMl / d.avgBottleMl).toFixed(1)
                                  : "—";
                              return (
                                <tr
                                  key={d.wineName}
                                  className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                                >
                                  <td className="py-2.5 px-3 font-medium text-gray-900">
                                    {d.wineName}
                                  </td>
                                  <td className="py-2.5 px-3 text-gray-600">
                                    {d.avgPourMl == null
                                      ? "—"
                                      : formatVolume(
                                          d.avgPourMl,
                                          measurementUnit,
                                        )}
                                  </td>
                                  <td className="py-2.5 px-3 text-right text-gray-900">
                                    {d.glassesSold}
                                  </td>
                                  <td className="py-2.5 px-3 text-right text-gray-900">
                                    {d.glassRevenue == null
                                      ? "—"
                                      : `$${d.glassRevenue.toLocaleString()}`}
                                  </td>
                                  <td className="py-2.5 px-3 text-right text-gray-600">
                                    {bottleEquiv}
                                  </td>
                                  <td className="py-2.5 px-3 text-right text-gray-600">
                                    {cpg == null ? "—" : `$${cpg.toFixed(2)}`}
                                  </td>
                                  <td className="py-2.5 px-3 text-right">
                                    {margin == null ? (
                                      <span
                                        className="text-gray-400"
                                        title="Needs a recorded purchase cost and a priced pour"
                                      >
                                        —
                                      </span>
                                    ) : (
                                      <span
                                        className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                                          margin >= 70
                                            ? "bg-emerald-100 text-emerald-700"
                                            : margin >= 50
                                              ? "bg-amber-100 text-amber-700"
                                              : "bg-red-100 text-red-700"
                                        }`}
                                      >
                                        {margin.toFixed(1)}%
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                          <tfoot>
                            <tr className="bg-gray-50 font-semibold border-t border-gray-200">
                              <td
                                className="py-2.5 px-3 text-gray-900"
                                colSpan={2}
                              >
                                Total
                              </td>
                              <td className="py-2.5 px-3 text-right text-gray-900">
                                {consumptionTotals.totalGlassesSold}
                              </td>
                              <td className="py-2.5 px-3 text-right text-gray-900">
                                $
                                {consumptionTotals.totalGlassRevenue.toLocaleString()}
                              </td>
                              <td className="py-2.5 px-3 text-right text-gray-900">
                                {consumptionTotals.totalGlassBottleEquiv.toFixed(
                                  1,
                                )}
                              </td>
                              <td className="py-2.5 px-3" colSpan={2}></td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              ) : posError ? (
                /* A failed request is NOT "no POS connected". Telling a
                   connected restaurant to go configure a POS it already has
                   would send it down the wrong path entirely. */
                <div className="flex flex-col items-center justify-center py-12 px-4">
                  <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mb-4">
                    <AlertTriangle className="w-8 h-8 text-amber-600" />
                  </div>
                  <h4 className="text-lg font-semibold text-gray-900 mb-2">
                    Couldn&apos;t load sales data
                  </h4>
                  <p className="text-sm text-gray-500 text-center max-w-md">
                    {posError}
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 px-4">
                  <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center mb-4">
                    <Wine className="w-8 h-8 text-purple-600" />
                  </div>
                  <h4 className="text-lg font-semibold text-gray-900 mb-2">
                    {pos.posConnected
                      ? "No wine sales recorded in this period"
                      : "Connect your POS system to see wine consumption analytics"}
                  </h4>
                  <p className="text-sm text-gray-500 text-center max-w-md mb-6">
                    {pos.posConnected
                      ? "Your POS is connected and reporting, but no wine sales landed in the selected date range. Try a longer range."
                      : "Once connected, you'll see detailed analytics including bottles sold, glasses sold, revenue breakdown, and margin analysis per wine."}
                  </p>
                  {!pos.posConnected && (
                    <Link
                      to="/settings?tab=pos"
                      className="inline-flex items-center gap-2 px-4 py-2.5 bg-purple-600 text-white font-medium rounded-lg hover:bg-purple-700 transition-colors"
                    >
                      <Settings className="w-4 h-4" />
                      Configure POS
                    </Link>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* No onGenerate handler: POST /reports/generate only inserts a
            `status: "pending"` row with NULL pdf/excel/csv urls and nothing in
            the codebase ever fills them in, so wiring the button would just
            manufacture records the archive cannot open. ReportGenerator states
            that plainly instead. */}
        {sectionId === "reportGenerator" && (
          <ReportGenerator
            purchaseDayData={purchaseDayData}
            metrics={metrics}
          />
        )}
      </>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-wine-200 border-t-wine-600 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-600">Loading reports...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header
        title="Reports & Analytics"
        subtitle="Track your wine operations performance"
      />

      <div className="p-6 space-y-6">
        {/* Purchasing-data indicator. This page charts vendor spend from
            purchase orders only — it never reads POS sales. It used to blame a
            missing POS connection unconditionally, which on the lens run was
            said over 44 ingested checks from a POS that was working (defect 9).
            `describeReportsGap` decides which of the three things is true. */}
        {dataGap && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold text-amber-900">
                {dataGap.title}
              </p>
              <p className="text-xs text-amber-700">{dataGap.body}</p>
            </div>
            {dataGap.action && (
              <a
                href={dataGap.action.href}
                className="ml-auto px-4 py-2 bg-amber-600 text-white text-xs font-medium rounded-lg hover:bg-amber-700 transition-colors whitespace-nowrap"
              >
                {dataGap.action.label}
              </a>
            )}
          </div>
        )}

        {/* Plain-language AI insights (above controls) */}
        {(metrics.totalSpend > 0 || metrics.totalOrders > 0) && (
          <HeadlineInsightsBar
            onSeeDetails={() => {
              const el = document.getElementById("engine-insights");
              const reduce = window.matchMedia(
                "(prefers-reduced-motion: reduce)",
              ).matches;
              el?.scrollIntoView({
                behavior: reduce ? "auto" : "smooth",
                block: "start",
              });
            }}
          />
        )}

        {/* Top Control Bar */}
        <div data-tour="reports-topbar">
          <TopBar
            timeRange={timeRange}
            onTimeRangeChange={setTimeRange}
            isEditMode={isEditMode}
            onEditToggle={() => setIsEditMode(!isEditMode)}
            onOpenArrange={() => setIsEditMode(true)}
            onExport={handleExport}
            exportSuccess={exportSuccess}
            exportCount={purchaseDayData.length}
            showComparison={showComparison}
            onToggleComparison={() => setShowComparison((v) => !v)}
          />
        </div>

        {/* Edit Toolbar (replaces old EditLayoutPanel) */}
        <div data-tour="reports-edit-layout">
          <EditToolbar
            isEditMode={isEditMode}
            onToggleEditMode={() => setIsEditMode(!isEditMode)}
            onAddBlock={handleAddBlock}
            onApplyPreset={handleApplyPreset}
            onReset={handleResetBlocks}
          />
        </div>

        {/* Dashboard Canvas — react-grid-layout drag/resize for all chart blocks */}
        <div data-tour="reports-canvas">
          <DashboardCanvas
            blocks={dashboardBlocks}
            isEditMode={isEditMode}
            onBlocksChange={handleBlocksChange}
            purchaseDayData={purchaseDayData}
            wineTypeDistribution={wineTypeDistribution}
            topWines={topWines}
            timeRange={timeRange}
            getKPIValue={getKPIValue}
            onKPIClick={(kpiKey) =>
              setSpotlightedKPI((prev) => (prev === kpiKey ? null : kpiKey))
            }
            spotlightedKPI={spotlightedKPI}
            totalOrders={metrics.totalOrders}
            totalSpend={metrics.totalSpend}
            posRevenue={pos.posConnected ? pos.revenue : null}
            posConnected={pos.posConnected}
            posRevenueByDate={posRevenueByDate}
          />
        </div>

        {/* Period Comparison Bar (optional, below canvas) */}
        {showComparison && purchaseDayData.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
              Period Comparison — Vendor Spend
            </p>
            <PeriodCompareBar
              currentData={purchaseDayData.map((d) => ({
                date: d.date,
                value: d.spend,
              }))}
              metric="spend"
            />
          </div>
        )}

        {/* KPI Spotlight Detail Panel */}
        <KPISpotlightView
          kpiKey={spotlightedKPI || "revenue"}
          title={
            spotlightedKPI
              ? {
                  revenue: "Vendor Spend",
                  orders: "Purchase Orders",
                  bottles: "Bottles Purchased",
                  avgOrder: "Average Order Value",
                  inventoryValue: "Inventory Value",
                  profitMargin: "Profit Margin",
                  purchaseCost: "Purchase Cost",
                }[spotlightedKPI] || "KPI Detail"
              : ""
          }
          currentValue={spotlightedKPI ? getKPIValue(spotlightedKPI).value : 0}
          isOpen={!!spotlightedKPI}
          onClose={() => setSpotlightedKPI(null)}
          purchaseDayData={purchaseDayData.map((d) => ({
            date: d.date,
            spend: d.spend,
            orders: d.orders ?? 0,
            bottles: d.bottles,
            avgOrderValue: (d as any).avgOrderValue ?? 0,
            red: d.red ?? 0,
            white: d.white ?? 0,
            sparkling: d.sparkling ?? 0,
            rose: d.rose ?? 0,
            dessert: d.dessert ?? 0,
          }))}
          wineTypeTotals={wineTypeTotals}
          topWines={topWines}
          metrics={metrics}
        />

        {/* Below-dashboard sections — full-card drag reorder in Edit layout */}
        {isEditMode ? (
          <Reorder.Group
            axis="y"
            values={sectionOrder}
            onReorder={setSectionOrder}
            className="space-y-6"
            as="div"
          >
            {sectionOrder.map((sectionId) => (
              <Reorder.Item
                key={sectionId}
                value={sectionId}
                as="div"
                style={{ cursor: "grab", listStyle: "none" }}
                whileDrag={{
                  cursor: "grabbing",
                  scale: 1.008,
                  boxShadow: "0 16px 40px rgba(0,0,0,0.12)",
                  zIndex: 40,
                  position: "relative",
                }}
                className="rounded-xl outline outline-1 outline-transparent transition-[outline-color] hover:outline-blue-100"
              >
                <div
                  onPointerDown={(e) => {
                    if (isInteractiveReorderSurfaceTarget(e.target))
                      e.stopPropagation();
                  }}
                >
                  {renderSectionContent(sectionId)}
                </div>
              </Reorder.Item>
            ))}
          </Reorder.Group>
        ) : (
          <div className="space-y-6">
            {sectionOrder.map((sectionId) => (
              <div key={sectionId}>{renderSectionContent(sectionId)}</div>
            ))}
          </div>
        )}
      </div>

      {/* AI Command Palette (global overlay) */}
      {/* Searches the engine's real insight feed; it takes no time-range prop
          because /analytics/insights computes its own windows. */}
      <AICommandPalette
        isOpen={showAIPalette}
        onClose={() => setShowAIPalette(false)}
      />

      {/* Floating ⌘K pill — always visible */}
      {!showAIPalette && (
        <div data-tour="reports-ai-pill">
          <AICommandPill onClick={() => setShowAIPalette(true)} />
        </div>
      )}
    </div>
  );
}

export default Reports;
