import {
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
  CreateTimeOffDto,
  IngestSalesDto,
  OfferCoverDto,
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
  week(@Req() req: any, @Param("restaurantId") rid: string, @Query("weekStart") ws: string) {
    return this.schedule.getWeek(this.uid(req), rid, ws);
  }

  @Get("my-week")
  myWeek(@Req() req: any, @Param("restaurantId") rid: string, @Query("weekStart") ws: string) {
    return this.schedule.getMyWeek(this.uid(req), rid, ws);
  }

  @Post("schedules")
  createSchedule(@Req() req: any, @Param("restaurantId") rid: string, @Body() dto: CreateScheduleDto) {
    return this.schedule.createSchedule(this.uid(req), rid, dto);
  }

  @Post("schedules/copy-week")
  copyWeek(@Req() req: any, @Param("restaurantId") rid: string, @Body() dto: CopyWeekDto) {
    return this.schedule.copyWeek(this.uid(req), rid, dto);
  }

  @Post("schedules/:scheduleId/publish")
  publish(@Req() req: any, @Param("restaurantId") rid: string, @Param("scheduleId") sid: string) {
    return this.schedule.publish(this.uid(req), rid, sid);
  }

  @Post("schedules/:scheduleId/acknowledge")
  acknowledge(@Req() req: any, @Param("restaurantId") rid: string, @Param("scheduleId") sid: string) {
    return this.schedule.acknowledge(this.uid(req), rid, sid);
  }

  // ── Shifts ────────────────────────────────────────────────────────────────
  @Post("shifts")
  createShift(@Req() req: any, @Param("restaurantId") rid: string, @Body() dto: CreateShiftDto) {
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
  deleteShift(@Req() req: any, @Param("restaurantId") rid: string, @Param("shiftId") sid: string) {
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
  createCert(@Req() req: any, @Param("restaurantId") rid: string, @Body() dto: CreateCertDto) {
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
  deleteCert(@Req() req: any, @Param("restaurantId") rid: string, @Param("certId") certId: string) {
    return this.team.deleteCert(this.uid(req), rid, certId);
  }

  // ── Time off / swaps ───────────────────────────────────────────────────
  @Get("time-off")
  timeOff(@Req() req: any, @Param("restaurantId") rid: string) {
    return this.team.listTimeOff(this.uid(req), rid);
  }

  @Post("time-off")
  createTimeOff(@Req() req: any, @Param("restaurantId") rid: string, @Body() dto: CreateTimeOffDto) {
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

  @Get("swaps")
  swaps(@Req() req: any, @Param("restaurantId") rid: string) {
    return this.team.listSwaps(this.uid(req), rid);
  }

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
  deleteCoverageTemplate(@Req() req: any, @Param("restaurantId") rid: string, @Param("id") id: string) {
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
  ingestSales(@Req() req: any, @Param("restaurantId") rid: string, @Body() dto: IngestSalesDto) {
    return this.performance.ingest(this.uid(req), rid, dto);
  }

  @Post("sales/batch")
  ingestSalesBatch(
    @Req() req: any,
    @Param("restaurantId") rid: string,
    @Body() body: { rows: IngestSalesDto[] },
  ) {
    return this.performance.ingestBatch(this.uid(req), rid, body?.rows ?? []);
  }

  // ── Broadcast (crew messaging) ───────────────────────────────────────────
  @Post("broadcast")
  async broadcast(@Req() req: any, @Param("restaurantId") rid: string, @Body() dto: BroadcastDto) {
    const userId = this.uid(req);
    await this.team.assertAccess(userId, rid, "manager");
    if (dto.memberIds?.length) {
      const perf = await this.team.listMembers(userId, rid);
      const userIds = perf
        .filter((m: any) => dto.memberIds!.includes(m.id) && m.user_id)
        .map((m: any) => m.user_id);
      await this.push.sendToUsers(userIds, {
        title: dto.title ?? "Message from your manager",
        body: dto.message,
        priority: "high",
        data: { type: "team_broadcast", actionUrl: "/team" },
      });
      return { notified: userIds.length };
    }
    await this.notifications.persistForRestaurant(rid, {
      type: "system",
      title: dto.title ?? "📣 Team broadcast",
      message: dto.message,
      priority: "high",
      actionUrl: "/team",
      actionLabel: "Open Team",
    });
    return { broadcast: true };
  }

  // ── Settings (labor toggle) ──────────────────────────────────────────────
  @Get("settings")
  getSettings(@Req() req: any, @Param("restaurantId") rid: string) {
    return this.team.getSettings(this.uid(req), rid);
  }

  @Patch("settings")
  updateSettings(@Req() req: any, @Param("restaurantId") rid: string, @Body() dto: UpdateTeamSettingsDto) {
    return this.team.updateSettings(this.uid(req), rid, dto);
  }
}
