/**
 * SimPOS terminal — chrome-free fake POS (decisions C26-C30).
 *
 * Two tabs matching the sketch:
 *   Home            — POS pane (open check + Loss) + Menu pane (wine → vintage → size → Add)
 *                     + Edit POS mode (catalog editor / drift generator) + Tables 1-20 (disabled)
 *   Receipts/Invoices — this fake restaurant's procurement_documents
 *
 * "Check logs in full page" opens /simpos/:restaurantId/orders — SimPOS's own
 * order log, distinct from the Mudavym /logs timeline.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  Pencil,
  Plus,
  FlaskConical,
  ScrollText,
  X,
} from "lucide-react";
import {
  simposApi,
  type SimposCatalogItem,
  type SimposCheckLine,
} from "../../services/api/simpos";
import { documentsApi, dashNull } from "../../services/api/documents";
import { cn } from "../../lib/utils";
import { formatVenueTime, hoursStateLabel } from "../../lib/venueTime";

/** The categories Edit POS offers. Mirrors the CHECK constraint on the column. */
const SIMPOS_CATEGORY_OPTIONS = [
  "wine",
  "beer",
  "spirit",
  "sake",
  "cider",
  "cocktail",
  "non_alcoholic",
  "food",
  "other",
] as const;
type SimposCategory = (typeof SIMPOS_CATEGORY_OPTIONS)[number];

type Tab = "home" | "receipts";

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return "—";
  return `$${Number(n).toFixed(2)}`;
}

/**
 * An unpriced button (POS lens defect 3). Every SKU used to seed at a
 * hard-coded $45 with nothing on screen marking it as a placeholder, so 53 of
 * 53 buttons showed a price nobody had set. A null price now renders as the
 * word — never as $0.00, which would claim the item is free (ADR 0020).
 */
function fmtPrice(n: number | null | undefined): string {
  if (n === null || n === undefined) return "unpriced";
  return `$${Number(n).toFixed(2)}`;
}

/** A line's money, or the word — same rule as fmtPrice, times quantity. */
function fmtLineTotal(price: number | null | undefined, qty: number): string {
  if (price === null || price === undefined) return "unpriced";
  return `$${(Number(price) * Number(qty)).toFixed(2)}`;
}

export function SimposTerminalPage() {
  const { restaurantId = "" } = useParams<{ restaurantId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("home");
  const [editPos, setEditPos] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seed once on mount so a brand-new sim restaurant has a menu to sell.
  useEffect(() => {
    if (!restaurantId) return;
    void simposApi
      .seedCatalog(restaurantId)
      .then(() => {
        void qc.invalidateQueries({
          queryKey: ["simpos-catalog", restaurantId],
        });
      })
      .catch(() => undefined);
  }, [restaurantId, qc]);

  const catalogQuery = useQuery({
    queryKey: ["simpos-catalog", restaurantId],
    queryFn: () => simposApi.listCatalog(restaurantId),
    enabled: !!restaurantId,
  });

  const checkQuery = useQuery({
    queryKey: ["simpos-check", restaurantId],
    queryFn: () => simposApi.getOrCreateOpenCheck(restaurantId),
    enabled: !!restaurantId && tab === "home",
    refetchInterval: 5_000,
  });

  const tablesQuery = useQuery({
    queryKey: ["simpos-tables", restaurantId],
    queryFn: () => simposApi.listTables(restaurantId),
    enabled: !!restaurantId && tab === "home",
  });

  // The venue's own clock and published hours (POS lens defects 11, 12). Line
  // times were rendered in the VIEWER's zone, and nothing anywhere knew the
  // venue had closed at 22:00 while 44 checks rang until 23:20.
  const venueQuery = useQuery({
    queryKey: ["simpos-venue", restaurantId],
    queryFn: () => simposApi.getVenue(restaurantId),
    enabled: !!restaurantId,
    retry: false,
    staleTime: 300_000,
  });
  const venueZone = venueQuery.data?.timezone ?? null;

  const receiptsQuery = useQuery({
    queryKey: ["simpos-receipts", restaurantId],
    queryFn: () => documentsApi.list({ limit: 50 }),
    enabled: !!restaurantId && tab === "receipts",
  });

  const check = checkQuery.data;

  const [coversDraft, setCoversDraft] = useState("");
  const [serverDraft, setServerDraft] = useState("");
  // Re-seed only when the check identity changes, so a value being typed is
  // never clobbered by the 5-second poll.
  useEffect(() => {
    setCoversDraft(check?.covers == null ? "" : String(check.covers));
    setServerDraft(check?.server_name ?? "");
  }, [check?.id]);

  /**
   * Is the venue open at this moment? Answered by the gateway (one `isOpenAt`,
   * not two), and rendered only when there is something to say: `open` shows
   * nothing, and each of the three "could not tell" reasons says which.
   */
  const liveHours = useMemo(() => {
    const now = venueQuery.data?.open_now;
    if (!now) return null;
    if (now.open === true) return null;
    return hoursStateLabel(
      now.open === false
        ? (now.reason ?? "outside_hours")
        : (now.reason ?? "hours_unknown"),
    );
  }, [venueQuery.data]);
  const catalog = catalogQuery.data ?? [];

  const wines = useMemo(() => {
    const byName = new Map<string, SimposCatalogItem[]>();
    for (const item of catalog) {
      const arr = byName.get(item.wine_name) ?? [];
      arr.push(item);
      byName.set(item.wine_name, arr);
    }
    return Array.from(byName.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [catalog]);

  const refreshCheck = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: ["simpos-check", restaurantId] });
  }, [qc, restaurantId]);

  const handleAdd = async (catalogId: string) => {
    if (!check) return;
    setBusy(true);
    setError(null);
    try {
      await simposApi.addLine(restaurantId, check.id, catalogId, 1);
      await refreshCheck();
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || "Add failed");
    } finally {
      setBusy(false);
    }
  };

  /**
   * Covers and server, written back on blur (POS lens defect 4).
   *
   * The drafts are seeded from the check and only pushed when they differ, so
   * opening the terminal does not write. An empty covers field sends `null`,
   * NOT 0: "nobody said how many guests" is the honest state of a check rung
   * without opening a table, and it has to survive all the way to
   * `pos_checks.covers` (ADR 0105 D5).
   */
  const saveCheckContext = async () => {
    if (!check) return;
    const coversValue = coversDraft.trim() === "" ? null : Number(coversDraft);
    const serverValue = serverDraft.trim() === "" ? null : serverDraft.trim();
    if (
      (check.covers ?? null) === coversValue &&
      (check.server_name ?? null) === serverValue
    ) {
      return;
    }
    if (
      coversValue !== null &&
      (!Number.isInteger(coversValue) || coversValue < 0)
    ) {
      setError(
        'Covers must be a whole number of guests, or blank for "not recorded".',
      );
      return;
    }
    setError(null);
    try {
      await simposApi.updateCheckContext(restaurantId, check.id, {
        covers: coversValue,
        serverName: serverValue,
      });
      await refreshCheck();
    } catch (e: any) {
      setError(
        e?.response?.data?.message ||
          e?.message ||
          "Could not save the check details",
      );
    }
  };

  const handleVoid = async (line: SimposCheckLine) => {
    setBusy(true);
    setError(null);
    try {
      await simposApi.setLineStatus(restaurantId, line.id, {
        status: line.status === "voided" ? "active" : "voided",
        reason: "voided from terminal",
      });
      await refreshCheck();
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || "Void failed");
    } finally {
      setBusy(false);
    }
  };

  const handleOrder = async () => {
    if (!check) return;
    setBusy(true);
    setError(null);
    try {
      const result = await simposApi.closeCheck(restaurantId, check.id);
      if (!result.webhook?.ok) {
        setError(result.webhook?.error || "Webhook delivery failed");
      }
      await refreshCheck();
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || "Order failed");
    } finally {
      setBusy(false);
    }
  };

  if (!restaurantId) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-gray-500">
        Missing restaurant id
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
      {/* Top nav — Home / Receipts-Invoices */}
      <header className="border-b border-gray-800 px-4 py-3 flex items-center gap-4">
        <span className="text-xs font-bold tracking-widest text-amber-400 uppercase">
          SimPOS
        </span>
        <nav className="flex gap-1">
          {(
            [
              ["home", "Home"],
              ["receipts", "Receipts / Invoices"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn(
                "px-3 h-8 rounded-md text-xs font-bold",
                tab === key
                  ? "bg-amber-500 text-gray-950"
                  : "text-gray-400 hover:text-white hover:bg-gray-800",
              )}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {tab === "home" && (
            <button
              onClick={() => setEditPos((v) => !v)}
              className={cn(
                "flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-bold border",
                editPos
                  ? "bg-amber-500/20 border-amber-500 text-amber-300"
                  : "border-gray-700 text-gray-400 hover:bg-gray-800",
              )}
            >
              <Pencil className="w-3 h-3" />
              Edit POS
            </button>
          )}
          <Link
            to={`/simpos/${restaurantId}/orders`}
            className="flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-bold border border-gray-700 text-gray-400 hover:bg-gray-800"
          >
            <ScrollText className="w-3 h-3" />
            Check logs in full page
          </Link>
          <Link
            to={`/simpos/${restaurantId}/scenarios`}
            className="flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-bold border border-gray-700 text-gray-400 hover:bg-gray-800"
          >
            <FlaskConical className="w-3 h-3" />
            Scenarios
          </Link>
        </div>
      </header>

      {error && (
        <div className="mx-4 mt-3 px-3 py-2 rounded-lg bg-rose-950 border border-rose-800 text-rose-200 text-xs flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {tab === "home" ? (
        <div className="flex-1 flex flex-col gap-4 p-4 max-w-5xl mx-auto w-full">
          {/* Tables 1-20 — visible, disabled, future (C29) */}
          <div className="flex gap-1.5 overflow-x-auto pb-1 opacity-50 pointer-events-none select-none">
            {(tablesQuery.data?.length
              ? tablesQuery.data
              : Array.from({ length: 20 }, (_, i) => ({
                  id: `t${i + 1}`,
                  table_number: i + 1,
                  label: null,
                }))
            ).map((t) => (
              <div
                key={t.id}
                className="shrink-0 w-10 h-10 rounded-lg border border-gray-700 bg-gray-900 flex items-center justify-center text-[11px] font-bold text-gray-500"
              >
                {t.table_number}
              </div>
            ))}
            <span className="self-center text-[10px] text-gray-600 ml-2 whitespace-nowrap">
              Tables — coming soon
            </span>
          </div>

          {/* POS pane */}
          <section className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
              <div>
                <h2 className="text-xs font-bold uppercase tracking-wide text-gray-400">
                  Open check
                </h2>
                <p className="text-[11px] text-gray-600 font-mono mt-0.5">
                  {check?.id?.slice(0, 8) ?? "…"}
                </p>
                {/* Defect 4: a POS knows who is at the table and how many.
                    SimPOS had nowhere to put either, so pos_checks.covers,
                    .table_id and .server_name were NULL on 44 of 44 rows. */}
                <div className="flex items-center gap-1.5 mt-2">
                  <label
                    htmlFor="simpos-check-covers"
                    className="text-[10px] uppercase text-gray-600"
                  >
                    Covers
                  </label>
                  <input
                    id="simpos-check-covers"
                    type="number"
                    min={0}
                    max={200}
                    value={coversDraft}
                    onChange={(e) => setCoversDraft(e.target.value)}
                    onBlur={() => void saveCheckContext()}
                    placeholder="—"
                    title="Blank means nobody said how many guests. It is sent as null, never as 0 — a check with no cover count is not a table that seated nobody."
                    className="w-14 h-7 px-1.5 rounded-md bg-gray-950 border border-gray-700 text-xs text-gray-100 tabular-nums"
                  />
                  <label
                    htmlFor="simpos-check-server"
                    className="text-[10px] uppercase text-gray-600 ml-1"
                  >
                    Server
                  </label>
                  <input
                    id="simpos-check-server"
                    value={serverDraft}
                    onChange={(e) => setServerDraft(e.target.value)}
                    onBlur={() => void saveCheckContext()}
                    placeholder="—"
                    className="w-24 h-7 px-1.5 rounded-md bg-gray-950 border border-gray-700 text-xs text-gray-100"
                  />
                </div>
                {liveHours && (
                  <p
                    title={liveHours.title}
                    className={cn(
                      "text-[10px] font-bold uppercase mt-2 inline-block px-1.5 py-0.5 rounded",
                      liveHours.tone === "warn"
                        ? "bg-amber-950 text-amber-300"
                        : "bg-gray-800 text-gray-400",
                    )}
                  >
                    {liveHours.tone === "warn"
                      ? "Venue is closed right now"
                      : liveHours.label}
                  </p>
                )}
              </div>
              <div className="text-right">
                <p className="text-[10px] uppercase tracking-wide text-rose-400 font-bold">
                  Loss
                </p>
                <p className="text-lg font-mono font-bold text-rose-300 tabular-nums">
                  {fmtMoney(check?.lossTotal ?? 0)}
                </p>
              </div>
            </div>

            <ul className="divide-y divide-gray-800 max-h-56 overflow-y-auto font-mono text-sm">
              {!check || (check.lines?.length ?? 0) === 0 ? (
                <li className="px-4 py-8 text-center text-xs text-gray-600">
                  No items — pick from the menu below
                </li>
              ) : (
                (check.lines ?? []).map((l) => (
                  <li
                    key={l.id}
                    className={cn(
                      "px-4 py-2.5 flex items-center gap-3",
                      l.status !== "active" && "opacity-50 line-through",
                    )}
                  >
                    <span className="flex-1 truncate">
                      {l.item_name_snapshot}
                    </span>
                    <span
                      className={cn(
                        "text-[11px]",
                        venueZone ? "text-gray-500" : "text-amber-500/70",
                      )}
                      title={
                        formatVenueTime(l.added_at, venueZone, {
                          withDate: false,
                        }).title
                      }
                    >
                      {
                        formatVenueTime(l.added_at, venueZone, {
                          withDate: false,
                        }).text
                      }
                    </span>
                    <span className="tabular-nums w-16 text-right">
                      {fmtLineTotal(l.unit_price_snapshot, l.qty)}
                    </span>
                    <button
                      onClick={() => void handleVoid(l)}
                      disabled={busy}
                      className="text-[10px] font-bold uppercase text-rose-400 hover:text-rose-300"
                    >
                      {l.status === "voided" ? "Undo" : "Void"}
                    </button>
                  </li>
                ))
              )}
            </ul>

            <div className="px-4 py-3 border-t border-gray-800 flex items-center justify-between">
              <p className="text-xs text-gray-500">
                {check?.lines?.filter((l) => l.status === "active").length ?? 0}{" "}
                active line(s)
              </p>
              <button
                onClick={() => void handleOrder()}
                disabled={
                  busy ||
                  !check ||
                  (check.lines ?? []).every((l) => l.status !== "active")
                }
                className="flex items-center gap-1.5 h-10 px-5 rounded-xl bg-amber-500 hover:bg-amber-400 text-gray-950 text-sm font-bold disabled:opacity-40"
              >
                {busy ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Check className="w-4 h-4" />
                )}
                Order
              </button>
            </div>
          </section>

          {/* Menu pane OR Edit POS */}
          {editPos ? (
            <EditPosPane
              restaurantId={restaurantId}
              catalog={catalog}
              onChanged={() =>
                void qc.invalidateQueries({
                  queryKey: ["simpos-catalog", restaurantId],
                })
              }
            />
          ) : (
            <MenuPane
              wines={wines}
              onAdd={(id) => void handleAdd(id)}
              busy={busy}
            />
          )}
        </div>
      ) : (
        <div className="flex-1 p-4 max-w-5xl mx-auto w-full">
          <SimposReceiptsPane
            docs={receiptsQuery.data ?? []}
            loading={receiptsQuery.isLoading}
          />
        </div>
      )}

      <footer className="border-t border-gray-800 px-4 py-2 text-[10px] text-gray-600 flex justify-between">
        <span>Synthetic test fixture — not a Mudavym feature</span>
        <button onClick={() => navigate("/")} className="hover:text-gray-400">
          Exit to Mudavym
        </button>
      </footer>
    </div>
  );
}

function MenuPane({
  wines,
  onAdd,
  busy,
}: {
  wines: [string, SimposCatalogItem[]][];
  onAdd: (catalogId: string) => void;
  busy: boolean;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pickedVintage, setPickedVintage] = useState<number | null>(null);
  const [pickedSku, setPickedSku] = useState<string | null>(null);

  return (
    <section className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-800">
        <h2 className="text-xs font-bold uppercase tracking-wide text-gray-400">
          Menu
        </h2>
      </div>
      <ul className="divide-y divide-gray-800 max-h-[50vh] overflow-y-auto">
        {wines.length === 0 ? (
          <li className="px-4 py-8 text-center text-xs text-gray-600">
            Catalog empty — seed from inventory or use Edit POS
          </li>
        ) : (
          wines.map(([name, skus]) => {
            const open = expanded === name;
            const vintages = Array.from(
              new Set(
                skus
                  .map((s) => s.vintage)
                  .filter((v): v is number => v != null),
              ),
            ).sort((a, b) => b - a);
            const sizesForVintage = skus.filter((s) =>
              pickedVintage == null ? true : s.vintage === pickedVintage,
            );
            // With exactly one size there is no choice to make, so making the
            // operator click it is a step that exists only to be missed
            // (defect 10). The chip still renders — selected — so what will
            // ring up is visible, not implied.
            const effectiveSku =
              pickedSku ??
              (sizesForVintage.length === 1 ? sizesForVintage[0].id : null);
            return (
              <li key={name}>
                <button
                  onClick={() => {
                    setExpanded(open ? null : name);
                    setPickedVintage(null);
                    setPickedSku(null);
                  }}
                  className="w-full px-4 py-3 flex items-center gap-2 text-left hover:bg-gray-800/50"
                >
                  {open ? (
                    <ChevronDown className="w-3.5 h-3.5 text-gray-500" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 text-gray-500" />
                  )}
                  <span className="flex-1 text-sm font-semibold">{name}</span>
                  <span className="text-[11px] text-gray-500">
                    {skus.length} SKU(s)
                  </span>
                </button>
                {open && (
                  <div className="px-4 pb-3 space-y-2.5 bg-gray-950/40">
                    <div className="flex flex-wrap gap-1.5">
                      <span className="text-[10px] uppercase text-gray-500 self-center mr-1">
                        Vintage
                      </span>
                      {vintages.length === 0 ? (
                        <span className="text-[11px] text-gray-600">NV</span>
                      ) : (
                        vintages.map((v) => (
                          <button
                            key={v}
                            onClick={() => {
                              setPickedVintage(v);
                              setPickedSku(null);
                            }}
                            className={cn(
                              "h-7 px-2.5 rounded-md text-[11px] font-bold border",
                              pickedVintage === v
                                ? "bg-amber-500 text-gray-950 border-amber-500"
                                : "border-gray-700 text-gray-300 hover:bg-gray-800",
                            )}
                          >
                            {v}
                          </button>
                        ))
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <span className="text-[10px] uppercase text-gray-500 self-center mr-1">
                        Size
                      </span>
                      {sizesForVintage.map((s) => (
                        <button
                          key={s.id}
                          onClick={() => setPickedSku(s.id)}
                          className={cn(
                            "h-7 px-2.5 rounded-md text-[11px] font-bold border",
                            effectiveSku === s.id
                              ? "bg-amber-500 text-gray-950 border-amber-500"
                              : "border-gray-700 text-gray-300 hover:bg-gray-800",
                          )}
                        >
                          {s.size_ml}ml · {fmtPrice(s.price)}
                        </button>
                      ))}
                    </div>
                    {/* POS lens defect 10: this button was disabled until a
                        size chip was clicked, with nothing saying so — even
                        when the SKU had exactly one size. Now it says which
                        step is missing, and a single size is pre-selected so
                        there is no step to miss. */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => effectiveSku && onAdd(effectiveSku)}
                        disabled={!effectiveSku || busy}
                        title={
                          !effectiveSku
                            ? "Pick a size above first — the size decides which button rings up."
                            : undefined
                        }
                        className="flex items-center gap-1.5 h-9 px-3 rounded-lg bg-gray-100 text-gray-950 text-xs font-bold disabled:opacity-40"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Add item
                      </button>
                      {!effectiveSku && (
                        <span className="text-[11px] text-gray-500">
                          {sizesForVintage.length === 0
                            ? "No size on this vintage yet — add one in Edit POS."
                            : "Pick a size to enable this."}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </li>
            );
          })
        )}
      </ul>
    </section>
  );
}

function EditPosPane({
  restaurantId,
  catalog,
  onChanged,
}: {
  restaurantId: string;
  catalog: SimposCatalogItem[];
  onChanged: () => void;
}) {
  const [form, setForm] = useState({
    wineName: "",
    producer: "",
    vintage: "",
    sizeMl: "750",
    price: "",
    category: "" as SimposCategory | "",
  });
  const [busy, setBusy] = useState(false);

  const save = async () => {
    // Price is no longer required. A real POS carries buttons nobody has
    // priced yet, and forcing a number here is what produced 53 fabricated
    // $45s (defect 3). An empty field means null, not 0.
    if (!form.wineName) return;
    setBusy(true);
    try {
      await simposApi.upsertCatalogItem(restaurantId, {
        wineName: form.wineName,
        producer: form.producer || null,
        vintage: form.vintage ? Number(form.vintage) : null,
        sizeMl: Number(form.sizeMl) || 750,
        price: form.price.trim() === "" ? null : Number(form.price),
        category: form.category === "" ? null : form.category,
      });
      setForm({
        wineName: "",
        producer: "",
        vintage: "",
        sizeMl: "750",
        price: "",
        category: "",
      });
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    try {
      await simposApi.removeCatalogItem(restaurantId, id);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="bg-gray-900 border border-amber-900/40 rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-800">
        <h2 className="text-xs font-bold uppercase tracking-wide text-amber-400">
          Edit POS — drift generator
        </h2>
        <p className="text-[10px] text-gray-500 mt-0.5">
          Changes here diverge from Mudavym inventory. The drift agent finds
          them.
        </p>
      </div>

      <div className="p-4 grid grid-cols-2 sm:grid-cols-6 gap-2">
        {(
          [
            ["wineName", "Wine name", "text"],
            ["producer", "Producer", "text"],
            ["vintage", "Vintage", "number"],
            ["sizeMl", "Size ml", "number"],
            ["price", "Price (optional)", "number"],
          ] as const
        ).map(([key, label, type]) => (
          <label key={key} className="text-[10px] text-gray-500 space-y-1">
            <span>{label}</span>
            <input
              type={type}
              value={form[key]}
              onChange={(e) =>
                setForm((f) => ({ ...f, [key]: e.target.value }))
              }
              placeholder={
                key === "price" ? "leave blank if unpriced" : undefined
              }
              className="w-full h-9 px-2 rounded-lg bg-gray-950 border border-gray-700 text-sm text-gray-100"
            />
          </label>
        ))}
        {/* Defect 5: every line used to leave here declared wine, so a meze
            became a permanent "unmapped wine" in pos_unresolved_lines. */}
        <label className="text-[10px] text-gray-500 space-y-1">
          <span>Category</span>
          <select
            value={form.category}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                category: e.target.value as SimposCategory | "",
              }))
            }
            className="w-full h-9 px-2 rounded-lg bg-gray-950 border border-gray-700 text-sm text-gray-100"
          >
            <option value="">uncategorised</option>
            {SIMPOS_CATEGORY_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {c.replace("_", " ")}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="px-4 pb-3 flex items-center gap-3 flex-wrap">
        <button
          onClick={() => void save()}
          disabled={busy || !form.wineName}
          className="h-9 px-4 rounded-lg bg-amber-500 text-gray-950 text-xs font-bold disabled:opacity-40"
        >
          Add / reprice SKU
        </button>
        <span className="text-[10px] text-gray-500">
          Only a category of <b>wine</b> makes a sale deplete a bottle. Anything
          else — and "uncategorised" — rings up without touching stock.
        </span>
      </div>

      <ul className="divide-y divide-gray-800 max-h-48 overflow-y-auto border-t border-gray-800">
        {catalog.map((c) => (
          <li key={c.id} className="px-4 py-2 flex items-center gap-2 text-xs">
            <span className="flex-1 truncate">
              {c.wine_name}
              {c.vintage ? ` ${c.vintage}` : ""} · {c.size_ml}ml
            </span>
            <span
              className={cn(
                "font-mono tabular-nums",
                c.price === null && "text-amber-400/80",
              )}
              title={
                c.price === null
                  ? "Nobody has priced this button. It rings up with no money attached rather than at a made-up figure."
                  : undefined
              }
            >
              {fmtPrice(c.price)}
            </span>
            <button
              onClick={() => void remove(c.id)}
              disabled={busy}
              className="text-rose-400 hover:text-rose-300"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SimposReceiptsPane({
  docs,
  loading,
}: {
  docs: Awaited<ReturnType<typeof documentsApi.list>>;
  loading: boolean;
}) {
  return (
    <section className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-800">
        <h2 className="text-xs font-bold uppercase tracking-wide text-gray-400">
          Receipts / Invoices
        </h2>
        <p className="text-[10px] text-gray-500 mt-0.5">
          Documents this fake restaurant has generated — viewed from its own
          side
        </p>
      </div>
      {loading ? (
        <div className="flex items-center justify-center h-40 text-gray-600">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : docs.length === 0 ? (
        <div className="px-4 py-10 text-center text-xs text-gray-600">
          No documents yet
        </div>
      ) : (
        <ul className="divide-y divide-gray-800">
          {docs.map((d) => (
            <li
              key={d.id}
              className="px-4 py-3 flex items-center gap-3 text-xs"
            >
              <span className="capitalize font-semibold">
                {d.doc_type.replace("_", " ")}
              </span>
              <span className="text-gray-500">{dashNull(d.doc_number)}</span>
              <span className="text-gray-600 ml-auto">{d.status}</span>
              <span className="font-mono tabular-nums w-20 text-right">
                {d.total == null ? "—" : fmtMoney(d.total)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default SimposTerminalPage;
