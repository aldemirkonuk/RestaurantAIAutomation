import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import {
  DistributorFacetsDto,
  SearchDistributorsDto,
} from "./dto/search-distributors.dto";
import {
  DistributorDetail,
  DistributorDiscoveryService,
  DistributorSearchResult,
} from "./distributor-discovery.service";

/**
 * Read-only discovery over the global distributor catalogue.
 *
 * The restaurant is taken from the JWT, never from the query string: the global
 * TenantGuard rejects a request carrying a restaurantId that disagrees with the
 * token, and legality must be decided by who you are, not by what you ask for.
 *
 * Route order matters — the literal paths are declared before ":id" so that
 * /distributors/facets is not swallowed by the param route.
 */
@ApiTags("distributors")
@Controller("distributors")
@UseGuards(JwtAuthGuard)
export class DistributorDiscoveryController {
  constructor(private readonly service: DistributorDiscoveryService) {}

  @Get("search")
  @ApiOperation({
    summary: "Search distributors by territory, distance and portfolio",
    description:
      "Returns distributors legally able to serve the caller's restaurant, nearest first. " +
      "Distance is measured to the nearest known vendor location and falls back to the " +
      "registered head office, flagged by distance_is_hq.",
  })
  @ApiResponse({ status: 200, description: "Paginated distributor results" })
  @ApiResponse({ status: 400, description: "Invalid filter parameters" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  async search(
    @CurrentUser() user: { restaurantId: string },
    @Query() dto: SearchDistributorsDto,
  ): Promise<DistributorSearchResult> {
    try {
      return await this.service.search(user.restaurantId, dto);
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to search distributors",
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get("facets")
  @ApiOperation({
    summary: "Portfolio facet counts for the filter rail",
    description:
      "Counts are computed against the same territory gate as /search, so a facet chip " +
      "never promises results the search will not return.",
  })
  @ApiResponse({ status: 200, description: "Facet counts grouped by kind" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  async facets(
    @CurrentUser() user: { restaurantId: string },
    @Query() dto: DistributorFacetsDto,
  ): Promise<Record<string, Array<{ slug: string; value: string; vendors: number }>>> {
    try {
      return await this.service.facetCounts(user.restaurantId, dto);
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to load distributor facets",
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(":id")
  @ApiOperation({ summary: "Distributor detail with locations, territories and portfolio" })
  @ApiResponse({ status: 200, description: "Distributor detail" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  @ApiResponse({ status: 404, description: "Distributor not found" })
  async findById(@Param("id") id: string): Promise<DistributorDetail> {
    try {
      return await this.service.findById(id);
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to fetch distributor",
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
