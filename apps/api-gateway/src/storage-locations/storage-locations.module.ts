import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { StorageLocationsController } from './storage-locations.controller';
import { StorageLocationsService } from './storage-locations.service';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [StorageLocationsController],
  providers: [StorageLocationsService],
  exports: [StorageLocationsService],
})
export class StorageLocationsModule {}
