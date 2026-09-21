/**
 * The grant functions of 20260921114700 / 20260921114800, modelled over the
 * producers' in-memory store for the gateway specs.
 *
 * WHY A MODEL AND NOT A STUB
 * --------------------------
 * The services under test (`AuthorityGrantsService`, the vendor-send gates)
 * call these functions and read back what they wrote. A stub that answered
 * "ok" would let a service that never reached the ledger pass. So each
 * function here does what its SQL does — the same owner check, the same
 * state preconditions, the same row changes and one appended security event —
 * against the same tables the services read. The SQL itself is proven on a
 * real database built from every migration (PGlite probe
 * `p4-scratch/pglite-probe/E-r2-migrations.mjs`); this file is only what lets
 * a TypeScript spec exercise the service around it.
 *
 * The one thing it does NOT model is the latch trigger on the role tables;
 * `latchGrantsOf` below is what a spec calls to stand for a demotion.
 */

import type { FakeDb, Row } from "../../notifications/producers/testing/fake-db";

function isOwner(db: FakeDb, userId: string | null | undefined, house: string): boolean {
  if (!userId) return false;
  const access = (db.tables.user_restaurant_access ?? []).find(
    (a) => a.user_id === userId && a.restaurant_id === house && a.is_active && String(a.role ?? "").trim() !== "",
  );
  if (access) return String(access.role).trim().toLowerCase() === "owner";
  const legacy = (db.tables.users ?? []).find((u) => u.user_id === userId && u.restaurant_id === house);
  return String(legacy?.role ?? "").trim().toLowerCase() === "owner";
}

function append(db: FakeDb, house: string, kind: string, actor: string | null, subject: string | null, detail: Row) {
  const events = db.tables.security_events ?? (db.tables.security_events = []);
  const seq = events.filter((e) => e.restaurant_id === house).length + 1;
  const row = {
    id: db.id("sev"),
    restaurant_id: house,
    seq,
    kind,
    actor_user_id: actor,
    subject_kind: "authority_grant",
    subject_id: subject,
    detail,
    occurred_at: new Date().toISOString(),
  };
  events.push(row);
  return row;
}

const refused = (message: string) => ({ data: null, error: { code: "42501", message } });

function waiting(db: FakeDb, g: Row, house: string): boolean {
  return !!g.suspended_at || !g.vouched_by_user_id || !isOwner(db, g.vouched_by_user_id, house);
}

/** Register the grant functions on this store. Returns it for chaining. */
export function installGrantLedger(db: FakeDb): FakeDb {
  db.tables.authority_grants = db.tables.authority_grants ?? [];
  db.tables.security_events = db.tables.security_events ?? [];
  const grants = () => db.tables.authority_grants;

  db.rpcHandlers.authority_grant_issue = (a) => {
    if (!isOwner(db, a.p_actor, a.p_house)) return refused("only an owner of this house may issue a grant");
    const now = new Date().toISOString();
    const g = {
      id: db.id("grant"),
      restaurant_id: a.p_house,
      grantor_user_id: a.p_actor,
      grantee_user_id: a.p_grantee,
      scope: "vendor_send",
      limit_amount: a.p_limit_amount,
      limit_currency: a.p_limit_currency,
      expires_at: a.p_expires_at,
      created_at: now,
      revoked_at: null,
      revoked_by_user_id: null,
      vouched_by_user_id: a.p_actor,
      vouched_at: now,
      suspended_at: null,
      suspended_reason: null,
      owner_only: a.p_owner_only === true,
      deleted_at: null,
      deleted_by_user_id: null,
    };
    grants().push(g);
    append(db, a.p_house, "grant_issued", a.p_actor, g.id, { grantee: a.p_grantee, sealId: a.p_seal_id });
    return { data: g, error: null };
  };

  db.rpcHandlers.authority_grant_revoke = (a) => {
    if (!isOwner(db, a.p_actor, a.p_house)) return refused("only an owner of this house may revoke a grant");
    const g = grants().find((r) => r.id === a.p_grant && r.restaurant_id === a.p_house && !r.revoked_at && !r.deleted_at);
    if (!g) return { data: null, error: null };
    Object.assign(g, { revoked_at: new Date().toISOString(), revoked_by_user_id: a.p_actor });
    append(db, a.p_house, "grant_revoked", a.p_actor, g.id, { sealId: a.p_seal_id });
    return { data: g, error: null };
  };

  db.rpcHandlers.authority_grant_reapprove = (a) => {
    if (!isOwner(db, a.p_actor, a.p_house)) return refused("only a current owner of this house may re-approve a grant");
    const g = grants().find((r) => r.id === a.p_grant && r.restaurant_id === a.p_house);
    if (!g || g.revoked_at || g.deleted_at || (g.expires_at && new Date(g.expires_at).getTime() <= Date.now())) {
      return { data: null, error: null };
    }
    if (!waiting(db, g, a.p_house)) return { data: null, error: null };
    if (a.p_actor === g.grantee_user_id) return refused("a person cannot re-approve their own grant");
    const previous = g.vouched_by_user_id;
    Object.assign(g, {
      vouched_by_user_id: a.p_actor,
      vouched_at: new Date().toISOString(),
      suspended_at: null,
      suspended_reason: null,
    });
    append(db, a.p_house, "grant_reapproved", a.p_actor, g.id, { previousVoucher: previous, sealId: a.p_seal_id });
    return { data: g, error: null };
  };

  db.rpcHandlers.authority_grant_delete = (a) => {
    if (!isOwner(db, a.p_actor, a.p_house)) return refused("only an owner of this house may delete a grant");
    const g = grants().find((r) => r.id === a.p_grant && r.restaurant_id === a.p_house);
    if (!g || g.deleted_at || g.revoked_at || !waiting(db, g, a.p_house)) return { data: null, error: null };
    Object.assign(g, { deleted_at: new Date().toISOString(), deleted_by_user_id: a.p_actor });
    append(db, a.p_house, "grant_deleted", a.p_actor, g.id, { sealId: a.p_seal_id });
    return { data: g, error: null };
  };

  db.rpcHandlers.authority_grant_set_owner_only = (a) => {
    if (!isOwner(db, a.p_actor, a.p_house)) return refused("only an owner of this house may change who sees a grant");
    const g = grants().find(
      (r) => r.id === a.p_grant && r.restaurant_id === a.p_house && !r.deleted_at && (r.owner_only === true) !== a.p_owner_only,
    );
    if (!g) return { data: null, error: null };
    g.owner_only = a.p_owner_only;
    append(db, a.p_house, "grant_visibility_changed", a.p_actor, g.id, { ownerOnly: a.p_owner_only });
    return { data: g, error: null };
  };

  db.rpcHandlers.authority_grant_relied_on = (a) => {
    const g = grants().find((r) => r.id === a.p_grant && r.restaurant_id === a.p_house && r.grantee_user_id === a.p_actor);
    if (!g) return { data: null, error: { message: "that grant does not name this person in this house" } };
    return { data: append(db, a.p_house, "grant_relied_on", a.p_actor, g.id, { act: a.p_act, subject: a.p_subject }), error: null };
  };

  return db;
}

/** What the database's latch trigger does when `voucher` stops being an owner of `house`. */
export function latchGrantsOf(db: FakeDb, voucher: string, house: string, reason = "voucher_no_longer_owner"): number {
  let n = 0;
  for (const g of db.tables.authority_grants ?? []) {
    if (g.restaurant_id !== house || g.vouched_by_user_id !== voucher) continue;
    if (g.suspended_at || g.revoked_at || g.deleted_at) continue;
    Object.assign(g, { suspended_at: new Date().toISOString(), suspended_reason: reason });
    append(db, house, "grant_suspended", null, g.id, { voucher, reason });
    n += 1;
  }
  return n;
}

/** A grant row as the migration's backfill leaves it, for seeding a spec's store directly. */
export function grantRow(over: Row): Row {
  const now = new Date().toISOString();
  return {
    scope: "vendor_send",
    limit_amount: null,
    limit_currency: null,
    expires_at: null,
    created_at: now,
    revoked_at: null,
    revoked_by_user_id: null,
    vouched_at: now,
    suspended_at: null,
    suspended_reason: null,
    owner_only: false,
    deleted_at: null,
    deleted_by_user_id: null,
    ...over,
    vouched_by_user_id: over.vouched_by_user_id === undefined ? over.grantor_user_id : over.vouched_by_user_id,
  };
}
