/**
 * Health Proxy Controllers (INFRA-04)
 *
 * Proxies frontend health requests to the Python orchestrator.
 * Auth flow:
 *   1. JwtAuthGuard: validates Supabase JWT (any logged-in user)
 *   2. TenantBypass: skips restaurantId check (health routes don't need it)
 *   3. OrchestratorService: adds X-Admin-Key before forwarding to orchestrator
 *
 * ADMIN_API_KEY never reaches frontend JS — it stays in api-gateway server env only.
 */
import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { TenantBypass } from '../tenant/tenant.decorator';
import { OrchestratorService } from './orchestrator.service';

@Controller('health')
@UseGuards(JwtAuthGuard)
@TenantBypass()
export class HealthProxyController {
  constructor(private readonly orchestratorService: OrchestratorService) {}

  @Get('agents')
  getAllAgentsHealth() {
    return this.orchestratorService.getAgentHealthAll();
  }

  @Get('agents/:name')
  getAgentHealth(@Param('name') name: string) {
    return this.orchestratorService.getAgentHealthByName(name);
  }
}

@Controller('metrics')
@UseGuards(JwtAuthGuard)
@TenantBypass()
export class MetricsProxyController {
  constructor(private readonly orchestratorService: OrchestratorService) {}

  @Get()
  getMetrics() {
    return this.orchestratorService.getSystemMetrics();
  }
}
