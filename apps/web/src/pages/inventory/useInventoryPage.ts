import { useState, useMemo, useCallback } from "react";
import { Wine } from "../../data/wineData";
import { useInventoryData } from "../../hooks/useInventoryData";
import { useWinesByIds } from "../../hooks/queries";
import {
  inventoryKindOf,
  mapApiWinesToUiWines,
  wineTypeForKind,
} from "../../lib/wine-library";
import { classifyStock } from "../../lib/inventoryStatus";
import { foldText } from "../../lib/textFold";
import {
  getInventoryAcrossHouses,
  normalizeInventoryItem,
} from "../../services/api/inventory";
import { getWinesByIds } from "../../services/api/wines";
import { WITHHELD } from "../../lib/tableExport";
import type { InventoryItem as ApiInventoryItem } from "../../services/api/types";

export interface InventoryItem extends Omit<Wine, "threshold"> {
  inventoryId?: string;
  storageLocation?: string;
  location?: string;
  liveStock: number | null;
  shadowStock?: number;
  /** The house's par. null = no par set (F-391): never a stand-in number. */
  threshold: number | null;
  lastCounted: string | null;
  isActive: boolean;
  marketPrice?: number;
  /** This house's own bottle price (ADR 0193). Undefined = not set. */
  menuPriceBottle?: number;
  wac?: number;
  /**
   * F-1652: the bottles `wac` averages. Fewer than `liveStock` means the rest
   * carry no cost. Undefined = not sent: read as covering every bottle.
   */
  wacQty?: number;
  costProvenance?: "invoice" | "estimated";
  lotLocationCount?: number;
  openMl?: number;
  /** Bottles a day. undefined = not known (no row, or the read failed). */
  velocityPerDay?: number;
  /** The days velocityPerDay is averaged over (F-687): 30, or fewer for a new wine. */
  velocityDays?: number;
  /** On the list fewer than 7 days: the rate is too young to plan on. */
  velocityIsNew?: boolean;
  /**
   * F-1516: velocityDays are fewer because the house's sales records began
   * after the wine was listed; the rate is taken from the till's first sale.
   */
  velocityFromTill?: boolean;
  /** false = the sales figures could not be read for this list (F-689). */
  analyticsReadable?: boolean;
  daysOfCover?: number;
  reorderSuggested?: boolean;
  abcClass?: "A" | "B" | "C";
  deadStock?: boolean;
  daysSinceSale?: number;
  locations?: { locationId: string | null; qty: number; wac: number | null }[];
  /**
   * Each shelf's newest count in the list's window (F-1235). null = not known
   * (the read failed or was too large); the whole-wine date is used instead.
   */
  shelfCounts?: { locationId: string; countedAt: string }[] | null;
  /** The open 86 (F-1434); null when it is not sold out. */
  soldOut?: { cause: string; startedAt: string } | null;
  /** false: whether it is sold out could not be read for this list. */
  soldOutReadable?: boolean;
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
  /**
   * Where the filters start, read from the page's URL so a reload or Back
   * lands on the same list the person left (F-370).
   */
  initialFilters?: {
    searchQuery?: string;
    filterType?: string;
    location?: string | null;
  };
  /**
   * The house's zones, so a location chip keeps the wines on that zone and on
   * the zones inside it (F-1161). Omitted, a chip matches its own zone only.
   */
  zones?: { id: string; parentId?: string }[];
}

/**
 * The zone and every zone inside it, however deep (F-1161). A zone that is
 * not in `zones` is still its own set, so a `?loc=` read before the zones
 * load filters by that zone alone.
 */
export function zoneAndChildren(
  zoneId: string,
  zones: { id: string; parentId?: string }[] = [],
): Set<string> {
  const ids = new Set([zoneId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const z of zones)
      if (z.parentId && ids.has(z.parentId) && !ids.has(z.id)) {
        ids.add(z.id);
        grew = true;
      }
  }
  return ids;
}

/** Whether any bottle of the wine is on one of `zoneIds` (F-1161). */
export function holdsStockIn(item: InventoryItem, zoneIds: Set<string>): boolean {
  return (item.locations ?? []).some(
    (l) => l.qty > 0 && l.locationId != null && zoneIds.has(l.locationId),
  );
}

/**
 * One gateway inventory row (already through `normalizeInventoryItem`) as the
 * page shows it: the library wine when it loaded, else the row's own name.
 * Exported so a read outside this hook -- the all-locations export -- builds
 * the same row the screen does instead of casting the raw one.
 */
export function toInventoryItem(item: ApiInventoryItem, wine?: Wine): InventoryItem {
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

  // F-739: the house item's own kind travels, so a declared keg with no
  // library row is a beer and not "Unknown", and a beer never wears a
  // wine colour.
  const kind = inventoryKindOf(item, wine?.kind);

  return {
    ...fallback,
    kind,
    type: wineTypeForKind(kind, fallback.type),
    inventoryId: item.id,
    id: item.wineId,
    storageLocation: (item as any).storageLocation,
    location: (item as any).location,
    liveStock: item.stockLive || 0,
    shadowStock: item.shadowStock || 0,
    // F-391: a missing or zero par is "no par set", never 10. An invented
    // par drove Below par, the draft quantity and "Overstocked vs. par";
    // the gateway's stock rule already calls a missing par unknown.
    threshold:
      typeof item.thresholdMin === "number" && item.thresholdMin > 0
        ? item.thresholdMin
        : null,
    // Decision E41: measures an actual spot count, not "any field edit"
    // — stays null until a genuine count exists rather than borrowing
    // updatedAt, which changes on price/threshold/sale_type edits too.
    lastCounted: item.lastCountedAt || null,
    isActive: item.isActive ?? true,
    bottleSizeMl: item.bottleSizeMl ?? fallback.bottleSizeMl,
    saleType: item.saleType ?? fallback.saleType,
    pourSizeMl: item.pourSizeMl ?? fallback.pourSizeMl,
    menuPriceGlass: item.menuPriceGlass ?? fallback.menuPriceGlass,
    // The house's own bottle price (ADR 0193: menu_price_current on the
    // row, `menuPriceBottle` on the wire). Never the library's figure.
    menuPriceBottle: item.menuPriceBottle ?? undefined,
    marketPrice: (item as any).retailPriceAvg ?? undefined,
    wac: (item as any).wac ?? undefined,
    wacQty: (item as any).wacQty ?? undefined,
    costProvenance: (item as any).costProvenance ?? undefined,
    lotLocationCount: (item as any).lotLocationCount ?? undefined,
    openMl: (item as any).openMl ?? 0,
    // F-689: when the sales figures could not be read, the rate and the
    // cover are unknown, never 0 — carried as undefined so every reader
    // prints a dash instead of "0.0 btl/day".
    analyticsReadable: (item as any).analyticsReadable !== false,
    velocityPerDay:
      (item as any).analyticsReadable === false
        ? undefined
        : ((item as any).velocityPerDay ?? undefined),
    velocityDays: (item as any).velocityDays ?? undefined,
    velocityIsNew: (item as any).velocityIsNew ?? undefined,
    velocityFromTill: (item as any).velocityFromTill ?? undefined,
    daysOfCover:
      (item as any).analyticsReadable === false
        ? undefined
        : ((item as any).daysOfCover ?? undefined),
    reorderSuggested: (item as any).reorderSuggested ?? false,
    abcClass: (item as any).abcClass ?? undefined,
    deadStock: (item as any).deadStock ?? false,
    daysSinceSale: (item as any).daysSinceSale ?? undefined,
    locations: (item as any).locations ?? [],
    shelfCounts: (item as any).shelfCounts ?? null,
    soldOut: (item as any).soldOut ?? null,
    soldOutReadable: (item as any).soldOutReadable !== false,
    // The library's own name, carried for SEARCH only and never rendered
    // in place of the house's alias (ADR 0124, the naming rule). Read
    // through `as any` like every other field on this object that the
    // shared `InventoryItem` type does not declare -- this file's own
    // idiom, so the shared type is not widened for one page's filter.
    libraryName: (item as any).libraryName ?? null,
  } as InventoryItem;
}

/**
 * What the house paid a bottle: its recorded WAC, or null (F-1281). Never the
 * library's reference price, nor the 0 a wine the library did not load
 * carries -- neither is what this house paid.
 */
export function recordedCost(i: Pick<InventoryItem, "wac">): number | null {
  return i.wac != null && Number.isFinite(i.wac) ? i.wac : null;
}

/** The bottles of a wine on `zoneIds`, the zone and its children (F-1282). */
export function qtyIn(item: InventoryItem, zoneIds: Set<string>): number {
  return (item.locations ?? []).reduce(
    (s, l) =>
      l.qty > 0 && l.locationId != null && zoneIds.has(l.locationId) ? s + l.qty : s,
    0,
  );
}

/**
 * Stock value at cost in an export (F-078). A wine with no recorded cost is
 * `withheld`, never 0.00, as in the gateway's report CSV: a spreadsheet sums a
 * 0 into a total that looks whole. With no bottles on hand it is 0 whatever
 * the cost. `units` is the bottles valued: the wine's live bottles, or one
 * zone's under a location chip (F-1282).
 */
export function stockValueCell(
  i: InventoryItem,
  // Live bottles only (F-1167): shadow is on order, not on the shelf.
  units: number = i.liveStock ?? 0,
): number | string {
  const cost = recordedCost(i);
  if (cost == null) return units === 0 ? 0 : WITHHELD;
  // F-1652: a cost for some of the wine's bottles is not the wine's value.
  if (units > 0 && costedPart(i) != null) return WITHHELD;
  return Math.round(cost * units * 100) / 100;
}

/**
 * F-1652: the bottles a wine's cost covers, when that is fewer than its live
 * bottles (24 loaded with no cost, then 12 invoiced: 12); null when the cost
 * covers them all, or nothing says otherwise.
 */
export function costedPart(i: Pick<InventoryItem, "wacQty" | "liveStock">): number | null {
  const live = i.liveStock ?? 0;
  if (i.wacQty == null || !Number.isFinite(i.wacQty) || live <= 0) return null;
  return i.wacQty < live ? Math.max(0, i.wacQty) : null;
}

/**
 * The value-on-hand total, and how many wines with bottles on hand it leaves
 * out for having no recorded cost (F-1281): a total that counted them at 0
 * would read whole when it is not.
 */
export function stockValueTotal(
  items: InventoryItem[],
  unitsOf: (i: InventoryItem) => number = (i) => i.liveStock ?? 0,
): {
  value: number;
  withheld: number;
  /** F-1652: wines whose cost covers only some of their bottles. */
  partial: number;
  /** The bottles valued, and of them those that carry a cost. */
  bottles: number;
  costedBottles: number;
} {
  let value = 0;
  let withheld = 0;
  let partial = 0;
  let bottles = 0;
  let costedBottles = 0;
  for (const i of items) {
    const units = unitsOf(i);
    bottles += units;
    const cost = recordedCost(i);
    const part = costedPart(i);
    // F-1652: the whole wine's bottles, part costed: its costed bottles only.
    // One zone's share of them cannot be told apart, so it is left out.
    if (cost != null && part != null && units === (i.liveStock ?? 0)) {
      value += Math.round(cost * part * 100) / 100;
      costedBottles += part;
      partial++;
      continue;
    }
    const cell = stockValueCell(i, units);
    if (typeof cell === "number") {
      value += cell;
      costedBottles += units;
    } else withheld++;
  }
  return { value, withheld, partial, bottles, costedBottles };
}

/**
 * One line of the count sheet: a wine on one place, with that place's bottles
 * (F-1162). `first` marks a wine's first line, which alone carries the
 * figures that are the whole wine's and would double when a sheet is summed.
 */
export interface CountSheetLine {
  item: InventoryItem;
  locationId: string | null;
  qty: number;
  first: boolean;
}

/**
 * The count sheet's lines: one per (wine, place holding it), each with that
 * place's quantity. A sheet that put a split wine on its first shelf beside
 * the wine's total sent a counter to the bar to find the cellar's bottles
 * (F-1162). With `zoneIds` (a location chip, F-1161) only those places are
 * listed. A wine no place holds is one line, at its total, unplaced.
 */
export function countSheetLines(
  items: InventoryItem[],
  zoneIds: Set<string> | null = null,
): CountSheetLine[] {
  const lines: CountSheetLine[] = [];
  for (const item of items) {
    const byPlace = new Map<string | null, number>();
    for (const l of item.locations ?? []) {
      if (!(l.qty > 0)) continue;
      if (zoneIds && !(l.locationId != null && zoneIds.has(l.locationId))) continue;
      const at = l.locationId ?? null;
      byPlace.set(at, (byPlace.get(at) ?? 0) + l.qty);
    }
    if (byPlace.size === 0) {
      if (!zoneIds)
        lines.push({ item, locationId: null, qty: item.liveStock ?? 0, first: true });
      continue;
    }
    let first = true;
    for (const [locationId, qty] of byPlace) {
      lines.push({ item, locationId, qty, first });
      first = false;
    }
  }
  return lines;
}

/** One house's rows for the all-locations export, shaped as on screen. */
export interface HouseInventory {
  name: string;
  currency: { code: string | null; readable: boolean };
  items: InventoryItem[];
}

/**
 * Every house the person owns or manages, each row shaped as on screen. The
 * page's own read goes through `useInventoryData` and `useWinesByIds`; this is
 * the same two reads across houses. One gateway read names no house in its
 * path (F-596: a per-house read with this house's token was refused), and
 * houses where the person is neither owner nor manager come back by name only.
 */
export async function loadEveryHouseInventory(): Promise<{
  houses: HouseInventory[];
  notIncluded: string[];
}> {
  const read = await getInventoryAcrossHouses();
  const raw = read.houses.map((h) => ({
    ...h,
    items: h.items.map(normalizeInventoryItem),
  }));
  const ids = Array.from(
    new Set(raw.flatMap((h) => h.items.map((i) => i.wineId)).filter(Boolean)),
  );
  const winesById = new Map<string, Wine>();
  if (ids.length > 0) {
    mapApiWinesToUiWines(await getWinesByIds(ids)).forEach((w) => winesById.set(w.id, w));
  }
  return {
    houses: raw.map((h) => ({
      name: h.name,
      currency: h.currency,
      items: h.items.map((item) => toInventoryItem(item, winesById.get(item.wineId))),
    })),
    notIncluded: read.notIncluded.map((h) => h.name),
  };
}

export function useInventoryPage(options: UseInventoryPageOptions = {}) {
  // Filter state
  const initial = options.initialFilters;
  const [searchQuery, setSearchQuery] = useState(initial?.searchQuery ?? "");
  const [filterType, setFilterType] = useState(initial?.filterType ?? "all");
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
  >(initial?.location ?? null);

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
    summaryError,
    lowStockError,
    isPending,
    listKnown: inventoryListKnown,
    refetch: refetchInventory,
    updateItem: updateInventoryItem,
  } = useInventoryData();

  // A failed read is an error, not an empty success (CLAUDE.md §9 / ADR
  // 0149): any of the three reads failing means the figures derived from an
  // empty `inventory` array below are unknown, not zero. Go-live sweep
  // 2026-09-18, wave5/live-fix.md — the wave-4 banner keyed on
  // `inventoryError` alone and missed the summary/low-stock queries.
  const hasFailedRead = Boolean(inventoryError || summaryError || lowStockError);

  // Fixed 2026-09-19 (wave5/live-confirm.md B2): `hasFailedRead` alone drove
  // the em-dash figures, but a query with no data yet is ALSO not zero --
  // it's unknown, whether that's the ordinary first mount or (the measured
  // defect) a refetch loop that keeps resetting a query to `pending` and
  // clearing `error` for its duration, in which case `hasFailedRead` reads
  // false throughout. `figuresUnknown` is for the figures; `hasFailedRead`
  // keeps its narrower, error-only meaning for the banner, which should not
  // claim a read "could not be reached" while it is merely still loading.
  const figuresUnknown = hasFailedRead || isPending;

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

    return visibleApiInventory.map((item) =>
      toInventoryItem(item, winesById.get(item.wineId)),
    );
  }, [visibleApiInventory, inventoryLoading, winesById]);

  // Computed values. Every filter but the location chip: the map and the zone
  // manager's assign list read this one (the receiving picker searches every
  // item itself, F-1705), since a
  // chip must not empty the other zones or hide unplaced wines (F-1270).
  const filteredInventoryAnyPlace = useMemo(() => {
    let items = [...inventory];

    // Search filter
    if (searchQuery) {
      const query = foldText(searchQuery);
      items = items.filter(
        (item) =>
          foldText(item.name).includes(query) ||
          // BOTH NAMES ARE SEARCHABLE (ADR 0124, the naming rule, founder
          // 2026-09-05). `item.name` is the house's alias when it has set one,
          // so matching only on it makes the library's own name unfindable —
          // a house that renames "1988 Wine X" to "Wine X" could no longer
          // search "1988". The library name is never DISPLAYED here; it is
          // only matched.
          foldText((item as any).libraryName).includes(query) ||
          foldText(item.producer).includes(query) ||
          foldText(item.grape).includes(query),
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
          // No par sorts below every set par.
          aVal = a.threshold ?? -1;
          bVal = b.threshold ?? -1;
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

  // Location chip (F-1161): the wines with a bottle on that zone or on a
  // zone inside it. The chip set the state and the URL, and nothing read it.
  // Only the table and the count sheet take it (F-1270).
  const filteredInventory = useMemo(() => {
    if (!selectedLocationFilter) return filteredInventoryAnyPlace;
    const zoneIds = zoneAndChildren(selectedLocationFilter, options.zones);
    return filteredInventoryAnyPlace.filter((item) =>
      holdsStockIn(item, zoneIds),
    );
  }, [filteredInventoryAnyPlace, selectedLocationFilter, options.zones]);

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
    summaryError,
    lowStockError,
    hasFailedRead,
    figuresUnknown,
    inventoryListKnown,
    refetchInventory,
    updateInventoryItem,

    // Computed values
    filteredInventory,
    filteredInventoryAnyPlace,
    stats,
    uniqueBottleSizes,
  };
}
