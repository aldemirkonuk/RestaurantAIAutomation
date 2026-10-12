import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { MenusService } from "./menus.service";

/**
 * A menu's sections, edited by a person (ADR 0340 rules 6, 9, 10, 12, 18;
 * lane 3b). Every write is ONE database function that makes the change and
 * its `menu_section_changes` row together
 * (20270107300000 / 20270107500000), so nothing here writes a table
 * directly. Every lookup carries the house: a section, line or menu of
 * another house is the same 404 as a missing one (ADR 0147).
 *
 * The routes are an owner's or a manager's (MenuSectionsController); the
 * house and the actor come from the session, never the body.
 */

/** What resolve-on-tap answers after a tap that made lines drinks. */
export interface ResolveOutcome {
  linked: string[];
  unlinked: string[];
  error: string | null;
}

/** The owner's word for each kind a section can move to (ADR 0340 rule 1). */
const KIND_WORDS: Record<string, string> = {
  beverage: "Drinks",
  food: "Food",
  desserts: "Desserts",
};

/**
 * A move refused by `UNIQUE (menu_id, key)` (F-1531), as refusalOf mapped
 * it (23505, a 409 carrying the database's text): the move cuts the
 * section's key back to its own heading (20270107200000, rule 10), so a
 * target draft with a section of the same name refuses it. The refusal is
 * intended; only its words were the database's.
 */
export function moveRefusalOf(
  refused: unknown,
  kind: string,
  title: string | null,
): unknown {
  if (
    refused instanceof ConflictException &&
    /menu_sections_menu_id_key_key/.test(refused.message)
  ) {
    const menu = KIND_WORDS[kind] ?? "That menu";
    const name = title?.trim() ? `called "${title.trim()}"` : "with this name";
    return new ConflictException(
      `${menu} already has a section ${name}. Rename one of them first, then move it. Nothing was moved.`,
    );
  }
  return refused;
}

/** A database function's refusal, mapped to the answer the review shows. */
export function refusalOf(
  error: { code?: string; message?: string } | null,
): HttpException {
  const raw = error?.message ?? "the change could not be made";
  // A function's own name is ours, not the person's: drop "fn_name: ".
  const message = raw.replace(/^[a-z_]+: /, "");
  switch (error?.code) {
    case "P0002":
      return new NotFoundException("That menu, section or line was not found.");
    case "22023":
    case "23514":
      return new BadRequestException(message);
    case "55000":
    case "23505":
    case "40001":
      return new ConflictException(message);
    default:
      return new InternalServerErrorException(
        `The change could not be made, so nothing was changed: ${raw}`,
      );
  }
}

const SECTION_READ_ROWS = 1000;
const SECTION_COLUMNS =
  "id, menu_id, parent_id, position, title, title_as_read, key, drink_category, suggested_kind, suggested_category, suggestion_confidence, inherited_from_section_id, confirmed_by, confirmed_at";

@Injectable()
export class MenuSectionsService {
  constructor(
    private readonly dbService: DatabaseService,
    private readonly menusService: MenusService,
  ) {}

  private get db() {
    return this.dbService.supabase;
  }

  private async rpc(fn: string, args: Record<string, unknown>): Promise<any> {
    const { data, error } = await this.db.rpc(fn, args);
    if (error) throw refusalOf(error);
    return data;
  }

  /** The house's menu, or 404. A failed read is a 500, never a 404. */
  private async assertMenu(
    house: string,
    menuId: string,
  ): Promise<{ id: string; status: string; menu_type: string | null }> {
    const { data, error } = await this.db
      .from("restaurant_menus")
      .select("id, status, menu_type")
      .eq("id", menuId)
      .eq("restaurant_id", house)
      .maybeSingle();
    if (error) {
      throw new InternalServerErrorException(
        `The menu could not be read: ${error.message}`,
      );
    }
    if (!data)
      throw new NotFoundException("That menu, section or line was not found.");
    return data as { id: string; status: string; menu_type: string | null };
  }

  /** The house's section ON THIS MENU, or 404: the URL's menu is checked, not assumed. */
  private async assertSection(
    house: string,
    menuId: string,
    sectionId: string,
  ): Promise<{ title: string | null }> {
    const { data, error } = await this.db
      .from("menu_sections")
      .select("id, title")
      .eq("id", sectionId)
      .eq("menu_id", menuId)
      .eq("restaurant_id", house)
      .maybeSingle();
    if (error) {
      throw new InternalServerErrorException(
        `The section could not be read: ${error.message}`,
      );
    }
    if (!data)
      throw new NotFoundException("That menu, section or line was not found.");
    return { title: (data as { title?: string | null }).title ?? null };
  }

  /** The house's line ON THIS MENU, or 404. */
  private async assertLine(
    house: string,
    menuId: string,
    lineId: string,
  ): Promise<void> {
    const { data, error } = await this.db
      .from("menu_items")
      .select("id")
      .eq("id", lineId)
      .eq("menu_id", menuId)
      .eq("restaurant_id", house)
      .maybeSingle();
    if (error) {
      throw new InternalServerErrorException(
        `The line could not be read: ${error.message}`,
      );
    }
    if (!data)
      throw new NotFoundException("That menu, section or line was not found.");
  }

  private resolve(
    house: string,
    menuId: string,
    lineIds: unknown,
    userId: string,
  ): Promise<ResolveOutcome> {
    const ids = Array.isArray(lineIds)
      ? lineIds.filter((x): x is string => typeof x === "string")
      : [];
    return this.menusService.resolveOnTap(house, menuId, ids, userId);
  }

  /** The menu's sections in the house's order, keyset-paged. A failed page is a 500. */
  async list(house: string, menuId: string) {
    await this.assertMenu(house, menuId);
    const rows: Array<Record<string, unknown>> = [];
    let after: string | null = null;
    for (;;) {
      let q = this.db
        .from("menu_sections")
        .select(SECTION_COLUMNS)
        .eq("restaurant_id", house)
        .eq("menu_id", menuId);
      if (after) q = q.gt("id", after);
      const { data, error } = await q
        .order("id", { ascending: true })
        .limit(SECTION_READ_ROWS);
      if (error) {
        throw new InternalServerErrorException(
          `The menu's sections could not be read: ${error.message}`,
        );
      }
      const page = (data ?? []) as Array<Record<string, unknown>>;
      rows.push(...page);
      if (page.length < SECTION_READ_ROWS) break;
      after = String(page[page.length - 1].id);
    }
    // Siblings together, in the house's order; the client builds the tree.
    rows.sort(
      (a, b) =>
        String(a.parent_id ?? "").localeCompare(String(b.parent_id ?? "")) ||
        Number(a.position) - Number(b.position),
    );
    return { menuId, sections: rows };
  }

  create(
    house: string,
    menuId: string,
    userId: string,
    title: string,
    parentId: string | null,
    drinkCategory: string | null,
  ) {
    return this.rpc("add_menu_section", {
      p_restaurant_id: house,
      p_menu_id: menuId,
      p_parent_id: parentId,
      p_title: title,
      p_actor: userId,
      p_drink_category: drinkCategory,
    });
  }

  async rename(
    house: string,
    menuId: string,
    sectionId: string,
    userId: string,
    title: string,
  ) {
    await this.assertSection(house, menuId, sectionId);
    return this.rpc("rename_menu_section", {
      p_restaurant_id: house,
      p_section_id: sectionId,
      p_title: title,
      p_actor: userId,
    });
  }

  async reparent(
    house: string,
    menuId: string,
    sectionId: string,
    userId: string,
    parentId: string | null,
  ) {
    await this.assertSection(house, menuId, sectionId);
    return this.rpc("reparent_menu_section", {
      p_restaurant_id: house,
      p_section_id: sectionId,
      p_parent_id: parentId,
      p_actor: userId,
    });
  }

  reorder(
    house: string,
    menuId: string,
    userId: string,
    parentId: string | null,
    ids: string[],
  ) {
    return this.rpc("reorder_menu_sections", {
      p_restaurant_id: house,
      p_menu_id: menuId,
      p_parent_id: parentId,
      p_ids: ids,
      p_actor: userId,
    });
  }

  async remove(
    house: string,
    menuId: string,
    sectionId: string,
    userId: string,
  ) {
    await this.assertSection(house, menuId, sectionId);
    return this.rpc("delete_menu_section", {
      p_restaurant_id: house,
      p_section_id: sectionId,
      p_actor: userId,
    });
  }

  /** Drafts of one upload only; the target draft is made in the same step when there is none. */
  async moveToKind(
    house: string,
    menuId: string,
    sectionId: string,
    userId: string,
    kind: string,
  ) {
    const { title } = await this.assertSection(house, menuId, sectionId);
    let moved: any;
    try {
      moved = await this.rpc("move_menu_section_to_kind", {
        p_restaurant_id: house,
        p_section_id: sectionId,
        p_kind: kind,
        p_actor: userId,
      });
    } catch (refused) {
      throw moveRefusalOf(refused, kind, title);
    }
    // Lines moved onto the Drinks draft become drinks there: link them.
    const resolved =
      kind === "beverage"
        ? await this.resolve(
            house,
            String(moved?.menu_id),
            moved?.line_ids,
            userId,
          )
        : null;
    return { ...moved, resolved };
  }

  async setCategory(
    house: string,
    menuId: string,
    sectionId: string,
    userId: string,
    drinkCategory: string | null,
  ) {
    await this.assertSection(house, menuId, sectionId);
    const set = await this.rpc("set_menu_section_category", {
      p_restaurant_id: house,
      p_section_id: sectionId,
      p_drink_category: drinkCategory,
      p_actor: userId,
    });
    const resolved = drinkCategory
      ? await this.resolve(house, menuId, set?.line_ids, userId)
      : null;
    return { ...set, resolved };
  }

  async confirmSection(
    house: string,
    menuId: string,
    sectionId: string,
    userId: string,
    lineKind: string,
    drinkCategory: string | null,
  ) {
    await this.assertSection(house, menuId, sectionId);
    const confirmed = await this.rpc("confirm_menu_section", {
      p_restaurant_id: house,
      p_section_id: sectionId,
      p_line_kind: lineKind,
      p_drink_category: drinkCategory,
      p_actor: userId,
    });
    const resolved =
      lineKind === "drink"
        ? await this.resolve(house, menuId, confirmed?.applied_line_ids, userId)
        : null;
    return { ...confirmed, resolved };
  }

  async confirmLine(
    house: string,
    menuId: string,
    lineId: string,
    userId: string,
    lineKind: string,
    drinkCategory: string | null,
  ) {
    await this.assertLine(house, menuId, lineId);
    const confirmed = await this.rpc("confirm_menu_line", {
      p_restaurant_id: house,
      p_line_id: lineId,
      p_line_kind: lineKind,
      p_drink_category: drinkCategory,
      p_actor: userId,
    });
    const resolved =
      lineKind === "drink"
        ? await this.resolve(house, menuId, [lineId], userId)
        : null;
    return { ...confirmed, resolved };
  }

  assignLines(
    house: string,
    menuId: string,
    userId: string,
    sectionId: string | null,
    lineIds: string[],
  ) {
    return this.rpc("assign_menu_lines", {
      p_restaurant_id: house,
      p_menu_id: menuId,
      p_section_id: sectionId,
      p_line_ids: lineIds,
      p_actor: userId,
    });
  }

  /** Keep a Gone line: the live line `lineId` is copied into the draft `menuId`. */
  keepGoneLine(house: string, menuId: string, lineId: string, userId: string) {
    return this.rpc("keep_gone_menu_line", {
      p_restaurant_id: house,
      p_menu_id: menuId,
      p_line_id: lineId,
      p_actor: userId,
    });
  }
}
