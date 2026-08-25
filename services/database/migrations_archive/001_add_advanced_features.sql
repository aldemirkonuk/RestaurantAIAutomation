-- Advanced Features Migration
-- Version: 1.0
-- Date: January 12, 2026
-- Description: Adds support for recurring orders, vendor deadlines, calendar events, 
--              case/bottle ordering, invoice scanning, check scanning, and auction purchases

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==============================================
-- RECURRING ORDERS
-- ==============================================
CREATE TABLE IF NOT EXISTS recurring_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  restaurant_id UUID, -- Will reference restaurants(id) when that table exists
  wine_id VARCHAR(50), -- References wines(wine_id)
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_type VARCHAR(10) NOT NULL CHECK (unit_type IN ('case', 'bottle')),
  frequency VARCHAR(20) NOT NULL CHECK (frequency IN ('daily', 'weekly', 'biweekly', 'monthly')),
  frequency_day INTEGER, -- For weekly: 0-6 (Mon-Sun), for monthly: 1-31
  preferred_providers TEXT[], -- Array of provider IDs
  auto_approve BOOLEAN DEFAULT false,
  next_order_date DATE NOT NULL,
  last_order_date DATE,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recurring_orders_restaurant ON recurring_orders(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_recurring_orders_wine ON recurring_orders(wine_id);
CREATE INDEX IF NOT EXISTS idx_recurring_orders_next_date ON recurring_orders(next_order_date) WHERE active = true;

-- ==============================================
-- VENDOR DEADLINES
-- ==============================================
CREATE TABLE IF NOT EXISTS vendor_deadlines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  restaurant_id UUID, -- Will reference restaurants(id)
  provider_id VARCHAR(50) NOT NULL,
  provider_name VARCHAR(255) NOT NULL,
  deadline_day INTEGER NOT NULL CHECK (deadline_day >= 0 AND deadline_day <= 6), -- 0-6 (Mon-Sun)
  deadline_time TIME NOT NULL,
  notification_hours_before INTEGER DEFAULT 48,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vendor_deadlines_restaurant ON vendor_deadlines(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_vendor_deadlines_provider ON vendor_deadlines(provider_id);

-- ==============================================
-- CALENDAR EVENTS
-- ==============================================
CREATE TABLE IF NOT EXISTS calendar_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  restaurant_id UUID, -- Will reference restaurants(id)
  event_type VARCHAR(50) NOT NULL CHECK (event_type IN ('important_date', 'vendor_deadline', 'recurring_order', 'report_schedule', 'delivery', 'birthday', 'tasting', 'inventory_count', 'vip_reservation')),
  title VARCHAR(255) NOT NULL,
  description TEXT,
  event_date DATE NOT NULL,
  event_time TIME,
  recurrence VARCHAR(20), -- 'daily', 'weekly', 'monthly', 'yearly', or NULL
  related_entity_id VARCHAR(100), -- Order ID, Provider ID, Wine ID, etc.
  notification_enabled BOOLEAN DEFAULT true,
  notification_sent BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calendar_events_restaurant ON calendar_events(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_calendar_events_date ON calendar_events(event_date);
CREATE INDEX IF NOT EXISTS idx_calendar_events_type ON calendar_events(event_type);

-- ==============================================
-- ORDER ITEMS (for case/bottle tracking)
-- ==============================================
CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id VARCHAR(100) NOT NULL, -- References orders(order_id)
  wine_id VARCHAR(50) NOT NULL,
  wine_name VARCHAR(255) NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_type VARCHAR(10) NOT NULL CHECK (unit_type IN ('case', 'bottle')),
  bottles_per_case INTEGER DEFAULT 12,
  unit_price DECIMAL(10,2) NOT NULL,
  total_price DECIMAL(10,2) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_wine ON order_items(wine_id);

-- ==============================================
-- WINE UNIT DEFAULTS
-- ==============================================
CREATE TABLE IF NOT EXISTS wine_unit_defaults (
  wine_id VARCHAR(50) PRIMARY KEY,
  default_unit_type VARCHAR(10) NOT NULL CHECK (default_unit_type IN ('case', 'bottle')),
  bottles_per_case INTEGER DEFAULT 12 CHECK (bottles_per_case > 0),
  notes TEXT,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ==============================================
-- INVOICE SCANS
-- ==============================================
CREATE TABLE IF NOT EXISTS invoice_scans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  restaurant_id UUID, -- Will reference restaurants(id)
  provider_id VARCHAR(50),
  provider_name VARCHAR(255),
  scan_type VARCHAR(10) NOT NULL CHECK (scan_type IN ('pdf', 'image')),
  file_url TEXT NOT NULL,
  ocr_status VARCHAR(20) DEFAULT 'pending' CHECK (ocr_status IN ('pending', 'processing', 'completed', 'failed')),
  extracted_data JSONB,
  processed_at TIMESTAMP,
  auto_added_to_inventory BOOLEAN DEFAULT false,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoice_scans_restaurant ON invoice_scans(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_invoice_scans_status ON invoice_scans(ocr_status);
CREATE INDEX IF NOT EXISTS idx_invoice_scans_provider ON invoice_scans(provider_id);

-- ==============================================
-- DIGITAL CHECK SCANS
-- ==============================================
CREATE TABLE IF NOT EXISTS check_scans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  restaurant_id UUID, -- Will reference restaurants(id)
  scan_date DATE NOT NULL,
  total_amount DECIMAL(10,2),
  wine_sales DECIMAL(10,2),
  wine_cost DECIMAL(10,2),
  profit_margin DECIMAL(5,2), -- Calculated as percentage
  extracted_data JSONB, -- Raw OCR data
  file_url TEXT,
  processed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_check_scans_restaurant ON check_scans(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_check_scans_date ON check_scans(scan_date);

-- ==============================================
-- AUCTION PURCHASES (Modify existing wines table)
-- ==============================================
-- Note: This assumes a wines table exists. If not, these will be added when the table is created.
-- For now, we'll create a separate table for auction details

CREATE TABLE IF NOT EXISTS wine_acquisition_details (
  wine_id VARCHAR(50) PRIMARY KEY,
  acquisition_type VARCHAR(50) DEFAULT 'standard' CHECK (acquisition_type IN ('standard', 'auction', 'direct_import', 'special_allocation')),
  auction_details JSONB, -- Store auction house, date, lot number, etc.
  acquisition_date DATE,
  acquisition_price DECIMAL(10,2),
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ==============================================
-- PROFIT MARGIN TRACKING
-- ==============================================
CREATE TABLE IF NOT EXISTS profit_margins (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  restaurant_id UUID,
  date DATE NOT NULL,
  total_revenue DECIMAL(10,2) NOT NULL,
  total_cost DECIMAL(10,2) NOT NULL,
  profit_margin DECIMAL(5,2) NOT NULL, -- Percentage
  wine_revenue DECIMAL(10,2),
  wine_cost DECIMAL(10,2),
  wine_profit_margin DECIMAL(5,2),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(restaurant_id, date)
);

CREATE INDEX IF NOT EXISTS idx_profit_margins_restaurant ON profit_margins(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_profit_margins_date ON profit_margins(date);

-- ==============================================
-- TRIGGERS FOR UPDATED_AT
-- ==============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'update_recurring_orders_updated_at'
    ) THEN
        CREATE TRIGGER update_recurring_orders_updated_at BEFORE UPDATE ON recurring_orders
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'update_vendor_deadlines_updated_at'
    ) THEN
        CREATE TRIGGER update_vendor_deadlines_updated_at BEFORE UPDATE ON vendor_deadlines
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'update_calendar_events_updated_at'
    ) THEN
        CREATE TRIGGER update_calendar_events_updated_at BEFORE UPDATE ON calendar_events
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'update_wine_unit_defaults_updated_at'
    ) THEN
        CREATE TRIGGER update_wine_unit_defaults_updated_at BEFORE UPDATE ON wine_unit_defaults
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

-- ==============================================
-- COMMENTS FOR DOCUMENTATION
-- ==============================================
COMMENT ON TABLE recurring_orders IS 'Stores recurring wine order schedules with frequency and auto-approval settings';
COMMENT ON TABLE vendor_deadlines IS 'Tracks vendor-specific order deadlines for timely notifications';
COMMENT ON TABLE calendar_events IS 'Unified calendar events for all important dates, deadlines, and scheduled activities';
COMMENT ON TABLE order_items IS 'Detailed line items for orders with case/bottle unit tracking';
COMMENT ON TABLE wine_unit_defaults IS 'Default ordering units (case vs bottle) per wine';
COMMENT ON TABLE invoice_scans IS 'OCR-processed invoice data for automated inventory updates';
COMMENT ON TABLE check_scans IS 'Digital receipt scans for profit margin analysis';
COMMENT ON TABLE wine_acquisition_details IS 'Tracks how wines were acquired (auction, standard, etc.)';
COMMENT ON TABLE profit_margins IS 'Daily profit margin calculations for financial reporting';

-- ==============================================
-- SAMPLE DATA FOR DEVELOPMENT (Optional)
-- ==============================================
-- Uncomment for development environments only
/*
INSERT INTO calendar_events (event_type, title, description, event_date, event_time, notification_enabled)
VALUES 
  ('important_date', 'Wine Tasting Event', 'Quarterly wine tasting for staff training', '2026-01-20', '18:00:00', true),
  ('birthday', 'Maria (Southern Glazers) Birthday', 'Account manager birthday - send gift', '2026-01-25', NULL, true),
  ('inventory_count', 'Quarterly Inventory Count', 'Full physical inventory count required', '2026-01-31', '09:00:00', true);

INSERT INTO vendor_deadlines (provider_id, provider_name, deadline_day, deadline_time, notification_hours_before)
VALUES 
  ('PROV_001', 'Southern Glazers Wine & Spirits', 1, '11:59:00', 48), -- Monday deadline
  ('PROV_002', 'Republic National Distributing Company', 3, '14:00:00', 72), -- Wednesday deadline
  ('PROV_003', 'Breakthru Beverage Group', 5, '12:00:00', 48); -- Friday deadline
*/

-- ==============================================
-- ROLLBACK SCRIPT (For reference)
-- ==============================================
-- To rollback this migration, run:
/*
DROP TABLE IF EXISTS profit_margins CASCADE;
DROP TABLE IF EXISTS wine_acquisition_details CASCADE;
DROP TABLE IF EXISTS check_scans CASCADE;
DROP TABLE IF EXISTS invoice_scans CASCADE;
DROP TABLE IF EXISTS wine_unit_defaults CASCADE;
DROP TABLE IF EXISTS order_items CASCADE;
DROP TABLE IF EXISTS calendar_events CASCADE;
DROP TABLE IF EXISTS vendor_deadlines CASCADE;
DROP TABLE IF EXISTS recurring_orders CASCADE;
DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE;
*/

