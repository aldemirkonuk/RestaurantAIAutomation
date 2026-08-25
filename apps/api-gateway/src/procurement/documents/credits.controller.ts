import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiQuery,
  ApiTags,
} from "@nestjs/swagger";
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from "class-validator";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { DatabaseService } from "../../database/database.service";
import {
  Credit,
  CreditState,
  recoveryStats,
  transition,
} from "./credit-ledger";

type AuthedUser = { userId: string; restaurantId: string };

const STATES = [
  "open",
  "requested",
  "promised",
  "credited",
  "rejected",
  "written_off",
] as const;

export class TransitionCreditDto {
  @ApiProperty({ enum: STATES })
  @IsIn(STATES as unknown as string[])
  to!: CreditState;

  @ApiPropertyOptional({
    description:
      "What the vendor actually allowed. Required to mark a claim credited — partial settlement is the norm, and recording the amount we asked for instead would overstate recovery by exactly the disputed part.",
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  creditedAmount?: number;

  @ApiPropertyOptional({
    description:
      "The credit memo that settles this claim. Required to mark it credited — without the document it is a promise, and a promise counted as recovery is a number a bookkeeper will disprove.",
  })
  @IsOptional()
  @IsUUID()
  creditDocumentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

/**
 * Vendor credit claims — the money a distributor owes back.
 *
 * The one thing this surface exists to keep honest: CLAIMED IS NOT RECOVERED.
 * A restaurant that has asked for $4,200 has recovered nothing. Recovery means a
 * credit memo exists. Those are different fields, different states, and only one
 * of them appears as `recovered`.
 */
@ApiTags("procurement-credits")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("procurement/credits")
export class CreditsController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  @ApiOperation({
    summary: "Open claims, oldest first — the manager's chase list",
  })
  @ApiQuery({ name: "state", required: false })
  @ApiQuery({ name: "providerId", required: false })
  async list(
    @CurrentUser() user: AuthedUser,
    @Query("state") state?: string,
    @Query("providerId") providerId?: string,
  ) {
    let q = this.db
      .getClient()
      .from("procurement_credits")
      .select("*")
      .eq("restaurant_id", user.restaurantId)
      // Oldest first: an ageing claim is the one at risk of never being settled,
      // and after a while a distributor simply will not entertain it.
      .order("opened_at", { ascending: true })
      .limit(200);
    if (state) q = q.eq("state", state);
    if (providerId) q = q.eq("provider_id", providerId);

    const { data, error } = await q;
    if (error)
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    return { items: data ?? [] };
  }

  @Get("stats")
  @ApiOperation({
    summary: "Recovery figures",
    description:
      "`recovered` counts only claims settled by a credit memo, using the amount the vendor allowed. `outstanding` and `promised` are explicitly not recovery. `rejected` is reported alongside so the figure has a denominator — a recovery number with nothing to divide it by flatters.",
  })
  async stats(@CurrentUser() user: AuthedUser) {
    const { data, error } = await this.db
      .getClient()
      .from("procurement_credits")
      .select(
        "state, claimed_amount, credited_amount, credit_document_id, opened_at, self_evidenced",
      )
      .eq("restaurant_id", user.restaurantId)
      .limit(5000);
    if (error)
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);

    const credits: Credit[] = (data ?? []).map((r) => ({
      state: r.state as CreditState,
      claimedAmount: Number(r.claimed_amount ?? 0),
      creditedAmount:
        r.credited_amount == null ? null : Number(r.credited_amount),
      creditDocumentId: r.credit_document_id,
      openedAt: r.opened_at,
      selfEvidenced: !!r.self_evidenced,
    }));

    return {
      ...recoveryStats(credits),
      // Claims the vendor's own paperwork proves. Worth separating: these are
      // the ones worth a phone call, and a low settlement rate on them says
      // something about the distributor rather than about the claim.
      selfEvidencedOpen: credits.filter(
        (c) =>
          c.selfEvidenced &&
          ["open", "requested", "promised"].includes(c.state),
      ).length,
    };
  }

  @Post(":id/transition")
  @ApiOperation({
    summary: "Move a claim through the ledger",
    description:
      "Refuses transitions that would let unverifiable money be reported as recovered. `credited` requires both the amount allowed and the credit memo, and is terminal — a reopenable settled claim would let the same money count twice across periods.",
  })
  async transition(
    @Param("id") id: string,
    @Body() body: TransitionCreditDto,
    @CurrentUser() user: AuthedUser,
  ) {
    const { data: row, error } = await this.db
      .getClient()
      .from("procurement_credits")
      .select("*")
      .eq("id", id)
      .eq("restaurant_id", user.restaurantId)
      .maybeSingle();
    if (error)
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    if (!row) throw new HttpException("Claim not found", HttpStatus.NOT_FOUND);

    const current: Credit = {
      state: row.state,
      claimedAmount: Number(row.claimed_amount ?? 0),
      creditedAmount:
        row.credited_amount == null ? null : Number(row.credited_amount),
      creditDocumentId: row.credit_document_id,
      openedAt: row.opened_at,
      selfEvidenced: !!row.self_evidenced,
    };

    const outcome = transition(current, {
      to: body.to,
      creditedAmount: body.creditedAmount ?? null,
      creditDocumentId: body.creditDocumentId ?? null,
    });
    if (!outcome.ok || !outcome.next)
      throw new HttpException(
        outcome.error ?? "Invalid transition",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );

    const now = new Date().toISOString();
    const patch: Record<string, unknown> = {
      state: outcome.next.state,
      notes: body.notes ?? row.notes,
    };
    if (outcome.next.creditedAmount != null)
      patch.credited_amount = outcome.next.creditedAmount;
    if (outcome.next.creditDocumentId)
      patch.credit_document_id = outcome.next.creditDocumentId;

    // Timestamps are the aging data. Without them a chase list cannot say which
    // claim has been sitting with a distributor for three weeks.
    if (outcome.next.state === "requested") {
      patch.requested_at = now;
      patch.requested_by = user.userId;
    }
    if (outcome.next.state === "promised") patch.promised_at = now;
    if (["credited", "rejected", "written_off"].includes(outcome.next.state)) {
      patch.settled_at = now;
      patch.settled_by = user.userId;
    }

    const { data, error: updErr } = await this.db
      .getClient()
      .from("procurement_credits")
      .update(patch)
      .eq("id", id)
      .eq("restaurant_id", user.restaurantId)
      .select("*")
      .single();

    if (updErr)
      throw new HttpException(updErr.message, HttpStatus.INTERNAL_SERVER_ERROR);
    return data;
  }
}
