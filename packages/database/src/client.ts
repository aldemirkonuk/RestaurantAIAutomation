import { createClient, SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "./types/database.types"

let supabaseClient: SupabaseClient<Database> | null = null

export interface SupabaseConfig {
  url: string
  anonKey?: string
  serviceRoleKey?: string
}

/**
 * Initialize the Supabase client
 * Call this once at app startup with your credentials
 */
export function initializeSupabase(config: SupabaseConfig): SupabaseClient<Database> {
  if (supabaseClient) {
    return supabaseClient
  }

  const key = config.serviceRoleKey || config.anonKey
  if (!key) {
    throw new Error("Either anonKey or serviceRoleKey must be provided")
  }

  supabaseClient = createClient<Database>(config.url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })

  return supabaseClient
}

/**
 * Get the initialized Supabase client
 * Throws an error if not initialized
 */
export function getSupabaseClient(): SupabaseClient<Database> {
  if (!supabaseClient) {
    throw new Error(
      "Supabase client not initialized. Call initializeSupabase() first."
    )
  }
  return supabaseClient
}

/**
 * Create a new Supabase client instance (for testing or multiple projects)
 */
export function createSupabaseClient(config: SupabaseConfig): SupabaseClient<Database> {
  const key = config.serviceRoleKey || config.anonKey
  if (!key) {
    throw new Error("Either anonKey or serviceRoleKey must be provided")
  }

  return createClient<Database>(config.url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

