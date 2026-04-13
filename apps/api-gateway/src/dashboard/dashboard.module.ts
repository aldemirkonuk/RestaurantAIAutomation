import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { DatabaseModule } from '../database/database.module';

/**
 * Dashboard Module - Aggregated API endpoints
 * 
 * This module implements the API Bus/Aggregator pattern:
 * - Combines multiple service calls into single endpoints
 * - Reduces frontend network requests
 * - Improves performance through parallel processing
 * - Provides graceful degradation on partial failures
 */
@Module({
  imports: [DatabaseModule],
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
