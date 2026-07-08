import { Controller, Get, Post, Param, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { ProspectsService } from './prospects.service';

/**
 * Manager surface for the D1 Prospects lane: list captured cold-email outreach, promote a
 * prospect to a real provider (one tap), or dismiss it. Never sends anything.
 */
@Controller('prospects')
@UseGuards(JwtAuthGuard)
export class ProspectsController {
  constructor(private readonly prospects: ProspectsService) {}

  @Get()
  async list(@CurrentUser() user: { userId: string; restaurantId: string }): Promise<any[]> {
    try {
      return await this.prospects.list(user.restaurantId);
    } catch (error: any) {
      throw new HttpException(error.message || 'Failed to load prospects', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post(':id/promote')
  async promote(
    @Param('id') id: string,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<{ promoted: boolean; providerId?: string }> {
    try {
      return await this.prospects.promote(user.restaurantId, id);
    } catch (error: any) {
      throw new HttpException(error.message || 'Failed to promote prospect', HttpStatus.INTERNAL_SERVER_ERROR);
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
}
