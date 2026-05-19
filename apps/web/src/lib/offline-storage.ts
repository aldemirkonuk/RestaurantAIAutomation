/**
 * Offline Storage Service
 * =======================
 * Provides persistent storage for offline data using IndexedDB with localStorage fallback.
 * Handles pending mutations, entity caching, and sync status tracking.
 */

// =============================================================================
// TYPES
// =============================================================================

export interface PendingMutation {
  id: string
  type: string // e.g., 'calendar.create', 'provider.update'
  data: unknown
  tempId?: string
  timestamp: Date
  retryCount: number
  lastError?: string
}

export interface CachedEntity<T = unknown> {
  key: string
  data: T
  timestamp: Date
  expiresAt?: Date
}

export interface SyncStatus {
  entity: string
  lastSyncTime: Date | null
  pendingCount: number
  lastError?: string
}

// =============================================================================
// STORAGE KEYS
// =============================================================================

// =============================================================================
// INDEXEDDB SETUP
// =============================================================================

const DB_NAME = 'wineops_offline'
const DB_VERSION = 1

const STORES = {
  PENDING_MUTATIONS: 'pending_mutations',
  ENTITY_CACHE: 'entity_cache',
  SYNC_STATUS: 'sync_status',
} as const

let dbInstance: IDBDatabase | null = null

async function getDB(): Promise<IDBDatabase> {
  if (dbInstance) return dbInstance

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => {
      console.error('IndexedDB error:', request.error)
      reject(request.error)
    }

    request.onsuccess = () => {
      dbInstance = request.result
      resolve(dbInstance)
    }

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result

      // Pending mutations store
      if (!db.objectStoreNames.contains(STORES.PENDING_MUTATIONS)) {
        const mutationStore = db.createObjectStore(STORES.PENDING_MUTATIONS, { keyPath: 'id' })
        mutationStore.createIndex('type', 'type', { unique: false })
        mutationStore.createIndex('timestamp', 'timestamp', { unique: false })
      }

      // Entity cache store
      if (!db.objectStoreNames.contains(STORES.ENTITY_CACHE)) {
        const cacheStore = db.createObjectStore(STORES.ENTITY_CACHE, { keyPath: 'key' })
        cacheStore.createIndex('timestamp', 'timestamp', { unique: false })
      }

      // Sync status store
      if (!db.objectStoreNames.contains(STORES.SYNC_STATUS)) {
        db.createObjectStore(STORES.SYNC_STATUS, { keyPath: 'entity' })
      }
    }
  })
}

// =============================================================================
// INDEXEDDB HELPERS
// =============================================================================

async function idbGet<T>(storeName: string, key: string): Promise<T | null> {
  try {
    const db = await getDB()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readonly')
      const store = transaction.objectStore(storeName)
      const request = store.get(key)

      request.onsuccess = () => resolve(request.result || null)
      request.onerror = () => reject(request.error)
    })
  } catch (error) {
    console.warn('IndexedDB get failed, using localStorage fallback', error)
    return localStorageGet(storeName, key)
  }
}

async function idbGetAll<T>(storeName: string): Promise<T[]> {
  try {
    const db = await getDB()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readonly')
      const store = transaction.objectStore(storeName)
      const request = store.getAll()

      request.onsuccess = () => resolve(request.result || [])
      request.onerror = () => reject(request.error)
    })
  } catch (error) {
    console.warn('IndexedDB getAll failed, using localStorage fallback', error)
    return localStorageGetAll(storeName)
  }
}

async function idbPut<T extends { id?: string; key?: string; entity?: string }>(storeName: string, value: T): Promise<void> {
  try {
    const db = await getDB()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readwrite')
      const store = transaction.objectStore(storeName)
      const request = store.put(value)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  } catch (error) {
    console.warn('IndexedDB put failed, using localStorage fallback', error)
    localStoragePut(storeName, value)
  }
}

async function idbDelete(storeName: string, key: string): Promise<void> {
  try {
    const db = await getDB()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readwrite')
      const store = transaction.objectStore(storeName)
      const request = store.delete(key)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  } catch (error) {
    console.warn('IndexedDB delete failed, using localStorage fallback', error)
    localStorageDelete(storeName, key)
  }
}

// =============================================================================
// LOCALSTORAGE FALLBACK
// =============================================================================

function localStorageGet<T>(storeName: string, key: string): T | null {
  try {
    const data = localStorage.getItem(`${storeName}_${key}`)
    return data ? JSON.parse(data) : null
  } catch {
    return null
  }
}

function localStorageGetAll<T>(storeName: string): T[] {
  try {
    const allData = localStorage.getItem(`${storeName}_all`)
    return allData ? JSON.parse(allData) : []
  } catch {
    return []
  }
}

function localStoragePut<T extends { id?: string; key?: string; entity?: string }>(
  storeName: string,
  value: T
): void {
  try {
    const key = value.id || value.key || value.entity || 'unknown'
    localStorage.setItem(`${storeName}_${key}`, JSON.stringify(value))
    
    // Also update the "all" collection
    const allData = localStorageGetAll<T>(storeName)
    const existingIndex = allData.findIndex(
      (item) => (item.id || item.key || item.entity) === key
    )
    if (existingIndex >= 0) {
      allData[existingIndex] = value
    } else {
      allData.push(value)
    }
    localStorage.setItem(`${storeName}_all`, JSON.stringify(allData))
  } catch (error) {
    console.error('localStorage put failed:', error)
  }
}

function localStorageDelete(storeName: string, key: string): void {
  try {
    localStorage.removeItem(`${storeName}_${key}`)
    
    // Also update the "all" collection
    const allData = localStorageGetAll<{ id?: string; key?: string; entity?: string }>(storeName)
    const filtered = allData.filter(
      (item) => (item.id || item.key || item.entity) !== key
    )
    localStorage.setItem(`${storeName}_all`, JSON.stringify(filtered))
  } catch (error) {
    console.error('localStorage delete failed:', error)
  }
}

// =============================================================================
// OFFLINE STORAGE API
// =============================================================================

export const offlineStorage = {
  // =========================================================================
  // PENDING MUTATIONS
  // =========================================================================

  /**
   * Add a pending mutation to the queue
   */
  async addPendingMutation(mutation: Omit<PendingMutation, 'id' | 'retryCount'>): Promise<string> {
    const id = `mutation_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const fullMutation: PendingMutation = {
      ...mutation,
      id,
      retryCount: 0,
      timestamp: new Date(mutation.timestamp),
    }
    
    await idbPut(STORES.PENDING_MUTATIONS, fullMutation)
    console.log(`[OfflineStorage] Queued mutation: ${mutation.type}`, id)
    return id
  },

  /**
   * Get all pending mutations
   */
  async getPendingMutations(): Promise<PendingMutation[]> {
    const mutations = await idbGetAll<PendingMutation>(STORES.PENDING_MUTATIONS)
    return mutations.sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    )
  },

  /**
   * Get pending mutations by type
   */
  async getPendingMutationsByType(type: string): Promise<PendingMutation[]> {
    const all = await this.getPendingMutations()
    return all.filter((m) => m.type === type)
  },

  /**
   * Update a pending mutation (e.g., increment retry count)
   */
  async updatePendingMutation(
    id: string,
    updates: Partial<PendingMutation>
  ): Promise<void> {
    const existing = await idbGet<PendingMutation>(STORES.PENDING_MUTATIONS, id)
    if (existing) {
      await idbPut(STORES.PENDING_MUTATIONS, { ...existing, ...updates })
    }
  },

  /**
   * Remove a pending mutation (after successful sync)
   */
  async removePendingMutation(id: string): Promise<void> {
    await idbDelete(STORES.PENDING_MUTATIONS, id)
    console.log(`[OfflineStorage] Removed mutation:`, id)
  },

  /**
   * Clear all pending mutations
   */
  async clearPendingMutations(): Promise<void> {
    const all = await this.getPendingMutations()
    for (const mutation of all) {
      await idbDelete(STORES.PENDING_MUTATIONS, mutation.id)
    }
  },

  // =========================================================================
  // ENTITY CACHE
  // =========================================================================

  /**
   * Cache an entity or collection
   */
  async cacheEntity<T>(
    key: string,
    data: T,
    ttlMs?: number
  ): Promise<void> {
    const cached: CachedEntity<T> = {
      key,
      data,
      timestamp: new Date(),
      expiresAt: ttlMs ? new Date(Date.now() + ttlMs) : undefined,
    }
    await idbPut(STORES.ENTITY_CACHE, cached)
    console.log(`[OfflineStorage] Cached entity:`, key)
  },

  /**
   * Get a cached entity
   */
  async getCachedEntity<T>(key: string): Promise<T | null> {
    const cached = await idbGet<CachedEntity<T>>(STORES.ENTITY_CACHE, key)
    
    if (!cached) return null
    
    // Check if expired
    if (cached.expiresAt && new Date(cached.expiresAt) < new Date()) {
      await idbDelete(STORES.ENTITY_CACHE, key)
      return null
    }
    
    return cached.data
  },

  /**
   * Invalidate cached entity
   */
  async invalidateCache(key: string): Promise<void> {
    await idbDelete(STORES.ENTITY_CACHE, key)
    console.log(`[OfflineStorage] Invalidated cache:`, key)
  },

  /**
   * Invalidate all caches matching a prefix
   */
  async invalidateCacheByPrefix(prefix: string): Promise<void> {
    const all = await idbGetAll<CachedEntity>(STORES.ENTITY_CACHE)
    for (const cached of all) {
      if (cached.key.startsWith(prefix)) {
        await idbDelete(STORES.ENTITY_CACHE, cached.key)
      }
    }
    console.log(`[OfflineStorage] Invalidated caches with prefix:`, prefix)
  },

  // =========================================================================
  // SYNC STATUS
  // =========================================================================

  /**
   * Get last sync time for an entity type
   */
  async getLastSyncTime(entity: string): Promise<Date | null> {
    const status = await idbGet<SyncStatus>(STORES.SYNC_STATUS, entity)
    return status?.lastSyncTime ? new Date(status.lastSyncTime) : null
  },

  /**
   * Update sync status for an entity type
   */
  async updateSyncStatus(
    entity: string,
    updates: Partial<Omit<SyncStatus, 'entity'>>
  ): Promise<void> {
    const existing = await idbGet<SyncStatus>(STORES.SYNC_STATUS, entity)
    const updated: SyncStatus = {
      entity,
      lastSyncTime: existing?.lastSyncTime || null,
      pendingCount: existing?.pendingCount || 0,
      ...updates,
    }
    await idbPut(STORES.SYNC_STATUS, updated)
  },

  /**
   * Mark entity as synced
   */
  async markSynced(entity: string): Promise<void> {
    await this.updateSyncStatus(entity, {
      lastSyncTime: new Date(),
      lastError: undefined,
    })
    console.log(`[OfflineStorage] Marked synced:`, entity)
  },

  /**
   * Get all sync statuses
   */
  async getAllSyncStatuses(): Promise<SyncStatus[]> {
    return idbGetAll<SyncStatus>(STORES.SYNC_STATUS)
  },

  // =========================================================================
  // UTILITIES
  // =========================================================================

  /**
   * Check if IndexedDB is available
   */
  isIndexedDBAvailable(): boolean {
    try {
      return typeof indexedDB !== 'undefined'
    } catch {
      return false
    }
  },

  /**
   * Get storage statistics
   */
  async getStorageStats(): Promise<{
    pendingMutations: number
    cachedEntities: number
    estimatedSize: string
  }> {
    const mutations = await this.getPendingMutations()
    const cached = await idbGetAll<CachedEntity>(STORES.ENTITY_CACHE)
    
    // Estimate size
    const data = JSON.stringify({ mutations, cached })
    const bytes = new Blob([data]).size
    const kb = bytes / 1024
    const mb = kb / 1024
    
    return {
      pendingMutations: mutations.length,
      cachedEntities: cached.length,
      estimatedSize: mb >= 1 ? `${mb.toFixed(2)} MB` : `${kb.toFixed(2)} KB`,
    }
  },

  /**
   * Clear all offline storage
   */
  async clearAll(): Promise<void> {
    await this.clearPendingMutations()
    
    const cached = await idbGetAll<CachedEntity>(STORES.ENTITY_CACHE)
    for (const item of cached) {
      await idbDelete(STORES.ENTITY_CACHE, item.key)
    }
    
    const statuses = await this.getAllSyncStatuses()
    for (const status of statuses) {
      await idbDelete(STORES.SYNC_STATUS, status.entity)
    }
    
    console.log('[OfflineStorage] Cleared all storage')
  },
}

export default offlineStorage
