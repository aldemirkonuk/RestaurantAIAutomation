CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE TABLE public.restaurants(id uuid PRIMARY KEY,currency text,default_threshold_min integer default 3,threshold_configured boolean default false,updated_at timestamptz default now());
CREATE TABLE public.providers(id uuid PRIMARY KEY,restaurant_id uuid,name text,usual_currency text,usual_currency_set_by uuid,usual_currency_set_at timestamptz,updated_at timestamptz default now());
CREATE TABLE public.restaurant_cellar_registers(restaurant_id uuid,register text,carried boolean,source text,confirmed_by uuid,confirmed_at timestamptz,updated_at timestamptz default now(),primary key(restaurant_id,register));
CREATE TABLE public.restaurant_vendor_terms(restaurant_id uuid,provider_id uuid,payment_terms text,lead_time_days integer,stated_by uuid,stated_at timestamptz,primary key(restaurant_id,provider_id));
-- Shaped like production (20260805000000_baseline_from_production.sql:3899,7216):
-- a surrogate id, and UNIQUE(restaurant_id,user_id) rather than user_id alone.
-- The original fixture keyed this table on user_id as its own primary key,
-- which cannot represent one person holding a row in two houses — exactly the
-- shape that hid the cross-house delete in codex-audit/C2-adopt.md #5.
CREATE TABLE public.notification_preferences(id uuid primary key default gen_random_uuid(),restaurant_id uuid not null,user_id uuid not null,email_enabled boolean default true,push_enabled boolean default true,updated_at timestamptz default now(),unique(restaurant_id,user_id));
CREATE TABLE public.restaurant_inventory(id uuid primary key,restaurant_id uuid,stock_live integer default 0,physical_stock integer,shadow_stock integer default 0,expected_stock integer default 0,in_transit_quantity integer default 0,updated_at timestamptz default now());
CREATE TABLE public.menu_items(id uuid primary key,restaurant_id uuid,name text,inventory_item_id uuid references public.restaurant_inventory(id),updated_at timestamptz default now());
CREATE TABLE public.later_inventory_use(id uuid primary key,inventory_id uuid references public.restaurant_inventory(id),quantity integer);
CREATE TABLE public.system_audit_log(id uuid primary key default gen_random_uuid(),actor_type text,actor_id uuid,action text,entity_type text,entity_id uuid,changes jsonb,restaurant_id uuid,correlation_id uuid,created_at timestamptz default now());
INSERT INTO public.restaurants(id) VALUES('22222222-2222-4222-8222-222222222222'),('99999999-9999-4999-8999-999999999999');

ALTER TABLE public.restaurant_inventory ADD UNIQUE(id,restaurant_id);
CREATE TABLE public.later_menu_use(id uuid primary key,menu_item_id uuid references public.menu_items(id) on delete cascade);
CREATE TABLE public.composite_inventory_use(id uuid primary key,inventory_id uuid,restaurant_id uuid,FOREIGN KEY(inventory_id,restaurant_id) REFERENCES public.restaurant_inventory(id,restaurant_id) on delete cascade);
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO service_role;
