import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";

/**
 * "Raise prices by a percent" (r108 menu-g9). The session's call: the raise
 * makes a NEW DRAFT menu, copied from the current one, and never edits the
 * current menu in place. The house's prices move only when an owner or a
 * manager makes that draft current through its plan (ADR 0193), so the raise
 * is seen line by line first, and the menu it came from is kept as it was to
 * go back to. Rejected: an in-place bulk PATCH (prices move with no plan and
 * no way back: a percent up and the same percent down is not the old price)
 * and a client loop over PATCH items/:id (one call per line, and a dropped
 * call leaves half a menu raised).
 *
 * The web page computes its preview with the same arithmetic
 * (apps/web/src/pages/menu/next/menu-reprice.ts mirrors this file's pure half).
 */

/** The steps a new price may be rounded to. */
export const REPRICE_STEPS = [0.01, 0.05, 0.1, 0.5, 1, 5, 10] as const;
export const REPRICE_MIN_PERCENT = -50;
export const REPRICE_MAX_PERCENT = 100;

/** A menu price is numeric(10,2): its minor unit is the column's hundredth, whatever the money. */
function toMinor(price: number): number {
  return Math.round(price * 100);
}

/**
 * One price moved by `percent` and rounded half up to `step`, in integer
 * minor units: new = roundHalfUp(old x (100+p)/100 / step) x step. The
 * percent is carried in hundredths of a percent, so 7.5 % is exact. A null
 * price stays null. A positive price that would round to nothing (4.00 -50 %
 * to the nearest 10) is kept as it was: a menu never prices a line at zero
 * by rounding.
 */
export function repricePrice(old: number | null, percent: number, step: number): number | null {
  if (old === null || old === undefined) return null;
  const value = Number(old);
  if (!Number.isFinite(value)) return old;
  const oldMinor = BigInt(toMinor(value));
  const factor = BigInt(10000 + Math.round(percent * 100));
  const stepMinor = BigInt(toMinor(step));
  const num = oldMinor * factor;
  const den = BigInt(10000) * stepMinor;
  const two = BigInt(2);
  const units = (two * num + den) / (two * den);
  const minor = Number(units * stepMinor);
  if (minor === 0 && value > 0) return value;
  return minor / 100;
}

/** What one line becomes, and how it counts. */
export type RepriceOutcome = "changed" | "unchanged" | "held_other_money";

export interface RepriceLineIn {
  category?: string | null;
  by_glass_price?: number | null;
  bottle_price?: number | null;
  price_flag?: string | null;
}

/** A line's section as the chooser names it: its category, or "" for a line with none. */
export function sectionOf(line: { category?: string | null }): string {
  return line.category ?? "";
}

/**
 * The new prices of one line. A line whose price the menu holds in another
 * money (#1543's `other_currency` flag) is copied as it is and counted apart;
 * a line outside the chosen sections is copied as it is.
 */
export function repriceLine(
  line: RepriceLineIn,
  percent: number,
  step: number,
  sections?: readonly string[] | null,
): { by_glass_price: number | null; bottle_price: number | null; outcome: RepriceOutcome } {
  const glass = line.by_glass_price ?? null;
  const bottle = line.bottle_price ?? null;
  if (line.price_flag === "other_currency") {
    return { by_glass_price: glass, bottle_price: bottle, outcome: "held_other_money" };
  }
  if (sections && !sections.includes(sectionOf(line))) {
    return { by_glass_price: glass, bottle_price: bottle, outcome: "unchanged" };
  }
  const g = repricePrice(glass, percent, step);
  const b = repricePrice(bottle, percent, step);
  const moved = (a: number | null, z: number | null) => a !== null && z !== null && Number(a) !== Number(z);
  return { by_glass_price: g, bottle_price: b, outcome: moved(glass, g) || moved(bottle, b) ? "changed" : "unchanged" };
}

/** "+10%", "+7.5%", "-5%". */
export function percentWords(percent: number): string {
  return `${percent > 0 ? "+" : ""}${Number(percent.toFixed(2))}%`;
}

/** The refusal in words for a percent or a step out of bounds; null when both are fine. */
export function repriceRefusal(percent: unknown, roundTo: unknown): string | null {
  if (typeof percent !== "number" || !Number.isFinite(percent)) return "Say the percent as a number, for example 10 or -5.";
  if (percent === 0) return "A change of 0% changes nothing, so no draft was made.";
  if (percent < REPRICE_MIN_PERCENT || percent > REPRICE_MAX_PERCENT) {
    return `A percent from ${REPRICE_MIN_PERCENT} to +${REPRICE_MAX_PERCENT} can be used; ${percent} cannot.`;
  }
  if (Math.abs(percent * 100 - Math.round(percent * 100)) > 1e-6) return "A percent can have at most two decimals.";
  if (typeof roundTo !== "number" || !(REPRICE_STEPS as readonly number[]).includes(roundTo)) {
    return `Round to one of ${REPRICE_STEPS.join(", ")}.`;
  }
  return null;
}

// ── The copy ────────────────────────────────────────────────────────────────

export const REPRICE_PAGE_ROWS = 1000;
export const REPRICE_INSERT_BATCH = 500;

/** What the reprice call answers. */
export interface RepriceReply {
  menuId: string;
  name: string;
  changed: number;
  unchanged: number;
  heldOtherMoney: number;
}

/** The columns a line's copy must not carry over: its own id, its menu, and when it was made. */
const NOT_COPIED = new Set(["id", "menu_id", "created_at"]);

type Db = { from: (table: string) => any };

/**
 * Copies the house's current menu `menuId` into a new draft with its prices
 * moved. The menu read and every line read name the house, so another
 * house's menu id is the same 404 as a missing one (ADR 0147). Lines are read
 * keyset-paged on id, PAGE_ROWS at a time, so a menu past 1000 lines is copied
 * whole, and inserted in batches. Nothing on the current menu is written. A
 * failed write takes the half-made draft away again; it never stays as a
 * shorter menu.
 */
export async function repriceIntoDraft(
  sb: Db,
  input: { restaurantId: string; menuId: string; userId: string; percent: number; roundTo: number; sections?: string[] | null },
  log: { error: (m: string) => void } = { error: () => undefined },
): Promise<RepriceReply> {
  const refusal = repriceRefusal(input.percent, input.roundTo);
  if (refusal) throw new BadRequestException(refusal);
  const { restaurantId, menuId, userId, percent, roundTo } = input;
  const sections = input.sections && input.sections.length > 0 ? input.sections : null;

  const { data: menu, error: menuErr } = await sb
    .from("restaurant_menus")
    .select("id, name, status, menu_type, cadence")
    .eq("id", menuId)
    .eq("restaurant_id", restaurantId)
    .maybeSingle();
  if (menuErr) {
    throw new InternalServerErrorException(`The menu could not be read just now, so no draft was made (${menuErr.message}).`);
  }
  if (!menu) throw new NotFoundException("Menu not found");
  if (menu.status !== "active") {
    throw new ConflictException("Only the current menu's prices can be raised. Nothing was made.");
  }

  const lines: Array<Record<string, unknown>> = [];
  let after: string | null = null;
  for (;;) {
    let q = sb
      .from("menu_items")
      .select("*")
      .eq("menu_id", menuId)
      .eq("restaurant_id", restaurantId)
      .neq("status", "discarded");
    if (after) q = q.gt("id", after);
    const { data, error } = await q.order("id", { ascending: true }).limit(REPRICE_PAGE_ROWS);
    if (error) {
      throw new InternalServerErrorException(`The menu's lines could not be read just now, so no draft was made (${error.message}).`);
    }
    const page = (data ?? []) as Array<Record<string, unknown>>;
    lines.push(...page);
    if (page.length < REPRICE_PAGE_ROWS) break;
    after = String(page[page.length - 1].id);
  }

  const name = `${menu.name ?? "The current menu"}, prices ${percentWords(percent)}`;
  const counts = { changed: 0, unchanged: 0, heldOtherMoney: 0 };
  const rows = lines.map((line) => {
    const moved = repriceLine(line as RepriceLineIn, percent, roundTo, sections);
    if (moved.outcome === "changed") counts.changed += 1;
    else if (moved.outcome === "held_other_money") counts.heldOtherMoney += 1;
    else counts.unchanged += 1;
    const copy: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(line)) if (!NOT_COPIED.has(k)) copy[k] = v;
    return { ...copy, restaurant_id: restaurantId, by_glass_price: moved.by_glass_price, bottle_price: moved.bottle_price };
  });

  const now = new Date().toISOString();
  const { data: draft, error: draftErr } = await sb
    .from("restaurant_menus")
    .insert({
      restaurant_id: restaurantId,
      name,
      menu_type: menu.menu_type ?? "beverage",
      status: "draft",
      read_state: "done",
      cadence: menu.cadence ?? null,
      source_method: "manual",
      lines_extracted: rows.length,
      extracted_by: userId,
      extracted_at: now,
    })
    .select("id")
    .single();
  if (draftErr || !draft) {
    throw new InternalServerErrorException(
      `The draft could not be made, so nothing changed (${draftErr?.message ?? "no row returned"}).`,
    );
  }
  const draftId = String(draft.id);

  for (let i = 0; i < rows.length; i += REPRICE_INSERT_BATCH) {
    const batch = rows.slice(i, i + REPRICE_INSERT_BATCH).map((r) => ({ ...r, menu_id: draftId }));
    const { error } = await sb.from("menu_items").insert(batch);
    if (error) {
      await dropHalfMadeDraft(sb, restaurantId, draftId, log);
      throw new InternalServerErrorException(
        `The draft's lines could not all be written, so the draft was taken away and nothing changed (${error.message}).`,
      );
    }
  }
  return { menuId: draftId, name, ...counts };
}

async function dropHalfMadeDraft(sb: Db, restaurantId: string, draftId: string, log: { error: (m: string) => void }) {
  const lines = await sb.from("menu_items").delete().eq("menu_id", draftId).eq("restaurant_id", restaurantId);
  const menu = await sb
    .from("restaurant_menus")
    .delete()
    .eq("id", draftId)
    .eq("restaurant_id", restaurantId)
    .eq("status", "draft");
  const failure = lines?.error?.message ?? menu?.error?.message;
  if (failure) log.error(`menu ${draftId}: a half-made repriced draft could not be removed: ${failure}`);
}
