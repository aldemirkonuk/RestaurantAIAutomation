# @wineops/database

Type-safe Supabase database client and query helpers for WineOps AI.

## Features

- 🔒 **Type-Safe** - Full TypeScript support with generated types
- 🎯 **Query Helpers** - Pre-built functions for common operations
- 📦 **Singleton Pattern** - Reusable client across your app
- 🚀 **Optimized** - Connection pooling and caching
- 📊 **Rich Types** - Complete database schema types

## Installation

This is a workspace package. Install dependencies from the root:

```bash
pnpm install
```

## Quick Start

### 1. Initialize the Client

```typescript
import { initializeSupabase } from "@wineops/database"

// Initialize once at app startup
initializeSupabase({
  url: process.env.SUPABASE_URL!,
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!, // Server-side
  // or
  anonKey: process.env.SUPABASE_ANON_KEY!, // Client-side
})
```

### 2. Use Query Helpers

```typescript
import {
  getAllWines,
  getRestaurantInventory,
  getPendingOrders,
} from "@wineops/database"

// Get all wines
const wines = await getAllWines()

// Get restaurant inventory
const inventory = await getRestaurantInventory("restaurant_123")

// Get pending orders
const pendingOrders = await getPendingOrders("restaurant_123")
```

### 3. Direct Client Access

```typescript
import { getSupabaseClient } from "@wineops/database"

const supabase = getSupabaseClient()
const { data, error } = await supabase
  .from("master_wine_library")
  .select("*")
  .limit(10)
```

## API Reference

### Client

#### `initializeSupabase(config)`

Initialize the Supabase client. Call once at app startup.

```typescript
interface SupabaseConfig {
  url: string
  anonKey?: string          // For client-side
  serviceRoleKey?: string   // For server-side (bypasses RLS)
}
```

#### `getSupabaseClient()`

Get the initialized client. Throws if not initialized.

```typescript
const supabase = getSupabaseClient()
```

#### `createSupabaseClient(config)`

Create a new client instance (for testing or multi-tenant).

```typescript
const testClient = createSupabaseClient({ url, anonKey })
```

---

### Wine Queries

#### `getAllWines()`

Get all wines from the master library.

```typescript
const wines = await getAllWines()
```

#### `getWineById(wineId)`

Get a specific wine by ID.

```typescript
const wine = await getWineById("WINE_001")
```

#### `searchWines(query)`

Search wines by name, producer, or varietal.

```typescript
const results = await searchWines("Cabernet")
```

#### `filterWines(filters)`

Filter wines by criteria.

```typescript
const wines = await filterWines({
  type: "red",
  region: "Napa Valley",
  vintage: 2019,
})
```

#### `getWinesByProducer(producer)`

Get all wines from a specific producer.

```typescript
const wines = await getWinesByProducer("Château Margaux")
```

#### `createWine(wine)`

Add a new wine to the master library.

```typescript
const newWine = await createWine({
  wine_id: "WINE_201",
  name: "Cabernet Sauvignon 2020",
  producer: "Silver Oak",
  type: "red",
  // ... other fields
})
```

#### `updateWine(wineId, updates)`

Update an existing wine.

```typescript
const updated = await updateWine("WINE_001", {
  price_range: "$$$$",
  vintage: 2021,
})
```

#### `deleteWine(wineId)`

Remove a wine from the master library.

```typescript
await deleteWine("WINE_001")
```

#### `getRecommendedWines(wineId, limit?)`

Get recommended wines based on similarity.

```typescript
const recommendations = await getRecommendedWines("WINE_001", 5)
```

---

### Inventory Queries

#### `getRestaurantInventory(restaurantId)`

Get all inventory items for a restaurant.

```typescript
const inventory = await getRestaurantInventory("restaurant_123")
```

#### `getInventoryWithWines(restaurantId)`

Get inventory items with full wine details (joined query).

```typescript
const inventory = await getInventoryWithWines("restaurant_123")
// Returns: { inventory_item, wine_details }[]
```

#### `getLowStockItems(restaurantId)`

Get items below their threshold.

```typescript
const lowStock = await getLowStockItems("restaurant_123")
```

#### `getInventorySummary(restaurantId)`

Get inventory statistics.

```typescript
const summary = await getInventorySummary("restaurant_123")
// Returns: {
//   total_wines: number
//   low_stock_count: number
//   critical_stock_count: number
//   healthy_stock_count: number
//   total_value: number
// }
```

#### `updateInventoryStock(inventoryId, stockLive)`

Update stock level for an item.

```typescript
const updated = await updateInventoryStock("inv_001", 24)
```

#### `createInventoryItem(item)`

Add a new inventory item.

```typescript
const newItem = await createInventoryItem({
  restaurant_id: "restaurant_123",
  wine_id: "WINE_001",
  stock_live: 12,
  stock_buffer: 0,
  threshold_min: 5,
  threshold_max: 24,
})
```

#### `deleteInventoryItem(inventoryId)`

Remove an inventory item.

```typescript
await deleteInventoryItem("inv_001")
```

---

### Order Queries

#### `getRestaurantOrders(restaurantId, filters?)`

Get all orders for a restaurant.

```typescript
const orders = await getRestaurantOrders("restaurant_123", {
  status: "pending_approval",
  date_from: "2026-01-01",
})
```

#### `getOrderById(orderId)`

Get a specific order.

```typescript
const order = await getOrderById("ORDER-123")
```

#### `getPendingOrders(restaurantId)`

Get orders pending manager approval.

```typescript
const pending = await getPendingOrders("restaurant_123")
```

#### `createOrder(order)`

Create a new procurement order.

```typescript
const newOrder = await createOrder({
  restaurant_id: "restaurant_123",
  wine_id: "WINE_001",
  provider_id: "provider_001",
  quantity: 12,
  status: "pending_approval",
  suggested_price: 25.0,
})
```

#### `updateOrderStatus(orderId, status, additionalData?)`

Update order status.

```typescript
const updated = await updateOrderStatus("ORDER-123", "approved", {
  final_price: 24.5,
})
```

#### `approveOrder(orderId, finalPrice?)`

Approve an order (shorthand).

```typescript
const approved = await approveOrder("ORDER-123", 24.5)
```

#### `cancelOrder(orderId)`

Cancel an order.

```typescript
const cancelled = await cancelOrder("ORDER-123")
```

#### `addNegotiationMessage(orderId, sender, message, priceOffered?)`

Add a message to negotiation history.

```typescript
await addNegotiationMessage(
  "ORDER-123",
  "agent",
  "Can you offer a better price for 24 bottles?",
  23.0
)
```

#### `getOrdersSummary(restaurantId)`

Get order statistics.

```typescript
const summary = await getOrdersSummary("restaurant_123")
// Returns: {
//   total: number
//   pending: number
//   approved: number
//   ordered: number
//   delivered: number
//   cancelled: number
//   total_value: number
// }
```

---

## Types

All database types are exported and available:

```typescript
import type {
  Restaurant,
  User,
  Wine,
  InventoryItem,
  Provider,
  ProcurementOrder,
  AuditLog,
  NotificationPreference,
  SensoryProfile,
  WineStructure,
  ProviderInfo,
  InventorySummary,
  WineSearchResult,
} from "@wineops/database"
```

### Example: Wine Type

```typescript
interface Wine {
  wine_id: string
  name: string
  producer?: string
  vintage?: number
  varietal?: string
  region?: string
  country?: string
  type?: "red" | "white" | "rosé" | "sparkling" | "dessert" | "fortified"
  color?: string
  abv?: number
  price_range?: string
  tasting_notes?: string
  food_pairings?: string[]
  sensory_profile?: SensoryProfile
  structure?: WineStructure
  provider_info?: ProviderInfo
  embeddings?: number[]
  created_at: string
  updated_at: string
}
```

---

## Error Handling

All query functions throw errors. Wrap in try-catch:

```typescript
try {
  const wines = await getAllWines()
} catch (error) {
  console.error("Failed to fetch wines:", error)
}
```

For optional results (e.g., `getWineById`), check for `null`:

```typescript
const wine = await getWineById("WINE_001")
if (!wine) {
  console.log("Wine not found")
}
```

---

## Development

### Build

```bash
cd packages/database
pnpm run build
```

### Watch mode

```bash
pnpm run dev
```

### Type check

```bash
pnpm run type-check
```

---

## Database Schema

This package provides types for the complete WineOps database schema:

**Core Tables:**
- `restaurants` - Restaurant information
- `users` - User accounts and roles
- `master_wine_library` - Global wine catalog (200+ wines)
- `restaurant_inventory` - Per-restaurant stock levels
- `providers` - Wine suppliers
- `procurement_orders` - Purchase orders
- `audit_logs` - System activity logs
- `notification_preferences` - User notification settings

**Extended Tables:**
- `calendar_events` - Important dates
- `report_schedules` - Automated reports
- `pos_transactions` - POS sync data
- ... and 13 more tables

See `md_files/02-architecture/DATABASE_SCHEMA.sql` for complete schema.

---

## Real-Time Subscriptions

Subscribe to table changes:

```typescript
const supabase = getSupabaseClient()

supabase
  .channel("inventory-changes")
  .on(
    "postgres_changes",
    {
      event: "*",
      schema: "public",
      table: "restaurant_inventory",
    },
    (payload) => {
      console.log("Inventory changed:", payload)
    }
  )
  .subscribe()
```

---

## Best Practices

1. **Initialize once** - Call `initializeSupabase()` at app startup
2. **Use query helpers** - They provide type safety and error handling
3. **Handle errors** - Always wrap queries in try-catch
4. **Check for null** - Optional queries return `null` if not found
5. **Use service role key** - On server-side to bypass RLS
6. **Use anon key** - On client-side with RLS enabled

---

## Testing

Create a test client for isolated testing:

```typescript
import { createSupabaseClient } from "@wineops/database"

const testClient = createSupabaseClient({
  url: "https://test.supabase.co",
  serviceRoleKey: "test-key",
})
```

---

## License

Proprietary - WineOps AI

