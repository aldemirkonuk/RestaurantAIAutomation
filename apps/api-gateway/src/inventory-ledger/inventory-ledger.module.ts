import { Module } from '@nestjs/common';
import { InventoryLedgerController } from './inventory-ledger.controller';
import { InventoryLedgerService } from './inventory-ledger.service';
import { DatabaseModule } from '../database/database.module';
import { EventsModule } from '../events/events.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [DatabaseModule, EventsModule, AuthModule],
  controllers: [InventoryLedgerController],
  providers: [InventoryLedgerService],
  exports: [InventoryLedgerService],
})
export class InventoryLedgerModule {}
