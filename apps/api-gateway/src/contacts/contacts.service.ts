import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";

export interface ContactDto {
  id?: string;
  type: string;
  display_name: string;
  restaurant_id?: string;
  linked_user_id?: string;
  linked_provider_id?: string;
  is_active?: boolean;
  metadata?: Record<string, any>;
}

export interface ContactAddressDto {
  id?: string;
  contact_id?: string;
  channel: string;
  address_value: string;
  label?: string;
  is_primary?: boolean;
  is_verified?: boolean;
  metadata?: Record<string, any>;
}

export interface ContactWithAddresses extends ContactDto {
  addresses?: ContactAddressDto[];
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

@Injectable()
export class ContactsService {
  private readonly logger = new Logger(ContactsService.name);

  constructor(private readonly databaseService: DatabaseService) {}

  /**
   * Search contacts with pagination, filtering, and trigram search
   */
  async findAll(options: {
    restaurantId?: string;
    type?: string;
    search?: string;
    page?: number;
    pageSize?: number;
    includeAddresses?: boolean;
  }): Promise<PaginatedResult<ContactWithAddresses>> {
    const {
      restaurantId,
      type,
      search,
      page = 1,
      pageSize = 20,
      includeAddresses = false,
    } = options;
    const client = this.databaseService.getClient();
    const offset = (page - 1) * pageSize;

    try {
      let query = client
        .from("contacts")
        .select("*", { count: "exact" })
        .eq("is_active", true);

      if (restaurantId) {
        query = query.eq("restaurant_id", restaurantId);
      }
      if (type) {
        query = query.eq("type", type);
      }
      if (search) {
        query = query.ilike("display_name", `%${search}%`);
      }

      const { data, error, count } = await query
        .order("display_name", { ascending: true })
        .range(offset, offset + pageSize - 1);

      if (error) throw error;

      let results: ContactWithAddresses[] = data || [];

      // Optionally include addresses
      if (includeAddresses && results.length > 0) {
        const contactIds = results.map((c) => c.id).filter(Boolean);
        const { data: addresses } = await client
          .from("contact_addresses")
          .select("*")
          .in("contact_id", contactIds);

        const addressMap = new Map<string, ContactAddressDto[]>();
        for (const addr of addresses || []) {
          const list = addressMap.get(addr.contact_id) || [];
          list.push(addr);
          addressMap.set(addr.contact_id, list);
        }

        results = results.map((c) => ({
          ...c,
          addresses: addressMap.get(c.id!) || [],
        }));
      }

      const total = count || 0;

      return {
        data: results,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      };
    } catch (error) {
      this.logger.error(`Failed to query contacts: ${error}`);
      throw error;
    }
  }

  /**
   * Get a single contact by ID with addresses
   */
  async findOne(id: string): Promise<ContactWithAddresses> {
    const client = this.databaseService.getClient();

    const { data: contact, error } = await client
      .from("contacts")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !contact) {
      throw new NotFoundException(`Contact ${id} not found`);
    }

    const { data: addresses } = await client
      .from("contact_addresses")
      .select("*")
      .eq("contact_id", id)
      .order("is_primary", { ascending: false });

    return {
      ...contact,
      addresses: addresses || [],
    };
  }

  /**
   * Create a contact with optional addresses
   */
  async create(
    dto: ContactDto,
    addresses?: ContactAddressDto[],
  ): Promise<ContactWithAddresses> {
    const client = this.databaseService.getClient();

    const { data: contact, error } = await client
      .from("contacts")
      .insert({
        type: dto.type,
        display_name: dto.display_name,
        restaurant_id: dto.restaurant_id || null,
        linked_user_id: dto.linked_user_id || null,
        linked_provider_id: dto.linked_provider_id || null,
        is_active: dto.is_active ?? true,
        metadata: dto.metadata || {},
      })
      .select()
      .single();

    if (error) throw error;

    let createdAddresses: ContactAddressDto[] = [];
    if (addresses && addresses.length > 0) {
      const addrRows = addresses.map((a) => ({
        contact_id: contact.id,
        channel: a.channel,
        address_value: a.address_value,
        label: a.label || "work",
        is_primary: a.is_primary || false,
        is_verified: a.is_verified || false,
        metadata: a.metadata || {},
      }));

      const { data: addrData, error: addrError } = await client
        .from("contact_addresses")
        .insert(addrRows)
        .select();

      if (addrError) {
        this.logger.warn(
          `Failed to create addresses for contact ${contact.id}: ${addrError.message}`,
        );
      }
      createdAddresses = addrData || [];
    }

    return { ...contact, addresses: createdAddresses };
  }

  /**
   * Update a contact
   */
  async update(
    id: string,
    dto: Partial<ContactDto>,
  ): Promise<ContactWithAddresses> {
    const client = this.databaseService.getClient();

    const updateData: Record<string, any> = {};
    if (dto.type !== undefined) updateData.type = dto.type;
    if (dto.display_name !== undefined)
      updateData.display_name = dto.display_name;
    if (dto.restaurant_id !== undefined)
      updateData.restaurant_id = dto.restaurant_id;
    if (dto.linked_user_id !== undefined)
      updateData.linked_user_id = dto.linked_user_id;
    if (dto.linked_provider_id !== undefined)
      updateData.linked_provider_id = dto.linked_provider_id;
    if (dto.is_active !== undefined) updateData.is_active = dto.is_active;
    if (dto.metadata !== undefined) updateData.metadata = dto.metadata;

    const { data: contact, error } = await client
      .from("contacts")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (error || !contact) {
      throw new NotFoundException(`Contact ${id} not found`);
    }

    return this.findOne(id);
  }

  /**
   * Soft-delete a contact
   */
  async remove(id: string): Promise<void> {
    const client = this.databaseService.getClient();

    const { error } = await client
      .from("contacts")
      .update({ is_active: false })
      .eq("id", id);

    if (error) throw error;
  }

  /**
   * Get addresses for a contact
   */
  async getAddresses(contactId: string): Promise<ContactAddressDto[]> {
    const client = this.databaseService.getClient();

    const { data, error } = await client
      .from("contact_addresses")
      .select("*")
      .eq("contact_id", contactId)
      .order("is_primary", { ascending: false });

    if (error) throw error;
    return data || [];
  }

  /**
   * Add an address to a contact
   */
  async addAddress(
    contactId: string,
    dto: ContactAddressDto,
  ): Promise<ContactAddressDto> {
    const client = this.databaseService.getClient();

    // Verify contact exists
    const { data: contact } = await client
      .from("contacts")
      .select("id")
      .eq("id", contactId)
      .single();

    if (!contact) {
      throw new NotFoundException(`Contact ${contactId} not found`);
    }

    const { data: address, error } = await client
      .from("contact_addresses")
      .insert({
        contact_id: contactId,
        channel: dto.channel,
        address_value: dto.address_value,
        label: dto.label || "work",
        is_primary: dto.is_primary || false,
        is_verified: dto.is_verified || false,
        metadata: dto.metadata || {},
      })
      .select()
      .single();

    if (error) throw error;
    return address;
  }

  /**
   * Delete an address
   */
  async removeAddress(addressId: string): Promise<void> {
    const client = this.databaseService.getClient();

    const { error } = await client
      .from("contact_addresses")
      .delete()
      .eq("id", addressId);

    if (error) throw error;
  }
}
