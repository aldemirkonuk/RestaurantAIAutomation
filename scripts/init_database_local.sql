-- ============================================================================
-- WineOps AI - Local Database Initialization
-- For local Docker PostgreSQL (not Supabase)
-- ============================================================================

-- Create extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Note: pgvector extension is not available in standard PostgreSQL
-- We'll skip vector columns for local development

-- ============================================================================
-- Core Tables (Simplified for local dev)
-- ============================================================================

-- Restaurants table
CREATE TABLE IF NOT EXISTS restaurants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    timezone VARCHAR(50) DEFAULT 'America/Los_Angeles',
    currency VARCHAR(3) DEFAULT 'USD',
    pos_system VARCHAR(50) DEFAULT 'toast',
    pos_credentials JSONB,
    is_active BOOLEAN DEFAULT true,
    subscription_tier VARCHAR(50) DEFAULT 'pilot',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Master Wine Library
CREATE TABLE IF NOT EXISTS master_wine_library (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wine_id VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    producer VARCHAR(255) NOT NULL,
    vintage INTEGER,
    price_reference DECIMAL(10,2),
    primary_type VARCHAR(50) NOT NULL,
    grape_variety TEXT,
    country VARCHAR(100) NOT NULL,
    region VARCHAR(100),
    appellation VARCHAR(150),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Restaurant Inventory
CREATE TABLE IF NOT EXISTS restaurant_inventory (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    wine_id VARCHAR(20) NOT NULL,
    current_stock INTEGER DEFAULT 0,
    threshold_min INTEGER DEFAULT 3,
    threshold_max INTEGER DEFAULT 24,
    location_in_cellar VARCHAR(100),
    par_level INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(restaurant_id, wine_id)
);

-- Providers
CREATE TABLE IF NOT EXISTS providers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(50),
    website VARCHAR(255),
    type VARCHAR(50),
    rating DECIMAL(3,2),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Procurement Orders
CREATE TABLE IF NOT EXISTS procurement_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    provider_id UUID REFERENCES providers(id),
    status VARCHAR(50) DEFAULT 'pending',
    total_amount DECIMAL(10,2),
    notes TEXT,
    order_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expected_delivery_date TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    type VARCHAR(50) NOT NULL,
    priority VARCHAR(20) DEFAULT 'normal',
    is_read BOOLEAN DEFAULT false,
    metadata JSONB,
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================================
-- Seed Demo Data
-- ============================================================================

-- Insert demo restaurant
INSERT INTO restaurants (id, name, slug, email, timezone, is_active)
VALUES (
    '550e8400-e29b-41d4-a716-446655440000'::uuid,
    'Demo Restaurant',
    'restaurant-demo-001',
    'demo@wineops.ai',
    'America/Los_Angeles',
    true
) ON CONFLICT (id) DO NOTHING;

-- Insert sample wines
INSERT INTO master_wine_library (wine_id, name, producer, vintage, primary_type, country, price_reference)
VALUES
    ('WINE_001', '2019 Cabernet Sauvignon', 'Napa Valley Estates', 2019, 'red', 'USA', 45.00),
    ('WINE_002', '2020 Chardonnay', 'Sonoma Vineyards', 2020, 'white', 'USA', 35.00),
    ('WINE_003', '2018 Pinot Noir', 'Willamette Winery', 2018, 'red', 'USA', 55.00),
    ('WINE_004', 'NV Prosecco', 'Italian Bubbles Co', NULL, 'sparkling', 'Italy', 25.00),
    ('WINE_005', '2019 Malbec', 'Mendoza Wines', 2019, 'red', 'Argentina', 30.00)
ON CONFLICT (wine_id) DO NOTHING;

-- Insert inventory for demo restaurant
INSERT INTO restaurant_inventory (restaurant_id, wine_id, current_stock, threshold_min, threshold_max)
SELECT 
    '550e8400-e29b-41d4-a716-446655440000'::uuid,
    wine_id,
    FLOOR(RANDOM() * 15 + 2)::INTEGER,
    3,
    24
FROM master_wine_library
ON CONFLICT (restaurant_id, wine_id) DO NOTHING;

-- Insert demo provider
INSERT INTO providers (name, email, type, rating, is_active)
VALUES
    ('Wine Distributor Inc', 'sales@winedist.com', 'distributor', 4.5, true),
    ('Premium Imports LLC', 'orders@premiumimports.com', 'importer', 4.8, true)
ON CONFLICT DO NOTHING;

-- Create helper views
CREATE OR REPLACE VIEW v_low_stock_items AS
SELECT 
    ri.id,
    ri.restaurant_id,
    r.name as restaurant_name,
    ri.wine_id,
    mw.name as wine_name,
    mw.producer,
    ri.current_stock,
    ri.threshold_min,
    ri.par_level
FROM restaurant_inventory ri
JOIN restaurants r ON ri.restaurant_id = r.id
JOIN master_wine_library mw ON ri.wine_id = mw.wine_id
WHERE ri.current_stock <= ri.threshold_min;

-- Success message
SELECT 
    'Database initialized successfully!' as status,
    COUNT(*) as wine_count
FROM master_wine_library;

SELECT 
    'Demo restaurant UUID: 550e8400-e29b-41d4-a716-446655440000' as message,
    'Use this UUID in your API calls instead of "restaurant-demo-001"' as note;
