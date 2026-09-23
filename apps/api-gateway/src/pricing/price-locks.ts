import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Reading a house's open price locks (ADR 0193 round 3). A plain function,
 * like `readHouseTargetMargin`: the advice, the accept, the lock list and the
 * menu plan all read the same rows the same way, and a failed read is
 * RETURNED as an error for each of them to refuse on -- never an empty list,
 * because "no lock" is exactly what a failed read must not be taken for (L25).
 */

export type LockKind = "bottle" | "glass";

export interface OpenLock {
  lockId: string;
  inventoryId: string;
  kind: LockKind;
  lockedPrice: number;
  lockedBy: string;
  lockedAt: string;
  note: string | null;
  movedFromLockId: string | null;
}

/** PostgREST's max_rows (supabase/config.toml): a page never holds more. */
const PAGE_ROWS = 1000;

const LOCK_SELECT =
  "id, inventory_id, kind, locked_price, locked_by, locked_at, note, moved_from_lock_id";

export function lockFromRow(r: Record<string, unknown>): OpenLock {
  return {
    lockId: String(r.id),
    inventoryId: String(r.inventory_id),
    kind: r.kind === "glass" ? "glass" : "bottle",
    lockedPrice: Number(r.locked_price),
    lockedBy: String(r.locked_by),
    lockedAt: String(r.locked_at),
    note: typeof r.note === "string" ? r.note : null,
    movedFromLockId: typeof r.moved_from_lock_id === "string" ? r.moved_from_lock_id : null,
  };
}

/**
 * The house's OPEN locks -- every one, or one wine's (and optionally one
 * kind's). Keyset-paged, so a long list is never cut at PostgREST's page size
 * without saying so. `error` is set (and `locks` empty) when any page failed.
 */
export async function readOpenLocks(
  client: SupabaseClient,
  restaurantId: string,
  only: { inventoryId?: string; kind?: LockKind } = {},
): Promise<{ locks: OpenLock[]; error: string | null }> {
  const out: OpenLock[] = [];
  let after: string | null = null;
  for (;;) {
    let query = client
      .from("house_price_locks")
      .select(LOCK_SELECT)
      .eq("restaurant_id", restaurantId)
      .is("released_at", null);
    if (only.inventoryId) query = query.eq("inventory_id", only.inventoryId);
    if (only.kind) query = query.eq("kind", only.kind);
    if (after) query = query.gt("id", after);
    const { data, error } = await query.order("id", { ascending: true }).limit(PAGE_ROWS);
    if (error) return { locks: [], error: error.message };
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    out.push(...rows.map(lockFromRow));
    if (rows.length < PAGE_ROWS) break;
    after = String(rows[rows.length - 1].id);
  }
  return { locks: out, error: null };
}

/** `inventoryId:kind` -> the open lock, for the readers that ask per wine and kind. */
export function lockIndex(locks: OpenLock[]): Map<string, OpenLock> {
  return new Map(locks.map((l) => [`${l.inventoryId}:${l.kind}`, l]));
}

/** "2026-09-21" from a timestamp, for sentences. */
export function dayOf(iso: string | null | undefined): string {
  return iso ? String(iso).slice(0, 10) : "an unknown day";
}

/**
 * The people behind some acts, by `public.users.user_id`. A failed read is
 * RETURNED (L25: "locked by" is never silently blank), never an empty map
 * passed off as "nobody has a name".
 */
export async function readPeople(
  client: SupabaseClient,
  ids: Array<string | null | undefined>,
): Promise<{
  people: Map<string, { name: string | null; role: string | null; restaurantId: string | null }>;
  error: string | null;
}> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  const people = new Map<string, { name: string | null; role: string | null; restaurantId: string | null }>();
  if (unique.length === 0) return { people, error: null };
  const { data, error } = await client
    .from("users")
    .select("user_id, name, role, restaurant_id")
    .in("user_id", unique);
  if (error) return { people, error: error.message };
  for (const u of (data ?? []) as Array<Record<string, unknown>>) {
    people.set(String(u.user_id), {
      name: typeof u.name === "string" ? u.name : null,
      role: typeof u.role === "string" ? u.role : null,
      restaurantId: typeof u.restaurant_id === "string" ? u.restaurant_id : null,
    });
  }
  return { people, error: null };
}
