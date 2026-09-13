/**
 * WHO is acting, on the archive routes — proved from the token the gateway
 * really issues.
 *
 * The fault this pins (found 2026-09-12): the controller typed its caller as
 * `{ id, restaurantId }` and read `user.id`, but `JwtStrategy.validate` builds
 * `request.user` with `userId` and no `id`. Every act therefore passed
 * `actorUserId: undefined`:
 *
 *   - POST /seal-challenge inserted a seal with no `actor_user_id`, a NOT NULL
 *     column, so no seal could ever be minted (a 500 for every manager).
 *   - POST / and POST /export redeemed with no actor, so every attempt was
 *     refused, and the refusal was FILED in `system_audit_log` with
 *     `actor_id` absent — a nullable uuid, so the audit row names nobody.
 *   - Had a redeem ever passed, `house_mail_archive_settings.chosen_by` (also
 *     nullable) would have recorded a choice made by nobody.
 *
 * The principal is built by the real `JwtStrategy.validate` and handed over by
 * the real `@CurrentUser()` factory read off the controller's route metadata.
 */

import { BadRequestException, ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { ROUTE_ARGS_METADATA } from "@nestjs/common/constants";
import { JwtStrategy } from "../../auth/strategies/jwt.strategy";
import type { JwtPayload } from "../../auth/auth.service";
import type { DatabaseService } from "../../database/database.service";
import type { IntegrationsOauthService } from "../../integrations/integrations-oauth.service";
import { SealChallengeService } from "../../common/seal/seal-challenge.service";
import { HouseMailArchiveController } from "./house-mail-archive.controller";
import { HouseMailArchiveService } from "./house-mail-archive.service";
import { DriveArchiveWriter } from "./drive-archive.writer";

const HOUSE = "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa";
const PERSON = "cccccccc-0000-4000-8000-cccccccccccc";
const SEAL = "5ea15ea1-0000-4000-8000-5ea15ea15ea1";

type Rows = Record<string, unknown>[] | { error: { message: string } };

function build(rows: Record<string, Rows> = {}) {
  const rec = {
    tables: [] as string[],
    inserts: [] as Array<{ table: string; body: Record<string, unknown> }>,
    upserts: [] as Array<{ table: string; body: Record<string, unknown> }>,
  };
  const chain = (table: string, payload: Rows) => {
    const data = Array.isArray(payload) ? payload : null;
    const error = Array.isArray(payload) ? null : payload.error;
    const self: Record<string, unknown> = {};
    const pass = () => self;
    for (const k of ["select", "eq", "in", "is", "not", "order", "limit", "update"]) {
      self[k] = pass;
    }
    self.insert = (body: Record<string, unknown>) => {
      rec.inserts.push({ table, body });
      return self;
    };
    self.upsert = (body: Record<string, unknown>) => {
      rec.upserts.push({ table, body });
      return self;
    };
    self.single = () => Promise.resolve({ data: data?.[0] ?? null, error });
    self.maybeSingle = () => Promise.resolve({ data: data?.[0] ?? null, error });
    self.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data, error }).then(resolve);
    return self;
  };
  const from = (table: string) => {
    rec.tables.push(table);
    return chain(table, rows[table] ?? []);
  };
  const db = { supabase: { from }, client: { from } } as unknown as DatabaseService;
  return { rec, db };
}

async function userFromToken(): Promise<Record<string, unknown>> {
  const strategy = new JwtStrategy({
    validateJwtPayload: jest.fn().mockResolvedValue({
      user_id: PERSON,
      email: "owner@house.test",
      name: "The Owner",
      role: "owner",
      restaurant_id: HOUSE,
      email_verified: true,
    }),
  } as never);
  return (await strategy.validate({
    sub: PERSON,
    email: "owner@house.test",
    role: "owner",
    restaurantId: HOUSE,
  } as JwtPayload)) as Record<string, unknown>;
}

function asNestWould(
  handler: keyof HouseMailArchiveController,
  requestUser: Record<string, unknown> | undefined,
): unknown {
  const meta = Reflect.getMetadata(
    ROUTE_ARGS_METADATA,
    HouseMailArchiveController,
    handler as string,
  ) as Record<string, { index: number; factory?: (...args: unknown[]) => unknown; data?: unknown }>;
  const entry = Object.values(meta).find(
    (m) => typeof m.factory === "function" && m.index === 0,
  );
  if (!entry?.factory) {
    throw new Error(`${String(handler)} takes no @CurrentUser() at index 0`);
  }
  const ctx = {
    switchToHttp: () => ({ getRequest: () => ({ user: requestUser }) }),
  };
  return entry.factory(entry.data, ctx);
}

const oauth = {
  getAccessToken: jest.fn(async () => "tok"),
} as unknown as IntegrationsOauthService;

/** The REAL seal service and the REAL archive service over one stub. */
function realController(rows: Record<string, Rows> = {}) {
  const { rec, db } = build(rows);
  const seals = new SealChallengeService(db);
  const archive = new HouseMailArchiveService(db, oauth, new DriveArchiveWriter());
  return { rec, archive, controller: new HouseMailArchiveController(archive, seals) };
}

/** The real archive service, with the seal's redemption stubbed to succeed. */
function sealedController(rows: Record<string, Rows> = {}) {
  const { rec, db } = build(rows);
  const seals = {
    issue: jest.fn(async () => ({ challenge: "c", expiresAt: "x", action: "a" })),
    redeem: jest.fn(async () => ({ sealId: SEAL })),
  };
  const archive = new HouseMailArchiveService(db, oauth, new DriveArchiveWriter());
  const runExport = jest
    .spyOn(archive, "runExport")
    .mockResolvedValue({} as never);
  return {
    rec,
    seals,
    runExport,
    controller: new HouseMailArchiveController(archive, seals as never),
  };
}

describe("the archive routes read the actor from the token the gateway issues", () => {
  it("POST /seal-challenge mints a seal NAMING the person who asked for it", async () => {
    const { rec, controller } = realController();
    const user = asNestWould("challenge", await userFromToken());

    await controller.challenge(user as never, { act: "export" });

    const seal = rec.inserts.find((i) => i.table === "mcp_seal_challenges");
    expect(seal).toBeDefined();
    const onTheWire = JSON.parse(JSON.stringify(seal!.body)) as Record<string, unknown>;
    // NOT NULL in the database: without it no seal can be minted at all.
    expect(onTheWire.actor_user_id).toBe(PERSON);
  });

  it("a REFUSED choice is filed in the audit log under the person who tried", async () => {
    const { rec, controller } = realController();
    const user = asNestWould("choose", await userFromToken());

    // No seal header: refused, and the refusal is written down.
    await expect(
      controller.choose(user as never, { mode: "none" }, undefined),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const audit = rec.inserts.find((i) => i.table === "system_audit_log");
    expect(audit).toBeDefined();
    const onTheWire = JSON.parse(JSON.stringify(audit!.body)) as Record<string, unknown>;
    expect(onTheWire.actor_id).toBe(PERSON);
  });

  it("POST / redeems as the caller and records the choice as theirs", async () => {
    const { rec, seals, controller } = sealedController({
      house_mail_archive_settings: [],
    });
    const user = asNestWould("choose", await userFromToken());

    await controller.choose(user as never, { mode: "none" }, "a-seal");

    expect(seals.redeem).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: PERSON, restaurantId: HOUSE }),
    );
    const row = rec.upserts.find((u) => u.table === "house_mail_archive_settings");
    expect(row).toBeDefined();
    const onTheWire = JSON.parse(JSON.stringify(row!.body)) as Record<string, unknown>;
    expect(onTheWire.chosen_by).toBe(PERSON);
  });

  it("POST /export redeems as the caller", async () => {
    const { seals, runExport, controller } = sealedController();
    const user = asNestWould("runExport", await userFromToken());

    await controller.runExport(user as never, "a-seal");

    expect(seals.redeem).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: PERSON, restaurantId: HOUSE }),
    );
    expect(runExport).toHaveBeenCalledTimes(1);
  });
});

describe("an archive act by a session that names nobody is refused, never filed", () => {
  const acts: Array<{
    name: keyof HouseMailArchiveController;
    call: (c: HouseMailArchiveController, u: unknown) => Promise<unknown>;
  }> = [
    { name: "settings", call: (c, u) => c.settings(u as never) },
    { name: "challenge", call: (c, u) => c.challenge(u as never, { act: "export" }) },
    { name: "choose", call: (c, u) => c.choose(u as never, { mode: "none" }, "a-seal") },
    { name: "runExport", call: (c, u) => c.runExport(u as never, "a-seal") },
  ];

  it.each(acts.map((a) => [a.name, a] as const))(
    "%s refuses a session with no user id: no seal, no audit row, no table",
    async (_name, a) => {
      const { rec, controller } = realController({ house_mail_archive_settings: [] });
      const principal = { ...(await userFromToken()) };
      delete principal.userId;

      await expect(
        a.call(controller, asNestWould(a.name, principal)),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(rec.tables).toEqual([]);
      expect(rec.inserts).toEqual([]);
      expect(rec.upserts).toEqual([]);
    },
  );

  it.each(acts.map((a) => [a.name, a] as const))(
    "%s refuses a session with no restaurant: nothing read, nothing filed",
    async (_name, a) => {
      const { rec, controller } = realController({ house_mail_archive_settings: [] });
      const principal = { ...(await userFromToken()), restaurantId: undefined };

      await expect(
        a.call(controller, asNestWould(a.name, principal)),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(rec.tables).toEqual([]);
      expect(rec.inserts).toEqual([]);
    },
  );
});

describe("the archive service will not record a choice made by nobody", () => {
  it("choose() refuses a blank actor before writing the settings row", async () => {
    const { rec, archive } = realController({ house_mail_archive_settings: [] });

    for (const actorUserId of ["", "  ", undefined as unknown as string]) {
      await expect(
        archive.choose({ restaurantId: HOUSE, actorUserId, mode: "none", sealId: SEAL }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }
    expect(rec.upserts).toEqual([]);
    expect(rec.tables).toEqual([]);
  });
});
