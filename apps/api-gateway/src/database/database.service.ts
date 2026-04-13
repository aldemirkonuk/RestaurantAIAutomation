import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class DatabaseService implements OnModuleInit {
  private readonly logger = new Logger(DatabaseService.name);
  public supabase: SupabaseClient;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL');
    const supabaseKey = this.configService.get<string>('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase configuration missing');
    }

    this.supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    this.logger.log('✅ Supabase client initialized');
  }

  getClient(): SupabaseClient {
    return this.supabase;
  }

  // Alias for backward compatibility (some services use .client)
  get client(): SupabaseClient {
    return this.supabase;
  }

  // Helper methods for common operations
  async getRestaurantInventory(restaurantId: string) {
    const { data, error } = await this.supabase
      .from('restaurant_inventory')
      .select(
        '*, master_wine_library(bottle_size_ml, name, producer, vintage, primary_type, grape_variety, country, region), restaurants(default_pour_ml, measurement_unit)',
      )
      .eq('restaurant_id', restaurantId);

    if (error) throw error;
    return data;
  }

  async getLowStockItems(restaurantId: string) {
    const { data, error } = await this.supabase
      .from('v_low_stock_items')
      .select('*')
      .eq('restaurant_id', restaurantId);

    if (error) throw error;
    return data;
  }

  async getProcurementOrders(restaurantId: string, status?: string) {
    let query = this.supabase
      .from('procurement_orders')
      .select('*')
      .eq('restaurant_id', restaurantId);

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) throw error;
    return data;
  }

  async getRecentNotifications(managerId: string, limit: number = 20) {
    const { data, error } = await this.supabase
      .from('notifications')
      .select('*')
      .eq('manager_id', managerId)
      .order('sent_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data;
  }
}

