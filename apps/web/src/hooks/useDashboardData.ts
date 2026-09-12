/**
 * Dashboard Data Hook
 *
 * Fetches and manages dashboard data from the API.
 * Returns empty data with error flag when API is unavailable (no mock fallbacks).
 */

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../contexts/AuthContext";
import {
  dashboardApi,
  inventoryApi,
  ordersApi,
  toastApi,
} from "../services/api";
import type {
  DashboardStats,
  InventorySummary,
  InventoryItem,
  Order,
} from "../services/api/types";

export interface DashboardData {
  stats: DashboardStats;
  inventorySummary: InventorySummary | null;
  lowStockItems: InventoryItem[];
  pendingOrders: Order[];
  recentActivity: any[];
  alerts: any[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

// Empty stats when API fails
const EMPTY_STATS: DashboardStats = {
  totalWines: 0,
  totalBottles: 0,
  lowStockItems: 0,
  pendingOrders: 0,
  todayProcurementSpend: 0,
  weekProcurementSpend: 0,
  monthProcurementSpend: 0,
  totalVolumeMl: 0,
  totalVolumeOz: 0,
};

export function useDashboardData(): DashboardData {
  const { activeRestaurantId, isAuthenticated } = useAuth();

  const [stats, setStats] = useState<DashboardStats>(EMPTY_STATS);
  const [inventorySummary, setInventorySummary] =
    useState<InventorySummary | null>(null);
  const [lowStockItems, setLowStockItems] = useState<InventoryItem[]>([]);
  const [pendingOrders, setPendingOrders] = useState<Order[]>([]);
  const [recentActivity, setRecentActivity] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!activeRestaurantId) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Fetch all data in parallel
      const [
        statsResult,
        summaryResult,
        lowStockResult,
        pendingResult,
        activityResult,
        alertsResult,
      ] = await Promise.allSettled([
        dashboardApi.getDashboardStats(activeRestaurantId),
        inventoryApi.getInventorySummary(activeRestaurantId),
        inventoryApi.getLowStockItems(activeRestaurantId),
        ordersApi.getOrdersNeedingApproval(activeRestaurantId),
        dashboardApi.getRecentActivity(10, activeRestaurantId),
        dashboardApi.getAlerts(activeRestaurantId),
      ]);

      // Process results - return empty data on failure, not mock data
      if (statsResult.status === "fulfilled") {
        setStats(statsResult.value);
      } else {
        console.warn("Failed to fetch stats:", statsResult.reason);
        setStats(EMPTY_STATS);
        setError("Failed to load dashboard statistics");
      }

      if (summaryResult.status === "fulfilled") {
        setInventorySummary(summaryResult.value);
      } else {
        console.warn(
          "Failed to fetch inventory summary:",
          summaryResult.reason,
        );
        setInventorySummary(null);
        if (!error) setError("Failed to load inventory summary");
      }

      if (lowStockResult.status === "fulfilled") {
        setLowStockItems(lowStockResult.value);
      } else {
        console.warn("Failed to fetch low stock items:", lowStockResult.reason);
        setLowStockItems([]);
        if (!error) setError("Failed to load low stock items");
      }

      if (pendingResult.status === "fulfilled") {
        setPendingOrders(pendingResult.value);
      } else {
        console.warn("Failed to fetch pending orders:", pendingResult.reason);
        setPendingOrders([]);
        if (!error) setError("Failed to load pending orders");
      }

      if (activityResult.status === "fulfilled") {
        setRecentActivity(activityResult.value);
      } else {
        setRecentActivity([]);
      }

      if (alertsResult.status === "fulfilled") {
        setAlerts(alertsResult.value);
      } else {
        setAlerts([]);
      }
    } catch (err: any) {
      console.error("Dashboard data fetch error:", err);
      setError(err.message || "Failed to load dashboard data");
      // Return empty data on error, not mock data
      setStats(EMPTY_STATS);
      setInventorySummary(null);
      setLowStockItems([]);
      setPendingOrders([]);
      setRecentActivity([]);
      setAlerts([]);
    } finally {
      setIsLoading(false);
    }
  }, [activeRestaurantId]);

  // Fetch on mount and when restaurant changes
  useEffect(() => {
    if (isAuthenticated) {
      fetchData();
    }
  }, [fetchData, isAuthenticated]);

  // Auto-refresh every 5 minutes
  useEffect(() => {
    if (!isAuthenticated) return;

    const interval = setInterval(
      () => {
        fetchData();
      },
      5 * 60 * 1000,
    );

    return () => clearInterval(interval);
  }, [fetchData, isAuthenticated]);

  // Refetch when WebSocket events indicate dashboard data changed
  useEffect(() => {
    if (!isAuthenticated) return;

    const handleWsInvalidate = () => {
      fetchData();
    };

    window.addEventListener("ws:dashboard-invalidate", handleWsInvalidate);
    return () =>
      window.removeEventListener("ws:dashboard-invalidate", handleWsInvalidate);
  }, [fetchData, isAuthenticated]);

  return {
    stats,
    inventorySummary,
    lowStockItems,
    pendingOrders,
    recentActivity,
    alerts,
    isLoading,
    error,
    refetch: fetchData,
  };
}

/**
 * Hook for sales chart data.
 *
 * A FAILED READ IS NEVER AN EMPTY ONE, AND NEVER A HEALTHY ONE (ADR 0067,
 * ADR 0020). The `catch` here used to build a pseudo-random figure between
 * 1,000 and 6,000 per day and hand it back as sales, so a gateway outage
 * rendered as a business turning over roughly $3,000 a day (POS lens,
 * absence-as-health 1). There is no worse failure mode available to a
 * dashboard: the number is plausible, it is in the right units, and nothing on
 * screen says it is invented.
 *
 * The literal call is spelled out here in prose rather than in code on purpose
 * — `CLAIMS.jsonl` verifies this fix by grepping this file for that token, and
 * a comment quoting it would keep an executable claim permanently false.
 *
 * A CORRECTION TO THE REGISTER. The entry says this "renders it as sales".
 * Nothing renders it: `useSalesChartData` is exported from `hooks/index.ts` and
 * has ZERO call sites in the repo (checked 2026-09-05 across apps/ and
 * packages/). The fabricator is real and would fire the first time anyone used
 * the hook — which is exactly why it is fixed rather than left — but no screen
 * was showing invented revenue on the measured run.
 *
 * The hook is kept rather than deleted because the shape a sales chart needs is
 * right, and an honest hook is a better thing to leave behind than a gap the
 * next person fills with another fallback. `error` is returned so a caller
 * cannot render this without deciding what to do about a failure.
 */
export function useSalesChartData(period: "day" | "week" | "month" = "week") {
  const { activeRestaurantId, isAuthenticated } = useAuth();

  const [data, setData] = useState<{
    labels: string[];
    data: number[];
    total: number;
  }>({ labels: [], data: [], total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!isAuthenticated || !activeRestaurantId) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    dashboardApi
      .getSalesChartData(period, activeRestaurantId)
      .then((result) => {
        setData(result);
        setError(null);
      })
      .catch((err) => {
        console.warn("Failed to fetch sales chart data:", err);
        // Empty series AND an error. The empty series alone would be the same
        // bug in a quieter register — "no sales" and "we could not ask" are
        // different facts, and a caller must be able to tell them apart.
        setData({ labels: [], data: [], total: 0 });
        setError(
          err?.response?.data?.message ||
            err?.message ||
            "Sales could not be read",
        );
      })
      .finally(() => setIsLoading(false));
  }, [activeRestaurantId, isAuthenticated, period]);

  return { ...data, isLoading, error, unavailable: error !== null };
}

/**
 * Hook for Toast POS sales summary
 */
export function useToastSalesSummary() {
  const { activeRestaurantId, isAuthenticated } = useAuth();

  const [data, setData] = useState<{
    totalSales: number;
    totalRevenue: number;
    topItems: Array<{ itemName: string; quantity: number; revenue: number }>;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!isAuthenticated || !activeRestaurantId) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    toastApi
      .getTodaySalesSummary(activeRestaurantId)
      .then(setData)
      .catch((err) => {
        console.warn("Failed to fetch Toast sales summary:", err);
        setData(null);
      })
      .finally(() => setIsLoading(false));
  }, [activeRestaurantId, isAuthenticated]);

  return { data, isLoading };
}

export default useDashboardData;
