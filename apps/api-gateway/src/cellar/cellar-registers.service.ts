import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import {
  applyAnswers,
  inferRegisters,
  isRegisterId,
  registerForKind,
  registersForBeverageType,
  registersForLabel,
  type DecidedBy,
  type InferenceInput,
  type RegisterId,
  type RegisterReadout,
  type StoredAnswer,
} from "./cellar-registers";
import type { SetCellarRegistersDto } from "./dto/cellar-registers.dto";

/**
 * Which registers a house carries — read, inferred, and written.
 *
 * THE ONE RULE THIS SERVICE EXISTS TO ENFORCE. Four different sentences look
 * identical if you flatten them, and this whole file is the refusal to flatten
 * them:
 *
 *   1. "The house confirmed it does not carry beer."   → confirmed.
 *   2. "The house switched beer on itself."            → manual.
 *   3. "We read the books; there is no beer in them."  → inferred.
 *   4. "There are no books to read."                   → unknown.
 *
 * A four-register cellar drawn for every tenant collapses all four into "here
 * is your empty beer register". The readout below keeps them apart and hands
 * the difference to the page, which renders four different sentences for them.
 *
 * THE SHAPE THE FOUNDER CHOSE (2026-09-03): **infer, then confirm at
 * onboarding**, with a manual switch afterwards for a category the books cannot
 * yet see. So inference always runs — even over a house that confirmed months
 * ago — because a stale answer still has to be checkable against the shelves,
 * and because the "switched on with no rows behind it" prompt is only
 * computable by reading the books at the same moment as the answer.
 */

/** The answers table does not exist on every database yet — see `readAnswers`. */
const MISSING_RELATION_CODES = new Set(["42P01", "PGRST205", "PGRST202"]);

export interface SourceStatus {
  readable: boolean;
  /** Why not, verbatim from the driver. Null when readable. */
  reason: string | null;
  /** Rows the source returned. Null when unreadable — never 0. */
  rows: number | null;
}

export interface CellarRegistersReadout {
  restaurantId: string;
  registers: RegisterReadout[];
  /** Every register the house is known to carry, in vocabulary order. */
  carried: RegisterId[];
  /**
   * The page's one-line answer to "how was this decided?". `mixed` when some
   * registers are the house's own answer and others are still inferred.
   */
  decidedBy: DecidedBy | "mixed";
  sources: {
    /** The house's own recorded answers. Unreadable is not the same as none. */
    answers: SourceStatus;
    inventory: SourceStatus;
    menu: SourceStatus;
    cocktails: SourceStatus;
    /**
     * The SHARED reference catalogues, counted per register. Never evidence of
     * what this house carries — see `RegisterEvidence.catalogueRows`.
     */
    catalogue: SourceStatus;
  };
  /**
   * True while NO register has ever been confirmed by a human — the condition
   * the onboarding confirm step should appear under.
   *
   * `null` when the answers table could not be read: whether this house has
   * confirmed is then genuinely unknown, and answering `false` would suppress
   * the onboarding step for every house on a database where the migration has
   * not landed, while answering `true` would re-ask a house that already
   * confirmed. Neither is a fact, so neither is returned.
   */
  awaitingConfirmation: boolean | null;
  /** Registers that are on with nothing in the books behind them. */
  needsEvidence: RegisterId[];
  /**
   * Registers that are OFF while this house's books still hold items of the
   * kind — the seasonal-menu case. The cellar keeps showing those items under
   * a "not on the list" band rather than losing them.
   */
  stranded: RegisterId[];
  /**
   * Kinds the library's classifier emitted that none of the seven registers can
   * hold (`sake`, `cider`, `unknown`). Reported rather than dropped: a house
   * with 40 sakes and no register for them is a fact the founder should see.
   */
  unmappedKinds: Record<string, number>;
  /**
   * `beverages.beverage_type` values this build has no register for. Reported
   * rather than folded into a neighbour: the column has no CHECK constraint,
   * so an unseen value is a real possibility and silently absorbing it would
   * inflate whichever register it landed in.
   */
  unmappedCatalogueTypes: Record<string, number>;
}

interface InventoryKindRow {
  wine_name: string | null;
  master_wine_library:
    | { beverage_kind: string | null; name: string | null; primary_type: string | null }
    | { beverage_kind: string | null; name: string | null; primary_type: string | null }[]
    | null;
}

interface MenuItemRow {
  category: string | null;
  name: string | null;
}

interface AnswerRow {
  register: string;
  carried: boolean;
  source: string;
  confirmed_at: string | null;
}

@Injectable()
export class CellarRegistersService {
  private readonly logger = new Logger(CellarRegistersService.name);

  constructor(private readonly dbService: DatabaseService) {}

  async read(restaurantId: string): Promise<CellarRegistersReadout> {
    const [answers, inventory, menu, cocktails, catalogue] = await Promise.all([
      this.readAnswers(restaurantId),
      this.readInventoryKinds(restaurantId),
      this.readMenuLabels(restaurantId),
      this.countCocktails(restaurantId),
      this.readCatalogueCounts(),
    ]);

    // "Is there anything to look at?" — the question that separates "no beer"
    // from "no books". A source that FAILED does not count as evidence of
    // absence, so only readable-and-non-empty sources set this.
    const hasAnyEvidence =
      (inventory.status.rows ?? 0) > 0 ||
      (menu.status.rows ?? 0) > 0 ||
      (cocktails.status.rows ?? 0) > 0;

    const input: InferenceInput = {
      kindCounts: inventory.kindCounts,
      inventoryNameCounts: inventory.nameCounts,
      menuCounts: menu.counts,
      cocktailRows: cocktails.status.rows,
      unmappedKinds: inventory.unmappedKinds,
      catalogueCounts: catalogue.counts,
      hasAnyEvidence,
    };

    const registers = applyAnswers(inferRegisters(input), answers.map);

    const decidedKinds = new Set(registers.map((r) => r.decidedBy));
    const decidedBy: DecidedBy | "mixed" =
      decidedKinds.size === 1
        ? [...decidedKinds][0]
        : decidedKinds.has("confirmed") || decidedKinds.has("manual")
          ? "mixed"
          : decidedKinds.has("inferred")
            ? "inferred"
            : "unknown";

    return {
      restaurantId,
      registers,
      carried: registers.filter((r) => r.carried === true).map((r) => r.id),
      decidedBy,
      awaitingConfirmation: answers.status.readable
        ? !registers.some(
            (r) => r.decidedBy === "confirmed" || r.decidedBy === "manual",
          )
        : null,
      needsEvidence: registers.filter((r) => r.needsEvidence).map((r) => r.id),
      stranded: registers
        .filter((r) => r.carried === false && (r.strandedItems ?? 0) > 0)
        .map((r) => r.id),
      sources: {
        answers: answers.status,
        inventory: inventory.status,
        menu: menu.status,
        cocktails: cocktails.status,
        catalogue: catalogue.status,
      },
      unmappedKinds: inventory.unmappedKinds,
      unmappedCatalogueTypes: catalogue.unmapped,
    };
  }

  /**
   * Write the house's answer.
   *
   * `evidence` is snapshotted from the LIVE inference at this instant, never
   * taken from the caller: a client that reports what it believed the inference
   * said is a second home for one fact, and the question that matters later
   * ("was the machine right, and did the human overrule it?") is only
   * answerable if the machine's answer was recorded by the machine.
   *
   * `confirmed_at` is set for `confirmed` and `manual` and left null for
   * `inferred`, matching the CHECK constraint in the migration. A proposal
   * written here is still a proposal.
   */
  async write(
    restaurantId: string,
    dto: SetCellarRegistersDto,
    userId: string | null,
  ): Promise<CellarRegistersReadout> {
    const before = await this.read(restaurantId);
    const byId = new Map(before.registers.map((r) => [r.id, r]));
    const now = new Date().toISOString();

    const confirmed = dto.source === "confirmed" || dto.source === "manual";

    const rows = dto.registers.map((r) => {
      const live = byId.get(r.id as RegisterId);
      return {
        restaurant_id: restaurantId,
        register: r.id,
        carried: r.carried,
        source: dto.source,
        confirmed_at: confirmed ? now : null,
        confirmed_by: confirmed ? userId : null,
        evidence: live
          ? {
              carried: live.carried,
              confidence: live.confidence,
              inventoryRows: live.evidence.inventoryRows,
              menuRows: live.evidence.menuRows,
              at: now,
            }
          : null,
        updated_at: now,
      };
    });

    const { error } = await this.dbService
      .getClient()
      .from("restaurant_cellar_registers")
      .upsert(rows, { onConflict: "restaurant_id,register" });

    if (error) {
      // Never swallowed into a success. A write that did not happen must not
      // return the readout as though it had — that is the exact shape the
      // legacy "Reorder" button had on this very page.
      this.logger.error(
        `Failed to record cellar registers for ${restaurantId}: ${error.message}`,
      );
      throw Object.assign(
        new Error(
          `The house's answer was not recorded: ${error.message}${
            MISSING_RELATION_CODES.has(String((error as { code?: string }).code))
              ? " (the restaurant_cellar_registers table is not on this database yet — the migration has not been applied)"
              : ""
          }`,
        ),
        { code: (error as { code?: string }).code },
      );
    }

    return this.read(restaurantId);
  }

  /* ── sources ─────────────────────────────────────────────────────────── */

  private async readAnswers(restaurantId: string): Promise<{
    status: SourceStatus;
    map: Map<RegisterId, StoredAnswer>;
  }> {
    const map = new Map<RegisterId, StoredAnswer>();
    const { data, error } = await this.dbService
      .getClient()
      .from("restaurant_cellar_registers")
      .select("register, carried, source, confirmed_at")
      .eq("restaurant_id", restaurantId);

    if (error) {
      // A missing table is reported as UNREADABLE, not as "nobody answered".
      // The difference matters more here than anywhere else on this page: an
      // unreadable answers table that reported "nobody has answered" would
      // silently hand every house the inference and call it the house's word —
      // and the onboarding confirm step would re-ask a house that had already
      // answered, overwriting a real decision with a guess.
      return {
        status: {
          readable: false,
          reason: MISSING_RELATION_CODES.has(
            String((error as { code?: string }).code),
          )
            ? "restaurant_cellar_registers is not on this database yet (the migration has not been applied here)"
            : error.message,
          rows: null,
        },
        map,
      };
    }

    for (const row of (data ?? []) as AnswerRow[]) {
      if (!isRegisterId(row.register)) continue;
      if (
        row.source !== "inferred" &&
        row.source !== "confirmed" &&
        row.source !== "manual"
      ) {
        // A source this build does not know is not silently treated as an
        // answer. Skipping it makes the register fall back to the live
        // inference, which is at least a claim this code can stand behind.
        continue;
      }
      map.set(row.register, {
        carried: row.carried,
        source: row.source,
        confirmedAt: row.confirmed_at ?? null,
      });
    }
    return {
      status: { readable: true, reason: null, rows: map.size },
      map,
    };
  }

  private async readInventoryKinds(restaurantId: string): Promise<{
    status: SourceStatus;
    kindCounts: Map<string, number> | null;
    nameCounts: Map<RegisterId, number> | null;
    unmappedKinds: Record<string, number>;
  }> {
    const { data, error } = await this.dbService
      .getClient()
      .from("restaurant_inventory")
      .select(
        "wine_name, master_wine_library(beverage_kind, name, primary_type)",
      )
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true)
      .is("deleted_at", null);

    if (error) {
      return {
        status: { readable: false, reason: error.message, rows: null },
        kindCounts: null,
        nameCounts: null,
        unmappedKinds: {},
      };
    }

    const kindCounts = new Map<string, number>();
    const nameCounts = new Map<RegisterId, number>();
    const unmappedKinds: Record<string, number> = {};

    for (const row of (data ?? []) as InventoryKindRow[]) {
      // PostgREST returns an embedded to-one either as an object or, on some
      // relationship shapes, as a one-element array. Both are handled rather
      // than assumed, because assuming produces a silent zero.
      const lib = Array.isArray(row.master_wine_library)
        ? (row.master_wine_library[0] ?? null)
        : row.master_wine_library;
      const kind = lib?.beverage_kind ?? null;
      const classified = kind ? registerForKind(kind) : null;
      if (kind) {
        kindCounts.set(kind, (kindCounts.get(kind) ?? 0) + 1);
        if (kind === "sake" || kind === "cider" || kind === "unknown") {
          unmappedKinds[kind] = (unmappedKinds[kind] ?? 0) + 1;
        }
      }
      const label = [row.wine_name, lib?.name, lib?.primary_type]
        .filter(Boolean)
        .join(" ");
      for (const id of registersForLabel(label)) {
        // ONE ROW COUNTS ONCE PER REGISTER. Caught live 2026-09-03 against the
        // dev gateway: a cellar of 50 rows reported `inventoryRows: 100` for
        // Wines, because a bottle classified `wine` whose name also says "Red"
        // was credited by the classifier AND by the name. The figure printed
        // beside a register has to be a count of bottles; two signals about one
        // bottle are not two bottles.
        if (id === classified) continue;
        nameCounts.set(id, (nameCounts.get(id) ?? 0) + 1);
      }
    }

    return {
      status: { readable: true, reason: null, rows: (data ?? []).length },
      kindCounts,
      nameCounts,
      unmappedKinds,
    };
  }

  private async readMenuLabels(restaurantId: string): Promise<{
    status: SourceStatus;
    counts: Map<RegisterId, number> | null;
  }> {
    const { data, error } = await this.dbService
      .getClient()
      .from("menu_items")
      .select("category, name")
      .eq("restaurant_id", restaurantId);

    if (error) {
      return {
        status: { readable: false, reason: error.message, rows: null },
        counts: null,
      };
    }

    const counts = new Map<RegisterId, number>();
    for (const row of (data ?? []) as MenuItemRow[]) {
      // The section header first — it is the restaurant's own words about what
      // this part of the menu IS, which is exactly the signal
      // wine_classify_beverage_kind() ranks second behind a real primary_type
      // (20260817060000:30-35). The item name is a fallback, not an equal.
      const hits = registersForLabel(row.category);
      const use = hits.length > 0 ? hits : registersForLabel(row.name);
      for (const id of use) counts.set(id, (counts.get(id) ?? 0) + 1);
    }

    return {
      status: { readable: true, reason: null, rows: (data ?? []).length },
      counts,
    };
  }

  /**
   * The two shared reference catalogues, counted per register.
   *
   * `master_wine_library.beverage_kind` has been computed by trigger since
   * August (20260817060000) and was being dropped at the gateway's mapping
   * boundary, so the browser could not count the beers in a library that had
   * already classified them. `public.beverages` had no controller at all.
   * Reading both here means a register card can print a real catalogue figure
   * with ONE request instead of teaching the browser to fan out.
   *
   * Neither read is tenant-scoped, because neither table is: this is the shared
   * catalogue, and the readout labels it as such rather than letting a page
   * print it as the house's stock.
   */
  private async readCatalogueCounts(): Promise<{
    status: SourceStatus;
    counts: Map<RegisterId, number> | null;
    unmapped: Record<string, number>;
  }> {
    const client = this.dbService.getClient();
    const [library, beverages] = await Promise.all([
      client.from("master_wine_library").select("beverage_kind"),
      client.from("beverages").select("beverage_type").is("superseded_by", null).is("deleted_at", null),
    ]);

    if (library.error || beverages.error) {
      return {
        status: {
          readable: false,
          reason:
            library.error?.message ??
            beverages.error?.message ??
            "unknown catalogue read failure",
          rows: null,
        },
        counts: null,
        unmapped: {},
      };
    }

    const counts = new Map<RegisterId, number>();
    const unmapped: Record<string, number> = {};

    for (const row of (library.data ?? []) as { beverage_kind: string | null }[]) {
      const id = registerForKind(row.beverage_kind);
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    for (const row of (beverages.data ?? []) as { beverage_type: string | null }[]) {
      const ids = registersForBeverageType(row.beverage_type);
      if (ids.length === 0) {
        const key = row.beverage_type ?? "(null)";
        unmapped[key] = (unmapped[key] ?? 0) + 1;
        continue;
      }
      for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
    }

    return {
      status: {
        readable: true,
        reason: null,
        rows: (library.data ?? []).length + (beverages.data ?? []).length,
      },
      counts,
      unmapped,
    };
  }

  private async countCocktails(restaurantId: string): Promise<{ status: SourceStatus }> {
    const { count, error } = await this.dbService
      .getClient()
      .from("cocktails")
      .select("id", { count: "exact", head: true })
      .eq("restaurant_id", restaurantId)
      .is("deleted_at", null);

    if (error) {
      return { status: { readable: false, reason: error.message, rows: null } };
    }
    return { status: { readable: true, reason: null, rows: count ?? 0 } };
  }
}
