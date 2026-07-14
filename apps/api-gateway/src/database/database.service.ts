import { Injectable, OnModuleInit, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

@Injectable()
export class DatabaseService implements OnModuleInit {
  private readonly logger = new Logger(DatabaseService.name);
  public supabase: SupabaseClient;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    const supabaseUrl = this.configService.get<string>("SUPABASE_URL");
    const supabaseKey = this.configService.get<string>(
      "SUPABASE_SERVICE_ROLE_KEY",
    );

    if (!supabaseUrl || !supabaseKey) {
      throw new Error("Supabase configuration missing");
    }

    this.supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    this.logger.log("✅ Supabase client initialized");
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
      .from("restaurant_inventory")
      .select(
        "*, master_wine_library(bottle_size_ml, name, producer, vintage, primary_type, grape_variety, country, region)",
      )
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true);

    if (error) throw error;
    return data;
  }

  async getLowStockItems(restaurantId: string) {
    const { data, error } = await this.supabase
      .from("v_low_stock_items")
      .select("*")
      .eq("restaurant_id", restaurantId);

    if (error) throw error;
    return data;
  }

  /**
   * Active member user_ids for a restaurant (URA membership; falls back to
   * users.restaurant_id). Shared by the notification funnels so cron-generated
   * signals (deliveries, payments, reports) can land in every member's inbox.
   */
  async getRestaurantMemberIds(restaurantId: string): Promise<string[]> {
    try {
      const { data: ura } = await this.supabase
        .from("user_restaurant_access")
        .select("user_id")
        .eq("restaurant_id", restaurantId)
        .eq("is_active", true);
      const uraIds = (ura || []).map((r: any) => r.user_id).filter(Boolean);
      if (uraIds.length) return Array.from(new Set(uraIds));

      const { data: users } = await this.supabase
        .from("users")
        .select("user_id")
        .eq("restaurant_id", restaurantId);
      return Array.from(
        new Set((users || []).map((u: any) => u.user_id).filter(Boolean)),
      );
    } catch {
      return [];
    }
  }

  async getProcurementOrders(restaurantId: string, status?: string) {
    let query = this.supabase
      .from("procurement_orders")
      .select("*")
      .eq("restaurant_id", restaurantId);

    if (status) {
      query = query.eq("status", status);
    }

    const { data, error } = await query.order("created_at", {
      ascending: false,
    });

    if (error) throw error;
    return data;
  }

  async getRecentNotifications(managerId: string, limit: number = 20) {
    const { data, error } = await this.supabase
      .from("notifications")
      .select("*")
      .eq("manager_id", managerId)
      .order("sent_at", { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data;
  }
}
