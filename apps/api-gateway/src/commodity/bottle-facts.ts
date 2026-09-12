/**
 * The two person-stated facts a per-bottle duty needs, resolved out of the
 * schema — and the four ways that resolution honestly fails.
 *
 * `duty.ts` takes a size and a strength with an explicit SOURCE for each and
 * refuses a default by name. This file is what produces those, and every choice
 * in it is about not handing `duty.ts` a number nobody stated.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SIZE COMES FROM THE IDENTITY REGISTER, NOT FROM THE LIBRARY
 * ─────────────────────────────────────────────────────────────────────────────
 * `master_wine_library.bottle_size_ml` is `integer DEFAULT 750 NOT NULL`. Every
 * row has a value and most of those values are the default, and nothing in the
 * column distinguishes the two — so it is never read here.
 * `beverage_identities.size_ml` is the stated one, by that register's own
 * design: *"NULL means unstated. NEVER 750: the library's 750 is a column
 * default and this register exists partly to stop that default being read as a
 * fact"* (20260905140000).
 *
 * WHICH IDENTITY, WHEN THERE ARE SEVERAL. A library row may name many
 * identities — a wine sold in 750 ml and in magnum is two trade items and one
 * library entry (20260906050000's own comment). So:
 *
 *   1. the HOUSE's own identity (`asserted_for_restaurant_id` = this house), if
 *      exactly one of them states a size. That is the trade item this house
 *      actually buys, and it is the most specific true answer;
 *   2. otherwise a platform-wide identity (`asserted_for_restaurant_id IS
 *      NULL`), if exactly one states a size;
 *   3. otherwise REFUSED as ambiguous, and named.
 *
 * Rule 3 is the one that matters. Picking the first of two stated sizes would
 * compute a magnum's duty for a 750, which is off by a factor of two and looks
 * entirely ordinary on a screen — the same failure the shell-egg parser refuses
 * as `ambiguous_row`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE STRENGTH COMES FROM THE SHARED LIBRARY ROW, AND NEVER FROM THE ALIAS
 * ─────────────────────────────────────────────────────────────────────────────
 * `master_wine_library.abv_percent`, person-stated, no default. A house's own
 * bottle is a `beverage_identities` row with `asserted_for_restaurant_id` set,
 * and it carries no ABV at all — the migration asserts that on every replay.
 * Strength is a property of the liquid; one house cannot hold a different
 * strength of the same wine from another house.
 *
 * NULL AND 0.0 ARE DIFFERENT ANSWERS. NULL is "nobody has stated one"; 0.0 is a
 * person stating a de-alcoholised product, and HMRC's own 0-1.2% band is
 * GBP 0.00. They are kept apart all the way to `duty.ts`.
 */

import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import type { BottleFacts } from "./duty";

/** Why no facts could be resolved. Never an empty result with no reason. */
export type BottleFactsRefusal =
  | "item_unreadable"
  | "no_library_row"
  | "size_ambiguous";

export interface ResolvedBottleFacts {
  facts: BottleFacts;
  /** Set only when the resolution itself failed, as opposed to a fact being absent. */
  refusal: BottleFactsRefusal | null;
  detail: string | null;
}

/** Nothing known, and nothing claimed. The shape every failure returns. */
const NOTHING: BottleFacts = {
  sizeMl: null,
  sizeSource: null,
  abvPercent: null,
  abvSource: null,
};

@Injectable()
export class BottleFactsService {
  private readonly logger = new Logger(BottleFactsService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * Resolve one house item's stated size and stated strength.
   *
   * `restaurantId` scopes the SIZE preference, not the strength: the house's own
   * identity says which trade item it buys, and the library says how strong the
   * liquid is.
   */
  async forHouseItem(
    restaurantId: string,
    houseItemId: string,
  ): Promise<ResolvedBottleFacts> {
    let masterWineId: string | null = null;
    try {
      const { data, error } = await this.db.client
        .from("restaurant_inventory")
        .select("id, restaurant_id, master_wine_id")
        .eq("id", houseItemId)
        .eq("restaurant_id", restaurantId)
        .maybeSingle();
      if (error) throw error;
      const row = data as Record<string, unknown> | null;
      masterWineId = row?.master_wine_id ? String(row.master_wine_id) : null;
    } catch (err) {
      // A failed read is never an empty one. Returning "no strength stated"
      // here would tell a person to go and type something that may be typed.
      this.logger.warn(
        `could not read house item ${houseItemId} for bottle facts: ${(err as Error).message}`,
      );
      return {
        facts: NOTHING,
        refusal: "item_unreadable",
        detail:
          "This item could not be read, so nothing is known about its size or its strength. That is unknown, not unstated.",
      };
    }

    if (!masterWineId) {
      return {
        facts: NOTHING,
        refusal: "no_library_row",
        detail:
          "This item names no library row, so there is no shared bottle to carry a strength. A duty needs the liquid identified before it needs anything else.",
      };
    }

    let abvPercent: number | null = null;
    try {
      const { data, error } = await this.db.client
        .from("master_wine_library")
        .select("id, abv_percent")
        .eq("id", masterWineId)
        .maybeSingle();
      if (error) throw error;
      const row = data as Record<string, unknown> | null;
      abvPercent =
        row && row.abv_percent !== null && row.abv_percent !== undefined
          ? Number(row.abv_percent)
          : null;
    } catch (err) {
      this.logger.warn(
        `could not read the library row for bottle facts: ${(err as Error).message}`,
      );
      return {
        facts: NOTHING,
        refusal: "item_unreadable",
        detail:
          "The shared library row could not be read, so this bottle's strength is unknown rather than unstated.",
      };
    }

    let sizeMl: number | null = null;
    try {
      const { data, error } = await this.db.client
        .from("beverage_identities")
        .select("id, master_wine_id, size_ml, asserted_for_restaurant_id")
        .eq("master_wine_id", masterWineId);
      if (error) throw error;
      const rows = (data ?? []) as Array<Record<string, unknown>>;
      const stated = rows.filter(
        (r) => r.size_ml !== null && r.size_ml !== undefined,
      );
      const mine = stated.filter(
        (r) => String(r.asserted_for_restaurant_id ?? "") === restaurantId,
      );
      const shared = stated.filter((r) => r.asserted_for_restaurant_id == null);

      const pick = (rs: Array<Record<string, unknown>>): number | null | "many" => {
        const sizes = Array.from(new Set(rs.map((r) => Number(r.size_ml))));
        if (sizes.length === 0) return null;
        if (sizes.length > 1) return "many";
        return sizes[0];
      };

      const fromMine = pick(mine);
      if (fromMine === "many") {
        return {
          facts: { ...NOTHING, abvPercent, abvSource: abvPercent === null ? null : "typed_by_a_person" },
          refusal: "size_ambiguous",
          detail:
            "This house has stated more than one size for this bottle, so no duty is computed. Picking one would compute a magnum's tax for a 750, which looks entirely ordinary on a screen.",
        };
      }
      if (typeof fromMine === "number") {
        sizeMl = fromMine;
      } else {
        const fromShared = pick(shared);
        if (fromShared === "many") {
          return {
            facts: { ...NOTHING, abvPercent, abvSource: abvPercent === null ? null : "typed_by_a_person" },
            refusal: "size_ambiguous",
            detail:
              "This bottle is registered in more than one size and this house has not said which it buys, so no duty is computed. Naming the size on this house's own bottle settles it.",
          };
        }
        sizeMl = typeof fromShared === "number" ? fromShared : null;
      }
    } catch (err) {
      this.logger.warn(
        `could not read identities for bottle facts: ${(err as Error).message}`,
      );
      return {
        facts: { ...NOTHING, abvPercent, abvSource: abvPercent === null ? null : "typed_by_a_person" },
        refusal: "item_unreadable",
        detail:
          "The bottle's identities could not be read, so its size is unknown rather than unstated.",
      };
    }

    return {
      facts: {
        sizeMl,
        // A size that reached here came from `beverage_identities.size_ml`,
        // which is only ever written by somebody stating it. There is no path
        // by which a default arrives in this field -- the library's 750 is
        // never read.
        sizeSource: sizeMl === null ? null : "typed_by_a_person",
        abvPercent,
        abvSource: abvPercent === null ? null : "typed_by_a_person",
      },
      refusal: null,
      detail: null,
    };
  }
}
