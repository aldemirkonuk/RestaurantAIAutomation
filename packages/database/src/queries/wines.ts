import { getSupabaseClient } from "../client"
import type { Wine } from "../types/database.types"

/**
 * Get all wines from master library
 */
export async function getAllWines(): Promise<Wine[]> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from("master_wine_library")
    .select("*")
    .order("name", { ascending: true })

  if (error) throw error
  return data || []
}

/**
 * Get wine by ID
 */
export async function getWineById(wineId: string): Promise<Wine | null> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from("master_wine_library")
    .select("*")
    .eq("wine_id", wineId)
    .single()

  if (error) {
    if (error.code === "PGRST116") return null // Not found
    throw error
  }
  return data
}

/**
 * Search wines by name, producer, or varietal
 */
export async function searchWines(query: string): Promise<Wine[]> {
  const supabase = getSupabaseClient()
  const { data, error} = await supabase
    .from("master_wine_library")
    .select("*")
    .or(`name.ilike.%${query}%,producer.ilike.%${query}%,varietal.ilike.%${query}%`)
    .order("name", { ascending: true })
    .limit(50)

  if (error) throw error
  return data || []
}

/**
 * Filter wines by type, region, or price range
 */
export async function filterWines(filters: {
  type?: Wine["type"]
  region?: string
  country?: string
  vintage?: number
}): Promise<Wine[]> {
  const supabase = getSupabaseClient()
  let query = supabase.from("master_wine_library").select("*")

  if (filters.type) query = query.eq("type", filters.type)
  if (filters.region) query = query.eq("region", filters.region)
  if (filters.country) query = query.eq("country", filters.country)
  if (filters.vintage) query = query.eq("vintage", filters.vintage)

  const { data, error } = await query.order("name", { ascending: true })

  if (error) throw error
  return data || []
}

/**
 * Get wines by producer
 */
export async function getWinesByProducer(producer: string): Promise<Wine[]> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from("master_wine_library")
    .select("*")
    .eq("producer", producer)
    .order("vintage", { ascending: false })

  if (error) throw error
  return data || []
}

/**
 * Create new wine in master library
 */
export async function createWine(
  wine: Omit<Wine, "wine_id" | "created_at" | "updated_at">
): Promise<Wine> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from("master_wine_library")
    .insert(wine)
    .select()
    .single()

  if (error) throw error
  return data
}

/**
 * Update wine in master library
 */
export async function updateWine(
  wineId: string,
  updates: Partial<Omit<Wine, "wine_id" | "created_at" | "updated_at">>
): Promise<Wine> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from("master_wine_library")
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq("wine_id", wineId)
    .select()
    .single()

  if (error) throw error
  return data
}

/**
 * Delete wine from master library
 */
export async function deleteWine(wineId: string): Promise<void> {
  const supabase = getSupabaseClient()
  const { error } = await supabase
    .from("master_wine_library")
    .delete()
    .eq("wine_id", wineId)

  if (error) throw error
}

/**
 * Get wine recommendations based on similarity
 * This is a placeholder - in production, you'd use pgvector similarity search
 */
export async function getRecommendedWines(
  wineId: string,
  limit: number = 5
): Promise<Wine[]> {
  const wine = await getWineById(wineId)
  if (!wine) return []

  // Simple recommendation: same type and region (skip filters the source wine
  // does not define, since PostgREST .eq cannot take an undefined value)
  const supabase = getSupabaseClient()
  let query = supabase
    .from("master_wine_library")
    .select("*")
    .neq("wine_id", wineId)

  if (wine.type) query = query.eq("type", wine.type)
  if (wine.region) query = query.eq("region", wine.region)

  const { data, error } = await query.limit(limit)

  if (error) throw error
  return data || []
}

