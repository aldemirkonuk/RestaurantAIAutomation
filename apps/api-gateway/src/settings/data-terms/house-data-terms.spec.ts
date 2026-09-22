/**
 * An owner accepting the house's data terms — the act that turns Jev on (ADR
 * 0207 round 4; the founder, 2026-09-22, round 6y: "owner only, but also we're
 * going to use this as complete data and privacy usage, they have to accept
 * that, and when they do they'd accept the jev too with their names and
 * sensitive topics redacted").
 *
 * The real HouseDataTermsService, the real SealChallengeService, the real
 * OrganizationsService (the role read) and the real SettingsAuditService run
 * over an in-memory PostgREST double that honours its filters, spends a seal
 * once, and refuses a second acceptance of one version the way the table's
 * UNIQUE constraint does.
 *
 * [Last call, 2026-09-22: the acceptance route had no spec at all — its owner
 * gate could be deleted with every test green. The `fact` statements' evidence
 * is checked here too (the design's rule 1): a statement the terms make about
 * where the house's data goes must point at something that exists.]
 */

import { ConflictException, ForbiddenException } from "@nestjs/common";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { HouseDataTermsService } from "./house-data-terms.service";
import { STATEMENTS, TERMS_VERSION, digest } from "./house-data-terms";
import { SealChallengeService } from "../../common/seal/seal-challenge.service";
import { OrganizationsService } from "../../organizations/organizations.service";
import { SettingsAuditService } from "../../settings-audit/settings-audit.service";

type Row = Record<string, any>;

class FakeQuery {
  private filters: ((r: Row) => boolean)[] = [];
  private orderKey: string | null = null;
  private desc = false;
  private limitN: number | null = null;
  private single = false;
  private returning = false;
  private write: { kind: "insert" | "update"; row: Row } | null = null;

  constructor(
    private readonly db: FakeDb,
    private readonly table: string,
  ) {}

  select() {
    if (this.write) this.returning = true;
    return this;
  }
  eq(col: string, v: unknown) {
    this.filters.push((r) => r[col] === v);
    return this;
  }
  is(col: string, v: unknown) {
    this.filters.push((r) => (r[col] ?? null) === v);
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orderKey = col;
    this.desc = opts?.ascending === false;
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  maybeSingle() {
    this.single = true;
    return this;
  }
  insert(row: Row) {
    this.write = { kind: "insert", row };
    return this;
  }
  update(row: Row) {
    this.write = { kind: "update", row };
    return this;
  }
  then(
    resolve: (v: { data: any; error: any }) => unknown,
    reject?: (e: unknown) => unknown,
  ) {
    try {
      return Promise.resolve(resolve(this.run())).catch(reject);
    } catch (e) {
      return Promise.reject(e).catch(reject);
    }
  }
  private run(): { data: any; error: any } {
    const fail = this.db.failures[this.table];
    if (fail) return { data: null, error: { code: "57014", message: fail } };
    const t = (this.db.tables[this.table] ??= []);
    if (this.write?.kind === "insert") {
      const row: Row = { id: `${this.table}-${t.length + 1}`, ...this.write.row };
      if (
        this.table === "house_data_terms_acceptances" &&
        t.some(
          (r) =>
            r.restaurant_id === row.restaurant_id &&
            r.terms_version === row.terms_version,
        )
      )
        return {
          data: null,
          error: { code: "23505", message: "duplicate key value" },
        };
      t.push(row);
      this.db.writes.push({ table: this.table, kind: "insert", row });
      return { data: this.returning ? [row] : null, error: null };
    }
    if (this.write?.kind === "update") {
      const hit = t.filter((r) => this.filters.every((f) => f(r)));
      for (const r of hit) Object.assign(r, this.write.row);
      this.db.writes.push({ table: this.table, kind: "update", row: this.write.row });
      return { data: this.returning ? hit : null, error: null };
    }
    let rows = t.filter((r) => this.filters.every((f) => f(r)));
    if (this.orderKey) {
      const k = this.orderKey;
      rows = [...rows].sort((a, b) => (a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0));
      if (this.desc) rows.reverse();
    }
    if (this.limitN !== null) rows = rows.slice(0, this.limitN);
    if (this.single) return { data: rows[0] ?? null, error: null };
    return { data: rows, error: null };
  }
}

class FakeDb {
  tables: Record<string, Row[]> = {};
  failures: Record<string, string> = {};
  writes: { table: string; kind: string; row: Row }[] = [];
  from(table: string) {
    return new FakeQuery(this, table);
  }
}

const A = "house-A";

function make() {
  const db = new FakeDb();
  db.tables.restaurants = [{ id: A, vendor_tone_scoring_enabled: false }];
  db.tables.user_restaurant_access = [
    { user_id: "owner-a", restaurant_id: A, role: "owner", is_active: true },
    { user_id: "owner-a2", restaurant_id: A, role: "owner", is_active: true },
    { user_id: "manager-a", restaurant_id: A, role: "manager", is_active: true },
    { user_id: "staff-a", restaurant_id: A, role: "staff", is_active: true },
  ];
  db.tables.users = [{ user_id: "owner-a", name: "Owner A" }];
  db.tables.house_data_terms_acceptances = [];
  db.tables.mcp_seal_challenges = [];
  db.tables.system_audit_log = [];
  const dbs = { supabase: db, client: db, getClient: () => db } as never;
  const terms = new HouseDataTermsService(
    dbs,
    new SettingsAuditService(dbs),
    new SealChallengeService(dbs),
    new OrganizationsService(dbs),
  );
  return { db, terms };
}

const on = (db: FakeDb) =>
  db.tables.restaurants.find((r) => r.id === A)!.vendor_tone_scoring_enabled;

describe("accepting the house's data terms turns Jev on — owner only, sealed", () => {
  it("an owner holds, accepts the current terms, and Jev is on: one sealed owner row, audited", async () => {
    const { db, terms } = make();
    const { challenge } = await terms.issueSealChallenge(A, "owner-a");
    const receipt = await terms.accept(A, "owner-a", TERMS_VERSION, digest(), challenge);
    expect(receipt).toMatchObject({ accepted: true, switchTurnedOn: true, audited: true });
    expect(db.tables.house_data_terms_acceptances).toHaveLength(1);
    expect(db.tables.house_data_terms_acceptances[0]).toMatchObject({
      restaurant_id: A,
      terms_version: TERMS_VERSION,
      terms_digest: digest(),
      accepted_by: "owner-a",
      accepted_by_role: "owner",
      seal_id: db.tables.mcp_seal_challenges[0].id,
    });
    expect(db.tables.mcp_seal_challenges[0].redeemed_at).toBeTruthy();
    expect(on(db)).toBe(true);
    expect(
      db.tables.system_audit_log.some(
        (r) => r.action === "house_data_terms_accepted" && r.actor_id === "owner-a",
      ),
    ).toBe(true);
    expect(await terms.effectiveAcceptance(A)).toEqual({ ok: true, current: true });
  });

  it.each(["manager-a", "staff-a"])(
    "%s can neither mint the seal nor accept — 403, nothing recorded, Jev stays off",
    async (who) => {
      const { db, terms } = make();
      await expect(terms.issueSealChallenge(A, who)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      // Even carrying an owner's seal, the acceptance is refused on the role.
      const { challenge } = await terms.issueSealChallenge(A, "owner-a");
      await expect(
        terms.accept(A, who, TERMS_VERSION, digest(), challenge),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(db.tables.house_data_terms_acceptances).toHaveLength(0);
      expect(db.tables.mcp_seal_challenges[0].redeemed_at ?? null).toBeNull();
      expect(on(db)).toBe(false);
    },
  );

  it("a seal minted while the person was an owner is not spendable once they are a manager", async () => {
    const { db, terms } = make();
    const { challenge } = await terms.issueSealChallenge(A, "owner-a");
    db.tables.user_restaurant_access.find((r) => r.user_id === "owner-a")!.role =
      "manager";
    await expect(
      terms.accept(A, "owner-a", TERMS_VERSION, digest(), challenge),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.tables.house_data_terms_acceptances).toHaveLength(0);
    expect(db.tables.mcp_seal_challenges[0].redeemed_at ?? null).toBeNull();
    expect(on(db)).toBe(false);
  });

  it("a stale version or digest is 409 — nothing recorded and the seal not spent", async () => {
    const { db, terms } = make();
    const { challenge } = await terms.issueSealChallenge(A, "owner-a");
    await expect(
      terms.accept(A, "owner-a", TERMS_VERSION, "0".repeat(64), challenge),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      terms.accept(A, "owner-a", TERMS_VERSION + 1, digest(), challenge),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(db.tables.house_data_terms_acceptances).toHaveLength(0);
    expect(db.tables.mcp_seal_challenges[0].redeemed_at ?? null).toBeNull();
    expect(on(db)).toBe(false);
  });

  it("no seal, no acceptance", async () => {
    const { db, terms } = make();
    await expect(
      terms.accept(A, "owner-a", TERMS_VERSION, digest(), null),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.tables.house_data_terms_acceptances).toHaveLength(0);
    expect(on(db)).toBe(false);
  });

  it("a second owner accepting the same version is a success with still one row", async () => {
    const { db, terms } = make();
    const first = await terms.issueSealChallenge(A, "owner-a");
    await terms.accept(A, "owner-a", TERMS_VERSION, digest(), first.challenge);
    const second = await terms.issueSealChallenge(A, "owner-a2");
    const receipt = await terms.accept(
      A,
      "owner-a2",
      TERMS_VERSION,
      digest(),
      second.challenge,
    );
    expect(receipt).toMatchObject({ accepted: true });
    expect(db.tables.house_data_terms_acceptances).toHaveLength(1);
  });

  it("a readout whose switch cannot be read says so — never 'off'", async () => {
    const { db, terms } = make();
    db.failures.restaurants = "statement timeout";
    const r = await terms.read(A);
    expect(r.readable).toBe(false);
    expect(r.reason).toContain("statement timeout");
  });
});

describe("the terms' fact statements point at something that exists (design rule 1)", () => {
  const ROOT = join(__dirname, "..", "..", "..", "..", "..");
  const facts = STATEMENTS.filter((s) => s.kind === "fact");

  it("has fact statements, each with evidence", () => {
    expect(facts.length).toBeGreaterThan(0);
    for (const f of facts) expect(f.evidence.length).toBeGreaterThan(0);
  });

  it.each(facts.flatMap((f) => f.evidence.map((e) => [f.key, e] as const)))(
    "%s: %s exists, and reaches the line it cites",
    (_key, evidence) => {
      const [path, lines] = evidence.split(":");
      const file = join(ROOT, path);
      expect(existsSync(file)).toBe(true);
      if (lines) {
        const last = Number(lines.split("-").pop());
        expect(readFileSync(file, "utf8").split("\n").length).toBeGreaterThanOrEqual(last);
      }
    },
  );
});
