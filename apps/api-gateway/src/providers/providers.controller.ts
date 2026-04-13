import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import {
  BulkImportProvidersDto,
  BulkImportResultDto,
  CreateProviderContactDto,
  CreateProviderDto,
  ProviderContactResponseDto,
  ProviderRatingDto,
  ProviderResponseDto,
  UpdateContactDateDto,
  UpdateProviderContactDto,
  UpdateProviderDto,
} from './dto/providers.dto';
import { ProvidersService } from './providers.service';

@ApiTags('providers')
@Controller('providers')
@UseGuards(JwtAuthGuard)
export class ProvidersController {
  constructor(private readonly providersService: ProvidersService) {}

  // =========================================================================
  // STATIC ROUTES (must come before :id params)
  // =========================================================================

  @Get('search')
  @ApiOperation({ summary: 'Search providers' })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'restaurantId', required: false })
  @ApiQuery({ name: 'specialties', required: false, type: [String] })
  @ApiQuery({ name: 'isActive', required: false })
  @ApiResponse({ status: 200, type: [ProviderResponseDto] })
  async searchProviders(
    @Query('q') q?: string,
    @Query('restaurantId') restaurantId?: string,
    @Query('specialties') specialties?: string | string[],
    @Query('isActive') isActive?: string,
  ): Promise<ProviderResponseDto[]> {
    try {
      const specialtiesArr = specialties
        ? Array.isArray(specialties) ? specialties : [specialties]
        : undefined;

      return await this.providersService.searchProviders({
        q,
        restaurantId,
        specialties: specialtiesArr,
        isActive: isActive !== undefined ? isActive === 'true' : undefined,
      });
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to search providers',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('search/wine-type')
  @ApiOperation({ summary: 'Search providers by wine type' })
  @ApiQuery({ name: 'restaurantId', required: true })
  @ApiQuery({ name: 'wineType', required: true })
  @ApiResponse({ status: 200, type: [ProviderResponseDto] })
  async searchByWineType(
    @Query('restaurantId') restaurantId: string,
    @Query('wineType') wineType: string,
  ): Promise<ProviderResponseDto[]> {
    try {
      return await this.providersService.searchProviders({
        restaurantId,
        wineType,
        isActive: true,
      });
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to search providers by wine type',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('recommendations')
  @ApiOperation({ summary: 'Get recommended providers' })
  @ApiQuery({ name: 'restaurantId', required: true })
  @ApiQuery({ name: 'wineId', required: false })
  @ApiResponse({ status: 200, description: 'Recommended providers' })
  async getRecommendations(
    @Query('restaurantId') restaurantId: string,
    @Query('wineId') wineId?: string,
  ) {
    try {
      return await this.providersService.getRecommendations(restaurantId, wineId);
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to get recommendations',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('bulk-import')
  @ApiOperation({ summary: 'Bulk import providers' })
  @ApiResponse({ status: 201, type: BulkImportResultDto })
  async bulkImport(@Body() dto: BulkImportProvidersDto): Promise<BulkImportResultDto> {
    try {
      return await this.providersService.bulkImportProviders(dto);
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to import providers',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('import')
  @ApiOperation({ summary: 'Bulk import providers (alias)' })
  @ApiResponse({ status: 201, type: BulkImportResultDto })
  async importProviders(@Body() dto: BulkImportProvidersDto): Promise<BulkImportResultDto> {
    return this.bulkImport(dto);
  }

  // =========================================================================
  // BASIC CRUD
  // =========================================================================

  @Post()
  @ApiOperation({ summary: 'Create provider' })
  @ApiResponse({ status: 201, type: ProviderResponseDto })
  async createProvider(
    @Body() dto: CreateProviderDto,
    @CurrentUser() user: { id: string; restaurantId: string },
  ): Promise<ProviderResponseDto> {
    try {
      return await this.providersService.createProvider(dto, user.restaurantId, user.id);
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to create provider',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get()
  @ApiOperation({ summary: 'List providers' })
  @ApiResponse({ status: 200, type: [ProviderResponseDto] })
  async listProviders(): Promise<ProviderResponseDto[]> {
    try {
      return await this.providersService.listProviders();
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to fetch providers',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get provider details' })
  @ApiResponse({ status: 200, type: ProviderResponseDto })
  async getProvider(@Param('id') providerId: string): Promise<ProviderResponseDto> {
    try {
      return await this.providersService.getProvider(providerId);
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to fetch provider',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update provider' })
  @ApiResponse({ status: 200, type: ProviderResponseDto })
  async updateProvider(
    @Param('id') providerId: string,
    @Body() dto: UpdateProviderDto,
    @CurrentUser() user: { id: string; restaurantId: string },
  ): Promise<ProviderResponseDto> {
    try {
      return await this.providersService.updateProvider(providerId, dto, user.restaurantId, user.id);
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to update provider',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft delete provider' })
  @ApiResponse({ status: 200, description: 'Provider deleted' })
  async deleteProvider(
    @Param('id') providerId: string,
    @CurrentUser() user: { id: string; restaurantId: string },
  ): Promise<{ success: boolean }> {
    try {
      await this.providersService.softDeleteProvider(providerId, user.restaurantId, user.id);
      return { success: true };
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to delete provider',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // =========================================================================
  // PROVIDER SUB-RESOURCES
  // =========================================================================

  @Get(':id/orders')
  @ApiOperation({ summary: 'Provider order history' })
  @ApiResponse({ status: 200, description: 'Returns provider orders' })
  async getProviderOrders(@Param('id') providerId: string) {
    try {
      return await this.providersService.getProviderOrders(providerId);
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to fetch provider orders',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(':id/performance')
  @ApiOperation({ summary: 'Provider performance metrics' })
  @ApiResponse({ status: 200, description: 'Returns provider performance metrics' })
  async getProviderPerformance(@Param('id') providerId: string) {
    try {
      return await this.providersService.getProviderPerformance(providerId);
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to fetch provider performance',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post(':id/rate')
  @ApiOperation({ summary: 'Rate provider' })
  @ApiResponse({ status: 201, description: 'Provider rated' })
  async rateProvider(
    @Param('id') providerId: string,
    @Body() dto: ProviderRatingDto,
    @CurrentUser() user: { restaurantId: string },
  ): Promise<{ success: boolean }> {
    try {
      await this.providersService.rateProvider(user.restaurantId, providerId, dto);
      return { success: true };
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to rate provider',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // =========================================================================
  // CONTACTS
  // =========================================================================

  @Get(':id/contacts')
  @ApiOperation({ summary: 'Get provider contacts' })
  @ApiResponse({ status: 200, type: [ProviderContactResponseDto] })
  async getProviderContacts(
    @Param('id') providerId: string,
  ): Promise<ProviderContactResponseDto[]> {
    try {
      return await this.providersService.getProviderContacts(providerId);
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to fetch provider contacts',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post(':id/contacts')
  @ApiOperation({ summary: 'Add contact to provider' })
  @ApiResponse({ status: 201, type: ProviderContactResponseDto })
  async addProviderContact(
    @Param('id') providerId: string,
    @Body() dto: CreateProviderContactDto,
  ): Promise<ProviderContactResponseDto> {
    try {
      return await this.providersService.addProviderContact(providerId, dto);
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to add provider contact',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Patch(':id/contacts/:contactId')
  @ApiOperation({ summary: 'Update provider contact' })
  @ApiResponse({ status: 200, type: ProviderContactResponseDto })
  async updateProviderContact(
    @Param('id') providerId: string,
    @Param('contactId') contactId: string,
    @Body() dto: UpdateProviderContactDto,
  ): Promise<ProviderContactResponseDto> {
    try {
      return await this.providersService.updateProviderContact(providerId, contactId, dto);
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to update provider contact',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete(':id/contacts/:contactId')
  @ApiOperation({ summary: 'Delete provider contact' })
  @ApiResponse({ status: 200, description: 'Contact deleted' })
  async deleteProviderContact(
    @Param('id') providerId: string,
    @Param('contactId') contactId: string,
  ): Promise<{ success: boolean }> {
    try {
      await this.providersService.deleteProviderContact(providerId, contactId);
      return { success: true };
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to delete provider contact',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // =========================================================================
  // CONTACT DATE
  // =========================================================================

  @Patch(':id/contact-date')
  @ApiOperation({ summary: 'Update last contact date' })
  @ApiResponse({ status: 200, type: ProviderResponseDto })
  async updateContactDate(
    @Param('id') providerId: string,
    @Body() dto: UpdateContactDateDto,
  ): Promise<ProviderResponseDto> {
    try {
      return await this.providersService.updateLastContactDate(providerId, dto);
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to update contact date',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // =========================================================================
  // RECOMMENDATIONS (per-provider, alternative route)
  // =========================================================================

  @Get(':id/recommendations')
  @ApiOperation({ summary: 'AI-powered provider recommendations' })
  @ApiQuery({ name: 'restaurantId', required: false })
  @ApiQuery({ name: 'wineId', required: false })
  @ApiResponse({ status: 200, description: 'Provider recommendations' })
  async getProviderRecommendations(
    @Param('id') _providerId: string,
    @Query('restaurantId') restaurantId?: string,
    @Query('wineId') wineId?: string,
  ) {
    try {
      return await this.providersService.getRecommendations(
        restaurantId ?? '',
        wineId,
      );
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to get recommendations',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
