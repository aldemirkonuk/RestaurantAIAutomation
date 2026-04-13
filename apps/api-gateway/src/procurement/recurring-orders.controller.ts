import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { RecurringOrdersService, RecurringOrderTemplate } from './recurring-orders.service';

@ApiTags('recurring-orders')
@Controller('recurring-orders')
export class RecurringOrdersController {
  constructor(private readonly recurringOrdersService: RecurringOrdersService) {}

  @Get(':restaurantId')
  @ApiOperation({ summary: 'List all recurring orders for a restaurant' })
  @ApiParam({ name: 'restaurantId', description: 'Restaurant UUID' })
  @ApiResponse({ status: 200, description: 'List of recurring orders' })
  async list(@Param('restaurantId') restaurantId: string) {
    try {
      return await this.recurringOrdersService.listRecurringOrders(restaurantId);
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to list recurring orders',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(':restaurantId/:id')
  @ApiOperation({ summary: 'Get a specific recurring order' })
  async getOne(
    @Param('restaurantId') restaurantId: string,
    @Param('id') id: string,
  ) {
    try {
      return await this.recurringOrdersService.getRecurringOrder(restaurantId, id);
    } catch (error) {
      throw new HttpException(
        error.message || 'Recurring order not found',
        HttpStatus.NOT_FOUND,
      );
    }
  }

  @Post(':restaurantId')
  @ApiOperation({ summary: 'Create a new recurring order' })
  async create(
    @Param('restaurantId') restaurantId: string,
    @Body() body: Omit<RecurringOrderTemplate, 'id' | 'restaurant_id'> & { userId?: string },
  ) {
    try {
      const userId = body.userId || 'system';
      return await this.recurringOrdersService.createRecurringOrder(
        restaurantId,
        userId,
        body,
      );
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to create recurring order',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Put(':restaurantId/:id')
  @ApiOperation({ summary: 'Update a recurring order' })
  async update(
    @Param('restaurantId') restaurantId: string,
    @Param('id') id: string,
    @Body() body: Partial<RecurringOrderTemplate>,
  ) {
    try {
      return await this.recurringOrdersService.updateRecurringOrder(restaurantId, id, body);
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to update recurring order',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete(':restaurantId/:id')
  @ApiOperation({ summary: 'Deactivate a recurring order' })
  async deactivate(
    @Param('restaurantId') restaurantId: string,
    @Param('id') id: string,
  ) {
    try {
      return await this.recurringOrdersService.deleteRecurringOrder(restaurantId, id);
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to deactivate recurring order',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post(':restaurantId/execute-check')
  @ApiOperation({ summary: 'Manually trigger recurring order check (dev/test)' })
  async manualExecuteCheck() {
    try {
      await this.recurringOrdersService.executeDueRecurringOrders();
      return { status: 'ok', message: 'Recurring order check executed' };
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to execute recurring order check',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
