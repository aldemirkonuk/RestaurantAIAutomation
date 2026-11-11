/**
 * Supabase Client Integration
 * 
 * The browser anon-key Supabase client, and nothing else. Its query helpers
 * (getInventory, getDashboardStats and the rest) had no importer and are gone:
 * pages read through the gateway (src/services/api). getDashboardStats still
 * counted stock <= par, against the one below-par answer, v_low_stock_items.
 */

import { createClient } from '@supabase/supabase-js'

// Get environment variables
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ''
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

// Create Supabase client with safe defaults
// If URL/key are empty, create a mock client to prevent crashes
export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : createClient('https://placeholder.supabase.co', 'placeholder-key')

export default supabase

