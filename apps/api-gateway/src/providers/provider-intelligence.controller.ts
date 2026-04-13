import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ProviderIntelligenceService } from './provider-intelligence.service';
import { DatabaseService } from '../database/database.service';

@ApiTags('provider-intelligence')
@Controller('providers')
@UseGuards(JwtAuthGuard)
export class ProviderIntelligenceController {
  constructor(
    private readonly intelligenceService: ProviderIntelligenceService,
    private readonly databaseService: DatabaseService,
  ) {}

  // =========================================================================
  // DIGITAL TWIN (Knowledge Graph)
  // =========================================================================

  @Get(':id/knowledge')
  @ApiOperation({ summary: 'Get provider Digital Twin (knowledge graph)' })
  @ApiQuery({ name: 'category', required: false })
  async getKnowledge(
    @Param('id') providerId: string,
    @Query('category') category?: string,
  ) {
    try {
      return await this.intelligenceService.getKnowledge(providerId, category);
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to fetch provider knowledge',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(':id/knowledge/contradictions')
  @ApiOperation({ summary: 'List unresolved contradictions in provider knowledge' })
  async getContradictions(@Param('id') providerId: string) {
    try {
      return await this.intelligenceService.getContradictions(providerId);
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to fetch contradictions',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Put(':id/knowledge/:knowledgeId/verify')
  @ApiOperation({ summary: 'Verify an extracted knowledge fact' })
  async verifyKnowledge(
    @Param('knowledgeId') knowledgeId: string,
    @CurrentUser() user: { id: string },
  ) {
    try {
      return await this.intelligenceService.verifyKnowledge(knowledgeId, user.id);
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to verify knowledge',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // =========================================================================
  // PROMOTIONS
  // =========================================================================

  @Get(':id/promotions')
  @ApiOperation({ summary: 'Get all promotions for a provider' })
  @ApiQuery({ name: 'status', required: false })
  async getPromotions(
    @Param('id') providerId: string,
    @Query('status') status?: string,
  ) {
    try {
      return await this.intelligenceService.getPromotions(providerId, status);
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to fetch promotions',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('promotions/active')
  @ApiOperation({ summary: 'Get all active promotions across all providers' })
  async getAllActivePromotions() {
    try {
      return await this.intelligenceService.getAllActivePromotions();
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to fetch active promotions',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('promotions/expiring')
  @ApiOperation({ summary: 'Get promotions expiring soon' })
  @ApiQuery({ name: 'days', required: false })
  async getExpiringPromotions(@Query('days') days?: string) {
    try {
      return await this.intelligenceService.getExpiringPromotions(
        days ? parseInt(days, 10) : 7,
      );
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to fetch expiring promotions',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('promotions/compare')
  @ApiOperation({ summary: 'Cross-vendor promotion comparison matrix' })
  async comparePromotions() {
    try {
      return await this.intelligenceService.comparePromotions();
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to compare promotions',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('promotions/savings')
  @ApiOperation({ summary: 'Total savings from promotions' })
  async getPromoSavings() {
    try {
      return await this.intelligenceService.getPromoSavings();
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to fetch promo savings',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // =========================================================================
  // CONVERSATION MEMORY
  // =========================================================================

  @Get(':id/conversation-memory')
  @ApiOperation({ summary: 'Get recent conversation memory with extracted intelligence' })
  @ApiQuery({ name: 'limit', required: false })
  async getConversationMemory(
    @Param('id') providerId: string,
    @Query('limit') limit?: string,
  ) {
    try {
      return await this.intelligenceService.getConversationMemory(
        providerId,
        limit ? parseInt(limit, 10) : 50,
      );
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to fetch conversation memory',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post(':id/conversation-memory/search')
  @ApiOperation({ summary: 'Semantic search across provider conversations' })
  async searchConversationMemory(
    @Param('id') providerId: string,
    @Body() body: { query: string },
  ) {
    try {
      if (!body.query) {
        throw new HttpException('Query is required', HttpStatus.BAD_REQUEST);
      }
      return await this.intelligenceService.searchConversationMemory(
        providerId,
        body.query,
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error.message || 'Failed to search conversation memory',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // =========================================================================
  // SESSIONS
  // =========================================================================

  @Get(':id/sessions')
  @ApiOperation({ summary: 'Get active and recent conversation sessions' })
  @ApiQuery({ name: 'includeCompleted', required: false })
  async getSessions(
    @Param('id') providerId: string,
    @Query('includeCompleted') includeCompleted?: string,
  ) {
    try {
      return await this.intelligenceService.getSessions(
        providerId,
        includeCompleted === 'true',
      );
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to fetch sessions',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(':id/sessions/:sessionId/summary')
  @ApiOperation({ summary: 'Get session summary with extracted intelligence' })
  async getSessionSummary(@Param('sessionId') sessionId: string) {
    try {
      return await this.intelligenceService.getSessionSummary(sessionId);
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to fetch session summary',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // =========================================================================
  // SENTIMENT
  // =========================================================================

  @Get(':id/sentiment')
  @ApiOperation({ summary: 'Get sentiment trend data for a provider' })
  @ApiQuery({ name: 'limit', required: false })
  async getSentimentTrend(
    @Param('id') providerId: string,
    @Query('limit') limit?: string,
  ) {
    try {
      return await this.intelligenceService.getSentimentTrend(
        providerId,
        limit ? parseInt(limit, 10) : 30,
      );
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to fetch sentiment trend',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // =========================================================================
  // PROACTIVE ACTIONS
  // =========================================================================

  @Post(':id/outreach')
  @ApiOperation({ summary: 'Trigger proactive outreach to a provider' })
  async triggerOutreach(
    @Param('id') providerId: string,
    @Body() body: { outreachType?: string; topic?: string },
    @CurrentUser() user: { restaurantId: string },
  ) {
    try {
      // This publishes an event that the ProviderConversationAgent picks up
      const { error } = await this.databaseService.supabase
        .from('provider_conversation_sessions')
        .insert({
          provider_id: providerId,
          restaurant_id: user.restaurantId,
          session_type: body.outreachType || 'relationship_building',
          status: 'active',
          initiated_by: 'manual_outreach',
          intent: { outreach_type: body.outreachType, topic: body.topic },
        });

      if (error) throw error;

      return { success: true, message: 'Outreach scheduled' };
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to trigger outreach',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post(':id/onboard')
  @ApiOperation({ summary: 'Trigger structured onboarding conversation' })
  async triggerOnboarding(
    @Param('id') providerId: string,
    @CurrentUser() user: { restaurantId: string },
  ) {
    try {
      const { error } = await this.databaseService.supabase
        .from('provider_conversation_sessions')
        .insert({
          provider_id: providerId,
          restaurant_id: user.restaurantId,
          session_type: 'onboarding',
          status: 'active',
          initiated_by: 'onboarding',
          intent: { intent_type: 'onboarding' },
        });

      if (error) throw error;

      return { success: true, message: 'Onboarding conversation initiated' };
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to trigger onboarding',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // =========================================================================
  // CROSS-VENDOR INTELLIGENCE
  // =========================================================================

  @Get('intelligence/compare')
  @ApiOperation({ summary: 'Cross-vendor intelligence comparison' })
  @ApiQuery({ name: 'providerIds', required: false, type: String })
  async compareProviders(@Query('providerIds') providerIdsStr?: string) {
    try {
      const providerIds = providerIdsStr
        ? providerIdsStr.split(',').map((id) => id.trim())
        : undefined;
      return await this.intelligenceService.compareProviders(providerIds);
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to compare providers',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('intelligence/leverage')
  @ApiOperation({ summary: 'Current negotiation leverage signals' })
  async getLeverageSignals() {
    try {
      return await this.intelligenceService.getLeverageSignals();
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to fetch leverage signals',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

}
