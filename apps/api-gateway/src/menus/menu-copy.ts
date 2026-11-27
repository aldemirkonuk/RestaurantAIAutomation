import { ConflictException, InternalServerErrorException, NotFoundException } from "@nestjs/common";

/**
 * Copies the house's CURRENT menu into a new draft (r108 menu-g9's copy, made
 * its own step in r109 menu-g5). Two callers: "Raise prices by a percent"
 * (menu-reprice.ts, a price transform) and "Edit as a new draft" (the
 * identity). The current menu and the house's prices are never written: they
 * move only when the draft is made current through its plan (ADR 0193).
 *
 * The menu read and every line read name the house, so another house's menu
 * id is the same 404 as a missing one (ADR 0147). Lines are read keyset-paged
 * on id, COPY_PAGE_ROWS at a time, so a menu past 1000 lines is copied whole,
 * and inserted in batches. A failed write takes the half-made draft away
 * again; it never stays as a shorter menu. The draft's `extracted_at` is the
 * copy moment, so its plan names every price a person set after the copy.
 */

export const COPY_PAGE_ROWS = 1000;
export const COPY_INSERT_BATCH = 500;

/** The columns a line's copy must not carry over: its own id, its menu, and when it was made. */
const NOT_COPIED = new Set(["id", "menu_id", "created_at"]);

type Db = { from: (table: string) => any };

/** The fields a transform replaces on one copied line. */
export type LineTransform = (line: Record<string, unknown>) => Record<string, unknown>;

export interface CopyInput {
  restaurantId: string;
  menuId: string;
  userId: string;
  /** The draft's name, from the current menu's. */
  name: (currentName: string | null) => string;
  /** Said when the menu is kept but not current (409). */
  notCurrent: string;
}

export async function copyIntoDraft(
  sb: Db,
  input: CopyInput,
  transform: LineTransform,
  log: { error: (m: string) => void } = { error: () => undefined },
): Promise<{ menuId: string; name: string; lines: number; copiedAt: string }> {
  const { restaurantId, menuId, userId } = input;
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
  if (menu.status !== "active") throw new ConflictException(input.notCurrent);

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
    const { data, error } = await q.order("id", { ascending: true }).limit(COPY_PAGE_ROWS);
    if (error) {
      throw new InternalServerErrorException(`The menu's lines could not be read just now, so no draft was made (${error.message}).`);
    }
    const page = (data ?? []) as Array<Record<string, unknown>>;
    lines.push(...page);
    if (page.length < COPY_PAGE_ROWS) break;
    after = String(page[page.length - 1].id);
  }

  const name = input.name((menu.name as string | null) ?? null);
  const rows = lines.map((line) => {
    // The transform's fields first, then the strip: an identity transform
    // hands the line back whole, and its id, menu and birth must still go.
    const copy: Record<string, unknown> = {};
    for (const [k, v] of Object.entries({ ...line, ...transform(line) })) if (!NOT_COPIED.has(k)) copy[k] = v;
    return { ...copy, restaurant_id: restaurantId };
  });

  const copiedAt = new Date().toISOString();
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
      extracted_at: copiedAt,
    })
    .select("id")
    .single();
  if (draftErr || !draft) {
    throw new InternalServerErrorException(
      `The draft could not be made, so nothing changed (${draftErr?.message ?? "no row returned"}).`,
    );
  }
  const draftId = String(draft.id);

  for (let i = 0; i < rows.length; i += COPY_INSERT_BATCH) {
    const batch = rows.slice(i, i + COPY_INSERT_BATCH).map((r) => ({ ...r, menu_id: draftId }));
    const { error } = await sb.from("menu_items").insert(batch);
    if (error) {
      await dropHalfMadeDraft(sb, restaurantId, draftId, log);
      throw new InternalServerErrorException(
        `The draft's lines could not all be written, so the draft was taken away and nothing changed (${error.message}).`,
      );
    }
  }
  return { menuId: draftId, name, lines: rows.length, copiedAt };
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
  if (failure) log.error(`menu ${draftId}: a half-made draft could not be removed: ${failure}`);
}

/** The house's day, on its own clock, for a draft's name; a zone not recorded says UTC, never a guess. */
export function houseDayWords(at: Date, timezone: string | null): string {
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" };
  if (timezone) {
    try {
      return new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: timezone }).format(at);
    } catch {
      /* an unknown zone falls through to UTC, said as UTC */
    }
  }
  return `${new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: "UTC" }).format(at)} UTC`;
}
