-- ============================================================================
-- WineOps AI - UUID Migration Fix
-- Purpose: Allow flexible ID types for demo/development
-- ============================================================================

-- Option 1: Keep UUIDs but add a demo restaurant with proper UUID
-- ============================================================================

-- Insert demo restaurant with proper UUID
INSERT INTO restaurants (
    id,
    name,
    slug,
    email,
    phone,
    timezone,
    pos_system,
    is_active,
    subscription_tier
) VALUES (
    '550e8400-e29b-41d4-a716-446655440000'::uuid,  -- Fixed UUID for demo
    'Demo Restaurant',
    'restaurant-demo-001',
    'demo@wineops.ai',
    '+1-555-0100',
    'America/Los_Angeles',
    'toast',
    true,
    'pilot'
) ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    slug = EXCLUDED.slug;

-- Add friendly lookup function
CREATE OR REPLACE FUNCTION get_restaurant_id_by_slug(p_slug TEXT)
RETURNS UUID AS $$
BEGIN
    RETURN (SELECT id FROM restaurants WHERE slug = p_slug LIMIT 1);
END;
$$ LANGUAGE plpgsql;

-- Create a view for easier querying
CREATE OR REPLACE VIEW v_restaurants_lookup AS
SELECT 
    id,
    slug,
    name,
    email,
    is_active
FROM restaurants;

-- ============================================================================
-- Option 2: Add support for TEXT-based lookups (more flexible)
-- ============================================================================

-- Create a helper function that accepts both UUID and slug
CREATE OR REPLACE FUNCTION resolve_restaurant_id(p_identifier TEXT)
RETURNS UUID AS $$
DECLARE
    v_uuid UUID;
BEGIN
    -- Try to cast as UUID first
    BEGIN
        v_uuid := p_identifier::uuid;
        RETURN v_uuid;
    EXCEPTION WHEN invalid_text_representation THEN
        -- If not a UUID, treat as slug
        SELECT id INTO v_uuid FROM restaurants WHERE slug = p_identifier LIMIT 1;
        RETURN v_uuid;
    END;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Seed additional demo data
-- ============================================================================

-- Insert demo inventory items
INSERT INTO restaurant_inventory (
    restaurant_id,
    wine_id,
    current_stock,
    threshold_min,
    threshold_max,
    location_in_cellar
)
SELECT 
    '550e8400-e29b-41d4-a716-446655440000'::uuid,
    wine_id,
    FLOOR(RANDOM() * 20 + 5)::INTEGER,
    3,
    24,
    'Section A'
FROM master_wine_library
LIMIT 50
ON CONFLICT (restaurant_id, wine_id) DO NOTHING;

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION get_restaurant_id_by_slug TO postgres;
GRANT EXECUTE ON FUNCTION resolve_restaurant_id TO postgres;
GRANT SELECT ON v_restaurants_lookup TO postgres;

-- Success message
SELECT 
    'Migration complete! Demo restaurant UUID: 550e8400-e29b-41d4-a716-446655440000' as message,
    'Use slug: restaurant-demo-001 for lookups' as note;
