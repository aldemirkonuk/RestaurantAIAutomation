import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import {
  OrganizationsService,
  RestaurantBranch,
  RestaurantChain,
} from './organizations.service';
import { UpdateLocationDto } from './dto/update-location.dto';
import { CreateChainDto } from './dto/create-chain.dto';
import { RenameChainDto } from './dto/rename-chain.dto';
import { CreateLocationDto } from './dto/create-location.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Request } from 'express';

interface AuthenticatedUser {
  userId: string;
}

@Controller('organizations')
@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ whitelist: true }))
export class OrganizationsController {
  private readonly logger = new Logger(OrganizationsController.name);

  constructor(private readonly organizationsService: OrganizationsService) {}

  @Get('branches')
  async getBranches(
    @Req() req: Request & { user: AuthenticatedUser },
  ): Promise<RestaurantBranch[]> {
    const userId: string = (req.user as AuthenticatedUser)?.userId;
    if (!userId) throw new UnauthorizedException('Missing user identity');
    this.logger.debug(`Fetching branches for user ${userId}`);
    return this.organizationsService.getBranchesForUser(userId);
  }

  @Get('chains')
  async getChains(
    @Req() req: Request & { user: AuthenticatedUser },
  ): Promise<RestaurantChain[]> {
    const userId: string = (req.user as AuthenticatedUser)?.userId;
    if (!userId) throw new UnauthorizedException('Missing user identity');
    this.logger.debug(`Fetching chains for user ${userId}`);
    return this.organizationsService.getChainsForUser(userId);
  }

  @Post('chains')
  async createChain(
    @Req() req: Request & { user: AuthenticatedUser },
    @Body() body: CreateChainDto,
  ): Promise<RestaurantChain> {
    const userId: string = (req.user as AuthenticatedUser)?.userId;
    if (!userId) throw new UnauthorizedException('Missing user identity');
    this.logger.debug(`Creating chain '${body.name}' for user ${userId}`);
    return this.organizationsService.createChain(userId, body);
  }

  @Patch('chains/:id')
  async renameChain(
    @Req() req: Request & { user: AuthenticatedUser },
    @Param('id') id: string,
    @Body() body: RenameChainDto,
  ): Promise<void> {
    const userId: string = (req.user as AuthenticatedUser)?.userId;
    if (!userId) throw new UnauthorizedException('Missing user identity');
    return this.organizationsService.renameChain(userId, id, body.name);
  }

  @Delete('chains/:id')
  async deleteChain(
    @Req() req: Request & { user: AuthenticatedUser },
    @Param('id') id: string,
  ): Promise<void> {
    const userId: string = (req.user as AuthenticatedUser)?.userId;
    if (!userId) throw new UnauthorizedException('Missing user identity');
    return this.organizationsService.deleteChain(userId, id);
  }

  @Patch('locations/:id')
  async updateLocation(
    @Req() req: Request & { user: AuthenticatedUser },
    @Param('id') id: string,
    @Body() body: UpdateLocationDto,
  ): Promise<void> {
    const userId: string = (req.user as AuthenticatedUser)?.userId;
    if (!userId) throw new UnauthorizedException('Missing user identity');
    return this.organizationsService.updateLocation(userId, id, {
      chainId: body.chainId,
      name: body.name,
      city: body.city,
    });
  }

  @Post('locations')
  async createLocation(
    @Req() req: Request & { user: AuthenticatedUser },
    @Body() body: CreateLocationDto,
  ): Promise<{ id: string; name: string }> {
    const userId: string = (req.user as AuthenticatedUser)?.userId;
    if (!userId) throw new UnauthorizedException('Missing user identity');
    this.logger.debug(`Creating location '${body.name}' for user ${userId}`);
    return this.organizationsService.createLocation(userId, body);
  }
}
