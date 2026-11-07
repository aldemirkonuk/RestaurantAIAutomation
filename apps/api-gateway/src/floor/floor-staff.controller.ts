import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { FloorEnabledGuard } from "./floor-enabled.guard";
import { floorActorOf } from "./floor-common";
import { FloorService } from "./floor.service";
import { FoodUpDto, LeaveDto, OnBreakDto, SeatDto } from "./floor.dto";

/**
 * `/floor/me` — the waiter's phone (ADR 0345 Role map). Every route admits
 * staff AND owners/managers (a manager may work the floor), carries its own
 * `@Roles` (E6), and is dark while the house's switch is off (E7). None of them
 * returns a figure.
 */
@Controller("floor/me")
@UseGuards(JwtAuthGuard, RolesGuard, FloorEnabledGuard)
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class FloorStaffController {
  constructor(private readonly floor: FloorService) {}

  @Get("tables")
  @Roles("owner", "manager", "staff")
  tables(@Req() req: any) {
    return this.floor.myTables(floorActorOf(req));
  }

  @Post("seat")
  @Roles("owner", "manager", "staff")
  seat(@Req() req: any, @Body() dto: SeatDto) {
    return this.floor.seat(floorActorOf(req), dto.tableId, dto.partySize ?? null);
  }

  @Post("seatings/:id/visit")
  @Roles("owner", "manager", "staff")
  visit(@Req() req: any, @Param("id", ParseUUIDPipe) id: string) {
    return this.floor.visit(floorActorOf(req), id);
  }

  @Post("seatings/:id/paid")
  @HttpCode(200)
  @Roles("owner", "manager", "staff")
  paid(@Req() req: any, @Param("id", ParseUUIDPipe) id: string) {
    return this.floor.paid(floorActorOf(req), id);
  }

  @Post("seatings/:id/paid/undo")
  @HttpCode(200)
  @Roles("owner", "manager", "staff")
  undoPaid(@Req() req: any, @Param("id", ParseUUIDPipe) id: string) {
    return this.floor.undoPaid(floorActorOf(req), id);
  }

  @Post("seatings/:id/leave")
  @HttpCode(200)
  @Roles("owner", "manager", "staff")
  leave(@Req() req: any, @Param("id", ParseUUIDPipe) id: string, @Body() dto: LeaveDto) {
    return this.floor.leave(floorActorOf(req), id, dto.confirmShort === true);
  }

  @Post("food-up")
  @Roles("owner", "manager", "staff")
  foodUp(@Req() req: any, @Body() dto: FoodUpDto) {
    return this.floor.foodUp(floorActorOf(req), dto.tableId, dto.course, dto.note);
  }

  @Post("food-up/:id/ack")
  @HttpCode(200)
  @Roles("owner", "manager", "staff")
  foodAck(@Req() req: any, @Param("id", ParseUUIDPipe) id: string) {
    return this.floor.foodAck(floorActorOf(req), id);
  }

  @Post("food-up/:id/delivered")
  @HttpCode(200)
  @Roles("owner", "manager", "staff")
  foodDelivered(@Req() req: any, @Param("id", ParseUUIDPipe) id: string) {
    return this.floor.foodDelivered(floorActorOf(req), id);
  }

  @Get("clock")
  @Roles("owner", "manager", "staff")
  clock(@Req() req: any) {
    return this.floor.clockState(floorActorOf(req));
  }

  @Post("clock-in")
  @Roles("owner", "manager", "staff")
  clockIn(@Req() req: any) {
    return this.floor.clockIn(floorActorOf(req));
  }

  @Post("clock-out")
  @HttpCode(200)
  @Roles("owner", "manager", "staff")
  clockOut(@Req() req: any) {
    return this.floor.clockOut(floorActorOf(req));
  }

  @Post("on-break")
  @HttpCode(200)
  @Roles("owner", "manager", "staff")
  onBreak(@Req() req: any, @Body() dto: OnBreakDto) {
    return this.floor.onBreak(floorActorOf(req), dto.coverUserId ?? null);
  }

  @Post("back")
  @Roles("owner", "manager", "staff")
  back(@Req() req: any) {
    return this.floor.back(floorActorOf(req));
  }

  @Get("out-tonight")
  @Roles("owner", "manager", "staff")
  outTonight(@Req() req: any) {
    return this.floor.outTonight(floorActorOf(req));
  }

  @Get("notes")
  @Roles("owner", "manager", "staff")
  notes(@Req() req: any) {
    return this.floor.myNotes(floorActorOf(req));
  }
}
