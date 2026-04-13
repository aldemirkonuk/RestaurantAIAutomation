import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { OneTapActionsService } from './one-tap-actions.service';
import {
  CreateOneTapActionDto,
  UpdateOneTapActionDto,
  ExecuteActionDto,
  OneTapActionResponseDto,
  OneTapActionListResponseDto,
  OneTapActionStatus,
} from './dto/one-tap-action.dto';

/**
 * One-Tap Actions Controller
 * 
 * REST API endpoints for managing one-tap actions:
 * - CRUD operations
 * - Action execution
 * - Real-time sync via WebSocket events
 */
@ApiTags('one-tap-actions')
@Controller('one-tap-actions')
export class OneTapActionsController {
  constructor(private readonly oneTapActionsService: OneTapActionsService) {}

  /**
   * Get all actions for a restaurant
   */
  @Get(':restaurantId')
  @ApiOperation({ summary: 'Get all one-tap actions for a restaurant' })
  @ApiParam({ name: 'restaurantId', description: 'Restaurant UUID' })
  @ApiQuery({ name: 'status', enum: OneTapActionStatus, required: false })
  @ApiResponse({ status: 200, type: OneTapActionListResponseDto })
  async getActions(
    @Param('restaurantId') restaurantId: string,
    @Query('status') status?: OneTapActionStatus,
  ): Promise<OneTapActionListResponseDto> {
    try {
      return await this.oneTapActionsService.getActions(restaurantId, status);
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to fetch actions',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get pending actions for a restaurant
   */
  @Get(':restaurantId/pending')
  @ApiOperation({ summary: 'Get pending one-tap actions for a restaurant' })
  @ApiParam({ name: 'restaurantId', description: 'Restaurant UUID' })
  @ApiResponse({ status: 200, type: [OneTapActionResponseDto] })
  async getPendingActions(
    @Param('restaurantId') restaurantId: string,
  ): Promise<OneTapActionResponseDto[]> {
    try {
      return await this.oneTapActionsService.getPendingActions(restaurantId);
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to fetch pending actions',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get a single action by ID
   */
  @Get('action/:actionId')
  @ApiOperation({ summary: 'Get a single one-tap action' })
  @ApiParam({ name: 'actionId', description: 'Action UUID' })
  @ApiResponse({ status: 200, type: OneTapActionResponseDto })
  @ApiResponse({ status: 404, description: 'Action not found' })
  async getAction(
    @Param('actionId') actionId: string,
  ): Promise<OneTapActionResponseDto> {
    try {
      return await this.oneTapActionsService.getAction(actionId);
    } catch (error) {
      if (error.status === 404) {
        throw error;
      }
      throw new HttpException(
        error.message || 'Failed to fetch action',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Create a new action
   */
  @Post(':restaurantId')
  @ApiOperation({ summary: 'Create a new one-tap action' })
  @ApiParam({ name: 'restaurantId', description: 'Restaurant UUID' })
  @ApiResponse({ status: 201, type: OneTapActionResponseDto })
  async createAction(
    @Param('restaurantId') restaurantId: string,
    @Body() dto: CreateOneTapActionDto,
  ): Promise<OneTapActionResponseDto> {
    try {
      // TODO: Get userId from auth context
      const userId = 'system'; // Placeholder
      return await this.oneTapActionsService.createAction(restaurantId, userId, dto);
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to create action',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Update an action
   */
  @Put('action/:actionId')
  @ApiOperation({ summary: 'Update a one-tap action' })
  @ApiParam({ name: 'actionId', description: 'Action UUID' })
  @ApiResponse({ status: 200, type: OneTapActionResponseDto })
  @ApiResponse({ status: 404, description: 'Action not found' })
  async updateAction(
    @Param('actionId') actionId: string,
    @Body() dto: UpdateOneTapActionDto,
  ): Promise<OneTapActionResponseDto> {
    try {
      return await this.oneTapActionsService.updateAction(actionId, dto);
    } catch (error) {
      if (error.status === 404) {
        throw error;
      }
      throw new HttpException(
        error.message || 'Failed to update action',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Execute an action (mark as completed)
   */
  @Post('action/:actionId/execute')
  @ApiOperation({ summary: 'Execute a one-tap action' })
  @ApiParam({ name: 'actionId', description: 'Action UUID' })
  @ApiResponse({ status: 200, type: OneTapActionResponseDto })
  @ApiResponse({ status: 404, description: 'Action not found' })
  async executeAction(
    @Param('actionId') actionId: string,
    @Body() dto: ExecuteActionDto,
  ): Promise<OneTapActionResponseDto> {
    try {
      // TODO: Get userId from auth context
      const userId = 'system'; // Placeholder
      return await this.oneTapActionsService.executeAction(actionId, userId, dto);
    } catch (error) {
      if (error.status === 404) {
        throw error;
      }
      throw new HttpException(
        error.message || 'Failed to execute action',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Cancel an action
   */
  @Post('action/:actionId/cancel')
  @ApiOperation({ summary: 'Cancel a one-tap action' })
  @ApiParam({ name: 'actionId', description: 'Action UUID' })
  @ApiResponse({ status: 200, type: OneTapActionResponseDto })
  @ApiResponse({ status: 404, description: 'Action not found' })
  async cancelAction(
    @Param('actionId') actionId: string,
  ): Promise<OneTapActionResponseDto> {
    try {
      return await this.oneTapActionsService.cancelAction(actionId);
    } catch (error) {
      if (error.status === 404) {
        throw error;
      }
      throw new HttpException(
        error.message || 'Failed to cancel action',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Delete an action (soft delete)
   */
  @Delete('action/:actionId')
  @ApiOperation({ summary: 'Delete a one-tap action' })
  @ApiParam({ name: 'actionId', description: 'Action UUID' })
  @ApiResponse({ status: 200, description: 'Action deleted' })
  @ApiResponse({ status: 404, description: 'Action not found' })
  async deleteAction(
    @Param('actionId') actionId: string,
  ): Promise<{ success: boolean }> {
    try {
      await this.oneTapActionsService.deleteAction(actionId);
      return { success: true };
    } catch (error) {
      if (error.status === 404) {
        throw error;
      }
      throw new HttpException(
        error.message || 'Failed to delete action',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
