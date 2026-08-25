# ADR: Restaurant Location Schema (Gap closure — Phase 26)

**Date:** 2026-05-07  
**Status:** Accepted  
**Applies to:** `restaurants` table  

---

## Decision

Use three generic columns that cover every country's location hierarchy:

| Column | Type | US | Turkey | UK | France |
|--------|------|----|--------|----|----|
| `city` | VARCHAR(255) | Chicago | Antalya | London | Paris |
| `country` | VARCHAR(100) | United States | Turkey | United Kingdom | France |
| `state_province` | VARCHAR(100) | IL | Antalya (İl) | Greater London | Île-de-France |
| `postal_code` | VARCHAR(20) | 60601 | 07050 | SW1A 1AA | 75001 |
| `neighborhood` | VARCHAR(100) | River North | Konyaaltı | Mayfair | Le Marais |

## Uniqueness constraints

1. **Primary (postal-code aware):** `UNIQUE(organization_id, LOWER(name), postal_code)` — same org can't register the same restaurant name twice in the same postal code.
2. **Fallback (no postal code):** `UNIQUE(organization_id, LOWER(name), LOWER(city), LOWER(country), LOWER(COALESCE(neighborhood, '')))` — fallback for records without postal codes.
3. No global cross-organization uniqueness constraint — two unrelated businesses can share a name+location.

## UI behaviour

Form labels adapt dynamically based on the `country` field value:
- US → "State" / "ZIP Code" / "Neighborhood"
- Turkey → "Province (İl)" / "Posta Kodu" / "District (İlçe / Mahalle)"
- UK → "State / Province" / "Postcode" / "Borough / Area"
- Default → "State / Province" / "Postal Code" / "Neighborhood / Area"

---

## Future phases MUST add (do not implement in Phase 26)

These are not needed now but the schema is designed to accept them without breaking changes:

### Phase N — Geolocation
```sql
ALTER TABLE restaurants ADD COLUMN latitude DECIMAL(10,8);
ALTER TABLE restaurants ADD COLUMN longitude DECIMAL(11,8);
CREATE INDEX idx_restaurants_geo ON restaurants USING gist(point(longitude, latitude));
```
**Trigger:** when delivery zones, radius search, or map views are needed.

### Phase N — Google Places API integration
```sql
ALTER TABLE restaurants ADD COLUMN google_place_id VARCHAR(100) UNIQUE;
ALTER TABLE restaurants ADD COLUMN address_line2 VARCHAR(255);  -- Suite/floor
```
**Trigger:** when adding address autocomplete to registration or Settings.

### Phase N — Country-specific postal validation (backend)
Add a `PostalCodeValidator` service in the API gateway with country-specific regex:
- US: `/^\d{5}(-\d{4})?$/`
- UK: `/^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i`
- TR: `/^\d{5}$/`
- CA: `/^[A-Z]\d[A-Z]\s?\d[A-Z]\d$/i`  
**Trigger:** when the platform expands to require address validation for compliance or delivery.

### Phase N — Normalized address table (multi-address support)
```sql
CREATE TABLE restaurant_addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
  address_type VARCHAR(50) DEFAULT 'trading',  -- trading | registered | delivery | billing
  street_address TEXT,
  address_line2 VARCHAR(255),
  neighborhood VARCHAR(100),
  city VARCHAR(255),
  state_province VARCHAR(100),
  postal_code VARCHAR(20),
  country VARCHAR(100),
  latitude DECIMAL(10,8),
  longitude DECIMAL(11,8),
  is_primary BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```
**Trigger:** when restaurants need separate registered/trading/delivery addresses (e.g. UK legal requirement for registered address).

### Phase N — Address autocomplete UI
Replace free-text city/state/postal fields with a Google Places Autocomplete component that populates all fields from one search input.
**Trigger:** UX improvement milestone or when address accuracy becomes critical.
