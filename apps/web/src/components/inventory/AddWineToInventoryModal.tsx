import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  X,
  Search,
  Camera,
  Wine,
  Plus,
  Check,
  Sparkles,
  MapPin,
  Save,
  Minus,
} from "lucide-react";
import { Wine as WineType, getWineTypeColor } from "../../data/wineData";
import { useWines } from "../../hooks/queries";
import { mapApiWinesToUiWines } from "../../lib/wine-library";
import { MenuScannerFlow } from "../scanner/MenuScannerFlow";
import { summarizeMenuScanPersist } from "../../lib/menuScannerPersistence";
import { useStorageLocations } from "../../hooks/useStorageLocations";
import { useMayActForTheHouse } from "../../hooks/useMayActForTheHouse";
import { useHouseGroupMark } from "../../hooks/useHouseGroupMark";
import { displayGroupMark, readOptionalAmount, twoReadingsProblem } from "../../lib/parseDecimal";
import {
  COMMON_BOTTLE_SIZES,
  COMMON_POUR_SIZES,
  parseVolumeInput,
  isValidBottleSize,
  BOTTLE_SIZE_MIN_ML,
  BOTTLE_SIZE_MAX_ML,
  isValidPourSize,
  formatVolume,
  getGlassesPerBottle,
  type SaleType,
} from "../../utils/volumeUtils";
import { useRestaurantSettingsStore } from "../../stores/restaurantSettingsStore";
import {
  clearSessionDraft,
  readSessionDraft,
  useUnsavedWorkGuard,
  writeSessionDraft,
} from "../../hooks/useUnsavedWorkGuard";
import { useModalDialog } from "../../hooks/useModalDialog";
import { formatStatedMoney } from "../../lib/currency";
import { foldText } from "../../lib/textFold";
import {
  getErrorMessage,
  getErrorStatus,
  isUnconfirmedWrite,
} from "../../services/api/client";

type TabType = "search" | "photo";

/**
 * Why an add did not land, in the owner's words (F-205). A 5xx or a lost
 * answer may still have written the row, so it never claims "nothing was
 * added".
 */
function addRefusalWords(error: unknown, wineName: string): string {
  const status = getErrorStatus(error);
  if (status === 409)
    return `${wineName} is already in the cellar, so nothing was added. Change its count on its own row.`;
  if (status === 403 || status === 401)
    return "This account may not add a wine with a price. Nothing was added: leave the prices blank, or ask an owner or a manager.";
  if (isUnconfirmedWrite(error))
    return `We could not confirm ${wineName} was added. Look for it in the cellar before trying again.`;
  return `${wineName} was not added (${getErrorMessage(error)}). Nothing was written, and what you typed is still here.`;
}

interface VolumeFields {
  bottleSizeMl: number;
  saleType: SaleType;
  pourSizeMl?: number;
  menuPriceGlass?: number;
  /** This house's own whole-bottle price (ADR 0193: stored in menu_price_current) — never the wine library's reference price. Collected whenever saleType includes "bottle". Omitted (not sent as 0) when the field was left blank — see costPerBottle's null handling below, which this mirrors. */
  menuPriceBottle?: number;
  costPerBottle?: number;
  /**
   * Free/comp bottle (distributor tasting sample, staff gift, etc.). The caller maps
   * this to `costProvenance: 'sample'` with a cost of $0, which the WAC rollup
   * excludes — the bottles count as stock, never toward average cost.
   */
  isSample?: boolean;
}

interface AddWineToInventoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddWine: (
    wine: WineType,
    quantity: number,
    /** Undefined for staff: a par is an owner's or a manager's (F-1064). */
    threshold: number | undefined,
    storageLocationId?: string,
    volumeFields?: VolumeFields,
  ) => void | Promise<void>;
  /**
   * Who is adding, in which house (`<person>:<house>`). With it, a picked
   * wine and what was typed about it are kept for this tab, so a refresh or a
   * Back does not drop them (F-712). Without it nothing is kept.
   */
  draftScope?: string;
}

/** Everything typed about one wine before it is added — the modal's state. */
interface AddWineDraft {
  activeTab: TabType;
  searchQuery: string;
  selectedWine: WineType | null;
  quantity: number;
  threshold: number;
  /** The amounts as typed, read the house's way on every render (F-779). */
  costText: string;
  isSample: boolean;
  selectedStorageLocationId?: string;
  bottleSizeMl: number;
  customBottleSizeInput: string;
  isCustomBottleSize: boolean;
  saleType: SaleType;
  pourSizeMl: number;
  customPourSizeInput: string;
  isCustomPourSize: boolean;
  menuPriceGlassText: string;
  menuPriceBottleText: string;
}
const addWineKey = (scope: string) => `mdv:add-wine:${scope}`;

export function AddWineToInventoryModal({
  isOpen,
  onClose,
  onAddWine,
  draftScope,
}: AddWineToInventoryModalProps) {
  const { measurementUnit } = useRestaurantSettingsStore();
  // What the house paid for a wine is an owner's or a manager's to set
  // (F-312): the gateway refuses a cost, or a free sample, from anyone else.
  // Staff add the wine with its cost left unknown. A menu price is the same
  // owner's or manager's act (ADR 0193), so its fields are held the same way
  // (F-833): offered to staff, they only earned a refusal of the whole add.
  const canSetCost = useMayActForTheHouse();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabType>("search");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedWine, setSelectedWine] = useState<WineType | null>(null);
  const [quantity, setQuantity] = useState<number>(1);
  const [threshold, setThreshold] = useState<number>(10);
  /**
   * `null` means "nobody has told us what this cost" — a real answer, and the
   * one the UI could not express (POS lens defect 6). It was `number`,
   * initialised to 0 and coerced with `parseFloat(e.target.value) || 0`, so a
   * cleared field became a $0 the API then labelled `'manual'`: a price
   * somebody supposedly typed. The 2 wines added through this modal on the
   * lens run carry lots at `0.0 / 'manual'`; the 50 added through the bulk
   * door, with the field omitted, carry the honest `NULL / 'estimated'`.
   */
  // Kept as the text typed and read the way the house writes numbers (F-779,
  // F-358): "1.250" is ₺1,250 here exactly as it is in the price cell and the
  // batch receive grid, and a Turkish keypad's "38,50" is 38.5. Blank is null;
  // text that does not read as an amount holds the add and says why.
  const group = useHouseGroupMark();
  const [costText, setCostText] = useState("");
  const costRead = readOptionalAmount(costText, group);
  const costPerBottle = costRead.ok ? costRead.value : null;
  const [isSample, setIsSample] = useState(false);
  const [showScannerFlow, setShowScannerFlow] = useState(false);
  const [selectedStorageLocationId, setSelectedStorageLocationId] = useState<
    string | undefined
  >(undefined);
  const { locations: storageLocations } = useStorageLocations();

  const [bottleSizeMl, setBottleSizeMl] = useState<number>(750);
  const [customBottleSizeInput, setCustomBottleSizeInput] = useState("");
  const [isCustomBottleSize, setIsCustomBottleSize] = useState(false);
  const [saleType, setSaleType] = useState<SaleType>("bottle");
  const [pourSizeMl, setPourSizeMl] = useState<number>(150);
  const [customPourSizeInput, setCustomPourSizeInput] = useState("");
  const [isCustomPourSize, setIsCustomPourSize] = useState(false);
  // `null` = nobody typed a glass price, the same distinction as the bottle
  // below. It used to default to 0 and be SENT whenever the glass fields
  // showed: an invented $0.00 glass price, and -- since a price named on add
  // is an owner's or a manager's (ADR 0193, founder 2026-09-21) -- a refusal
  // of the whole add for a staff member who never typed one.
  const [menuPriceGlassText, setMenuPriceGlassText] = useState("");
  const glassRead = readOptionalAmount(menuPriceGlassText, group);
  const menuPriceGlass = glassRead.ok ? glassRead.value : null;
  /**
   * `null` means "nobody typed a bottle price" — kept distinct from an
   * explicitly typed 0, the same distinction costPerBottle above makes and
   * for the same reason: a blank field defaulting to 0 turned into a real
   * $0.00 house price on BottleLeaf (round-4 must_fix). menuPriceGlass now
   * has the same shape (2026-09-21, ADR 0193).
   */
  const [menuPriceBottleText, setMenuPriceBottleText] = useState("");
  const bottleRead = readOptionalAmount(menuPriceBottleText, group);
  const menuPriceBottle = bottleRead.ok ? bottleRead.value : null;

  const customBottleParsed = customBottleSizeInput
    ? parseVolumeInput(customBottleSizeInput)
    : null;
  const customPourParsed = customPourSizeInput
    ? parseVolumeInput(customPourSizeInput)
    : null;
  const showGlassFields = saleType === "glass" || saleType === "both";
  // Mirrors showGlassFields exactly: a menu bottle price is only collected
  // when this wine is actually sold by the bottle (ADR 0193: stored in
  // menu_price_current; founder: "we're going to add a per house bottle price").
  const showBottleFields = saleType === "bottle" || saleType === "both";
  /** A price field holding text that is not an amount: the add is held until it is fixed or cleared. */
  const unreadablePrice =
    !isSample && !costRead.ok
      ? costText
      : showBottleFields && !bottleRead.ok
        ? menuPriceBottleText
        : showGlassFields && !glassRead.ok
          ? menuPriceGlassText
          : null;
  /**
   * F-832: a price the house and this screen read two ways ("1,250" in a
   * "."-grouping house on an English screen) holds the add and asks, never
   * guesses — the F-799 rule, as on the credit form.
   */
  const shownGroup = displayGroupMark();
  const priceQuestion =
    (!isSample ? twoReadingsProblem(costText, group, shownGroup) : null) ??
    (showBottleFields ? twoReadingsProblem(menuPriceBottleText, group, shownGroup) : null) ??
    (showGlassFields ? twoReadingsProblem(menuPriceGlassText, group, shownGroup) : null);
  /** A recorded number written back as text the house's own reader takes back unchanged. */
  const decimalText = (n: number) => (group === "." ? String(n).replace(".", ",") : String(n));
  const glassesPerBottle = showGlassFields
    ? getGlassesPerBottle(bottleSizeMl, pourSizeMl)
    : 0;

  // Filter wines for search - SHOW ALL 200 WINES
  const { data: apiWines = [] } = useWines({
    search: searchQuery || undefined,
    limit: 200,
  });

  const filteredWines = useMemo(() => {
    const uiWines = mapApiWinesToUiWines(apiWines);
    if (!searchQuery) return uiWines;
    // Folded like the gateway's search (F-1351): the library answers
    // "kavaklidere" with "Kavaklıdere", so this second pass must keep it.
    const query = foldText(searchQuery);
    return uiWines.filter(
      (wine) =>
        foldText(wine.name).includes(query) ||
        foldText(wine.displayName).includes(query) ||
        foldText(wine.producer).includes(query) ||
        foldText(wine.grape).includes(query) ||
        foldText(wine.region).includes(query) ||
        foldText(wine.country).includes(query) ||
        foldText(wine.type).includes(query),
    );
  }, [apiWines, searchQuery]);

  /** Puts the modal back to a kept draft, or to empty when there is none. */
  const applyDraft = (d: AddWineDraft | null) => {
    setActiveTab(d?.activeTab ?? "search");
    setSearchQuery(d?.searchQuery ?? "");
    setSelectedWine(d?.selectedWine ?? null);
    setQuantity(d?.quantity ?? 1);
    setThreshold(d?.threshold ?? 10);
    setCostText(d?.costText ?? "");
    setIsSample(d?.isSample ?? false);
    setSelectedStorageLocationId(d?.selectedStorageLocationId);
    setBottleSizeMl(d?.bottleSizeMl ?? 750);
    setCustomBottleSizeInput(d?.customBottleSizeInput ?? "");
    setIsCustomBottleSize(d?.isCustomBottleSize ?? false);
    setSaleType(d?.saleType ?? "bottle");
    setPourSizeMl(d?.pourSizeMl ?? 150);
    setCustomPourSizeInput(d?.customPourSizeInput ?? "");
    setIsCustomPourSize(d?.isCustomPourSize ?? false);
    setMenuPriceGlassText(d?.menuPriceGlassText ?? "");
    setMenuPriceBottleText(d?.menuPriceBottleText ?? "");
  };

  // The wine picked by THIS person in THIS house comes back after a refresh
  // or a Back; another house's pick (and its storage spot) never carries over.
  const skipKeep = useRef(true);
  useEffect(() => {
    skipKeep.current = true;
    applyDraft(
      draftScope
        ? readSessionDraft<AddWineDraft>(addWineKey(draftScope))
        : null,
    );
  }, [draftScope]);

  // Written on every change, except in the commit where the house changed:
  // there the state still holds the previous house's pick. Nothing picked,
  // nothing kept.
  useEffect(() => {
    if (skipKeep.current) {
      skipKeep.current = false;
      return;
    }
    if (!draftScope) return;
    if (!selectedWine) {
      clearSessionDraft(addWineKey(draftScope));
      return;
    }
    writeSessionDraft(addWineKey(draftScope), {
      activeTab,
      searchQuery,
      selectedWine,
      quantity,
      threshold,
      costText,
      isSample,
      selectedStorageLocationId,
      bottleSizeMl,
      customBottleSizeInput,
      isCustomBottleSize,
      saleType,
      pourSizeMl,
      customPourSizeInput,
      isCustomPourSize,
      menuPriceGlassText,
      menuPriceBottleText,
    } satisfies AddWineDraft);
  }, [
    draftScope,
    activeTab,
    searchQuery,
    selectedWine,
    quantity,
    threshold,
    costText,
    isSample,
    selectedStorageLocationId,
    bottleSizeMl,
    customBottleSizeInput,
    isCustomBottleSize,
    saleType,
    pourSizeMl,
    customPourSizeInput,
    isCustomPourSize,
    menuPriceGlassText,
    menuPriceBottleText,
  ]);

  // A refresh or a Back used to drop the picked wine without a word (F-712).
  useUnsavedWorkGuard(
    isOpen && selectedWine !== null,
    draftScope
      ? "This wine is not added to your stock yet. Leave anyway? It stays here on this tab."
      : "This wine is not added to your stock yet. Leave and lose what you typed?",
  );

  const handleClose = () => {
    applyDraft(null);
    setAddRefusal(null);
    onClose();
  };

  const handleSelectWine = (wine: WineType) => {
    setSelectedWine(wine);
    setAddRefusal(null);
    setQuantity(wine.liveStock || 1);
    setThreshold(wine.threshold || 10);
    // The shared library's reference price is a REFERENCE, not this
    // restaurant's cost. Pre-filling it made every unedited row claim a cost
    // the house never paid, and made "I don't know" unreachable in one click.
    // Offered below the field instead, as something to accept deliberately.
    setCostText("");
    setIsSample(false);
  };

  // F-205: the add is awaited. The sheet used to close before the write, so a
  // refusal (already in the cellar, not allowed, a bad field) was never said.
  // It now stays open, says why, and keeps what the person typed.
  const [adding, setAdding] = useState(false);
  const [addRefusal, setAddRefusal] = useState<string | null>(null);

  const handleAddToInventory = async () => {
    if (selectedWine && unreadablePrice === null && priceQuestion === null && !adding) {
      const volumeFields: VolumeFields = {
        bottleSizeMl,
        saleType,
        ...(showGlassFields && { pourSizeMl }),
        ...(canSetCost &&
          showGlassFields &&
          menuPriceGlass !== null && { menuPriceGlass }),
        // menuPriceBottle === null means the field was left blank: omit the
        // key entirely so the API writes NULL, not an invented $0.00 house
        // price (round-4 must_fix; mirrors costPerBottle's null handling
        // below). An explicitly typed 0 still sends {menuPriceBottle: 0}.
        ...(canSetCost &&
          showBottleFields &&
          menuPriceBottle !== null && { menuPriceBottle }),
        // A sample carries a real $0, not an absent cost. The caller turns this flag
        // into costProvenance 'sample', which the WAC rollup excludes by name — so a
        // free bottle stays distinguishable from one whose price was never entered.
        // Three distinct outcomes, and they must stay three:
        //   sample        -> a deliberate $0 with provenance 'sample' (excluded from WAC)
        //   a number      -> the cost the house paid
        //   left blank    -> the key is OMITTED, so the API writes NULL and no
        //                    provenance. Sending 0 here is what produced
        //                    `0.0 / 'manual'` — an invented price wearing a
        //                    provenance that says a human supplied it.
        ...(!canSetCost
          ? {}
          : isSample
          ? { isSample: true, costPerBottle: 0 }
          : costPerBottle === null
            ? {}
            : { costPerBottle }),
      };
      setAdding(true);
      setAddRefusal(null);
      try {
        await onAddWine(
          selectedWine,
          quantity,
          // A par is held like the cost (F-1064): staff send none, and the
          // wine takes the house's default.
          canSetCost ? threshold : undefined,
          selectedStorageLocationId,
          volumeFields,
        );
      } catch (error) {
        setAddRefusal(addRefusalWords(error, selectedWine.name));
        return;
      } finally {
        setAdding(false);
      }
      handleClose();
    }
  };

  const dialogRef = useModalDialog(isOpen, () => handleClose());
  const titleId = useId();

  if (!isOpen) return null;

  return (
    <>
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={handleClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            onClick={(e) => e.stopPropagation()}
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col focus:outline-none"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-wine-50 to-wine-100">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-wine-600 rounded-xl">
                  <Plus className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 id={titleId} className="text-xl font-bold text-gray-900">
                    Add Wine to Inventory
                  </h2>
                  <p className="text-sm text-gray-500">
                    Choose from master library or scan a new wine
                  </p>
                </div>
              </div>
              <button
                onClick={handleClose}
                aria-label="Close"
                className="p-2 hover:bg-white/50 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-gray-500" aria-hidden />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-gray-200 bg-gray-50">
              <button
                onClick={() => setActiveTab("search")}
                className={`flex-1 flex items-center justify-center gap-2 px-6 py-4 font-medium transition-all ${
                  activeTab === "search"
                    ? "bg-white text-wine-600 border-b-2 border-wine-600"
                    : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
                }`}
              >
                <Search className="w-5 h-5" />
                <span>Search Master Library</span>
                <span className="ml-2 px-2 py-0.5 bg-wine-100 text-wine-700 text-xs font-semibold rounded-full">
                  {filteredWines.length}
                </span>
              </button>
              <button
                onClick={() => setActiveTab("photo")}
                className={`flex-1 flex items-center justify-center gap-2 px-6 py-4 font-medium transition-all ${
                  activeTab === "photo"
                    ? "bg-white text-wine-600 border-b-2 border-wine-600"
                    : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
                }`}
              >
                <Camera className="w-5 h-5" />
                <span>Scan Wine Label</span>
              </button>
            </div>

            {/* Content */}
            {/* Below md the configure panel stacks under the list: a 384px
                sidebar beside the list overflowed a phone-width sheet (F-208). */}
            <div className="flex-1 overflow-y-auto md:overflow-hidden flex flex-col md:flex-row">
              {/* Search Tab */}
              {activeTab === "search" && (
                <div className="flex-1 flex flex-col overflow-hidden">
                  {/* Search Bar */}
                  <div className="p-4 border-b border-gray-100">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                      <input
                        type="text"
                        placeholder="Search wines, producers, regions, grapes..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-wine-500 focus:border-transparent outline-none"
                        autoFocus
                      />
                    </div>
                  </div>

                  {/* Wine List */}
                  <div className="flex-1 overflow-y-auto p-4">
                    {filteredWines.length === 0 ? (
                      <div className="text-center py-12">
                        <Search className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                        <p className="text-gray-500">
                          No wines found matching "{searchQuery}"
                        </p>
                        <p className="text-sm text-gray-400 mt-1">
                          Try a different search term
                        </p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {filteredWines.map((wine) => {
                          const typeColors = getWineTypeColor(wine.type);
                          const isSelected = selectedWine?.id === wine.id;

                          return (
                            <button
                              key={wine.id}
                              onClick={() => handleSelectWine(wine)}
                              className={`p-4 rounded-xl border-2 text-left transition-all ${
                                isSelected
                                  ? "border-wine-500 bg-wine-50 shadow-lg"
                                  : "border-gray-200 hover:border-wine-300 hover:bg-gray-50"
                              }`}
                            >
                              <div className="flex items-start gap-3">
                                <div
                                  className={`w-12 h-16 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0 ${
                                    isSelected ? "ring-2 ring-wine-500" : ""
                                  }`}
                                >
                                  <Wine
                                    className={`w-6 h-6 ${isSelected ? "text-wine-600" : "text-gray-400"}`}
                                  />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-start justify-between gap-2 mb-1">
                                    <h3
                                      className={`font-semibold text-sm truncate ${
                                        isSelected
                                          ? "text-wine-900"
                                          : "text-gray-900"
                                      }`}
                                    >
                                      {wine.displayName || wine.name}
                                    </h3>
                                    {isSelected && (
                                      <Check className="w-5 h-5 text-wine-600 flex-shrink-0" />
                                    )}
                                  </div>
                                  <p className="text-xs text-gray-500 mb-2">
                                    {wine.producer} · {wine.vintage || "NV"}
                                  </p>
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span
                                      className={`px-2 py-0.5 rounded-full text-xs font-medium ${typeColors.bg} ${typeColors.text}`}
                                    >
                                      {wine.type}
                                    </span>
                                    <span className="text-xs text-gray-500 flex items-center gap-1">
                                      <MapPin className="w-3 h-3" />
                                      {wine.region}, {wine.country}
                                    </span>
                                  </div>
                                  <p className="text-xs text-gray-500 mt-2">
                                    {formatStatedMoney(wine.price, null)}/bottle
                                  </p>
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Photo Tab. Its one action is the real scanner. The "Single Wine
                  Label Scan" beside it opened AddWineModal, which answered every
                  photo with the same hard-coded Château Latour 2010, and its
                  result was then filled with "dry"/"medium"/0% ABV wherever a
                  field was missing. Deleted, not labelled (ADR 0020, ADR 0314). */}
              {activeTab === "photo" && (
                <div className="flex-1 flex flex-col items-center justify-center p-8">
                  <div className="text-center max-w-md">
                    <div className="w-20 h-20 bg-wine-100 rounded-2xl mx-auto mb-4 flex items-center justify-center">
                      <Camera className="w-10 h-10 text-wine-600" />
                    </div>
                    <h3 className="text-xl font-semibold text-gray-900 mb-2">
                      Scan Wine Label
                    </h3>
                    <p className="text-gray-500 mb-6">
                      Use AI to automatically identify wine details from a photo
                      of the label
                    </p>
                    <div className="flex flex-col gap-3">
                      <button
                        onClick={() => setShowScannerFlow(true)}
                        className="px-6 py-3 bg-wine-600 text-white font-medium rounded-xl hover:bg-wine-700 shadow-lg shadow-wine-600/30 transition-all flex items-center gap-2 mx-auto"
                      >
                        <Camera className="w-5 h-5" />
                        Open Camera / Upload Image
                      </button>
                    </div>
                    <div className="mt-6 p-4 bg-purple-50 border border-purple-100 rounded-xl">
                      <div className="flex items-start gap-3">
                        <Sparkles className="w-5 h-5 text-purple-600 flex-shrink-0 mt-0.5" />
                        <div className="text-left">
                          <p className="font-medium text-gray-900 text-sm">
                            AI Menu Scanner (4-Layer Pipeline)
                          </p>
                          <p className="text-xs text-gray-600 mt-1">
                            YOLOv8 detection + Multi-language OCR + Gemini Pro
                            parser + Master Library matching. Scan full menus or
                            individual wine labels with real-time camera
                            detection.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Selected Wine Configuration Sidebar - Shows when wine is selected */}
              {selectedWine && (
                <div className="w-full md:w-96 border-t md:border-t-0 md:border-l border-gray-200 bg-gray-50 flex flex-col">
                  <div className="p-4 border-b border-gray-200 bg-white">
                    <h3 className="font-semibold text-gray-900 mb-1">
                      Configure Inventory
                    </h3>
                    <p className="text-sm text-gray-500">{selectedWine.name}</p>
                  </div>
                  <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {/* Wine Preview */}
                    <div className="p-4 bg-white rounded-xl border border-gray-200">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-12 h-16 rounded-lg flex items-center justify-center bg-gray-100">
                          <Wine className="w-6 h-6 text-gray-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <p className="font-semibold text-gray-900 text-sm truncate">
                              {selectedWine.name}
                            </p>
                          </div>
                          <p className="text-xs text-gray-500">
                            {selectedWine.producer}
                          </p>
                          <p className="text-xs text-gray-500">
                            {selectedWine.vintage || "NV"} ·{" "}
                            {selectedWine.country}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Quantity */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Initial Quantity
                      </label>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setQuantity(Math.max(0, quantity - 1))}
                          className="p-2 border border-gray-200 rounded-lg hover:bg-gray-100"
                        >
                          <Minus className="w-4 h-4 text-gray-600" />
                        </button>
                        <input
                          type="number"
                          value={quantity}
                          onChange={(e) =>
                            setQuantity(
                              Math.max(0, parseInt(e.target.value) || 0),
                            )
                          }
                          className="flex-1 px-4 py-2 border border-gray-200 rounded-lg text-center font-medium focus:ring-2 focus:ring-wine-500"
                        />
                        <button
                          onClick={() => setQuantity(quantity + 1)}
                          className="p-2 border border-gray-200 rounded-lg hover:bg-gray-100"
                        >
                          <Plus className="w-4 h-4 text-gray-600" />
                        </button>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        Current stock level
                      </p>
                    </div>

                    {/* Cost per bottle / sample toggle */}
                    {!canSetCost ? (
                      <p
                        data-testid="cost-held"
                        className="text-xs text-gray-500"
                      >
                        What the house paid for this wine is entered by a
                        manager or an owner. It is recorded as unknown for now.
                      </p>
                    ) : (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-sm font-medium text-gray-700">
                          Cost per Bottle
                        </label>
                        <label className="flex items-center gap-1.5 text-xs font-medium text-gray-500 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={isSample}
                            onChange={(e) => setIsSample(e.target.checked)}
                            className="w-3.5 h-3.5 rounded border-gray-300 text-wine-600 focus:ring-wine-500 cursor-pointer"
                          />
                          Free sample
                        </label>
                      </div>
                      {isSample ? (
                        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                          Marked as a free/comp bottle — no cost is recorded, so
                          it won't skew your average cost (WAC) or
                          value-on-hand.
                        </p>
                      ) : (
                        <>
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-medium">
                              $
                            </span>
                            <input
                              type="text"
                              inputMode="decimal"
                              // The text as typed, so a deliberate $0 stays
                              // visible instead of blanking itself.
                              value={costText}
                              onChange={(e) => setCostText(e.target.value)}
                              placeholder="leave blank if unknown"
                              className="w-full pl-7 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-wine-500"
                            />
                          </div>
                          {!costRead.ok ? (
                            <p className="text-xs text-red-600 mt-1.5" role="alert">
                              “{costText}” is not an amount. Write it like 12,50
                              or 12.50, or clear the field if you don't know.
                            </p>
                          ) : costPerBottle === null ? (
                            <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                              <p className="text-xs text-gray-500">
                                Cost unknown — recorded as unknown, not as zero.
                                Value on hand will exclude this wine until a
                                cost arrives on a receipt.
                              </p>
                              {typeof selectedWine?.price === "number" &&
                                selectedWine.price > 0 && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setCostText(
                                        decimalText(selectedWine.price as number),
                                      )
                                    }
                                    className="text-xs font-semibold text-wine-700 hover:text-wine-800 underline decoration-dotted"
                                  >
                                    Use library reference{" "}
                                    {Number(selectedWine.price).toFixed(2)}
                                  </button>
                                )}
                            </div>
                          ) : (
                            costPerBottle === 0 && (
                              <p className="text-xs text-amber-700 mt-1.5">
                                A cost of 0 is a real cost — it will count toward your
                                average cost. For a free bottle, tick "Free
                                sample" instead; to say you don't know, clear
                                the field.
                              </p>
                            )
                          )}
                        </>
                      )}
                    </div>
                    )}

                    {/* Threshold: an owner's or a manager's, like the cost (F-1064). */}
                    {!canSetCost ? (
                      <p
                        data-testid="par-held"
                        className="text-xs text-gray-500"
                      >
                        This wine starts at the house's low-stock number. A
                        manager or an owner can change it later.
                      </p>
                    ) : (
                    <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Minimum Threshold
                      </label>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() =>
                            setThreshold(Math.max(1, threshold - 1))
                          }
                          className="p-2 border border-gray-200 rounded-lg hover:bg-gray-100"
                        >
                          <Minus className="w-4 h-4 text-gray-600" />
                        </button>
                        <input
                          type="number"
                          value={threshold}
                          onChange={(e) =>
                            setThreshold(
                              Math.max(1, parseInt(e.target.value) || 1),
                            )
                          }
                          className="flex-1 px-4 py-2 border border-gray-200 rounded-lg text-center font-medium focus:ring-2 focus:ring-wine-500"
                        />
                        <button
                          onClick={() => setThreshold(threshold + 1)}
                          className="p-2 border border-gray-200 rounded-lg hover:bg-gray-100"
                        >
                          <Plus className="w-4 h-4 text-gray-600" />
                        </button>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        Alert when stock falls below this
                      </p>
                    </div>

                    {/* Quick Presets */}
                    <div>
                      <p className="text-xs text-gray-500 mb-2">
                        Quick Threshold Presets
                      </p>
                      <div className="grid grid-cols-3 gap-2">
                        {[5, 10, 20].map((preset) => (
                          <button
                            key={preset}
                            onClick={() => setThreshold(preset)}
                            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                              threshold === preset
                                ? "bg-wine-600 text-white"
                                : "bg-white border border-gray-200 text-gray-700 hover:bg-gray-50"
                            }`}
                          >
                            {preset}
                          </button>
                        ))}
                      </div>
                    </div>
                    </>
                    )}

                    {/* Storage Location */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
                        <MapPin className="w-4 h-4 text-gray-600" />
                        Storage Location
                      </label>
                      <select
                        value={selectedStorageLocationId || ""}
                        onChange={(e) =>
                          setSelectedStorageLocationId(
                            e.target.value || undefined,
                          )
                        }
                        className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-wine-500"
                      >
                        <option value="">Select a location...</option>
                        {storageLocations.map((loc) => (
                          <option key={loc.id} value={loc.id}>
                            {loc.name} ({loc.currentCount}/{loc.capacity})
                          </option>
                        ))}
                      </select>
                      <p className="text-xs text-gray-500 mt-1">
                        Physical location in cellar/storage
                      </p>
                    </div>

                    {/* Bottle Size */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Bottle Size
                      </label>
                      <select
                        value={
                          isCustomBottleSize ? "custom" : String(bottleSizeMl)
                        }
                        onChange={(e) => {
                          if (e.target.value === "custom") {
                            setIsCustomBottleSize(true);
                          } else {
                            setIsCustomBottleSize(false);
                            setCustomBottleSizeInput("");
                            setBottleSizeMl(Number(e.target.value));
                          }
                        }}
                        className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-wine-500"
                      >
                        {COMMON_BOTTLE_SIZES.map((s) => (
                          <option key={s.ml} value={s.ml}>
                            {s.label} ({formatVolume(s.ml, measurementUnit)})
                          </option>
                        ))}
                        <option value="custom">Custom...</option>
                      </select>
                      {isCustomBottleSize && (
                        <div className="mt-2">
                          <input
                            type="text"
                            value={customBottleSizeInput}
                            onChange={(e) => {
                              setCustomBottleSizeInput(e.target.value);
                              const parsed = parseVolumeInput(e.target.value);
                              if (parsed && isValidBottleSize(parsed.ml)) {
                                setBottleSizeMl(parsed.ml);
                              }
                            }}
                            placeholder="e.g. 750ml, 75cl, 1.5L, 25.4oz"
                            className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-wine-500"
                          />
                          <p
                            className={`text-xs mt-1 ${
                              customBottleParsed &&
                              isValidBottleSize(customBottleParsed.ml)
                                ? "text-green-600"
                                : customBottleSizeInput
                                  ? "text-red-500"
                                  : "text-gray-400"
                            }`}
                          >
                            {customBottleParsed &&
                            isValidBottleSize(customBottleParsed.ml)
                              ? `Parsed: ${customBottleParsed.ml}ml (${customBottleParsed.oz}oz)`
                              : customBottleSizeInput
                                ? `Invalid volume (${BOTTLE_SIZE_MIN_ML}ml – ${BOTTLE_SIZE_MAX_ML}ml)`
                                : "Enter a volume"}
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Sale Type */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Sale Type
                      </label>
                      <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                        {(["bottle", "glass", "both"] as SaleType[]).map(
                          (type) => (
                            <button
                              key={type}
                              type="button"
                              onClick={() => setSaleType(type)}
                              className={`flex-1 px-3 py-2 text-sm font-medium transition-colors ${
                                saleType === type
                                  ? "bg-indigo-600 text-white"
                                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                              }`}
                            >
                              {type.charAt(0).toUpperCase() + type.slice(1)}
                            </button>
                          ),
                        )}
                      </div>
                    </div>

                    {/* Pour Size (conditional) */}
                    {showGlassFields && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Pour Size
                        </label>
                        <select
                          value={
                            isCustomPourSize ? "custom" : String(pourSizeMl)
                          }
                          onChange={(e) => {
                            if (e.target.value === "custom") {
                              setIsCustomPourSize(true);
                            } else {
                              setIsCustomPourSize(false);
                              setCustomPourSizeInput("");
                              setPourSizeMl(Number(e.target.value));
                            }
                          }}
                          className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-wine-500"
                        >
                          {COMMON_POUR_SIZES.map((s) => (
                            <option key={s.ml} value={s.ml}>
                              {s.label}
                            </option>
                          ))}
                          <option value="custom">Custom...</option>
                        </select>
                        {isCustomPourSize && (
                          <div className="mt-2">
                            <input
                              type="text"
                              value={customPourSizeInput}
                              onChange={(e) => {
                                setCustomPourSizeInput(e.target.value);
                                const parsed = parseVolumeInput(e.target.value);
                                if (parsed && isValidPourSize(parsed.ml)) {
                                  setPourSizeMl(parsed.ml);
                                }
                              }}
                              placeholder="e.g. 150ml, 5oz"
                              className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-wine-500"
                            />
                            <p
                              className={`text-xs mt-1 ${
                                customPourParsed &&
                                isValidPourSize(customPourParsed.ml)
                                  ? "text-green-600"
                                  : customPourSizeInput
                                    ? "text-red-500"
                                    : "text-gray-400"
                              }`}
                            >
                              {customPourParsed &&
                              isValidPourSize(customPourParsed.ml)
                                ? `Parsed: ${customPourParsed.ml}ml (${customPourParsed.oz}oz)`
                                : customPourSizeInput
                                  ? "Invalid pour size (30ml – 500ml)"
                                  : "Enter a volume"}
                            </p>
                          </div>
                        )}
                        <p className="text-xs text-indigo-600 font-medium mt-2">
                          Glasses per bottle: {glassesPerBottle}
                        </p>
                      </div>
                    )}

                    {/* Bottle Menu Price (conditional) — this house's own
                        price (ADR 0193: menu_price_current). Gated on
                        showBottleFields instead of showGlassFields, same as
                        Glass Menu Price below, but a blank field stays
                        null/omitted here instead of coercing to 0 (round-4
                        must_fix) — see menuPriceBottle's state comment.
                        Owners and managers only, like the cost (F-833). */}
                    {!canSetCost && (showBottleFields || showGlassFields) && (
                      <p
                        data-testid="menu-price-held"
                        className="text-xs text-gray-500"
                      >
                        The menu price is set by a manager or an owner.
                      </p>
                    )}
                    {canSetCost && showBottleFields && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Bottle Menu Price
                        </label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-medium">
                            $
                          </span>
                          <input
                            type="text"
                            inputMode="decimal"
                            // The text as typed, read the way the house writes
                            // numbers (mirrors costPerBottle above).
                            value={menuPriceBottleText}
                            onChange={(e) => setMenuPriceBottleText(e.target.value)}
                            placeholder="leave blank if not set"
                            className="w-full pl-7 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-wine-500"
                          />
                        </div>
                      </div>
                    )}

                    {/* Glass Menu Price (conditional) */}
                    {canSetCost && showGlassFields && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Glass Menu Price
                        </label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-medium">
                            $
                          </span>
                          <input
                            type="text"
                            inputMode="decimal"
                            // Blank stays blank (null); a typed 0 is kept as 0.
                            value={menuPriceGlassText}
                            onChange={(e) => setMenuPriceGlassText(e.target.value)}
                            placeholder="0.00"
                            className="w-full pl-7 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-wine-500"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Footer */}
                  <div className="p-4 border-t border-gray-200 bg-white">
                    {unreadablePrice !== null && (
                      <p className="text-xs text-red-600 mb-2" role="status">
                        “{unreadablePrice}” is not an amount — fix or clear it to add this wine.
                      </p>
                    )}
                    {addRefusal && (
                      <p role="alert" className="mb-3 text-sm text-red-700">
                        {addRefusal}
                      </p>
                    )}
                    {unreadablePrice === null && priceQuestion !== null && (
                      <p className="text-xs text-red-600 mb-2" role="status">
                        {priceQuestion}
                      </p>
                    )}
                    <button
                      onClick={() => void handleAddToInventory()}
                      disabled={unreadablePrice !== null || priceQuestion !== null || adding}
                      className="w-full px-4 py-3 bg-wine-600 text-white font-medium rounded-xl hover:bg-wine-700 shadow-lg shadow-wine-600/30 transition-all flex items-center justify-center gap-2 disabled:opacity-40"
                    >
                      <Save className="w-5 h-5" />
                      {adding ? "Adding…" : "Add to Inventory"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      </AnimatePresence>

      {/* Full Menu Scanner Flow - Camera + YOLO + Results */}
      {typeof document !== "undefined" &&
        showScannerFlow &&
        createPortal(
          <MenuScannerFlow
            isOpen={showScannerFlow}
            onClose={() => setShowScannerFlow(false)}
            onWinesAdded={(_wines, result) => {
              // The scanner's batch step already wrote these rows; reporting is all
              // that's left, so this must not persist a second time.
              if (!result) return;
              toast.success(`Menu scan: ${summarizeMenuScanPersist(result)}`, {
                description:
                  result.provisional.length > 0
                    ? `${result.provisional.map((r) => r.wineName).join(", ")} — added to the Master Wine Library as provisional entries.`
                    : undefined,
              });
              queryClient.invalidateQueries({ queryKey: ["inventory"] });
            }}
          />,
          document.body,
        )}
    </>
  );
}
