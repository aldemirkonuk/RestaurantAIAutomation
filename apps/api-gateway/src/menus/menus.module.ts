import { Module } from '@nestjs/common';
import { MenusController, OnboardingController } from './menus.controller';
import { MenusService } from './menus.service';
import { CsvParserService } from './parsers/csv-parser.service';
import { ScanParserService } from './parsers/scan-parser.service';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [MenusController, OnboardingController],
  providers: [MenusService, CsvParserService, ScanParserService],
  exports: [MenusService],
})
export class MenusModule {}
