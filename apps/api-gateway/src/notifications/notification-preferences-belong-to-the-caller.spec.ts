import {
  ForbiddenException,
  HttpException,
  UnauthorizedException,
} from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";
import {
  GetPreferencesQueryDto,
  UpdatePreferencesDto,
} from "./dto/notifications.dto";

/**
 * Notification preferences belong to the user on the VERIFIED token.
 *
 * Found 2026-09-12 (p4 wave digest, "missed by the finder"): GET and PATCH
 * /api/v1/notifications/preferences took the user id from `?userId=` or the
 * body and handed it straight to the service, which reads and upserts
 * `notification_preferences` by that id. Nothing compared it to
 * `request.user.userId`. So any signed-in user could read another user's
 * channels and quiet hours, or switch their low-stock alerts off, by naming a
 * uuid.
 *
 * The web client sends its OWN id in both places
 * (apps/web/src/services/api/notifications.ts:230,243-246), so a matching id is
 * accepted and only a MISMATCHED one is refused.
 */

const OWN = "11111111-1111-4111-8111-111111111111";
const VICTIM = "22222222-2222-4222-8222-222222222222";

type Row = Record<string, any>;

function makeController() {
  const service = {
    getPreferences: jest.fn(async (userId: string) => ({ userId })),
    updatePreferences: jest.fn(async (params: Row) => ({ ...params })),
  } as unknown as NotificationsService & {
    getPreferences: jest.Mock;
    updatePreferences: jest.Mock;
  };
  const controller = new NotificationsController(service, {} as never);
  return { controller, service };
}

// `null` (not `undefined`) is the no-user sentinel: `undefined` would take the
// default and silently hand the token OWN.
const req = (userId: string | null = OWN) =>
  ({ user: { userId, restaurantId: "rest-1" } }) as any;

describe("GET /notifications/preferences reads only the caller's row", () => {
  it("[REVERT-FAILS] refuses a query userId that names another user, and reads nothing", async () => {
    const { controller, service } = makeController();

    await expect(
      controller.getPreferences({ userId: VICTIM } as any, req(OWN)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.getPreferences).not.toHaveBeenCalled();
  });

  it("serves the caller who names their own id (the web client's shape)", async () => {
    const { controller, service } = makeController();

    await controller.getPreferences({ userId: OWN } as any, req(OWN));

    // The house comes from the same token, always (ADR 0149 row 39):
    // preferences are per person PER HOUSE.
    expect(service.getPreferences).toHaveBeenCalledWith(OWN, "rest-1");
  });

  it("[REVERT-FAILS] reads the token's user when the query names none", async () => {
    const { controller, service } = makeController();

    await controller.getPreferences({} as any, req(OWN));

    expect(service.getPreferences).toHaveBeenCalledWith(OWN, "rest-1");
  });

  it("[REVERT-FAILS] refuses a session with no user id rather than trusting the query", async () => {
    const { controller, service } = makeController();

    await expect(
      controller.getPreferences({ userId: VICTIM } as any, req(null)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(service.getPreferences).not.toHaveBeenCalled();
  });
});

describe("PATCH /notifications/preferences writes only the caller's row", () => {
  it("[REVERT-FAILS] refuses a body userId that names another user, and writes nothing", async () => {
    const { controller, service } = makeController();

    await expect(
      controller.updatePreferences(
        {} as any,
        { userId: VICTIM, lowStock: { enabled: false } } as any,
        req(OWN),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.updatePreferences).not.toHaveBeenCalled();
  });

  it("[REVERT-FAILS] refuses a query userId that names another user, and writes nothing", async () => {
    const { controller, service } = makeController();

    await expect(
      controller.updatePreferences(
        { userId: VICTIM } as any,
        { email: false } as any,
        req(OWN),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.updatePreferences).not.toHaveBeenCalled();
  });

  it("[REVERT-FAILS] refuses when EITHER place names another user, even if the other names the caller", async () => {
    // Before: `body.userId || query.userId` let the body win, so a mismatched
    // query was silently ignored. A request that names two users is refused.
    const { controller, service } = makeController();

    await expect(
      controller.updatePreferences(
        { userId: VICTIM } as any,
        { userId: OWN, email: false } as any,
        req(OWN),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.updatePreferences).not.toHaveBeenCalled();
  });

  it("writes the caller's row when both places name the caller (the web client's exact shape)", async () => {
    const { controller, service } = makeController();

    await controller.updatePreferences(
      { userId: OWN } as any,
      {
        userId: OWN,
        ordersMode: "in_app",
        quietHours: { enabled: true },
      } as any,
      req(OWN),
    );

    // The house comes from the same token as the user (ADR 0149 row 39).
    expect(service.updatePreferences).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: OWN,
        restaurantId: "rest-1",
        ordersMode: "in_app",
        quietHours: { enabled: true },
      }),
    );
  });

  it("[REVERT-FAILS] writes the token's user when neither place names one", async () => {
    const { controller, service } = makeController();

    await controller.updatePreferences(
      {} as any,
      { push: false } as any,
      req(OWN),
    );

    expect(service.updatePreferences).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: OWN,
        restaurantId: "rest-1",
        push: false,
      }),
    );
  });

  it("[REVERT-FAILS] refuses a session with no user id rather than writing the client's id", async () => {
    const { controller, service } = makeController();

    await expect(
      controller.updatePreferences(
        {} as any,
        { userId: VICTIM, sms: true } as any,
        req(null),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(service.updatePreferences).not.toHaveBeenCalled();
  });

  it("a failed write is still an error, not a success", async () => {
    const { controller, service } = makeController();
    service.updatePreferences.mockRejectedValueOnce(
      new Error("permission denied for table notification_preferences"),
    );

    await expect(
      controller.updatePreferences({} as any, { email: true } as any, req(OWN)),
    ).rejects.toBeInstanceOf(HttpException);
  });
});

describe("a failed preferences read is an error, never the defaults", () => {
  // Not a reproduction: this held before the fix too (the service checks
  // `error` before its `!data` defaults branch). Pinned because the defaults
  // object is exactly what an unreadable row would look like if the order of
  // those two checks were ever swapped.
  it("getPreferences rejects when supabase resolves an error", async () => {
    const chain: Row = {};
    chain.select = () => chain;
    chain.eq = () => chain;
    chain.maybeSingle = async () => ({
      data: null,
      error: {
        message: "permission denied for table notification_preferences",
      },
    });
    const db = { supabase: { from: () => chain } };
    const service = new NotificationsService(
      {} as never,
      { get: () => undefined } as never,
      db as never,
    );

    await expect(service.getPreferences(OWN, "rest-1")).rejects.toMatchObject(
      { message: expect.stringMatching(/permission denied/) },
    );
  });
});

describe("the preferences DTOs stay compatible with the web client", () => {
  const opts = { whitelist: true, forbidNonWhitelisted: true };

  it("accepts the body the web client sends today (prefs plus its own userId)", async () => {
    const dto = plainToInstance(UpdatePreferencesDto, {
      ordersMode: "in_app",
      lowStock: { enabled: false },
      userId: OWN,
    });
    expect(await validate(dto, opts)).toHaveLength(0);
  });

  it("[REVERT-FAILS] accepts a body with no userId, since the id comes from the token", async () => {
    const dto = plainToInstance(UpdatePreferencesDto, { email: false });
    expect(await validate(dto, opts)).toHaveLength(0);
  });

  it("[REVERT-FAILS] accepts a query with no userId", async () => {
    const dto = plainToInstance(GetPreferencesQueryDto, {});
    expect(await validate(dto, opts)).toHaveLength(0);
  });

  it("still rejects a userId that is not a uuid", async () => {
    const dto = plainToInstance(GetPreferencesQueryDto, { userId: "nope" });
    expect((await validate(dto, opts)).length).toBeGreaterThan(0);
  });
});
