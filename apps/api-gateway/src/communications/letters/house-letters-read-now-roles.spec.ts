/**
 * 'Check now' is the owner's and the manager's (DD-r106-9 / DD-r108-47). A
 * staff caller is refused before the mailbox is touched, and a press inside the
 * minute answers 429 with the wait, never a silent 200.
 */

import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { HouseLettersController } from "./house-letters.controller";
import { HouseLettersService } from "./house-letters.service";
import { HouseSenderService } from "./house-sender.service";
import { HouseLettersCron } from "./house-letters.cron";
import { HouseInboxCron } from "../inbox/house-inbox.cron";
import { HouseInboxService, type ReadNowResult } from "../inbox/house-inbox.service";

const HOUSE = "12823c23-277c-5ae9-b49b-e17d33704e04";
const PATH = "/communications/letters/reader/check";

describe("POST communications/letters/reader/check", () => {
  let app: INestApplication;
  let base: string;
  const asked: string[] = [];
  let answer: ReadNowResult;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HouseLettersController],
      providers: [
        { provide: HouseLettersService, useValue: {} },
        { provide: HouseSenderService, useValue: {} },
        { provide: HouseLettersCron, useValue: { lastRun: () => null } },
        { provide: HouseInboxCron, useValue: { lastRun: () => null } },
        {
          provide: HouseInboxService,
          useValue: {
            readNow: async (restaurantId: string) => {
              asked.push(restaurantId);
              return answer;
            },
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: any) => {
          const req = ctx.switchToHttp().getRequest();
          const role = req.headers["x-test-role"];
          if (!role) return false;
          req.user = { userId: "a5bede6d-3c34-4627-8771-a488ba5275de", restaurantId: HOUSE, role };
          return true;
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    await app.listen(0);
    base = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    asked.length = 0;
    answer = { outcome: "read", retryAfterSeconds: 0, mirrored: 1, says: "Checked. 1 new letter was filed.", outcomes: [] };
  });

  const press = (role: string) => fetch(`${base}${PATH}`, { method: "POST", headers: { "x-test-role": role } });

  it("refuses staff with 403 and never asks for a read", async () => {
    const res = await press("staff");
    expect(res.status).toBe(403);
    expect(asked).toHaveLength(0);
  });

  it.each(["owner", "manager"])("reads the %s's own house, from the token", async (role) => {
    const res = await press(role);
    expect(res.status).toBe(200);
    expect(asked).toEqual([HOUSE]);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ outcome: "read", mirrored: 1, says: "Checked. 1 new letter was filed." });
  });

  it("answers a press inside the minute with 429 and the wait", async () => {
    answer = { outcome: "too_soon", retryAfterSeconds: 42, mirrored: 0, says: "The mailbox was read less than a minute ago. Check again in 42 s.", outcomes: [] };
    const res = await press("manager");
    expect(res.status).toBe(429);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.retryAfterSeconds).toBe(42);
    expect(String(body.message)).toMatch(/Check again in 42 s/);
  });
});
