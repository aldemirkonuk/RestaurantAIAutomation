import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from "@nestjs/common";
import { Request } from "express";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { NotificationsService } from "../notifications/notifications.service";
import { ExpoPushService } from "../push/expo-push.service";
import { NotesService } from "./notes.service";
import { TeamService } from "./team.service";
import { ScheduleService } from "./schedule.service";
import { PerformanceService } from "./performance.service";
import {
  AssignCoverDto,
  BroadcastDto,
  CalloutDto,
  CopyWeekDto,
  CreateCertDto,
  CreateCoverageTemplateDto,
  CreateScheduleDto,
  CreateShiftDto,
  CreateTeamMemberDto,
  CreateTeamNoteDto,
  CreateTimeOffDto,
  IngestSalesDto,
  IngestSalesBatchDto,
  OfferCoverDto,
  PublishScheduleDto,
  ReviewRequestDto,
  UpdateCertDto,
  UpdateShiftDto,
  UpdateTeamMemberDto,
  UpdateTeamSettingsDto,
} from "./dto/team.dto";

interface AuthedUser {
  userId: string;
  role: string;
}

@Controller("restaurants/:restaurantId/team")
@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class TeamController {
  constructor(
    private readonly team: TeamService,
    private readonly schedule: ScheduleService,
    private readonly performance: PerformanceService,
    private readonly notifications: NotificationsService,
    private readonly push: ExpoPushService,
    private readonly notes: NotesService,
  ) {}

  private uid(req: Request & { user: AuthedUser }): string {
    const id = (req.user as AuthedUser)?.userId;
    if (!id) throw new ForbiddenException("Missing user identity");
    return id;
  }

  // ── Members ────────────────────────────────────────────────────────────
  @Get("members")
  members(@Req() req: any, @Param("restaurantId") rid: string) {
    return this.team.listMembers(this.uid(req), rid);
  }

  @Post("members")
  createMember(
    @Req() req: any,
    @Param("restaurantId") rid: string,
    @Body() dto: CreateTeamMemberDto,
  ) {
    return this.team.createMember(this.uid(req), rid, dto);
  }

  @Patch("members/:memberId")
  updateMember(
    @Req() req: any,
    @Param("restaurantId") rid: string,
    @Param("memberId") memberId: string,
    @Body() dto: UpdateTeamMemberDto,
  ) {
    return this.team.updateMember(this.uid(req), rid, memberId, dto);
  }

  @Delete("members/:memberId")
  deleteMember(
    @Req() req: any,
    @Param("restaurantId") rid: string,
    @Param("memberId") memberId: string,
  ) {
    return this.team.deleteMember(this.uid(req), rid, memberId);
  }

  // ── Schedule / week ──────────────────────────────────────────────────────
  @Get("week")
  week(
    @Req() req: any,
    @Param("restaurantId") rid: string,
    @Query("weekStart") ws: string,
  ) {
    return this.schedule.getWeek(this.uid(req), rid, ws);
  }

  @Get("my-week")
  myWeek(
    @Req() req: any,
    @Param("restaurantId") rid: string,
    @Query("weekStart") ws: string,
  ) {
    return this.schedule.getMyWeek(this.uid(req), rid, ws);
  }

  @Post("schedules")
  createSchedule(
    @Req() req: any,
    @Param("restaurantId") rid: string,
    @Body() dto: CreateScheduleDto,
  ) {
    return this.schedule.createSchedule(this.uid(req), rid, dto);
  }

  @Post("schedules/copy-week")
  copyWeek(
    @Req() req: any,
    @Param("restaurantId") rid: string,
    @Body() dto: CopyWeekDto,
  ) {
    return this.schedule.copyWeek(this.uid(req), rid, dto);
  }

  /**
   * Re-publishing erases every read receipt on the week. The body must say
   * `resetReceipts: true` for that to be allowed on a schedule that already
   * carries receipts — otherwise this answers 409 with the count (ADR 0088 T7).
   */
  @Post("schedules/:scheduleId/publish")
  publish(
    @Req() req: any,
    @Param("restaurantId") rid: string,
    @Param("scheduleId") sid: string,
    @Body() dto: PublishScheduleDto,
  ) {
    return this.schedule.publish(this.uid(req), rid, sid, dto ?? {});
  }

  @Post("schedules/:scheduleId/acknowledge")
  acknowledge(
    @Req() req: any,
    @Param("restaurantId") rid: string,
    @Param("scheduleId") sid: string,
  ) {
    return this.schedule.acknowledge(this.uid(req), rid, sid);
  }

  // ── Shifts ────────────────────────────────────────────────────────────────
  @Post("shifts")
  createShift(
    @Req() req: any,
    @Param("restaurantId") rid: string,
    @Body() dto: CreateShiftDto,
  ) {
    return this.schedule.createShift(this.uid(req), rid, dto);
  }

  @Patch("shifts/:shiftId")
  updateShift(
    @Req() req: any,
    @Param("restaurantId") rid: string,
    @Param("shiftId") sid: string,
    @Body() dto: UpdateShiftDto,
  ) {
    return this.schedule.updateShift(this.uid(req), rid, sid, dto);
  }

  @Delete("shifts/:shiftId")
  deleteShift(
    @Req() req: any,
    @Param("restaurantId") rid: string,
    @Param("shiftId") sid: string,
  ) {
    return this.schedule.deleteShift(this.uid(req), rid, sid);
  }

  @Post("shifts/:shiftId/callout")
  callout(
    @Req() req: any,
    @Param("restaurantId") rid: string,
    @Param("shiftId") sid: string,
    @Body() dto: CalloutDto,
  ) {
    return this.schedule.reportCallout(this.uid(req), rid, sid, dto);
  }

  @Post("shifts/:shiftId/offer-cover")
  offerCover(
    @Req() req: any,
    @Param("restaurantId") rid: string,
    @Param("shiftId") sid: string,
    @Body() dto: OfferCoverDto,
  ) {
    return this.schedule.offerCover(this.uid(req), rid, sid, dto);
  }

  @Post("shifts/:shiftId/assign")
  assignCover(
    @Req() req: any,
    @Param("restaurantId") rid: string,
    @Param("shiftId") sid: string,
    @Body() dto: AssignCoverDto,
  ) {
    return this.schedule.assignCover(this.uid(req), rid, sid, dto);
  }

  // ── Certifications ─────────────────────────────────────────────────────
  @Get("certifications")
  certs(@Req() req: any, @Param("restaurantId") rid: string) {
    return this.team.listCertifications(this.uid(req), rid);
  }

  @Post("certifications")
  createCert(
    @Req() req: any,
    @Param("restaurantId") rid: string,
    @Body() dto: CreateCertDto,
  ) {
    return this.team.createCert(this.uid(req), rid, dto);
  }

  @Patch("certifications/:certId")
  updateCert(
    @Req() req: any,
    @Param("restaurantId") rid: string,
    @Param("certId") certId: string,
    @Body() dto: UpdateCertDto,
  ) {
    return this.team.updateCert(this.uid(req), rid, certId, dto);
  }

  @Delete("certifications/:certId")
  deleteCert(
    @Req() req: any,
    @Param("restaurantId") rid: string,
    @Param("certId") certId: string,
  ) {
    return this.team.deleteCert(this.uid(req), rid, certId);
  }

  // ── Time off / swaps ───────────────────────────────────────────────────
  @Get("time-off")
  timeOff(@Req() req: any, @Param("restaurantId") rid: string) {
    return this.team.listTimeOff(this.uid(req), rid);
  }

  @Post("time-off")
  createTimeOff(
    @Req() req: any,
    @Param("restaurantId") rid: string,
    @Body() dto: CreateTimeOffDto,
  ) {
    return this.team.createTimeOff(this.uid(req), rid, dto);
  }

  @Patch("time-off/:requestId")
  reviewTimeOff(
    @Req() req: any,
    @Param("restaurantId") rid: string,
    @Param("requestId") requestId: string,
    @Body() dto: ReviewRequestDto,
  ) {
    return this.team.reviewTimeOff(this.uid(req), rid, requestId, dto);
  }

  /*
   * `GET …/team/swaps` was removed (ADR 0088). No client called it, and
   * `swap_requests` has no writer anywhere in the repository — so it could
   * only ever answer `[]`, which reads as "no swaps pending" rather than "this
   * does not exist". See the note in `team.service.ts`.
   */

  // ── Coverage templates ─────────────────────────────────────────────────
  @Get("coverage-templates")
  coverageTemplates(@Req() req: any, @Param("restaurantId") rid: string) {
    return this.team.listCoverageTemplates(this.uid(req), rid);
  }

  @Post("coverage-templates")
  createCoverageTemplate(
    @Req() req: any,
    @Param("restaurantId") rid: string,
    @Body() dto: CreateCoverageTemplateDto,
  ) {
    return this.team.createCoverageTemplate(this.uid(req), rid, dto);
  }

  @Delete("coverage-templates/:id")
  deleteCoverageTemplate(
    @Req() req: any,
    @Param("restaurantId") rid: string,
    @Param("id") id: string,
  ) {
    return this.team.deleteCoverageTemplate(this.uid(req), rid, id);
  }

  // ── Performance / sales ingestion ────────────────────────────────────────
  @Get("members/:memberId/performance")
  performanceFor(
    @Req() req: any,
    @Param("restaurantId") rid: string,
    @Param("memberId") memberId: string,
  ) {
    return this.performance.getMemberPerformance(this.uid(req), rid, memberId);
  }

  @Post("sales")
  ingestSales(
    @Req() req: any,
    @Param("restaurantId") rid: string,
    @Body() dto: IngestSalesDto,
  ) {
    return this.performance.ingest(this.uid(req), rid, dto);
  }

  @Post("sales/batch")
  ingestSalesBatch(
    @Req() req: any,
    @Param("restaurantId") rid: string,
    @Body() body: IngestSalesBatchDto,
  ) {
    return this.performance.ingestBatch(this.uid(req), rid, body?.rows ?? []);
  }

  // ── Broadcast (crew messaging) ───────────────────────────────────────────
  /**
   * Message the crew, or one member of it.
   *
   * TWO defects closed here (ADR 0088).
   *
   * **T3 — one was silently all.** With no `memberIds` this targeted every
   * active linked member. That is a reasonable thing to *want*, but it was the
   * behaviour of an *omission*: a caller that forgot to pass an id — as the
   * legacy Manager Shift Desk's "message this person" control did — messaged
   * the whole restaurant, and the response (`{notified, emailed, texted}`)
   * looked identical either way. Absence of targeting was read as intent to
   * target everyone.
   *
   * So exactly one of `memberIds` or `audience: "everyone"` is now required —
   * the ambiguous call is a 400 before anything is sent, not a fan-out that is
   * only visible afterwards — and the response names its `audience` and its
   * reach. Both halves matter: the flag stops the wrong send, the count lets a
   * caller *notice* a right send that was bigger than it meant.
   *
   * **T4 — an opt-out that only one sender honoured.** The email and phone
   * lists came straight off the roster, while the scheduled mailer resolves
   * through `recipient-resolver.service.ts` and drops a user who turned the
   * channel off. Same people, same channels, opposite answers. The opt-outs are
   * applied here now, and what they suppressed is reported rather than
   * disappearing into a smaller number.
   */
  @Post("broadcast")
  async broadcast(
    @Req() req: any,
    @Param("restaurantId") rid: string,
    @Body() dto: BroadcastDto,
  ) {
    const userId = this.uid(req);
    await this.team.assertAccess(userId, rid, "manager");

    const named = dto.memberIds?.length ?? 0;
    if (named > 0 && dto.audience === "everyone") {
      throw new BadRequestException(
        "Send to named members or to everyone, not both: pass memberIds or audience:'everyone'.",
      );
    }
    if (named === 0 && dto.audience !== "everyone") {
      throw new BadRequestException(
        "A broadcast must say who it is for: pass memberIds, or audience:'everyone' to " +
          "message the whole active crew.",
      );
    }

    /**
     * Which channels this send may use. An omitted `channels` is today's
     * behaviour. What a caller declined is reported separately from what the
     * RECIPIENTS declined, so a smaller number is never mistaken for a smaller
     * audience.
     *
     * THREE CHANGES OF DEFAULT, 2026-09-04 (founder). All affect EVERY caller,
     * the legacy desk included, and all are stated on the surfaces that send.
     *
     * 1. **A crew message never sends email.** It is not that the send was
     *    unreliable — it worked. It left through `GmailService`, which is the
     *    house's single configured mailbox (`GMAIL_SENDER_EMAIL`,
     *    `communications/gmail.service.ts:78-80`), the same address procurement
     *    writes to vendors from. A staff member replying to "Saturday moved to
     *    seven" landed in the vendor thread.
     * 2. **A crew message never sends SMS**, for the same reason one layer
     *    over: the SMS sender is a shared account too, and a text from an
     *    unknown shared number is a worse version of the same problem. Both
     *    return when a house has senders of its own, "as long as the
     *    third-party connections are well built" (founder) — see team.md §13.7c.
     * 3. **The channel set is `["inbox", "push"]`, and that is all there is.**
     *    An omitted `channels` used to mean "every channel this person has an
     *    address for" — the same absence-read-as-intent shape ADR 0088 T3
     *    removed from the audience.
     *
     * NAMING A REMOVED CHANNEL IS REPORTED, NEVER SILENTLY DROPPED. A caller
     * that asks for `email` or `sms` gets the count of people it would have
     * reached back under `withheldByProduct`, with the reason. A gate that
     * quietly shrinks a send is how "we told everyone" becomes untrue.
     *
     * AND THE OPT-OUT MOVED ONTO PUSH. It used to govern the two legs that are
     * now gone; push is the only outbound channel left, and a channel nobody
     * can decline is one they will eventually resent.
     * `notification_preferences.push_enabled` exists and says exactly that
     * (baseline `:3929`).
     */
    const DEFAULT_CHANNELS: Array<"inbox" | "push"> = ["inbox", "push"];
    const allowed = dto.channels ?? DEFAULT_CHANNELS;
    /** The channels this house has no sender of its own for. */
    const NO_SENDER: ReadonlyArray<"email" | "sms"> = ["email", "sms"];
    const may = (channel: "inbox" | "push" | "email" | "sms"): boolean =>
      // A gate a caller can open is not a gate: neither removed channel is
      // permitted however it is asked for.
      !NO_SENDER.includes(channel as "email" | "sms") && allowed.includes(channel);

    const roster = await this.team.listMembers(userId, rid);
    const targets = named
      ? roster.filter((m: any) => dto.memberIds!.includes(m.id))
      : roster.filter((m: any) => m.status === "active" && m.accountLinked);
    const audience: "everyone" | "selected" = named ? "selected" : "everyone";
    const userIds = targets.map((m: any) => m.user_id).filter(Boolean);

    // Read BEFORE anything is sent, because push is now governed by it. `null`
    // means the read FAILED, which is not the same as "nobody opted out" — the
    // push leg is then skipped and said out loud rather than sent to people who
    // may have declined ([[absence-reported-as-health]]).
    const optOuts = await this.team.channelOptOuts(userIds);
    const preferencesUnavailable = optOuts === null;

    const wants = (m: any, channel: "push"): boolean => {
      if (!optOuts) return false;
      // An account-less roster entry has no user id and therefore no
      // preferences row it could ever have written. It has not opted out.
      if (!m.user_id) return true;
      return !optOuts.optedOut[channel].has(m.user_id);
    };

    // Always land in the in-app inbox — but ONLY the addressed members' inboxes
    // when the caller named targets. A renewal request addressed to one person
    // must never read as a restaurant-wide announcement (team-audit.md).
    if (may("inbox"))
      await this.notifications.persistForRestaurant(
        rid,
        {
          type: "system",
          title: dto.title ?? "Team broadcast",
          message: dto.message,
          priority: "high",
          actionUrl: "/team",
          actionLabel: "Open Team",
        },
        named ? { onlyUserIds: userIds } : {},
      );

    const pushable = may("push")
      ? targets.filter((m: any) => m.user_id && wants(m, "push"))
      : [];
    const pushIds = pushable.map((m: any) => m.user_id);
    if (pushIds.length) {
      await this.push.sendToUsers(pushIds, {
        title: dto.title ?? "Message from your manager",
        body: dto.message,
        priority: "high",
        data: { type: "team_broadcast", actionUrl: "/team" },
      });
    }

    // Counted, not sent: how many people COULD have been reached on a removed
    // channel is the size of what this decision withholds, and reporting 0
    // would hide it.
    const allEmails = targets.filter((m: any) => m.email || m.linkedUser?.email);
    const allPhones = targets.filter((m: any) => m.phone);

    // Three different reasons a person did not get something, kept apart.
    // Folding them would let "the house has no sender" read as "nobody wanted
    // a message", which is a different fact about the house.
    const suppressed = {
      email: 0,
      sms: 0,
      push: may("push") ? userIds.length - pushIds.length : 0,
    };
    const withheldByCaller = {
      email: 0,
      sms: 0,
      push: may("push") ? 0 : userIds.length,
    };
    const withheldByProduct = {
      email: allEmails.length,
      sms: allPhones.length,
      reason:
        "a crew message would leave through the house's shared mailbox and shared SMS number, the ones vendors are written from; both return when this house has senders of its own",
    };

    const emailed = 0;
    const texted = 0;

    return {
      audience,
      recipients: { targeted: targets.length, notified: pushIds.length },
      suppressed,
      withheldByCaller,
      withheldByProduct,
      channels: allowed.filter((c) => !NO_SENDER.includes(c as "email" | "sms")),
      preferencesUnavailable,
      notified: pushIds.length,
      emailed,
      texted,
      inbox: may("inbox"),
    };
  }

  // ── Crew notes ───────────────────────────────────────────────────────────
  /**
   * A note about the week, as a record rather than a send.
   *
   * `POST …/broadcast` reaches people and leaves nothing a manager can read
   * back, which is why the week strip could only report what the page had just
   * done. These three routes give the note an author, an audience captured at
   * send time and a per-person `opened_at` (`team_notes`,
   * `team_note_recipients`, migration 20260904180000). Delivery is the inbox
   * and the phone; there is no email leg here either, for the same reason.
   */
  @Get("notes")
  listNotes(
    @Req() req: any,
    @Param("restaurantId") rid: string,
    @Query("weekStart") weekStart: string,
  ) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart ?? "")) {
      throw new BadRequestException(
        `weekStart must be a date like 2026-09-04; got "${weekStart}".`,
      );
    }
    return this.notes.list(this.uid(req), rid, weekStart);
  }

  @Post("notes")
  createNote(
    @Req() req: any,
    @Param("restaurantId") rid: string,
    @Body() dto: CreateTeamNoteDto,
  ) {
    return this.notes.create(this.uid(req), rid, dto);
  }

  /** The caller has opened it. Their own row, and only the first time. */
  @Post("notes/:noteId/opened")
  openNote(
    @Req() req: any,
    @Param("restaurantId") rid: string,
    @Param("noteId") noteId: string,
  ) {
    return this.notes.markOpened(this.uid(req), rid, noteId);
  }

  // ── Settings (labor toggle) ──────────────────────────────────────────────
  @Get("settings")
  getSettings(@Req() req: any, @Param("restaurantId") rid: string) {
    return this.team.getSettings(this.uid(req), rid);
  }

  @Patch("settings")
  updateSettings(
    @Req() req: any,
    @Param("restaurantId") rid: string,
    @Body() dto: UpdateTeamSettingsDto,
  ) {
    return this.team.updateSettings(this.uid(req), rid, dto);
  }
}
