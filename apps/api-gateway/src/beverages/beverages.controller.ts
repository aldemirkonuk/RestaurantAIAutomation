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
import { BeveragesService } from "./beverages.service";
import { ListBeveragesQueryDto, ListCocktailsQueryDto } from "./dto/beverages.dto";

/**
 * Read-only lists over `public.beverages` and `public.cocktails`.
 *
 * TENANT SCOPE. Both routes name the restaurant in the path, so
 * `assertTenantMatch` inside `JwtAuthGuard` refuses a caller reaching into
 * another house (and refuses a tenantless session naming one at all) before
 * this controller runs. `/beverages/:id` still reads a GLOBAL catalogue — the
 * table has no `restaurant_id` — and the response says so in `scope`; the path
 * parameter is there so the read is attributable and gated, not to imply the
 * rows belong to the house.
 *
 * No writes. Both tables are populated by migration and extraction pipelines,
 * and a create endpoint here would be a second writer for an identity that is
 * decided by a database trigger (`beverage_identity_key`).
 */
@ApiTags("beverages")
@Controller()
@UseGuards(JwtAuthGuard)
export class BeveragesController {
  constructor(private readonly beverages: BeveragesService) {}

  @Get("beverages/:restaurantId")
  @ApiOperation({
    summary:
      "List the shared beverage reference catalogue (beer, spirits, and the rest)",
  })
  @ApiResponse({ status: 200, description: "Rows plus the scope they carry" })
  async listBeverages(
    @Param("restaurantId") restaurantId: string,
    @Query() query: ListBeveragesQueryDto,
  ) {
    try {
      return await this.beverages.listBeverages(restaurantId, {
        type: query.type,
        register: query.register,
        search: query.search,
        limit: query.limit ?? 200,
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error instanceof Error ? error.message : "Failed to list beverages",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get("cocktails/:restaurantId")
  @ApiOperation({ summary: "List this restaurant's cocktails" })
  @ApiResponse({ status: 200, description: "Rows, plus unattributed reference count" })
  async listCocktails(
    @Param("restaurantId") restaurantId: string,
    @Query() query: ListCocktailsQueryDto,
  ) {
    try {
      return await this.beverages.listCocktails(restaurantId, {
        search: query.search,
        limit: query.limit ?? 200,
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error instanceof Error ? error.message : "Failed to list cocktails",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
