import { Test, TestingModule } from "@nestjs/testing";
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { MembersService } from "../restaurants/members.service";
import { LogsController } from "./logs.controller";
import { LogsTimelineService } from "./logs-timeline.service";

/**
 * GET /logs/timeline/:restaurantId — the tenancy gate and the error shape.
 *
 * Before 2026-09-11 the only gate was the JWT guard, so any signed-in account
 * could read any house's six registers by editing the path. These cases pin
 * the two halves of the fix: a non-member is refused, and the refusal reaches
 * the caller as the 403 it is — not as the 500 the old catch turned every
 * error into.
 */
describe("LogsController", () => {
  let controller: LogsController;

  const timeline = { getTimeline: jest.fn() };
  const members = { assertMembership: jest.fn() };
  const user = { userId: "user-1" };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [LogsController],
      providers: [
        { provide: LogsTimelineService, useValue: timeline },
        { provide: MembersService, useValue: members },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<LogsController>(LogsController);
    jest.clearAllMocks();
  });

  it("refuses a caller who is not a member of the house named in the path, as a 403", async () => {
    members.assertMembership.mockRejectedValue(
      new ForbiddenException("Access denied to this restaurant"),
    );

    await expect(
      controller.getTimeline(user, "someone-elses-house"),
    ).rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });
    expect(members.assertMembership).toHaveBeenCalledWith(
      "user-1",
      "someone-elses-house",
    );
    // The registers are never touched for a caller who was refused.
    expect(timeline.getTimeline).not.toHaveBeenCalled();
  });

  it("reads the timeline for a member, passing the correlation id, the parsed limit, the cursor and the membership role", async () => {
    members.assertMembership.mockResolvedValue({ role: "owner" });
    const page = {
      events: [],
      correlationId: null,
      window: 100,
      hasMore: false,
      nextCursor: null,
    };
    timeline.getTimeline.mockResolvedValue(page);

    const res = await controller.getTimeline(
      user,
      "r1",
      "corr-1",
      "100",
      "2026-09-01T08:00:00.000Z",
    );

    expect(res).toBe(page);
    expect(timeline.getTimeline).toHaveBeenCalledWith("r1", {
      correlationId: "corr-1",
      limit: 100,
      before: "2026-09-01T08:00:00.000Z",
      role: "owner",
    });
  });

  /**
   * ADR 0218 round 4 (founder round 6z, 2026-09-22), "Hide Away events from
   * staff (Recommended)". The role passed to the timeline is the fresh
   * membership row `assertMembership` just read, not a value the caller
   * supplied — a staff member cannot widen their own read by any request
   * parameter, because there is no parameter that carries it.
   */
  it("passes a staff caller's own membership role, never anything the caller could supply", async () => {
    members.assertMembership.mockResolvedValue({ role: "staff" });
    timeline.getTimeline.mockResolvedValue({
      events: [],
      correlationId: null,
      window: 50,
      hasMore: false,
      nextCursor: null,
    });

    await controller.getTimeline(user, "r1");

    expect(timeline.getTimeline).toHaveBeenCalledWith(
      "r1",
      expect.objectContaining({ role: "staff" }),
    );
  });

  it("lets a 400 for a malformed cursor through as a 400", async () => {
    members.assertMembership.mockResolvedValue({ role: "owner" });
    timeline.getTimeline.mockRejectedValue(
      new BadRequestException("before must be an ISO-8601 timestamp"),
    );

    await expect(
      controller.getTimeline(user, "r1", undefined, undefined, "yesterday"),
    ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
  });

  it("wraps an unexpected failure as a 500 that carries its message", async () => {
    members.assertMembership.mockResolvedValue({ role: "owner" });
    timeline.getTimeline.mockRejectedValue(new Error("pool exhausted"));

    const err = await controller.getTimeline(user, "r1").catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(err.message).toBe("pool exhausted");
  });
});
