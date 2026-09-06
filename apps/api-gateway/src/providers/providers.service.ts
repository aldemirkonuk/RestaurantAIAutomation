import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { EventsService } from "../events/events.service";
import { EventType, SourcePage } from "../events/dto/event.dto";
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
import { ProcurementService } from "../procurement/procurement.service";
import { resolveOrderUnits } from "../procurement/order-units";

function normalizeToE164(phone: string | null | undefined): string | null {
  if (!phone) return null;
  if (phone.startsWith("+")) return phone;
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return phone;
}

/** One row from the match_restaurant_providers RPC. */
export interface ProviderMatchCandidate {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  catalogue_vendor_id: string | null;
  is_custom: boolean;
  name_similarity: number;
  address_similarity: number | null;
}

interface ProviderRow {
  id: string;
  name: string;
  company_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  contact_first_name: string | null;
  contact_last_name: string | null;
  address: string | null;
  website: string | null;
  rating: number | null;
  personality_notes: string | null;
  primary_contact: Record<string, any> | null;
  specialties: string[] | null;
  regions_covered: string[] | null;
  minimum_order: number | null;
  lead_time_days: number | null;
  reliability_score: number | null;
  tier: string | null;
  is_active: boolean | null;
  deleted_at: string | null;
  payment_terms: string | null;
  vendor_type: string | null;
  known_personnel: string[] | null;
}

@Injectable()
export class ProvidersService {
  private readonly logger = new Logger(ProvidersService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly eventsService: EventsService,
    // Required, not @Optional(). `createRetroactiveOrder` is the one path here
    // that writes a procurement order, and it must go through the same method
    // every other order does — an optional dependency that silently resolves to
    // undefined would put this endpoint straight back to hand-rolling an insert.
    private readonly procurementService: ProcurementService,
  ) {}

  async createProvider(
    dto: CreateProviderDto,
    restaurantId?: string,
    userId?: string,
  ): Promise<ProviderResponseDto> {
    let payload: Record<string, any>;

    if (dto.catalogue_vendor_id) {
      // Mode A: from catalogue — fetch vendor details and auto-fill
      const { data: vendor, error: vendorError } =
        await this.databaseService.supabase
          .from("vendor_catalogue")
          .select("*")
          .eq("id", dto.catalogue_vendor_id)
          .eq("is_active", true)
          .single();

      if (vendorError || !vendor) {
        throw new NotFoundException(
          `Vendor catalogue entry not found: ${dto.catalogue_vendor_id}`,
        );
      }

      // Same catalogue vendor, same restaurant, twice = an unambiguous
      // duplicate, so this is a hard guard rather than the advisory
      // similarity check the add-provider form does. Nothing in the UI
      // prevented clicking "Add to My Providers" on a vendor already in the
      // list; the two rows would then be indistinguishable except by id, and
      // every later "which of these is the real Breakthru?" question — orders,
      // invoices, conversations — becomes ambiguous.
      if (restaurantId) {
        const { data: alreadyLinked, error: dupeCheckError } =
          await this.databaseService.supabase
            .from("providers")
            .select("id, name")
            .eq("restaurant_id", restaurantId)
            .eq("catalogue_vendor_id", dto.catalogue_vendor_id)
            .is("deleted_at", null)
            .maybeSingle();

        // The error used to be discarded, and that made this guard FAIL OPEN.
        // `maybeSingle()` returns `data: null` for BOTH "no row matched" and
        // "the query failed" — supabase-js resolves with `{ data, error }`
        // rather than throwing — so a failed lookup read as "no duplicate
        // exists" and the insert below proceeded. A guard that cannot check
        // must refuse, never wave through: the whole point of this one is that
        // two rows for the same vendor make every later "which of these is the
        // real Breakthru?" question ambiguous, and that is exactly the state a
        // silent failure would create.
        if (dupeCheckError) {
          throw new ServiceUnavailableException(
            "Could not verify whether this vendor is already in your providers. " +
              "Nothing was added — please try again.",
          );
        }

        if (alreadyLinked) {
          throw new ConflictException(
            `${alreadyLinked.name} is already in your providers`,
          );
        }
      }

      // Build notes from catalogue type + website + specialties
      const noteParts: string[] = [];
      if (vendor.type) noteParts.push(`Type: ${vendor.type}`);
      if (vendor.website) noteParts.push(`Website: ${vendor.website}`);
      if (vendor.wine_specialties)
        noteParts.push(`Specialties: ${vendor.wine_specialties}`);
      const catalogueNotes =
        noteParts.length > 0 ? noteParts.join(" | ") : null;

      payload = {
        name: vendor.name,
        contact_phone: normalizeToE164(vendor.phone),
        contact_email: vendor.email ?? null,
        address: vendor.address ?? null,
        personality_notes: catalogueNotes,
        primary_contact: {},
        catalogue_vendor_id: dto.catalogue_vendor_id,
        is_custom: false,
        restaurant_id: restaurantId ?? null,
      };
    } else {
      // Mode B: custom provider — requires name
      if (!dto.name) {
        throw new BadRequestException(
          "name is required when catalogue_vendor_id is not provided",
        );
      }

      payload = {
        name: dto.name,
        company_name: dto.companyName ?? null,
        primary_contact: dto.primaryContact ?? {},
        alternative_contacts: dto.alternativeContacts ?? null,
        // physicalAddress is the plain string the user typed; dto.address is a
        // legacy JSONB object ({ line1: … }) that older clients still send
        // alongside it. Preferring the object here was the create/update split
        // that made a freshly-added provider read back an OBJECT from this
        // jsonb column while an edited one read back a string — the "address
        // is not saved" bug. Update already prefers physicalAddress; create
        // now agrees with it.
        address: dto.physicalAddress ?? dto.address ?? null,
        specialties: dto.specialties ?? null,
        regions_covered: dto.regionsCovered ?? null,
        minimum_order: dto.minimumOrder ?? null,
        lead_time_days: dto.leadTimeDays ?? null,
        tier: dto.tier ?? null,
        personality_notes: dto.notes ?? null,
        contact_phone: normalizeToE164(dto.phone),
        contact_email: dto.email ?? null,
        contact_first_name: dto.contactFirstName ?? null,
        contact_last_name: dto.contactLastName ?? null,
        catalogue_vendor_id: null,
        is_custom: true,
        restaurant_id: restaurantId ?? null,
      };
    }

    const { data, error } = await this.databaseService.supabase
      .from("providers")
      .insert(payload)
      .select("*")
      .single();

    if (error) {
      this.logger.error("Failed to create provider", { error: error.message });
      throw error;
    }

    const provider = this.mapProviderRow(data as ProviderRow);

    // Mark vendor_added=true in onboarding progress (fire-and-forget)
    if (restaurantId) {
      this.databaseService.supabase
        .from("user_onboarding_progress")
        .update({ vendor_added: true })
        .eq("restaurant_id", restaurantId)
        .then(({ error: onboardingErr }) => {
          if (onboardingErr)
            this.logger.warn(
              `onboarding progress vendor_added update failed (non-fatal): ${onboardingErr.message}`,
            );
        });
    }

    // Emit provider_change event for cross-page sync
    if (restaurantId && userId) {
      try {
        await this.eventsService.createEvent(restaurantId, userId, {
          eventType: EventType.PROVIDER_CHANGE,
          sourcePage: SourcePage.PROVIDERS,
          payload: {
            type: "added",
            providerId: provider.id,
            providerName: provider.name,
            data: {
              companyName: provider.companyName,
              specialties: provider.specialties,
              tier: provider.tier,
            },
          },
        });
        this.logger.log("Provider change event emitted", {
          providerId: provider.id,
          type: "added",
        });
      } catch (eventError) {
        this.logger.warn("Failed to emit provider change event", {
          error: eventError.message,
        });
        // Don't fail the operation if event emission fails
      }
    }

    return provider;
  }

  async listProviders(restaurantId: string): Promise<ProviderResponseDto[]> {
    const { data, error } = await this.databaseService.supabase
      .from("providers")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    if (error) {
      this.logger.error("Failed to list providers", { error: error.message });
      throw error;
    }

    const providers = (data || []).map((row) =>
      this.mapProviderRow(row as ProviderRow),
    );

    // Attach coordinates from each provider's geocoded location so callers can
    // map them without a second round trip per provider. Best-effort: a
    // provider with no geocoded site simply has no coordinates, which is a
    // meaningful state (it cannot be plotted) rather than an error.
    try {
      const { data: locs } = await this.databaseService.supabase
        .from("provider_locations")
        .select("provider_id, latitude, longitude, is_primary")
        .eq("restaurant_id", restaurantId)
        .not("latitude", "is", null);

      if (locs?.length) {
        // Primary wins; otherwise the first geocoded site. A provider with a
        // geocoded warehouse but an ungeocoded head office should still appear.
        const byProvider = new Map<string, any>();
        for (const l of locs as any[]) {
          const existing = byProvider.get(l.provider_id);
          if (!existing || (l.is_primary && !existing.is_primary)) {
            byProvider.set(l.provider_id, l);
          }
        }
        for (const p of providers as any[]) {
          const l = byProvider.get(p.id);
          if (l) {
            p.latitude = Number(l.latitude);
            p.longitude = Number(l.longitude);
          }
        }
      }
    } catch (err: any) {
      this.logger.warn(
        `Could not attach provider coordinates: ${err?.message ?? "unknown"}`,
      );
    }

    return providers;
  }

  /**
   * Duplicate-detection candidates within this restaurant's own provider list.
   *
   * The local counterpart to VendorCatalogueService.match: that one answers
   * "is this already a verified catalogue vendor?", this one answers "do you
   * already have this supplier yourself?". Both are needed — a restaurant can
   * duplicate a vendor that was never in the catalogue at all.
   *
   * excludeId is what makes this usable from the edit screen: without it the
   * row being renamed matches itself at 1.0 and every rename looks like a
   * duplicate.
   */
  async matchProviders(
    restaurantId: string,
    params: {
      name?: string;
      address?: string;
      excludeId?: string;
      limit?: number;
    },
  ): Promise<ProviderMatchCandidate[]> {
    const name = params.name?.trim();
    const address = params.address?.trim();
    if (!restaurantId || (!name && !address)) return [];

    const { data, error } = await this.databaseService.supabase.rpc(
      "match_restaurant_providers",
      {
        p_restaurant_id: restaurantId,
        p_name: name || "",
        p_address: address || null,
        p_exclude_id: params.excludeId || null,
        p_limit: params.limit ?? 5,
      },
    );

    if (error) {
      this.logger.warn(`Provider match RPC failed: ${error.message}`);
      // Advisory only — never block the form it is attached to.
      return [];
    }

    return (data ?? []) as ProviderMatchCandidate[];
  }

  async getProvider(
    providerId: string,
    restaurantId: string,
  ): Promise<ProviderResponseDto> {
    const { data, error } = await this.databaseService.supabase
      .from("providers")
      .select("*")
      .eq("id", providerId)
      .eq("restaurant_id", restaurantId)
      .single();

    if (error) {
      this.logger.error("Failed to fetch provider", {
        providerId,
        error: error.message,
      });
      throw error;
    }

    return this.mapProviderRow(data as ProviderRow);
  }

  async updateProvider(
    providerId: string,
    dto: UpdateProviderDto,
    restaurantId?: string,
    userId?: string,
  ): Promise<ProviderResponseDto> {
    const updatePayload: Record<string, any> = {
      name: dto.name ?? undefined,
      company_name: dto.companyName ?? undefined,
      contact_phone: dto.phone != null ? normalizeToE164(dto.phone) : undefined,
      contact_email: dto.email ?? undefined,
      contact_first_name: dto.contactFirstName ?? undefined,
      contact_last_name: dto.contactLastName ?? undefined,
      website: dto.website ?? undefined,
      rating: dto.rating ?? undefined,
      personality_notes: dto.notes ?? undefined,
      primary_contact: dto.primaryContact ?? undefined,
      alternative_contacts: dto.alternativeContacts ?? undefined,
      // physicalAddress is always a plain string; dto.address is a legacy JSONB
      // object that cannot be stored in the TEXT address column — never fall
      // back to the object shape here.
      address: dto.physicalAddress ?? undefined,
      specialties: dto.specialties ?? undefined,
      regions_covered: dto.regionsCovered ?? undefined,
      minimum_order: dto.minimumOrder ?? undefined,
      lead_time_days: dto.leadTimeDays ?? undefined,
      tier: dto.tier ?? undefined,
      is_active: dto.isActive ?? undefined,
      payment_terms: dto.paymentTerms ?? undefined,
      vendor_type: (dto as any).primaryBusinessType ?? undefined,
      known_personnel: (dto as any).knownPersonnel ?? undefined,
    };
    // Remove undefined keys so Supabase doesn't null-out untouched columns
    Object.keys(updatePayload).forEach(
      (k) => updatePayload[k] === undefined && delete updatePayload[k],
    );

    // Build the query; only apply the restaurant_id guard when we actually have
    // a non-empty restaurantId — passing '' would match no UUID rows and cause
    // .single() to throw PGRST116 even when the provider exists.
    let updateQuery = this.databaseService.supabase
      .from("providers")
      .update(updatePayload)
      .eq("id", providerId);

    if (restaurantId) {
      updateQuery = updateQuery.eq("restaurant_id", restaurantId);
    }

    const { data, error } = await updateQuery.select("*").maybeSingle();

    if (error) {
      this.logger.error("Failed to update provider", {
        providerId,
        error: error.message,
      });
      throw error;
    }

    if (!data) {
      this.logger.warn("Provider not found for update", {
        providerId,
        restaurantId,
      });
      throw new NotFoundException(`Provider ${providerId} not found`);
    }

    const provider = this.mapProviderRow(data as ProviderRow);

    // Emit provider_change event for cross-page sync
    if (restaurantId && userId) {
      try {
        await this.eventsService.createEvent(restaurantId, userId, {
          eventType: EventType.PROVIDER_CHANGE,
          sourcePage: SourcePage.PROVIDERS,
          payload: {
            type: "updated",
            providerId: provider.id,
            providerName: provider.name,
            data: {
              companyName: provider.companyName,
              specialties: provider.specialties,
              tier: provider.tier,
              isActive: provider.isActive,
            },
          },
        });
        this.logger.log("Provider change event emitted", {
          providerId: provider.id,
          type: "updated",
        });
      } catch (eventError) {
        this.logger.warn("Failed to emit provider change event", {
          error: eventError.message,
        });
      }
    }

    return provider;
  }

  async softDeleteProvider(
    providerId: string,
    restaurantId?: string,
    userId?: string,
  ): Promise<void> {
    // First get the provider name for the event
    const { data: existingProvider } = await this.databaseService.supabase
      .from("providers")
      .select("name")
      .eq("id", providerId)
      .eq("restaurant_id", restaurantId ?? "")
      .single();

    const { error } = await this.databaseService.supabase
      .from("providers")
      .update({
        is_active: false,
        deleted_at: new Date().toISOString(),
      })
      .eq("id", providerId)
      .eq("restaurant_id", restaurantId ?? "");

    if (error) {
      this.logger.error("Failed to delete provider", {
        providerId,
        error: error.message,
      });
      throw error;
    }

    // Emit provider_change event for cross-page sync
    if (restaurantId && userId) {
      try {
        await this.eventsService.createEvent(restaurantId, userId, {
          eventType: EventType.PROVIDER_CHANGE,
          sourcePage: SourcePage.PROVIDERS,
          payload: {
            type: "removed",
            providerId,
            providerName: existingProvider?.name || "Unknown",
          },
        });
        this.logger.log("Provider change event emitted", {
          providerId,
          type: "removed",
        });
      } catch (eventError) {
        this.logger.warn("Failed to emit provider change event", {
          error: eventError.message,
        });
      }
    }
  }

  async getProviderOrders(providerId: string) {
    const { data, error } = await this.databaseService.supabase
      .from("procurement_orders")
      .select("*")
      .eq("provider_id", providerId)
      .order("created_at", { ascending: false });

    if (error) {
      if (
        error.code === "PGRST116" ||
        error.message?.includes("does not exist") ||
        error.message?.includes("relation") ||
        (error as any).code === "42P01"
      ) {
        this.logger.warn(
          "procurement_orders table not available yet, returning empty array",
          {
            providerId,
            errorCode: error.code,
          },
        );
        return [];
      }
      this.logger.error("Failed to fetch provider orders", {
        providerId,
        error: error.message,
      });
      throw error;
    }

    return data ?? [];
  }

  async getProviderPerformance(providerId: string) {
    const { data, error } = await this.databaseService.supabase
      .from("provider_performance_metrics")
      .select("*")
      .eq("provider_id", providerId)
      .order("calculated_at", { ascending: false })
      .limit(1)
      .single();

    if (error) {
      return null;
    }

    return data;
  }

  async rateProvider(
    restaurantId: string,
    providerId: string,
    dto: ProviderRatingDto,
  ): Promise<void> {
    const payload = {
      provider_id: providerId,
      restaurant_id: restaurantId,
      order_id: dto.orderId ?? null,
      rating: dto.rating,
      categories: dto.categories ?? null,
      comment: dto.comment ?? null,
    };

    const { error } = await this.databaseService.supabase
      .from("provider_ratings")
      .insert(payload);

    if (error) {
      this.logger.error("Failed to rate provider", {
        providerId,
        error: error.message,
      });
      throw error;
    }
  }

  // =========================================================================
  // CONTACTS
  // =========================================================================

  async getProviderContacts(
    providerId: string,
  ): Promise<ProviderContactResponseDto[]> {
    const { data, error } = await this.databaseService.supabase
      .from("provider_contacts")
      .select("*")
      .eq("provider_id", providerId)
      .order("is_primary", { ascending: false })
      .order("name");

    if (error) {
      this.logger.error("Failed to fetch provider contacts", {
        providerId,
        error: error.message,
      });
      throw error;
    }

    return (data || []).map((row) => this.mapContactRow(row));
  }

  async addProviderContact(
    providerId: string,
    dto: CreateProviderContactDto,
  ): Promise<ProviderContactResponseDto> {
    // Demote any existing primary contact before inserting a new primary
    if (dto.isPrimary) {
      await this.databaseService.supabase
        .from("provider_contacts")
        .update({ is_primary: false })
        .eq("provider_id", providerId)
        .eq("is_primary", true);
    }

    const payload = {
      provider_id: providerId,
      name: dto.name,
      email: dto.email ?? null,
      phone: dto.phone ?? null,
      role: dto.role ?? null,
      is_primary: dto.isPrimary ?? false,
    };

    const { data, error } = await this.databaseService.supabase
      .from("provider_contacts")
      .insert(payload)
      .select("*")
      .single();

    if (error) {
      this.logger.error("Failed to add provider contact", {
        providerId,
        error: error.message,
      });
      throw error;
    }

    return this.mapContactRow(data);
  }

  async updateProviderContact(
    providerId: string,
    contactId: string,
    dto: UpdateProviderContactDto,
  ): Promise<ProviderContactResponseDto> {
    const updatePayload: Record<string, any> = {};
    if (dto.name !== undefined) updatePayload.name = dto.name;
    if (dto.email !== undefined) updatePayload.email = dto.email;
    if (dto.phone !== undefined) updatePayload.phone = dto.phone;
    if (dto.role !== undefined) updatePayload.role = dto.role;
    if (dto.isPrimary !== undefined) updatePayload.is_primary = dto.isPrimary;

    const { data, error } = await this.databaseService.supabase
      .from("provider_contacts")
      .update(updatePayload)
      .eq("id", contactId)
      .eq("provider_id", providerId)
      .select("*")
      .single();

    if (error) {
      this.logger.error("Failed to update provider contact", {
        contactId,
        error: error.message,
      });
      throw error;
    }

    return this.mapContactRow(data);
  }

  async deleteProviderContact(
    providerId: string,
    contactId: string,
  ): Promise<void> {
    const { error } = await this.databaseService.supabase
      .from("provider_contacts")
      .delete()
      .eq("id", contactId)
      .eq("provider_id", providerId);

    if (error) {
      this.logger.error("Failed to delete provider contact", {
        contactId,
        error: error.message,
      });
      throw error;
    }
  }

  // =========================================================================
  // SEARCH
  // =========================================================================

  async searchProviders(params: {
    q?: string;
    restaurantId: string;
    specialties?: string[];
    isActive?: boolean;
    wineType?: string;
  }): Promise<ProviderResponseDto[]> {
    let query = this.databaseService.supabase
      .from("providers")
      .select("*")
      .eq("restaurant_id", params.restaurantId)
      .is("deleted_at", null);

    if (params.isActive !== undefined) {
      query = query.eq("is_active", params.isActive);
    }

    if (params.q) {
      // Sanitize user input: strip characters meaningful to PostgREST filter syntax
      // (comma, parentheses, period) to prevent filter-injection via the .or() string.
      const safeQ = params.q.replace(/[,().]/g, "");
      query = query.or(
        `name.ilike.%${safeQ}%,company_name.ilike.%${safeQ}%,contact_name.ilike.%${safeQ}%`,
      );
    }

    if (params.specialties?.length) {
      query = query.overlaps("specialties", params.specialties);
    }

    if (params.wineType) {
      query = query.contains("specialties", [params.wineType]);
    }

    const { data, error } = await query.order("name");

    if (error) {
      this.logger.error("Failed to search providers", { error: error.message });
      throw error;
    }

    return (data || []).map((row) => this.mapProviderRow(row as ProviderRow));
  }

  // =========================================================================
  // RECOMMENDATIONS (stub)
  // =========================================================================

  async getRecommendations(
    restaurantId: string,
    wineId?: string,
  ): Promise<{ primary: any | null; alternatives: any[] }> {
    let query = this.databaseService.supabase
      .from("providers")
      .select("*")
      .is("deleted_at", null)
      .eq("is_active", true)
      .order("reliability_score", { ascending: false })
      .limit(5);

    if (restaurantId) {
      query = query.eq("restaurant_id", restaurantId);
    }

    const { data, error } = await query;

    if (error) {
      this.logger.error("Failed to fetch recommendations", {
        error: error.message,
      });
      throw error;
    }

    const providers = (data || []).map((row) =>
      this.mapProviderRow(row as ProviderRow),
    );
    return {
      primary: providers[0] ?? null,
      alternatives: providers.slice(1),
    };
  }

  // =========================================================================
  // LAST CONTACT DATE
  // =========================================================================

  async updateLastContactDate(
    providerId: string,
    dto: UpdateContactDateDto,
    restaurantId: string,
  ): Promise<ProviderResponseDto> {
    const { data, error } = await this.databaseService.supabase
      .from("providers")
      .update({
        last_contact_date: dto.lastContactDate,
        last_contact_notes: dto.notes ?? null,
      })
      .eq("id", providerId)
      .eq("restaurant_id", restaurantId)
      .select("*")
      .single();

    if (error) {
      this.logger.error("Failed to update last contact date", {
        providerId,
        error: error.message,
      });
      throw error;
    }

    return this.mapProviderRow(data as ProviderRow);
  }

  // =========================================================================
  // BULK IMPORT
  // =========================================================================

  async bulkImportProviders(
    dto: BulkImportProvidersDto,
  ): Promise<BulkImportResultDto> {
    let imported = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const providerDto of dto.providers) {
      try {
        await this.createProvider(providerDto);
        imported++;
      } catch (err: any) {
        failed++;
        errors.push(`${providerDto.name}: ${err.message || "Unknown error"}`);
      }
    }

    this.logger.log("Bulk import completed", { imported, failed });
    return { imported, failed, errors };
  }

  // =========================================================================
  // PHASE 32: INTELLIGENCE (profile_foundational + profile_dynamic)
  // =========================================================================

  async getIntelligence(
    providerId: string,
    restaurantId: string,
  ): Promise<{
    profile_foundational: Record<string, any>;
    profile_dynamic: Record<string, any>;
  }> {
    const { data, error } = await this.databaseService.supabase
      .from("providers")
      .select("profile_foundational, profile_dynamic")
      .eq("id", providerId)
      .eq("restaurant_id", restaurantId)
      .single();

    if (error) {
      this.logger.error("getIntelligence failed", {
        providerId,
        error: error.message,
      });
      throw error;
    }

    return {
      profile_foundational: (data as any).profile_foundational ?? {},
      profile_dynamic: (data as any).profile_dynamic ?? {},
    };
  }

  async updateIntelligence(
    providerId: string,
    restaurantId: string,
    dto: UpdateIntelligenceDto,
  ): Promise<{ success: boolean }> {
    const updatePayload: Record<string, any> = {};
    if (dto.profile_foundational !== undefined) {
      updatePayload.profile_foundational = dto.profile_foundational;
    }
    if (dto.profile_dynamic !== undefined) {
      updatePayload.profile_dynamic = dto.profile_dynamic;
    }

    const { error } = await this.databaseService.supabase
      .from("providers")
      .update(updatePayload)
      .eq("id", providerId)
      .eq("restaurant_id", restaurantId);

    if (error) {
      this.logger.error("updateIntelligence failed", {
        providerId,
        error: error.message,
      });
      throw error;
    }

    return { success: true };
  }

  getProfileSummary(
    profileDynamic: Record<string, any>,
  ): Array<{ key: string; label: string; value: string }> {
    const priorityKeys = [
      "response_speed",
      "negotiation_style",
      "relationship_tier",
    ];
    return priorityKeys
      .filter((k) => profileDynamic[k])
      .map((k) => ({
        key: k,
        label: k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        value: String(profileDynamic[k]).slice(0, 20),
      }))
      .slice(0, 3);
  }

  /**
   * D-32-15 Scenario C: record an off-app invoice as a delivered order.
   *
   * WHAT THIS USED TO DO, AND WHY IT COULD NEVER HAVE WORKED
   *
   * It hand-rolled an insert into `procurement_orders` that named two columns
   * the table does not have (`wine_name`, `actual_delivery` — confirmed absent
   * in production 2026-09-01) and omitted five that are NOT NULL
   * (`order_number`, `inventory_id`, `bottles_total`, `final_price`,
   * `total_cost`). Every call has failed at the first statement since the
   * endpoint was written; the two follow-on inserts have never once run, which
   * is why nobody noticed that they were broken too:
   *
   *   - `procurement_conversations.message_text` is NOT NULL and was not written.
   *   - `order_interactions` has no `channel` and no `content` column, its
   *     `interaction_type` is CHECK-constrained to VOICE|SMS|EMAIL|WHATSAPP
   *     (so the literal `"invoice_received"` raises 23514), and its
   *     `interaction_direction` is NOT NULL and was not written.
   *
   * WHAT IT DOES NOW
   *
   * It calls `ProcurementService.createOrder` with
   * `provenance.alreadyFulfilled`, which is the only path in this codebase that
   * satisfies every NOT NULL column, generates an `order_number`, resolves the
   * wine's `master_wine_id`, does the pack-size arithmetic, and writes the
   * `procurement_order_items` line an arriving invoice can be matched against.
   * Duplicating that here is what produced the two divergent copies of this
   * method in the first place.
   *
   * The `order_interactions` write is GONE rather than repaired. The table has
   * zero rows, zero other writers anywhere in the repository, and no column for
   * a message body — the invoice text has a home in
   * `procurement_conversations`, which is where every other email path in this
   * service already puts it. A second, body-less row recording the same event
   * in a table nothing reads adds no information and one more thing to drift.
   * `interactionId` therefore leaves the response; no client can be relying on
   * it, because no call has ever returned one.
   */
  async createRetroactiveOrder(
    providerId: string,
    restaurantId: string,
    userId: string,
    dto: RetroactiveOrderDto,
  ): Promise<{
    orderId: string;
    orderNumber: string;
    conversationId: string;
  }> {
    // Pack size first: it decides how many bottles the invoice total is spread
    // across, and `createOrder` refuses a case order that does not state one.
    // Resolving it here rather than after the order exists means an invoice we
    // cannot price is refused before anything is written.
    const units = resolveOrderUnits({
      quantity: dto.quantity,
      unitType: dto.unitType,
      bottlesPerUnit: dto.bottlesPerUnit,
    });
    if (!units.ok) {
      throw new BadRequestException({
        reason: units.reason,
        message: units.message,
      });
    }

    // `final_price` on this table is PER BOTTLE — `confirmDeal` emails the
    // vendor "$X per bottle" out of the same column. The invoice states a
    // TOTAL. Dividing here is the whole reason `invoiceTotal` replaced the old
    // `finalConfirmedCost`, which was documented as a total and written to a
    // per-bottle column: a $600 case invoice became $600/bottle, $7,200.
    //
    // An opaque unit (keg, litre) has no bottle count, so `bottlesTotal` is a
    // count of kegs and the division yields a per-keg price. That is the honest
    // answer available and it is what the column will hold; nothing here can
    // invent a bottle equivalence a receiver would accept.
    const unitPrice =
      Math.round((dto.invoiceTotal / units.bottlesTotal) * 100) / 100;

    const order = await this.procurementService.createOrder(
      restaurantId,
      userId,
      {
        inventoryId: dto.inventoryId,
        providerId,
        quantity: dto.quantity,
        unitType: dto.unitType,
        bottlesPerUnit: dto.bottlesPerUnit,
        vendorSku: dto.vendorSku,
        finalPrice: unitPrice,
        // The exact invoice total, not `unitPrice * bottlesTotal`. Passing the
        // derived product would let a half-cent rounding difference become the
        // number the books are kept on.
        totalCost: dto.invoiceTotal,
        managerNotes: dto.invoiceNumber
          ? `Off-app invoice ${dto.invoiceNumber}`
          : "Off-app invoice entered retroactively",
      },
      {
        source: "retroactive",
        alreadyFulfilled: {
          deliveredAt: dto.invoiceDate ?? null,
          invoiceTotal: dto.invoiceTotal,
        },
      },
    );

    // The invoice text, on the thread for this order. Best-effort: the delivery
    // is a fact once the order row exists, and losing the audit copy of the
    // email body is not a reason to fail it back to the operator.
    const summary = `Retroactive order from off-app invoice ${dto.invoiceNumber ?? "(no number)"}.`;
    const { data: convData, error: convError } =
      await this.databaseService.supabase
        .from("procurement_conversations")
        .insert({
          order_id: order.id,
          provider_id: providerId,
          restaurant_id: restaurantId,
          direction: "INBOUND",
          channel: "email",
          // NOT NULL, and the previous version did not write it. `content` is
          // the newer nullable column every recent path also fills; both are
          // set so neither reader sees an empty thread.
          message_text: dto.rawInvoiceContent || summary,
          content: dto.rawInvoiceContent ?? null,
          status: "DELIVERED",
          received_at: dto.invoiceDate ?? new Date().toISOString(),
          conversation_summary: summary,
          order_number_snapshot: order.orderNumber ?? null,
        })
        .select("id")
        .single();

    if (convError) {
      this.logger.warn("createRetroactiveOrder: conversation insert failed", {
        orderId: order.id,
        error: convError.message,
      });
    }

    return {
      orderId: order.id,
      orderNumber: order.orderNumber ?? "",
      conversationId: convData ? ((convData as any).id as string) : "",
    };
  }

  // =========================================================================
  // PROVIDER LOCATIONS
  // =========================================================================

  async getProviderLocations(providerId: string, restaurantId: string) {
    const { data, error } = await this.databaseService.supabase
      .from("provider_locations")
      .select("*")
      .eq("provider_id", providerId)
      .eq("restaurant_id", restaurantId)
      .order("is_primary", { ascending: false })
      .order("created_at");

    if (error) {
      if (error.code === "42P01" || error.message?.includes("does not exist"))
        return [];
      this.logger.error("Failed to fetch provider locations", {
        providerId,
        error: error.message,
      });
      throw error;
    }

    return (data || []).map((row: any) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      address: row.address,
      isPrimary: row.is_primary,
      // Numeric columns arrive as strings over PostgREST; Number() here keeps
      // the API contract numeric so callers do not compare "40.7" to 40.7.
      latitude:
        row.latitude === null || row.latitude === undefined
          ? null
          : Number(row.latitude),
      longitude:
        row.longitude === null || row.longitude === undefined
          ? null
          : Number(row.longitude),
      geocodedAt: row.geocoded_at ?? null,
      geocodeSource: row.geocode_source ?? null,
      createdAt: row.created_at,
    }));
  }

  async createProviderLocation(
    providerId: string,
    restaurantId: string,
    dto: CreateProviderLocationDto,
  ) {
    if (dto.isPrimary) {
      await this.databaseService.supabase
        .from("provider_locations")
        .update({ is_primary: false })
        .eq("provider_id", providerId)
        .eq("restaurant_id", restaurantId);
    }

    const { data, error } = await this.databaseService.supabase
      .from("provider_locations")
      .insert({
        provider_id: providerId,
        restaurant_id: restaurantId,
        name: dto.name,
        type: dto.type || "office",
        address: dto.address || null,
        is_primary: dto.isPrimary ?? false,
        // Only stamp geocode metadata when a real pair arrived. The DB CHECK
        // rejects half a coordinate, so sending one alone fails loudly rather
        // than storing an unplottable row.
        ...(dto.latitude !== undefined && dto.longitude !== undefined
          ? {
              latitude: dto.latitude,
              longitude: dto.longitude,
              geocoded_at: new Date().toISOString(),
              geocode_source: "google_places",
            }
          : {}),
      })
      .select("*")
      .single();

    if (error) {
      this.logger.error("Failed to create provider location", {
        providerId,
        error: error.message,
      });
      throw error;
    }

    const row = data as any;
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      address: row.address,
      isPrimary: row.is_primary,
      latitude:
        row.latitude === null || row.latitude === undefined
          ? null
          : Number(row.latitude),
      longitude:
        row.longitude === null || row.longitude === undefined
          ? null
          : Number(row.longitude),
      geocodedAt: row.geocoded_at ?? null,
      geocodeSource: row.geocode_source ?? null,
    };
  }

  async updateProviderLocation(
    providerId: string,
    locationId: string,
    restaurantId: string,
    dto: UpdateProviderLocationDto,
  ) {
    if (dto.isPrimary) {
      await this.databaseService.supabase
        .from("provider_locations")
        .update({ is_primary: false })
        .eq("provider_id", providerId)
        .eq("restaurant_id", restaurantId);
    }

    const { data, error } = await this.databaseService.supabase
      .from("provider_locations")
      .update({
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.type !== undefined && { type: dto.type }),
        ...(dto.address !== undefined && { address: dto.address }),
        ...(dto.isPrimary !== undefined && { is_primary: dto.isPrimary }),
        ...(dto.latitude !== undefined && dto.longitude !== undefined
          ? {
              latitude: dto.latitude,
              longitude: dto.longitude,
              geocoded_at: new Date().toISOString(),
              geocode_source: "google_places",
            }
          : {}),
      })
      .eq("id", locationId)
      .eq("provider_id", providerId)
      .eq("restaurant_id", restaurantId)
      .select("*")
      .single();

    if (error) {
      this.logger.error("Failed to update provider location", {
        locationId,
        error: error.message,
      });
      throw error;
    }

    const row = data as any;
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      address: row.address,
      isPrimary: row.is_primary,
      latitude:
        row.latitude === null || row.latitude === undefined
          ? null
          : Number(row.latitude),
      longitude:
        row.longitude === null || row.longitude === undefined
          ? null
          : Number(row.longitude),
      geocodedAt: row.geocoded_at ?? null,
      geocodeSource: row.geocode_source ?? null,
    };
  }

  async deleteProviderLocation(
    providerId: string,
    locationId: string,
    restaurantId: string,
  ) {
    const { error } = await this.databaseService.supabase
      .from("provider_locations")
      .delete()
      .eq("id", locationId)
      .eq("provider_id", providerId)
      .eq("restaurant_id", restaurantId);

    if (error) {
      this.logger.error("Failed to delete provider location", {
        locationId,
        error: error.message,
      });
      throw error;
    }
  }

  // =========================================================================
  // MAPPERS
  // =========================================================================

  private mapContactRow(row: Record<string, any>): ProviderContactResponseDto {
    return {
      id: row.id,
      providerId: row.provider_id,
      name: row.name,
      email: row.email ?? undefined,
      phone: row.phone ?? undefined,
      role: row.role ?? undefined,
      isPrimary: row.is_primary ?? false,
    };
  }

  /**
   * `providers.address` is a jsonb column that has held two shapes over time:
   * a plain string (what create/update write today) and a legacy object
   * `{ line1, city, … }` written by an earlier create path. Returning the raw
   * value meant callers received an object where the contract promises a
   * string — the card list then handed that object straight to React, which
   * refuses to render it. Rows written before the create-path fix still hold
   * objects, so normalising on read is what makes them display without a
   * backfill migration.
   */
  private normalizeAddress(value: unknown): string | undefined {
    if (value == null) return undefined;
    if (typeof value === "string") return value || undefined;
    if (typeof value === "object") {
      const o = value as Record<string, unknown>;
      const direct = o.line1 ?? o.formatted_address ?? o.formattedAddress;
      if (typeof direct === "string" && direct) return direct;
      // Otherwise assemble whatever parts are present rather than dropping the
      // address entirely — a partial address is more useful than none.
      const parts = [
        o.street,
        o.line2,
        o.city,
        o.state,
        o.postalCode,
        o.country,
      ].filter((p): p is string => typeof p === "string" && p.length > 0);
      return parts.length ? parts.join(", ") : undefined;
    }
    return undefined;
  }

  private mapProviderRow(row: ProviderRow): ProviderResponseDto {
    // Phone/email: prefer dedicated columns; fall back to primary_contact JSONB
    // for legacy providers created before the dedicated columns existed.
    const phone =
      row.contact_phone ?? (row.primary_contact as any)?.phone ?? undefined;
    const email =
      row.contact_email ?? (row.primary_contact as any)?.email ?? undefined;

    return {
      id: row.id,
      name: row.name,
      companyName: row.company_name ?? undefined,
      phone,
      email,
      contactFirstName: row.contact_first_name ?? undefined,
      contactLastName: row.contact_last_name ?? undefined,
      physicalAddress: this.normalizeAddress(row.address),
      website: row.website ?? undefined,
      rating: row.rating ?? undefined,
      notes: row.personality_notes ?? undefined,
      primaryContact: row.primary_contact ?? undefined,
      specialties: row.specialties ?? undefined,
      regionsCovered: row.regions_covered ?? undefined,
      minimumOrder: row.minimum_order ?? undefined,
      leadTimeDays: row.lead_time_days ?? undefined,
      reliabilityScore: row.reliability_score ?? undefined,
      tier: row.tier ?? undefined,
      isActive: row.is_active ?? undefined,
      lastContactDate: (row as any).last_contact_date ?? undefined,
      lastContactNotes: (row as any).last_contact_notes ?? undefined,
      catalogueVendorId: (row as any).catalogue_vendor_id ?? null,
      isCustom: (row as any).is_custom ?? true,
      paymentTerms: row.payment_terms ?? undefined,
      primaryBusinessType:
        row.vendor_type ?? (row as any).primary_business_type ?? undefined,
      knownPersonnel: row.known_personnel ?? undefined,
    };
  }

  // =========================================================================
  // B1 — the vendor's usual currency (founder, 2026-09-06 batch 65).
  //
  // Read and write live here rather than folding into `updateProvider` on
  // purpose. `updateProvider` is open to anyone signed in and strips undefined
  // keys from a wide payload; this fact is manager-gated and carries an author
  // and a moment that the database enforces as ONE fact with the value. Putting
  // it in that payload would let a form that happens to send `usualCurrency`
  // write a vendor-level currency with nobody's name on it, which is the exact
  // shape `providers_usual_currency_names_its_author` refuses.
  // =========================================================================

  /**
   * What this vendor usually invoices in, with who said so and when.
   *
   * A FAILED READ IS NOT AN ABSENT CURRENCY (ADR 0067). supabase-js resolves
   * `{ data, error }` and never throws, so without the error arm an outage would
   * render as "this vendor has not stated a usual currency" — a page confidently
   * telling a manager that a fact they entered does not exist.
   */
  async getUsualCurrency(
    providerId: string,
    restaurantId: string,
  ): Promise<{
    code: string | null;
    setAt: string | null;
    setByName: string | null;
    vendorName: string | null;
  }> {
    const { data, error } = await this.databaseService.supabase
      .from("providers")
      .select("name, usual_currency, usual_currency_set_by, usual_currency_set_at")
      .eq("id", providerId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (error) {
      this.logger.error("Failed to read a vendor's usual currency", {
        providerId,
        error: error.message,
      });
      throw new ServiceUnavailableException(
        `This vendor's usual currency could not be read (${error.message}). That is a failed read, not an empty field — nothing here says the vendor has stated no currency.`,
      );
    }
    if (!data) throw new NotFoundException(`Provider ${providerId} not found`);

    const row = data as {
      name?: string | null;
      usual_currency?: string | null;
      usual_currency_set_by?: string | null;
      usual_currency_set_at?: string | null;
    };

    // The author's name, read separately and NEVER load-bearing: a name that
    // cannot be read leaves the attribution off the sentence rather than
    // suppressing the currency, and it never falls back to an email address
    // while calling it a name.
    let setByName: string | null = null;
    if (row.usual_currency_set_by) {
      const { data: person, error: personError } =
        await this.databaseService.supabase
          .from("users")
          .select("name")
          .eq("user_id", row.usual_currency_set_by)
          .maybeSingle();
      if (personError)
        this.logger.warn(
          `The person who stated ${providerId}'s usual currency could not be read (${personError.message}); the sentence names no author.`,
        );
      else setByName = ((person as { name?: string | null })?.name ?? null) || null;
    }

    return {
      code: row.usual_currency ?? null,
      setAt: row.usual_currency_set_at ?? null,
      setByName,
      vendorName: row.name ?? null,
    };
  }

  /**
   * State what this vendor usually invoices in. Manager-gated by the caller.
   *
   * The value, the author and the moment are written as three EXPLICIT literal
   * keys in one payload — never a conditional spread, which
   * `scripts/check_order_capture_contract.py` reads as an unreadable key set —
   * and the database CHECK refuses any two of the three without the third.
   */
  async setUsualCurrency(args: {
    providerId: string;
    restaurantId: string;
    code: string;
    userId: string;
  }): Promise<{
    code: string;
    setAt: string;
    previous: string | null;
  }> {
    const before = await this.getUsualCurrency(
      args.providerId,
      args.restaurantId,
    );
    const setAt = new Date().toISOString();

    const { data, error } = await this.databaseService.supabase
      .from("providers")
      .update({
        usual_currency: args.code,
        // `public.users.user_id` — the id the JWT carries. NEVER an `auth.users`
        // id: the two tables are disjoint in this database and an actor FK to
        // `auth.users` 23503s on every write.
        usual_currency_set_by: args.userId,
        usual_currency_set_at: setAt,
      })
      .eq("id", args.providerId)
      .eq("restaurant_id", args.restaurantId)
      .select("usual_currency, usual_currency_set_at")
      .maybeSingle();

    if (error) {
      this.logger.error("Failed to state a vendor's usual currency", {
        providerId: args.providerId,
        error: error.message,
      });
      throw new ServiceUnavailableException(
        `This vendor's usual currency was NOT changed (${error.message}).`,
      );
    }
    if (!data)
      throw new NotFoundException(`Provider ${args.providerId} not found`);

    return {
      code: (data as { usual_currency: string }).usual_currency,
      setAt:
        (data as { usual_currency_set_at?: string | null })
          .usual_currency_set_at ?? setAt,
      previous: before.code,
    };
  }
}
