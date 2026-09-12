import * as fs from "fs";
import * as path from "path";

/**
 * ADR 0078 — a count is a record.
 *
 * WHY THESE ASSERTIONS ARE ON THE SQL TEXT AND NOT ON A MOCK
 * ----------------------------------------------------------
 * The properties that make an agreeing count recordable, and a retried count
 * recorded once, live entirely in Postgres:
 *
 *   * the INSERT into stock_counts sits ABOVE every branch on the delta;
 *   * `idempotency_key` is NOT NULL and UNIQUE, and the replay gate reads it
 *     before the INSERT runs.
 *
 * A jest test against a mocked Supabase client cannot execute any of that. It
 * would assert its own `mockResolvedValue` and pass identically if the function
 * body were empty — the exact vacuity this repo's `absence-reported-as-health`
 * note warns about, and the same trap `inventory.service.spec.ts` documented at
 * "this assertion would now pass VACUOUSLY".
 *
 * So the mechanism is checked where it is written. These are structural claims
 * about a file, honestly scoped: they prove the shipped SQL has the shape the
 * ADR claims, NOT that Postgres executed it. Runtime behaviour is only provable
 * against a live database, which CI does not have.
 */

const MIGRATION = path.resolve(
  __dirname,
  "../../../../supabase/migrations/20260902190000_a_count_is_a_record.sql",
);

describe("stock_counts migration (ADR 0078)", () => {
  let sql: string;

  beforeAll(() => {
    // Not `try { } catch { skip }`. A missing migration is a FAILURE — a test
    // that quietly passes when its subject is absent is the fault this ADR is
    // about.
    expect(fs.existsSync(MIGRATION)).toBe(true);
    sql = fs.readFileSync(MIGRATION, "utf8");
    expect(sql.length).toBeGreaterThan(500);
  });

  it("creates the table with the four columns the ADR names", () => {
    expect(sql).toMatch(/create table if not exists public\.stock_counts/i);
    for (const col of [
      "restaurant_id",
      "inventory_id",
      "expected_qty",
      "counted_qty",
      "counted_at",
      "counted_by",
    ]) {
      expect(sql).toContain(col);
    }
  });

  it("points the actor FK at public.users(user_id), never auth.users", () => {
    expect(sql).toMatch(
      /counted_by\s+uuid\s+references public\.users\(user_id\)/i,
    );
    // auth.users and public.users are DISJOINT in this database: an FK to
    // auth.users 23503s on every write and CI cannot catch it, because a fresh
    // database has no rows to violate.
    expect(sql).not.toMatch(/references\s+auth\.users/i);
  });

  it("makes the idempotency key mandatory and unique, so a retry cannot be two counts", () => {
    expect(sql).toMatch(/idempotency_key\s+text\s+not null\s+unique/i);
  });

  it("INSERTs the count BEFORE any branch on the delta", () => {
    const body = sql.slice(sql.indexOf("create or replace function"));
    const insertAt = body.indexOf("INSERT INTO public.stock_counts");
    const deltaBranchAt = body.indexOf("IF v_delta <> 0");

    expect(insertAt).toBeGreaterThan(-1);
    expect(deltaBranchAt).toBeGreaterThan(-1);
    // This ordering IS the fix. Below the branch, the row would only exist when
    // the count disagreed — which is precisely the state the ledger was already
    // in, and which makes any variance rate 1.0 by construction.
    expect(insertAt).toBeLessThan(deltaBranchAt);
  });

  it("reads the expected quantity from lots under the row lock, not from the stock_live projection", () => {
    const body = sql.slice(sql.indexOf("create or replace function"));
    const lockAt = body.indexOf("FOR UPDATE");
    const readAt = body.indexOf("SELECT COALESCE(SUM(qty), 0) INTO v_expected");

    expect(lockAt).toBeGreaterThan(-1);
    expect(readAt).toBeGreaterThan(-1);
    // Lock BEFORE read — the A11 discipline. A read taken before the lock races
    // the movements the count is measuring.
    expect(lockAt).toBeLessThan(readAt);
    // And it must be the lot sum, not the trigger-maintained projection, or
    // expected_qty could disagree with the delta actually applied.
    expect(body).not.toMatch(/INTO v_expected[\s\S]{0,200}stock_live/i);
  });

  it("gates a replay before the INSERT, sharing the movement's key", () => {
    const body = sql.slice(sql.indexOf("create or replace function"));
    const gateAt = body.indexOf(
      "SELECT * INTO v_count FROM public.stock_counts",
    );
    const insertAt = body.indexOf("INSERT INTO public.stock_counts");
    expect(gateAt).toBeGreaterThan(-1);
    expect(gateAt).toBeLessThan(insertAt);
    // One gate for both, because both carry the same key.
    expect(body).toMatch(/p_idempotency_key\s*$|p_idempotency_key\s*\n/m);
  });

  it("arrives locked down — RLS enabled with an explicit policy, in this same migration", () => {
    expect(sql).toMatch(
      /alter table public\.stock_counts enable row level security/i,
    );
    // RLS-with-no-policy is closed only by ABSENCE; the next person to add one
    // silently opens the whole table (OD-73's house rule).
    expect(sql).toMatch(/create policy stock_counts_service_role/i);
  });

  it("is additive — it does not drop last_counted_at or alter set_stock_absolute", () => {
    expect(sql).not.toMatch(/drop\s+column[\s\S]{0,60}last_counted_at/i);
    expect(sql).not.toMatch(
      /create or replace function public\.set_stock_absolute/i,
    );
    expect(sql).not.toMatch(/drop\s+table/i);
  });
});
