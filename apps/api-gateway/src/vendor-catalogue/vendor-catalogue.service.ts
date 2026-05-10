import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { SearchVendorsDto } from './dto/search-vendors.dto';

export interface VendorCatalogueRow {
  id: string;
  name: string;
  type: string | null;
  country: string | null;
  state: string | null;
  city: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  wine_specialties: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface VendorSearchResult {
  data: VendorCatalogueRow[];
  total: number;
  limit: number;
  offset: number;
}

@Injectable()
export class VendorCatalogueService {
  private readonly logger = new Logger(VendorCatalogueService.name);

  constructor(private readonly databaseService: DatabaseService) {}

  async search(dto: SearchVendorsDto): Promise<VendorSearchResult> {
    const q = dto.q ?? '';
    const country = dto.country ?? 'US';
    const limit = dto.limit ?? 20;
    const offset = dto.offset ?? 0;

    let query = this.databaseService.supabase
      .from('vendor_catalogue')
      .select('*', { count: 'exact' })
      .eq('is_active', true)
      .eq('country', country);

    if (q) {
      query = query.ilike('name', `%${q}%`);
    }

    if (dto.type) {
      query = query.eq('type', dto.type);
    }

    const { data, error, count } = await query
      .order('name')
      .range(offset, offset + limit - 1);

    if (error) {
      this.logger.error('Failed to search vendor catalogue', { error: error.message });
      throw error;
    }

    return {
      data: (data ?? []) as VendorCatalogueRow[],
      total: count ?? 0,
      limit,
      offset,
    };
  }

  async findById(id: string): Promise<VendorCatalogueRow> {
    const { data, error } = await this.databaseService.supabase
      .from('vendor_catalogue')
      .select('*')
      .eq('id', id)
      .eq('is_active', true)
      .single();

    if (error || !data) {
      this.logger.error('Failed to fetch vendor by id', { id, error: error?.message });
      throw new NotFoundException(`Vendor catalogue entry not found: ${id}`);
    }

    return data as VendorCatalogueRow;
  }
}
