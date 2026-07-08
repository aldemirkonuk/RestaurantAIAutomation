import { Controller, Get, Post, Param, UseGuards, HttpException, HttpStatus, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { ProspectsService } from './prospects.service';

/**
 * Manager surface for the D1 Prospects lane: list captured cold-email outreach, add a prospect
 * as a real vendor (one tap), dismiss it, or undo a dismiss. Never sends anything.
 *
 * The `/triage` endpoint is operator-only (unattributed cold email that could belong to any
 * tenant) and is gated by the PLATFORM_ADMIN_USER_IDS allowlist — never a tenant role, since
 * these rows are not attributable to a restaurant.
 */
@Controller('prospects')
@UseGuards(JwtAuthGuard)
export class ProspectsController {
  constructor(
    private readonly prospects: ProspectsService,
    private readonly configService: ConfigService,
  ) {}

  @Get()
  async list(@CurrentUser() user: { userId: string; restaurantId: string }): Promise<any[]> {
    try {
      return await this.prospects.list(user.restaurantId);
    } catch (error: any) {
      throw new HttpException(error.message || 'Failed to load prospects', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('triage')
  async triage(@CurrentUser() user: { userId: string; restaurantId: string }): Promise<any[]> {
    this.assertPlatformAdmin(user.userId);
    try {
      return await this.prospects.listUnattributed();
    } catch (error: any) {
      throw new HttpException(error.message || 'Failed to load triage', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get(':id/attachments')
  async attachments(
    @Param('id') id: string,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<any[]> {
    try {
      return await this.prospects.attachmentsFor(user.restaurantId, id);
    } catch (error: any) {
      throw new HttpException(error.message || 'Failed to load attachments', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post(':id/promote')
  async promote(
    @Param('id') id: string,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<{ promoted: boolean; providerId?: string; reused?: boolean }> {
    try {
      return await this.prospects.promote(user.restaurantId, id);
    } catch (error: any) {
      throw new HttpException(error.message || 'Failed to add prospect as vendor', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post(':id/dismiss')
  async dismiss(
    @Param('id') id: string,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<{ dismissed: boolean }> {
    try {
      return await this.prospects.dismiss(user.restaurantId, id);
    } catch (error: any) {
      throw new HttpException(error.message || 'Failed to dismiss prospect', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post(':id/restore')
  async restore(
    @Param('id') id: string,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<{ restored: boolean }> {
    try {
      return await this.prospects.restore(user.restaurantId, id);
    } catch (error: any) {
      throw new HttpException(error.message || 'Failed to restore prospect', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  private assertPlatformAdmin(userId: string): void {
    const allow = (this.configService.get<string>('PLATFORM_ADMIN_USER_IDS') || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!allow.length || !allow.includes(userId)) {
      throw new ForbiddenException('Operator access required');
    }
  }
}
