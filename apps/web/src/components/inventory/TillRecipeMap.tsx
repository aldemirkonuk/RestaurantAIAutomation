/**
 * Till button -> drink recipe. The screen that did not exist.
 *
 * `pos_item_mappings.cocktail_id` names the drink recipe a till button sells,
 * and a sale of such a button draws the recipe's goods. Nothing a person could
 * reach wrote it: the SPA's mapping panel only ever answered "which wine is
 * this button". This section lists the house's till buttons (every mapped one,
 * and every one that rang up and matched nothing), shows what each draws today,
 * and lets a person pick one of the house's own recipes for it, search by name,
 * or take the recipe off again. The link is per house: the gateway refuses
 * another house's recipe.
 *
 * It does not move a button off a shelf item without saying so and asking: a
 * button draws one thing, so a recipe replaces the item and the sale stops
 * drawing it.
 *
 * A dish cannot be linked here. Dishes have no sale-draw yet, so a link would
 * look saved and move nothing; the section says so rather than offering it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  getHouseCocktails,
  setTillRecipe,
  type HouseCocktail,
  type PosItemMapping,
  type UnresolvedLineGroup,
} from "../../services/api/posHub";
import { cn } from "../../lib/utils";

interface Props {
  restaurantId?: string;
  /** null = the mappings could not be read (`mappingsError` says why). */
  mappings: PosItemMapping[] | null;
  mappingsError: string | null;
  /** Buttons that rang up and matched nothing. */
  seen: UnresolvedLineGroup[];
  /** Shelf item names, so a button that draws one is named. */
  shelfName: (inventoryId: string) => string | null;
  onChanged?: () => void;
}

interface Button {
  key: string;
  source: string;
  external_item_id: string;
  item_name: string;
  category: string | null;
  cocktail_id: string | null;
  inventory_id: string | null;
}

const MAX_SHOWN = 50;

function errText(e: unknown): string {
  const anyE = e as {
    response?: { data?: { message?: string } };
    message?: string;
  };
  // The transport's own words ("Network Error") say nothing to a person: the
  // request never got an answer, so say that (as /dishes does).
  const sent = e as { code?: unknown; response?: unknown };
  if (!anyE?.response?.data?.message && sent?.code === "ERR_NETWORK" && !sent.response) {
    return "Mudavym could not be reached just now.";
  }
  return anyE?.response?.data?.message || anyE?.message || "Request failed";
}

const keyOf = (source: string, ext: string, name: string) =>
  `${source}\u0000${ext}\u0000${name}`;

export function TillRecipeMap({
  restaurantId,
  mappings,
  mappingsError,
  seen,
  shelfName,
  onChanged,
}: Props) {
  const [names, setNames] = useState<{
    data: HouseCocktail[] | null;
    truncated: boolean;
    error: string | null;
  }>({ data: null, truncated: false, error: null });
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [term, setTerm] = useState("");
  const [found, setFound] = useState<{
    rows: HouseCocktail[];
    error: string | null;
    loading: boolean;
  }>({ rows: [], error: null, loading: false });
  const [confirm, setConfirm] = useState<HouseCocktail | null>(null);
  const [busy, setBusy] = useState(false);
  const ask = useRef(0);

  useEffect(() => {
    let live = true;
    getHouseCocktails(restaurantId)
      .then((r) => {
        if (live)
          setNames({ data: r.rows, truncated: r.truncated, error: null });
      })
      .catch((e) => {
        if (live) setNames({ data: null, truncated: false, error: errText(e) });
      });
    return () => {
      live = false;
    };
  }, [restaurantId]);

  // The picker's own search: the house's recipes, narrowed by what is typed.
  useEffect(() => {
    if (open === null) return;
    const mine = ++ask.current;
    setFound((f) => ({ ...f, loading: true }));
    const t = setTimeout(() => {
      getHouseCocktails(restaurantId, term, 20)
        .then((r) => {
          if (mine === ask.current)
            setFound({ rows: r.rows, error: null, loading: false });
        })
        .catch((e) => {
          if (mine === ask.current)
            setFound({ rows: [], error: errText(e), loading: false });
        });
    }, 200);
    return () => clearTimeout(t);
  }, [open, term, restaurantId]);

  const buttons = useMemo<Button[]>(() => {
    const out = new Map<string, Button>();
    for (const g of seen) {
      if (g.reason === "no_sale_volume") continue;
      const k = keyOf(g.source, g.external_item_id ?? "", g.item_name);
      out.set(k, {
        key: k,
        source: g.source,
        external_item_id: g.external_item_id ?? "",
        item_name: g.item_name,
        category: null,
        cocktail_id: null,
        inventory_id: null,
      });
    }
    for (const m of mappings ?? []) {
      const k = keyOf(m.source, m.external_item_id ?? "", m.item_name ?? "");
      out.set(k, {
        key: k,
        source: m.source,
        external_item_id: m.external_item_id ?? "",
        item_name: m.item_name ?? "",
        category: m.category ?? null,
        cocktail_id: m.cocktail_id ?? null,
        inventory_id: m.inventory_id ?? null,
      });
    }
    return [...out.values()].sort((a, b) =>
      a.item_name.localeCompare(b.item_name),
    );
  }, [mappings, seen]);

  const nameOf = useCallback(
    (id: string): string => {
      const hit = names.data?.find((c) => c.id === id);
      if (hit) return hit.display_name || hit.name;
      return names.error
        ? "a recipe (its name could not be read)"
        : names.truncated
          ? "a recipe (not in the first 200)"
          : "a recipe (no longer in the house's list)";
    },
    [names],
  );

  const shown = buttons.filter((b) =>
    b.item_name.toLowerCase().includes(filter.trim().toLowerCase()),
  );

  const save = async (b: Button, recipe: HouseCocktail | null) => {
    setBusy(true);
    try {
      await setTillRecipe(
        {
          source: b.source,
          external_item_id: b.external_item_id,
          item_name: b.item_name,
          category: b.category,
          cocktail_id: recipe?.id ?? null,
          replace_shelf_link: b.inventory_id !== null && recipe !== null,
        },
        restaurantId,
      );
      toast.success(
        recipe
          ? `${b.item_name} now draws ${recipe.display_name || recipe.name}.`
          : `${b.item_name} no longer draws a recipe.`,
      );
      setOpen(null);
      setConfirm(null);
      setTerm("");
      onChanged?.();
    } catch (e) {
      toast.error(`Could not save the link: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const pick = (b: Button, recipe: HouseCocktail) => {
    if (b.inventory_id) setConfirm(recipe);
    else void save(b, recipe);
  };

  const drawsText = (b: Button): string => {
    if (b.cocktail_id) return `Draws the recipe ${nameOf(b.cocktail_id)}`;
    if (b.inventory_id)
      return `Draws the shelf item ${shelfName(b.inventory_id) ?? "(not in the list)"}`;
    return "Draws nothing yet";
  };

  return (
    <section aria-label="Till buttons and drink recipes">
      <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
        <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">
          Till buttons → drink recipes
        </h3>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Find a till button"
          aria-label="Find a till button"
          className="h-8 w-56 rounded-lg border border-gray-200 px-2.5 text-xs"
        />
      </div>
      <p className="text-[11px] text-gray-500 mb-2">
        A button that names a drink recipe draws that recipe's goods when it
        sells. Dishes cannot be linked to a button yet: a dish sale draws
        nothing, so a link would look saved and move no stock.
      </p>

      {mappingsError && (
        <p className="text-xs font-semibold text-amber-700 mb-2">
          The till buttons could not be read ({mappingsError}) — not the same as
          having none.
        </p>
      )}
      {names.error && (
        <p className="text-xs font-semibold text-amber-700 mb-2">
          The house's drink recipes could not be read ({names.error}), so
          recipe names may be missing.
        </p>
      )}
      {!mappingsError && buttons.length === 0 && (
        <p className="text-xs text-gray-400">
          No till buttons have been read yet. "Re-read POS catalog" pulls them.
        </p>
      )}

      <div className="space-y-1.5">
        {shown.slice(0, MAX_SHOWN).map((b) => (
          <div
            key={b.key}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2"
          >
            <div className="flex items-center gap-3 flex-wrap">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-gray-900">
                  {b.item_name || "(unnamed button)"}
                </div>
                <div
                  className={cn(
                    "text-[11px]",
                    b.cocktail_id ? "text-wine-700" : "text-gray-500",
                  )}
                >
                  {drawsText(b)}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => {
                    setOpen(open === b.key ? null : b.key);
                    setTerm("");
                    setConfirm(null);
                  }}
                  disabled={busy}
                  className="h-7 px-2.5 rounded-md text-[11px] font-bold border border-gray-200 bg-white text-gray-600 hover:border-gray-300 disabled:opacity-50"
                >
                  {b.cocktail_id ? "Change recipe" : "Pick a recipe"}
                </button>
                {b.cocktail_id && (
                  <button
                    onClick={() => void save(b, null)}
                    disabled={busy}
                    className="h-7 px-2.5 rounded-md text-[11px] font-bold border border-gray-200 bg-white text-gray-600 hover:border-gray-300 disabled:opacity-50"
                  >
                    Take the recipe off
                  </button>
                )}
              </div>
            </div>

            {open === b.key && (
              <div className="mt-2 border-t border-gray-100 pt-2">
                <input
                  autoFocus
                  value={term}
                  onChange={(e) => setTerm(e.target.value)}
                  placeholder="Search the house's recipes"
                  aria-label="Search the house's recipes"
                  className="h-8 w-full rounded-lg border border-gray-200 px-2.5 text-xs"
                />
                {found.error && (
                  <p className="mt-1 text-[11px] font-semibold text-amber-700">
                    The recipes could not be read ({found.error}) — not the same
                    as having none.
                  </p>
                )}
                {!found.error && found.loading && (
                  <p className="mt-1 text-[11px] text-gray-400">
                    <Loader2 className="inline w-3 h-3 animate-spin mr-1" />
                    Reading the recipes…
                  </p>
                )}
                {!found.error && !found.loading && found.rows.length === 0 && (
                  <p className="mt-1 text-[11px] text-gray-400">
                    {term.trim()
                      ? "No recipe of the house's has that name."
                      : "The house has no drink recipes yet."}
                  </p>
                )}
                <ul className="mt-1 space-y-1">
                  {found.rows.map((c) => (
                    <li key={c.id}>
                      <button
                        onClick={() => pick(b, c)}
                        disabled={busy}
                        className="w-full text-left rounded-md border border-gray-100 px-2.5 py-1.5 text-xs hover:bg-gray-50 disabled:opacity-50"
                      >
                        <span className="font-semibold text-gray-900">
                          {c.display_name || c.name}
                        </span>
                        {c.menu_section && (
                          <span className="ml-2 text-gray-400">
                            {c.menu_section}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
                {confirm && b.inventory_id && (
                  <div className="mt-2 rounded-md bg-amber-50 border border-amber-200 px-2.5 py-2 text-[11px] text-amber-800">
                    This button draws the shelf item{" "}
                    <b>{shelfName(b.inventory_id) ?? "(not in the list)"}</b>{" "}
                    today. Moving it to{" "}
                    <b>{confirm.display_name || confirm.name}</b> stops that:
                    its sales will draw the recipe's goods instead.
                    <div className="mt-1.5 flex gap-1.5">
                      <button
                        onClick={() => void save(b, confirm)}
                        disabled={busy}
                        className="h-7 px-2.5 rounded-md bg-wine-600 text-white text-[11px] font-bold disabled:opacity-50"
                      >
                        Move it to the recipe
                      </button>
                      <button
                        onClick={() => setConfirm(null)}
                        className="h-7 px-2.5 rounded-md border border-gray-200 bg-white text-gray-600 text-[11px] font-bold"
                      >
                        Keep the shelf item
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      {shown.length > MAX_SHOWN && (
        <p className="mt-1.5 text-[11px] text-gray-500">
          Showing {MAX_SHOWN} of {shown.length} buttons — type in the box to
          narrow them.
        </p>
      )}
    </section>
  );
}

export default TillRecipeMap;
