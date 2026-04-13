import { Module } from '@nestjs/common';
import { ProvidersController } from './providers.controller';
import { ProvidersService } from './providers.service';
import { ProviderIntelligenceController } from './provider-intelligence.controller';
import { ProviderIntelligenceService } from './provider-intelligence.service';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [DatabaseModule, AuthModule, EventsModule],
  controllers: [ProvidersController, ProviderIntelligenceController],
  providers: [ProvidersService, ProviderIntelligenceService],
  exports: [ProvidersService, ProviderIntelligenceService],
})
export class ProvidersModule {}
