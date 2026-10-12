import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
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
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { OrganizationsService } from "../organizations/organizations.service";
import { BeveragesService } from "./beverages.service";
import { isRegisterId } from "../cellar/cellar-registers";
import { holdsHouseMoney } from "../procurement/documents/document-money-gate";
import type { RegisterResult } from "./house-record";
import type { RowRecord } from "./row-record";
import {
  CreateCocktailDto,
  ListBeveragesQueryDto,
  ListCocktailsQueryDto,
  ReadRegisterQueryDto,
  ReadRowRecordQueryDto,
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
 *
 * WHO MAY PRICE AND RETIRE. A cocktail's price and taking it off the list are
 * an owner's or a manager's, the same people who price a line on /menu
 * (menus.controller.ts, POST /menus/items). The coordinator's call for the
 * founder, 2026-10-08 (F-270). The rest of a cocktail (name, method, glass,
 * garnish, section, description) and its recipe stay open to anyone of the
 * house, so a bartender can still write down how a drink is made.
 */
/**
 * The books that say what the house PAID: invoices, orders and quotes. The
 * menu (what the floor sells at) and the till stay open to everyone.
 */
const BUYING_BOOKS = new Set(["invoice", "order", "quote"]);

/**
 * A register as this role may read it (F-1220): the same rule as the wine
 * inventory (`inventoryForRole`, ADR 0145, F-562) — staff see stock and the
 * menu, never what the house paid. The buying figures are OMITTED, never
 * nulled, because a null reads as "nothing recorded"; and the reply says
 * `amountsWithheld: true` at its root, as `orderForRole` does, so the page
 * can say the figure is kept rather than draw the "nothing recorded" dash
 * (F-1300).
 */
export function registerForRole<T extends RegisterResult>(
  result: T,
  role: string | null | undefined,
): T & { amountsWithheld?: true } {
  if (holdsHouseMoney(role ?? null)) return result;
  return {
    ...result,
    amountsWithheld: true,
    rows: result.rows.map((row) => {
      if (!row.house) return row;
      const house: Record<string, any> = { ...row.house };
      if (house.bought) {
        const bought = { ...house.bought };
        delete bought.paidTotal;
        delete bought.lastUnitPrice;
        house.bought = bought;
      }
      for (const k of ["ordered", "quoted"] as const) {
        if (house[k]) {
          const book = { ...house[k] };
          delete book.lastPrice;
          house[k] = book;
        }
      }
      return { ...row, house: house as typeof row.house };
    }),
  };
}

/**
 * The record behind one row, as this role may read it (F-1220): for a reader
 * who does not hold the house's money, the buying books keep their dates,
 * counts and lines but lose their price series and each line's price, and the
 * reply says `amountsWithheld: true` (F-1300).
 */
export function rowRecordForRole(
  record: RowRecord,
  role: string | null | undefined,
): RowRecord & { amountsWithheld?: true } {
  if (holdsHouseMoney(role ?? null)) return record;
  return {
    ...record,
    amountsWithheld: true,
    books: record.books.map((b) =>
      BUYING_BOOKS.has(b.book)
        ? {
            ...b,
            price: [],
            ledger: b.ledger.map((e) => {
              const line: Record<string, any> = { ...e };
              delete line.unitPrice;
              delete line.total;
              return line as typeof e;
            }),
          }
        : b,
    ),
  };
}

/**
 * F-1329: a cocktail's cost per serve and margin are what the house paid for
 * its ingredients, so a reader who does not hold the house's money gets the
 * cocktail list, and each recipe line's stock row, with every cost OMITTED
 * and `amountsWithheld: true` at the root: the same rule as the registers
 * above (ADR 0145). How many lines are linked stays; it is not money.
 */
export function cocktailsForRole<
  T extends { rows: Array<Record<string, any>> },
>(result: T, role: string | null | undefined): T & { amountsWithheld?: true } {
  if (holdsHouseMoney(role ?? null)) return result;
  return {
    ...result,
    amountsWithheld: true,
    rows: result.rows.map((row) => {
      const out: Record<string, any> = { ...row };
      if (out.serve) {
        out.serve = {
          linked: out.serve.linked,
          notLinked: out.serve.notLinked,
        };
      }
      // A recipe line's cost: omitted, but whether it is linked is kept.
      if (out.cost) {
        out.cost =
          out.cost.state === "not_linked"
            ? out.cost
            : { state: "withheld", reason: "kept for the owner and managers" };
      }
      return out;
    }) as T["rows"],
  };
}

@ApiTags("beverages")
@Controller()
@UseGuards(JwtAuthGuard)
export class BeveragesController {
  constructor(
    private readonly beverages: BeveragesService,
    private readonly organizations: OrganizationsService,
  ) {}

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
    @CurrentUser() user?: { role?: string | null },
  ) {
    try {
      return cocktailsForRole(
        await this.beverages.listCocktails(restaurantId, {
          search: query.search,
          limit: query.limit ?? 200,
        }),
        user?.role,
      );
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
    @CurrentUser() user?: { role?: string | null },
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
      return registerForRole(
        await this.beverages.readRegister(restaurantId, register, {
          search: query.search,
          catalogueLimit: query.catalogueLimit ?? 400,
          ledgerLimit: query.ledgerLimit ?? 600,
        }),
        user?.role,
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error instanceof Error ? error.message : "Failed to read the register",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get("beverages/:restaurantId/row-record")
  @ApiOperation({
    summary:
      "Every line of this house's five books that names one row — the series behind a column",
  })
  @ApiResponse({
    status: 200,
    description:
      "Per-book price and quantity series plus the ledger they were made of; a book that could not be read says so",
  })
  async readRowRecord(
    @Param("restaurantId") restaurantId: string,
    @Query() query: ReadRowRecordQueryDto,
    @CurrentUser() user?: { role?: string | null },
  ) {
    try {
      return rowRecordForRole(
        await this.beverages.readRowRecord(restaurantId, query.label),
        user?.role,
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error instanceof Error
          ? error.message
          : "Failed to read the record behind this row",
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
    @CurrentUser() user: { userId?: string },
  ) {
    // An unpriced cocktail may be recorded by anyone of the house; a priced
    // one is an owner's or a manager's.
    if (dto.price !== undefined && dto.price !== null) {
      await this.assertManages(user, restaurantId, "set a cocktail's price");
    }
    return this.guard(() => this.beverages.createCocktail(restaurantId, dto));
  }

  @Patch("cocktails/:restaurantId/:cocktailId")
  @ApiOperation({ summary: "Amend one of this house's cocktails" })
  async updateCocktail(
    @Param("restaurantId") restaurantId: string,
    @Param("cocktailId", new ParseUUIDPipe()) cocktailId: string,
    @Body() dto: UpdateCocktailDto,
    @CurrentUser() user: { userId?: string },
  ) {
    // The role is read only when a price is sent. The service refuses a
    // CHANGED price from anyone else; the page sends the unchanged price
    // back with every amend, so that alone is not refused.
    const mayPrice =
      dto.price !== undefined && user?.userId
        ? ["owner", "manager"].includes(
            (await this.organizations.resolveRestaurantRole(
              user.userId,
              restaurantId,
            )) ?? "",
          )
        : false;
    return this.guard(() =>
      this.beverages.updateCocktail(restaurantId, cocktailId, dto, mayPrice),
    );
  }

  @Delete("cocktails/:restaurantId/:cocktailId")
  @ApiOperation({
    summary: "Take a cocktail off the list (soft — the row is kept, dated)",
  })
  async deleteCocktail(
    @Param("restaurantId") restaurantId: string,
    @Param("cocktailId", new ParseUUIDPipe()) cocktailId: string,
    @CurrentUser() user: { userId?: string },
  ) {
    await this.assertManages(
      user,
      restaurantId,
      "take a cocktail off the list",
    );
    return this.guard(() =>
      this.beverages.deleteCocktail(restaurantId, cocktailId),
    );
  }

  @Get("cocktails/:restaurantId/:cocktailId/ingredients")
  @ApiOperation({ summary: "One cocktail's recipe lines, in recorded order" })
  async readIngredients(
    @Param("restaurantId") restaurantId: string,
    @Param("cocktailId", new ParseUUIDPipe()) cocktailId: string,
    @CurrentUser() user?: { role?: string | null },
  ) {
    return this.guard(async () =>
      cocktailsForRole(
        await this.beverages.readCocktailIngredients(restaurantId, cocktailId),
        user?.role,
      ),
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

  /** Owner or manager of this house, or a refusal before anything is written. */
  private async assertManages(
    user: { userId?: string } | undefined,
    restaurantId: string,
    action: string,
  ): Promise<void> {
    if (!user?.userId) {
      throw new ForbiddenException(
        "This session names no one, so it cannot " +
          action +
          ". Nothing was changed.",
      );
    }
    await this.organizations.assertCanManageRestaurant(
      user.userId,
      restaurantId,
      action,
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
