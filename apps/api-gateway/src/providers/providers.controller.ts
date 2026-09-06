import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import {
  BulkImportProvidersDto,
  BulkImportResultDto,
  CreateProviderContactDto,
  CreateProviderDto,
  CreateProviderLocationDto,
  ProviderContactResponseDto,
  ProviderRatingDto,
  ProviderResponseDto,
  UpdateContactDateDto,
  UpdateProviderContactDto,
  UpdateProviderDto,
  UpdateProviderLocationDto,
} from "./dto/providers.dto";
import { UpdateIntelligenceDto } from "./dto/update-intelligence.dto";
import { RetroactiveOrderDto } from "./dto/retroactive-order.dto";
import { ProvidersService } from "./providers.service";
import { OrganizationsService } from "../organizations/organizations.service";
import { roleSatisfies } from "../procurement/order-approval-gate";
import {
  readVendorCurrency,
  usualCurrencyCoverageSentence,
  vendorCurrencySentence,
} from "./vendor-currency";

@ApiTags("providers")
@Controller("providers")
@UseGuards(JwtAuthGuard)
export class ProvidersController {
  constructor(
    private readonly providersService: ProvidersService,
    // The role half of B1's gate. `resolveRestaurantRole` is the one
    // implementation of "what is this person here" (its own header argues why a
    // second one drifts), and it returns `null` for both "no row" and "the read
    // failed" — so `roleSatisfies` is what must be asked, never the string.
    private readonly organizations: OrganizationsService,
  ) {}

  // =========================================================================
  // STATIC ROUTES (must come before :id params)
  // =========================================================================

  // =========================================================================
  // B2 (batch 66) — how many vendors have stated a usual currency.
  //
  // THE FOUNDER, 2026-09-06, batch 66, verbatim: *"Add the prompt panel"* —
  // "One panel on the providers page (and the orders sheet's empty field)
  // saying how many vendors have stated a usual currency and linking to the
  // ones that have not. No provenance lie."
  //
  // READABLE BY MANAGERS AND STAFF ALIKE: it is information about the house's
  // own book, not an act. Only STATING a currency is manager-gated
  // (`PATCH :id/usual-currency` below), and a staff member who can see which
  // vendors are unanswered is the person most likely to ask a manager to
  // answer them.
  //
  // Two static segments, so `@Get(":id")` and `@Get(":id/usual-currency")`
  // cannot swallow it; declared here with the other static routes regardless.
  // =========================================================================
  @Get("usual-currency/coverage")
  @ApiOperation({
    summary: "How many of this house's vendors have stated a usual currency",
    description:
      "A count and the names that are missing, for the providers page's prompt panel and the order sheet's empty currency field. It PRE-FILLS NOTHING and writes nothing: the repair for an unstated vendor is a person stating it on that vendor's profile, never a house-derived default recorded as somebody's choice. Live vendors only (is_active is not false and deleted_at is null) — the retired ones can take no order. A stored value that is not an ISO 4217 currency counts as unstated and is returned with the code it holds. A failed read is a 503 with the reason, never a coverage of zero.",
  })
  async usualCurrencyCoverage(
    @CurrentUser() user: { id: string; restaurantId: string },
  ): Promise<{
    stated: number;
    total: number;
    unstated: { id: string; name: string; recorded: string | null }[];
    sentence: string;
  }> {
    const counted = await this.providersService.usualCurrencyCoverage(
      user.restaurantId,
    );
    return {
      ...counted,
      sentence: usualCurrencyCoverageSentence({
        stated: counted.stated,
        total: counted.total,
      }),
    };
  }

  @Get("search")
  @ApiOperation({ summary: "Search providers" })
  @ApiQuery({ name: "q", required: false })
  @ApiQuery({ name: "specialties", required: false, type: [String] })
  @ApiQuery({ name: "isActive", required: false })
  @ApiResponse({ status: 200, type: [ProviderResponseDto] })
  async searchProviders(
    @CurrentUser() user: { id: string; restaurantId: string },
    @Query("q") q?: string,
    @Query("specialties") specialties?: string | string[],
    @Query("isActive") isActive?: string,
  ): Promise<ProviderResponseDto[]> {
    try {
      const specialtiesArr = specialties
        ? Array.isArray(specialties)
          ? specialties
          : [specialties]
        : undefined;

      return await this.providersService.searchProviders({
        q,
        restaurantId: user.restaurantId,
        specialties: specialtiesArr,
        isActive: isActive !== undefined ? isActive === "true" : undefined,
      });
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to search providers",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get("search/wine-type")
  @ApiOperation({ summary: "Search providers by wine type" })
  @ApiQuery({ name: "wineType", required: true })
  @ApiResponse({ status: 200, type: [ProviderResponseDto] })
  async searchByWineType(
    @CurrentUser() user: { id: string; restaurantId: string },
    @Query("wineType") wineType: string,
  ): Promise<ProviderResponseDto[]> {
    try {
      return await this.providersService.searchProviders({
        restaurantId: user.restaurantId,
        wineType,
        isActive: true,
      });
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to search providers by wine type",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get("recommendations")
  @ApiOperation({ summary: "Get recommended providers" })
  @ApiQuery({ name: "restaurantId", required: true })
  @ApiQuery({ name: "wineId", required: false })
  @ApiResponse({ status: 200, description: "Recommended providers" })
  async getRecommendations(
    @Query("restaurantId") restaurantId: string,
    @Query("wineId") wineId?: string,
  ) {
    try {
      return await this.providersService.getRecommendations(
        restaurantId,
        wineId,
      );
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to get recommendations",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // Declared before `@Get(":id")` — Nest matches in declaration order, and
  // ":id" would otherwise capture "/providers/match" as a provider id.
  @Get("match")
  @ApiOperation({
    summary:
      "Providers in this restaurant's own list that look like duplicates of the given name/address",
  })
  @ApiQuery({ name: "name", required: false })
  @ApiQuery({ name: "address", required: false })
  @ApiQuery({
    name: "excludeId",
    required: false,
    description:
      "Provider being edited, excluded so it does not match itself at 1.0",
  })
  @ApiResponse({ status: 200, description: "Ranked duplicate candidates" })
  async matchProviders(
    @CurrentUser() user: { id: string; restaurantId: string },
    @Query("name") name?: string,
    @Query("address") address?: string,
    @Query("excludeId") excludeId?: string,
  ) {
    try {
      return await this.providersService.matchProviders(user.restaurantId, {
        name,
        address,
        excludeId,
      });
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to match providers",
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post("bulk-import")
  @ApiOperation({ summary: "Bulk import providers" })
  @ApiResponse({ status: 201, type: BulkImportResultDto })
  async bulkImport(
    @Body() dto: BulkImportProvidersDto,
  ): Promise<BulkImportResultDto> {
    try {
      return await this.providersService.bulkImportProviders(dto);
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to import providers",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post("import")
  @ApiOperation({ summary: "Bulk import providers (alias)" })
  @ApiResponse({ status: 201, type: BulkImportResultDto })
  async importProviders(
    @Body() dto: BulkImportProvidersDto,
  ): Promise<BulkImportResultDto> {
    return this.bulkImport(dto);
  }

  // =========================================================================
  // BASIC CRUD
  // =========================================================================

  @Post()
  @ApiOperation({ summary: "Create provider" })
  @ApiResponse({ status: 201, type: ProviderResponseDto })
  async createProvider(
    @Body() dto: CreateProviderDto,
    @CurrentUser() user: { id: string; restaurantId: string },
  ): Promise<ProviderResponseDto> {
    try {
      return await this.providersService.createProvider(
        dto,
        user.restaurantId,
        user.id,
      );
    } catch (error) {
      // Deliberate HTTP semantics from the service (409 for an already-added
      // catalogue vendor, 404 for a missing one, 400 for a bad payload) must
      // survive. Flattening every failure to 500 made "you already have this
      // vendor" indistinguishable from a real server fault, so the client
      // could not tell an expected outcome from a broken one.
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error.message || "Failed to create provider",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get()
  @ApiOperation({ summary: "List providers" })
  @ApiResponse({ status: 200, type: [ProviderResponseDto] })
  async listProviders(
    @CurrentUser() user: { id: string; restaurantId: string },
  ): Promise<ProviderResponseDto[]> {
    try {
      return await this.providersService.listProviders(user.restaurantId);
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to fetch providers",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // =========================================================================
  // B1 — the vendor's usual currency (founder, 2026-09-06 batch 65:
  // "Every vendor and their profile will show their default currency, but we
  // won't use that as the invoice").
  //
  // Declared BEFORE `@Get(":id")`. Nest matches in declaration order, and a
  // route declared after it would never be reached — the same trap the `match`
  // route above is placed to avoid.
  // =========================================================================

  @Get(":id/usual-currency")
  @ApiOperation({
    summary: "What this vendor usually invoices in, and who said so",
    description:
      "The vendor profile's own fact. NEVER used to file an invoice: an invoice takes the currency printed on it, then the currency of the order it is matched to, then the house's. This is offered as the starting value on the order sheet and printed on the profile, and nothing else reads it. A failed read is a 503 with the reason, never an empty field.",
  })
  async getUsualCurrency(
    @Param("id") providerId: string,
    @CurrentUser() user: { id: string; restaurantId: string },
  ) {
    const stated = await this.providersService.getUsualCurrency(
      providerId,
      user.restaurantId,
    );
    return {
      providerId,
      code: stated.code,
      setAt: stated.setAt,
      setByName: stated.setByName,
      sentence: vendorCurrencySentence({
        code: stated.code,
        setByName: stated.setByName,
        setAt: stated.setAt,
        vendorName: stated.vendorName,
      }),
    };
  }

  @Patch(":id/usual-currency")
  @ApiOperation({
    summary: "State what this vendor usually invoices in",
    description:
      "Managers and owners only; staff are refused in words and the page disables the control with that sentence rather than hiding it. The code, the person and the moment are ONE fact enforced by a database CHECK. A blank is refused rather than treated as 'clear it' — clearing a stated currency is a different act with a different consequence and it is not built.",
  })
  async setUsualCurrency(
    @Param("id") providerId: string,
    @Body() body: { currency?: string },
    @CurrentUser() user: { id: string; restaurantId: string },
  ) {
    const typed = readVendorCurrency(body?.currency);
    if (!typed.ok)
      throw new HttpException(typed.because, HttpStatus.BAD_REQUEST);

    // WHO THIS PERSON IS HERE. `null` means "not proven to hold any role" — a
    // failed read and a person with no row are indistinguishable at this layer
    // and neither may pass (`procurement/order-approval-gate.ts`'s header).
    const role = await this.organizations.resolveRestaurantRole(
      user.id,
      user.restaurantId,
    );
    if (!roleSatisfies(role, "manager"))
      throw new HttpException(
        `Stating what a vendor usually invoices in changes the currency every future order to them starts with, so it is a manager's or an owner's decision. ` +
          `${role ? `You are signed in as ${role} at this house` : "This session could not be shown to hold any role at this house"}, so nothing was changed. Ask a manager or an owner to state it.`,
        HttpStatus.FORBIDDEN,
      );

    const written = await this.providersService.setUsualCurrency({
      providerId,
      restaurantId: user.restaurantId,
      code: typed.code,
      userId: user.id,
    });

    return {
      providerId,
      code: written.code,
      previous: written.previous,
      setAt: written.setAt,
      sentence:
        `${written.previous && written.previous !== written.code ? `Changed from ${written.previous} to ${written.code}` : `Stated as ${written.code}`}. ` +
        `This is what an order to this vendor will now start with; the person placing it can change it. ` +
        `It files no invoice — an invoice takes the currency printed on it, then the currency of the order it is matched to.`,
    };
  }

  @Get(":id")
  @ApiOperation({ summary: "Get provider details" })
  @ApiResponse({ status: 200, type: ProviderResponseDto })
  async getProvider(
    @Param("id") providerId: string,
    @CurrentUser() user: { id: string; restaurantId: string },
  ): Promise<ProviderResponseDto> {
    try {
      return await this.providersService.getProvider(
        providerId,
        user.restaurantId,
      );
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to fetch provider",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update provider" })
  @ApiResponse({ status: 200, type: ProviderResponseDto })
  async updateProvider(
    @Param("id") providerId: string,
    @Body() dto: UpdateProviderDto,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<ProviderResponseDto> {
    try {
      return await this.providersService.updateProvider(
        providerId,
        dto,
        user.restaurantId,
        user.userId,
      );
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new HttpException(
        error.message || "Failed to update provider",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete(":id")
  @ApiOperation({ summary: "Soft delete provider" })
  @ApiResponse({ status: 200, description: "Provider deleted" })
  async deleteProvider(
    @Param("id") providerId: string,
    @CurrentUser() user: { id: string; restaurantId: string },
  ): Promise<{ success: boolean }> {
    try {
      await this.providersService.softDeleteProvider(
        providerId,
        user.restaurantId,
        user.id,
      );
      return { success: true };
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to delete provider",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // =========================================================================
  // PROVIDER SUB-RESOURCES
  // =========================================================================

  @Get(":id/orders")
  @ApiOperation({ summary: "Provider order history" })
  @ApiResponse({ status: 200, description: "Returns provider orders" })
  async getProviderOrders(@Param("id") providerId: string) {
    try {
      return await this.providersService.getProviderOrders(providerId);
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to fetch provider orders",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(":id/performance")
  @ApiOperation({ summary: "Provider performance metrics" })
  @ApiResponse({
    status: 200,
    description: "Returns provider performance metrics",
  })
  async getProviderPerformance(@Param("id") providerId: string) {
    try {
      return await this.providersService.getProviderPerformance(providerId);
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to fetch provider performance",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post(":id/rate")
  @ApiOperation({ summary: "Rate provider" })
  @ApiResponse({ status: 201, description: "Provider rated" })
  async rateProvider(
    @Param("id") providerId: string,
    @Body() dto: ProviderRatingDto,
    @CurrentUser() user: { restaurantId: string },
  ): Promise<{ success: boolean }> {
    try {
      await this.providersService.rateProvider(
        user.restaurantId,
        providerId,
        dto,
      );
      return { success: true };
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to rate provider",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // =========================================================================
  // CONTACTS
  // =========================================================================

  @Get(":id/contacts")
  @ApiOperation({ summary: "Get provider contacts" })
  @ApiResponse({ status: 200, type: [ProviderContactResponseDto] })
  async getProviderContacts(
    @Param("id") providerId: string,
  ): Promise<ProviderContactResponseDto[]> {
    try {
      return await this.providersService.getProviderContacts(providerId);
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to fetch provider contacts",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post(":id/contacts")
  @ApiOperation({ summary: "Add contact to provider" })
  @ApiResponse({ status: 201, type: ProviderContactResponseDto })
  async addProviderContact(
    @Param("id") providerId: string,
    @Body() dto: CreateProviderContactDto,
  ): Promise<ProviderContactResponseDto> {
    try {
      return await this.providersService.addProviderContact(providerId, dto);
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to add provider contact",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Patch(":id/contacts/:contactId")
  @ApiOperation({ summary: "Update provider contact" })
  @ApiResponse({ status: 200, type: ProviderContactResponseDto })
  async updateProviderContact(
    @Param("id") providerId: string,
    @Param("contactId") contactId: string,
    @Body() dto: UpdateProviderContactDto,
  ): Promise<ProviderContactResponseDto> {
    try {
      return await this.providersService.updateProviderContact(
        providerId,
        contactId,
        dto,
      );
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to update provider contact",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete(":id/contacts/:contactId")
  @ApiOperation({ summary: "Delete provider contact" })
  @ApiResponse({ status: 200, description: "Contact deleted" })
  async deleteProviderContact(
    @Param("id") providerId: string,
    @Param("contactId") contactId: string,
  ): Promise<{ success: boolean }> {
    try {
      await this.providersService.deleteProviderContact(providerId, contactId);
      return { success: true };
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to delete provider contact",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // =========================================================================
  // CONTACT DATE
  // =========================================================================

  @Patch(":id/contact-date")
  @ApiOperation({ summary: "Update last contact date" })
  @ApiResponse({ status: 200, type: ProviderResponseDto })
  async updateContactDate(
    @Param("id") providerId: string,
    @Body() dto: UpdateContactDateDto,
    @CurrentUser() user: { id: string; restaurantId: string },
  ): Promise<ProviderResponseDto> {
    try {
      return await this.providersService.updateLastContactDate(
        providerId,
        dto,
        user.restaurantId,
      );
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to update contact date",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // =========================================================================
  // RECOMMENDATIONS (per-provider, alternative route)
  // =========================================================================

  @Get(":id/recommendations")
  @ApiOperation({ summary: "AI-powered provider recommendations" })
  @ApiQuery({ name: "restaurantId", required: false })
  @ApiQuery({ name: "wineId", required: false })
  @ApiResponse({ status: 200, description: "Provider recommendations" })
  async getProviderRecommendations(
    @Param("id") _providerId: string,
    @Query("restaurantId") restaurantId?: string,
    @Query("wineId") wineId?: string,
  ) {
    try {
      return await this.providersService.getRecommendations(
        restaurantId ?? "",
        wineId,
      );
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to get recommendations",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // =========================================================================
  // PHASE 32: INTELLIGENCE PROFILE (D-32-11 / PROVINT-02)
  // =========================================================================

  @Get(":id/intelligence")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: "Get provider intelligence profile (foundational + dynamic)",
  })
  @ApiResponse({
    status: 200,
    description: "Returns profile_foundational + profile_dynamic",
  })
  async getIntelligence(
    @Param("id") providerId: string,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<{
    profile_foundational: Record<string, any>;
    profile_dynamic: Record<string, any>;
  }> {
    try {
      return await this.providersService.getIntelligence(
        providerId,
        user.restaurantId,
      );
    } catch (error: any) {
      throw new HttpException(
        error.message || "Failed to get intelligence",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Patch(":id/intelligence")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: "Update provider foundational intelligence profile",
  })
  @ApiResponse({ status: 200 })
  async updateIntelligence(
    @Param("id") providerId: string,
    @Body() dto: UpdateIntelligenceDto,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<{ success: boolean }> {
    try {
      return await this.providersService.updateIntelligence(
        providerId,
        user.restaurantId,
        dto,
      );
    } catch (error: any) {
      throw new HttpException(
        error.message || "Failed to update intelligence",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(":id/intelligence/summary")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: "Get top 3 intelligence badge pill dimensions for provider card",
  })
  @ApiResponse({ status: 200 })
  async getIntelligenceSummary(
    @Param("id") providerId: string,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<Array<{ key: string; label: string; value: string }>> {
    try {
      const intel = await this.providersService.getIntelligence(
        providerId,
        user.restaurantId,
      );
      return this.providersService.getProfileSummary(intel.profile_dynamic);
    } catch (error: any) {
      throw new HttpException(
        error.message || "Failed to get intelligence summary",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // =========================================================================
  // PROVIDER LOCATIONS
  // =========================================================================

  @Get(":id/locations")
  @ApiOperation({ summary: "Get provider locations" })
  async getProviderLocations(
    @Param("id") providerId: string,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ) {
    try {
      return await this.providersService.getProviderLocations(
        providerId,
        user.restaurantId,
      );
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to fetch provider locations",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post(":id/locations")
  @ApiOperation({ summary: "Add a location to a provider" })
  async createProviderLocation(
    @Param("id") providerId: string,
    @Body() dto: CreateProviderLocationDto,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ) {
    try {
      return await this.providersService.createProviderLocation(
        providerId,
        user.restaurantId,
        dto,
      );
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to create provider location",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Patch(":id/locations/:locationId")
  @ApiOperation({ summary: "Update a provider location" })
  async updateProviderLocation(
    @Param("id") providerId: string,
    @Param("locationId") locationId: string,
    @Body() dto: UpdateProviderLocationDto,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ) {
    try {
      return await this.providersService.updateProviderLocation(
        providerId,
        locationId,
        user.restaurantId,
        dto,
      );
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to update provider location",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete(":id/locations/:locationId")
  @ApiOperation({ summary: "Remove a provider location" })
  async deleteProviderLocation(
    @Param("id") providerId: string,
    @Param("locationId") locationId: string,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ) {
    try {
      await this.providersService.deleteProviderLocation(
        providerId,
        locationId,
        user.restaurantId,
      );
      return { success: true };
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to delete provider location",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post(":id/retroactive-order")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary:
      "Create retroactive order from off-app invoice (D-32-15 Scenario C)",
  })
  @ApiResponse({ status: 201, description: "Retroactive order created" })
  @ApiResponse({
    status: 400,
    description:
      "The invoice cannot be booked as stated — an unreadable unit, or a case " +
      "quantity with no pack size, so the invoice total cannot be spread across bottles",
  })
  async createRetroactiveOrder(
    @Param("id") providerId: string,
    @Body() dto: RetroactiveOrderDto,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<{
    orderId: string;
    orderNumber: string;
    conversationId: string;
  }> {
    try {
      return await this.providersService.createRetroactiveOrder(
        providerId,
        user.restaurantId,
        user.userId,
        dto,
      );
    } catch (error: any) {
      // A refusal is not a server error. `createOrder` throws
      // BadRequestException for an unresolvable unit and ForbiddenException
      // when the restaurant has no active vendors; collapsing both to 500 threw
      // away the sentence telling the operator what to fix.
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error.message || "Failed to create retroactive order",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
