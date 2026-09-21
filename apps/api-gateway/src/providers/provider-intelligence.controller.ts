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
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { ProviderIntelligenceService } from "./provider-intelligence.service";
import { DatabaseService } from "../database/database.service";

type AuthUser = { userId?: string; restaurantId?: string | null };

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
      return await this.intelligenceService.getKnowledge(
        providerId,
        houseOf(user),
        category,
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
      return await this.intelligenceService.getContradictions(
        providerId,
        houseOf(user),
      );
    } catch (error) {
      rethrow(error, "Failed to fetch contradictions");
    }
  }

  @Put(":id/knowledge/:knowledgeId/verify")
  @ApiOperation({ summary: "Verify an extracted knowledge fact" })
  async verifyKnowledge(
    @Param("knowledgeId") knowledgeId: string,
    @CurrentUser() user: AuthUser,
  ) {
    try {
      // `userId`, not `id`. `JwtStrategy.validate` returns `userId` and never
      // `id` (auth/strategies/jwt.strategy.ts), so the `user.id` that stood
      // here wrote `verified_by: undefined` on every verification — ADR 0147's
      // third fault shape, in the one handler on this controller that records
      // an actor.
      return await this.intelligenceService.verifyKnowledge(
        knowledgeId,
        user.userId as string,
        houseOf(user),
      );
    } catch (error) {
      rethrow(error, "Failed to verify knowledge");
    }
  }

  // =========================================================================
  // PROMOTIONS
  // =========================================================================

  @Get(":id/promotions")
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
  // =========================================================================

  @Get(":id/conversation-memory")
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
    @Query("limit") limit: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
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
    @CurrentUser() user: { restaurantId: string },
  ) {
    try {
      // This publishes an event that the ProviderConversationAgent picks up
      const { error } = await this.databaseService.supabase
        .from("provider_conversation_sessions")
        .insert({
          provider_id: providerId,
          restaurant_id: user.restaurantId,
          session_type: body.outreachType || "relationship_building",
          status: "active",
          initiated_by: "manual_outreach",
          intent: { outreach_type: body.outreachType, topic: body.topic },
        });

      if (error) throw error;

      return { success: true, message: "Outreach scheduled" };
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to trigger outreach",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post(":id/onboard")
  @ApiOperation({ summary: "Trigger structured onboarding conversation" })
  async triggerOnboarding(
    @Param("id") providerId: string,
    @CurrentUser() user: { restaurantId: string },
  ) {
    try {
      const { error } = await this.databaseService.supabase
        .from("provider_conversation_sessions")
        .insert({
          provider_id: providerId,
          restaurant_id: user.restaurantId,
          session_type: "onboarding",
          status: "active",
          initiated_by: "onboarding",
          intent: { intent_type: "onboarding" },
        });

      if (error) throw error;

      return { success: true, message: "Onboarding conversation initiated" };
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to trigger onboarding",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
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
    @Query("providerIds") providerIdsStr: string | undefined,
    @CurrentUser() user: AuthUser,
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
