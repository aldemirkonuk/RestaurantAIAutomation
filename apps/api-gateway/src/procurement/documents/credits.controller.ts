import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  ParseUUIDPipe,
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
import { RolesGuard } from "../../auth/guards/roles.guard";
import { Roles } from "../../auth/decorators/roles.decorator";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { DatabaseService } from "../../database/database.service";
import {
  HouseLettersService,
  type CreditLetter,
} from "../../communications/letters/house-letters.service";
import {
  Credit,
  CreditState,
  memoMarkRefusal,
  recoveryStats,
  recoveryStatsByCurrency,
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
 * Draft the claim's letter, and say what happened in words rather than failing
 * the move (ADR 0230). The claim IS requested by the time this runs; a letter
 * that could not be drafted is reported beside it, and
 * `POST :id/request-letter` drafts it again. A module function rather than a
 * method so the controller's handler list stays its routes.
 */
async function draftLetter(
  letters: HouseLettersService,
  user: AuthedUser,
  creditId: string,
): Promise<CreditLetter> {
  try {
    return await letters.draftForCredit({
      restaurantId: user.restaurantId,
      userId: user.userId,
      creditId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { state: "failed", id: null, to: null, says: message };
  }
}

/**
 * Vendor credit claims — the money a distributor owes back.
 *
 * The one thing this surface exists to keep honest: CLAIMED IS NOT RECOVERED.
 * A restaurant that has asked for $4,200 has recovered nothing. Recovery means a
 * credit memo exists. Those are different fields, different states, and only one
 * of them appears as `recovered`.
 *
 * OWNER OR MANAGER ONLY, on every route here (ADR 0167, founder 2026-09-19:
 * "Refuse staff on all four"). Until then the class carried `JwtAuthGuard` alone,
 * so any signed-in member of the house, staff included, could read the chase list
 * and the recovery figures the staff view deliberately omits, and could move a
 * claim to `rejected` or `written_off`. `RolesGuard` reads `req.user.role`, which
 * for a token that names a house is the role IN THAT HOUSE (ADR 0162, answer A),
 * so this is decided per house and a role held elsewhere does not carry over.
 */
@ApiTags("procurement-credits")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("owner", "manager")
@Controller("procurement/credits")
export class CreditsController {
  constructor(
    private readonly db: DatabaseService,
    private readonly letters: HouseLettersService,
  ) {}

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
    const items = data ?? [];

    // Each claim's letters (ADR 0230): the draft it links to, and what became
    // of it. Read separately so a failure here is named rather than printed as
    // "no letter" — `letters: null` + `lettersError` is unknown, never none.
    let byCredit: Record<string, unknown[]> | null = null;
    let lettersError: string | null = null;
    let lettersCapped = false;
    try {
      const result = await this.letters.lettersForCredits(
        user.restaurantId,
        items.map((r: { id: string }) => r.id),
      );
      byCredit = result.byCredit;
      lettersCapped = result.capped;
    } catch (err) {
      lettersError = err instanceof Error ? err.message : String(err);
    }
    return {
      items: items.map((r: { id: string }) => ({
        ...r,
        // A claim PRESENT in `byCredit` keeps its letters even when the read
        // was capped — its own letter survived the window, so it is known
        // either way. A claim ABSENT from a capped read is unknown, not
        // none (audit round 1, R4): the window may have cut it, not the
        // vendor conversation. Only an uncapped absence is a real "[]".
        letters: byCredit
          ? byCredit[r.id] ?? (lettersCapped ? null : [])
          : null,
      })),
      lettersError,
      lettersCapped,
    };
  }

  @Post(":id/request-letter")
  @ApiOperation({
    summary:
      "Draft the letter asking the vendor for this credit, for a claim already asked for (ADR 0230)",
    description:
      "Drafts only — nothing is sent until someone sends the draft from Communications. Returns the claim's existing unsent draft instead of making a second one.",
  })
  async requestLetter(
    @Param("id") id: string,
    @CurrentUser() user: AuthedUser,
  ) {
    const { data: row, error } = await this.db
      .getClient()
      .from("procurement_credits")
      .select("id, state")
      .eq("id", id)
      .eq("restaurant_id", user.restaurantId)
      .maybeSingle();
    if (error)
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    if (!row) throw new HttpException("Claim not found", HttpStatus.NOT_FOUND);
    if (!["requested", "promised"].includes(row.state))
      throw new HttpException(
        `This claim is "${row.state}". A letter is drafted when the claim is asked for — move it to requested first.`,
        HttpStatus.CONFLICT,
      );
    return { letter: await draftLetter(this.letters, user, id) };
  }

  @Post("mark-memo/:documentId")
  @ApiOperation({
    summary:
      "Mark a paper this house holds as a credit memo (ADR 0267 item 9, F-159)",
    description:
      "Changes one document's type from `unknown` (a paper nothing has classed) to `credit_memo`, so a claim can be settled against it. Settles nothing and sends nothing. Refuses any other type — an invoice or a delivery paper keeps its role — and a superseded or rejected paper. Files a `system_audit_log` row (`document_marked_credit_memo`) naming who and when; `audited: false` with `auditReason` says when that row could not be written.",
  })
  async markMemo(
    @Param("documentId", new ParseUUIDPipe()) documentId: string,
    @CurrentUser() user: AuthedUser,
  ) {
    const client = this.db.getClient();
    const { data: paper, error } = await client
      .from("procurement_documents")
      .select("id, doc_type, status, direction")
      .eq("id", documentId)
      .eq("restaurant_id", user.restaurantId)
      .maybeSingle();
    if (error)
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    if (!paper)
      throw new HttpException(
        "That paper is not on file at this house.",
        HttpStatus.NOT_FOUND,
      );

    const verdict = memoMarkRefusal(paper);
    if (!verdict.ok)
      throw new HttpException(verdict.error, HttpStatus.CONFLICT);
    if (verdict.already)
      return {
        documentId,
        docType: "credit_memo",
        changed: false,
        audited: false,
        auditReason: "it was already a credit memo; nothing changed",
      };

    // Conditional on the type it was read with, so a classifier that lands in
    // between is never overwritten by a person's older view of the paper.
    const { data: updated, error: updErr } = await client
      .from("procurement_documents")
      .update({ doc_type: "credit_memo" })
      .eq("id", documentId)
      .eq("restaurant_id", user.restaurantId)
      .eq("doc_type", paper.doc_type)
      .select("id, doc_type, updated_at")
      .maybeSingle();
    if (updErr)
      throw new HttpException(
        `${updErr.message}. Nothing was changed.`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    if (!updated)
      throw new HttpException(
        "This paper changed while you were looking at it. Nothing was changed; read it again.",
        HttpStatus.CONFLICT,
      );

    // Who and when. procurement_documents has no "classified by" column, so
    // the trail is the house's audit log, as the settings writes keep theirs.
    // The mark stands if this row fails, and the answer says so.
    let audited = false;
    let auditReason: string | null = null;
    try {
      const { error: auditErr } = await client.from("system_audit_log").insert({
        actor_type: "user",
        actor_id: user.userId,
        action: "document_marked_credit_memo",
        entity_type: "procurement_document",
        entity_id: documentId,
        changes: {
          fields: { doc_type: { from: paper.doc_type, to: "credit_memo" } },
        },
        restaurant_id: user.restaurantId,
      });
      if (auditErr) auditReason = auditErr.message;
      else audited = true;
    } catch (err) {
      auditReason = err instanceof Error ? err.message : String(err);
    }

    return {
      documentId,
      docType: "credit_memo",
      changed: true,
      audited,
      auditReason,
    };
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
        "state, claimed_amount, credited_amount, credit_document_id, opened_at, self_evidenced, currency",
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
      currency: r.currency ?? null,
    }));

    return {
      ...recoveryStats(credits),
      // The same figures kept apart by the claim's own currency. The combined
      // ones above add lira to euros when a house claims in both; nothing here
      // converts, so a screen reads these and shows each currency on its own.
      byCurrency: recoveryStatsByCurrency(credits),
      // How many rows the figures were computed from, and whether that filled
      // the `.limit()` above. At the cap every figure is a floor, and only the
      // server can know it reached the cap.
      rowsCounted: credits.length,
      capped: credits.length >= 5000,
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

    // THE MEMO IS THIS HOUSE'S CREDIT MEMO (ADR 0267 item 9, F-159). The
    // foreign key admits any document id, another house's included, and any
    // type. Now that a claim can be settled straight from `open`, and a person
    // can mark a paper as a memo, the proof has to be the thing it says it is.
    if (outcome.next.state === "credited") {
      const { data: memo, error: memoErr } = await this.db
        .getClient()
        .from("procurement_documents")
        .select("id, doc_type")
        .eq("id", outcome.next.creditDocumentId as string)
        .eq("restaurant_id", user.restaurantId)
        .maybeSingle();
      if (memoErr)
        throw new HttpException(
          `The credit memo could not be read (${memoErr.message}). Nothing was recorded.`,
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      if (!memo)
        throw new HttpException(
          "That credit memo is not on file at this house. Nothing was recorded.",
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      if (memo.doc_type !== "credit_memo")
        throw new HttpException(
          "That paper is not filed as a credit memo. Mark it as one first; nothing was recorded.",
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
    }

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
    // Only `requested` stamps an ask. A claim settled straight from `open`
    // (ADR 0267 item 9) was never asked for, and gets no `requested_at`, no
    // `requested_by` and no letter: the memo came unasked.
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

    // Asking the vendor drafts the letter that asks them (founder, 2026-09-25,
    // round 5; ADR 0230). Drafted, never sent: it waits in /communications
    // until a person sends it.
    if (outcome.next.state === "requested") {
      return { ...data, letter: await draftLetter(this.letters, user, id) };
    }
    return data;
  }
}
