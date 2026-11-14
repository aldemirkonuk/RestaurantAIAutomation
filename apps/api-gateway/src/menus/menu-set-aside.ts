import { ConflictException, InternalServerErrorException, NotFoundException } from "@nestjs/common";

/**
 * Setting a kept menu aside, and bringing it back (r36 menu audit N9, r40
 * 2026-11-14; migration 20271118141300_a_kept_menu_can_be_set_aside.sql).
 *
 * Every read is kept on purpose, so a misread photo, a test file or a menu
 * read twice stayed under "Menus kept" for good, each with its own "Make
 * current". Setting one aside keeps its row and every line as they are and
 * says who and when; the list folds it away, and it cannot be made current
 * until it is brought back. Nothing is deleted, here or anywhere.
 *
 * The current menu is never set aside (the house sells from it): the gateway
 * says so, and a CHECK holds it for any other writer.
 *
 * The house reads "put away" (/menu, #1640): /menu already says "set aside"
 * of the menus that choosing a menu archives, so the sentences here use the
 * page's word, while the columns and routes keep the audit's name.
 */

/** What setting aside or bringing back did, in the house's words. */
export interface SetAsideResult {
  menuId: string;
  setAside: boolean;
  setAsideAt: string | null;
  /** false when the menu already was as asked: nothing was written. */
  changed: boolean;
  said: string;
}

/** The supabase client, as far as this file uses it. */
type Db = { from: (table: string) => any };

const ROW = "id, status, set_aside_at";
const NOTHING = "Nothing was changed.";

const SAID_ASIDE =
  "Put away. Its file and lines are kept as they were read; bring it back from Put away to make it current again.";
const SAID_BACK = "Brought back. It can be made current again.";

async function readRow(db: Db, restaurantId: string, menuId: string): Promise<Record<string, any>> {
  const { data, error } = await db
    .from("restaurant_menus")
    .select(ROW)
    .eq("id", menuId)
    .eq("restaurant_id", restaurantId)
    .maybeSingle();
  if (error) throw new InternalServerErrorException(`The menu could not be read: ${error.message}. ${NOTHING}`);
  if (!data) throw new NotFoundException(`No menu of this restaurant by that id. ${NOTHING}`);
  return data as Record<string, any>;
}

const CURRENT_REFUSAL = `This is the current menu, so it cannot be put away: the house sells from it. Make another menu current first. ${NOTHING}`;

/**
 * Sets a kept menu of this house aside (`aside: true`) or brings it back
 * (`aside: false`). The caller has already checked the person may manage the
 * house. Another house's id is a 404; the current menu is a 409.
 */
export async function setMenuAside(
  db: Db,
  restaurantId: string,
  menuId: string,
  userId: string,
  aside: boolean,
  now: () => string = () => new Date().toISOString(),
): Promise<SetAsideResult> {
  const row = await readRow(db, restaurantId, menuId);
  const unchanged = (r: Record<string, any>, said: string): SetAsideResult => ({
    menuId,
    setAside: r.set_aside_at != null,
    setAsideAt: r.set_aside_at ?? null,
    changed: false,
    said,
  });

  if (!aside) {
    if (row.set_aside_at == null) return unchanged(row, `This menu is not put away. ${NOTHING}`);
    const { error } = await db
      .from("restaurant_menus")
      .update({ set_aside_at: null, set_aside_by: null })
      .eq("id", menuId)
      .eq("restaurant_id", restaurantId);
    if (error) throw new InternalServerErrorException(`The menu could not be brought back: ${error.message}. ${NOTHING}`);
    return { menuId, setAside: false, setAsideAt: null, changed: true, said: SAID_BACK };
  }

  if (row.status === "active") throw new ConflictException(CURRENT_REFUSAL);
  if (row.set_aside_at != null) return unchanged(row, `This menu was already put away. ${NOTHING}`);

  const at = now();
  const { data, error } = await db
    .from("restaurant_menus")
    .update({ set_aside_at: at, set_aside_by: userId })
    .eq("id", menuId)
    .eq("restaurant_id", restaurantId)
    .neq("status", "active")
    .is("set_aside_at", null)
    .select("id");
  // 23514: the menu became current between the read and the write (the CHECK).
  if (error && error.code !== "23514") {
    throw new InternalServerErrorException(`The menu could not be put away: ${error.message}. ${NOTHING}`);
  }
  if (error || ((data ?? []) as unknown[]).length === 0) {
    // Someone else moved first: say what the menu is now, never a guess.
    const after = await readRow(db, restaurantId, menuId);
    if (after.status === "active") throw new ConflictException(CURRENT_REFUSAL);
    if (after.set_aside_at != null) return unchanged(after, `This menu was already put away. ${NOTHING}`);
    throw new ConflictException(`The menu changed while it was being put away. ${NOTHING} Look at the list again.`);
  }
  return { menuId, setAside: true, setAsideAt: at, changed: true, said: SAID_ASIDE };
}

/** The refusal make-current gives a menu that is set aside. */
export const SET_ASIDE_MAKE_CURRENT_REFUSAL =
  "This menu is put away. Bring it back from Put away first, then make it current. Nothing was changed.";
