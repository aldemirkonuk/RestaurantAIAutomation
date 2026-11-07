/**
 * What owners and managers change on the floor: sections, assignments, the
 * reassignment proposal, warn/late settings, Out tonight marks and till-name
 * links. Each change is written to `system_audit_log` (Reuse map: "staff and
 * settings history"), as the area tables already do.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { proposeReassignment } from "@wineops/floor-core";
import { DatabaseService } from "../database/database.service";
import { houseMembersInRoles } from "../common/tenant/live-membership";
import { WebsocketGateway } from "../websocket/websocket.gateway";
import {
  type FloorActor,
  isManagerRole,
  isUniqueViolation,
  readFloorHouse,
  requireServiceDate,
} from "./floor-common";
import { readHolders } from "./floor-holders";

@Injectable()
export class FloorAdminService {
  private readonly logger = new Logger(FloorAdminService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly ws: WebsocketGateway,
  ) {}

  private get sb() {
    return this.db.supabase;
  }

  private async audit(a: FloorActor, action: string, entityType: string, entityId: string | null, changes: Record<string, unknown>) {
    const { error } = await this.sb.from("system_audit_log").insert({
      actor_type: "user",
      actor_id: a.userId,
      action,
      entity_type: entityType,
      entity_id: entityId,
      changes,
      restaurant_id: a.restaurantId,
      reason: null,
    });
    if (error) this.logger.error(`${action} happened but the audit row failed: ${error.message}`);
  }

  private async event(a: FloorActor, kind: string, tableId: string | null, subjectUserId: string | null, meta: Record<string, unknown>) {
    const { error } = await this.sb.from("floor_events").insert({
      restaurant_id: a.restaurantId, kind, table_id: tableId, actor_id: a.userId, subject_user_id: subjectUserId, meta,
    });
    if (error) this.logger.error(`floor_events ${kind} not written: ${error.message}`);
  }

  private async assertMember(restaurantId: string, userId: string) {
    let ids: string[];
    try {
      ids = await houseMembersInRoles(this.sb, restaurantId, ["owner", "manager", "staff"]);
    } catch {
      throw new InternalServerErrorException("The house's members could not be read.");
    }
    if (!ids.includes(userId)) throw new BadRequestException("That person is not a member of this house.");
  }

  // ---------------------------------------------------------------- sections

  async sections(a: FloorActor) {
    const [s, t] = await Promise.all([
      this.sb.from("floor_sections").select("id, name, sort, archived_at").eq("restaurant_id", a.restaurantId).is("archived_at", null).order("sort"),
      this.sb.from("floor_section_tables").select("table_id, section_id").eq("restaurant_id", a.restaurantId),
    ]);
    if (s.error || t.error) throw new InternalServerErrorException("Sections could not be read.");
    const byS = new Map<string, string[]>();
    for (const r of (t.data ?? []) as Array<{ table_id: string; section_id: string }>) {
      byS.set(r.section_id, [...(byS.get(r.section_id) ?? []), r.table_id]);
    }
    return {
      sections: ((s.data ?? []) as Array<{ id: string; name: string; sort: number }>).map((x) => ({
        id: x.id, name: x.name, sort: x.sort, tableIds: byS.get(x.id) ?? [],
      })),
    };
  }

  async createSection(a: FloorActor, name: string, sort = 0) {
    const { data, error } = await this.sb
      .from("floor_sections")
      .insert({ restaurant_id: a.restaurantId, name: name.trim(), sort, created_by: a.userId, updated_by: a.userId })
      .select("id, name, sort")
      .single();
    if (isUniqueViolation(error)) throw new ConflictException("A section with that name exists.");
    if (error || !data) throw new InternalServerErrorException("The section could not be written.");
    await this.audit(a, "floor_section_created", "floor_section", data.id, { name: data.name });
    this.ws.emitFloorWord(a.restaurantId, { tableId: null, word: "sections_changed" });
    return data;
  }

  async updateSection(a: FloorActor, id: string, patch: { name?: string; sort?: number }) {
    const update: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: a.userId };
    if (patch.name !== undefined) update.name = patch.name.trim();
    if (patch.sort !== undefined) update.sort = patch.sort;
    const { data, error } = await this.sb
      .from("floor_sections").update(update).eq("id", id).eq("restaurant_id", a.restaurantId).is("archived_at", null)
      .select("id, name, sort");
    if (isUniqueViolation(error)) throw new ConflictException("A section with that name exists.");
    if (error) throw new InternalServerErrorException("The section could not be written.");
    if (!data || data.length === 0) throw new NotFoundException("No such section.");
    await this.audit(a, "floor_section_updated", "floor_section", id, patch);
    this.ws.emitFloorWord(a.restaurantId, { tableId: null, word: "sections_changed" });
    return data[0];
  }

  /** Archive, never delete: past assignments keep naming it. */
  async archiveSection(a: FloorActor, id: string) {
    const at = new Date().toISOString();
    const { data, error } = await this.sb
      .from("floor_sections").update({ archived_at: at, archived_by: a.userId })
      .eq("id", id).eq("restaurant_id", a.restaurantId).is("archived_at", null).select("id");
    if (error) throw new InternalServerErrorException("The section could not be archived.");
    if (!data || data.length === 0) throw new NotFoundException("No such section.");
    await this.sb.from("floor_assignments").update({ released_at: at, released_by: a.userId })
      .eq("restaurant_id", a.restaurantId).eq("section_id", id).is("released_at", null);
    await this.audit(a, "floor_section_archived", "floor_section", id, {});
    this.ws.emitFloorWord(a.restaurantId, { tableId: null, word: "sections_changed" });
    return { id, archived: true };
  }

  /** Replace which tables a section holds. A table sits in at most one section. */
  async setSectionTables(a: FloorActor, sectionId: string, tableIds: string[]) {
    const { data: s, error: sErr } = await this.sb.from("floor_sections").select("id")
      .eq("id", sectionId).eq("restaurant_id", a.restaurantId).is("archived_at", null).maybeSingle();
    if (sErr) throw new InternalServerErrorException("The section could not be read.");
    if (!s) throw new NotFoundException("No such section.");
    const del = await this.sb.from("floor_section_tables").delete().eq("restaurant_id", a.restaurantId).eq("section_id", sectionId);
    if (del.error) throw new InternalServerErrorException("The section's tables could not be written.");
    if (tableIds.length > 0) {
      // Moving a table here takes it out of any other section (table_id is the key).
      const ins = await this.sb.from("floor_section_tables").upsert(
        [...new Set(tableIds)].map((table_id) => ({ table_id, restaurant_id: a.restaurantId, section_id: sectionId, created_by: a.userId })),
        { onConflict: "table_id" },
      );
      // The composite FK refuses another house's table (23503).
      if (ins.error?.code === "23503") throw new BadRequestException("A table is not in this house.");
      if (ins.error) throw new InternalServerErrorException("The section's tables could not be written.");
    }
    await this.audit(a, "floor_section_tables_set", "floor_section", sectionId, { tableIds });
    this.ws.emitFloorWord(a.restaurantId, { tableId: null, word: "sections_changed" });
    return { sectionId, tableIds };
  }

  // ------------------------------------------------------------- assignments

  async assignments(a: FloorActor, now = Date.now()) {
    const house = await readFloorHouse(this.sb, a.restaurantId);
    const date = requireServiceDate(house.zone, now);
    const { data, error } = await this.sb.from("floor_assignments")
      .select("id, user_id, section_id, table_id, service_date, source, started_at")
      .eq("restaurant_id", a.restaurantId).is("released_at", null);
    if (error) throw new InternalServerErrorException("Assignments could not be read.");
    return { serviceDate: date, assignments: data ?? [] };
  }

  async assign(a: FloorActor, userId: string, target: { sectionId?: string; tableId?: string }, source: "manager" | "reassignment" = "manager", now = Date.now()) {
    if (Boolean(target.sectionId) === Boolean(target.tableId)) {
      throw new BadRequestException("Name exactly one of sectionId or tableId.");
    }
    await this.assertMember(a.restaurantId, userId);
    const house = await readFloorHouse(this.sb, a.restaurantId);
    const date = requireServiceDate(house.zone, now);
    const at = new Date(now).toISOString();
    if (target.tableId) {
      // One live holder per table: the current one is released first.
      const rel = await this.sb.from("floor_assignments").update({ released_at: at, released_by: a.userId })
        .eq("restaurant_id", a.restaurantId).eq("table_id", target.tableId).is("released_at", null).select("user_id");
      if (rel.error) throw new InternalServerErrorException("The current holder could not be released.");
    }
    const { data, error } = await this.sb.from("floor_assignments").insert({
      restaurant_id: a.restaurantId, user_id: userId, section_id: target.sectionId ?? null, table_id: target.tableId ?? null,
      service_date: date, source, started_at: at, created_by: a.userId,
    }).select("id").single();
    if (isUniqueViolation(error)) throw new ConflictException("That assignment is already live.");
    if (error?.code === "23503") throw new BadRequestException("That section or table is not in this house.");
    if (error || !data) throw new InternalServerErrorException("The assignment could not be written.");
    await this.event(a, source === "reassignment" ? "reassigned" : "assigned", target.tableId ?? null, userId, { section_id: target.sectionId ?? null, assignment_id: data.id });
    await this.audit(a, "floor_assignment_set", "floor_assignment", data.id, { userId, ...target, source });
    this.ws.emitFloorWord(a.restaurantId, { tableId: target.tableId ?? null, word: "assigned" });
    return { assignmentId: data.id };
  }

  async release(a: FloorActor, assignmentId: string) {
    const { data, error } = await this.sb.from("floor_assignments")
      .update({ released_at: new Date().toISOString(), released_by: a.userId })
      .eq("id", assignmentId).eq("restaurant_id", a.restaurantId).is("released_at", null)
      .select("id, user_id, table_id");
    if (error) throw new InternalServerErrorException("The assignment could not be released.");
    if (!data || data.length === 0) throw new NotFoundException("No such live assignment.");
    const row = data[0] as { user_id: string; table_id: string | null };
    await this.event(a, "released", row.table_id, row.user_id, { assignment_id: assignmentId });
    await this.audit(a, "floor_assignment_released", "floor_assignment", assignmentId, {});
    this.ws.emitFloorWord(a.restaurantId, { tableId: row.table_id, word: "released" });
    return { assignmentId, released: true };
  }

  /**
   * Pick 4: propose where a leaving waiter's tables go. Nothing is written.
   * floor-core decides (OD-259): a table with no section, null or "", may go
   * to anyone listed, and says `no_one_on_shift` when nobody is; each table is
   * proposed once.
   */
  async proposeReassign(a: FloorActor, fromUserId: string, now = Date.now()) {
    const house = await readFloorHouse(this.sb, a.restaurantId);
    const holders = await readHolders(this.sb, a.restaurantId, requireServiceDate(house.zone, now));
    const [tables, open] = await Promise.all([
      this.sb.from("restaurant_tables").select("id, label").eq("restaurant_id", a.restaurantId).is("hidden_at", null),
      this.sb.from("floor_seatings").select("table_id").eq("restaurant_id", a.restaurantId).is("left_at", null),
    ]);
    if (tables.error || open.error) throw new InternalServerErrorException("The floor could not be read.");
    const seated = new Set(((open.data ?? []) as Array<{ table_id: string }>).map((s) => s.table_id));
    const label = new Map(((tables.data ?? []) as Array<{ id: string; label: string }>).map((t) => [t.id, t.label]));
    const load = new Map<string, number>();
    for (const [tableId, users] of holders.byTable) {
      if (!seated.has(tableId)) continue;
      for (const u of users) load.set(u, (load.get(u) ?? 0) + 1);
    }
    const candidates = new Set<string>([...holders.sectionsOf.keys(), ...[...holders.byTable.values()].flat()]);
    candidates.delete(fromUserId);
    const proposals = proposeReassignment({
      tables: [...holders.byTable.entries()]
        .filter(([tableId, users]) => users.includes(fromUserId) && label.has(tableId))
        .map(([tableId]) => ({ tableId, label: label.get(tableId)!, sectionId: holders.sectionOf.get(tableId) || null, seated: seated.has(tableId) })),
      candidates: [...candidates].map((waiterId) => ({ waiterId, sectionIds: holders.sectionsOf.get(waiterId) ?? [], load: load.get(waiterId) ?? 0 })),
      fromWaiterId: fromUserId,
    });
    return { fromUserId, proposals };
  }

  /** Apply what a manager confirmed. A table listed twice moves once, to its first destination. */
  async applyReassign(a: FloorActor, fromUserId: string, moves: Array<{ tableId: string; toUserId: string }>, now = Date.now()) {
    const done: Array<{ tableId: string; toUserId: string; assignmentId: string }> = [];
    const movedTables = new Set<string>();
    for (const m of moves) {
      if (m.toUserId === fromUserId || movedTables.has(m.tableId)) continue;
      movedTables.add(m.tableId);
      const r = await this.assign(a, m.toUserId, { tableId: m.tableId }, "reassignment", now);
      done.push({ ...m, assignmentId: r.assignmentId });
    }
    return { fromUserId, applied: done };
  }

  // ---------------------------------------------------------------- settings

  async settings(a: FloorActor) {
    const h = await readFloorHouse(this.sb, a.restaurantId);
    return { warnAfterMin: h.warnAfterMin, lateAfterMin: h.lateAfterMin, zoneSet: Boolean(h.zone) };
  }

  async saveSettings(a: FloorActor, warnAfterMin: number, lateAfterMin: number) {
    if (lateAfterMin <= warnAfterMin) throw new BadRequestException("Late must be later than warn.");
    const before = await readFloorHouse(this.sb, a.restaurantId);
    const { error } = await this.sb.from("floor_settings").upsert(
      { restaurant_id: a.restaurantId, warn_after_min: warnAfterMin, late_after_min: lateAfterMin, updated_at: new Date().toISOString(), updated_by: a.userId },
      { onConflict: "restaurant_id" },
    );
    if (error) throw new InternalServerErrorException("The floor settings could not be written.");
    await this.audit(a, "floor_settings_changed", "floor_settings", a.restaurantId, {
      before: { warnAfterMin: before.warnAfterMin, lateAfterMin: before.lateAfterMin },
      after: { warnAfterMin, lateAfterMin },
    });
    return { warnAfterMin, lateAfterMin };
  }

  // ------------------------------------------------------------ Out tonight

  /**
   * Who may mark Out tonight. Open as OD-242, the executor's reading under
   * OD-242: owners, managers, and staff who lead the `kitchen` or `bar` area
   * (ADR 0345 Role map). Other areas' leads are OD-249. ADR 0345 § Decision
   * holds marking until OD-242 is answered; this route is dark behind the
   * house switch and is reversible in code alone.
   */
  async assertCanMarkOut(a: FloorActor) {
    if (isManagerRole(a)) return;
    const { data: members, error } = await this.sb.from("team_members").select("id")
      .eq("restaurant_id", a.restaurantId).eq("user_id", a.userId);
    if (error) throw new InternalServerErrorException("Your areas could not be read.");
    const ids = ((members ?? []) as Array<{ id: string }>).map((m) => m.id);
    if (ids.length > 0) {
      const leads = await this.sb.from("house_area_members").select("id")
        .eq("restaurant_id", a.restaurantId).in("member_id", ids).in("kind", ["kitchen", "bar"]).eq("is_lead", true);
      if (leads.error) throw new InternalServerErrorException("Your areas could not be read.");
      if ((leads.data ?? []).length > 0) return;
    }
    throw new ForbiddenException("Only managers and kitchen or bar leads mark Out tonight.");
  }

  async markOut(a: FloorActor, menuItemId: string | undefined, label: string | undefined, now = Date.now()) {
    if (Boolean(menuItemId) === Boolean(label?.trim())) throw new BadRequestException("Name exactly one of menuItemId or label.");
    await this.assertCanMarkOut(a);
    const house = await readFloorHouse(this.sb, a.restaurantId);
    const date = requireServiceDate(house.zone, now);
    const { data, error } = await this.sb.from("floor_out_tonight").insert({
      restaurant_id: a.restaurantId, menu_item_id: menuItemId ?? null, label: label?.trim() || null, service_date: date, marked_by: a.userId,
    }).select("id").single();
    if (isUniqueViolation(error)) throw new ConflictException("Already marked out tonight.");
    if (error?.code === "23503") throw new BadRequestException("That item is not on this house's menu.");
    if (error || !data) throw new InternalServerErrorException("Out tonight could not be written.");
    this.ws.emitFloorWord(a.restaurantId, { tableId: null, word: "out_tonight_changed" });
    return { id: data.id, serviceDate: date };
  }

  async backOn(a: FloorActor, id: string) {
    await this.assertCanMarkOut(a);
    const { data, error } = await this.sb.from("floor_out_tonight").update({ back_at: new Date().toISOString(), back_by: a.userId })
      .eq("id", id).eq("restaurant_id", a.restaurantId).is("back_at", null).select("id");
    if (error) throw new InternalServerErrorException("Out tonight could not be written.");
    if (!data || data.length === 0) throw new NotFoundException("No such live mark.");
    this.ws.emitFloorWord(a.restaurantId, { tableId: null, word: "out_tonight_changed" });
    return { id, back: true };
  }

  // ------------------------------------------------------- till-name links (E4)

  async posLinks(a: FloorActor) {
    const { data, error } = await this.sb.from("pos_server_links")
      .select("id, source, till_server_id, till_server_name, user_id, state, proposed_at, proposed_reason, confirmed_at, unlinked_at")
      .eq("restaurant_id", a.restaurantId).order("proposed_at", { ascending: false });
    if (error) throw new InternalServerErrorException("Till links could not be read.");
    // An unlinked or proposed name is printed as itself, never as a person (E4).
    return { links: data ?? [] };
  }

  async confirmLink(a: FloorActor, id: string, userId?: string) {
    const { data: row, error: rErr } = await this.sb.from("pos_server_links").select("id, user_id, state")
      .eq("id", id).eq("restaurant_id", a.restaurantId).maybeSingle();
    if (rErr) throw new InternalServerErrorException("The till link could not be read.");
    if (!row) throw new NotFoundException("No such till link.");
    const person = userId ?? (row as { user_id: string | null }).user_id;
    if (!person) throw new BadRequestException("Name the person this till name is.");
    await this.assertMember(a.restaurantId, person);
    const { error } = await this.sb.from("pos_server_links").update({
      user_id: person, state: "confirmed", confirmed_at: new Date().toISOString(), confirmed_by: a.userId, unlinked_at: null, unlinked_by: null,
    }).eq("id", id).eq("restaurant_id", a.restaurantId);
    if (isUniqueViolation(error)) throw new ConflictException("This till name is already confirmed to someone.");
    if (error) throw new InternalServerErrorException("The till link could not be written.");
    await this.audit(a, "pos_server_link_confirmed", "pos_server_link", id, { userId: person, before: (row as { state: string }).state });
    return { id, state: "confirmed", userId: person };
  }

  async unlink(a: FloorActor, id: string) {
    const { data, error } = await this.sb.from("pos_server_links").update({
      state: "unlinked", unlinked_at: new Date().toISOString(), unlinked_by: a.userId,
    }).eq("id", id).eq("restaurant_id", a.restaurantId).neq("state", "unlinked").select("id");
    if (error) throw new InternalServerErrorException("The till link could not be written.");
    if (!data || data.length === 0) throw new NotFoundException("No such linked till name.");
    await this.audit(a, "pos_server_link_unlinked", "pos_server_link", id, {});
    return { id, state: "unlinked" };
  }
}
