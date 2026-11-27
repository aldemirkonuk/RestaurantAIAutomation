import {
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { MailService } from "./mail.service";
import type {
  MailNoReplyAnswer,
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
 * /goal 2026-11-07). Its one write is the "needs no reply" mark on a letter
 * (r28 mail gap 4), which only an owner or manager may set; that is enforced
 * in MailService, for the reason below.
 *
 * Signed-in only, and deliberately no role decorator anywhere in this file:
 * every member of the house may read its vendor mail (draft ADR 0357 answer 3, PR #747, staff
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
  @ApiOperation({
    summary: "The people this house has mail with, newest letter first",
  })
  @ApiQuery({
    name: "waiting",
    required: false,
    description: "1 = only people waiting on the house",
  })
  @ApiQuery({
    name: "after",
    required: false,
    description: "The `next` cursor of the previous page",
  })
  @ApiQuery({
    name: "limit",
    required: false,
    description: "1..100, default 50",
  })
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
  @ApiQuery({
    name: "with",
    required: true,
    description: "vendor:<provider uuid>",
  })
  @ApiQuery({ name: "after", required: false })
  @ApiQuery({ name: "limit", required: false })
  threads(
    @CurrentUser() user: AuthUser,
    @CurrentUser("role") role: string | null,
    @Query("with") withKey?: string,
    @Query("after") after?: string,
    @Query("limit") limit?: string,
  ): Promise<MailThreadsPage> {
    return this.mail.listThreads(houseOf(user), role, {
      with: withKey,
      after,
      limit,
    });
  }

  @Get("thread")
  @ApiOperation({ summary: "One thread, 50 letters a page, oldest to newest" })
  @ApiQuery({ name: "key", required: true })
  @ApiQuery({
    name: "with",
    required: false,
    description:
      "vendor:<provider uuid> — the thread row's person. One key can be two threads (one Gmail thread to two vendors); name the person to read only theirs.",
  })
  @ApiQuery({
    name: "before",
    required: false,
    description: "The `before` cursor of the newer page",
  })
  thread(
    @CurrentUser() user: AuthUser,
    @CurrentUser("role") role: string | null,
    @Query("key") key?: string,
    @Query("with") withKey?: string,
    @Query("before") before?: string,
  ): Promise<MailThreadPage> {
    return this.mail.getThread(houseOf(user), role, {
      key,
      with: withKey,
      before,
    });
  }

  @Get("summary")
  @ApiOperation({
    summary: "The Mail tab header: who is waiting, today's letters, each door",
  })
  summary(
    @CurrentUser() user: AuthUser,
    @CurrentUser("role") role: string | null,
  ): Promise<MailSummary> {
    return this.mail.summary(houseOf(user), role);
  }

  @Post("letters/:id/no-reply-needed")
  @HttpCode(200)
  @ApiOperation({
    summary:
      "Say a letter the house received needs no reply: it and the thread's earlier letters stop waiting",
  })
  markNoReply(
    @CurrentUser() user: AuthUser,
    @CurrentUser("role") role: string | null,
    @Param("id") id: string,
  ): Promise<MailNoReplyAnswer> {
    return this.mail.setNoReply(houseOf(user), role, user?.userId, id, true);
  }

  @Delete("letters/:id/no-reply-needed")
  @ApiOperation({ summary: "Take back a letter's \"needs no reply\" mark" })
  unmarkNoReply(
    @CurrentUser() user: AuthUser,
    @CurrentUser("role") role: string | null,
    @Param("id") id: string,
  ): Promise<MailNoReplyAnswer> {
    return this.mail.setNoReply(houseOf(user), role, user?.userId, id, false);
  }
}
