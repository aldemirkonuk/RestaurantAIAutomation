import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { SearchVendorsDto } from "./dto/search-vendors.dto";
import { MatchVendorsDto } from "./dto/match-vendors.dto";
import {
  VendorCatalogueRow,
  VendorCatalogueService,
  VendorMatchCandidate,
  VendorSearchResult,
} from "./vendor-catalogue.service";

@ApiTags("vendor-catalogue")
@Controller("vendor-catalogue")
@UseGuards(JwtAuthGuard)
export class VendorCatalogueController {
  constructor(
    private readonly vendorCatalogueService: VendorCatalogueService,
  ) {}

  @Get("search")
  @ApiOperation({ summary: "Search vendor catalogue" })
  @ApiQuery({
    name: "q",
    required: false,
    description: "Search term for vendor name",
  })
  @ApiQuery({
    name: "country",
    required: false,
    description: "Filter by country (default: US)",
  })
  @ApiQuery({
    name: "type",
    required: false,
    description: "Filter by vendor type",
  })
  @ApiQuery({
    name: "limit",
    required: false,
    type: Number,
    description: "Max results (default: 20, max: 50)",
  })
  @ApiQuery({
    name: "offset",
    required: false,
    type: Number,
    description: "Pagination offset (default: 0)",
  })
  @ApiResponse({
    status: 200,
    description: "Paginated vendor catalogue search results",
  })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  async search(@Query() dto: SearchVendorsDto): Promise<VendorSearchResult> {
    try {
      return await this.vendorCatalogueService.search(dto);
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to search vendor catalogue",
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // MUST come before `@Get(":id")` — Nest matches routes in declaration
  // order, and ":id" would otherwise swallow "/vendor-catalogue/match" as a
  // literal id lookup.
  @Get("match")
  @ApiOperation({
    summary:
      "Duplicate-detection candidates for the add-provider form — is this vendor already in the curated catalogue?",
  })
  @ApiQuery({ name: "name", required: false })
  @ApiQuery({ name: "address", required: false })
  @ApiQuery({ name: "country", required: false })
  @ApiQuery({ name: "limit", required: false, type: Number })
  @ApiResponse({
    status: 200,
    description: "Curated vendors that plausibly match, ranked by similarity",
  })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  async match(
    @Query() dto: MatchVendorsDto,
  ): Promise<VendorMatchCandidate[]> {
    try {
      return await this.vendorCatalogueService.match(dto);
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to match vendor catalogue",
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(":id")
  @ApiOperation({ summary: "Get vendor catalogue entry by ID" })
  @ApiResponse({ status: 200, description: "Vendor catalogue entry details" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  @ApiResponse({ status: 404, description: "Vendor not found" })
  async findById(@Param("id") id: string): Promise<VendorCatalogueRow> {
    try {
      return await this.vendorCatalogueService.findById(id);
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to fetch vendor",
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
