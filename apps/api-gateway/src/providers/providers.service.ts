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

interface ProviderRow {
  id: string;
  name: string;
  company_name: string | null;
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
        contact_phone: vendor.phone ?? null,
        contact_email: vendor.email ?? null,
        address: vendor.address ?? null,
        ai_personality_notes: catalogueNotes,
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
        primary_contact: dto.primaryContact ?? null,
        alternative_contacts: dto.alternativeContacts ?? null,
        address: dto.address ?? null,
        specialties: dto.specialties ?? null,
        regions_covered: dto.regionsCovered ?? null,
        minimum_order: dto.minimumOrder ?? null,
        lead_time_days: dto.leadTimeDays ?? null,
        tier: dto.tier ?? null,
        ai_personality_notes: dto.notes ?? null,
        contact_phone: dto.phone ?? null,
        contact_email: dto.email ?? null,
        contact_name: dto.contactName ?? null,
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

  async listProviders(): Promise<ProviderResponseDto[]> {
    const { data, error } = await this.databaseService.supabase
      .from('providers')
      .select('*')
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error('Failed to list providers', { error: error.message });
      throw error;
    }

    return (data || []).map((row) => this.mapProviderRow(row as ProviderRow));
  }

  async getProvider(providerId: string): Promise<ProviderResponseDto> {
    const { data, error } = await this.databaseService.supabase
      .from('providers')
      .select('*')
      .eq('id', providerId)
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
    const updatePayload = {
      name: dto.name ?? undefined,
      company_name: dto.companyName ?? undefined,
      primary_contact: dto.primaryContact ?? undefined,
      alternative_contacts: dto.alternativeContacts ?? undefined,
      address: dto.address ?? undefined,
      specialties: dto.specialties ?? undefined,
      regions_covered: dto.regionsCovered ?? undefined,
      minimum_order: dto.minimumOrder ?? undefined,
      lead_time_days: dto.leadTimeDays ?? undefined,
      tier: dto.tier ?? undefined,
      notes: dto.notes ?? undefined,
      is_active: dto.isActive ?? undefined,
    };

    const { data, error } = await this.databaseService.supabase
      .from('providers')
      .update(updatePayload)
      .eq('id', providerId)
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
      .single();

    const { error } = await this.databaseService.supabase
      .from('providers')
      .update({
        is_active: false,
        deleted_at: new Date().toISOString(),
      })
      .eq('id', providerId);

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
    restaurantId?: string;
    specialties?: string[];
    isActive?: boolean;
    wineType?: string;
  }): Promise<ProviderResponseDto[]> {
    let query = this.databaseService.supabase
      .from('providers')
      .select('*')
      .is('deleted_at', null);

    if (params.restaurantId) {
      query = query.eq('restaurant_id', params.restaurantId);
    }

    if (params.isActive !== undefined) {
      query = query.eq('is_active', params.isActive);
    }

    if (params.q) {
      query = query.or(`name.ilike.%${params.q}%,company_name.ilike.%${params.q}%,contact_name.ilike.%${params.q}%`);
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
  ): Promise<ProviderResponseDto> {
    const { data, error } = await this.databaseService.supabase
      .from('providers')
      .update({
        last_contact_date: dto.lastContactDate,
        last_contact_notes: dto.notes ?? null,
      })
      .eq('id', providerId)
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
    return {
      id: row.id,
      name: row.name,
      companyName: row.company_name ?? undefined,
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
