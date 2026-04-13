import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags, ApiParam, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { InventoryLedgerService } from './inventory-ledger.service';
import {
  CreateInventoryTransactionDto,
  GetTransactionsQueryDto,
  GetBalanceAtQueryDto,
  InventoryTransactionResponseDto,
  TransactionsListResponseDto,
  InventoryBalanceResponseDto,
  TransactionSummaryResponseDto,
  BulkTransactionDto,
  BulkTransactionResponseDto,
  StockType,
} from './dto/inventory-ledger.dto';

@ApiTags('inventory-ledger')
@Controller('inventory-ledger')
@UseGuards(JwtAuthGuard)
export class InventoryLedgerController {
  private readonly logger = new Logger(InventoryLedgerController.name);

  constructor(private readonly ledgerService: InventoryLedgerService) {}

  // ==========================================================================
  // TRANSACTIONS
  // ==========================================================================

  @Post('transactions')
  @ApiOperation({ summary: 'Record a new inventory transaction' })
  @ApiResponse({ status: 201, description: 'Transaction recorded', type: InventoryTransactionResponseDto })
  async createTransaction(
    @Body() dto: CreateInventoryTransactionDto,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<InventoryTransactionResponseDto> {
    try {
      return await this.ledgerService.createTransaction(
        user.restaurantId,
        user.userId,
        dto,
      );
    } catch (error) {
      this.logger.error({
        message: 'Create transaction failed',
        userId: user.userId,
        restaurantId: user.restaurantId,
        error: error.message,
      });

      if (error.message?.includes('Insufficient stock')) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }

      throw new HttpException(
        error.message || 'Failed to create transaction',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('transactions/bulk')
  @ApiOperation({ summary: 'Record multiple inventory transactions' })
  @ApiResponse({ status: 201, description: 'Transactions recorded', type: BulkTransactionResponseDto })
  async createBulkTransactions(
    @Body() dto: BulkTransactionDto,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<BulkTransactionResponseDto> {
    try {
      return await this.ledgerService.createBulkTransactions(
        user.restaurantId,
        user.userId,
        dto,
      );
    } catch (error) {
      this.logger.error({
        message: 'Bulk transaction failed',
        userId: user.userId,
        error: error.message,
      });
      throw new HttpException(
        error.message || 'Failed to create bulk transactions',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('transactions')
  @ApiOperation({ summary: 'List inventory transactions with filters' })
  @ApiResponse({ status: 200, description: 'Returns transactions list', type: TransactionsListResponseDto })
  async listTransactions(
    @Query() query: GetTransactionsQueryDto,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<TransactionsListResponseDto> {
    try {
      return await this.ledgerService.listTransactions(user.restaurantId, query);
    } catch (error) {
      this.logger.error({
        message: 'List transactions failed',
        userId: user.userId,
        error: error.message,
      });
      throw new HttpException(
        error.message || 'Failed to list transactions',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('transactions/:transactionId')
  @ApiOperation({ summary: 'Get a specific transaction' })
  @ApiParam({ name: 'transactionId', description: 'Transaction ID' })
  @ApiResponse({ status: 200, description: 'Returns the transaction', type: InventoryTransactionResponseDto })
  async getTransaction(
    @Param('transactionId') transactionId: string,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<InventoryTransactionResponseDto> {
    try {
      return await this.ledgerService.getTransaction(user.restaurantId, transactionId);
    } catch (error) {
      this.logger.error({
        message: 'Get transaction failed',
        transactionId,
        error: error.message,
      });
      throw new HttpException(
        error.message || 'Failed to get transaction',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ==========================================================================
  // BALANCE QUERIES
  // ==========================================================================

  @Get('inventory/:inventoryId/balance')
  @ApiOperation({ summary: 'Get inventory balance at a point in time' })
  @ApiParam({ name: 'inventoryId', description: 'Inventory item ID' })
  @ApiResponse({ status: 200, description: 'Returns the balance', type: InventoryBalanceResponseDto })
  async getBalanceAt(
    @Param('inventoryId') inventoryId: string,
    @Query() query: GetBalanceAtQueryDto,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<InventoryBalanceResponseDto> {
    try {
      return await this.ledgerService.getBalanceAt(
        user.restaurantId,
        inventoryId,
        query.asOf,
        query.stockType,
      );
    } catch (error) {
      this.logger.error({
        message: 'Get balance failed',
        inventoryId,
        error: error.message,
      });
      throw new HttpException(
        error.message || 'Failed to get balance',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('inventory/:inventoryId/history')
  @ApiOperation({ summary: 'Get transaction history for an inventory item' })
  @ApiParam({ name: 'inventoryId', description: 'Inventory item ID' })
  @ApiQuery({ name: 'days', required: false, description: 'Number of days to look back (default: 30)' })
  @ApiResponse({ status: 200, description: 'Returns transaction history', type: [InventoryTransactionResponseDto] })
  async getTransactionHistory(
    @Param('inventoryId') inventoryId: string,
    @Query('days') days: number = 30,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<InventoryTransactionResponseDto[]> {
    try {
      return await this.ledgerService.getTransactionHistory(
        user.restaurantId,
        inventoryId,
        days,
      );
    } catch (error) {
      this.logger.error({
        message: 'Get history failed',
        inventoryId,
        error: error.message,
      });
      throw new HttpException(
        error.message || 'Failed to get transaction history',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ==========================================================================
  // SUMMARY & ANALYTICS
  // ==========================================================================

  @Get('summary')
  @ApiOperation({ summary: 'Get transaction summary for a date range' })
  @ApiQuery({ name: 'startDate', description: 'Start date (ISO)' })
  @ApiQuery({ name: 'endDate', description: 'End date (ISO)' })
  @ApiResponse({ status: 200, description: 'Returns transaction summary', type: TransactionSummaryResponseDto })
  async getTransactionSummary(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<TransactionSummaryResponseDto> {
    try {
      return await this.ledgerService.getTransactionSummary(
        user.restaurantId,
        startDate,
        endDate,
      );
    } catch (error) {
      this.logger.error({
        message: 'Get summary failed',
        error: error.message,
      });
      throw new HttpException(
        error.message || 'Failed to get transaction summary',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ==========================================================================
  // RECONCILIATION
  // ==========================================================================

  @Post('inventory/:inventoryId/reconcile')
  @ApiOperation({ summary: 'Reconcile inventory with physical count' })
  @ApiParam({ name: 'inventoryId', description: 'Inventory item ID' })
  @ApiResponse({ status: 201, description: 'Reconciliation recorded', type: InventoryTransactionResponseDto })
  async reconcileInventory(
    @Param('inventoryId') inventoryId: string,
    @Body() body: { wineId: string; actualCount: number; notes?: string },
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<InventoryTransactionResponseDto> {
    try {
      return await this.ledgerService.reconcileInventory(
        user.restaurantId,
        user.userId,
        inventoryId,
        body.wineId,
        body.actualCount,
        body.notes,
      );
    } catch (error) {
      this.logger.error({
        message: 'Reconciliation failed',
        inventoryId,
        error: error.message,
      });

      if (error.message?.includes('No adjustment needed')) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }

      throw new HttpException(
        error.message || 'Failed to reconcile inventory',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
