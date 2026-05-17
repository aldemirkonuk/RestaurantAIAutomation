import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { EventsService } from '../events/events.service';
import { EventType, SourcePage } from '../events/dto/event.dto';
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
import { UpdateIntelligenceDto } from './dto/update-intelligence.dto';
import { RetroactiveOrderDto } from './dto/retroactive-order.dto';

function normalizeToE164(phone: string | null | undefined): string | null {
  if (!phone) return null;
  if (phone.startsWith('+')) return phone;
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return phone;
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
}

@Injectable()
export class ProvidersService {
  private readonly logger = new Logger(ProvidersService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly eventsService: EventsService,
  ) {}

  async createProvider(
    dto: CreateProviderDto,
    restaurantId?: string,
    userId?: string,
  ): Promise<ProviderResponseDto> {
    let payload: Record<string, any>;

    if (dto.catalogue_vendor_id) {
      // Mode A: from catalogue — fetch vendor details and auto-fill
      const { data: vendor, error: vendorError } = await this.databaseService.supabase
        .from('vendor_catalogue')
        .select('*')
        .eq('id', dto.catalogue_vendor_id)
        .eq('is_active', true)
        .single();

      if (vendorError || !vendor) {
        throw new NotFoundException(`Vendor catalogue entry not found: ${dto.catalogue_vendor_id}`);
      }

      // Build notes from catalogue type + website + specialties
      const noteParts: string[] = [];
      if (vendor.type) noteParts.push(`Type: ${vendor.type}`);
      if (vendor.website) noteParts.push(`Website: ${vendor.website}`);
      if (vendor.wine_specialties) noteParts.push(`Specialties: ${vendor.wine_specialties}`);
      const catalogueNotes = noteParts.length > 0 ? noteParts.join(' | ') : null;

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
        throw new BadRequestException('name is required when catalogue_vendor_id is not provided');
      }

      payload = {
        name: dto.name,
        company_name: dto.companyName ?? null,
        primary_contact: dto.primaryContact ?? {},
        alternative_contacts: dto.alternativeContacts ?? null,
        address: dto.address ?? null,
        specialties: dto.specialties ?? null,
        regions_covered: dto.regionsCovered ?? null,
        minimum_order: dto.minimumOrder ?? null,
        lead_time_days: dto.leadTimeDays ?? null,
        tier: dto.tier ?? null,
        personality_notes: dto.notes ?? null,
        contact_phone: normalizeToE164(dto.phone),
        contact_email: dto.email ?? null,
        catalogue_vendor_id: null,
        is_custom: true,
        restaurant_id: restaurantId ?? null,
      };
    }

    const { data, error } = await this.databaseService.supabase
      .from('providers')
      .insert(payload)
      .select('*')
      .single();

    if (error) {
      this.logger.error('Failed to create provider', { error: error.message });
      throw error;
    }

    const provider = this.mapProviderRow(data as ProviderRow);

    // Mark vendor_added=true in onboarding progress (fire-and-forget)
    if (restaurantId) {
      this.databaseService.supabase
        .from('user_onboarding_progress')
        .update({ vendor_added: true })
        .eq('restaurant_id', restaurantId)
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
            type: 'added',
            providerId: provider.id,
            providerName: provider.name,
            data: {
              companyName: provider.companyName,
              specialties: provider.specialties,
              tier: provider.tier,
            },
          },
        });
        this.logger.log('Provider change event emitted', { providerId: provider.id, type: 'added' });
      } catch (eventError) {
        this.logger.warn('Failed to emit provider change event', { error: eventError.message });
        // Don't fail the operation if event emission fails
      }
    }

    return provider;
  }

  async listProviders(restaurantId: string): Promise<ProviderResponseDto[]> {
    const { data, error } = await this.databaseService.supabase
      .from('providers')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error('Failed to list providers', { error: error.message });
      throw error;
    }

    return (data || []).map((row) => this.mapProviderRow(row as ProviderRow));
  }

  async getProvider(providerId: string, restaurantId: string): Promise<ProviderResponseDto> {
    const { data, error } = await this.databaseService.supabase
      .from('providers')
      .select('*')
      .eq('id', providerId)
      .eq('restaurant_id', restaurantId)
      .single();

    if (error) {
      this.logger.error('Failed to fetch provider', {
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
      address: dto.physicalAddress ?? dto.address ?? undefined,
      specialties: dto.specialties ?? undefined,
      regions_covered: dto.regionsCovered ?? undefined,
      minimum_order: dto.minimumOrder ?? undefined,
      lead_time_days: dto.leadTimeDays ?? undefined,
      tier: dto.tier ?? undefined,
      is_active: dto.isActive ?? undefined,
      payment_terms: dto.paymentTerms ?? undefined,
    };
    // Remove undefined keys so Supabase doesn't null-out untouched columns
    Object.keys(updatePayload).forEach(
      (k) => updatePayload[k] === undefined && delete updatePayload[k],
    );

    const { data, error } = await this.databaseService.supabase
      .from('providers')
      .update(updatePayload)
      .eq('id', providerId)
      .eq('restaurant_id', restaurantId ?? '')
      .select('*')
      .single();

    if (error) {
      this.logger.error('Failed to update provider', {
        providerId,
        error: error.message,
      });
      throw error;
    }

    const provider = this.mapProviderRow(data as ProviderRow);

    // Emit provider_change event for cross-page sync
    if (restaurantId && userId) {
      try {
        await this.eventsService.createEvent(restaurantId, userId, {
          eventType: EventType.PROVIDER_CHANGE,
          sourcePage: SourcePage.PROVIDERS,
          payload: {
            type: 'updated',
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
        this.logger.log('Provider change event emitted', { providerId: provider.id, type: 'updated' });
      } catch (eventError) {
        this.logger.warn('Failed to emit provider change event', { error: eventError.message });
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
      .from('providers')
      .select('name')
      .eq('id', providerId)
      .eq('restaurant_id', restaurantId ?? '')
      .single();

    const { error } = await this.databaseService.supabase
      .from('providers')
      .update({
        is_active: false,
        deleted_at: new Date().toISOString(),
      })
      .eq('id', providerId)
      .eq('restaurant_id', restaurantId ?? '');

    if (error) {
      this.logger.error('Failed to delete provider', {
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
            type: 'removed',
            providerId,
            providerName: existingProvider?.name || 'Unknown',
          },
        });
        this.logger.log('Provider change event emitted', { providerId, type: 'removed' });
      } catch (eventError) {
        this.logger.warn('Failed to emit provider change event', { error: eventError.message });
      }
    }
  }

  async getProviderOrders(providerId: string) {
    const { data, error } = await this.databaseService.supabase
      .from('procurement_orders')
      .select('*')
      .eq('provider_id', providerId)
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error('Failed to fetch provider orders', {
        providerId,
        error: error.message,
      });
      throw error;
    }

    return data ?? [];
  }

  async getProviderPerformance(providerId: string) {
    const { data, error } = await this.databaseService.supabase
      .from('provider_performance_metrics')
      .select('*')
      .eq('provider_id', providerId)
      .order('calculated_at', { ascending: false })
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
      .from('provider_ratings')
      .insert(payload);

    if (error) {
      this.logger.error('Failed to rate provider', {
        providerId,
        error: error.message,
      });
      throw error;
    }
  }

  // =========================================================================
  // CONTACTS
  // =========================================================================

  async getProviderContacts(providerId: string): Promise<ProviderContactResponseDto[]> {
    const { data, error } = await this.databaseService.supabase
      .from('provider_contacts')
      .select('*')
      .eq('provider_id', providerId)
      .order('is_primary', { ascending: false })
      .order('name');

    if (error) {
      this.logger.error('Failed to fetch provider contacts', { providerId, error: error.message });
      throw error;
    }

    return (data || []).map((row) => this.mapContactRow(row));
  }

  async addProviderContact(
    providerId: string,
    dto: CreateProviderContactDto,
  ): Promise<ProviderContactResponseDto> {
    const payload = {
      provider_id: providerId,
      name: dto.name,
      email: dto.email ?? null,
      phone: dto.phone ?? null,
      role: dto.role ?? null,
      is_primary: dto.isPrimary ?? false,
    };

    const { data, error } = await this.databaseService.supabase
      .from('provider_contacts')
      .insert(payload)
      .select('*')
      .single();

    if (error) {
      this.logger.error('Failed to add provider contact', { providerId, error: error.message });
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
      .from('provider_contacts')
      .update(updatePayload)
      .eq('id', contactId)
      .eq('provider_id', providerId)
      .select('*')
      .single();

    if (error) {
      this.logger.error('Failed to update provider contact', { contactId, error: error.message });
      throw error;
    }

    return this.mapContactRow(data);
  }

  async deleteProviderContact(providerId: string, contactId: string): Promise<void> {
    const { error } = await this.databaseService.supabase
      .from('provider_contacts')
      .delete()
      .eq('id', contactId)
      .eq('provider_id', providerId);

    if (error) {
      this.logger.error('Failed to delete provider contact', { contactId, error: error.message });
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
      .from('providers')
      .select('*')
      .eq('restaurant_id', params.restaurantId)
      .is('deleted_at', null);

    if (params.isActive !== undefined) {
      query = query.eq('is_active', params.isActive);
    }

    if (params.q) {
      // Sanitize user input: strip characters meaningful to PostgREST filter syntax
      // (comma, parentheses, period) to prevent filter-injection via the .or() string.
      const safeQ = params.q.replace(/[,().]/g, '');
      query = query.or(
        `name.ilike.%${safeQ}%,company_name.ilike.%${safeQ}%,contact_name.ilike.%${safeQ}%`,
      );
    }

    if (params.specialties?.length) {
      query = query.overlaps('specialties', params.specialties);
    }

    if (params.wineType) {
      query = query.contains('specialties', [params.wineType]);
    }

    const { data, error } = await query.order('name');

    if (error) {
      this.logger.error('Failed to search providers', { error: error.message });
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
      .from('providers')
      .select('*')
      .is('deleted_at', null)
      .eq('is_active', true)
      .order('reliability_score', { ascending: false })
      .limit(5);

    if (restaurantId) {
      query = query.eq('restaurant_id', restaurantId);
    }

    const { data, error } = await query;

    if (error) {
      this.logger.error('Failed to fetch recommendations', { error: error.message });
      throw error;
    }

    const providers = (data || []).map((row) => this.mapProviderRow(row as ProviderRow));
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
      .from('providers')
      .update({
        last_contact_date: dto.lastContactDate,
        last_contact_notes: dto.notes ?? null,
      })
      .eq('id', providerId)
      .eq('restaurant_id', restaurantId)
      .select('*')
      .single();

    if (error) {
      this.logger.error('Failed to update last contact date', { providerId, error: error.message });
      throw error;
    }

    return this.mapProviderRow(data as ProviderRow);
  }

  // =========================================================================
  // BULK IMPORT
  // =========================================================================

  async bulkImportProviders(dto: BulkImportProvidersDto): Promise<BulkImportResultDto> {
    let imported = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const providerDto of dto.providers) {
      try {
        await this.createProvider(providerDto);
        imported++;
      } catch (err: any) {
        failed++;
        errors.push(`${providerDto.name}: ${err.message || 'Unknown error'}`);
      }
    }

    this.logger.log('Bulk import completed', { imported, failed });
    return { imported, failed, errors };
  }

  // =========================================================================
  // PHASE 32: INTELLIGENCE (profile_foundational + profile_dynamic)
  // =========================================================================

  async getIntelligence(
    providerId: string,
    restaurantId: string,
  ): Promise<{ profile_foundational: Record<string, any>; profile_dynamic: Record<string, any> }> {
    const { data, error } = await this.databaseService.supabase
      .from('providers')
      .select('profile_foundational, profile_dynamic')
      .eq('id', providerId)
      .eq('restaurant_id', restaurantId)
      .single();

    if (error) {
      this.logger.error('getIntelligence failed', { providerId, error: error.message });
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
      .from('providers')
      .update(updatePayload)
      .eq('id', providerId)
      .eq('restaurant_id', restaurantId);

    if (error) {
      this.logger.error('updateIntelligence failed', { providerId, error: error.message });
      throw error;
    }

    return { success: true };
  }

  getProfileSummary(profileDynamic: Record<string, any>): Array<{ key: string; label: string; value: string }> {
    const priorityKeys = ['response_speed', 'negotiation_style', 'relationship_tier'];
    return priorityKeys
      .filter((k) => profileDynamic[k])
      .map((k) => ({
        key: k,
        label: k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        value: String(profileDynamic[k]).slice(0, 20),
      }))
      .slice(0, 3);
  }

  /**
   * D-32-15 Scenario C: Create retroactive order from off-app invoice.
   */
  async createRetroactiveOrder(
    providerId: string,
    restaurantId: string,
    dto: RetroactiveOrderDto,
  ): Promise<{ orderId: string; conversationId: string; interactionId: string }> {
    const { data: orderData, error: orderError } = await this.databaseService.supabase
      .from('procurement_orders')
      .insert({
        restaurant_id: restaurantId,
        provider_id: providerId,
        wine_name: dto.wineName,
        quantity: dto.quantity ?? null,
        final_confirmed_cost: dto.finalConfirmedCost ?? null,
        actual_delivery: dto.invoiceDate ?? null,
        status: 'delivered',
        source: 'retroactive',
      })
      .select('id')
      .single();

    if (orderError) {
      this.logger.error('createRetroactiveOrder: order insert failed', { error: orderError.message });
      throw orderError;
    }

    const orderId = (orderData as any).id as string;

    const { data: convData, error: convError } = await this.databaseService.supabase
      .from('procurement_conversations')
      .insert({
        order_id: orderId,
        provider_id: providerId,
        restaurant_id: restaurantId,
        direction: 'INBOUND',
        channel: 'email',
        content: dto.rawInvoiceContent ?? '',
        status: 'DELIVERED',
        ai_summary: `Retroactive order created from off-app invoice ${dto.invoiceNumber ?? ''}.`,
      })
      .select('id')
      .single();

    if (convError) {
      this.logger.warn('createRetroactiveOrder: conversation insert failed', { error: convError.message });
    }

    const conversationId = convData ? (convData as any).id as string : '';

    const { data: intData, error: intError } = await this.databaseService.supabase
      .from('order_interactions')
      .insert({
        order_id: orderId,
        interaction_type: 'invoice_received',
        channel: 'email',
        content: dto.rawInvoiceContent ?? '',
        ai_summary: `Invoice ${dto.invoiceNumber ?? 'unknown'} received; retroactive order created.`,
      })
      .select('id')
      .single();

    if (intError) {
      this.logger.warn('createRetroactiveOrder: interaction insert failed', { error: intError.message });
    }

    return {
      orderId,
      conversationId,
      interactionId: intData ? (intData as any).id as string : '',
    };
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

  private mapProviderRow(row: ProviderRow): ProviderResponseDto {
    // Phone/email: prefer dedicated columns; fall back to primary_contact JSONB
    // for legacy providers created before the dedicated columns existed.
    const phone =
      row.contact_phone ??
      (row.primary_contact as any)?.phone ??
      undefined;
    const email =
      row.contact_email ??
      (row.primary_contact as any)?.email ??
      undefined;

    return {
      id: row.id,
      name: row.name,
      companyName: row.company_name ?? undefined,
      phone,
      email,
      contactFirstName: row.contact_first_name ?? undefined,
      contactLastName: row.contact_last_name ?? undefined,
      physicalAddress: row.address ?? undefined,
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
    };
  }
}
