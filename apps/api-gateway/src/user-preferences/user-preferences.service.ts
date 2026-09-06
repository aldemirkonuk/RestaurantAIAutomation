import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { UserPreferencesResponseDto } from "./dto/user-preferences.dto";

const DEFAULT_PREFERENCES: Record<string, any> = {
  theme: "system",
  viewMode: "grid",
  sidebarCollapsed: false,
  notifications: {
    email: true,
    push: true,
    sms: false,
  },
  favorites: [],
  filters: {},
  dashboardLayout: "default",
};

// Keys that reach Object.prototype. `source` is the caller's preferences JSON,
// so these must never be used as merge targets.
//
// Measured, so the comment does not overstate it: with `result = { ...target }`
// this function is NOT a global prototype-pollution sink today — the spread
// makes a fresh object every call, so `result["__proto__"] = x` rebinds only
// that object, and `Object.prototype` is left alone (verified for
// `{"__proto__":…}`, `{"constructor":{"prototype":…}}` and nested forms).
// The filter is here because that safety is an accident of one line: change
// the spread to a mutation or to Object.assign onto a shared default and the
// sink becomes real, with nothing in the signature to warn you.
const FORBIDDEN_MERGE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function deepMerge(
  target: Record<string, any>,
  source: Record<string, any>,
): Record<string, any> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (FORBIDDEN_MERGE_KEYS.has(key)) continue;
    if (
      source[key] &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === "object" &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

@Injectable()
export class UserPreferencesService {
  private readonly logger = new Logger(UserPreferencesService.name);

  constructor(private readonly databaseService: DatabaseService) {}

  async getPreferences(userId: string): Promise<UserPreferencesResponseDto> {
    const { data, error } = await this.databaseService.supabase
      .from("user_preferences")
      .select("*")
      .eq("user_id", userId)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return {
          userId,
          preferences: { ...DEFAULT_PREFERENCES },
        };
      }
      this.logger.error("Failed to fetch user preferences", {
        userId,
        error: error.message,
      });
      throw error;
    }

    return {
      userId: data.user_id,
      preferences: { ...DEFAULT_PREFERENCES, ...data.preferences },
      updatedAt: data.updated_at,
    };
  }

  async updatePreferences(
    userId: string,
    partial: Record<string, any>,
  ): Promise<UserPreferencesResponseDto> {
    const { data: existing } = await this.databaseService.supabase
      .from("user_preferences")
      .select("preferences")
      .eq("user_id", userId)
      .single();

    const currentPrefs = existing?.preferences ?? { ...DEFAULT_PREFERENCES };
    const merged = deepMerge(currentPrefs, partial);

    if (existing) {
      const { data, error } = await this.databaseService.supabase
        .from("user_preferences")
        .update({ preferences: merged })
        .eq("user_id", userId)
        .select("*")
        .single();

      if (error) {
        this.logger.error("Failed to update user preferences", {
          userId,
          error: error.message,
        });
        throw error;
      }

      return {
        userId: data.user_id,
        preferences: data.preferences,
        updatedAt: data.updated_at,
      };
    }

    const { data, error } = await this.databaseService.supabase
      .from("user_preferences")
      .insert({ user_id: userId, preferences: merged })
      .select("*")
      .single();

    if (error) {
      this.logger.error("Failed to create user preferences", {
        userId,
        error: error.message,
      });
      throw error;
    }

    return {
      userId: data.user_id,
      preferences: data.preferences,
      updatedAt: data.updated_at,
    };
  }
}
