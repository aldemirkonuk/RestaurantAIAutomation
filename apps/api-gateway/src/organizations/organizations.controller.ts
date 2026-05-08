import {
  Controller,
  Get,
  Post,
  Body,
  Req,
  UseGuards,
  Logger,
} from '@nestjs/common';
import {
  OrganizationsService,
  RestaurantBranch,
  RestaurantChain,
} from './organizations.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Request } from 'express';

@Controller('organizations')
@UseGuards(JwtAuthGuard)
export class OrganizationsController {
  private readonly logger = new Logger(OrganizationsController.name);

  constructor(private readonly organizationsService: OrganizationsService) {}

  @Get('branches')
  async getBranches(
    @Req() req: Request & { user: any },
  ): Promise<RestaurantBranch[]> {
    this.logger.debug(`Fetching branches for user ${req.user.userId}`);
    return this.organizationsService.getBranchesForUser(req.user.userId);
  }

  @Get('chains')
  async getChains(
    @Req() req: Request & { user: any },
  ): Promise<RestaurantChain[]> {
    this.logger.debug(`Fetching chains for user ${req.user.userId}`);
    return this.organizationsService.getChainsForUser(req.user.userId);
  }

  @Post('chains')
  async createChain(
    @Req() req: Request & { user: any },
    @Body() body: { name: string; cuisine_type?: string; description?: string },
  ): Promise<RestaurantChain> {
    this.logger.debug(
      `Creating chain '${body.name}' for user ${req.user.userId}`,
    );
    return this.organizationsService.createChain(req.user.userId, body);
  }

  @Post('locations')
  async createLocation(
    @Req() req: Request & { user: any },
    @Body()
    body: {
      name: string;
      address: string;
      city: string;
      phone?: string;
      cuisineType?: string;
      timezone?: string;
      chainId?: string;
    },
  ): Promise<{ id: string; name: string }> {
    this.logger.debug(
      `Creating location '${body.name}' for user ${req.user.userId}`,
    );
    return this.organizationsService.createLocation(req.user.userId, body);
  }
}
