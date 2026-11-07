import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from "@nestjs/common";
import type { Response } from "express";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { FloorEnabledGuard } from "./floor-enabled.guard";
import { floorActorOf } from "./floor-common";
import { FloorAdminService } from "./floor-admin.service";
import { FloorBoardService } from "./floor-board.service";
import {
  AssignDto,
  ConfirmLinkDto,
  FloorSettingsDto,
  OutTonightDto,
  ReassignApplyDto,
  ReassignProposeDto,
  ReportQueryDto,
  SectionDto,
  SectionTablesDto,
  SectionUpdateDto,
} from "./floor.dto";

/**
 * `/floor` — the owner's and manager's view (ADR 0345 Role map). Every figure
 * route (board, report, CSV) and every admin route carries
 * `@Roles("owner", "manager")` on its own (E6). Out tonight's mark and back
 * also admit staff; the service then admits only kitchen or bar leads
 * (Open as OD-242, the executor's reading under OD-242).
 */
@Controller("floor")
@UseGuards(JwtAuthGuard, RolesGuard, FloorEnabledGuard)
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class FloorManagerController {
  constructor(
    private readonly board: FloorBoardService,
    private readonly admin: FloorAdminService,
  ) {}

  // --------------------------------------------------------------- figures

  @Get("board")
  @Roles("owner", "manager")
  getBoard(@Req() req: any) {
    return this.board.board(floorActorOf(req));
  }

  @Get("report")
  @Roles("owner", "manager")
  report(@Req() req: any, @Query() q: ReportQueryDto) {
    return this.board.report(floorActorOf(req), q.date);
  }

  @Get("report/seatings.csv")
  @Roles("owner", "manager")
  async seatingsCsv(@Req() req: any, @Query() q: ReportQueryDto, @Res() res: Response) {
    const out = await this.board.csv(floorActorOf(req), q.date, "seatings");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${out.filename}"`);
    res.send(out.body);
  }

  @Get("report/waiters.csv")
  @Roles("owner", "manager")
  async waitersCsv(@Req() req: any, @Query() q: ReportQueryDto, @Res() res: Response) {
    const out = await this.board.csv(floorActorOf(req), q.date, "waiters");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${out.filename}"`);
    res.send(out.body);
  }

  // -------------------------------------------------------------- sections

  @Get("sections")
  @Roles("owner", "manager")
  sections(@Req() req: any) {
    return this.admin.sections(floorActorOf(req));
  }

  @Post("sections")
  @Roles("owner", "manager")
  createSection(@Req() req: any, @Body() dto: SectionDto) {
    return this.admin.createSection(floorActorOf(req), dto.name, dto.sort ?? 0);
  }

  @Patch("sections/:id")
  @Roles("owner", "manager")
  updateSection(@Req() req: any, @Param("id", ParseUUIDPipe) id: string, @Body() dto: SectionUpdateDto) {
    return this.admin.updateSection(floorActorOf(req), id, dto);
  }

  @Delete("sections/:id")
  @Roles("owner", "manager")
  archiveSection(@Req() req: any, @Param("id", ParseUUIDPipe) id: string) {
    return this.admin.archiveSection(floorActorOf(req), id);
  }

  @Put("sections/:id/tables")
  @Roles("owner", "manager")
  setSectionTables(@Req() req: any, @Param("id", ParseUUIDPipe) id: string, @Body() dto: SectionTablesDto) {
    return this.admin.setSectionTables(floorActorOf(req), id, dto.tableIds);
  }

  // ----------------------------------------------------------- assignments

  @Get("assignments")
  @Roles("owner", "manager")
  assignments(@Req() req: any) {
    return this.admin.assignments(floorActorOf(req));
  }

  @Post("assignments")
  @Roles("owner", "manager")
  assign(@Req() req: any, @Body() dto: AssignDto) {
    return this.admin.assign(floorActorOf(req), dto.userId, { sectionId: dto.sectionId, tableId: dto.tableId });
  }

  @Delete("assignments/:id")
  @Roles("owner", "manager")
  release(@Req() req: any, @Param("id", ParseUUIDPipe) id: string) {
    return this.admin.release(floorActorOf(req), id);
  }

  @Post("reassign/propose")
  @HttpCode(200)
  @Roles("owner", "manager")
  propose(@Req() req: any, @Body() dto: ReassignProposeDto) {
    return this.admin.proposeReassign(floorActorOf(req), dto.fromUserId);
  }

  @Post("reassign/apply")
  @HttpCode(200)
  @Roles("owner", "manager")
  apply(@Req() req: any, @Body() dto: ReassignApplyDto) {
    return this.admin.applyReassign(floorActorOf(req), dto.fromUserId, dto.moves);
  }

  // -------------------------------------------------------------- settings

  @Get("settings")
  @Roles("owner", "manager")
  settings(@Req() req: any) {
    return this.admin.settings(floorActorOf(req));
  }

  @Put("settings")
  @Roles("owner", "manager")
  saveSettings(@Req() req: any, @Body() dto: FloorSettingsDto) {
    return this.admin.saveSettings(floorActorOf(req), dto.warnAfterMin, dto.lateAfterMin);
  }

  // ----------------------------------------------------------- Out tonight

  @Post("out-tonight")
  @Roles("owner", "manager", "staff")
  markOut(@Req() req: any, @Body() dto: OutTonightDto) {
    return this.admin.markOut(floorActorOf(req), dto.menuItemId, dto.label);
  }

  @Post("out-tonight/:id/back")
  @HttpCode(200)
  @Roles("owner", "manager", "staff")
  backOn(@Req() req: any, @Param("id", ParseUUIDPipe) id: string) {
    return this.admin.backOn(floorActorOf(req), id);
  }

  // ------------------------------------------------------- till-name links

  @Get("pos-links")
  @Roles("owner", "manager")
  posLinks(@Req() req: any) {
    return this.admin.posLinks(floorActorOf(req));
  }

  @Post("pos-links/:id/confirm")
  @HttpCode(200)
  @Roles("owner", "manager")
  confirmLink(@Req() req: any, @Param("id", ParseUUIDPipe) id: string, @Body() body: ConfirmLinkDto) {
    return this.admin.confirmLink(floorActorOf(req), id, body.userId);
  }

  @Post("pos-links/:id/unlink")
  @HttpCode(200)
  @Roles("owner", "manager")
  unlink(@Req() req: any, @Param("id", ParseUUIDPipe) id: string) {
    return this.admin.unlink(floorActorOf(req), id);
  }
}
