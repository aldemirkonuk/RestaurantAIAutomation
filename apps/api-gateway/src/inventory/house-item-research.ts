/**
 * A house item the wine library does not have waits for research, by its id.
 *
 * THE FOUNDER, 2026-09-21 (verbatim; ADR 0192's amendment carries the whole
 * answer): *"book the stock anyway, and if it's not on the maser wine that
 * means that wine needs research treatment with fully in depth analysis to add
 * to the master wine. If its found that it s nowhere to be found, like wine 1
 * and wine 2 and such, then we skip it and flag it."* And: *"When making a
 * search in the db tho, while not the name but the UUID or the deeper id is
 * being searched(bith better for lookup times) not the name."*
 *
 * So:
 *   - The row is keyed by the HOUSE ITEM'S ID (`restaurant_inventory.id`) and
 *     every read and write here finds it by that id and the house's id. The
 *     name is read off the item, by id, only to decide whether it can identify
 *     a wine at all.
 *   - A name that cannot identify a wine ("wine 1", "Wine 2", "house red", a
 *     blank) is `not_findable` at once — skipped, not researched — and the house
 *     sees the flag below. Anything else is `queued`.
 *   - A row research has already `matched` is never moved back by a rename.
 *
 * WHAT CONSUMES `queued` ROWS: nothing yet, stated plainly. The research agent
 * (`services/agent-orchestrator/jobs/research_tasks.py`) reads
 * `master_wine_library_submissions` joined to a LIBRARY row, which this item
 * does not have; the submission chain (`haiku_enrich_task` ->
 * `web_verify_task`) runs per submission id, is dispatched only from
 * onboarding imports, and keys a submission by its payload (a name). Wiring
 * a consumer to this table is an open founder question (lane E round 3
 * report; ADR 0163 is Proposed).
 *
 * Table: `house_item_research` (20260921170500).
 */

/** The flag the house sees on an item whose name cannot identify a wine (lane brief, 2026-09-21). */
export const NAME_THIS_WINE_FLAG =
  "Tell us which wine this is and we can help you build better menus and promotions";

export type HouseItemResearchStatus = "queued" | "matched" | "not_findable";

export type NameVerdict =
  | { findable: true }
  | { findable: false; reason: string };

/**
 * Words that name a KIND of wine, never a wine. English and Turkish (the one
 * live house is in Turkey), compared after `foldName`.
 */
const GENERIC_NOUNS = [
  "wine",
  "wines",
  "bottle",
  "item",
  "product",
  "sku",
  "sarap",
  "urun",
  "sise",
  "test",
  "unknown",
  "misc",
  "other",
  "tbd",
  "tba",
  "na",
  "n a",
  "none",
  "untitled",
  "placeholder",
  "sample",
  "new",
  "new wine",
  "new item",
  "yeni",
  "yeni sarap",
];

const STYLE_WORDS = [
  "red",
  "white",
  "rose",
  "blush",
  "sparkling",
  "bubbly",
  "fizz",
  "orange",
  "dessert",
  "sweet",
  "dry",
  "fortified",
  "kirmizi",
  "beyaz",
  "roze",
  "kopuklu",
  "tatli",
  "sek",
];

/** Lower-case, accents and Turkish letters folded, punctuation to spaces, spaces collapsed. */
export function foldName(raw: string): string {
  return raw
    .toLocaleLowerCase("en-US")
    .replace(/ı/g, "i")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const alt = (words: string[]) => words.map((w) => w.replace(/ /g, "\\s")).join("|");

/**
 * A counter: digits written apart or glued on ("wine 1", "Wine1", "wine01",
 * "wine 1a"), or one letter written apart ("sample b"). [Last call,
 * 2026-09-21: the glued form "Wine1" was researched as a wine.]
 */
const COUNTER = `(?:\\s?\\d+[a-z]?|\\s[a-z])`;

/** "wine", "wine 1", "Wine #2", "Wine1", "item 14", "şarap 3", "sample b" — a generic noun and at most a counter. */
const GENERIC_WITH_COUNTER = new RegExp(
  `^(?:${alt(GENERIC_NOUNS)})(?:\\s(?:no|nr|num))?${COUNTER}?$`,
);

/**
 * "red", "house red", "red wine", "house white wine 2", "ev şarabı",
 * "kırmızı şarap", "rosé 2021": a style, optionally "house"/"ev", optionally
 * "wine"/"şarap", optionally a counter or a year. A style and a year name no
 * producer, so they cannot identify one wine either.
 */
const STYLE_ONLY = new RegExp(
  `^(?:(?:house|ev|our|the)\\s)?(?:(?:${alt(STYLE_WORDS)})\\s)?(?:${alt(STYLE_WORDS)}|wine|sarap|sarabi)(?:\\s(?:wine|sarap|sarabi))?${COUNTER}?$`,
);

/**
 * Whether a house item's name can identify a wine. A classifier, not a
 * matcher: it never says WHICH wine, only whether the name is a placeholder
 * that research could not resolve. Kept narrow on purpose — a false
 * "not findable" hides a real wine from research, so anything that is not
 * plainly a placeholder is researchable.
 */
export function classifyHouseItemName(name: string | null | undefined): NameVerdict {
  const raw = (name ?? "").trim();
  if (raw.length === 0) {
    return { findable: false, reason: "The item has no name, so it cannot be looked up." };
  }
  const folded = foldName(raw);
  // A name in a script this rule does not read (Greek "Ξινόμαυρο", Cyrillic
  // "Саперави", Georgian, Japanese) is never judged a placeholder: folding
  // drops those letters, and judging what is left would hide a real wine
  // from research. [Last call, 2026-09-21: such a name read as "no words in
  // it" and was flagged.] Counted after the same case and accent fold, so
  // Turkish and accented Latin letters are not "unread".
  const letters = (raw.toLocaleLowerCase("en-US").normalize("NFD").replace(/\p{M}/gu, "").match(/\p{L}/gu) ?? [])
    .length;
  if (letters > folded.replace(/[^a-z]/g, "").length) {
    return { findable: true };
  }
  if (folded.replace(/[^a-z]/g, "").length < 2) {
    return {
      findable: false,
      reason: `The name "${raw}" has no words in it, so it does not say which wine this is.`,
    };
  }
  if (GENERIC_WITH_COUNTER.test(folded) || STYLE_ONLY.test(folded)) {
    return {
      findable: false,
      reason: `The name "${raw}" is a placeholder: it does not say which wine this is, so it was not sent for research.`,
    };
  }
  return { findable: true };
}

// ---------------------------------------------------------------------------
// The queue row, read and written by the item's id
// ---------------------------------------------------------------------------

export interface HouseItemResearchRow {
  id: string;
  restaurant_id: string;
  inventory_id: string;
  status: HouseItemResearchStatus;
  reason: string;
  matched_master_wine_id: string | null;
  queued_from: "delivery" | "rename";
  source_order_id: string | null;
  queued_by: string | null;
  created_at: string;
  updated_at: string;
}

export const HOUSE_ITEM_RESEARCH_COLUMNS =
  "id, restaurant_id, inventory_id, status, reason, matched_master_wine_id, queued_from, source_order_id, queued_by, created_at, updated_at";

export type EnqueueOutcome =
  | { ok: true; status: HouseItemResearchStatus; reason: string; changed: boolean }
  | { ok: false; error: string };

type Client = {
  from: (table: string) => any;
};

/**
 * Put a house item on the research queue, or re-decide the row it already
 * has, from the name it carries NOW. Idempotent: one row per item (a unique
 * index), and a second delivery of the same item finds its row by the item's
 * id. A `matched` row is left alone. Never throws for a database answer: the
 * outcome says what happened, and a failure is `ok:false` with the reason, so
 * the caller decides whether that refuses its own act.
 */
export async function enqueueHouseItemResearch(
  client: Client,
  input: {
    restaurantId: string;
    inventoryId: string;
    name: string | null;
    queuedFrom: "delivery" | "rename";
    sourceOrderId: string | null;
    queuedBy: string | null;
  },
): Promise<EnqueueOutcome> {
  try {
    const verdict = classifyHouseItemName(input.name);
    const status: HouseItemResearchStatus = verdict.findable ? "queued" : "not_findable";
    const reason = verdict.findable
      ? "This wine is not in the wine library yet, so it waits for research by its item id."
      : verdict.reason;

    const { data: existing, error: readError } = await client
      .from("house_item_research")
      .select(HOUSE_ITEM_RESEARCH_COLUMNS)
      .eq("restaurant_id", input.restaurantId)
      .eq("inventory_id", input.inventoryId)
      .maybeSingle();
    if (readError) {
      return { ok: false, error: `the research queue could not be read (${readError.message})` };
    }

    if (existing) {
      const row = existing as HouseItemResearchRow;
      if (row.status === "matched") {
        return { ok: true, status: "matched", reason: row.reason, changed: false };
      }
      if (row.status === status && row.reason === reason) {
        return { ok: true, status, reason, changed: false };
      }
      const { data: updated, error: updateError } = await client
        .from("house_item_research")
        .update({ status, reason, queued_from: input.queuedFrom })
        .eq("id", row.id)
        .eq("restaurant_id", input.restaurantId)
        .neq("status", "matched")
        .select("id");
      if (updateError) {
        return { ok: false, error: `the research queue could not be updated (${updateError.message})` };
      }
      if (!Array.isArray(updated) || updated.length === 0) {
        // Research matched it between the read and the write: that answer stands.
        return { ok: true, status: "matched", reason: row.reason, changed: false };
      }
      return { ok: true, status, reason, changed: true };
    }

    const { error: insertError } = await client.from("house_item_research").insert({
      restaurant_id: input.restaurantId,
      inventory_id: input.inventoryId,
      status,
      reason,
      queued_from: input.queuedFrom,
      source_order_id: input.sourceOrderId,
      queued_by: input.queuedBy,
    });
    if (insertError) {
      if ((insertError as { code?: string }).code === "23505") {
        // Another request queued the same item a moment ago; one row per item.
        return { ok: true, status, reason, changed: false };
      }
      return { ok: false, error: `the item could not be queued for research (${insertError.message})` };
    }
    return { ok: true, status, reason, changed: true };
  } catch (err: any) {
    return { ok: false, error: `the research queue could not be written (${err?.message ?? String(err)})` };
  }
}

/** What the house sees per item: the status, the reason and, for a placeholder, the flag. */
export interface HouseItemResearchView {
  inventoryId: string;
  status: HouseItemResearchStatus;
  reason: string;
  flag: string | null;
  updatedAt: string;
}

export function presentHouseItemResearch(row: HouseItemResearchRow): HouseItemResearchView {
  return {
    inventoryId: row.inventory_id,
    status: row.status,
    reason: row.reason,
    flag: row.status === "not_findable" ? NAME_THIS_WINE_FLAG : null,
    updatedAt: row.updated_at,
  };
}

/** This house's research rows. A failed read THROWS: it is never an empty list. */
export async function readHouseItemResearch(
  client: Client,
  restaurantId: string,
): Promise<HouseItemResearchView[]> {
  const { data, error } = await client
    .from("house_item_research")
    .select(HOUSE_ITEM_RESEARCH_COLUMNS)
    .eq("restaurant_id", restaurantId)
    .order("updated_at", { ascending: false });
  if (error) {
    throw new Error(`Which wines wait for research could not be read (${error.message}).`);
  }
  return ((data ?? []) as HouseItemResearchRow[]).map(presentHouseItemResearch);
}
