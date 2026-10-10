import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags, ApiQuery } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { ProviderIntelligenceService } from "./provider-intelligence.service";
import { DatabaseService } from "../database/database.service";
import { OrganizationsService } from "../organizations/organizations.service";
import { roleSatisfies } from "../procurement/order-approval-gate";
import { assertVendorWriter } from "./vendor-write-gate";
import { holdsHouseMoney } from "../procurement/documents/document-money-gate";

type AuthUser = {
  userId?: string;
  restaurantId?: string | null;
  role?: string | null;
};

/**
 * The kinds of fact a vendor's mail teaches that ARE the house's money: their
 * prices (each price change, old and new), their money terms (payment terms,
 * credit, minimums) and their offers. The agent files them under these
 * categories (provider_conversation_agent.py `_update_digital_twin`).
 */
export const MONEY_FACT_KINDS: ReadonlySet<string> = new Set([
  "pricing",
  "financial",
  "promotion",
]);

/**
 * The facts a role may read (F-1078). Staff see no house money (ADR 0145, the
 * F-957..F-959 call), so a reader who does not hold it gets the vendor's
 * people, delivery, wines and the rest, and none of the money kinds: they are
 * OMITTED from the reply, not emptied. The page says why (LearnedSection).
 */
export function knowledgeForRole<T>(
  grouped: Record<string, T>,
  role: string | null | undefined,
): Record<string, T> {
  if (holdsHouseMoney(role)) return grouped;
  const kept: Record<string, T> = {};
  for (const [kind, facts] of Object.entries(grouped)) {
    if (!MONEY_FACT_KINDS.has(kind)) kept[kind] = facts;
  }
  return kept;
}

/** The changed facts a role may read: the same cut, row by row. */
export function changesForRole<T extends { category?: string | null }>(
  rows: T[],
  role: string | null | undefined,
): T[] {
  if (holdsHouseMoney(role)) return rows;
  return rows.filter((r) => !MONEY_FACT_KINDS.has(r?.category ?? ""));
}

/** How long a recorded vendor request counts as still asked (F-789). */
export const OPEN_SESSION_DAYS = 7;

/**
 * The caller's house, from the verified token and nowhere else. A session that
 * names no house has no provider intelligence of its own to read, so it is
 * refused rather than handed an unfiltered query (ADR 0147).
 */
function houseOf(user: AuthUser | undefined): string {
  if (!user?.restaurantId) {
    throw new ForbiddenException("This session names no restaurant.");
  }
  return user.restaurantId;
}

/**
 * The caller's person, for the acts that are recorded against somebody. A
 * verified token always carries `userId`; one that does not is refused
 * rather than recorded as `undefined`. (Same helper as providers.controller.ts.)
 */
function actorOf(user: AuthUser | undefined): string {
  if (!user?.userId) {
    throw new ForbiddenException("This session names no person.");
  }
  return user.userId;
}

/** A status the service chose deliberately survives; anything else is a 500. */
function rethrow(error: unknown, fallback: string): never {
  if (error instanceof HttpException) throw error;
  throw new HttpException(
    (error as { message?: string })?.message || fallback,
    HttpStatus.INTERNAL_SERVER_ERROR,
  );
}

/**
 * `JwtAuthGuard` answers "is this a signed-in account?", never "is this row
 * yours" — so until ADR 0147 was applied here, fifteen of these reads carried
 * no restaurant clause and any signed-in account of any house could read every
 * house's vendor knowledge, promotions, conversation memory, sessions and
 * sentiment. Every route below now takes its house from the token through
 * `houseOf(user)` and hands it to the service, which puts it in the query.
 */
@ApiTags("provider-intelligence")
@Controller("providers")
@UseGuards(JwtAuthGuard)
export class ProviderIntelligenceController {
  constructor(
    private readonly intelligenceService: ProviderIntelligenceService,
    private readonly databaseService: DatabaseService,
    // The role half of the confirm gate (VEN-W14b, founder 2026-10-01): the
    // same `resolveRestaurantRole` + `roleSatisfies` pair the usual-currency
    // write in providers.controller.ts asks, never a second implementation.
    private readonly organizations: OrganizationsService,
  ) {}

  // =========================================================================
  // DIGITAL TWIN (Knowledge Graph)
  // =========================================================================

  @Get(":id/knowledge")
  @ApiOperation({ summary: "Get provider Digital Twin (knowledge graph)" })
  @ApiQuery({ name: "category", required: false })
  async getKnowledge(
    @Param("id") providerId: string,
    @Query("category") category: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    try {
      return knowledgeForRole(
        await this.intelligenceService.getKnowledge(
          providerId,
          houseOf(user),
          category,
        ),
        user?.role ?? null,
      );
    } catch (error) {
      rethrow(error, "Failed to fetch provider knowledge");
    }
  }

  @Get(":id/knowledge/contradictions")
  @ApiOperation({
    summary: "List unresolved contradictions in provider knowledge",
  })
  async getContradictions(
    @Param("id") providerId: string,
    @CurrentUser() user: AuthUser,
  ) {
    try {
      return changesForRole(
        await this.intelligenceService.getContradictions(
          providerId,
          houseOf(user),
        ),
        user?.role ?? null,
      );
    } catch (error) {
      rethrow(error, "Failed to fetch contradictions");
    }
  }

  @Put(":id/knowledge/:knowledgeId/verify")
  @ApiOperation({
    summary: "Confirm a fact learned from a vendor's mail",
    description:
      "Owners and managers only (VEN-W14b); any other role is refused with 403 and the fact is not changed.",
  })
  async verifyKnowledge(
    @Param("knowledgeId") knowledgeId: string,
    @CurrentUser() user: AuthUser,
  ) {
    try {
      const restaurantId = houseOf(user);
      const actor = actorOf(user);
      // VEN-W14b (founder, 2026-10-01): confirming what a vendor's mail told
      // this house is an owner's or a manager's act. `null` means "not proven
      // to hold any role" — a failed read and a person with no row look the
      // same here, and neither may pass. The fact is not touched when refused.
      const role = await this.organizations.resolveRestaurantRole(
        actor,
        restaurantId,
      );
      if (!roleSatisfies(role, "manager"))
        throw new HttpException(
          `Confirming what a vendor's mail told this house is a manager's or an owner's decision. ` +
            `${role ? `You are signed in as ${role} at this house` : "This session could not be shown to hold any role at this house"}, so nothing was confirmed. Ask a manager or an owner to confirm it.`,
          HttpStatus.FORBIDDEN,
        );
      // `userId`, not `id`. `JwtStrategy.validate` returns `userId` and never
      // `id` (auth/strategies/jwt.strategy.ts), so reading `id` off the user,
      // as this line used to, wrote `verified_by: undefined` on every verification — ADR 0147's
      // third fault shape, in the one handler on this controller that records
      // an actor.
      return await this.intelligenceService.verifyKnowledge(
        knowledgeId,
        actor,
        restaurantId,
      );
    } catch (error) {
      rethrow(error, "Failed to verify knowledge");
    }
  }

  // =========================================================================
  // PROMOTIONS
  //
  // Owner/manager only, as `/promotions` is (ADR 0124:357-362): an offer
  // carries what a vendor charges this house and what it saves, and staff
  // see counts, never amounts (ADR 0145). These reads were the legacy door
  // round that gate (`promotions.controller.ts` says so); F-563 closes it.
  // =========================================================================

  @Get(":id/promotions")
  @UseGuards(RolesGuard)
  @Roles("owner", "manager")
  @ApiOperation({ summary: "Get this restaurant's promotions for a provider" })
  @ApiQuery({ name: "status", required: false })
  async getPromotions(
    @Param("id") providerId: string,
    @Query("status") status: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    try {
      return await this.intelligenceService.getPromotions(
        providerId,
        houseOf(user),
        status,
      );
    } catch (error) {
      rethrow(error, "Failed to fetch promotions");
    }
  }

  @Get("promotions/active")
  @UseGuards(RolesGuard)
  @Roles("owner", "manager")
  @ApiOperation({
    summary: "Get this restaurant's active promotions across its providers",
  })
  async getAllActivePromotions(@CurrentUser() user: AuthUser) {
    try {
      return await this.intelligenceService.getAllActivePromotions(
        houseOf(user),
      );
    } catch (error) {
      rethrow(error, "Failed to fetch active promotions");
    }
  }

  @Get("promotions/expiring")
  @UseGuards(RolesGuard)
  @Roles("owner", "manager")
  @ApiOperation({ summary: "Get this restaurant's promotions expiring soon" })
  @ApiQuery({ name: "days", required: false })
  async getExpiringPromotions(
    @Query("days") days: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    try {
      return await this.intelligenceService.getExpiringPromotions(
        houseOf(user),
        days ? parseInt(days, 10) : 7,
      );
    } catch (error) {
      rethrow(error, "Failed to fetch expiring promotions");
    }
  }

  @Get("promotions/compare")
  @UseGuards(RolesGuard)
  @Roles("owner", "manager")
  @ApiOperation({
    summary: "Cross-vendor promotion comparison matrix for this restaurant",
  })
  async comparePromotions(@CurrentUser() user: AuthUser) {
    try {
      return await this.intelligenceService.comparePromotions(houseOf(user));
    } catch (error) {
      rethrow(error, "Failed to compare promotions");
    }
  }

  @Get("promotions/savings")
  @UseGuards(RolesGuard)
  @Roles("owner", "manager")
  @ApiOperation({ summary: "Total savings from this restaurant's promotions" })
  async getPromoSavings(@CurrentUser() user: AuthUser) {
    try {
      return await this.intelligenceService.getPromoSavings(houseOf(user));
    } catch (error) {
      rethrow(error, "Failed to fetch promo savings");
    }
  }

  // =========================================================================
  // CONVERSATION MEMORY
  //
  // Owner/manager only (F-986), as "how their mail reads" is (ADR 0207; the
  // founder, 2026-09-21: staff never see it): these are the vendor's own
  // lines and what was read out of them, prices included, and the letters'
  // words stay with the owner and managers on every other door.
  // =========================================================================

  @Get(":id/conversation-memory")
  @UseGuards(RolesGuard)
  @Roles("owner", "manager")
  @ApiOperation({
    summary: "Get recent conversation memory with extracted intelligence",
  })
  @ApiQuery({ name: "limit", required: false })
  async getConversationMemory(
    @Param("id") providerId: string,
    @Query("limit") limit: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    try {
      return await this.intelligenceService.getConversationMemory(
        providerId,
        houseOf(user),
        limit ? parseInt(limit, 10) : 50,
      );
    } catch (error) {
      rethrow(error, "Failed to fetch conversation memory");
    }
  }

  @Post(":id/conversation-memory/search")
  @UseGuards(RolesGuard)
  @Roles("owner", "manager")
  @ApiOperation({ summary: "Semantic search across provider conversations" })
  async searchConversationMemory(
    @Param("id") providerId: string,
    @Body() body: { query: string },
    @CurrentUser() user: AuthUser,
  ) {
    try {
      // The house is read before the body is judged: a session with no house
      // gets the same 403 whether or not it sent a query string, so the 400 is
      // never a hint that the 403 could have been avoided.
      const restaurantId = houseOf(user);
      if (!body.query) {
        throw new HttpException("Query is required", HttpStatus.BAD_REQUEST);
      }
      return await this.intelligenceService.searchConversationMemory(
        providerId,
        restaurantId,
        body.query,
      );
    } catch (error) {
      rethrow(error, "Failed to search conversation memory");
    }
  }

  // =========================================================================
  // SESSIONS
  // =========================================================================

  @Get(":id/sessions")
  @ApiOperation({ summary: "Get active and recent conversation sessions" })
  @ApiQuery({ name: "includeCompleted", required: false })
  async getSessions(
    @Param("id") providerId: string,
    @Query("includeCompleted") includeCompleted: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    try {
      return await this.intelligenceService.getSessions(
        providerId,
        houseOf(user),
        includeCompleted === "true",
      );
    } catch (error) {
      rethrow(error, "Failed to fetch sessions");
    }
  }

  @Get(":id/sessions/:sessionId/summary")
  @ApiOperation({ summary: "Get session summary with extracted intelligence" })
  async getSessionSummary(
    @Param("sessionId") sessionId: string,
    @CurrentUser() user: AuthUser,
  ) {
    try {
      return await this.intelligenceService.getSessionSummary(
        sessionId,
        houseOf(user),
      );
    } catch (error) {
      rethrow(error, "Failed to fetch session summary");
    }
  }

  // =========================================================================
  // SENTIMENT
  // =========================================================================

  @Get(":id/sentiment")
  @ApiOperation({ summary: "Get sentiment trend data for a provider" })
  @ApiQuery({ name: "limit", required: false })
  async getSentimentTrend(
    @Param("id") providerId: string,
    @CurrentUser() user: AuthUser,
    @Query("limit") limit?: string,
  ) {
    // user.restaurantId falls back to the nullable users.restaurant_id column
    // (jwt.strategy.ts:29-31) when the token carries none. `houseOf` refuses
    // that session with the controller-wide 403 before the query, instead of
    // letting an empty value reach `.eq("restaurant_id", ...)` as a Postgres
    // cast error inside a 500 (2026-09-17 finding; #391 refused it with a 400,
    // folded into the one refusal every route here gives on 2026-09-25).
    try {
      return await this.intelligenceService.getSentimentTrend(
        providerId,
        houseOf(user),
        limit ? parseInt(limit, 10) : 30,
      );
    } catch (error) {
      rethrow(error, "Failed to fetch sentiment trend");
    }
  }

  // =========================================================================
  // PROACTIVE ACTIONS
  // =========================================================================

  @Post(":id/outreach")
  @ApiOperation({ summary: "Trigger proactive outreach to a provider" })
  async triggerOutreach(
    @Param("id") providerId: string,
    @Body() body: { outreachType?: string; topic?: string },
    @CurrentUser() user: AuthUser,
  ) {
    // VEN-W30: staff read the vendor book; changing it is a manager's or an owner's act.
    await assertVendorWriter(
      this.organizations,
      actorOf(user),
      houseOf(user),
      "Starting a conversation with a vendor",
    );
    try {
      const restaurantId = houseOf(user);
      // The vendor must be this house's (ADR 0147). Without this, a house
      // could open an outreach session — which the ProviderConversationAgent
      // acts on — against ANOTHER house's vendor, stamped with its own house.
      await this.intelligenceService.assertProviderInHouse(
        providerId,
        restaurantId,
      );
      // This only records the request as a session row. Nothing on this path
      // publishes provider.outreach_scheduled, the ProviderConversationAgent's
      // only outreach trigger, so no vendor is contacted yet (F-789).
      const { sessionId, alreadyOpen } = await this.openSessionOnce({
        provider_id: providerId,
        restaurant_id: restaurantId,
        session_type: body.outreachType || "relationship_building",
        status: "active",
        initiated_by: "manual_outreach",
        intent: { outreach_type: body.outreachType, topic: body.topic },
      });

      return {
        success: true,
        sessionId,
        alreadyOpen,
        message: alreadyOpen
          ? "You already asked for this in the last 7 days. Nothing new was recorded."
          : "Request recorded. Mudavym does not contact the vendor about it yet.",
      };
    } catch (error) {
      rethrow(error, "Failed to trigger outreach");
    }
  }

  @Post(":id/onboard")
  @ApiOperation({ summary: "Trigger structured onboarding conversation" })
  async triggerOnboarding(
    @Param("id") providerId: string,
    @CurrentUser() user: AuthUser,
  ) {
    // VEN-W30: staff read the vendor book; changing it is a manager's or an owner's act.
    await assertVendorWriter(
      this.organizations,
      actorOf(user),
      houseOf(user),
      "Starting a vendor's onboarding conversation",
    );
    try {
      const restaurantId = houseOf(user);
      // Same fence as outreach: another house's vendor is a 404 (ADR 0147).
      await this.intelligenceService.assertProviderInHouse(
        providerId,
        restaurantId,
      );
      const { sessionId, alreadyOpen } = await this.openSessionOnce({
        provider_id: providerId,
        restaurant_id: restaurantId,
        session_type: "onboarding",
        status: "active",
        initiated_by: "onboarding",
        intent: { intent_type: "onboarding" },
      });

      return {
        success: true,
        sessionId,
        alreadyOpen,
        message: alreadyOpen
          ? "You already asked for onboarding in the last 7 days. Nothing new was recorded."
          : "Onboarding request recorded. Mudavym does not contact the vendor about it yet.",
      };
    } catch (error) {
      rethrow(error, "Failed to trigger onboarding");
    }
  }

  /**
   * One active session per vendor and kind (F-568). A second tap, or a retry
   * whose first answer was lost, gets the session already open instead of a
   * new one: the agent reads only the newest active session, so every extra
   * row was an orphan. Two requests at the same instant both read "none";
   * the unique index uq_pcs_one_active_per_kind (migration
   * one_open_vendor_conversation_per_kind) lets only one insert land, and the
   * loser (23505) answers with the row that won.
   *
   * Only a session opened in the last OPEN_SESSION_DAYS counts (F-789):
   * nothing else closes these rows, so without the bound one tap would answer
   * "already asked" for this vendor and kind forever. An older active row is
   * marked abandoned before the fresh one is recorded, so the unique index
   * (which knows no age) does not refuse it.
   */
  private async openSessionOnce(row: {
    provider_id: string;
    restaurant_id: string;
    session_type: string;
    status: "active";
    initiated_by: string;
    intent: Record<string, unknown>;
  }): Promise<{ sessionId: string; alreadyOpen: boolean }> {
    const sessions = () =>
      this.databaseService.supabase.from("provider_conversation_sessions");
    const cutoff = new Date(
      Date.now() - OPEN_SESSION_DAYS * 86_400_000,
    ).toISOString();
    const findOpen = async () => {
      const { data: open, error: readError } = await sessions()
        .select("id")
        .eq("provider_id", row.provider_id)
        .eq("restaurant_id", row.restaurant_id)
        .eq("session_type", row.session_type)
        .eq("status", "active")
        .gte("created_at", cutoff)
        .limit(1)
        .maybeSingle();
      if (readError) throw readError;
      return open;
    };
    const open = await findOpen();
    if (!open) {
      // F-789 under F-568's index: a stale active row is closed, not left to
      // block the new one with a 23505 that findOpen (bounded) cannot answer.
      const { error: staleError } = await sessions()
        .update({ status: "abandoned", closed_at: new Date().toISOString() })
        .eq("provider_id", row.provider_id)
        .eq("restaurant_id", row.restaurant_id)
        .eq("session_type", row.session_type)
        .eq("status", "active")
        .lt("created_at", cutoff);
      if (staleError) throw staleError;
    }
    if (open) return { sessionId: open.id, alreadyOpen: true };

    const { data: created, error } = await sessions()
      .insert(row)
      .select("id")
      .single();
    if ((error as { code?: string } | null)?.code === "23505") {
      const winner = await findOpen();
      if (winner) return { sessionId: winner.id, alreadyOpen: true };
    }
    if (error) throw error;
    return { sessionId: created.id, alreadyOpen: false };
  }

  // =========================================================================
  // CROSS-VENDOR INTELLIGENCE
  // =========================================================================

  @Get("intelligence/compare")
  @ApiOperation({
    summary: "Cross-vendor intelligence comparison for this restaurant",
  })
  @ApiQuery({ name: "providerIds", required: false, type: String })
  async compareProviders(
    @CurrentUser() user: AuthUser,
    @Query("providerIds") providerIdsStr?: string,
  ) {
    try {
      const providerIds = providerIdsStr
        ? providerIdsStr.split(",").map((id) => id.trim())
        : undefined;
      return await this.intelligenceService.compareProviders(
        houseOf(user),
        providerIds,
      );
    } catch (error) {
      rethrow(error, "Failed to compare providers");
    }
  }

  @Get("intelligence/leverage")
  @ApiOperation({
    summary: "Current negotiation leverage signals for this restaurant",
  })
  async getLeverageSignals(@CurrentUser() user: AuthUser) {
    try {
      return await this.intelligenceService.getLeverageSignals(houseOf(user));
    } catch (error) {
      rethrow(error, "Failed to fetch leverage signals");
    }
  }
}
