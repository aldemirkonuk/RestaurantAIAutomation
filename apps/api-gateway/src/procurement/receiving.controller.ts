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
  IsIn,
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
import {
  DOOR_OUTCOMES,
  DOOR_REFUSAL_REASONS,
  ReceivingService,
  type DoorOutcome,
  type DoorRefusalReason,
} from "./receiving.service";
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

  @ApiPropertyOptional({
    description:
      "Units visibly damaged and refused, IN THE SAME UNIT AS countedQty. The unit is in " +
      "the field name because it was previously stated nowhere at all: the door sends both " +
      "numbers in boxes, the server converted only countedQty, and `countedBottles - rejectedQty` " +
      "subtracted boxes from bottles. Three refused boxes at pack 12 booked 33 bottles of live " +
      "stock for wine that was turned away at the door.",
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  rejectedQtyInCountedUom?: number;

  @ApiPropertyOptional({
    deprecated: true,
    description:
      "DEPRECATED — the same number, under its old unitless name. Accepted only so that a " +
      "receipt already queued in a phone's outbox by an older client still books its refusal. " +
      "Interpreted in countedUom, which is what that client always meant.",
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  rejectedQty?: number;

  @ApiPropertyOptional({
    description: "How the delivery stands, in the receiver's own word",
    enum: DOOR_OUTCOMES as unknown as string[],
  })
  @IsOptional()
  @IsIn(DOOR_OUTCOMES as unknown as string[])
  outcome?: DoorOutcome;

  @ApiPropertyOptional({
    description:
      "Why it was turned away. Only meaningful with outcome='refused' — the service drops it " +
      "otherwise, and a CHECK constraint refuses the pair in the database as well.",
    enum: DOOR_REFUSAL_REASONS as unknown as string[],
  })
  @IsOptional()
  @IsIn(DOOR_REFUSAL_REASONS as unknown as string[])
  refusalReason?: DoorRefusalReason;

  @ApiPropertyOptional({ description: "Who signed. Initials, no ceremony." })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  signedByInitials?: string;

  @ApiPropertyOptional({
    description: "The driver present, as the receiver typed it",
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  driverName?: string;

  @ApiPropertyOptional({
    description:
      "What the order expected, IN THE SAME UNIT AS countedQty. Sent so the row records what " +
      "the door believed at the moment of the count, rather than what the order says whenever " +
      "someone reads it back.",
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  expectedQtyInCountedUom?: number;

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

  /**
   * Free prose only — everything structured now has a column.
   *
   * This cap was a BLOCKING bug. The door used to flatten outcome, reason,
   * counted, expected, broken, signedBy, driver AND a full drafted credit letter
   * into this one field: a 344-character fixed skeleton, leaving ~156 characters
   * for a provider name, a wine name, an order number and a driver name. A real
   * distributor plus a real Bordeaux measured 546. That is a 400, and
   * `doorOutbox.ts:64-65` treats a 4xx as PERMANENT — so the receiver could not
   * save the delivery at all, no matter how many times they retried.
   *
   * With the structured facts in columns the skeleton is 259 characters, and
   * `composeDoorNotes` clamps every interpolated name to a fixed budget and then
   * clamps the whole string, so the bound holds by construction rather than by
   * anyone re-doing the arithmetic. MEASURED with every budget saturated: 449;
   * the same real distributor and Bordeaux that produced 546 now produce 431.
   * The cap stays at 500 because a client is not the right thing to trust with
   * an unbounded text column.
   */
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
        // Both names reach the service, which prefers the one that declares its
        // unit. The old name is passed through rather than dropped so a receipt
        // queued by an older client still books its refusal — dropping it would
        // make a queued refusal arrive with nothing rejected, which is the
        // corruption this change exists to end, reintroduced by the fix.
        rejectedQtyInCountedUom: body.rejectedQtyInCountedUom,
        rejectedQty: body.rejectedQty,
        damagePhotoPath: body.damagePhotoPath ?? null,
        documentId: body.documentId ?? null,
        idempotencyKey: body.idempotencyKey ?? null,
        clientCapturedAt: body.clientCapturedAt ?? null,
        notes: body.notes ?? null,
        outcome: body.outcome ?? null,
        refusalReason: body.refusalReason ?? null,
        signedByInitials: body.signedByInitials ?? null,
        driverName: body.driverName ?? null,
        expectedQtyInCountedUom: body.expectedQtyInCountedUom ?? null,
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

  @Get("orders/:id/received")
  @ApiOperation({
    summary: "What earlier trucks on this order already brought",
    description:
      "Split deliveries are normal in wine. Without this the door compared truck two's six boxes against the whole purchase order and called it ten short while the driver stood there. The total is summed from procurement_receipt_events rather than read from procurement_orders.quantity_received, because that column is a cache and the events are the record. receivedBoxes is null — never 0 — when the pack size is not knowable.",
  })
  async receivedSoFar(
    @Param("id") orderId: string,
    @CurrentUser() user: AuthedUser,
  ) {
    try {
      return await this.receiving.doorReceivedSoFar(user.restaurantId, orderId);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error.message || "Failed to read what this order has already received",
        HttpStatus.INTERNAL_SERVER_ERROR,
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
