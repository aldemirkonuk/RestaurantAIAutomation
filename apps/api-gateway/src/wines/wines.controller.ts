import { Body, Controller, Get, Param, Post, Query, HttpException, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { WinesService } from './wines.service';
import { GetWinesQueryDto, WineMetaQueryDto, WineSuggestionsQueryDto, SimilarWinesQueryDto } from './dto/wines.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { WineSubmissionsService } from './wine-submissions.service';
import { CreateWineSubmissionDto, ProcessSubmissionsDto, SubmissionListQueryDto } from './dto/wine-submissions.dto';

@ApiTags('wines')
@Controller('wines')
@UseGuards(JwtAuthGuard)
export class WinesController {
  constructor(
    private readonly winesService: WinesService,
    private readonly wineSubmissionsService: WineSubmissionsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Search wines in master wine library' })
  @ApiResponse({ status: 200, description: 'Returns wine list' })
  async searchWines(@Query() query: GetWinesQueryDto) {
    try {
      return await this.winesService.searchWines(query);
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to fetch wines',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('meta/categories')
  async getCategories() {
    return await this.winesService.getWineCategories();
  }

  @Get('meta/regions')
  async getRegions(@Query() query: WineMetaQueryDto) {
    return await this.winesService.getWineRegions(query);
  }

  @Get('meta/countries')
  async getCountries() {
    return await this.winesService.getWineCountries();
  }

  @Get('suggestions')
  async getSuggestions(@Query() query: WineSuggestionsQueryDto) {
    return await this.winesService.getWineSuggestions(query);
  }

  @Get(':wineId/similar')
  async getSimilar(@Param('wineId') wineId: string, @Query() query: SimilarWinesQueryDto) {
    return await this.winesService.getSimilarWines(wineId, query);
  }

  @Get(':wineId')
  async getById(@Param('wineId') wineId: string) {
    const wine = await this.winesService.getWineById(wineId);
    if (!wine) {
      throw new HttpException('Wine not found', HttpStatus.NOT_FOUND);
    }
    return wine;
  }

  @Post('submissions')
  @ApiOperation({ summary: 'Submit a wine to master library staging' })
  async submitWine(
    @Body() dto: CreateWineSubmissionDto,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ) {
    return await this.wineSubmissionsService.submitWine(
      user.restaurantId,
      user.userId,
      dto,
    );
  }

  @Get('submissions/list')
  @ApiOperation({ summary: 'List master wine submissions' })
  async listSubmissions(@Query() query: SubmissionListQueryDto) {
    return await this.wineSubmissionsService.listSubmissions(
      query.status,
      query.limit,
    );
  }

  @Post('submissions/process')
  @ApiOperation({ summary: 'Process pending submissions (dedup worker)' })
  async processSubmissions(@Body() dto: ProcessSubmissionsDto) {
    return await this.wineSubmissionsService.processPendingSubmissions(dto.limit);
  }
}
