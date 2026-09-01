import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from "class-validator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { ReceivingService } from "./receiving.service";
import { ORDER_UNIT_TYPES } from "./order-units";

type AuthedUser = { userId: string; restaurantId: string };

export class DoorReceiptDto {
  @ApiProperty({ description: "What was counted at the door, in countedUom" })
  @IsNumber()
  @Min(0)
  countedQty!: number;

  @ApiProperty({
    description:
      "Unit actually counted — bottle | case | keg | pack | split_case | each | liter. " +
      "REQUIRED, and no longer defaulted to 'case': 'case' is the unit that multiplies, so an " +
      "absent or misspelt unit used to book 24 counted against a 12-pack as 288 bottles of live " +
      "stock. An unrecognised unit is refused and nothing is booked (ADR 0011).",
    enum: ORDER_UNIT_TYPES as unknown as string[],
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  countedUom!: string;

  @ApiPropertyOptional({
    description: "Bottles per case, when the receiver knows it",
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  packSize?: number;

  @ApiPropertyOptional({ description: "Units visibly damaged and refused" })
  @IsOptional()
  @IsNumber()
  @Min(0)
  rejectedQty?: number;

  @ApiPropertyOptional({
    description:
      "Storage path of a damage photo. A receiver cannot tell corked from broken from wrong-SKU, so we take the picture and let a manager classify it.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  damagePhotoPath?: string;

  @ApiPropertyOptional({
    description:
      "Document photographed at the door — usually a packing slip, not an invoice",
  })
  @IsOptional()
  @IsUUID()
  documentId?: string;

  @ApiPropertyOptional({
    description:
      "Client-generated key, stable across offline retries. The same tap must never book stock twice.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  idempotencyKey?: string;

  @ApiPropertyOptional({
    description: "When the tap happened, if it synced later",
  })
  @IsOptional()
  @IsISO8601()
  clientCapturedAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

/**
 * The door stage of receiving.
 *
 * Deliberately tiny. Everything a porter in a stairwell can honestly answer in
 * thirty seconds: how many boxes, was anything obviously broken, and a photo of
 * whatever paper the driver handed over. No prices — line cost is not floor-staff
 * information and it is the single biggest source of hesitation at the door. No
 * "does this match the order?", because that is a question the person holding the
 * hand truck cannot answer and a wrong answer becomes a wrong vendor claim.
 *
 * The bottle count and the four-way match happen later, through verifyReceipt,
 * which is unchanged.
 */
@ApiTags("procurement-receiving")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("procurement/receiving")
export class ReceivingController {
  constructor(private readonly receiving: ReceivingService) {}

  @Post("orders/:id/door")
  @ApiOperation({
    summary: "Record a delivery at the door (case count) and book the stock",
    description:
      "Books the counted quantity to live stock immediately — the wine is physically on the shelf and staff must be able to pour it. No unit cost is written: nobody has seen an invoice yet, so the lot stays cost_provenance='estimated' until verifyReceipt corrects it to landed cost. The order is left PARTIALLY_RECEIVED, never completed, so the bottle count that catches a short case is still expected.",
  })
  async door(
    @Param("id") orderId: string,
    @Body() body: DoorReceiptDto,
    @CurrentUser() user: AuthedUser,
  ) {
    try {
      return await this.receiving.recordDoorReceipt({
        restaurantId: user.restaurantId,
        orderId,
        userId: user.userId,
        countedQty: body.countedQty,
        // NOT `?? "case"`. The controller injecting the multiplying unit put the
        // exact defect this endpoint was fixed for back one layer up, where the
        // service's fail-closed check could never see it.
        countedUom: body.countedUom,
        packSize: body.packSize ?? null,
        rejectedQty: body.rejectedQty ?? 0,
        damagePhotoPath: body.damagePhotoPath ?? null,
        documentId: body.documentId ?? null,
        idempotencyKey: body.idempotencyKey ?? null,
        clientCapturedAt: body.clientCapturedAt ?? null,
        notes: body.notes ?? null,
      });
    } catch (error) {
      // A refusal keeps its own body. Re-wrapping it flattened the structured
      // `{ reason, message }` a client needs to tell "we cannot read that unit"
      // apart from "the server broke".
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error.message || "Failed to record the delivery",
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get("queue")
  @ApiOperation({
    summary: "Deliveries that need a decision, worst money first",
    description:
      "Only discrepancies — a delivery that matched is not a task, and listing it would bury the four that cost something under forty that did not. Sorted by dollars at risk rather than by date, because the reason to open this list is to recover money. Claims provable from the vendor's own packing slip are marked; those are the ones worth starting with.",
  })
  async queue(@CurrentUser() user: AuthedUser) {
    try {
      return await this.receiving.managerQueue(user.restaurantId);
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to load the receiving queue",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get("unverified")
  @ApiOperation({
    summary: "Deliveries counted by case and not yet counted by bottle",
    description:
      "The safety net for booking stock at the door. The approximate hour after a truck arrives is fine; the delivery nobody ever went back to is how a short case becomes unexplained shrinkage two months later — at which point it is indistinguishable from theft and can no longer be claimed from the vendor. Sorted oldest first, with a severity tier that escalates with age.",
  })
  async unverified(@CurrentUser() user: AuthedUser) {
    try {
      const items = await this.receiving.listUnverified(user.restaurantId);
      return {
        items,
        // A single line for the manager's queue, rather than a second stock
        // number on every screen that would train people to ignore both.
        summary: items.length
          ? `${items.length} deliver${items.length === 1 ? "y" : "ies"} counted by case, oldest ${items[0].ageHours}h`
          : null,
        overdue: items.filter((i) => i.severity === "overdue").length,
      };
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to load unverified deliveries",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
