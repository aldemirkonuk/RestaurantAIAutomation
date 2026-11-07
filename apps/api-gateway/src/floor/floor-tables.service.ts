/**
 * The floor's tables and merges (ADR 0347 D3–D6; the checker's
 * `merge-actions.ts`). Owners and managers add, rename, hide, size, shape and
 * place tables; a merge pushes tables together for one party and never writes
 * `restaurant_tables` (D6).
 *
 * Seats are never guessed (E9, D4): a table added without a count is NULL, and
 * a merged table's seats are unknown when any member's are.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { formsAdjacentGroup, inferMergeOrientation } from "@wineops/floor-core";
import { DatabaseService } from "../database/database.service";
import { TableAnalyticsService } from "../analytics/table-analytics.service";
import { InsightGeneratorService } from "../analytics/insights/insight-generator.service";
import { type FloorActor, isManagerRole, isUniqueViolation, readFloorHouse, serviceDateOf } from "./floor-common";
import { readHolders } from "./floor-holders";
import { FloorService } from "./floor.service";
import type { CreateTableDto, TablePatchDto } from "./floor.dto";

interface TableRow {
  id: string;
  label: string;
  seats: number | null;
  x_pos: number | null;
  y_pos: number | null;
  hidden_at: string | null;
}

export interface LiveMerge {
  mergeId: string;
  tableIds: string[];
  orientation: "horizontal" | "vertical" | null;
  /** The members' seats summed; null when any member's is unknown (D4). */
  seats: number | null;
}

/** A merged table's seats: the sum, or unknown when any member's is (ADR 0347 D4). */
export function mergedSeats(seats: Array<number | null | undefined>): number | null {
  if (seats.length === 0 || seats.some((s) => typeof s !== "number")) return null;
  return (seats as number[]).reduce((x, y) => x + y, 0);
}

@Injectable()
export class FloorTablesService {
  private readonly logger = new Logger(FloorTablesService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly floor: FloorService,
    private readonly tableAnalytics: TableAnalyticsService,
    private readonly insights: InsightGeneratorService,
  ) {}

  private get sb() {
    return this.db.supabase;
  }

  // -------------------------------------------------------------------------
  // Tables (ADR 0347 D3, D4, D6)
  // -------------------------------------------------------------------------

  /** One create, under the house lock, refusing a twin; nothing guessed (D3). */
  async createTable(a: FloorActor, dto: CreateTableDto) {
    const { data, error } = await this.sb.rpc("floor_create_table", {
      p_restaurant_id: a.restaurantId,
      p_label: dto.label,
      p_seats: dto.seats ?? null,
      p_is_outdoor: dto.is_outdoor ?? null,
      p_x_pos: dto.x_pos ?? null,
      p_y_pos: dto.y_pos ?? null,
      p_shape: dto.shape ?? null,
    });
    if (error) {
      this.logger.error(`floor_create_table failed: ${error.message}`);
      throw new InternalServerErrorException("The table could not be added.");
    }
    const out = (data ?? {}) as { error?: string; twin_id?: string; twin_label?: string; table?: unknown; checks_linked?: number };
    if (out.error === "bad_label") throw new BadRequestException("A table's name is 1 to 60 characters.");
    if (out.error === "twin") {
      throw new ConflictException({
        code: "TABLE_TWIN",
        twinId: out.twin_id ?? null,
        twinLabel: out.twin_label ?? null,
        message: `This house already has a table that answers to "${out.twin_label}".`,
      });
    }
    if (!out.table) throw new InternalServerErrorException("The table could not be added.");
    this.floor.word(a.restaurantId, null, "tables_changed");
    return { table: out.table, checksLinked: out.checks_linked ?? 0 };
  }

  /**
   * Rename, hide or show, size, shape, place, or send back to the tray. A
   * rename refuses a twin by every till rule (D3); hiding is refused while the
   * table has a party or sits in a live merge (D6). Rename and hide go through
   * the analytics service so its name-clash answer and its insight refresh
   * stay one path (ADR 0303).
   */
  async patchTable(a: FloorActor, tableId: string, dto: TablePatchDto) {
    const has = (k: keyof TablePatchDto) => dto[k] !== undefined;
    const fields: Array<keyof TablePatchDto> = ["label", "hidden", "seats", "x_pos", "y_pos", "shape", "tray"];
    if (!fields.some(has)) throw new BadRequestException("Send at least one change.");
    if (dto.tray === true && (typeof dto.x_pos === "number" || typeof dto.y_pos === "number")) {
      throw new BadRequestException("A table goes back to the tray or to a place, not both.");
    }

    const current = await this.readTable(a.restaurantId, tableId);

    if (typeof dto.label === "string" && dto.label.trim() !== current.label) {
      const { data, error } = await this.sb.rpc("floor_table_twin", {
        p_restaurant_id: a.restaurantId,
        p_label: dto.label,
        p_exclude_id: tableId,
      });
      if (error) throw new InternalServerErrorException("The table's name could not be checked.");
      const twin = ((data ?? []) as Array<{ id: string; label: string }>)[0];
      if (twin) {
        throw new ConflictException({
          code: "TABLE_TWIN",
          twinId: twin.id,
          twinLabel: twin.label,
          message: `Another table of this house already answers to "${twin.label}".`,
        });
      }
    }
    if (dto.hidden === true && !current.hidden_at) await this.refuseHideWhileInUse(a.restaurantId, tableId);

    if (has("label") || has("hidden")) {
      const togglesHidden = typeof dto.hidden === "boolean";
      if (togglesHidden && !(await this.insights.dropStored(a.restaurantId, ["tables"]))) {
        throw new ServiceUnavailableException(
          "The table insights could not be cleared, so the table was left as it was. Try again.",
        );
      }
      try {
        await this.tableAnalytics.renameOrHideTable(a.restaurantId, tableId, {
          ...(has("label") ? { label: dto.label } : {}),
          ...(has("hidden") ? { hidden: dto.hidden } : {}),
        });
      } finally {
        if (togglesHidden) await this.insights.refreshStored(a.restaurantId, ["tables"]);
      }
    }

    const patch: Record<string, unknown> = {};
    if (has("seats")) patch.seats = dto.seats ?? null;
    if (has("shape")) patch.shape = dto.shape ?? null;
    if (dto.tray === true) {
      patch.x_pos = null;
      patch.y_pos = null;
    } else {
      if (has("x_pos")) patch.x_pos = dto.x_pos ?? null;
      if (has("y_pos")) patch.y_pos = dto.y_pos ?? null;
    }
    if (Object.keys(patch).length > 0) {
      patch.updated_at = new Date().toISOString();
      const { error } = await this.sb
        .from("restaurant_tables")
        .update(patch)
        .eq("restaurant_id", a.restaurantId)
        .eq("id", tableId);
      if (error) {
        this.logger.error(`table patch failed: ${error.message}`);
        throw new InternalServerErrorException("The table could not be changed.");
      }
    }
    this.floor.word(a.restaurantId, tableId, "tables_changed");
    return { table: await this.readTable(a.restaurantId, tableId) };
  }

  private async readTable(restaurantId: string, tableId: string) {
    const { data, error } = await this.sb
      .from("restaurant_tables")
      .select("id, label, seats, is_outdoor, x_pos, y_pos, shape, hidden_at, is_active")
      .eq("restaurant_id", restaurantId)
      .eq("id", tableId)
      .eq("is_active", true)
      .maybeSingle();
    if (error) throw new InternalServerErrorException("The table could not be read.");
    if (!data) throw new NotFoundException("This house has no such table.");
    return data as TableRow & { shape: string | null; is_outdoor: boolean | null };
  }

  private async refuseHideWhileInUse(restaurantId: string, tableId: string) {
    const [seated, merged] = await Promise.all([
      this.sb
        .from("floor_seatings")
        .select("id")
        .eq("restaurant_id", restaurantId)
        .eq("table_id", tableId)
        .is("left_at", null)
        .limit(1),
      this.sb
        .from("floor_table_merge_members")
        .select("merge_id")
        .eq("restaurant_id", restaurantId)
        .eq("table_id", tableId)
        .eq("active", true)
        .limit(1),
    ]);
    if (seated.error || merged.error) throw new InternalServerErrorException("The table's party could not be read.");
    if ((seated.data ?? []).length > 0) {
      throw new ConflictException({ code: "TABLE_SEATED", message: "This table has a party. Hide it after they leave." });
    }
    if ((merged.data ?? []).length > 0) {
      throw new ConflictException({ code: "TABLE_MERGED", message: "This table is pushed together with another. Split it first." });
    }
  }

  // -------------------------------------------------------------------------
  // Merges (the checker's mergeTables / splitMerge)
  // -------------------------------------------------------------------------

  /**
   * Push tables together. All in one section; at least one seated; none in a
   * live merge. Owners and managers may merge any tables of a section; a
   * waiter only when they hold one of them and the tables are neighbours
   * (floor-core `formsAdjacentGroup`).
   *
   * Open as OD-242, the executor's reading under OD-242: the checker also
   * opens a "joined empty" seating on each empty member and syncs the shared
   * visit clock; here an empty member is recorded with `joined_empty` and no
   * seating, and each seating keeps its own clock.
   */
  async merge(a: FloorActor, tableIds: string[], now = Date.now()) {
    // A uuid matches in any case, so the request is deduped case-blind and
    // everything after the read uses the ids the database returned.
    const ids = [...new Set(tableIds.map((id) => id.toLowerCase()))];
    if (ids.length < 2) throw new BadRequestException("Pick at least two different tables.");

    const { data: rows, error } = await this.sb
      .from("restaurant_tables")
      .select("id, label, seats, x_pos, y_pos, hidden_at")
      .eq("restaurant_id", a.restaurantId)
      .eq("is_active", true)
      .in("id", ids);
    if (error) throw new InternalServerErrorException("The tables could not be read.");
    const asked = (id: string) => ids.indexOf(id.toLowerCase());
    const tables = ((rows ?? []) as TableRow[]).sort((x, y) => asked(x.id) - asked(y.id));
    if (tables.length !== ids.length || tables.some((t) => t.hidden_at)) {
      throw new NotFoundException("One of these tables is not on this house's floor.");
    }
    const group = tables.map((t) => t.id);

    const house = await readFloorHouse(this.sb, a.restaurantId);
    const holders = await readHolders(this.sb, a.restaurantId, serviceDateOf(house.zone, now));
    const sections = new Set(group.map((id) => holders.sectionOf.get(id) || null));
    if (sections.size !== 1 || sections.has(null)) {
      throw new ConflictException({ code: "MERGE_SECTIONS", message: "Tables must be in the same section." });
    }
    const sectionId = [...sections][0] as string;

    if (!isManagerRole(a)) {
      if (!group.some((id) => (holders.byTable.get(id) ?? []).includes(a.userId))) {
        throw new ForbiddenException("Only the table's waiter or a manager can push these tables together.");
      }
      const adj = tables.map((t) => ({ id: t.id, posX: num(t.x_pos), posY: num(t.y_pos), sectionId }));
      if (!formsAdjacentGroup(adj)) {
        throw new ConflictException({ code: "MERGE_NOT_ADJACENT", message: "These tables are not next to each other." });
      }
    }

    const [members, seatings] = await Promise.all([
      this.sb
        .from("floor_table_merge_members")
        .select("table_id")
        .eq("restaurant_id", a.restaurantId)
        .eq("active", true)
        .in("table_id", group),
      this.sb
        .from("floor_seatings")
        .select("id, table_id")
        .eq("restaurant_id", a.restaurantId)
        .is("left_at", null)
        .in("table_id", group),
    ]);
    if (members.error || seatings.error) throw new InternalServerErrorException("The floor could not be read.");
    if ((members.data ?? []).length > 0) {
      throw new ConflictException({ code: "MERGE_ALREADY", message: "One of these tables is already pushed together." });
    }
    const seatingOf = new Map(((seatings.data ?? []) as Array<{ id: string; table_id: string }>).map((s) => [s.table_id, s.id]));
    if (seatingOf.size === 0) {
      throw new ConflictException({ code: "MERGE_NONE_SEATED", message: "At least one table must be seated." });
    }

    // The database keeps horizontal or vertical; a diagonal pair is drawn
    // from the positions and stored as null orientation with the reading.
    const lie = tables.length === 2
      ? inferMergeOrientation(
          { posX: num(tables[0].x_pos), posY: num(tables[0].y_pos), sectionId },
          { posX: num(tables[1].x_pos), posY: num(tables[1].y_pos), sectionId },
        )
      : null;
    const orientation = lie === "horizontal" || lie === "vertical" ? lie : null;

    const { data: merge, error: mergeError } = await this.sb
      .from("floor_table_merges")
      .insert({
        restaurant_id: a.restaurantId,
        orientation,
        meta: lie === "diagonal" ? { drawn: "diagonal" } : {},
        created_by: a.userId,
      })
      .select("id")
      .single();
    if (mergeError || !merge) throw new InternalServerErrorException("The tables could not be pushed together.");
    const mergeId = (merge as { id: string }).id;

    const { error: memberError } = await this.sb.from("floor_table_merge_members").insert(
      group.map((tableId) => ({
        merge_id: mergeId,
        restaurant_id: a.restaurantId,
        table_id: tableId,
        seating_id: seatingOf.get(tableId) ?? null,
        joined_empty: !seatingOf.has(tableId),
      })),
    );
    if (memberError) {
      // Leave no member-less merge behind (its members cascade with it).
      await this.sb.from("floor_table_merges").delete().eq("id", mergeId).eq("restaurant_id", a.restaurantId);
      if (isUniqueViolation(memberError)) {
        throw new ConflictException({ code: "MERGE_ALREADY", message: "One of these tables is already pushed together." });
      }
      throw new InternalServerErrorException("The tables could not be pushed together.");
    }

    await this.floor.event(a, "merged", { tableId: group[0], meta: { merge_id: mergeId, table_ids: group } });
    this.floor.word(a.restaurantId, null, "merged");
    return {
      mergeId,
      tableIds: group,
      orientation,
      seats: mergedSeats(tables.map((t) => t.seats ?? null)),
    } satisfies LiveMerge;
  }

  /** Split a live merge. A waiter may split one only when they hold a member. */
  async split(a: FloorActor, mergeId: string, now = Date.now()) {
    const { data: merge, error } = await this.sb
      .from("floor_table_merges")
      .select("id, split_at")
      .eq("restaurant_id", a.restaurantId)
      .eq("id", mergeId)
      .maybeSingle();
    if (error) throw new InternalServerErrorException("The merge could not be read.");
    if (!merge) throw new NotFoundException("No such merge in this house.");
    if ((merge as { split_at: string | null }).split_at) throw new ConflictException("These tables are already split.");

    const { data: memberRows, error: membersError } = await this.sb
      .from("floor_table_merge_members")
      .select("table_id")
      .eq("restaurant_id", a.restaurantId)
      .eq("merge_id", mergeId);
    if (membersError) throw new InternalServerErrorException("The merge could not be read.");
    const tableIds = ((memberRows ?? []) as Array<{ table_id: string }>).map((m) => m.table_id);

    if (!isManagerRole(a)) {
      const house = await readFloorHouse(this.sb, a.restaurantId);
      const holders = await readHolders(this.sb, a.restaurantId, serviceDateOf(house.zone, now));
      if (!tableIds.some((id) => (holders.byTable.get(id) ?? []).includes(a.userId))) {
        throw new ForbiddenException("Only the table's waiter or a manager can split these tables.");
      }
    }

    const at = new Date().toISOString();
    const { data: done, error: splitError } = await this.sb
      .from("floor_table_merges")
      .update({ split_at: at, split_by: a.userId })
      .eq("restaurant_id", a.restaurantId)
      .eq("id", mergeId)
      .is("split_at", null)
      .select("id");
    if (splitError) throw new InternalServerErrorException("The tables could not be split.");
    if (((done ?? []) as unknown[]).length === 0) throw new ConflictException("These tables are already split.");
    const { error: freeError } = await this.sb
      .from("floor_table_merge_members")
      .update({ active: false })
      .eq("restaurant_id", a.restaurantId)
      .eq("merge_id", mergeId)
      .eq("active", true);
    if (freeError) {
      // The merge is split; a member still marked active would pin its table.
      this.logger.error(`merge ${mergeId} split but members not released: ${freeError.message}`);
      throw new InternalServerErrorException("The tables were split but one is still held. Try again.");
    }
    await this.floor.event(a, "split", { tableId: tableIds[0] ?? null, meta: { merge_id: mergeId, table_ids: tableIds } });
    this.floor.word(a.restaurantId, null, "split");
    return { mergeId, split: true, tableIds };
  }

}

/** The house's live merges, for the board. A failed read throws (never "none"). */
export async function readLiveMerges(
  sb: DatabaseService["supabase"],
  restaurantId: string,
  seatsOf: Map<string, number | null>,
): Promise<LiveMerge[]> {
  const [merges, members] = await Promise.all([
    sb.from("floor_table_merges").select("id, orientation").eq("restaurant_id", restaurantId).is("split_at", null),
    sb.from("floor_table_merge_members").select("merge_id, table_id").eq("restaurant_id", restaurantId).eq("active", true),
  ]);
  if (merges.error || members.error) throw new InternalServerErrorException("The merges could not be read.");
  const byMerge = new Map<string, string[]>();
  for (const m of (members.data ?? []) as Array<{ merge_id: string; table_id: string }>) {
    byMerge.set(m.merge_id, [...(byMerge.get(m.merge_id) ?? []), m.table_id]);
  }
  return ((merges.data ?? []) as Array<{ id: string; orientation: "horizontal" | "vertical" | null }>)
    .map((m) => {
      const tableIds = byMerge.get(m.id) ?? [];
      return {
        mergeId: m.id,
        tableIds,
        orientation: m.orientation,
        seats: mergedSeats(tableIds.map((id) => seatsOf.get(id) ?? null)),
      };
    })
    .filter((m) => m.tableIds.length > 0);
}

/** numeric(8,2) arrives as a string; a value that is not a finite number reads as no position. */
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
