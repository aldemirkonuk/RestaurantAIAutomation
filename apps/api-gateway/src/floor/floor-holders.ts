/**
 * Who holds a table right now: the person on its live table assignment, else
 * every person on a live assignment to its section. A table nobody holds has
 * an empty list, never a guessed person.
 *
 * "Live" is `released_at IS NULL`. Section assignments also carry the service
 * date; one from an earlier date is not read as holding today's table.
 */
import { InternalServerErrorException } from "@nestjs/common";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface HolderRead {
  /** tableId → user ids holding it (one for a table assignment). */
  byTable: Map<string, string[]>;
  /** tableId → sectionId, for every table placed in a live section. */
  sectionOf: Map<string, string>;
  /** userId → section ids they hold today. */
  sectionsOf: Map<string, string[]>;
}

export async function readHolders(
  sb: SupabaseClient,
  restaurantId: string,
  serviceDate: string | null,
): Promise<HolderRead> {
  const [assign, placed, live] = await Promise.all([
    sb
      .from("floor_assignments")
      .select("user_id, table_id, section_id, service_date")
      .eq("restaurant_id", restaurantId)
      .is("released_at", null),
    sb.from("floor_section_tables").select("table_id, section_id").eq("restaurant_id", restaurantId),
    sb
      .from("floor_sections")
      .select("id")
      .eq("restaurant_id", restaurantId)
      .is("archived_at", null),
  ]);
  if (assign.error || placed.error || live.error) {
    throw new InternalServerErrorException("The floor's assignments could not be read.");
  }
  const liveSections = new Set(((live.data ?? []) as Array<{ id: string }>).map((s) => s.id));
  const sectionOf = new Map<string, string>();
  for (const r of (placed.data ?? []) as Array<{ table_id: string; section_id: string }>) {
    if (liveSections.has(r.section_id)) sectionOf.set(r.table_id, r.section_id);
  }
  const byTable = new Map<string, string[]>();
  const bySection = new Map<string, string[]>();
  const sectionsOf = new Map<string, string[]>();
  for (const a of (assign.data ?? []) as Array<{
    user_id: string;
    table_id: string | null;
    section_id: string | null;
    service_date: string;
  }>) {
    if (a.table_id) {
      byTable.set(a.table_id, [a.user_id]);
    } else if (a.section_id && (serviceDate === null || a.service_date === serviceDate)) {
      bySection.set(a.section_id, [...(bySection.get(a.section_id) ?? []), a.user_id]);
      sectionsOf.set(a.user_id, [...(sectionsOf.get(a.user_id) ?? []), a.section_id]);
    }
  }
  for (const [tableId, sectionId] of sectionOf) {
    if (!byTable.has(tableId) && bySection.has(sectionId)) {
      byTable.set(tableId, [...(bySection.get(sectionId) as string[])].sort());
    }
  }
  return { byTable, sectionOf, sectionsOf };
}
