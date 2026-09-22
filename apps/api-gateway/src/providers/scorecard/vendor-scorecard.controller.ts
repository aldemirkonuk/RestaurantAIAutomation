import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import {
  DEFAULT_WINDOW,
  MEASURE_KEYS,
  MeasureKey,
  WINDOW_DAYS,
  WindowDays,
  isMeasureKey,
  isWindowDays,
} from "./vendor-scorecard";
import { VendorScorecardService } from "./vendor-scorecard.service";
import { COPY } from "./vendor-scorecard.copy";

type AuthUser = { userId?: string; id?: string; restaurantId?: string };

/**
 * The caller's house, from the verified token and nowhere else. A session that
 * names no house has no vendors of its own to score, so it is refused before
 * any register is touched — never handed an unfiltered read. (The same shape
 * as `conversations.controller.ts` and PR #416's provider-intelligence fix.)
 */
export function houseOf(user: AuthUser | null | undefined): string {
  if (!user?.restaurantId) {
    throw new ForbiddenException(COPY.error.noHouse);
  }
  return user.restaurantId;
}

export function parseWindow(raw: string | undefined): WindowDays {
  if (raw === undefined || raw === "") return DEFAULT_WINDOW;
  const n = Number(raw);
  if (!isWindowDays(n)) {
    throw new BadRequestException(
      COPY.error.badWindow(WINDOW_DAYS.join(", "), raw),
    );
  }
  return n;
}

export function parseMeasure(raw: string | undefined): MeasureKey | null {
  if (raw === undefined || raw === "") return null;
  if (!isMeasureKey(raw)) {
    throw new BadRequestException(
      COPY.error.badMeasure(MEASURE_KEYS.join(", "), raw),
    );
  }
  return raw;
}

/**
 * The operational vendor scorecard — ADR 0207.
 *
 * Its own prefix rather than `providers/…`: `ProvidersController` declares
 * `@Get(":id")`, which would swallow a static `providers/scorecard`, and this
 * lane keeps its routes out of that file (lane E is rebuilding the vendor
 * sheet beside it).
 *
 * Readable by every member of the house, as the credits and orders registers
 * it reads already are (`credits.controller.ts` carries no role gate). Whether
 * a staff member should see the money lines is sketch 117's open question,
 * recorded in ADR 0207 — this route does not widen what staff could read.
 *
 * NO ALERT is sent, queued or computed here. Every answer says so.
 */
@ApiTags("vendor-scorecard")
@Controller("vendor-scorecard")
@UseGuards(JwtAuthGuard)
export class VendorScorecardController {
  constructor(private readonly scorecard: VendorScorecardService) {}

  @Get()
  @ApiOperation({
    summary: "The Roll Call — every vendor of this house on five measures",
    description:
      "One row per vendor: on time, lines as ordered, price as agreed, reply time and credits, each a count over a count with its minimum sample, its prior window and its outcome (answered, too_few, not_collected, could_not_read). A register that fails is written into every cell it feeds, never read as zero. Ordered by deliveries in the window — a scanning order, not a rank.",
  })
  @ApiQuery({ name: "window", required: false, enum: ["30", "90", "365"] })
  async rollCall(
    @CurrentUser() user: AuthUser,
    @Query("window") window?: string,
  ) {
    return this.scorecard.rollCall(houseOf(user), parseWindow(window));
  }

  @Get(":providerId")
  @ApiOperation({
    summary: "The ledger card — one vendor's five measured lines",
    description:
      "The figures behind the vendor sheet's 'What they did'. A vendor of another house is a 404, the same answer as a vendor that does not exist.",
  })
  @ApiQuery({ name: "window", required: false, enum: ["30", "90", "365"] })
  async card(
    @CurrentUser() user: AuthUser,
    @Param("providerId") providerId: string,
    @Query("window") window?: string,
  ) {
    return this.scorecard.vendorCard(
      houseOf(user),
      providerId,
      parseWindow(window),
    );
  }

  @Get(":providerId/docket")
  @ApiOperation({
    summary: "The Docket — the rows behind the figures",
    description:
      "Every dated entry this window holds for the vendor, newest first, optionally one measure's. The card's figures are computed from exactly these entries, so a tally always equals its rows.",
  })
  @ApiQuery({ name: "window", required: false, enum: ["30", "90", "365"] })
  @ApiQuery({ name: "measure", required: false, enum: [...MEASURE_KEYS] })
  async docket(
    @CurrentUser() user: AuthUser,
    @Param("providerId") providerId: string,
    @Query("window") window?: string,
    @Query("measure") measure?: string,
  ) {
    return this.scorecard.docket(
      houseOf(user),
      providerId,
      parseWindow(window),
      parseMeasure(measure),
    );
  }
}
