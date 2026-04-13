# Feature Flags Implementation

## Overview

A comprehensive feature flags system has been implemented to allow restaurants to enable/disable specific features on a per-restaurant basis. This system is accessible through the Settings page in the web application.

## What Was Implemented

### 1. Database Migration
- **File**: `services/database/migrations/011_add_restaurant_feature_flags.sql`
- Created `restaurant_feature_flags` table with 22 feature flags
- Added helper function `get_restaurant_feature_flag()` for easy feature checking
- All features default to `true` (enabled) for backward compatibility

### 2. Backend API (NestJS)
- **Module**: `apps/api-gateway/src/settings/`
- **Endpoints**:
  - `GET /api/v1/settings/feature-flags` - Get all feature flags for current restaurant
  - `PUT /api/v1/settings/feature-flags` - Update feature flags (partial updates supported)
  - `POST /api/v1/settings/feature-flags/check` - Check if a specific feature is enabled
- **Service**: `SettingsService` handles all database operations
- Integrated with authentication and tenant guards

### 3. Frontend UI
- **Page**: `apps/web/src/pages/Settings.tsx`
- Beautiful, organized UI with:
  - Feature flags grouped by category (Inventory, Procurement, AI, Integrations, Analytics, Operations)
  - Toggle switches for each feature
  - Real-time change tracking
  - Save/Reset functionality
  - Visual feedback with icons and descriptions

### 4. API Client
- **File**: `apps/web/src/services/api/settings.ts`
- TypeScript interfaces for type safety
- Axios client integration

## Available Feature Flags

### Inventory Management
- `enable_inventory_storage_locations` - Track wine storage locations
- `enable_invoice_scanning` - OCR invoice scanning
- `enable_check_scanning` - Digital check scanning

### Procurement & Orders
- `enable_auto_procurement` - Automatic order initiation
- `enable_recurring_orders` - Scheduled recurring orders
- `enable_auction_purchases` - Auction purchase tracking

### AI Features
- `enable_ai_negotiation` - AI-powered supplier negotiation
- `enable_sommelier_ai` - AI sommelier recommendations
- `enable_voice_agent` - Hands-free voice commands
- `enable_menu_analyzer` - Menu photo analysis
- `enable_wine_pairing_ai` - Food-wine pairing AI

### Integrations
- `enable_calendar_sync` - Google Calendar sync
- `enable_whatsapp_business` - WhatsApp Business integration
- `enable_quickbooks_sync` - QuickBooks financial sync

### Analytics & Reporting
- `enable_predictive_analytics` - Demand forecasting
- `enable_profit_margin_tracking` - Financial performance tracking
- `enable_pour_cost_optimizer` - Pour cost optimization

### Operations
- `enable_visual_verification` - YOLOv8 label recognition
- `enable_guest_crm` - Guest preference tracking
- `enable_compliance_autopilot` - Regulatory compliance
- `enable_shrinkage_detective` - Loss prevention AI
- `enable_staff_training_simulator` - Wine education training

## Usage

### For Developers

#### Check if a feature is enabled in Python (Backend)
```python
from core.database import get_supabase_client

def is_feature_enabled(restaurant_id: str, feature_name: str) -> bool:
    result = get_supabase_client().rpc(
        'get_restaurant_feature_flag',
        {
            'p_restaurant_id': restaurant_id,
            'p_feature_name': feature_name
        }
    ).execute()
    return result.data if result.data is not None else True
```

#### Check if a feature is enabled in TypeScript (Frontend)
```typescript
import { settingsApi } from '../services/api/settings';

const isEnabled = await settingsApi.checkFeatureFlag(
  restaurantId,
  'inventory_storage_locations'
);
```

### For Managers

1. Navigate to **Settings** in the sidebar
2. Browse feature flags organized by category
3. Toggle features on/off as needed
4. Click **Save Changes** to apply
5. Changes take effect immediately

## Services Status

### Started Services
- ✅ **API Gateway** (NestJS) - Running on port 4000
- ✅ **Agent Orchestrator** (FastAPI) - Running on port 8000
- ✅ **Frontend** (React/Vite) - Running on port 3000

### Docker Services (Requires Docker Desktop)
To start Docker services:
```bash
docker-compose up -d
```

This will start:
- PostgreSQL (port 5432)
- RabbitMQ (port 5672, UI on 15672)
- Redis (port 6379)
- pgAdmin (port 5050)

### Quick Start Script
A convenience script is available:
```bash
./start-all.sh
```

This script will:
1. Check Docker status
2. Start Docker services if available
3. Start API Gateway
4. Start Agent Orchestrator
5. Start Frontend

## Database Migration

To apply the feature flags migration:
```bash
cd services/database
pnpm migrate
```

Or manually:
```bash
psql -U postgres -d wineops -f migrations/011_add_restaurant_feature_flags.sql
```

## Testing

### Test Feature Flags API
```bash
# Get feature flags
curl -X GET http://localhost:4000/api/v1/settings/feature-flags \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "X-Restaurant-Id: YOUR_RESTAURANT_ID"

# Update a feature flag
curl -X PUT http://localhost:4000/api/v1/settings/feature-flags \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "X-Restaurant-Id: YOUR_RESTAURANT_ID" \
  -H "Content-Type: application/json" \
  -d '{"enable_inventory_storage_locations": false}'
```

## Future Enhancements

- [ ] Feature flag analytics (track which features are most/least used)
- [ ] Feature flag presets (e.g., "Minimal", "Full Suite", "AI-Only")
- [ ] Per-user feature flags (override restaurant defaults)
- [ ] Feature flag change history/audit log
- [ ] Scheduled feature flag changes (enable/disable on specific dates)

## Notes

- All features default to **enabled** for backward compatibility
- Feature flags are stored per restaurant (multi-tenant support)
- Changes are immediate after saving
- The UI provides clear visual feedback for enabled/disabled states
- Feature flags are checked server-side for security
