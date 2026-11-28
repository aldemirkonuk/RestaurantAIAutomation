import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { TasteController } from './taste.controller';
import { TasteService } from './taste.service';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [TasteController],
  providers: [TasteService],
  exports: [TasteService],
})
export class TasteModule {}
