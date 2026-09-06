import { useState, useMemo, useCallback } from "react";
import { Wine } from "../../data/wineData";
import { useInventoryData } from "../../hooks/useInventoryData";
import { useWinesByIds } from "../../hooks/queries";
import { mapApiWinesToUiWines } from "../../lib/wine-library";
import { classifyStock } from "../../lib/inventoryStatus";

export interface InventoryItem extends Wine {
  inventoryId?: string;
  storageLocation?: string;
  location?: string;
  liveStock: number | null;
  shadowStock?: number;
  threshold: number;
  lastCounted: string | null;
  isActive: boolean;
  marketPrice?: number;
  wac?: number;
  costProvenance?: "invoice" | "estimated";
  lotLocationCount?: number;
  openMl?: number;
  velocityPerDay?: number;
  daysOfCover?: number;
  reorderSuggested?: boolean;
  abcClass?: "A" | "B" | "C";
  deadStock?: boolean;
  daysSinceSale?: number;
  locations?: { locationId: string | null; qty: number; wac: number | null }[];
  lastManualAdjustment?: {
    timestamp: Date;
    managerName: string;
  };
}

export type ViewMode = "all" | "live" | "shadow";
export type SortField =
  | "name"
  | "liveStock"
  | "shadowStock"
  | "price"
  | "menuPrice"
  | "margin"
  | "threshold"
  | "bottleSizeMl"
  | "type"
  | "location";
export type SortOrder = "asc" | "desc";

function calculateMargin(costPrice: number, menuPrice?: number): number {
  if (!menuPrice || menuPrice === 0) return 0;
  return ((menuPrice - costPrice) / menuPrice) * 100;
}

function getDefaultMenuPrice(costPrice: number): number {
  return Math.round(costPrice * 3);
}

export interface UseInventoryPageOptions {
  /** Hide these `restaurant_inventory.id` rows until the server list no longer contains them */
  excludeInventoryRowIds?: string[];
}

export function useInventoryPage(options: UseInventoryPageOptions = {}) {
  // Filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterActiveStatus, setFilterActiveStatus] = useState<
    "all" | "active" | "inactive"
  >("all");
  const [filterBottleSize, setFilterBottleSize] = useState<number | "all">(
    "all",
  );
  const [viewMode, setViewMode] = useState<ViewMode>("all");
  const [selectedLocationFilter, setSelectedLocationFilter] = useState<
    string | null
  >(null);

  // Sort state
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortOrder, setSortOrder] = useState<SortOrder>("asc");

  // Selection state
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());

  // Data from hooks
  const {
    inventory: apiInventory,
    summary: inventorySummary,
    lowStockItems: apiLowStock,
    isLoading: inventoryLoading,
    error: inventoryError,
    refetch: refetchInventory,
    updateItem: updateInventoryItem,
  } = useInventoryData();

  const excludeRowIdSet = useMemo(
    () => new Set((options.excludeInventoryRowIds ?? []).filter(Boolean)),
    [options.excludeInventoryRowIds],
  );

  const visibleApiInventory = useMemo(
    () => apiInventory.filter((row) => !excludeRowIdSet.has(row.id)),
    [apiInventory, excludeRowIdSet],
  );

  /** Row IDs present in the last successful API payload (before client-side exclusions) */
  const serverInventoryRowIds = useMemo(
    () => apiInventory.map((row) => row.id),
    [apiInventory],
  );

  const wineIds = useMemo(
    () =>
      Array.from(
        new Set(visibleApiInventory.map((item) => item.wineId).filter(Boolean)),
      ),
    [visibleApiInventory],
  );
  const { data: apiWines = [] } = useWinesByIds(wineIds);
  const winesById = useMemo(() => {
    const map = new Map<string, Wine>();
    mapApiWinesToUiWines(apiWines).forEach((wine) => {
      map.set(wine.id, wine);
    });
    return map;
  }, [apiWines]);

  // Convert API data to local format
  const inventory = useMemo(() => {
    if (inventoryLoading || visibleApiInventory.length === 0) {
      return [];
    }

    return visibleApiInventory.map((item) => {
      const wine = winesById.get(item.wineId);
      const fallback: Wine = wine || {
        id: item.wineId,
        sku: undefined,
        name: item.wineName || "Unknown Wine",
        producer: item.wineProducer || "Unknown Producer",
        vintage: null,
        price: 0,
        // Was `'red'`. This fallback fires whenever the library wine has not
        // loaded for an inventory row, and it asserted a colour for the bottle
        // — 26 of 27 rows on a cocktail bar said Red, a Moët and two rosés
        // among them (Antalya night). An inventory row we could not resolve has
        // an UNKNOWN type; that is the fact, and it renders in grey.
        type: "unknown",
        grape: "",
        country: "",
        region: "",
        appellation: "",
        body: "",
        sweetness: "",
        acidity: "",
        alcohol: 0,
        aromas: [],
        flavors: [],
        liveStock: null,
        threshold: 10,
        bottleSizeMl: 750,
        provider: {
          name: "",
          contact: "",
          phone: "",
          email: undefined,
          address: undefined,
        },
        image: undefined,
        isActive: true,
      };

      return {
        ...fallback,
        inventoryId: item.id,
        id: item.wineId,
        storageLocation: (item as any).storageLocation,
        location: (item as any).location,
        liveStock: item.stockLive || 0,
        shadowStock: item.shadowStock || 0,
        threshold: item.thresholdMin || fallback.threshold || 10,
        // Decision E41: measures an actual spot count, not "any field edit"
        // — stays null until a genuine count exists rather than borrowing
        // updatedAt, which changes on price/threshold/sale_type edits too.
        lastCounted: item.lastCountedAt || null,
        isActive: item.isActive ?? true,
        bottleSizeMl: item.bottleSizeMl ?? fallback.bottleSizeMl,
        saleType: item.saleType ?? fallback.saleType,
        pourSizeMl: item.pourSizeMl ?? fallback.pourSizeMl,
        menuPriceGlass: item.menuPriceGlass ?? fallback.menuPriceGlass,
        marketPrice: (item as any).retailPriceAvg ?? undefined,
        wac: (item as any).wac ?? undefined,
        costProvenance: (item as any).costProvenance ?? undefined,
        lotLocationCount: (item as any).lotLocationCount ?? undefined,
        openMl: (item as any).openMl ?? 0,
        velocityPerDay: (item as any).velocityPerDay ?? undefined,
        daysOfCover: (item as any).daysOfCover ?? undefined,
        reorderSuggested: (item as any).reorderSuggested ?? false,
        abcClass: (item as any).abcClass ?? undefined,
        deadStock: (item as any).deadStock ?? false,
        daysSinceSale: (item as any).daysSinceSale ?? undefined,
        locations: (item as any).locations ?? [],
        // The library's own name, carried for SEARCH only and never rendered
        // in place of the house's alias (ADR 0124, the naming rule). Read
        // through `as any` like every other field on this object that the
        // shared `InventoryItem` type does not declare -- this file's own
        // idiom, so the shared type is not widened for one page's filter.
        libraryName: (item as any).libraryName ?? null,
      } as InventoryItem;
    });
  }, [visibleApiInventory, inventoryLoading, winesById]);

  // Computed values
  const filteredInventory = useMemo(() => {
    let items = [...inventory];

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      items = items.filter(
        (item) =>
          item.name.toLowerCase().includes(query) ||
          // BOTH NAMES ARE SEARCHABLE (ADR 0124, the naming rule, founder
          // 2026-09-05). `item.name` is the house's alias when it has set one,
          // so matching only on it makes the library's own name unfindable —
          // a house that renames "1988 Wine X" to "Wine X" could no longer
          // search "1988". The library name is never DISPLAYED here; it is
          // only matched.
          ((item as any).libraryName ?? "").toLowerCase().includes(query) ||
          item.producer.toLowerCase().includes(query) ||
          item.grape.toLowerCase().includes(query),
      );
    }

    // Type filter
    if (filterType !== "all") {
      items = items.filter((item) => item.type === filterType);
    }

    // Status filter (shared classifier — cards, badges, and filters agree)
    if (filterStatus !== "all") {
      items = items.filter(
        (item) =>
          classifyStock(item.liveStock, item.threshold).key === filterStatus,
      );
    }

    // Active status filter
    if (filterActiveStatus === "active") {
      items = items.filter((item) => item.isActive);
    } else if (filterActiveStatus === "inactive") {
      items = items.filter((item) => !item.isActive);
    }

    // Bottle size filter
    if (filterBottleSize !== "all") {
      items = items.filter(
        (item) => (item.bottleSizeMl || 750) === filterBottleSize,
      );
    }

    // View mode filter
    if (viewMode === "live") {
      items = items.filter((item) => (item.liveStock || 0) > 0);
    } else if (viewMode === "shadow") {
      items = items.filter((item) => (item.shadowStock || 0) > 0);
    }

    // Sort
    items.sort((a, b) => {
      let aVal: any, bVal: any;
      switch (sortField) {
        case "name":
          aVal = a.name.toLowerCase();
          bVal = b.name.toLowerCase();
          break;
        case "liveStock":
          aVal = a.liveStock || 0;
          bVal = b.liveStock || 0;
          break;
        case "shadowStock":
          aVal = a.shadowStock || 0;
          bVal = b.shadowStock || 0;
          break;
        case "price":
          aVal = a.price;
          bVal = b.price;
          break;
        case "menuPrice":
          aVal = a.menuPrice || getDefaultMenuPrice(a.price);
          bVal = b.menuPrice || getDefaultMenuPrice(b.price);
          break;
        case "margin":
          aVal = calculateMargin(
            a.price,
            a.menuPrice || getDefaultMenuPrice(a.price),
          );
          bVal = calculateMargin(
            b.price,
            b.menuPrice || getDefaultMenuPrice(b.price),
          );
          break;
        case "threshold":
          aVal = a.threshold;
          bVal = b.threshold;
          break;
        case "bottleSizeMl":
          aVal = a.bottleSizeMl || 750;
          bVal = b.bottleSizeMl || 750;
          break;
        case "type":
          aVal = (a.type || "").toLowerCase();
          bVal = (b.type || "").toLowerCase();
          break;
        case "location":
          // Location name is resolved on the page (getWineLocation); the page re-sorts.
          aVal = 0;
          bVal = 0;
          break;
        default:
          aVal = a.name;
          bVal = b.name;
      }

      if (aVal < bVal) return sortOrder === "asc" ? -1 : 1;
      if (aVal > bVal) return sortOrder === "asc" ? 1 : -1;
      return 0;
    });

    return items;
  }, [
    inventory,
    searchQuery,
    filterType,
    filterStatus,
    viewMode,
    sortField,
    sortOrder,
    filterActiveStatus,
    filterBottleSize,
  ]);

  const stats = useMemo(() => {
    const total = inventory.length;
    const liveTotal = inventory.reduce(
      (sum, item) => sum + (item.liveStock || 0),
      0,
    );
    const shadowTotal = inventory.reduce(
      (sum, item) => sum + (item.shadowStock || 0),
      0,
    );
    // One pass, one classification per item — the counts cannot disagree with
    // each other, and `atPar` is counted rather than folded into `healthy` so
    // the five bands still sum to `total`. A wine exactly at par is NOT below
    // par (see lib/inventoryStatus.ts and the shared fixture): the alert path
    // will not act on it, so the chip must not claim it needs acting on.
    const bands = { critical: 0, low: 0, atPar: 0, healthy: 0, unknown: 0 };
    for (const item of inventory) {
      const key = classifyStock(item.liveStock, item.threshold).key;
      if (key === "critical") bands.critical += 1;
      else if (key === "low") bands.low += 1;
      else if (key === "at_par") bands.atPar += 1;
      else if (key === "healthy") bands.healthy += 1;
      else bands.unknown += 1;
    }
    const { critical, low, atPar, healthy, unknown } = bands;
    const needsReconciliation = inventory.filter(
      (item) => (item.shadowStock || 0) > 0,
    ).length;

    return {
      total,
      liveTotal,
      shadowTotal,
      critical,
      low,
      atPar,
      healthy,
      unknown,
      needsReconciliation,
    };
  }, [inventory]);

  const uniqueBottleSizes = useMemo(() => {
    const sizes = new Set(inventory.map((item) => item.bottleSizeMl || 750));
    return Array.from(sizes).sort((a, b) => a - b);
  }, [inventory]);

  // Actions
  const toggleSort = useCallback(
    (field: SortField) => {
      if (sortField === field) {
        setSortOrder(sortOrder === "asc" ? "desc" : "asc");
      } else {
        setSortField(field);
        setSortOrder("asc");
      }
    },
    [sortField, sortOrder],
  );

  const toggleSelection = useCallback((id: string) => {
    setSelectedItems((prev) => {
      const newSelected = new Set(prev);
      if (newSelected.has(id)) {
        newSelected.delete(id);
      } else {
        newSelected.add(id);
      }
      return newSelected;
    });
  }, []);

  const clearFilters = useCallback(() => {
    setFilterType("all");
    setFilterStatus("all");
    setFilterActiveStatus("all");
    setFilterBottleSize("all");
    setSearchQuery("");
    setSelectedLocationFilter(null);
  }, []);

  return {
    // Filter state
    searchQuery,
    setSearchQuery,
    filterType,
    setFilterType,
    filterStatus,
    setFilterStatus,
    filterActiveStatus,
    setFilterActiveStatus,
    filterBottleSize,
    setFilterBottleSize,
    viewMode,
    setViewMode,
    selectedLocationFilter,
    setSelectedLocationFilter,
    clearFilters,

    // Sort state
    sortField,
    sortOrder,
    toggleSort,

    // Selection state
    selectedItems,
    toggleSelection,
    setSelectedItems,

    // Data
    inventory,
    serverInventoryRowIds,
    inventorySummary,
    lowStockItems: apiLowStock,
    isLoading: inventoryLoading,
    error: inventoryError,
    refetchInventory,
    updateInventoryItem,

    // Computed values
    filteredInventory,
    stats,
    uniqueBottleSizes,
  };
}
