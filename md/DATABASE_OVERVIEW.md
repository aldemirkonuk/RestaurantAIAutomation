# WineOps AI - Database Overview

**Version**: 2.6.0  
**Database**: Supabase PostgreSQL  
**Last Updated**: January 2026

---

## Table of Contents

1. [Overview](#overview)
2. [Core Tables](#core-tables)
3. [Inventory Tables](#inventory-tables)
4. [Procurement Tables](#procurement-tables)
5. [Event System Tables](#event-system-tables)
6. [Calendar Tables](#calendar-tables)
7. [Communication Tables](#communication-tables)
8. [Integration Tables](#integration-tables)
9. [Row Level Security](#row-level-security)
10. [Migrations](#migrations)

---

## Overview

### Database Statistics

| Metric | Count |
|--------|-------|
| Total Tables | 30+ |
| Core Tables | 6 |
| Inventory Tables | 4 |
| Procurement Tables | 4 |
| Event System Tables | 4 |
| Calendar Tables | 2 |
| Communication Tables | 4 |
| Integration Tables | 3 |

### Key Features

- **Multi-Tenant**: All data scoped by `restaurant_id`
- **Row Level Security**: Enforced via `user_restaurant_access`
- **Realtime**: Enabled on key tables for live updates
- **Soft Deletes**: `deleted_at` column on relevant tables
- **Audit Trail**: `created_at`, `updated_at` on all tables

---

## Core Tables

### users

Primary user accounts table.

```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'staff',
    avatar_url TEXT,
    phone VARCHAR(50),
    email_verified BOOLEAN DEFAULT false,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_users_email ON users(email);
```

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| email | VARCHAR | Unique email address |
| password_hash | VARCHAR | Bcrypt hashed password |
| name | VARCHAR | Display name |
| role | VARCHAR | Global role (owner/manager/staff) |

---

### restaurants

Restaurant/tenant entities.

```sql
CREATE TABLE restaurants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    address TEXT,
    city VARCHAR(100),
    state VARCHAR(50),
    zip_code VARCHAR(20),
    country VARCHAR(100) DEFAULT 'USA',
    phone VARCHAR(50),
    email VARCHAR(255),
    timezone VARCHAR(50) DEFAULT 'America/New_York',
    currency VARCHAR(10) DEFAULT 'USD',
    settings JSONB DEFAULT '{}',
    toast_restaurant_guid VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);
```

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| name | VARCHAR | Restaurant name |
| timezone | VARCHAR | Timezone for scheduling |
| settings | JSONB | Custom settings |
| toast_restaurant_guid | VARCHAR | Toast POS integration ID |

---

### user_restaurant_access

Multi-tenant access control (junction table).

```sql
CREATE TABLE user_restaurant_access (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    role VARCHAR(50) DEFAULT 'staff',
    permissions JSONB DEFAULT '{}',
    is_primary BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    CONSTRAINT uq_user_restaurant UNIQUE (user_id, restaurant_id)
);

CREATE INDEX idx_ura_user ON user_restaurant_access(user_id);
CREATE INDEX idx_ura_restaurant ON user_restaurant_access(restaurant_id);
```

| Column | Type | Description |
|--------|------|-------------|
| user_id | UUID | FK to users |
| restaurant_id | UUID | FK to restaurants |
| role | VARCHAR | Role within this restaurant |
| is_primary | BOOLEAN | User's primary restaurant |

---

## Inventory Tables

### master_wine_library

Global wine catalog (shared across all restaurants).

```sql
CREATE TABLE master_wine_library (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    producer VARCHAR(255),
    region VARCHAR(255),
    sub_region VARCHAR(255),
    country VARCHAR(100),
    vintage INTEGER,
    grape_variety VARCHAR(255),
    wine_type VARCHAR(50), -- Red, White, Rosé, Sparkling, Dessert
    style VARCHAR(100),
    alcohol_percentage DECIMAL(4,2),
    bottle_size_ml INTEGER DEFAULT 750,
    tasting_notes TEXT,
    food_pairings TEXT[],
    awards TEXT[],
    image_url TEXT,
    barcode VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_mwl_name ON master_wine_library(name);
CREATE INDEX idx_mwl_producer ON master_wine_library(producer);
CREATE INDEX idx_mwl_type ON master_wine_library(wine_type);
```

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| name | VARCHAR | Wine name |
| producer | VARCHAR | Winery/producer |
| vintage | INTEGER | Year (nullable for NV) |
| wine_type | VARCHAR | Red/White/Rosé/etc |
| grape_variety | VARCHAR | Primary grape |

---

### restaurant_inventory

Per-restaurant wine inventory (references master library).

```sql
CREATE TABLE restaurant_inventory (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    master_wine_id UUID REFERENCES master_wine_library(id),
    
    -- Stock management
    stock_live INTEGER DEFAULT 0,
    stock_reserved INTEGER DEFAULT 0,
    threshold_min INTEGER DEFAULT 6,
    threshold_max INTEGER,
    par_level INTEGER,
    
    -- Pricing
    cost_per_unit DECIMAL(10,2),
    sell_price DECIMAL(10,2),
    glass_price DECIMAL(10,2),
    margin_percentage DECIMAL(5,2),
    
    -- Location
    storage_location VARCHAR(255),
    bin_number VARCHAR(50),
    
    -- POS Integration
    toast_item_guid VARCHAR(255),
    menu_section VARCHAR(255),
    is_on_menu BOOLEAN DEFAULT true,
    
    -- Status
    status VARCHAR(50) DEFAULT 'active',
    last_counted_at TIMESTAMPTZ,
    last_sold_at TIMESTAMPTZ,
    
    -- Flags
    is_recent BOOLEAN DEFAULT true,
    is_archive_candidate BOOLEAN DEFAULT false,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,
    
    CONSTRAINT uq_restaurant_wine UNIQUE (restaurant_id, master_wine_id)
);

CREATE INDEX idx_ri_restaurant ON restaurant_inventory(restaurant_id);
CREATE INDEX idx_ri_master_wine ON restaurant_inventory(master_wine_id);
CREATE INDEX idx_ri_toast ON restaurant_inventory(toast_item_guid);
CREATE INDEX idx_ri_low_stock ON restaurant_inventory(restaurant_id, stock_live) 
    WHERE stock_live <= threshold_min;
```

| Column | Type | Description |
|--------|------|-------------|
| restaurant_id | UUID | FK to restaurants |
| master_wine_id | UUID | FK to master_wine_library |
| stock_live | INTEGER | Current stock count |
| threshold_min | INTEGER | Reorder point |
| cost_per_unit | DECIMAL | Purchase cost |
| sell_price | DECIMAL | Selling price |
| toast_item_guid | VARCHAR | Toast POS item mapping |

---

### inventory_transactions

Ledger of all stock movements.

```sql
CREATE TABLE inventory_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id),
    inventory_id UUID NOT NULL REFERENCES restaurant_inventory(id),
    
    transaction_type VARCHAR(50) NOT NULL,
    -- Types: purchase, sale, adjustment, transfer, count, return, spillage, comp
    
    quantity INTEGER NOT NULL, -- Positive for in, negative for out
    balance_before INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    
    unit_cost DECIMAL(10,2),
    total_value DECIMAL(10,2),
    
    source VARCHAR(100), -- toast_pos, manual, inventory_count, procurement
    reference_id UUID, -- FK to related record (order, count, etc.)
    reference_type VARCHAR(50),
    
    performed_by UUID REFERENCES users(id),
    notes TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_it_inventory ON inventory_transactions(inventory_id);
CREATE INDEX idx_it_restaurant ON inventory_transactions(restaurant_id);
CREATE INDEX idx_it_type ON inventory_transactions(transaction_type);
CREATE INDEX idx_it_created ON inventory_transactions(created_at DESC);
```

| Column | Type | Description |
|--------|------|-------------|
| inventory_id | UUID | FK to restaurant_inventory |
| transaction_type | VARCHAR | Type of movement |
| quantity | INTEGER | Amount (+/-) |
| balance_after | INTEGER | Running balance |
| source | VARCHAR | Origin of transaction |

---

### inventory_counts

Physical inventory count sessions.

```sql
CREATE TABLE inventory_counts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id),
    
    count_type VARCHAR(50) DEFAULT 'full', -- full, partial, spot
    status VARCHAR(50) DEFAULT 'in_progress', -- in_progress, completed, cancelled
    
    started_by UUID REFERENCES users(id),
    completed_by UUID REFERENCES users(id),
    
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    
    total_items INTEGER,
    counted_items INTEGER DEFAULT 0,
    discrepancies INTEGER DEFAULT 0,
    
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Procurement Tables

### providers

Wine suppliers/distributors.

```sql
CREATE TABLE providers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id),
    
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50),
    
    -- Contact info
    contact_name VARCHAR(255),
    contact_email VARCHAR(255),
    contact_phone VARCHAR(50),
    address TEXT,
    city VARCHAR(100),
    state VARCHAR(50),
    zip_code VARCHAR(20),
    
    -- Business terms
    payment_terms VARCHAR(50), -- net30, net60, cod
    minimum_order DECIMAL(10,2),
    delivery_fee DECIMAL(10,2),
    
    -- Delivery schedule
    delivery_days VARCHAR(50)[], -- ['monday', 'thursday']
    cutoff_time TIME,
    lead_time_days INTEGER DEFAULT 2,
    
    -- Performance
    rating DECIMAL(3,2),
    total_orders INTEGER DEFAULT 0,
    on_time_rate DECIMAL(5,2),
    
    -- Status
    status VARCHAR(50) DEFAULT 'active',
    is_preferred BOOLEAN DEFAULT false,
    
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_providers_restaurant ON providers(restaurant_id);
CREATE INDEX idx_providers_status ON providers(status);
```

---

### procurement_orders

Purchase orders to providers.

```sql
CREATE TABLE procurement_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id),
    provider_id UUID NOT NULL REFERENCES providers(id),
    
    order_number VARCHAR(50) UNIQUE,
    
    status VARCHAR(50) DEFAULT 'draft',
    -- draft, pending_approval, approved, ordered, shipped, delivered, cancelled
    
    -- Financials
    subtotal DECIMAL(10,2),
    tax DECIMAL(10,2),
    delivery_fee DECIMAL(10,2),
    discount DECIMAL(10,2),
    total_amount DECIMAL(10,2),
    
    -- Dates
    order_date TIMESTAMPTZ,
    requested_delivery_date DATE,
    actual_delivery_date DATE,
    
    -- Approval workflow
    created_by UUID REFERENCES users(id),
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMPTZ,
    
    -- Delivery
    delivered_by UUID REFERENCES users(id),
    delivered_at TIMESTAMPTZ,
    delivery_notes TEXT,
    
    -- Documents
    invoice_number VARCHAR(100),
    invoice_url TEXT,
    
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_po_restaurant ON procurement_orders(restaurant_id);
CREATE INDEX idx_po_provider ON procurement_orders(provider_id);
CREATE INDEX idx_po_status ON procurement_orders(status);
CREATE INDEX idx_po_date ON procurement_orders(order_date DESC);
```

---

### procurement_order_items

Line items in procurement orders.

```sql
CREATE TABLE procurement_order_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES procurement_orders(id) ON DELETE CASCADE,
    inventory_id UUID REFERENCES restaurant_inventory(id),
    master_wine_id UUID REFERENCES master_wine_library(id),
    
    -- Item details
    wine_name VARCHAR(255) NOT NULL,
    vintage INTEGER,
    bottle_size_ml INTEGER DEFAULT 750,
    
    -- Quantity and pricing
    quantity_ordered INTEGER NOT NULL,
    quantity_received INTEGER,
    unit_price DECIMAL(10,2) NOT NULL,
    total_price DECIMAL(10,2),
    
    -- Status
    status VARCHAR(50) DEFAULT 'pending',
    -- pending, partial, received, backordered, cancelled
    
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_poi_order ON procurement_order_items(order_id);
```

---

### recurring_orders

Automated reorder rules.

```sql
CREATE TABLE recurring_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id),
    provider_id UUID NOT NULL REFERENCES providers(id),
    
    name VARCHAR(255) NOT NULL,
    
    -- Schedule
    frequency VARCHAR(50) NOT NULL, -- weekly, biweekly, monthly
    day_of_week INTEGER, -- 0-6 for weekly
    day_of_month INTEGER, -- 1-31 for monthly
    time_of_day TIME DEFAULT '08:00',
    
    -- Items
    items JSONB NOT NULL,
    -- [{ inventoryId, quantity, minStock }]
    
    -- Behavior
    auto_approve BOOLEAN DEFAULT false,
    skip_if_above_threshold BOOLEAN DEFAULT true,
    
    -- Status
    status VARCHAR(50) DEFAULT 'active',
    last_run_at TIMESTAMPTZ,
    next_run_at TIMESTAMPTZ,
    
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Event System Tables

### events

Main event log for cross-page synchronization.

```sql
CREATE TABLE events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    user_id UUID,
    
    event_type event_type NOT NULL,
    source_page source_page NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}',
    schema_version INTEGER NOT NULL DEFAULT 1,
    
    idempotency_key VARCHAR(255),
    trace_id VARCHAR(64),
    correlation_id UUID,
    
    -- Archive tracking
    archived_at TIMESTAMPTZ,
    archive_path TEXT,
    
    -- Time-based flags (maintained by trigger)
    is_recent BOOLEAN DEFAULT true,
    is_archive_candidate BOOLEAN DEFAULT false,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    CONSTRAINT uq_events_idempotency UNIQUE (restaurant_id, idempotency_key)
);

-- Enums
CREATE TYPE event_type AS ENUM (
    'inventory_change', 'order_change', 'calendar_event',
    'dashboard_update', 'wine_update', 'report_event',
    'notification_sent', 'user_action', 'system_event'
);

CREATE TYPE source_page AS ENUM (
    'dashboard', 'inventory', 'wine_library', 'orders',
    'calendar', 'reports', 'communications', 'providers',
    'documents', 'notifications', 'settings', 'system'
);

CREATE INDEX idx_events_restaurant ON events(restaurant_id);
CREATE INDEX idx_events_type ON events(event_type);
CREATE INDEX idx_events_created ON events(created_at DESC);
CREATE INDEX idx_events_recent ON events(restaurant_id, created_at DESC) 
    WHERE is_recent = true;
```

---

### event_dead_letters

Failed events for retry/manual resolution.

```sql
CREATE TABLE event_dead_letters (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Original event data
    restaurant_id UUID NOT NULL REFERENCES restaurants(id),
    user_id UUID,
    event_type event_type NOT NULL,
    source_page source_page NOT NULL,
    payload JSONB NOT NULL,
    schema_version INTEGER,
    idempotency_key VARCHAR(255),
    
    -- Failure context
    error_code VARCHAR(50) NOT NULL,
    error_message TEXT NOT NULL,
    error_details JSONB,
    
    -- Retry tracking
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    next_retry_at TIMESTAMPTZ,
    status dlq_status DEFAULT 'pending',
    
    -- Resolution
    resolved_by UUID,
    resolution_notes TEXT,
    resolved_event_id UUID REFERENCES events(id),
    
    failed_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);

CREATE TYPE dlq_status AS ENUM (
    'pending', 'retrying', 'exhausted', 'resolved', 'ignored'
);
```

---

### event_replay_jobs

Bulk event replay tracking.

```sql
CREATE TABLE event_replay_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    restaurant_id UUID REFERENCES restaurants(id),
    event_types event_type[],
    
    from_timestamp TIMESTAMPTZ NOT NULL,
    to_timestamp TIMESTAMPTZ NOT NULL,
    
    source VARCHAR(20) NOT NULL, -- database, archive, both
    
    status replay_job_status DEFAULT 'pending',
    total_events INTEGER,
    processed_events INTEGER DEFAULT 0,
    failed_events INTEGER DEFAULT 0,
    
    events_per_second INTEGER DEFAULT 100,
    
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);

CREATE TYPE replay_job_status AS ENUM (
    'pending', 'running', 'paused', 'completed', 'failed', 'cancelled'
);
```

---

### event_schema_registry

JSON Schema definitions for event payloads.

```sql
CREATE TABLE event_schema_registry (
    id SERIAL PRIMARY KEY,
    event_type event_type NOT NULL,
    schema_version INTEGER NOT NULL,
    json_schema JSONB NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    deprecated_at TIMESTAMPTZ,
    
    CONSTRAINT uq_schema_version UNIQUE (event_type, schema_version)
);
```

---

## Calendar Tables

### calendar_events

Scheduled events (deliveries, tastings, meetings).

```sql
CREATE TABLE calendar_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id),
    
    title VARCHAR(255) NOT NULL,
    description TEXT,
    event_type VARCHAR(50) NOT NULL,
    -- delivery, order, meeting, inventory, tasting, reminder, custom
    
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ,
    all_day BOOLEAN DEFAULT false,
    
    location VARCHAR(255),
    attendees TEXT[],
    
    -- Related entities
    provider_id UUID REFERENCES providers(id),
    order_id UUID REFERENCES procurement_orders(id),
    
    -- Recurrence
    recurrence_rule_id UUID REFERENCES recurrence_rules(id),
    is_recurring BOOLEAN DEFAULT false,
    
    -- Reminders
    reminders JSONB, -- [{ type: 'email', minutes_before: 60 }]
    
    -- Status
    status VARCHAR(50) DEFAULT 'scheduled',
    color VARCHAR(20),
    
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_ce_restaurant ON calendar_events(restaurant_id);
CREATE INDEX idx_ce_start ON calendar_events(start_time);
CREATE INDEX idx_ce_type ON calendar_events(event_type);
```

---

### recurrence_rules

Recurring event patterns.

```sql
CREATE TABLE recurrence_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    frequency VARCHAR(20) NOT NULL, -- daily, weekly, monthly, yearly
    interval_value INTEGER DEFAULT 1,
    
    -- Weekly options
    days_of_week INTEGER[], -- 0-6
    
    -- Monthly options
    day_of_month INTEGER,
    week_of_month INTEGER, -- 1-5, -1 for last
    
    -- Bounds
    start_date DATE NOT NULL,
    end_date DATE,
    occurrence_count INTEGER,
    
    -- Exceptions
    excluded_dates DATE[],
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Communication Tables

### notifications

User notifications and alerts.

```sql
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id),
    user_id UUID REFERENCES users(id),
    
    type VARCHAR(50) NOT NULL,
    -- low_stock, order_approval, delivery, price_change, system_alert
    
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    data JSONB,
    
    -- Delivery
    channels VARCHAR(50)[], -- email, sms, push, in_app
    delivered_via JSONB, -- { email: true, sms: false }
    
    -- Status
    is_read BOOLEAN DEFAULT false,
    read_at TIMESTAMPTZ,
    
    -- Action
    action_type VARCHAR(50),
    action_id UUID,
    action_completed BOOLEAN DEFAULT false,
    
    priority VARCHAR(20) DEFAULT 'normal',
    expires_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notif_user ON notifications(user_id);
CREATE INDEX idx_notif_restaurant ON notifications(restaurant_id);
CREATE INDEX idx_notif_unread ON notifications(user_id) WHERE is_read = false;
```

---

### email_templates

Reusable email templates.

```sql
CREATE TABLE email_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID REFERENCES restaurants(id), -- NULL for system templates
    
    name VARCHAR(255) NOT NULL,
    category VARCHAR(50) NOT NULL,
    -- order, inventory, financial, report, custom
    
    subject VARCHAR(255) NOT NULL,
    body_html TEXT NOT NULL,
    body_text TEXT,
    
    variables JSONB, -- Available template variables
    
    is_default BOOLEAN DEFAULT false,
    is_system BOOLEAN DEFAULT false,
    
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

### conversations

AI conversation history for human approval.

```sql
CREATE TABLE conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id),
    
    agent_type VARCHAR(50) NOT NULL,
    context JSONB NOT NULL,
    
    messages JSONB NOT NULL, -- Array of message objects
    
    status VARCHAR(50) DEFAULT 'pending',
    -- pending, approved, rejected, executed
    
    requires_approval BOOLEAN DEFAULT true,
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMPTZ,
    
    executed_at TIMESTAMPTZ,
    execution_result JSONB,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_conv_restaurant ON conversations(restaurant_id);
CREATE INDEX idx_conv_status ON conversations(status);
```

---

### system_audit_log

Audit trail for all system actions.

```sql
CREATE TABLE system_audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID REFERENCES restaurants(id),
    user_id UUID REFERENCES users(id),
    
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id UUID,
    
    old_values JSONB,
    new_values JSONB,
    
    ip_address INET,
    user_agent TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_restaurant ON system_audit_log(restaurant_id);
CREATE INDEX idx_audit_entity ON system_audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_created ON system_audit_log(created_at DESC);
```

---

## Integration Tables

### toast_menu_cache

Cached Toast POS menu data.

```sql
CREATE TABLE toast_menu_cache (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id),
    
    menu_guid VARCHAR(255) NOT NULL,
    menu_name VARCHAR(255),
    menu_data JSONB NOT NULL,
    
    last_synced_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    
    CONSTRAINT uq_toast_menu UNIQUE (restaurant_id, menu_guid)
);
```

---

### toast_item_mappings

Mapping between Toast items and inventory.

```sql
CREATE TABLE toast_item_mappings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id),
    
    toast_item_guid VARCHAR(255) NOT NULL,
    toast_item_name VARCHAR(255),
    
    inventory_id UUID REFERENCES restaurant_inventory(id),
    
    mapping_type VARCHAR(50) DEFAULT 'manual', -- auto, manual
    confidence_score DECIMAL(3,2),
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    CONSTRAINT uq_toast_mapping UNIQUE (restaurant_id, toast_item_guid)
);
```

---

### one_tap_actions

Quick action items for human approval.

```sql
CREATE TABLE one_tap_actions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id),
    
    type VARCHAR(50) NOT NULL,
    -- reorder, approve_price, confirm_delivery, adjust_stock, etc.
    
    title VARCHAR(255) NOT NULL,
    description TEXT,
    
    payload JSONB NOT NULL,
    
    priority VARCHAR(20) DEFAULT 'normal', -- low, normal, high, urgent
    status VARCHAR(50) DEFAULT 'pending', -- pending, executed, cancelled, expired
    
    source_agent VARCHAR(50),
    source_event_id UUID REFERENCES events(id),
    
    expires_at TIMESTAMPTZ,
    
    executed_by UUID REFERENCES users(id),
    executed_at TIMESTAMPTZ,
    execution_result JSONB,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ota_restaurant ON one_tap_actions(restaurant_id);
CREATE INDEX idx_ota_status ON one_tap_actions(status);
CREATE INDEX idx_ota_pending ON one_tap_actions(restaurant_id) 
    WHERE status = 'pending';
```

---

## Row Level Security

All tenant-scoped tables use RLS policies based on `user_restaurant_access`.

### Example RLS Policy

```sql
-- Enable RLS
ALTER TABLE restaurant_inventory ENABLE ROW LEVEL SECURITY;

-- Select policy
CREATE POLICY "Users can view their restaurant inventory"
ON restaurant_inventory FOR SELECT
USING (
    restaurant_id IN (
        SELECT restaurant_id FROM user_restaurant_access
        WHERE user_id = auth.uid()
    )
);

-- Insert policy
CREATE POLICY "Users can insert to their restaurant inventory"
ON restaurant_inventory FOR INSERT
WITH CHECK (
    restaurant_id IN (
        SELECT restaurant_id FROM user_restaurant_access
        WHERE user_id = auth.uid()
    )
);

-- Update policy
CREATE POLICY "Users can update their restaurant inventory"
ON restaurant_inventory FOR UPDATE
USING (
    restaurant_id IN (
        SELECT restaurant_id FROM user_restaurant_access
        WHERE user_id = auth.uid()
    )
);
```

### Tables with RLS Enabled

- `restaurant_inventory`
- `inventory_transactions`
- `providers`
- `procurement_orders`
- `procurement_order_items`
- `events`
- `event_dead_letters`
- `calendar_events`
- `notifications`
- `conversations`
- `one_tap_actions`

---

## Migrations

### Migration Files

| File | Description |
|------|-------------|
| `000_migration_tracker.sql` | Migration version tracking |
| `001_add_advanced_features.sql` | Advanced features |
| `002_add_one_tap_actions.sql` | One-tap action system |
| `003_add_events_table.sql` | Event ingestion system |
| `004_add_event_dlq_replay.sql` | DLQ and replay jobs |
| `005_calendar_recurrence.sql` | Calendar recurrence |
| `006_inventory_auto_logging.sql` | Auto-logging triggers |
| `007_add_toast_guid_columns.sql` | Toast POS integration |
| `008_providers_and_reports.sql` | Provider management |
| `009_p1_agent_tables.sql` | Agent system tables |

### Running Migrations

```bash
# Using migration script
python services/database/migrate.py

# Or directly via Supabase CLI
supabase db push
```

---

## Supabase Realtime

Tables with Realtime enabled:

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE events;
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE restaurant_inventory;
ALTER PUBLICATION supabase_realtime ADD TABLE procurement_orders;
ALTER PUBLICATION supabase_realtime ADD TABLE calendar_events;
```

---

**Document Version**: 1.0  
**Created**: January 2026
