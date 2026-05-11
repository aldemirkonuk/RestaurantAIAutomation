import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { MenusService } from './menus.service';
import { ImportMenuDto } from './dto/import-menu.dto';
import { UpdateOnboardingProgressDto } from './dto/update-onboarding-progress.dto';

@ApiTags('menus')
@Controller('menus')
@UseGuards(JwtAuthGuard)
export class MenusController {
  constructor(private readonly menusService: MenusService) {}

  @Post('import')
  @ApiOperation({ summary: 'Import menu via scan, CSV, or manual entry' })
  async importMenu(
    @Body() dto: ImportMenuDto,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ) {
    return this.menusService.importMenu(dto, user.userId);
  }
}

@ApiTags('onboarding')
@Controller('onboarding')
@UseGuards(JwtAuthGuard)
export class OnboardingController {
  constructor(private readonly menusService: MenusService) {}

  @Get('progress')
  @ApiOperation({ summary: "Get the authenticated user's onboarding progress" })
  async getProgress(@CurrentUser() user: { userId: string }) {
    return this.menusService.getOnboardingProgress(user.userId);
  }

  @Patch('progress')
  @ApiOperation({ summary: 'Update onboarding progress fields' })
  async updateProgress(
    @Body() dto: UpdateOnboardingProgressDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.menusService.updateOnboardingProgress(user.userId, dto);
  }
}
