import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SearchVendorsDto } from './dto/search-vendors.dto';
import {
  VendorCatalogueRow,
  VendorCatalogueService,
  VendorSearchResult,
} from './vendor-catalogue.service';

@ApiTags('vendor-catalogue')
@Controller('vendor-catalogue')
@UseGuards(JwtAuthGuard)
export class VendorCatalogueController {
  constructor(private readonly vendorCatalogueService: VendorCatalogueService) {}

  @Get('search')
  @ApiOperation({ summary: 'Search vendor catalogue' })
  @ApiQuery({ name: 'q', required: false, description: 'Search term for vendor name' })
  @ApiQuery({ name: 'country', required: false, description: 'Filter by country (default: US)' })
  @ApiQuery({ name: 'type', required: false, description: 'Filter by vendor type' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Max results (default: 20, max: 50)' })
  @ApiQuery({ name: 'offset', required: false, type: Number, description: 'Pagination offset (default: 0)' })
  @ApiResponse({ status: 200, description: 'Paginated vendor catalogue search results' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async search(@Query() dto: SearchVendorsDto): Promise<VendorSearchResult> {
    try {
      return await this.vendorCatalogueService.search(dto);
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to search vendor catalogue',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get vendor catalogue entry by ID' })
  @ApiResponse({ status: 200, description: 'Vendor catalogue entry details' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Vendor not found' })
  async findById(@Param('id') id: string): Promise<VendorCatalogueRow> {
    try {
      return await this.vendorCatalogueService.findById(id);
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to fetch vendor',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
