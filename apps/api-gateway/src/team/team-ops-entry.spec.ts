import "reflect-metadata";
import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
  ParseUUIDPipe,
} from "@nestjs/common";
import { ROUTE_ARGS_METADATA } from "@nestjs/common/constants";
import { TeamController } from "./team.controller";
import { TeamService } from "./team.service";
import { PerformanceService } from "./performance.service";
import { asDatabaseService, makeStubDb, StubDb } from "./testing/supabase-stub";

/**
 * The two legacy-only team acts carried onto the Mudavym page (founder,
 * 2026-09-26, round 8, item 51): removing a coverage rule, and entering sales
 * by hand — one service, or several at once.
 *
 * Each route takes its house from the PATH and admits the caller through
 * `assertAccess(userId, rid, "manager")` — an active access row in THAT house.
 * These specs pin the admission for each route, the tenant filter on each
 * write, the exact row a sales write puts in `server_sales`, and the three
 * answers that used to be silent (a removed-nothing delete, a skipped batch
 * row, a failed read that read as empty).
 */

const RID = "11111111-1111-4111-8111-111111111111";
const OTHER_RID = "22222222-2222-4222-8222-222222222222";

const MANAGER = "user-manager";
const STAFF = "user-staff";
const OUTSIDER = "user-outsider"; // a manager — of the OTHER house only

const RULE = "33333333-3333-4333-8333-333333333333";
const OTHER_RULE = "44444444-4444-4444-8444-444444444444";
const ANA = "55555555-5555-4555-8555-555555555555";
const BO = "66666666-6666-4666-8666-666666666666";
const FOREIGN_MEMBER = "77777777-7777-4777-8777-777777777777";

function seed(errors: Record<string, { message: string }> = {}): StubDb {
  return makeStubDb(
    {
      user_restaurant_access: [
        { id: "a1", user_id: MANAGER, restaurant_id: RID, role: "manager", is_active: true },
        { id: "a2", user_id: STAFF, restaurant_id: RID, role: "staff", is_active: true },
        { id: "a3", user_id: OUTSIDER, restaurant_id: OTHER_RID, role: "manager", is_active: true },
      ],
      users: [
        { user_id: MANAGER, restaurant_id: RID, role: "manager" },
        { user_id: STAFF, restaurant_id: RID, role: "staff" },
        { user_id: OUTSIDER, restaurant_id: OTHER_RID, role: "manager" },
      ],
      team_members: [
        { id: ANA, restaurant_id: RID, display_name: "Ana" },
        { id: BO, restaurant_id: RID, display_name: "Bo" },
        { id: FOREIGN_MEMBER, restaurant_id: OTHER_RID, display_name: "Zed" },
      ],
      coverage_templates: [
        { id: RULE, restaurant_id: RID, day_of_week: 5, shift_period: "pm", role: "Floor", min_staff: 3 },
        { id: OTHER_RULE, restaurant_id: OTHER_RID, day_of_week: null, shift_period: "am", role: "Bar", min_staff: 1 },
      ],
      server_sales: [],
    },
    errors,
  );
}

function build(db: StubDb) {
  const team = new TeamService(asDatabaseService(db));
  const perf = new PerformanceService(asDatabaseService(db), team);
  jest.spyOn((team as any).logger, "error").mockImplementation(() => {});
  jest.spyOn((perf as any).logger, "error").mockImplementation(() => {});
  return { team, perf };
}

describe("DELETE …/team/:rid/coverage-templates/:id", () => {
  it("removes the house's own rule and answers with the row that went", async () => {
    const db = seed();
    const { team } = build(db);
    const removed = await team.deleteCoverageTemplate(MANAGER, RID, RULE);
    expect(removed).toMatchObject({ id: RULE, role: "Floor", min_staff: 3 });
    expect(db.tables.coverage_templates.map((r) => r.id)).toEqual([OTHER_RULE]);
    const del = db.opsOn("coverage_templates", "delete")[0];
    expect(del.filters).toEqual(
      expect.arrayContaining([
        { kind: "eq", column: "id", value: RULE },
        { kind: "eq", column: "restaurant_id", value: RID },
      ]),
    );
  });

  it("answers 404 for another house's rule id, and that rule stays", async () => {
    const db = seed();
    const { team } = build(db);
    await expect(team.deleteCoverageTemplate(MANAGER, RID, OTHER_RULE)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(db.tables.coverage_templates.map((r) => r.id)).toContain(OTHER_RULE);
  });

  it("refuses staff, and a manager of another house, before any write", async () => {
    for (const who of [STAFF, OUTSIDER]) {
      const db = seed();
      const { team } = build(db);
      await expect(team.deleteCoverageTemplate(who, RID, RULE)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(db.opsOn("coverage_templates", "delete")).toHaveLength(0);
      expect(db.tables.coverage_templates).toHaveLength(2);
    }
  });

  it("says the rule is still in force when the delete write fails", async () => {
    const db = seed({ "coverage_templates:delete": { message: "boom" } });
    const { team } = build(db);
    await expect(team.deleteCoverageTemplate(MANAGER, RID, RULE)).rejects.toThrow(
      /still in force/,
    );
    await expect(team.deleteCoverageTemplate(MANAGER, RID, RULE)).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });

  it("parses the rule id as a uuid at the route (400, not a Postgres 500)", () => {
    const args = Reflect.getMetadata(
      ROUTE_ARGS_METADATA,
      TeamController,
      "deleteCoverageTemplate",
    ) as Record<string, { data?: string; pipes?: unknown[] }>;
    const idArg = Object.values(args).find((a) => a.data === "id");
    expect(idArg?.pipes?.some((p) => p instanceof ParseUUIDPipe)).toBe(true);
  });
});

describe("GET …/team/:rid/coverage-templates — a failed read is not an empty file", () => {
  it("throws instead of answering [] (which the page reads as 'engine idle')", async () => {
    const db = seed({ "coverage_templates:select": { message: "boom" } });
    const { team } = build(db);
    await expect(team.listCoverageTemplates(MANAGER, RID)).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });

  it("still lists only this house's rules", async () => {
    const { team } = build(seed());
    const rows = await team.listCoverageTemplates(MANAGER, RID);
    expect(rows.map((r: any) => r.id)).toEqual([RULE]);
  });
});

describe("POST …/team/:rid/sales — one service by hand", () => {
  it("writes exactly the legacy row, into this house", async () => {
    const db = seed();
    const { perf } = build(db);
    await perf.ingest(MANAGER, RID, {
      memberId: ANA,
      serviceDate: "2026-09-25",
      covers: 42,
      netSales: 1810.5,
      wineSales: 640,
      checks: 18,
      source: "manual",
    });
    const up = db.opsOn("server_sales", "upsert")[0];
    expect(up.payload).toEqual({
      restaurant_id: RID,
      member_id: ANA,
      service_date: "2026-09-25",
      covers: 42,
      net_sales: 1810.5,
      wine_sales: 640,
      checks: 18,
      source: "manual",
    });
  });

  it("replaces the same person's same day rather than adding a second row", async () => {
    const db = seed();
    const { perf } = build(db);
    const base = { memberId: ANA, serviceDate: "2026-09-25", source: "manual" };
    await perf.ingest(MANAGER, RID, { ...base, covers: 10 });
    await perf.ingest(MANAGER, RID, { ...base, covers: 12 });
    expect(db.tables.server_sales).toHaveLength(1);
    expect(db.tables.server_sales[0].covers).toBe(12);
  });

  it("refuses staff and another house's manager, and a member of another house", async () => {
    for (const who of [STAFF, OUTSIDER]) {
      const db = seed();
      const { perf } = build(db);
      await expect(
        perf.ingest(who, RID, { memberId: ANA, serviceDate: "2026-09-25" }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(db.opsOn("server_sales", "upsert")).toHaveLength(0);
    }
    const db = seed();
    const { perf } = build(db);
    await expect(
      perf.ingest(MANAGER, RID, { memberId: FOREIGN_MEMBER, serviceDate: "2026-09-25" }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(db.opsOn("server_sales", "upsert")).toHaveLength(0);
  });
});

describe("POST …/team/:rid/sales/batch — several at once", () => {
  it("writes the legacy rows and names every row it did not write", async () => {
    const db = seed();
    const { perf } = build(db);
    const out = await perf.ingestBatch(MANAGER, RID, [
      { memberId: ANA, serviceDate: "2026-09-24", covers: 30, netSales: 900, source: "manual" },
      { memberId: BO, serviceDate: "2026-09-24", covers: 25, checks: 11 },
      { memberId: FOREIGN_MEMBER, serviceDate: "2026-09-24", covers: 99 },
    ]);
    expect(out).toEqual({
      inserted: 2,
      skipped: 1,
      skippedRows: [{ memberId: FOREIGN_MEMBER, serviceDate: "2026-09-24" }],
    });
    const up = db.opsOn("server_sales", "upsert")[0];
    expect(up.payload).toEqual([
      {
        restaurant_id: RID,
        member_id: ANA,
        service_date: "2026-09-24",
        covers: 30,
        net_sales: 900,
        wine_sales: 0,
        checks: 0,
        source: "manual",
      },
      {
        restaurant_id: RID,
        member_id: BO,
        service_date: "2026-09-24",
        covers: 25,
        net_sales: 0,
        wine_sales: 0,
        checks: 11,
        source: "csv",
      },
    ]);
    expect(db.tables.server_sales.every((r) => r.restaurant_id === RID)).toBe(true);
  });

  it("refuses two rows for one person on one day before writing anything", async () => {
    const db = seed();
    const { perf } = build(db);
    await expect(
      perf.ingestBatch(MANAGER, RID, [
        { memberId: ANA, serviceDate: "2026-09-24", covers: 1 },
        { memberId: ANA, serviceDate: "2026-09-24", covers: 2 },
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.opsOn("server_sales", "upsert")).toHaveLength(0);
  });

  it("does not answer 'nothing to import' when the roster read failed", async () => {
    const db = seed({ "team_members:select": { message: "boom" } });
    const { perf } = build(db);
    await expect(
      perf.ingestBatch(MANAGER, RID, [{ memberId: ANA, serviceDate: "2026-09-24" }]),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(db.opsOn("server_sales", "upsert")).toHaveLength(0);
  });

  it("refuses staff and another house's manager before any read of the roster", async () => {
    for (const who of [STAFF, OUTSIDER]) {
      const db = seed();
      const { perf } = build(db);
      await expect(
        perf.ingestBatch(who, RID, [{ memberId: ANA, serviceDate: "2026-09-24" }]),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(db.opsOn("team_members")).toHaveLength(0);
      expect(db.opsOn("server_sales")).toHaveLength(0);
    }
  });
});

describe("GET …/members/:id/performance — a failed read is not 'no sales yet'", () => {
  it("throws instead of answering hasData:false", async () => {
    const db = seed({ "server_sales:select": { message: "boom" } });
    const { perf } = build(db);
    await expect(perf.getMemberPerformance(MANAGER, RID, ANA)).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });
});
