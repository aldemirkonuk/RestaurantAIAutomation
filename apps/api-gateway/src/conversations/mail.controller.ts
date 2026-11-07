import {
  Controller,
  ForbiddenException,
  Get,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { MailService } from "./mail.service";
import type {
  MailPeoplePage,
  MailSummary,
  MailThreadPage,
  MailThreadsPage,
} from "./mail.types";

type AuthUser = { userId: string; restaurantId: string };

/**
 * The caller's house, from the verified token and nowhere else. A
 * `restaurantId` query parameter is never read. A session that names no house
 * has no mail to read and is refused, never handed an unfiltered list.
 */
function houseOf(user: AuthUser | undefined): string {
  if (!user?.restaurantId) {
    throw new ForbiddenException("This session names no restaurant.");
  }
  return user.restaurantId;
}

/**
 * GET /mail/* — the read model behind the /communications Mail tab (founder
 * /goal 2026-11-07). Read-only.
 *
 * Signed-in only, and deliberately no role decorator anywhere in this file:
 * every member of the house may read its vendor mail (ADR 0357 answer 3, staff
 * read-only), and what a role changes — whether undecided or discarded
 * credit-claim letters exist at all — is decided in MailService from the role
 * the token names in this house (ADR 0162, ADR 0167). Keeping it out of a
 * decorator also keeps these routes out of route-access.expected.json, which
 * open PRs own.
 */
@ApiTags("Mail")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("mail")
export class MailController {
  constructor(private readonly mail: MailService) {}

  @Get("people")
  @ApiOperation({ summary: "The people this house has mail with, newest letter first" })
  @ApiQuery({ name: "waiting", required: false, description: "1 = only people waiting on the house" })
  @ApiQuery({ name: "after", required: false, description: "The `next` cursor of the previous page" })
  @ApiQuery({ name: "limit", required: false, description: "1..100, default 50" })
  people(
    @CurrentUser() user: AuthUser,
    @CurrentUser("role") role: string | null,
    @Query("waiting") waiting?: string,
    @Query("after") after?: string,
    @Query("limit") limit?: string,
  ): Promise<MailPeoplePage> {
    return this.mail.listPeople(houseOf(user), role, {
      waitingOnly: waiting === "1" || waiting === "true",
      after,
      limit,
    });
  }

  @Get("threads")
  @ApiOperation({ summary: "One person's threads, newest first" })
  @ApiQuery({ name: "with", required: true, description: "vendor:<provider uuid>" })
  @ApiQuery({ name: "after", required: false })
  @ApiQuery({ name: "limit", required: false })
  threads(
    @CurrentUser() user: AuthUser,
    @CurrentUser("role") role: string | null,
    @Query("with") withKey?: string,
    @Query("after") after?: string,
    @Query("limit") limit?: string,
  ): Promise<MailThreadsPage> {
    return this.mail.listThreads(houseOf(user), role, { with: withKey, after, limit });
  }

  @Get("thread")
  @ApiOperation({ summary: "One thread, 50 letters a page, oldest to newest" })
  @ApiQuery({ name: "key", required: true })
  @ApiQuery({ name: "before", required: false, description: "The `before` cursor of the newer page" })
  thread(
    @CurrentUser() user: AuthUser,
    @CurrentUser("role") role: string | null,
    @Query("key") key?: string,
    @Query("before") before?: string,
  ): Promise<MailThreadPage> {
    return this.mail.getThread(houseOf(user), role, { key, before });
  }

  @Get("summary")
  @ApiOperation({ summary: "The Mail tab header: who is waiting, today's letters, each door" })
  summary(
    @CurrentUser() user: AuthUser,
    @CurrentUser("role") role: string | null,
  ): Promise<MailSummary> {
    return this.mail.summary(houseOf(user), role);
  }
}
