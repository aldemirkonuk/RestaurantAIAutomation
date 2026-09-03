import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { BeveragesService } from "./beverages.service";
import { isRegisterId } from "../cellar/cellar-registers";
import {
  CreateCocktailDto,
  ListBeveragesQueryDto,
  ListCocktailsQueryDto,
  ReadRegisterQueryDto,
  SetCocktailIngredientsDto,
  UpdateCocktailDto,
} from "./dto/beverages.dto";

/**
 * The cellar's registers: reads over `public.beverages`, and full CRUD over
 * `public.cocktails` — the one table here that carries a `restaurant_id`.
 *
 * TENANT SCOPE. Both routes name the restaurant in the path, so
 * `assertTenantMatch` inside `JwtAuthGuard` refuses a caller reaching into
 * another house (and refuses a tenantless session naming one at all) before
 * this controller runs. `/beverages/:restaurantId` still reads a GLOBAL
 * catalogue (there is no per-beverage GET here at all) — the
 * table has no `restaurant_id` — and the response says so in `scope`; the path
 * parameter is there so the read is attributable and gated, not to imply the
 * rows belong to the house.
 *
 * WRITES, AND WHERE THEY STOP. `public.cocktails` carries a `restaurant_id`
 * and is this house's own list, so it has full CRUD here. `public.beverages`
 * does not and never gains a write path from this controller: a tenant
 * inserting into the shared reference catalogue would be a second writer for an
 * identity a database trigger owns (`set_beverage_identity` →
 * `beverage_identity_key`). That refusal is rendered as a sentence on the
 * register, not as a button that quietly does nothing.
 *
 * AND NOTHING HERE STOCKS ANYTHING. Every quantity path in the schema is keyed
 * on `master_wine_id`, so add-to-inventory for a beer, a whisky or a cola is
 * withheld until OD-113 decides the identity axis. The register response
 * carries that sentence in `stocking.reason` so the browser cannot invent a
 * cheerier one.
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

  @Get("beverages/:restaurantId/registers/:register")
  @ApiOperation({
    summary:
      "One cellar register, whole: this house's own record per row, then the shared catalogue",
  })
  @ApiResponse({
    status: 200,
    description:
      "Rows, per-source status, and the sentence withholding stock (OD-113)",
  })
  async readRegister(
    @Param("restaurantId") restaurantId: string,
    @Param("register") register: string,
    @Query() query: ReadRegisterQueryDto,
  ) {
    // Validated against the vocabulary, never trusted: an unknown register is a
    // 400 rather than a read that silently drops its filter — the exact bug
    // `?register=soft_drinks` produced on the list endpoint on 2026-09-03.
    if (!isRegisterId(register)) {
      throw new HttpException(
        `'${register}' is not one of this cellar's registers.`,
        HttpStatus.BAD_REQUEST,
      );
    }
    if (register === "wines") {
      throw new HttpException(
        "Wines are served by GET /wines with GET /inventory laid over them, not by this register — asking here would return the wrong book.",
        HttpStatus.BAD_REQUEST,
      );
    }
    try {
      return await this.beverages.readRegister(restaurantId, register, {
        search: query.search,
        catalogueLimit: query.catalogueLimit ?? 400,
        ledgerLimit: query.ledgerLimit ?? 600,
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error instanceof Error ? error.message : "Failed to read the register",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /* ── cocktails: create, amend, retire, and record the recipe ───────────── */

  @Post("cocktails/:restaurantId")
  @ApiOperation({ summary: "Record a cocktail on this house's list" })
  @ApiResponse({ status: 201, description: "The row as it was written" })
  async createCocktail(
    @Param("restaurantId") restaurantId: string,
    @Body() dto: CreateCocktailDto,
  ) {
    return this.guard(() => this.beverages.createCocktail(restaurantId, dto));
  }

  @Patch("cocktails/:restaurantId/:cocktailId")
  @ApiOperation({ summary: "Amend one of this house's cocktails" })
  async updateCocktail(
    @Param("restaurantId") restaurantId: string,
    @Param("cocktailId", new ParseUUIDPipe()) cocktailId: string,
    @Body() dto: UpdateCocktailDto,
  ) {
    return this.guard(() =>
      this.beverages.updateCocktail(restaurantId, cocktailId, dto),
    );
  }

  @Delete("cocktails/:restaurantId/:cocktailId")
  @ApiOperation({
    summary: "Take a cocktail off the list (soft — the row is kept, dated)",
  })
  async deleteCocktail(
    @Param("restaurantId") restaurantId: string,
    @Param("cocktailId", new ParseUUIDPipe()) cocktailId: string,
  ) {
    return this.guard(() =>
      this.beverages.deleteCocktail(restaurantId, cocktailId),
    );
  }

  @Get("cocktails/:restaurantId/:cocktailId/ingredients")
  @ApiOperation({ summary: "One cocktail's recipe lines, in recorded order" })
  async readIngredients(
    @Param("restaurantId") restaurantId: string,
    @Param("cocktailId", new ParseUUIDPipe()) cocktailId: string,
  ) {
    return this.guard(() =>
      this.beverages.readCocktailIngredients(restaurantId, cocktailId),
    );
  }

  @Put("cocktails/:restaurantId/:cocktailId/ingredients")
  @ApiOperation({
    summary:
      "Replace one cocktail's recipe. The first writer cocktail_ingredients has ever had.",
  })
  async setIngredients(
    @Param("restaurantId") restaurantId: string,
    @Param("cocktailId", new ParseUUIDPipe()) cocktailId: string,
    @Body() dto: SetCocktailIngredientsDto,
  ) {
    return this.guard(() =>
      this.beverages.setCocktailIngredients(restaurantId, cocktailId, dto),
    );
  }

  /**
   * One error shape for the write paths. A failed write is never allowed to
   * return a 2xx body: the legacy cellar's "Reorder" button reported success
   * and wrote nothing, and this module does not repeat it.
   */
  private async guard<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const message =
        error instanceof Error ? error.message : "The write did not happen";
      throw new HttpException(
        message,
        /no (live )?cocktail of this house/i.test(message)
          ? HttpStatus.NOT_FOUND
          : HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
