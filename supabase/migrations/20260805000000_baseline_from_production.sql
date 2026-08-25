-- ============================================================================
-- BASELINE — captured from the production database on 2026-08-05
-- ============================================================================
-- This file IS the schema. It was produced by `pg_dump --schema-only` against
-- the live project, not written by hand, which is the entire point: the previous
-- 127 migrations had drifted so far from production that a fresh database could
-- not be built from them at all.
--
-- Measured before this baseline (.planning/SCHEMA_DRIFT_INVENTORY.txt):
--     27 ghost tables      in production, created by no migration
--    403 ghost columns     including 37 on restaurant_inventory alone
--     13 ghost functions   business logic with no source in the repo
--     23 dead tables       migrations created them, production never had them
--
-- The cause was structural: two migration systems ran in parallel
-- (services/database/migrations creating tables that supabase/migrations then
-- altered), and only the latter is applied by `supabase db reset` and the cloud
-- project. The superseded files are preserved under
-- supabase/migrations_archive/ and in git history.
--
-- Rules from here on:
--   1. Schema changes are migrations. DDL applied by hand to production is how
--      403 columns became invisible to this repo; CI now fails when local and
--      remote disagree.
--   2. This file is never edited. Corrections are new migrations.
--
-- Contains: 172 tables · 526 indexes · 43 functions · 44 triggers · 16 views
--           · 57 RLS policies. No data — schema only.
-- ============================================================================

-- Extensions that production has in the public schema. Declared explicitly
-- because pg_dump omits them and the dumped objects depend on them: `vector`
-- backs the embedding columns, pg_trgm backs the fuzzy-match indexes.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS ltree;
CREATE EXTENSION IF NOT EXISTS vector;

--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

-- CREATE SCHEMA public;  (provided by Supabase)
--
-- Name: calendar_event_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.calendar_event_status AS ENUM (
    'pending',
    'approved',
    'dismissed',
    'completed',
    'cancelled'
);


--
-- Name: commitment_type_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.commitment_type_enum AS ENUM (
    'INDICATIVE',
    'OFFER',
    'COUNTER',
    'AGREEMENT'
);


--
-- Name: dlq_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.dlq_status AS ENUM (
    'pending',
    'retrying',
    'exhausted',
    'resolved',
    'ignored'
);


--
-- Name: event_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.event_type AS ENUM (
    'inventory_change',
    'order_change',
    'calendar_event',
    'dashboard_update',
    'wine_update',
    'report_event',
    'notification_sent',
    'user_action',
    'system_event',
    'provider_change',
    'template_change'
);


--
-- Name: inventory_transaction_source; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.inventory_transaction_source AS ENUM (
    'pos',
    'manual',
    'order',
    'mobile_count',
    'reconciliation',
    'system',
    'import',
    'api'
);


--
-- Name: inventory_transaction_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.inventory_transaction_type AS ENUM (
    'sale',
    'purchase',
    'adjustment',
    'transfer',
    'waste',
    'return',
    'comp',
    'reconciliation',
    'initial',
    'correction'
);


--
-- Name: one_tap_action_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.one_tap_action_status AS ENUM (
    'pending',
    'in_progress',
    'completed',
    'cancelled',
    'expired'
);


--
-- Name: one_tap_action_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.one_tap_action_type AS ENUM (
    'low_stock',
    'price_change',
    'delivery_confirm',
    'inequality',
    'vintage_sub',
    'stock_receipt',
    'custom',
    'gmail_send',
    'gmail_contextual'
);


--
-- Name: one_tap_priority; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.one_tap_priority AS ENUM (
    'low',
    'medium',
    'high',
    'critical'
);


--
-- Name: recurrence_end_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.recurrence_end_type AS ENUM (
    'never',
    'after_count',
    'on_date'
);


--
-- Name: recurrence_frequency; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.recurrence_frequency AS ENUM (
    'daily',
    'weekly',
    'monthly',
    'yearly',
    'custom'
);


--
-- Name: replay_job_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.replay_job_status AS ENUM (
    'pending',
    'running',
    'paused',
    'completed',
    'failed',
    'cancelled'
);


--
-- Name: source_page; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.source_page AS ENUM (
    'dashboard',
    'inventory',
    'wine_library',
    'orders',
    'calendar',
    'reports',
    'communications',
    'providers',
    'documents',
    'notifications',
    'settings',
    'system'
);


--
-- Name: _sync_storage_location_name(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._sync_storage_location_name() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
        BEGIN
          NEW.name := COALESCE(
            CASE
              WHEN NEW.section IS NOT NULL AND NEW.section <> ''
                THEN NEW.zone || ' - ' || NEW.section
              ELSE NEW.zone
            END,
            'Unknown Location'
          );
          RETURN NEW;
        END;
        $$;


--
-- Name: apply_stock_movement(uuid, text, integer, text, text, uuid, text, numeric, uuid, uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.apply_stock_movement(p_inventory_id uuid, p_stock_state text, p_delta integer, p_transaction_type text, p_source text, p_performed_by uuid DEFAULT NULL::uuid, p_reason text DEFAULT NULL::text, p_unit_cost numeric DEFAULT NULL::numeric, p_location_id uuid DEFAULT NULL::uuid, p_order_id uuid DEFAULT NULL::uuid, p_idempotency_key text DEFAULT NULL::text, p_cost_provenance text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_restaurant uuid; v_wine uuid;
  v_before int; v_after int; v_remaining int; v_txn uuid; v_lot record;
  v_provenance text;
BEGIN
  IF p_delta = 0 THEN RETURN NULL; END IF;
  IF p_stock_state NOT IN ('live','shadow') THEN RAISE EXCEPTION 'invalid stock_state %', p_stock_state; END IF;

  IF p_cost_provenance IS NOT NULL
     AND p_cost_provenance NOT IN ('invoice','estimated','manual','sample') THEN
    RAISE EXCEPTION 'invalid cost_provenance %', p_cost_provenance;
  END IF;

  v_provenance := COALESCE(
    p_cost_provenance,
    CASE WHEN p_unit_cost IS NOT NULL THEN 'invoice' ELSE 'estimated' END
  );

  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_txn FROM inventory_transactions WHERE idempotency_key = p_idempotency_key LIMIT 1;
    IF v_txn IS NOT NULL THEN RETURN v_txn; END IF;
  END IF;

  SELECT restaurant_id, master_wine_id INTO v_restaurant, v_wine
    FROM restaurant_inventory WHERE id = p_inventory_id FOR UPDATE;
  IF v_restaurant IS NULL THEN RAISE EXCEPTION 'inventory % not found', p_inventory_id; END IF;

  SELECT COALESCE(SUM(qty),0) INTO v_before FROM inventory_lots
    WHERE inventory_id = p_inventory_id AND stock_state = p_stock_state;
  v_after := v_before + p_delta;
  IF v_after < 0 THEN RAISE EXCEPTION 'stock would go negative: % + %', v_before, p_delta; END IF;

  IF p_delta > 0 THEN
    INSERT INTO inventory_lots (restaurant_id, inventory_id, master_wine_id, location_id, stock_state, qty, unit_cost, cost_provenance, source_order_id)
    VALUES (v_restaurant, p_inventory_id, v_wine, p_location_id, p_stock_state, p_delta, p_unit_cost,
            v_provenance, p_order_id);
  ELSE
    v_remaining := -p_delta;
    FOR v_lot IN SELECT id, qty FROM inventory_lots
        WHERE inventory_id = p_inventory_id AND stock_state = p_stock_state AND qty > 0
        ORDER BY received_at ASC, created_at ASC LOOP
      EXIT WHEN v_remaining <= 0;
      IF v_lot.qty <= v_remaining THEN
        v_remaining := v_remaining - v_lot.qty;
        DELETE FROM inventory_lots WHERE id = v_lot.id;
      ELSE
        UPDATE inventory_lots SET qty = qty - v_remaining, updated_at = now() WHERE id = v_lot.id;
        v_remaining := 0;
      END IF;
    END LOOP;
  END IF;

  INSERT INTO inventory_transactions
    (restaurant_id, inventory_id, wine_id, transaction_type, source, quantity_change, quantity_before, quantity_after,
     stock_type, unit_cost, performed_by, performed_by_type, reason, order_id, idempotency_key, transaction_date)
  VALUES
    (v_restaurant, p_inventory_id, v_wine, p_transaction_type::inventory_transaction_type, p_source::inventory_transaction_source,
     p_delta, v_before, v_after, p_stock_state, p_unit_cost, p_performed_by,
     CASE WHEN p_performed_by IS NOT NULL THEN 'user' ELSE 'system' END,
     p_reason, p_order_id, p_idempotency_key, now())
  RETURNING id INTO v_txn;

  RETURN v_txn;
END;
$$;


--
-- Name: archive_old_events(integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.archive_old_events(retention_days integer DEFAULT 90, batch_size integer DEFAULT 10000) RETURNS TABLE(archived_count integer, error_message text)
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_archived_count INTEGER := 0;
    v_cutoff_date TIMESTAMPTZ;
BEGIN
    v_cutoff_date := NOW() - (retention_days || ' days')::INTERVAL;
    
    -- Mark events for archival (actual S3 upload done by application)
    UPDATE events
    SET archived_at = NOW()
    WHERE id IN (
        SELECT id FROM events
        WHERE created_at < v_cutoff_date
          AND archived_at IS NULL
        ORDER BY created_at
        LIMIT batch_size
        FOR UPDATE SKIP LOCKED
    );
    
    GET DIAGNOSTICS v_archived_count = ROW_COUNT;
    
    RETURN QUERY SELECT v_archived_count, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 0, SQLERRM;
END;
$$;


--
-- Name: calculate_dlq_next_retry(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calculate_dlq_next_retry(retry_count integer) RETURNS timestamp with time zone
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
    -- Exponential backoff: 1min, 5min, 30min
    RETURN CASE 
        WHEN retry_count = 0 THEN NOW() + INTERVAL '1 minute'
        WHEN retry_count = 1 THEN NOW() + INTERVAL '5 minutes'
        WHEN retry_count = 2 THEN NOW() + INTERVAL '30 minutes'
        ELSE NULL  -- No more retries
    END;
END;
$$;


--
-- Name: calculate_sales_velocity(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calculate_sales_velocity() RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
    UPDATE restaurant_inventory ri
    SET 
        sales_velocity_30d = (
            SELECT COALESCE(SUM(se.quantity) / 30.0, 0)
            FROM sales_events se
            WHERE se.inventory_id = ri.id
            AND se.event_type = 'sale'
            AND se.pos_event_timestamp >= NOW() - INTERVAL '30 days'
        ),
        sales_velocity_7d = (
            SELECT COALESCE(SUM(se.quantity) / 7.0, 0)
            FROM sales_events se
            WHERE se.inventory_id = ri.id
            AND se.event_type = 'sale'
            AND se.pos_event_timestamp >= NOW() - INTERVAL '7 days'
        ),
        last_sold_at = (
            SELECT MAX(se.pos_event_timestamp)
            FROM sales_events se
            WHERE se.inventory_id = ri.id
            AND se.event_type = 'sale'
        );
END;
$$;


--
-- Name: conversation_thread_key(uuid, text, jsonb, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.conversation_thread_key(p_id uuid, p_gmail_thread_id text, p_email_headers jsonb, p_provider_id uuid, p_message_text text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
    v_root    TEXT;
    v_subject TEXT;
BEGIN
    -- 1. Gmail already threaded it.
    IF p_gmail_thread_id IS NOT NULL AND btrim(p_gmail_thread_id) <> '' THEN
        RETURN 'gm:' || btrim(p_gmail_thread_id);
    END IF;

    -- 2. RFC-822 threading: root of References, else In-Reply-To.
    v_root := NULLIF(btrim(split_part(COALESCE(p_email_headers ->> 'references', ''), ' ', 1)), '');
    IF v_root IS NULL THEN
        v_root := NULLIF(btrim(COALESCE(p_email_headers ->> 'in_reply_to', '')), '');
    END IF;
    IF v_root IS NOT NULL THEN
        RETURN 'mid:' || btrim(v_root, '<>');
    END IF;

    -- 3. Provider + normalized subject. Scoped by provider so it cannot merge across
    --    tenants, and only fires when no exact identifier exists. A no-op on current
    --    data (outbound drafts store no subject) — it exists for channels that carry
    --    no Gmail identifiers.
    IF p_provider_id IS NOT NULL THEN
        v_subject := COALESCE(
            NULLIF(btrim(p_email_headers ->> 'subject'), ''),
            NULLIF(btrim(substring(p_message_text FROM 'Subject:[ \t]*([^\r\n]+)')), '')
        );
        IF v_subject IS NOT NULL THEN
            v_subject := lower(regexp_replace(v_subject, '^((re|fwd|fw|aw|sv)[ \t]*:[ \t]*)+', '', 'i'));
            v_subject := btrim(regexp_replace(v_subject, '[ \t]+', ' ', 'g'));
            IF v_subject <> '' THEN
                RETURN 'subj:' || p_provider_id::TEXT || ':' || v_subject;
            END IF;
        END IF;
    END IF;

    -- 4. Singleton thread.
    RETURN 'msg:' || p_id::TEXT;
END;
$$;


--
-- Name: delete_archived_events(text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_archived_events(archive_path_pattern text, batch_size integer DEFAULT 5000) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_deleted_count INTEGER;
BEGIN
    DELETE FROM events
    WHERE id IN (
        SELECT id FROM events
        WHERE archived_at IS NOT NULL
          AND archive_path LIKE archive_path_pattern
          AND archived_at < NOW() - INTERVAL '7 days'  -- Safety: keep 7 days after archive
        LIMIT batch_size
    );
    
    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
    RETURN v_deleted_count;
END;
$$;


--
-- Name: events_set_time_flags(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.events_set_time_flags() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        NEW.is_recent := true;
        NEW.is_archive_candidate := false;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        NEW.is_recent := (NEW.created_at > NOW() - INTERVAL '7 days');
        NEW.is_archive_candidate := (NEW.archived_at IS NULL AND NEW.created_at < NOW() - INTERVAL '90 days');
    END IF;

    RETURN NEW;
END;
$$;


--
-- Name: find_inventory_by_sku(uuid, character varying); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.find_inventory_by_sku(p_restaurant_id uuid, p_sku character varying) RETURNS TABLE(inventory_id uuid, master_wine_id uuid, wine_name character varying, sku character varying, sku_type character varying, current_stock integer)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ri.id as inventory_id,
        ri.master_wine_id,
        mw.name as wine_name,
        COALESCE(ri.sku, ri.internal_sku, ri.pos_sku, mw.sku) as sku,
        CASE 
            WHEN ri.sku = p_sku THEN 'sku'
            WHEN ri.internal_sku = p_sku THEN 'internal_sku'
            WHEN ri.pos_sku = p_sku THEN 'pos_sku'
            WHEN mw.sku = p_sku THEN 'master_sku'
            WHEN mw.upc = p_sku THEN 'upc'
            WHEN mw.ean = p_sku THEN 'ean'
            ELSE 'alias'
        END as sku_type,
        ri.stock_live as current_stock
    FROM restaurant_inventory ri
    JOIN master_wine_library mw ON ri.master_wine_id = mw.id
    WHERE ri.restaurant_id = p_restaurant_id
      AND ri.deleted_at IS NULL
      AND (
          ri.sku = p_sku
          OR ri.internal_sku = p_sku
          OR ri.pos_sku = p_sku
          OR mw.sku = p_sku
          OR mw.upc = p_sku
          OR mw.ean = p_sku
          OR mw.manufacturer_sku = p_sku
          OR ri.sku_aliases ? p_sku
          OR mw.distributor_skus ? p_sku
      )
    LIMIT 1;
END;
$$;


--
-- Name: find_inventory_by_toast_guid(uuid, character varying); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.find_inventory_by_toast_guid(p_restaurant_id uuid, p_toast_guid character varying) RETURNS TABLE(inventory_id uuid, master_wine_id uuid, wine_name character varying, sku character varying, current_stock integer)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ri.id as inventory_id,
        ri.master_wine_id,
        mw.name as wine_name,
        COALESCE(ri.sku, mw.sku) as sku,
        ri.stock_live as current_stock
    FROM restaurant_inventory ri
    JOIN master_wine_library mw ON ri.master_wine_id = mw.id
    WHERE ri.restaurant_id = p_restaurant_id
      AND ri.toast_item_guid = p_toast_guid
      AND ri.deleted_at IS NULL
    LIMIT 1;
END;
$$;


--
-- Name: fn_check_order_inventory_restaurant(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_check_order_inventory_restaurant() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  inv_restaurant_id UUID;
BEGIN
  -- Only validate when inventory_id is set
  IF NEW.inventory_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT restaurant_id INTO inv_restaurant_id
  FROM restaurant_inventory
  WHERE id = NEW.inventory_id;

  IF inv_restaurant_id IS DISTINCT FROM NEW.restaurant_id THEN
    RAISE EXCEPTION
      'inventory_id % belongs to restaurant %, not %',
      NEW.inventory_id, inv_restaurant_id, NEW.restaurant_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: generate_recurring_events(uuid, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_recurring_events(p_rule_id uuid, p_horizon_date date DEFAULT NULL::date) RETURNS integer
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- Phase 30 stub: returns 0.
  -- Frontend performs client-side recurrence expansion via expandAllRecurringEvents().
  -- Plan 30-07 implements full server-side generation for this_and_future scope.
  RETURN 0;
END;
$$;


--
-- Name: get_inventory_balance_at(uuid, timestamp with time zone, character varying); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_inventory_balance_at(p_inventory_id uuid, p_as_of timestamp with time zone, p_stock_type character varying DEFAULT 'live'::character varying) RETURNS integer
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE
    v_balance INTEGER;
BEGIN
    SELECT quantity_after INTO v_balance
    FROM inventory_transactions
    WHERE inventory_id = p_inventory_id
      AND stock_type = p_stock_type
      AND transaction_date <= p_as_of
    ORDER BY transaction_date DESC, created_at DESC
    LIMIT 1;
    
    RETURN COALESCE(v_balance, 0);
END;
$$;


--
-- Name: increment_trust_counter(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.increment_trust_counter(p_user_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
    UPDATE user_roles
    SET consecutive_approved_overrides = consecutive_approved_overrides + 1
    WHERE user_id = p_user_id
      AND role = 'certified_contributor'
      AND revoked_at IS NULL;
END;
$$;


--
-- Name: list_conversation_threads(uuid, uuid, text, text, text, text, text, text, text, timestamp with time zone, timestamp with time zone, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_conversation_threads(p_restaurant_id uuid, p_provider_id uuid DEFAULT NULL::uuid, p_channel text DEFAULT NULL::text, p_direction text DEFAULT NULL::text, p_sentiment text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_search text DEFAULT NULL::text, p_order_number text DEFAULT NULL::text, p_thread_key text DEFAULT NULL::text, p_date_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_date_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0) RETURNS TABLE(thread_key text, message_count bigint, first_at timestamp with time zone, last_at timestamp with time zone, order_id uuid, order_number text, provider_id uuid, total_threads bigint)
    LANGUAGE sql STABLE
    AS $$
WITH matched AS (
    SELECT c.*
    FROM public.procurement_conversations c
    WHERE c.restaurant_id = p_restaurant_id
      AND (p_provider_id  IS NULL OR c.provider_id = p_provider_id)
      AND (p_thread_key   IS NULL OR c.thread_key = p_thread_key)
      AND (p_channel      IS NULL OR c.channel = p_channel)
      AND (p_direction    IS NULL OR lower(c.direction) = lower(p_direction))
      AND (p_status       IS NULL OR c.delivery_status = p_status)
      AND (p_order_number IS NULL OR c.order_number_snapshot ILIKE '%' || p_order_number || '%')
      AND (p_search       IS NULL OR c.message_text ILIKE '%' || p_search || '%')
      AND (p_date_from    IS NULL OR c.created_at >= p_date_from)
      AND (p_date_to      IS NULL OR c.created_at <= p_date_to)
      AND (
            p_sentiment IS NULL
         OR (p_sentiment = 'unclassified'
             AND (c.detected_sentiment IS NULL OR btrim(c.detected_sentiment) = ''))
         OR (p_sentiment <> 'unclassified'
             AND lower(c.detected_sentiment) = lower(p_sentiment))
          )
),
threads AS (
    SELECT m.thread_key,
           count(*) AS message_count,
           min(m.created_at) AS first_at,
           max(m.created_at) AS last_at,
           (array_agg(m.order_id) FILTER (WHERE m.order_id IS NOT NULL))[1] AS order_id,
           (array_agg(m.order_number_snapshot)
              FILTER (WHERE m.order_number_snapshot IS NOT NULL))[1] AS order_number,
           (array_agg(m.provider_id) FILTER (WHERE m.provider_id IS NOT NULL))[1] AS provider_id
    FROM matched m
    GROUP BY m.thread_key
)
SELECT t.thread_key,
       t.message_count,
       t.first_at,
       t.last_at,
       t.order_id,
       t.order_number,
       t.provider_id,
       count(*) OVER () AS total_threads
FROM threads t
-- Mirrors the client sort: threads linked to an order first, then most recent.
ORDER BY (t.order_id IS NULL), t.last_at DESC
LIMIT  greatest(p_limit, 1)
OFFSET greatest(p_offset, 0);
$$;


--
-- Name: log_comp(uuid, uuid, integer, text, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_comp(p_restaurant_id uuid, p_wine_id uuid, p_quantity integer, p_reason text, p_performed_by uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_inventory_id UUID;
    v_transaction_id UUID;
BEGIN
    -- Find the inventory item
    SELECT id INTO v_inventory_id
    FROM restaurant_inventory
    WHERE restaurant_id = p_restaurant_id
      AND wine_id = p_wine_id
    LIMIT 1;
    
    IF v_inventory_id IS NULL THEN
        RAISE EXCEPTION 'Inventory item not found for wine: %', p_wine_id;
    END IF;
    
    -- Record the comp (negative quantity)
    v_transaction_id := record_inventory_transaction(
        p_restaurant_id := p_restaurant_id,
        p_inventory_id := v_inventory_id,
        p_wine_id := p_wine_id,
        p_transaction_type := 'comp',
        p_source := 'manual',
        p_quantity_change := -ABS(p_quantity),  -- Always negative for comps
        p_stock_type := 'live',
        p_performed_by := p_performed_by,
        p_performed_by_type := CASE WHEN p_performed_by IS NOT NULL THEN 'user' ELSE 'system' END,
        p_reason := p_reason,
        p_notes := p_notes,
        p_metadata := '{}'::jsonb
    );
    
    RETURN v_transaction_id;
END;
$$;


--
-- Name: log_inventory_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_inventory_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_quantity_change INTEGER;
    v_transaction_type inventory_transaction_type;
    v_source inventory_transaction_source;
BEGIN
    -- Only log if stock actually changed
    IF TG_OP = 'UPDATE' THEN
        -- Check if stock_live changed
        IF OLD.stock_live IS DISTINCT FROM NEW.stock_live THEN
            v_quantity_change := COALESCE(NEW.stock_live, 0) - COALESCE(OLD.stock_live, 0);
            
            -- Determine transaction type based on context
            -- This is a fallback - ideally transactions should be created via the API
            v_transaction_type := 'adjustment';
            v_source := 'system';
            
            -- Skip if change is 0
            IF v_quantity_change = 0 THEN
                RETURN NEW;
            END IF;
            
            -- Insert transaction record
            INSERT INTO inventory_transactions (
                restaurant_id,
                inventory_id,
                wine_id,
                transaction_type,
                source,
                quantity_change,
                quantity_before,
                quantity_after,
                stock_type,
                performed_by_type,
                reason,
                metadata
            ) VALUES (
                NEW.restaurant_id,
                NEW.id,
                NEW.master_wine_id,
                v_transaction_type,
                v_source,
                v_quantity_change,
                COALESCE(OLD.stock_live, 0),
                COALESCE(NEW.stock_live, 0),
                'live',
                'system',
                'Auto-logged from direct inventory update',
                jsonb_build_object(
                    'trigger', 'log_inventory_change',
                    'operation', TG_OP,
                    'old_updated_at', OLD.updated_at,
                    'new_updated_at', NEW.updated_at
                )
            );
        END IF;
        
        -- Check if shadow_stock changed
        IF OLD.shadow_stock IS DISTINCT FROM NEW.shadow_stock THEN
            v_quantity_change := COALESCE(NEW.shadow_stock, 0) - COALESCE(OLD.shadow_stock, 0);
            
            IF v_quantity_change != 0 THEN
                INSERT INTO inventory_transactions (
                    restaurant_id,
                    inventory_id,
                    wine_id,
                    transaction_type,
                    source,
                    quantity_change,
                    quantity_before,
                    quantity_after,
                    stock_type,
                    performed_by_type,
                    reason,
                    metadata
                ) VALUES (
                    NEW.restaurant_id,
                    NEW.id,
                    NEW.master_wine_id,
                    'adjustment',
                    'system',
                    v_quantity_change,
                    COALESCE(OLD.shadow_stock, 0),
                    COALESCE(NEW.shadow_stock, 0),
                    'shadow',
                    'system',
                    'Auto-logged shadow stock change',
                    jsonb_build_object(
                        'trigger', 'log_inventory_change',
                        'operation', TG_OP
                    )
                );
            END IF;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$;


--
-- Name: log_order_delivery(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_order_delivery() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_inventory_id UUID;
    v_wine_id UUID;
    v_quantity INTEGER;
    v_unit_cost DECIMAL(10,2);
BEGIN
    -- Only trigger when status changes to 'delivered'
    IF NEW.status = 'delivered' AND OLD.status != 'delivered' THEN
        -- Get the wine_id and quantity from the order
        v_wine_id := NEW.wine_id;
        v_quantity := NEW.quantity;
        v_unit_cost := NEW.final_price / NULLIF(NEW.quantity, 0);
        
        -- Find the inventory item for this wine
        SELECT id INTO v_inventory_id
        FROM restaurant_inventory
        WHERE restaurant_id = NEW.restaurant_id
          AND wine_id = v_wine_id
        LIMIT 1;
        
        -- If inventory item exists, log the transaction
        IF v_inventory_id IS NOT NULL THEN
            -- Use the record_inventory_transaction function
            PERFORM record_inventory_transaction(
                p_restaurant_id := NEW.restaurant_id,
                p_inventory_id := v_inventory_id,
                p_wine_id := v_wine_id,
                p_transaction_type := 'purchase',
                p_source := 'order',
                p_quantity_change := v_quantity,
                p_stock_type := 'live',
                p_reference_type := 'procurement_order',
                p_reference_id := NEW.id,
                p_order_id := NEW.id,
                p_unit_cost := v_unit_cost,
                p_performed_by_type := 'system',
                p_reason := 'Order delivered',
                p_metadata := jsonb_build_object(
                    'provider_id', NEW.provider_id,
                    'order_date', NEW.created_at,
                    'delivery_date', NEW.delivered_at
                )
            );
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$;


--
-- Name: log_pos_sale(uuid, uuid, integer, character varying, numeric, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_pos_sale(p_restaurant_id uuid, p_wine_id uuid, p_quantity integer, p_pos_transaction_id character varying, p_unit_price numeric DEFAULT NULL::numeric, p_metadata jsonb DEFAULT '{}'::jsonb) RETURNS uuid
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_inventory_id UUID;
    v_transaction_id UUID;
BEGIN
    -- Find the inventory item
    SELECT id INTO v_inventory_id
    FROM restaurant_inventory
    WHERE restaurant_id = p_restaurant_id
      AND wine_id = p_wine_id
    LIMIT 1;
    
    IF v_inventory_id IS NULL THEN
        RAISE EXCEPTION 'Inventory item not found for wine: %', p_wine_id;
    END IF;
    
    -- Record the sale (negative quantity)
    v_transaction_id := record_inventory_transaction(
        p_restaurant_id := p_restaurant_id,
        p_inventory_id := v_inventory_id,
        p_wine_id := p_wine_id,
        p_transaction_type := 'sale',
        p_source := 'pos',
        p_quantity_change := -ABS(p_quantity),  -- Always negative for sales
        p_stock_type := 'live',
        p_pos_transaction_id := p_pos_transaction_id,
        p_unit_cost := p_unit_price,
        p_performed_by_type := 'system',
        p_reason := 'POS sale',
        p_metadata := p_metadata
    );
    
    RETURN v_transaction_id;
END;
$$;


--
-- Name: log_waste(uuid, uuid, integer, text, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_waste(p_restaurant_id uuid, p_wine_id uuid, p_quantity integer, p_reason text, p_performed_by uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_inventory_id UUID;
    v_transaction_id UUID;
BEGIN
    -- Find the inventory item
    SELECT id INTO v_inventory_id
    FROM restaurant_inventory
    WHERE restaurant_id = p_restaurant_id
      AND wine_id = p_wine_id
    LIMIT 1;
    
    IF v_inventory_id IS NULL THEN
        RAISE EXCEPTION 'Inventory item not found for wine: %', p_wine_id;
    END IF;
    
    -- Record the waste (negative quantity)
    v_transaction_id := record_inventory_transaction(
        p_restaurant_id := p_restaurant_id,
        p_inventory_id := v_inventory_id,
        p_wine_id := p_wine_id,
        p_transaction_type := 'waste',
        p_source := 'manual',
        p_quantity_change := -ABS(p_quantity),  -- Always negative for waste
        p_stock_type := 'live',
        p_performed_by := p_performed_by,
        p_performed_by_type := CASE WHEN p_performed_by IS NOT NULL THEN 'user' ELSE 'system' END,
        p_reason := p_reason,
        p_notes := p_notes,
        p_metadata := '{}'::jsonb
    );
    
    RETURN v_transaction_id;
END;
$$;


--
-- Name: master_wine_library_set_search_vector(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.master_wine_library_set_search_vector() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.search_vector :=
        to_tsvector('english',
            COALESCE(NEW.name, '') || ' ' ||
            COALESCE(NEW.producer, '') || ' ' ||
            COALESCE(NEW.region, '') || ' ' ||
            COALESCE(NEW.grape_variety, '')
        );
    RETURN NEW;
END;
$$;


--
-- Name: match_conversation_embeddings(public.vector, uuid, uuid, double precision, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.match_conversation_embeddings(query_embedding public.vector, match_provider_id uuid, match_restaurant_id uuid, match_threshold double precision DEFAULT 0.5, match_count integer DEFAULT 10) RETURNS TABLE(id uuid, message_text text, role character varying, session_id uuid, importance_score double precision, created_at timestamp with time zone, similarity double precision)
    LANGUAGE sql STABLE
    AS $$
    SELECT
        id,
        message_text,
        role,
        session_id,
        importance_score,
        created_at,
        1 - (embedding <=> query_embedding) AS similarity
    FROM conversation_embeddings
    WHERE provider_id   = match_provider_id
      AND restaurant_id = match_restaurant_id
      AND has_signal    = true
      AND sensitive     = false   -- D-12: PII never returned in search results (T-24-01-03)
      AND 1 - (embedding <=> query_embedding) > match_threshold
    ORDER BY embedding <=> query_embedding
    LIMIT match_count;
$$;


--
-- Name: normalize_wine_alias(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.normalize_wine_alias() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.alias_name_normalized = LOWER(
        TRANSLATE(
            NEW.alias_name,
            'àáâãäåèéêëìíîïòóôõöùúûüýÿñçšžÀÁÂÃÄÅÈÉÊËÌÍÎÏÒÓÔÕÖÙÚÛÜÝŸÑÇŠŽüöçşğı',
            'aaaaaaeeeeiiiioooooouuuuyyncsxAAAAAAEEEEIIIIIOOOOOUUUUYYNCSZuocsgı'
        )
    );
    RETURN NEW;
END;
$$;


--
-- Name: project_stock_from_lots(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.project_stock_from_lots() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_inv uuid;
BEGIN
  v_inv := COALESCE(NEW.inventory_id, OLD.inventory_id);
  IF v_inv IS NOT NULL THEN
    UPDATE restaurant_inventory ri SET
      stock_live   = (SELECT COALESCE(SUM(qty),0) FROM inventory_lots WHERE inventory_id = v_inv AND stock_state = 'live'),
      shadow_stock = (SELECT COALESCE(SUM(qty),0) FROM inventory_lots WHERE inventory_id = v_inv AND stock_state = 'shadow')
    WHERE ri.id = v_inv;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;


--
-- Name: record_glass_pour(uuid, integer, integer, uuid, text, uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_glass_pour(p_inventory_id uuid, p_pours integer DEFAULT 1, p_pour_ml integer DEFAULT NULL::integer, p_location_id uuid DEFAULT NULL::uuid, p_source text DEFAULT 'pos'::text, p_performed_by uuid DEFAULT NULL::uuid, p_reason text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_restaurant uuid; v_wine uuid; v_bottle_ml int; v_pour_ml int;
  v_lot inventory_lots%ROWTYPE; v_bottles_opened int := 0; v_g int; v_need int;
  v_before int; v_after int; v_txn uuid; v_existing uuid;
BEGIN
  IF p_pours <= 0 THEN RETURN jsonb_build_object('poured', 0); END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_existing FROM pour_events WHERE idempotency_key = p_idempotency_key LIMIT 1;
    IF v_existing IS NOT NULL THEN RETURN jsonb_build_object('idempotent', true, 'pour_event', v_existing); END IF;
  END IF;

  SELECT ri.restaurant_id, ri.master_wine_id, COALESCE(ri.bottle_size_ml, 750),
         COALESCE(p_pour_ml, ri.pour_size_ml, 150)
    INTO v_restaurant, v_wine, v_bottle_ml, v_pour_ml
    FROM restaurant_inventory ri WHERE ri.id = p_inventory_id FOR UPDATE;
  IF v_restaurant IS NULL THEN RAISE EXCEPTION 'inventory % not found', p_inventory_id; END IF;

  v_before := (SELECT COALESCE(SUM(qty),0) FROM inventory_lots WHERE inventory_id=p_inventory_id AND stock_state='live');

  FOR v_g IN 1..p_pours LOOP
    SELECT * INTO v_lot FROM inventory_lots
      WHERE inventory_id=p_inventory_id AND stock_state='live'
        AND (p_location_id IS NULL OR location_id IS NOT DISTINCT FROM p_location_id)
        AND (open_bottle_ml > 0 OR qty > 0)
      ORDER BY (open_bottle_ml > 0) DESC, received_at ASC, created_at ASC LIMIT 1;
    IF v_lot.id IS NULL THEN
      SELECT * INTO v_lot FROM inventory_lots
        WHERE inventory_id=p_inventory_id AND stock_state='live' AND (open_bottle_ml>0 OR qty>0)
        ORDER BY (open_bottle_ml>0) DESC, received_at ASC, created_at ASC LIMIT 1;
    END IF;
    IF v_lot.id IS NULL THEN RAISE EXCEPTION 'no stock to pour for inventory %', p_inventory_id; END IF;

    IF v_lot.open_bottle_ml >= v_pour_ml THEN
      UPDATE inventory_lots SET open_bottle_ml = open_bottle_ml - v_pour_ml, updated_at=now() WHERE id=v_lot.id;
    ELSIF v_lot.qty >= 1 THEN
      v_need := v_pour_ml - v_lot.open_bottle_ml;
      UPDATE inventory_lots SET qty = qty - 1, open_bottle_ml = v_bottle_ml - v_need, updated_at=now() WHERE id=v_lot.id;
      v_bottles_opened := v_bottles_opened + 1;
    ELSE
      RAISE EXCEPTION 'insufficient stock for a full pour on inventory %', p_inventory_id;
    END IF;
  END LOOP;

  v_after := (SELECT COALESCE(SUM(qty),0) FROM inventory_lots WHERE inventory_id=p_inventory_id AND stock_state='live');

  IF v_bottles_opened > 0 THEN
    INSERT INTO inventory_transactions
      (restaurant_id, inventory_id, wine_id, transaction_type, source, quantity_change, quantity_before, quantity_after,
       stock_type, performed_by, performed_by_type, reason, metadata, transaction_date)
    VALUES
      (v_restaurant, p_inventory_id, v_wine, 'sale', p_source::inventory_transaction_source, -v_bottles_opened, v_before, v_after,
       'live', p_performed_by, CASE WHEN p_performed_by IS NOT NULL THEN 'user' ELSE 'system' END,
       COALESCE(p_reason, 'by-the-glass pours'),
       jsonb_build_object('pours', p_pours, 'pour_ml', v_pour_ml, 'bottles_opened', v_bottles_opened), now())
    RETURNING id INTO v_txn;
  END IF;

  INSERT INTO pour_events (restaurant_id, inventory_id, master_wine_id, pours, pour_ml, bottles_opened, location_id, source, performed_by, idempotency_key)
  VALUES (v_restaurant, p_inventory_id, v_wine, p_pours, v_pour_ml, v_bottles_opened, p_location_id, p_source, p_performed_by, p_idempotency_key);

  RETURN jsonb_build_object(
    'pours', p_pours, 'pour_ml', v_pour_ml, 'bottles_opened', v_bottles_opened,
    'sealed_now', v_after,
    'open_ml_now', (SELECT COALESCE(SUM(open_bottle_ml),0) FROM inventory_lots WHERE inventory_id=p_inventory_id AND stock_state='live'),
    'txn', v_txn);
END;
$$;


--
-- Name: record_inventory_transaction(uuid, uuid, uuid, public.inventory_transaction_type, public.inventory_transaction_source, integer, character varying, character varying, uuid, character varying, uuid, numeric, uuid, character varying, text, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_inventory_transaction(p_restaurant_id uuid, p_inventory_id uuid, p_wine_id uuid, p_transaction_type public.inventory_transaction_type, p_source public.inventory_transaction_source, p_quantity_change integer, p_stock_type character varying DEFAULT 'live'::character varying, p_reference_type character varying DEFAULT NULL::character varying, p_reference_id uuid DEFAULT NULL::uuid, p_pos_transaction_id character varying DEFAULT NULL::character varying, p_order_id uuid DEFAULT NULL::uuid, p_unit_cost numeric DEFAULT NULL::numeric, p_performed_by uuid DEFAULT NULL::uuid, p_performed_by_type character varying DEFAULT 'user'::character varying, p_reason text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_metadata jsonb DEFAULT '{}'::jsonb) RETURNS uuid
    LANGUAGE plpgsql
    AS $_$
DECLARE
    v_quantity_before INTEGER;
    v_quantity_after INTEGER;
    v_transaction_id UUID;
    v_stock_column TEXT;
BEGIN
    -- Determine which stock column to read
    v_stock_column := CASE p_stock_type
        WHEN 'live' THEN 'live_stock'
        WHEN 'shadow' THEN 'shadow_stock'
        ELSE 'live_stock'
    END;
    
    -- Get current quantity (with row lock)
    EXECUTE format(
        'SELECT COALESCE(%I, 0) FROM restaurant_inventory WHERE id = $1 FOR UPDATE',
        v_stock_column
    ) INTO v_quantity_before USING p_inventory_id;
    
    IF v_quantity_before IS NULL THEN
        RAISE EXCEPTION 'Inventory item not found: %', p_inventory_id;
    END IF;
    
    -- Calculate new quantity
    v_quantity_after := v_quantity_before + p_quantity_change;
    
    -- Prevent negative stock (optional - can be disabled for certain transaction types)
    IF v_quantity_after < 0 AND p_transaction_type NOT IN ('correction', 'reconciliation') THEN
        RAISE EXCEPTION 'Insufficient stock. Current: %, Requested change: %', v_quantity_before, p_quantity_change;
    END IF;
    
    -- Insert transaction record
    INSERT INTO inventory_transactions (
        restaurant_id,
        inventory_id,
        wine_id,
        transaction_type,
        source,
        quantity_change,
        quantity_before,
        quantity_after,
        stock_type,
        reference_type,
        reference_id,
        pos_transaction_id,
        order_id,
        unit_cost,
        total_cost,
        performed_by,
        performed_by_type,
        reason,
        notes,
        metadata
    ) VALUES (
        p_restaurant_id,
        p_inventory_id,
        p_wine_id,
        p_transaction_type,
        p_source,
        p_quantity_change,
        v_quantity_before,
        v_quantity_after,
        p_stock_type,
        p_reference_type,
        p_reference_id,
        p_pos_transaction_id,
        p_order_id,
        p_unit_cost,
        CASE WHEN p_unit_cost IS NOT NULL THEN p_unit_cost * ABS(p_quantity_change) ELSE NULL END,
        p_performed_by,
        p_performed_by_type,
        p_reason,
        p_notes,
        p_metadata
    ) RETURNING id INTO v_transaction_id;
    
    -- Update the inventory table
    EXECUTE format(
        'UPDATE restaurant_inventory SET %I = $1, updated_at = NOW() WHERE id = $2',
        v_stock_column
    ) USING v_quantity_after, p_inventory_id;
    
    RETURN v_transaction_id;
END;
$_$;


--
-- Name: refresh_event_aggregates(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_event_aggregates() RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY event_aggregates_hourly;
    REFRESH MATERIALIZED VIEW CONCURRENTLY event_aggregates_daily;
END;
$$;


--
-- Name: refresh_inventory_transaction_summary(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_inventory_transaction_summary() RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY inventory_transaction_summary;
END;
$$;


--
-- Name: resolve_sku_to_inventory(uuid, character varying, character varying); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.resolve_sku_to_inventory(p_restaurant_id uuid, p_sku character varying, p_toast_guid character varying DEFAULT NULL::character varying) RETURNS uuid
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE
    v_inventory_id UUID;
BEGIN
    -- Priority 1: Try Toast GUID first (most reliable for POS sync)
    IF p_toast_guid IS NOT NULL THEN
        SELECT id INTO v_inventory_id
        FROM restaurant_inventory
        WHERE restaurant_id = p_restaurant_id
          AND toast_item_guid = p_toast_guid
          AND deleted_at IS NULL
        LIMIT 1;
        
        IF v_inventory_id IS NOT NULL THEN
            RETURN v_inventory_id;
        END IF;
    END IF;
    
    -- Priority 2: Try direct SKU match
    SELECT id INTO v_inventory_id
    FROM restaurant_inventory ri
    WHERE ri.restaurant_id = p_restaurant_id
      AND ri.deleted_at IS NULL
      AND (ri.sku = p_sku OR ri.internal_sku = p_sku OR ri.pos_sku = p_sku)
    LIMIT 1;
    
    IF v_inventory_id IS NOT NULL THEN
        RETURN v_inventory_id;
    END IF;
    
    -- Priority 3: Try master wine SKU
    SELECT ri.id INTO v_inventory_id
    FROM restaurant_inventory ri
    JOIN master_wine_library mw ON ri.master_wine_id = mw.id
    WHERE ri.restaurant_id = p_restaurant_id
      AND ri.deleted_at IS NULL
      AND (mw.sku = p_sku OR mw.upc = p_sku OR mw.ean = p_sku)
    LIMIT 1;
    
    IF v_inventory_id IS NOT NULL THEN
        RETURN v_inventory_id;
    END IF;
    
    -- Priority 4: Try SKU mappings table
    SELECT sm.inventory_id INTO v_inventory_id
    FROM sku_mappings sm
    WHERE sm.restaurant_id = p_restaurant_id
      AND sm.sku_value = p_sku
      AND sm.is_active = true
    LIMIT 1;
    
    RETURN v_inventory_id;  -- May be NULL if not found
END;
$$;


--
-- Name: seed_sim_restaurant(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.seed_sim_restaurant(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_org jsonb := payload->'organization';
  v_restaurant jsonb := payload->'restaurant';
  v_menu jsonb := payload->'restaurant_menu';
  v_run jsonb := payload->'oracle_run';
  v_restaurant_id uuid;
  v_slug text;
  v_item jsonb;
  v_fact jsonb;
  v_wine jsonb;
  v_sub jsonb;
  v_ura jsonb;
  v_user jsonb;
  v_member jsonb;
  v_inv jsonb;
  v_vintage int;
BEGIN
  IF v_restaurant IS NULL OR v_run IS NULL THEN
    RAISE EXCEPTION 'seed_sim_restaurant: restaurant and oracle_run required';
  END IF;

  v_slug := v_restaurant->>'slug';
  IF v_slug IS NULL OR v_slug NOT LIKE 'sim-%' THEN
    RAISE EXCEPTION 'seed_sim_restaurant: refusing non-sim slug %', v_slug;
  END IF;
  IF v_slug = 'e2e-test-restaurant' THEN
    RAISE EXCEPTION 'seed_sim_restaurant: refusing e2e anchor slug';
  END IF;

  v_restaurant_id := (v_restaurant->>'id')::uuid;

  -- organizations
  INSERT INTO organizations (id, name)
  VALUES ((v_org->>'id')::uuid, v_org->>'name')
  ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

  -- restaurants (UUID5 id + sim-* slug)
  INSERT INTO restaurants (
    id, organization_id, name, slug, timezone, city, country,
    cuisine_type, default_threshold_min, is_active
  )
  VALUES (
    v_restaurant_id,
    (v_restaurant->>'organization_id')::uuid,
    v_restaurant->>'name',
    v_slug,
    v_restaurant->>'timezone',
    v_restaurant->>'city',
    v_restaurant->>'country',
    v_restaurant->>'cuisine_type',
    COALESCE((v_restaurant->>'default_threshold_min')::int, 5),
    COALESCE((v_restaurant->>'is_active')::boolean, true)
  )
  ON CONFLICT (id) DO UPDATE SET
    organization_id = EXCLUDED.organization_id,
    name = EXCLUDED.name,
    slug = EXCLUDED.slug,
    timezone = EXCLUDED.timezone,
    city = EXCLUDED.city,
    country = EXCLUDED.country,
    cuisine_type = EXCLUDED.cuisine_type,
    default_threshold_min = EXCLUDED.default_threshold_min,
    is_active = EXCLUDED.is_active;

  -- public.users mirrors (live schema: no auth_provider)
  FOR v_user IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'users', '[]'::jsonb))
  LOOP
    INSERT INTO users (user_id, email, name, role, email_verified)
    VALUES (
      (v_user->>'user_id')::uuid,
      v_user->>'email',
      v_user->>'name',
      v_user->>'role',
      true
    )
    ON CONFLICT (user_id) DO UPDATE SET
      email = EXCLUDED.email,
      name = EXCLUDED.name,
      role = EXCLUDED.role,
      email_verified = EXCLUDED.email_verified;
  END LOOP;

  FOR v_member IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'organization_members', '[]'::jsonb))
  LOOP
    INSERT INTO organization_members (organization_id, user_id, role)
    VALUES (
      (v_member->>'organization_id')::uuid,
      (v_member->>'user_id')::uuid,
      v_member->>'role'
    )
    ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role;
  END LOOP;

  FOR v_ura IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'user_restaurant_access', '[]'::jsonb))
  LOOP
    INSERT INTO user_restaurant_access (user_id, restaurant_id, role, is_active)
    VALUES (
      (v_ura->>'user_id')::uuid,
      (v_ura->>'restaurant_id')::uuid,
      v_ura->>'role',
      COALESCE((v_ura->>'is_active')::boolean, true)
    )
    ON CONFLICT (user_id, restaurant_id) DO UPDATE SET
      role = EXCLUDED.role,
      is_active = EXCLUDED.is_active;
  END LOOP;

  -- provisional master wines (source = sim; live schema uses primary_type not wine_type)
  FOR v_wine IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'master_wine_library', '[]'::jsonb))
  LOOP
    BEGIN
      v_vintage := NULLIF(v_wine->>'vintage', '')::int;
    EXCEPTION WHEN others THEN
      v_vintage := NULL;
    END;
    INSERT INTO master_wine_library (
      id, wine_id, name, producer, vintage, region, country, grape_variety,
      primary_type, signature_hash, source, data_enrichment
    )
    VALUES (
      (v_wine->>'id')::uuid,
      COALESCE(
        NULLIF(v_wine->>'wine_id', ''),
        'sim' || left(replace(COALESCE(v_wine->>'signature_hash', v_wine->>'id'), '-', ''), 17)
      ),
      v_wine->>'name',
      v_wine->>'producer',
      v_vintage,
      v_wine->>'region',
      v_wine->>'country',
      v_wine->>'grape_variety',
      COALESCE(v_wine->>'primary_type', v_wine->>'wine_type', 'unknown'),
      v_wine->>'signature_hash',
      COALESCE(v_wine->>'source', 'sim'),
      COALESCE(v_wine->'data_enrichment', jsonb_build_object('source', 'sim'))
    )
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      producer = EXCLUDED.producer,
      signature_hash = EXCLUDED.signature_hash,
      source = EXCLUDED.source,
      primary_type = EXCLUDED.primary_type,
      data_enrichment = EXCLUDED.data_enrichment;
  END LOOP;

  FOR v_sub IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'master_wine_library_submissions', '[]'::jsonb))
  LOOP
    INSERT INTO master_wine_library_submissions (
      id, restaurant_id, signature_hash, status, matched_master_id, payload
    )
    VALUES (
      (v_sub->>'id')::uuid,
      (v_sub->>'restaurant_id')::uuid,
      v_sub->>'signature_hash',
      COALESCE(v_sub->>'status', 'accepted'),
      (v_sub->>'matched_master_id')::uuid,
      COALESCE(v_sub->'payload', '{}'::jsonb)
    )
    ON CONFLICT (id) DO UPDATE SET
      status = EXCLUDED.status,
      matched_master_id = EXCLUDED.matched_master_id,
      payload = EXCLUDED.payload;
  END LOOP;

  INSERT INTO restaurant_menus (id, restaurant_id, name, menu_type, status, season)
  VALUES (
    (v_menu->>'id')::uuid,
    (v_menu->>'restaurant_id')::uuid,
    COALESCE(v_menu->>'name', 'Wine List'),
    COALESCE(v_menu->>'menu_type', 'beverage'),
    COALESCE(v_menu->>'status', 'active'),
    COALESCE(v_menu->>'season', 'year_round')
  )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    menu_type = EXCLUDED.menu_type,
    status = EXCLUDED.status;

  -- Idempotent re-seed: replace menu items + inventory for this restaurant
  DELETE FROM menu_items WHERE restaurant_id = v_restaurant_id;
  DELETE FROM restaurant_inventory WHERE restaurant_id = v_restaurant_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'menu_items', '[]'::jsonb))
  LOOP
    INSERT INTO menu_items (
      id, menu_id, restaurant_id, name, producer, vintage, region, country,
      grape_variety, bottle_price, by_glass_price, wine_library_id, source, status
    )
    VALUES (
      (v_item->>'id')::uuid,
      (v_item->>'menu_id')::uuid,
      (v_item->>'restaurant_id')::uuid,
      v_item->>'name',
      v_item->>'producer',
      v_item->>'vintage',
      v_item->>'region',
      v_item->>'country',
      v_item->>'grape_variety',
      NULLIF(v_item->>'bottle_price', '')::numeric,
      NULLIF(v_item->>'by_glass_price', '')::numeric,
      (v_item->>'wine_library_id')::uuid,
      COALESCE(v_item->>'source', 'manual'),
      COALESCE(v_item->>'status', 'approved')
    );
  END LOOP;

  -- Opening stock goes to restaurant_inventory.stock_live only
  FOR v_inv IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'restaurant_inventory', '[]'::jsonb))
  LOOP
    INSERT INTO restaurant_inventory (
      id, restaurant_id, master_wine_id, wine_name, stock_live, threshold_min, is_active
    )
    VALUES (
      (v_inv->>'id')::uuid,
      (v_inv->>'restaurant_id')::uuid,
      (v_inv->>'master_wine_id')::uuid,
      v_inv->>'wine_name',
      COALESCE((v_inv->>'stock_live')::int, 0),
      COALESCE((v_inv->>'threshold_min')::int, 5),
      COALESCE((v_inv->>'is_active')::boolean, true)
    );
  END LOOP;

  -- Oracle last inside same TX — failure rolls back live rows (D-10)
  DELETE FROM sim_ground_truth_facts WHERE restaurant_id = v_restaurant_id;
  DELETE FROM sim_ground_truth_runs WHERE restaurant_id = v_restaurant_id;

  INSERT INTO sim_ground_truth_runs (
    id, restaurant_id, archetype_id, seed_version, menu_quality,
    snapshot_path, snapshot_sha256, params, sku_count, priced_sku_count
  )
  VALUES (
    (v_run->>'id')::uuid,
    (v_run->>'restaurant_id')::uuid,
    v_run->>'archetype_id',
    v_run->>'seed_version',
    v_run->>'menu_quality',
    v_run->>'snapshot_path',
    v_run->>'snapshot_sha256',
    COALESCE(v_run->'params', '{}'::jsonb),
    COALESCE((v_run->>'sku_count')::int, 0),
    COALESCE((v_run->>'priced_sku_count')::int, 0)
  );

  FOR v_fact IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'oracle_facts', '[]'::jsonb))
  LOOP
    INSERT INTO sim_ground_truth_facts (
      id, run_id, restaurant_id, fact_type, sku_key, entity_ref, payload
    )
    VALUES (
      (v_fact->>'id')::uuid,
      (v_fact->>'run_id')::uuid,
      (v_fact->>'restaurant_id')::uuid,
      v_fact->>'fact_type',
      v_fact->>'sku_key',
      COALESCE(v_fact->'entity_ref', '{}'::jsonb),
      COALESCE(v_fact->'payload', '{}'::jsonb)
    );
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'restaurant_id', v_restaurant_id,
    'slug', v_slug,
    'sku_count', COALESCE((v_run->>'sku_count')::int, 0),
    'fact_count', jsonb_array_length(COALESCE(payload->'oracle_facts', '[]'::jsonb))
  );
END;
$$;


--
-- Name: set_conversation_thread_key(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_conversation_thread_key() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.thread_key IS NULL OR btrim(NEW.thread_key) = '' THEN
        NEW.thread_key := public.conversation_thread_key(
            NEW.id, NEW.gmail_thread_id, NEW.email_headers, NEW.provider_id, NEW.message_text
        );
    END IF;

    IF NEW.order_id IS NOT NULL AND NEW.order_number_snapshot IS NULL THEN
        SELECT order_number INTO NEW.order_number_snapshot
        FROM public.procurement_orders
        WHERE id = NEW.order_id;
    END IF;

    RETURN NEW;
END;
$$;


--
-- Name: storage_locations_set_full_location(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.storage_locations_set_full_location() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.full_location :=
        CONCAT_WS(' > ',
            NULLIF(NEW.zone, ''),
            NULLIF(NEW.section, ''),
            CASE WHEN NEW.shelf IS NULL OR NEW.shelf = '' THEN NULL ELSE 'Shelf ' || NEW.shelf END,
            CASE WHEN NEW.position IS NULL OR NEW.position = '' THEN NULL ELSE 'Pos ' || NEW.position END
        );
    RETURN NEW;
END;
$$;


--
-- Name: sync_calendar_event_date_columns(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_calendar_event_date_columns() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- start_date ↔ event_date
  IF NEW.start_date IS NOT NULL AND (OLD IS NULL OR OLD.start_date IS DISTINCT FROM NEW.start_date) THEN
    NEW.event_date := NEW.start_date;
  ELSIF NEW.event_date IS NOT NULL AND (OLD IS NULL OR OLD.event_date IS DISTINCT FROM NEW.event_date) THEN
    NEW.start_date := NEW.event_date;
  END IF;

  -- end_date ↔ event_date_end
  IF NEW.end_date IS NOT NULL THEN
    NEW.event_date_end := NEW.end_date;
  ELSIF NEW.event_date_end IS NOT NULL AND NEW.end_date IS NULL THEN
    NEW.end_date := NEW.event_date_end;
  END IF;

  -- start_time ↔ event_time
  IF NEW.start_time IS NOT NULL THEN
    NEW.event_time := NEW.start_time;
  ELSIF NEW.event_time IS NOT NULL AND NEW.start_time IS NULL THEN
    NEW.start_time := NEW.event_time;
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: sync_lots_from_inventory(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_lots_from_inventory() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.stock_live IS DISTINCT FROM OLD.stock_live THEN
    UPDATE inventory_lots SET qty = GREATEST(COALESCE(NEW.stock_live, 0), 0), updated_at = now()
      WHERE inventory_id = NEW.id AND stock_state = 'live';
    IF NOT FOUND AND COALESCE(NEW.stock_live, 0) > 0 THEN
      INSERT INTO inventory_lots (restaurant_id, inventory_id, master_wine_id, stock_state, qty, cost_provenance)
      VALUES (NEW.restaurant_id, NEW.id, NEW.master_wine_id, 'live', NEW.stock_live, 'estimated');
    END IF;
  END IF;
  IF NEW.shadow_stock IS DISTINCT FROM OLD.shadow_stock THEN
    UPDATE inventory_lots SET qty = GREATEST(COALESCE(NEW.shadow_stock, 0), 0), updated_at = now()
      WHERE inventory_id = NEW.id AND stock_state = 'shadow';
    IF NOT FOUND AND COALESCE(NEW.shadow_stock, 0) > 0 THEN
      INSERT INTO inventory_lots (restaurant_id, inventory_id, master_wine_id, stock_state, qty, cost_provenance)
      VALUES (NEW.restaurant_id, NEW.id, NEW.master_wine_id, 'shadow', NEW.shadow_stock, 'estimated');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: sync_sku_to_new_inventory(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_sku_to_new_inventory() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- If no SKU set on inventory, copy from master wine
    IF NEW.sku IS NULL THEN
        SELECT sku INTO NEW.sku
        FROM master_wine_library
        WHERE id = NEW.master_wine_id;
    END IF;
    
    RETURN NEW;
END;
$$;


--
-- Name: tenant_isolation_report(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tenant_isolation_report() RETURNS jsonb
    LANGUAGE sql STABLE
    AS $$
  SELECT jsonb_build_object(
    'checked_at', now(),
    'restaurants', (SELECT count(*) FROM public.restaurants),
    'prospects_orphaned', (
      SELECT count(*) FROM public.email_prospects ep
      WHERE ep.restaurant_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM public.restaurants r WHERE r.id = ep.restaurant_id)
    ),
    'prospects_triage_open', (
      SELECT count(*) FROM public.email_prospects
      WHERE restaurant_id IS NULL AND status = 'new'
    ),
    'prospects_distinct_restaurants', (
      SELECT count(DISTINCT restaurant_id) FROM public.email_prospects WHERE restaurant_id IS NOT NULL
    ),
    'inbound_addr_orphaned', (
      SELECT count(*) FROM public.restaurant_inbound_addresses a
      WHERE NOT EXISTS (SELECT 1 FROM public.restaurants r WHERE r.id = a.restaurant_id)
    ),
    'provider_email_cross_tenant', (
      SELECT count(*) FROM (
        SELECT lower(contact_email) AS e
        FROM public.providers
        WHERE contact_email IS NOT NULL AND contact_email <> '' AND deleted_at IS NULL
        GROUP BY lower(contact_email)
        HAVING count(DISTINCT restaurant_id) > 1
      ) x
    )
  );
$$;


--
-- Name: transfer_stock(uuid, uuid, uuid, integer, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.transfer_stock(p_inventory_id uuid, p_from_location_id uuid, p_to_location_id uuid, p_qty integer, p_performed_by uuid DEFAULT NULL::uuid, p_reason text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_restaurant uuid; v_wine uuid;
  v_src_before int; v_dst_before int; v_remaining int; v_move int;
  v_lot record; v_group uuid := gen_random_uuid();
BEGIN
  IF p_qty <= 0 THEN RAISE EXCEPTION 'transfer qty must be > 0'; END IF;
  IF p_from_location_id IS NOT DISTINCT FROM p_to_location_id THEN RETURN; END IF;

  SELECT restaurant_id, master_wine_id INTO v_restaurant, v_wine
    FROM restaurant_inventory WHERE id = p_inventory_id FOR UPDATE;
  IF v_restaurant IS NULL THEN RAISE EXCEPTION 'inventory % not found', p_inventory_id; END IF;

  SELECT COALESCE(SUM(qty),0) INTO v_src_before FROM inventory_lots
    WHERE inventory_id = p_inventory_id AND stock_state='live' AND location_id IS NOT DISTINCT FROM p_from_location_id;
  SELECT COALESCE(SUM(qty),0) INTO v_dst_before FROM inventory_lots
    WHERE inventory_id = p_inventory_id AND stock_state='live' AND location_id IS NOT DISTINCT FROM p_to_location_id;
  IF v_src_before < p_qty THEN
    RAISE EXCEPTION 'not enough stock at source location (% available, % requested)', v_src_before, p_qty;
  END IF;

  v_remaining := p_qty;
  FOR v_lot IN SELECT id, qty, unit_cost, cost_provenance, vintage, source_order_id FROM inventory_lots
      WHERE inventory_id = p_inventory_id AND stock_state='live' AND qty > 0
        AND location_id IS NOT DISTINCT FROM p_from_location_id
      ORDER BY received_at ASC, created_at ASC LOOP
    EXIT WHEN v_remaining <= 0;
    v_move := LEAST(v_lot.qty, v_remaining);
    IF v_lot.qty <= v_move THEN
      DELETE FROM inventory_lots WHERE id = v_lot.id;
    ELSE
      UPDATE inventory_lots SET qty = qty - v_move, updated_at = now() WHERE id = v_lot.id;
    END IF;
    INSERT INTO inventory_lots (restaurant_id, inventory_id, master_wine_id, location_id, stock_state, qty, unit_cost, cost_provenance, vintage, source_order_id)
    VALUES (v_restaurant, p_inventory_id, v_wine, p_to_location_id, 'live', v_move, v_lot.unit_cost, v_lot.cost_provenance, v_lot.vintage, v_lot.source_order_id);
    v_remaining := v_remaining - v_move;
  END LOOP;

  -- Balanced ledger pair (location-scoped before/after satisfy the CHECK; total is unchanged).
  INSERT INTO inventory_transactions (restaurant_id, inventory_id, wine_id, transaction_type, source, quantity_change, quantity_before, quantity_after, stock_type, from_location_id, to_location_id, performed_by, performed_by_type, reason, metadata, transaction_date)
  VALUES
    (v_restaurant, p_inventory_id, v_wine, 'transfer', 'manual', -p_qty, v_src_before, v_src_before - p_qty, 'live', p_from_location_id, p_to_location_id, p_performed_by, CASE WHEN p_performed_by IS NOT NULL THEN 'user' ELSE 'system' END, COALESCE(p_reason,'location transfer'), jsonb_build_object('transfer_group', v_group, 'leg', 'out'), now()),
    (v_restaurant, p_inventory_id, v_wine, 'transfer', 'manual',  p_qty, v_dst_before, v_dst_before + p_qty, 'live', p_from_location_id, p_to_location_id, p_performed_by, CASE WHEN p_performed_by IS NOT NULL THEN 'user' ELSE 'system' END, COALESCE(p_reason,'location transfer'), jsonb_build_object('transfer_group', v_group, 'leg', 'in'), now());
END;
$$;


--
-- Name: update_event_time_flags(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_event_time_flags(batch_size integer DEFAULT 10000) RETURNS TABLE(recent_cleared integer, archive_marked integer)
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_recent_cleared INTEGER := 0;
    v_archive_marked INTEGER := 0;
BEGIN
    -- Clear is_recent flag for events older than 7 days
    UPDATE events
    SET is_recent = false
    WHERE id IN (
        SELECT id FROM events
        WHERE is_recent = true
          AND created_at < NOW() - INTERVAL '7 days'
        LIMIT batch_size
        FOR UPDATE SKIP LOCKED
    );
    GET DIAGNOSTICS v_recent_cleared = ROW_COUNT;
    
    -- Mark archive candidates (older than 90 days, not archived)
    UPDATE events
    SET is_archive_candidate = true
    WHERE id IN (
        SELECT id FROM events
        WHERE is_archive_candidate = false
          AND archived_at IS NULL
          AND created_at < NOW() - INTERVAL '90 days'
        LIMIT batch_size
        FOR UPDATE SKIP LOCKED
    );
    GET DIAGNOSTICS v_archive_marked = ROW_COUNT;
    
    RETURN QUERY SELECT v_recent_cleared, v_archive_marked;
END;
$$;


--
-- Name: update_library_tier_timestamp(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_library_tier_timestamp() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.library_tier IS DISTINCT FROM OLD.library_tier THEN
        NEW.library_tier_updated_at = NOW();
    END IF;
    RETURN NEW;
END;
$$;


--
-- Name: update_one_tap_actions_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_one_tap_actions_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


--
-- Name: update_producers_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_producers_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


--
-- Name: update_rd_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_rd_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: _migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public._migrations (
    id integer NOT NULL,
    version character varying(10) NOT NULL,
    name character varying(255) NOT NULL,
    applied_at timestamp with time zone DEFAULT now(),
    checksum character varying(64),
    execution_time_ms integer,
    success boolean DEFAULT true,
    error_message text
);


--
-- Name: _migrations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public._migrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: _migrations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public._migrations_id_seq OWNED BY public._migrations.id;


--
-- Name: ab_experiments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ab_experiments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    experiment_name character varying(200) NOT NULL,
    agent_name character varying(100) NOT NULL,
    parameter_name character varying(200) NOT NULL,
    variant_a jsonb NOT NULL,
    variant_b jsonb NOT NULL,
    metric character varying(100) NOT NULL,
    sample_size_target integer DEFAULT 100,
    current_sample_a integer DEFAULT 0,
    current_sample_b integer DEFAULT 0,
    success_count_a integer DEFAULT 0,
    success_count_b integer DEFAULT 0,
    winner character varying(1),
    confidence double precision,
    status character varying(20) DEFAULT 'DISABLED'::character varying,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: agent_activity_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_activity_logs (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    agent_name character varying(100) NOT NULL,
    agent_action character varying(100) NOT NULL,
    restaurant_id uuid,
    related_entity_type character varying(50),
    related_entity_id uuid,
    started_at timestamp with time zone NOT NULL,
    completed_at timestamp with time zone,
    duration_ms integer,
    status character varying(50) NOT NULL,
    error_message text,
    error_stack text,
    llm_model character varying(50),
    tokens_used integer,
    llm_cost_usd numeric(10,6),
    input_data jsonb,
    output_data jsonb,
    edge_case_detected boolean DEFAULT false,
    edge_case_type character varying(100),
    improvement_suggestion text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: agent_evolution_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_evolution_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agent_name character varying(100) NOT NULL,
    parameter_changed character varying(200) NOT NULL,
    old_value jsonb NOT NULL,
    new_value jsonb NOT NULL,
    reason text NOT NULL,
    confidence double precision,
    approved_by character varying(50) NOT NULL,
    experiment_id uuid,
    rollback_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: ai_feedback_loop; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_feedback_loop (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid,
    agent_name character varying(100) NOT NULL,
    event_type character varying(100) NOT NULL,
    prediction jsonb NOT NULL,
    actual_outcome jsonb,
    correction_type character varying(50),
    correction_details jsonb,
    improvement_signal double precision,
    context jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: analytics_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_cache (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    restaurant_id uuid NOT NULL,
    cache_key character varying(255) NOT NULL,
    cache_type character varying(100) NOT NULL,
    period_start timestamp with time zone NOT NULL,
    period_end timestamp with time zone NOT NULL,
    data jsonb NOT NULL,
    row_count integer,
    calculation_time_ms integer,
    expires_at timestamp with time zone,
    is_stale boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: analytics_goals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_goals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    name text NOT NULL,
    metric_key text NOT NULL,
    target_value numeric(14,2) NOT NULL,
    baseline_value numeric(14,2),
    current_value numeric(14,2) DEFAULT 0 NOT NULL,
    direction text DEFAULT 'at_least'::text NOT NULL,
    period text DEFAULT 'custom'::text NOT NULL,
    deadline date,
    status text DEFAULT 'active'::text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: analytics_insight_prefs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_insight_prefs (
    restaurant_id uuid NOT NULL,
    category text NOT NULL,
    cadence text DEFAULT 'daily'::text NOT NULL,
    hour_of_day integer DEFAULT 6 NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    last_run_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: analytics_insights; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_insights (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    candidate_key text NOT NULL,
    category text NOT NULL,
    entity_key text,
    entity_label text,
    sentence text NOT NULL,
    score numeric(8,2) DEFAULT 0 NOT NULL,
    effect_pct numeric(10,4),
    z_score numeric(10,4),
    evidence jsonb DEFAULT '{}'::jsonb NOT NULL,
    period_start date,
    period_end date,
    computed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: api_idempotency_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.api_idempotency_keys (
    key text NOT NULL,
    user_id uuid,
    method text NOT NULL,
    path text NOT NULL,
    status_code integer NOT NULL,
    response jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: api_spend; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.api_spend (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider character varying(50) NOT NULL,
    model character varying(100) NOT NULL,
    input_tokens integer DEFAULT 0 NOT NULL,
    output_tokens integer DEFAULT 0 NOT NULL,
    cost_usd numeric(10,6) DEFAULT 0.0 NOT NULL,
    restaurant_id uuid,
    "timestamp" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: appellation_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.appellation_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    appellation_id uuid,
    appellation_name text NOT NULL,
    required_grapes jsonb DEFAULT '[]'::jsonb NOT NULL,
    allowed_grapes jsonb DEFAULT '[]'::jsonb NOT NULL,
    min_aging_months integer,
    min_vintage_release_delay_months integer,
    allowed_colors text[] DEFAULT '{}'::text[] NOT NULL,
    max_yield_hl_ha numeric(6,2),
    classification_levels text[] DEFAULT '{}'::text[] NOT NULL,
    effective_from date,
    effective_to date,
    source_ref text,
    updated_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: batch_operations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.batch_operations (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    restaurant_id uuid NOT NULL,
    operation_type character varying(100) NOT NULL,
    operation_description text,
    items_count integer NOT NULL,
    items_affected jsonb,
    operation_data jsonb,
    is_preview boolean DEFAULT true,
    applied_at timestamp with time zone,
    success_count integer DEFAULT 0,
    failure_count integer DEFAULT 0,
    results jsonb,
    requires_approval boolean DEFAULT true,
    approved_by uuid,
    approved_at timestamp with time zone,
    rejection_reason text,
    can_rollback boolean DEFAULT false,
    rollback_data jsonb,
    rolled_back_at timestamp with time zone,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: budgets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.budgets (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    restaurant_id uuid NOT NULL,
    period_type character varying(50) NOT NULL,
    period_start date NOT NULL,
    period_end date NOT NULL,
    total_budget numeric(12,2) NOT NULL,
    total_spent numeric(12,2) DEFAULT 0,
    category_budgets jsonb,
    alert_at_percentage integer DEFAULT 75,
    alerted_at_75 boolean DEFAULT false,
    alerted_at_90 boolean DEFAULT false,
    alerted_at_100 boolean DEFAULT false,
    projected_spend numeric(12,2),
    projection_confidence numeric(3,2),
    last_projection_date date,
    status character varying(50) DEFAULT 'active'::character varying,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: calendar_event_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.calendar_event_types (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    name text NOT NULL,
    color text DEFAULT '#6b7280'::text NOT NULL,
    icon text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: calendar_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.calendar_events (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    restaurant_id uuid NOT NULL,
    provider_id uuid,
    order_id uuid,
    title character varying(255) NOT NULL,
    description text,
    event_type character varying(100) NOT NULL,
    event_date date NOT NULL,
    event_date_end date,
    all_day boolean DEFAULT true,
    event_time time without time zone,
    source character varying(50) NOT NULL,
    ai_confidence numeric(3,2),
    detected_from_conversation_id uuid,
    status character varying(50) DEFAULT 'pending'::character varying,
    reminder_enabled boolean DEFAULT true,
    reminder_days_before integer DEFAULT 1,
    reminder_sent boolean DEFAULT false,
    reminder_sent_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    is_recurring boolean DEFAULT false,
    recurrence_rule_id uuid,
    parent_event_id uuid,
    occurrence_date date,
    is_exception boolean DEFAULT false,
    exception_type character varying(50),
    color character varying(7) DEFAULT NULL::character varying,
    start_date date,
    end_date date,
    start_time time without time zone,
    end_time time without time zone
);


--
-- Name: calendar_recurrence_exceptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.calendar_recurrence_exceptions (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    recurrence_rule_id uuid NOT NULL,
    original_date date NOT NULL,
    exception_type character varying(50) NOT NULL,
    replacement_event_id uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: calendar_recurrence_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.calendar_recurrence_rules (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    restaurant_id uuid NOT NULL,
    calendar_event_id uuid NOT NULL,
    frequency public.recurrence_frequency NOT NULL,
    interval_value integer DEFAULT 1 NOT NULL,
    days_of_week integer[],
    day_of_month integer,
    week_of_month integer,
    month_of_year integer,
    end_type public.recurrence_end_type DEFAULT 'never'::public.recurrence_end_type NOT NULL,
    end_after_count integer,
    end_on_date date,
    last_generated_date date,
    next_generation_date date,
    generation_horizon_days integer DEFAULT 90,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT valid_day_of_month CHECK (((day_of_month IS NULL) OR ((day_of_month >= 1) AND (day_of_month <= 31)))),
    CONSTRAINT valid_end_count CHECK (((end_after_count IS NULL) OR (end_after_count > 0))),
    CONSTRAINT valid_interval CHECK ((interval_value > 0)),
    CONSTRAINT valid_month_of_year CHECK (((month_of_year IS NULL) OR ((month_of_year >= 1) AND (month_of_year <= 12)))),
    CONSTRAINT valid_week_of_month CHECK (((week_of_month IS NULL) OR ((week_of_month >= 1) AND (week_of_month <= 5))))
);


--
-- Name: check_scans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.check_scans (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    restaurant_id uuid,
    scan_date date NOT NULL,
    total_amount numeric(10,2),
    wine_sales numeric(10,2),
    wine_cost numeric(10,2),
    profit_margin numeric(5,2),
    extracted_data jsonb,
    file_url text,
    processed_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: collection_metadata; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.collection_metadata (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source character varying(50) NOT NULL,
    category character varying(50) NOT NULL,
    image_url text,
    storage_path text NOT NULL,
    perceptual_hash character varying(64),
    dimensions jsonb,
    file_size_bytes integer,
    restaurant_name character varying(255),
    collected_at timestamp with time zone DEFAULT now(),
    annotated boolean DEFAULT false,
    annotation_path text
);


--
-- Name: communication_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.communication_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    name character varying(255) NOT NULL,
    subject character varying(500),
    body text NOT NULL,
    type character varying(50) DEFAULT 'email'::character varying NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: confidence_thresholds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.confidence_thresholds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    field_name character varying(100) NOT NULL,
    review_threshold numeric(3,2) DEFAULT 0.50 NOT NULL,
    accept_threshold numeric(3,2) DEFAULT 0.80 NOT NULL,
    last_calibrated_at timestamp with time zone
);


--
-- Name: contact_addresses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contact_addresses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contact_id uuid NOT NULL,
    channel character varying(50) NOT NULL,
    address_value text NOT NULL,
    label character varying(50) DEFAULT 'work'::character varying,
    is_primary boolean DEFAULT false,
    is_verified boolean DEFAULT false,
    metadata jsonb DEFAULT '{}'::jsonb,
    verified_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    type character varying(50) NOT NULL,
    display_name character varying(255) NOT NULL,
    restaurant_id uuid,
    linked_user_id uuid,
    linked_provider_id uuid,
    is_active boolean DEFAULT true,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: conversation_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversation_attachments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    order_id uuid,
    restaurant_id uuid,
    provider_id uuid,
    filename text NOT NULL,
    mime_type text,
    size_bytes bigint,
    storage_path text NOT NULL,
    sha256 text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: conversation_embeddings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversation_embeddings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider_id uuid NOT NULL,
    restaurant_id uuid NOT NULL,
    session_id uuid NOT NULL,
    message_text text NOT NULL,
    role character varying(20) NOT NULL,
    channel character varying(50),
    embedding public.vector(768),
    has_signal boolean DEFAULT false,
    extracted_entities jsonb,
    extracted_intents text[],
    importance_score double precision DEFAULT 0.5,
    sensitive boolean DEFAULT false,
    language character varying(10),
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT conversation_embeddings_role_check CHECK (((role)::text = ANY ((ARRAY['provider'::character varying, 'restaurant'::character varying, 'agent'::character varying])::text[])))
);


--
-- Name: coverage_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.coverage_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    day_of_week integer,
    shift_period text DEFAULT 'pm'::text NOT NULL,
    role text NOT NULL,
    min_staff integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: crawl_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crawl_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid,
    url text NOT NULL,
    visited_at timestamp with time zone DEFAULT now(),
    result_type text,
    content_hash text,
    extracted_text_length integer,
    pdf_downloaded boolean DEFAULT false,
    error_message text,
    CONSTRAINT crawl_log_result_type_check CHECK ((result_type = ANY (ARRAY['html_menu'::text, 'pdf_link'::text, 'screenshot'::text, 'image_only'::text, 'no_menu'::text, 'invalid'::text, 'error'::text])))
);


--
-- Name: crawl_schedule; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crawl_schedule (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    crawl_frequency text DEFAULT 'weekly'::text NOT NULL,
    last_crawled_at timestamp with time zone,
    next_crawl_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    tier character varying(50),
    consecutive_failures integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT crawl_schedule_crawl_frequency_check CHECK ((crawl_frequency = ANY (ARRAY['weekly'::text, 'biweekly'::text, 'monthly'::text]))),
    CONSTRAINT crawl_schedule_status_check CHECK ((status = ANY (ARRAY['active'::text, 'paused'::text, 'error'::text])))
);


--
-- Name: custom_reminders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.custom_reminders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    created_by uuid,
    title character varying(255) NOT NULL,
    description text,
    reminder_type character varying(50) DEFAULT 'custom'::character varying,
    schedule_cron character varying(100),
    next_fire_at timestamp with time zone,
    last_fired_at timestamp with time zone,
    recipient_roles text[] DEFAULT ARRAY['manager'::text],
    recipient_emails text[],
    is_recurring boolean DEFAULT false,
    is_active boolean DEFAULT true,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: dead_letter_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dead_letter_queue (
    id bigint NOT NULL,
    agent_name text NOT NULL,
    original_exchange text NOT NULL,
    original_routing_key text NOT NULL,
    message jsonb NOT NULL,
    error text,
    retry_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    resolved_by text
);


--
-- Name: dead_letter_queue_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.dead_letter_queue_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: dead_letter_queue_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.dead_letter_queue_id_seq OWNED BY public.dead_letter_queue.id;


--
-- Name: decision_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.decision_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agent_name text NOT NULL,
    decision_type text NOT NULL,
    inputs jsonb DEFAULT '{}'::jsonb NOT NULL,
    reasoning jsonb DEFAULT '{}'::jsonb NOT NULL,
    output jsonb DEFAULT '{}'::jsonb NOT NULL,
    confidence double precision,
    correlation_id text,
    restaurant_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: email_prospects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_prospects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid,
    domain text NOT NULL,
    sender_email text,
    sender_name text,
    subject text,
    snippet text,
    has_attachments boolean DEFAULT false NOT NULL,
    message_count integer DEFAULT 1 NOT NULL,
    status text DEFAULT 'new'::text NOT NULL,
    promoted_provider_id uuid,
    first_seen_at timestamp with time zone DEFAULT now(),
    last_seen_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    capture_reason text,
    attachments jsonb DEFAULT '[]'::jsonb NOT NULL,
    gmail_message_id text,
    gmail_thread_id text,
    body_preview text
);


--
-- Name: email_verifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_verifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token uuid DEFAULT gen_random_uuid() NOT NULL,
    email character varying(255) NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '24:00:00'::interval) NOT NULL,
    verified_at timestamp with time zone,
    resend_count integer DEFAULT 0 NOT NULL,
    last_resent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: email_watch_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_watch_state (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    gmail_history_id bigint,
    watch_expiration timestamp with time zone,
    watch_resource_id character varying(255),
    last_sync_at timestamp with time zone,
    error_count integer DEFAULT 0,
    last_error text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: enrichment_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.enrichment_queue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    wine_id uuid NOT NULL,
    fields_targeted jsonb DEFAULT '[]'::jsonb NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    enriched_fields jsonb DEFAULT '{}'::jsonb,
    web_sources jsonb DEFAULT '[]'::jsonb,
    error_message text,
    attempts integer DEFAULT 0,
    max_attempts integer DEFAULT 3,
    queued_at timestamp with time zone DEFAULT now(),
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    CONSTRAINT enrichment_queue_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'in_progress'::text, 'complete'::text, 'failed'::text, 'skipped'::text])))
);


--
-- Name: events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.events (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    restaurant_id uuid NOT NULL,
    user_id uuid,
    event_type public.event_type NOT NULL,
    source_page public.source_page NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    schema_version integer DEFAULT 1 NOT NULL,
    idempotency_key character varying(255),
    trace_id character varying(64),
    correlation_id uuid,
    archived_at timestamp with time zone,
    archive_path text,
    is_recent boolean DEFAULT true,
    is_archive_candidate boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: event_aggregates_daily; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.event_aggregates_daily AS
 SELECT restaurant_id,
    date_trunc('day'::text, created_at) AS day,
    event_type,
    count(*) AS event_count,
    count(DISTINCT user_id) AS unique_users,
    count(DISTINCT source_page) AS pages_affected
   FROM public.events
  WHERE ((created_at > (now() - '90 days'::interval)) AND (archived_at IS NULL))
  GROUP BY restaurant_id, (date_trunc('day'::text, created_at)), event_type
  WITH NO DATA;


--
-- Name: event_aggregates_hourly; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.event_aggregates_hourly AS
 SELECT restaurant_id,
    date_trunc('hour'::text, created_at) AS hour,
    event_type,
    source_page,
    count(*) AS event_count,
    count(DISTINCT user_id) AS unique_users,
    count(DISTINCT idempotency_key) AS unique_events
   FROM public.events
  WHERE ((created_at > (now() - '7 days'::interval)) AND (archived_at IS NULL))
  GROUP BY restaurant_id, (date_trunc('hour'::text, created_at)), event_type, source_page
  WITH NO DATA;


--
-- Name: event_dead_letters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_dead_letters (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    restaurant_id uuid NOT NULL,
    user_id uuid,
    event_type public.event_type NOT NULL,
    source_page public.source_page NOT NULL,
    payload jsonb NOT NULL,
    schema_version integer,
    idempotency_key character varying(255),
    trace_id character varying(64),
    error_code character varying(50) NOT NULL,
    error_message text NOT NULL,
    error_details jsonb,
    error_stack text,
    retry_count integer DEFAULT 0,
    max_retries integer DEFAULT 3,
    next_retry_at timestamp with time zone,
    status public.dlq_status DEFAULT 'pending'::public.dlq_status,
    resolved_by uuid,
    resolution_notes text,
    resolved_event_id uuid,
    failed_at timestamp with time zone DEFAULT now(),
    last_retry_at timestamp with time zone,
    resolved_at timestamp with time zone
);


--
-- Name: event_replay_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_replay_jobs (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    restaurant_id uuid,
    event_types public.event_type[],
    from_timestamp timestamp with time zone NOT NULL,
    to_timestamp timestamp with time zone NOT NULL,
    source character varying(20) NOT NULL,
    archive_paths text[],
    target_type character varying(20) NOT NULL,
    target_endpoint text,
    target_config jsonb,
    status public.replay_job_status DEFAULT 'pending'::public.replay_job_status,
    total_events integer,
    processed_events integer DEFAULT 0,
    failed_events integer DEFAULT 0,
    skipped_events integer DEFAULT 0,
    last_processed_id uuid,
    last_processed_at timestamp with time zone,
    events_per_second integer DEFAULT 100,
    batch_size integer DEFAULT 1000,
    created_by uuid NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now(),
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    error_message text,
    CONSTRAINT event_replay_jobs_source_check CHECK (((source)::text = ANY ((ARRAY['database'::character varying, 'archive'::character varying, 'both'::character varying])::text[]))),
    CONSTRAINT event_replay_jobs_target_type_check CHECK (((target_type)::text = ANY ((ARRAY['realtime'::character varying, 'webhook'::character varying, 'internal'::character varying])::text[])))
);


--
-- Name: event_schema_registry; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_schema_registry (
    id integer NOT NULL,
    event_type public.event_type NOT NULL,
    schema_version integer NOT NULL,
    json_schema jsonb NOT NULL,
    description text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    deprecated_at timestamp with time zone
);


--
-- Name: event_schema_registry_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.event_schema_registry_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: event_schema_registry_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.event_schema_registry_id_seq OWNED BY public.event_schema_registry.id;


--
-- Name: event_store; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_store (
    event_id uuid DEFAULT gen_random_uuid() NOT NULL,
    aggregate_type text NOT NULL,
    aggregate_id uuid NOT NULL,
    event_type text NOT NULL,
    payload jsonb NOT NULL,
    sequence_number bigint NOT NULL,
    correlation_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: evidence_citations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.evidence_citations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    wine_id uuid NOT NULL,
    run_id uuid,
    field_name character varying(100) NOT NULL,
    proposed_value text NOT NULL,
    source_url text NOT NULL,
    source_tier character(1) NOT NULL,
    snippet text NOT NULL,
    retrieved_at timestamp with time zone DEFAULT now() NOT NULL,
    fetch_verified boolean DEFAULT false NOT NULL,
    corroboration_count integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT valid_source_tier CHECK ((source_tier = ANY (ARRAY['A'::bpchar, 'B'::bpchar, 'C'::bpchar])))
);


--
-- Name: evidence_url_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.evidence_url_cache (
    url text NOT NULL,
    page_text text NOT NULL,
    cached_at timestamp with time zone DEFAULT now(),
    fetch_method character varying(20) DEFAULT 'httpx'::character varying NOT NULL
);


--
-- Name: export_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.export_history (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    restaurant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    export_type character varying(100) NOT NULL,
    export_format character varying(50) NOT NULL,
    filters_applied jsonb,
    file_url text,
    file_size_bytes bigint,
    row_count integer,
    destination character varying(100),
    destination_details jsonb,
    is_watermarked boolean DEFAULT false,
    watermark_text character varying(255),
    status character varying(50) DEFAULT 'pending'::character varying,
    error_message text,
    created_at timestamp with time zone DEFAULT now(),
    completed_at timestamp with time zone
);


--
-- Name: field_calibration; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.field_calibration (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    field_name character varying(100) NOT NULL,
    confidence_bin character varying(10) NOT NULL,
    total_reviewed integer DEFAULT 0 NOT NULL,
    total_correct integer DEFAULT 0 NOT NULL,
    actual_accuracy numeric(5,4),
    measured_at timestamp with time zone DEFAULT now()
);


--
-- Name: field_corrections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.field_corrections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    submission_id uuid NOT NULL,
    field_name character varying(100) NOT NULL,
    original_value text,
    corrected_value text,
    corrected_at timestamp with time zone DEFAULT now() NOT NULL,
    corrected_by text
);


--
-- Name: field_review_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.field_review_queue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    submission_id uuid NOT NULL,
    field_name character varying(100) NOT NULL,
    current_value text,
    confidence numeric(3,2) NOT NULL,
    source character varying(20) DEFAULT 'visible'::character varying NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    reviewer character varying(255),
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT valid_source CHECK (((source)::text = ANY ((ARRAY['visible'::character varying, 'inferred'::character varying, 'knowledge'::character varying, 'ontology'::character varying, 'pricing_anomaly'::character varying])::text[]))),
    CONSTRAINT valid_status CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'approved'::character varying, 'corrected'::character varying, 'rejected'::character varying])::text[])))
);


--
-- Name: generated_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.generated_reports (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    restaurant_id uuid NOT NULL,
    profile_id uuid,
    report_type character varying(50) NOT NULL,
    report_period_start date NOT NULL,
    report_period_end date NOT NULL,
    title character varying(255) NOT NULL,
    summary text,
    modules_included text[],
    pdf_url text,
    excel_url text,
    csv_url text,
    report_data jsonb,
    ai_insights text,
    ai_model character varying(50),
    status character varying(50) DEFAULT 'completed'::character varying,
    generation_time_ms integer,
    delivered_at timestamp with time zone,
    delivery_status jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: glass_pour_tracking; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.glass_pour_tracking (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid,
    inventory_id uuid,
    bottle_opened_at timestamp with time zone DEFAULT now() NOT NULL,
    pours_served integer DEFAULT 0,
    volume_poured_ml double precision DEFAULT 0,
    waste_ml double precision DEFAULT 0,
    remaining_ml double precision,
    expected_finish_at timestamp with time zone,
    status character varying(20) DEFAULT 'OPEN'::character varying,
    opened_by uuid,
    finished_at timestamp with time zone,
    notes text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: grape_varieties; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grape_varieties (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    canonical_name text NOT NULL,
    color character varying(10) DEFAULT 'unknown'::character varying NOT NULL,
    family text,
    aliases text[] DEFAULT '{}'::text[] NOT NULL,
    typical_regions text[] DEFAULT '{}'::text[] NOT NULL,
    typical_blending_partners text[] DEFAULT '{}'::text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT valid_color CHECK (((color)::text = ANY ((ARRAY['red'::character varying, 'white'::character varying, 'rosé'::character varying, 'orange'::character varying, 'unknown'::character varying])::text[])))
);


--
-- Name: idempotency_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.idempotency_keys (
    message_id text NOT NULL,
    agent_name text NOT NULL,
    processed_at timestamp with time zone DEFAULT now() NOT NULL,
    result jsonb,
    expires_at timestamp with time zone DEFAULT (now() + '24:00:00'::interval) NOT NULL
);


--
-- Name: inventory_alert_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_alert_state (
    restaurant_id uuid NOT NULL,
    inventory_id uuid NOT NULL,
    wine_name text,
    last_alert_level character varying(20) DEFAULT 'ok'::character varying NOT NULL,
    last_alerted_at timestamp with time zone,
    last_digest_at timestamp with time zone,
    alert_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: inventory_lots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_lots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    inventory_id uuid,
    master_wine_id uuid NOT NULL,
    location_id uuid,
    stock_state character varying(10) DEFAULT 'live'::character varying NOT NULL,
    qty integer DEFAULT 0 NOT NULL,
    open_bottle_ml integer DEFAULT 0 NOT NULL,
    unit_cost numeric(10,2),
    cost_provenance character varying(12) DEFAULT 'estimated'::character varying NOT NULL,
    vintage integer,
    status character varying(12) DEFAULT 'active'::character varying NOT NULL,
    source_order_id uuid,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT inventory_lots_cost_provenance_check CHECK (((cost_provenance)::text = ANY (ARRAY['invoice'::text, 'estimated'::text, 'manual'::text, 'sample'::text]))),
    CONSTRAINT inventory_lots_open_bottle_ml_check CHECK ((open_bottle_ml >= 0)),
    CONSTRAINT inventory_lots_qty_check CHECK ((qty >= 0)),
    CONSTRAINT inventory_lots_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'reserved'::character varying, 'depleted'::character varying])::text[]))),
    CONSTRAINT inventory_lots_stock_state_check CHECK (((stock_state)::text = ANY ((ARRAY['live'::character varying, 'shadow'::character varying])::text[])))
);


--
-- Name: inventory_lot_rollup; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.inventory_lot_rollup AS
 SELECT inventory_id,
    restaurant_id,
    master_wine_id,
    COALESCE(sum(qty) FILTER (WHERE ((stock_state)::text = 'live'::text)), (0)::bigint) AS live_qty,
    COALESCE(sum(qty) FILTER (WHERE ((stock_state)::text = 'shadow'::text)), (0)::bigint) AS shadow_qty,
        CASE
            WHEN (COALESCE(sum(qty) FILTER (WHERE (((stock_state)::text = 'live'::text) AND (unit_cost IS NOT NULL) AND ((cost_provenance)::text <> 'sample'::text))), (0)::bigint) > 0) THEN round((sum(((qty)::numeric * unit_cost)) FILTER (WHERE (((stock_state)::text = 'live'::text) AND (unit_cost IS NOT NULL) AND ((cost_provenance)::text <> 'sample'::text))) / (sum(qty) FILTER (WHERE (((stock_state)::text = 'live'::text) AND (unit_cost IS NOT NULL) AND ((cost_provenance)::text <> 'sample'::text))))::numeric), 2)
            ELSE NULL::numeric
        END AS wac,
    bool_or(((cost_provenance)::text = 'invoice'::text)) FILTER (WHERE ((stock_state)::text = 'live'::text)) AS has_invoice_cost,
    count(*) FILTER (WHERE ((stock_state)::text = 'live'::text)) AS live_lot_count,
    count(DISTINCT location_id) FILTER (WHERE (((stock_state)::text = 'live'::text) AND (location_id IS NOT NULL))) AS live_location_count,
    COALESCE(sum(open_bottle_ml) FILTER (WHERE ((stock_state)::text = 'live'::text)), (0)::bigint) AS open_ml,
    COALESCE(sum(qty) FILTER (WHERE (((stock_state)::text = 'live'::text) AND ((cost_provenance)::text = 'sample'::text))), (0)::bigint) AS sample_qty
   FROM public.inventory_lots
  GROUP BY inventory_id, restaurant_id, master_wine_id;


--
-- Name: inventory_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_transactions (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    restaurant_id uuid NOT NULL,
    inventory_id uuid NOT NULL,
    wine_id uuid NOT NULL,
    transaction_type public.inventory_transaction_type NOT NULL,
    source public.inventory_transaction_source NOT NULL,
    quantity_change integer NOT NULL,
    quantity_before integer NOT NULL,
    quantity_after integer NOT NULL,
    stock_type character varying(20) DEFAULT 'live'::character varying NOT NULL,
    reference_type character varying(50),
    reference_id uuid,
    pos_transaction_id character varying(100),
    order_id uuid,
    from_location_id uuid,
    to_location_id uuid,
    unit_cost numeric(10,2),
    total_cost numeric(10,2),
    performed_by uuid,
    performed_by_type character varying(50) DEFAULT 'user'::character varying,
    reason text,
    notes text,
    metadata jsonb DEFAULT '{}'::jsonb,
    transaction_date timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    idempotency_key text,
    CONSTRAINT valid_quantity_after CHECK ((quantity_after = (quantity_before + quantity_change))),
    CONSTRAINT valid_quantity_change CHECK ((quantity_change <> 0))
);


--
-- Name: restaurant_inventory; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.restaurant_inventory (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    restaurant_id uuid NOT NULL,
    master_wine_id uuid NOT NULL,
    provider_id uuid,
    stock_live integer DEFAULT 0 NOT NULL,
    physical_stock integer,
    shadow_stock integer DEFAULT 0,
    expected_stock integer DEFAULT 0,
    in_transit_quantity integer DEFAULT 0,
    threshold_min integer DEFAULT 3 NOT NULL,
    validation_max integer,
    buffer_window_minutes integer,
    inventory_state character varying(50) DEFAULT 'LIVE'::character varying,
    last_alerted_at timestamp with time zone,
    last_alert_level integer,
    alert_count integer DEFAULT 0,
    last_manual_edit_at timestamp with time zone,
    last_manual_edit_by uuid,
    manual_edit_reason text,
    custom_price numeric(10,2),
    last_purchase_price numeric(10,2),
    negotiated_price numeric(10,2),
    margin_percentage numeric(5,2),
    sales_velocity_30d numeric(8,2),
    sales_velocity_7d numeric(8,2),
    last_sold_at timestamp with time zone,
    times_ordered_count integer DEFAULT 0,
    total_revenue numeric(12,2) DEFAULT 0,
    expected_delivery_date date,
    last_delivery_date date,
    is_active boolean DEFAULT true,
    menu_section character varying(100),
    menu_position integer,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    storage_location_id uuid,
    is_optional_tracking boolean DEFAULT false,
    target_price numeric(10,2),
    max_price numeric(10,2),
    current_volume_ml double precision DEFAULT 0,
    unit_type character varying(20) DEFAULT 'BOTTLE'::character varying,
    is_generic_bucket boolean DEFAULT false,
    velocity_weight double precision DEFAULT 1.0,
    sku character varying(100),
    toast_item_guid character varying(100),
    toast_menu_item_id character varying(100),
    square_item_id character varying(100),
    clover_item_id character varying(100),
    internal_sku character varying(100),
    pos_sku character varying(100),
    sku_aliases jsonb,
    threshold_max integer,
    sale_type character varying(10) DEFAULT 'bottle'::character varying,
    pour_size_ml double precision DEFAULT 150,
    menu_price_glass numeric(10,2),
    bottle_size_ml integer,
    glasses_per_bottle_override integer,
    wine_name character varying(500),
    menu_price_current numeric(10,2),
    markup_ratio numeric(10,4),
    markup_classification character varying(20),
    version integer DEFAULT 0 NOT NULL,
    CONSTRAINT restaurant_inventory_sale_type_check CHECK (((sale_type)::text = ANY ((ARRAY['bottle'::character varying, 'glass'::character varying, 'both'::character varying])::text[]))),
    CONSTRAINT restaurant_inventory_unit_type_check CHECK (((unit_type)::text = ANY ((ARRAY['BOTTLE'::character varying, 'CASE'::character varying, 'SHOT'::character varying, 'GLASS'::character varying])::text[])))
);


--
-- Name: inventory_analytics; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.inventory_analytics AS
 WITH sales AS (
         SELECT inventory_transactions.inventory_id,
            sum((- inventory_transactions.quantity_change)) FILTER (WHERE (inventory_transactions.transaction_date > (now() - '30 days'::interval))) AS sold_30d,
            sum((- inventory_transactions.quantity_change)) FILTER (WHERE (inventory_transactions.transaction_date > (now() - '90 days'::interval))) AS sold_90d,
            max(inventory_transactions.transaction_date) AS last_sold_at
           FROM public.inventory_transactions
          WHERE ((inventory_transactions.transaction_type = 'sale'::public.inventory_transaction_type) AND ((inventory_transactions.stock_type)::text = 'live'::text) AND (inventory_transactions.quantity_change < 0))
          GROUP BY inventory_transactions.inventory_id
        ), base AS (
         SELECT ri.id AS inventory_id,
            ri.restaurant_id,
            COALESCE(r.live_qty, (0)::bigint) AS on_hand,
            COALESCE(s.sold_30d, (0)::bigint) AS sold_30d,
            COALESCE(s.sold_90d, (0)::bigint) AS sold_90d,
            s.last_sold_at,
            ((COALESCE(s.sold_30d, (0)::bigint))::numeric / 30.0) AS velocity_per_day,
            COALESCE(ri.menu_price_current, (0)::numeric) AS menu_price
           FROM ((public.restaurant_inventory ri
             LEFT JOIN public.inventory_lot_rollup r ON ((r.inventory_id = ri.id)))
             LEFT JOIN sales s ON ((s.inventory_id = ri.id)))
          WHERE COALESCE(ri.is_active, true)
        ), ranked AS (
         SELECT base.inventory_id,
            base.restaurant_id,
            base.on_hand,
            base.sold_30d,
            base.sold_90d,
            base.last_sold_at,
            base.velocity_per_day,
            base.menu_price,
            sum(((base.sold_90d)::numeric * base.menu_price)) OVER (PARTITION BY base.restaurant_id) AS total_value,
            sum(((base.sold_90d)::numeric * base.menu_price)) OVER (PARTITION BY base.restaurant_id ORDER BY ((base.sold_90d)::numeric * base.menu_price) DESC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cum_value
           FROM base
        )
 SELECT inventory_id,
    restaurant_id,
    on_hand,
    sold_30d,
    sold_90d,
    last_sold_at,
    round(velocity_per_day, 3) AS velocity_per_day,
        CASE
            WHEN (velocity_per_day > (0)::numeric) THEN round(((on_hand)::numeric / velocity_per_day))
            ELSE NULL::numeric
        END AS days_of_cover,
        CASE
            WHEN (velocity_per_day > (0)::numeric) THEN GREATEST((1)::numeric, ceil((velocity_per_day * (10)::numeric)))
            ELSE NULL::numeric
        END AS reorder_point,
    ((velocity_per_day > (0)::numeric) AND ((on_hand)::numeric <= GREATEST((1)::numeric, ceil((velocity_per_day * (10)::numeric))))) AS reorder_suggested,
        CASE
            WHEN (total_value = (0)::numeric) THEN NULL::text
            WHEN (cum_value <= (0.80 * total_value)) THEN 'A'::text
            WHEN (cum_value <= (0.95 * total_value)) THEN 'B'::text
            ELSE 'C'::text
        END AS abc_class,
    (((last_sold_at IS NULL) OR (last_sold_at < (now() - '90 days'::interval))) AND (on_hand > 0)) AS dead_stock,
        CASE
            WHEN (last_sold_at IS NOT NULL) THEN (EXTRACT(day FROM (now() - last_sold_at)))::integer
            ELSE NULL::integer
        END AS days_since_sale
   FROM ranked;


--
-- Name: inventory_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_events (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    restaurant_id uuid NOT NULL,
    inventory_id uuid,
    master_wine_id uuid,
    event_type character varying(50) NOT NULL,
    quantity_change integer DEFAULT 0 NOT NULL,
    source character varying(50),
    idempotency_key text NOT NULL,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: inventory_location_breakdown; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.inventory_location_breakdown AS
 SELECT inventory_id,
    restaurant_id,
    master_wine_id,
    location_id,
    stock_state,
    sum(qty) AS qty,
        CASE
            WHEN (COALESCE(sum(qty) FILTER (WHERE (unit_cost IS NOT NULL)), (0)::bigint) > 0) THEN round((sum(((qty)::numeric * unit_cost)) FILTER (WHERE (unit_cost IS NOT NULL)) / (sum(qty) FILTER (WHERE (unit_cost IS NOT NULL)))::numeric), 2)
            ELSE NULL::numeric
        END AS wac
   FROM public.inventory_lots
  GROUP BY inventory_id, restaurant_id, master_wine_id, location_id, stock_state;


--
-- Name: inventory_transaction_summary; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.inventory_transaction_summary AS
 SELECT restaurant_id,
    wine_id,
    inventory_id,
    date_trunc('day'::text, transaction_date) AS day,
    transaction_type,
    source,
    sum(quantity_change) AS total_quantity_change,
    sum(
        CASE
            WHEN (quantity_change > 0) THEN quantity_change
            ELSE 0
        END) AS total_in,
    sum(
        CASE
            WHEN (quantity_change < 0) THEN abs(quantity_change)
            ELSE 0
        END) AS total_out,
    count(*) AS transaction_count,
    sum(total_cost) AS total_cost_impact
   FROM public.inventory_transactions
  WHERE (transaction_date > (now() - '90 days'::interval))
  GROUP BY restaurant_id, wine_id, inventory_id, (date_trunc('day'::text, transaction_date)), transaction_type, source
  WITH NO DATA;


--
-- Name: master_wine_library; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.master_wine_library (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    wine_id character varying(20) NOT NULL,
    sequential_id integer,
    name character varying(255) NOT NULL,
    producer character varying(255) NOT NULL,
    vintage integer,
    price_reference numeric(10,2),
    primary_type character varying(50) NOT NULL,
    grape_variety text,
    grape_family character varying(100),
    country character varying(100) NOT NULL,
    region character varying(100),
    appellation character varying(150),
    sub_region character varying(100),
    appellation_class character varying(150),
    wine_structure jsonb,
    sensory_profile jsonb,
    quality_classification jsonb,
    practical_attributes jsonb,
    market_value jsonb,
    advanced_categories jsonb,
    technical_specs jsonb,
    producer_story text,
    awards text[],
    historical_notes text,
    grape_blend_info jsonb,
    region_hierarchy jsonb,
    professional_ratings jsonb,
    winemaking_details jsonb,
    producer_details jsonb,
    vineyard_details jsonb,
    market_data jsonb,
    ai_agent_features jsonb,
    ml_derived_features jsonb,
    embedding public.vector(384),
    source character varying(100),
    data_enrichment jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    search_vector tsvector,
    barcode character varying(50),
    barcode_vintage_mapping jsonb,
    sku character varying(100),
    upc character varying(50),
    ean character varying(50),
    manufacturer_sku character varying(100),
    distributor_skus jsonb,
    signature_hash text,
    normalized_name text,
    normalized_producer text,
    signature_source text,
    bottle_size_ml integer DEFAULT 750 NOT NULL,
    weight_grams integer,
    closure_type character varying(50),
    library_tier integer DEFAULT 4,
    canonical_name_verified boolean DEFAULT false,
    review_status text DEFAULT 'pending'::text,
    field_confidences jsonb DEFAULT '{}'::jsonb,
    library_tier_updated_at timestamp with time zone,
    appellation_tier text,
    acidity text,
    tannins text,
    texture text,
    finish text,
    primary_aromas jsonb,
    secondary_aromas jsonb,
    tertiary_aromas jsonb,
    quality_level text,
    classification_name text,
    classification_system text,
    reserve_status text,
    vintage_quality text,
    farming text,
    aging_vessel text,
    aging_duration text,
    serving_temp_celsius integer,
    glass_type text,
    decanting_recommended boolean,
    aging_potential_years integer,
    rating_ws text,
    rating_rp text,
    rating_jr text,
    producer_bio text,
    critic_scores jsonb DEFAULT '{}'::jsonb,
    quality_signals jsonb DEFAULT '{}'::jsonb,
    retail_price_avg numeric(10,2),
    scores_last_updated_at timestamp with time zone,
    CONSTRAINT master_wine_library_library_tier_check CHECK (((library_tier >= 0) AND (library_tier <= 4))),
    CONSTRAINT master_wine_library_review_status_check CHECK ((review_status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'needs_review'::text])))
);


--
-- Name: restaurants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.restaurants (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    name character varying(255) NOT NULL,
    slug character varying(100) DEFAULT ''::character varying NOT NULL,
    parent_restaurant_id uuid,
    group_name character varying(100),
    email character varying(255),
    phone character varying(50),
    address jsonb,
    timezone character varying(50) DEFAULT 'America/Los_Angeles'::character varying,
    currency character varying(3) DEFAULT 'USD'::character varying,
    pos_system character varying(50) DEFAULT 'toast'::character varying,
    pos_credentials jsonb,
    buffer_window_minutes integer DEFAULT 30,
    default_threshold_min integer DEFAULT 3,
    is_active boolean DEFAULT true,
    subscription_tier character varying(50) DEFAULT 'pilot'::character varying,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    default_pour_ml double precision DEFAULT 150,
    measurement_unit character varying(5) DEFAULT 'ml'::character varying,
    city character varying(100),
    organization_id uuid,
    chain_id uuid,
    country character varying(100),
    cuisine_type character varying(100),
    state_province character varying(100),
    postal_code character varying(20),
    neighborhood character varying(100),
    calendar_ical_token character varying(64) DEFAULT NULL::character varying,
    threshold_configured boolean DEFAULT false NOT NULL,
    CONSTRAINT restaurants_measurement_unit_check CHECK (((measurement_unit)::text = ANY ((ARRAY['ml'::character varying, 'oz'::character varying])::text[])))
);


--
-- Name: inventory_volume_details; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.inventory_volume_details AS
 SELECT ri.id AS inventory_id,
    ri.restaurant_id,
    ri.master_wine_id,
    ri.wine_name,
    COALESCE(ri.bottle_size_ml, mwl.bottle_size_ml, 750) AS effective_bottle_size_ml,
    round(((COALESCE(ri.bottle_size_ml, mwl.bottle_size_ml, 750))::numeric * 0.033814), 1) AS effective_bottle_size_oz,
    ri.sale_type,
    ri.pour_size_ml,
    round(((COALESCE(ri.pour_size_ml, (150)::double precision) * (0.033814)::double precision))::numeric, 1) AS pour_size_oz,
    ri.menu_price_glass,
    COALESCE(ri.glasses_per_bottle_override, (floor(((COALESCE(ri.bottle_size_ml, mwl.bottle_size_ml, 750))::double precision / NULLIF(ri.pour_size_ml, (0)::double precision))))::integer) AS glasses_per_bottle,
    ri.stock_live,
    (ri.stock_live * COALESCE(ri.bottle_size_ml, mwl.bottle_size_ml, 750)) AS total_volume_ml,
    round((((ri.stock_live * COALESCE(ri.bottle_size_ml, mwl.bottle_size_ml, 750)))::numeric * 0.033814), 1) AS total_volume_oz,
    r.measurement_unit
   FROM ((public.restaurant_inventory ri
     LEFT JOIN public.master_wine_library mwl ON ((mwl.id = ri.master_wine_id)))
     LEFT JOIN public.restaurants r ON ((r.id = ri.restaurant_id)));


--
-- Name: invite_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invite_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    token uuid DEFAULT gen_random_uuid() NOT NULL,
    role text NOT NULL,
    created_by uuid NOT NULL,
    target_email text,
    expires_at timestamp with time zone DEFAULT (now() + '7 days'::interval) NOT NULL,
    used_at timestamp with time zone,
    used_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT invite_tokens_role_check CHECK ((role = ANY (ARRAY['developer'::text, 'certified_contributor'::text, 'review_admin'::text])))
);


--
-- Name: invoice_scans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoice_scans (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    restaurant_id uuid,
    provider_id character varying(50),
    provider_name character varying(255),
    scan_type character varying(10) NOT NULL,
    file_url text NOT NULL,
    ocr_status character varying(20) DEFAULT 'pending'::character varying,
    extracted_data jsonb,
    processed_at timestamp without time zone,
    auto_added_to_inventory boolean DEFAULT false,
    error_message text,
    created_at timestamp without time zone DEFAULT now(),
    CONSTRAINT invoice_scans_ocr_status_check CHECK (((ocr_status)::text = ANY ((ARRAY['pending'::character varying, 'processing'::character varying, 'completed'::character varying, 'failed'::character varying])::text[]))),
    CONSTRAINT invoice_scans_scan_type_check CHECK (((scan_type)::text = ANY ((ARRAY['pdf'::character varying, 'image'::character varying])::text[])))
);


--
-- Name: keyboard_shortcuts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.keyboard_shortcuts (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    action character varying(100) NOT NULL,
    key_combination character varying(50) NOT NULL,
    is_custom boolean DEFAULT false,
    default_combination character varying(50),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: manager_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.manager_preferences (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    manager_id uuid NOT NULL,
    report_frequency character varying(20),
    report_delivery_time time without time zone DEFAULT '07:00:00'::time without time zone,
    report_timezone character varying(50) DEFAULT 'America/Los_Angeles'::character varying,
    notification_channels jsonb DEFAULT '{"sms": true, "push": true, "email": true, "voice": false}'::jsonb,
    low_stock_alert_enabled boolean DEFAULT true,
    low_stock_alert_channels jsonb DEFAULT '{"sms": true, "push": true}'::jsonb,
    quiet_hours_start time without time zone,
    quiet_hours_end time without time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT manager_preferences_report_frequency_check CHECK (((report_frequency)::text = ANY ((ARRAY['DAILY'::character varying, 'WEEKLY'::character varying, 'MONTHLY'::character varying, 'NONE'::character varying])::text[])))
);


--
-- Name: manager_report_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.manager_report_profiles (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    restaurant_id uuid NOT NULL,
    manager_id uuid NOT NULL,
    daily_enabled boolean DEFAULT true,
    weekly_enabled boolean DEFAULT true,
    monthly_enabled boolean DEFAULT true,
    time_windows_enabled boolean DEFAULT false,
    time_windows jsonb,
    daily_contents text[],
    weekly_contents text[],
    monthly_contents text[],
    wine_ai_agent_enabled boolean DEFAULT false,
    sommelier_ai_enabled boolean DEFAULT false,
    predictive_analytics_enabled boolean DEFAULT false,
    delivery_channels text[] DEFAULT ARRAY['email'::text, 'dashboard'::text],
    custom_reports_enabled boolean DEFAULT false,
    allowed_formats text[] DEFAULT ARRAY['pdf'::text, 'excel'::text],
    trigger_mode character varying(50) DEFAULT 'scheduled'::character varying,
    email_address character varying(255),
    email_cc text[],
    timezone character varying(50) DEFAULT 'America/Los_Angeles'::character varying,
    preferred_language character varying(10) DEFAULT 'en'::character varying,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: master_wine_library_submissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.master_wine_library_submissions (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    restaurant_id uuid,
    submitted_by text DEFAULT 'unknown'::text,
    payload jsonb NOT NULL,
    normalized_fields jsonb,
    signature_hash text,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    decision_reason text,
    matched_master_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    reviewed_at timestamp with time zone,
    auto_blocked boolean DEFAULT false NOT NULL,
    field_confidence jsonb DEFAULT '{}'::jsonb,
    web_verified_at timestamp with time zone,
    ontology_validation jsonb,
    ontology_validated_at timestamp with time zone,
    conflict_candidates jsonb DEFAULT '{}'::jsonb,
    last_research_run_at timestamp with time zone
);


--
-- Name: menu_changes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.menu_changes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    wine_signature_hash text NOT NULL,
    change_type text NOT NULL,
    old_value jsonb,
    new_value jsonb,
    detected_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT menu_changes_change_type_check CHECK ((change_type = ANY (ARRAY['added'::text, 'removed'::text, 'price_change'::text])))
);


--
-- Name: menu_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.menu_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    menu_id uuid NOT NULL,
    restaurant_id uuid NOT NULL,
    name text NOT NULL,
    producer text,
    category text,
    by_glass_price numeric(10,2),
    bottle_price numeric(10,2),
    vintage text,
    region text,
    country text,
    grape_variety text,
    wine_library_id uuid,
    inventory_item_id uuid,
    source text DEFAULT 'manual'::text NOT NULL,
    status text DEFAULT 'approved'::text NOT NULL,
    raw_extracted_text text,
    review_notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    submission_id uuid,
    CONSTRAINT menu_items_source_check CHECK ((source = ANY (ARRAY['scan'::text, 'csv'::text, 'manual'::text]))),
    CONSTRAINT menu_items_status_check CHECK ((status = ANY (ARRAY['approved'::text, 'flagged'::text, 'in_review'::text])))
);


--
-- Name: message_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.message_templates (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    restaurant_id uuid,
    name character varying(255) NOT NULL,
    category character varying(50) NOT NULL,
    description text,
    template_text text NOT NULL,
    variables text[],
    version integer DEFAULT 1,
    parent_template_id uuid,
    change_notes text,
    is_active boolean DEFAULT true,
    is_default boolean DEFAULT false,
    times_used integer DEFAULT 0,
    last_used_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: mobile_devices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mobile_devices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    restaurant_id uuid,
    expo_push_token text NOT NULL,
    platform text DEFAULT 'unknown'::text NOT NULL,
    app_version text,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: negotiation_facts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.negotiation_facts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    provider_id uuid NOT NULL,
    restaurant_id uuid NOT NULL,
    fact_type character varying(50) NOT NULL,
    fact_key character varying(100) NOT NULL,
    value_numeric numeric(14,4),
    value_text character varying(500),
    unit character varying(50),
    message_index integer NOT NULL,
    message_timestamp timestamp with time zone NOT NULL,
    exact_quote text NOT NULL,
    stated_by character varying(20) NOT NULL,
    commitment_type character varying(20) DEFAULT 'INDICATIVE'::character varying NOT NULL,
    supersedes_id uuid,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT negotiation_facts_commitment_type_check CHECK (((commitment_type)::text = ANY ((ARRAY['INDICATIVE'::character varying, 'OFFER'::character varying, 'COUNTER'::character varying, 'AGREEMENT'::character varying])::text[]))),
    CONSTRAINT negotiation_facts_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'superseded'::character varying, 'disputed'::character varying])::text[])))
);


--
-- Name: notification_deliveries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_deliveries (
    notification_id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid,
    event_id text NOT NULL,
    channel text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    delivered_at timestamp with time zone,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT notification_deliveries_channel_check CHECK ((channel = ANY (ARRAY['sms'::text, 'email'::text, 'slack'::text]))),
    CONSTRAINT notification_deliveries_status_check CHECK ((status = ANY (ARRAY['sent'::text, 'failed'::text, 'pending'::text])))
);


--
-- Name: notification_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_preferences (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    restaurant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    low_stock_enabled boolean DEFAULT true,
    low_stock_channels text[] DEFAULT ARRAY['sms'::text, 'push'::text],
    low_stock_threshold_override integer,
    order_approval_enabled boolean DEFAULT true,
    order_approval_channels text[] DEFAULT ARRAY['sms'::text, 'push'::text, 'email'::text],
    delivery_enabled boolean DEFAULT true,
    delivery_channels text[] DEFAULT ARRAY['push'::text, 'email'::text],
    financial_reports_enabled boolean DEFAULT true,
    financial_reports_channels text[] DEFAULT ARRAY['email'::text, 'dashboard'::text],
    inequality_alerts_enabled boolean DEFAULT true,
    inequality_alerts_channels text[] DEFAULT ARRAY['sms'::text, 'push'::text],
    calendar_reminders_enabled boolean DEFAULT true,
    calendar_reminders_channels text[] DEFAULT ARRAY['push'::text, 'email'::text],
    quiet_hours_enabled boolean DEFAULT false,
    quiet_hours_start character varying(5),
    quiet_hours_end character varying(5),
    quiet_hours_emergency_override boolean DEFAULT true,
    alert_grouping_enabled boolean DEFAULT true,
    alert_grouping_window_minutes integer DEFAULT 15,
    daily_digest_enabled boolean DEFAULT true,
    daily_digest_time character varying(5) DEFAULT '08:00'::character varying,
    weekly_digest_enabled boolean DEFAULT true,
    weekly_digest_day integer DEFAULT 1,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    email_enabled boolean DEFAULT true,
    push_enabled boolean DEFAULT true,
    sms_enabled boolean DEFAULT false,
    categories jsonb DEFAULT '{"ai": true, "orders": true, "system": true, "calendar": true, "inventory": true}'::jsonb,
    push_subscription jsonb,
    digest_enabled boolean DEFAULT true,
    digest_promos_enabled boolean DEFAULT true,
    digest_stalled_threads_enabled boolean DEFAULT true,
    digest_procurement_gaps_enabled boolean DEFAULT true,
    digest_send_hour integer DEFAULT 8,
    instant_first_alert boolean DEFAULT true,
    digest_frequency character varying(20) DEFAULT 'daily'::character varying,
    digest_time character varying(10) DEFAULT '12:00'::character varying,
    critical_immediate boolean DEFAULT true,
    orders_mode character varying(20) DEFAULT 'both'::character varying,
    reports_mode character varying(20) DEFAULT 'both'::character varying,
    CONSTRAINT notification_preferences_digest_send_hour_check CHECK (((digest_send_hour >= 0) AND (digest_send_hour <= 23)))
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    restaurant_id uuid NOT NULL,
    recipient_id uuid NOT NULL,
    notification_type character varying(100) NOT NULL,
    title character varying(255) NOT NULL,
    message text NOT NULL,
    priority character varying(50) DEFAULT 'normal'::character varying,
    channels text[] NOT NULL,
    sent_at timestamp with time zone,
    delivered_at timestamp with time zone,
    read_at timestamp with time zone,
    delivery_status jsonb,
    actions jsonb,
    responded_at timestamp with time zone,
    response_action character varying(100),
    response_data jsonb,
    related_entity_type character varying(50),
    related_entity_id uuid,
    notification_group character varying(100),
    batch_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    user_id uuid,
    type character varying(100) DEFAULT 'system'::character varying NOT NULL,
    status character varying(20) DEFAULT 'unread'::character varying,
    action_url text,
    action_label character varying(255),
    metadata jsonb DEFAULT '{}'::jsonb,
    archived_at timestamp with time zone,
    group_key character varying(255)
);


--
-- Name: onboarding_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.onboarding_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    actor_id uuid NOT NULL,
    source_type text NOT NULL,
    source_ref text,
    status text DEFAULT 'active'::text NOT NULL,
    scan_session_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    CONSTRAINT onboarding_sessions_source_type_check CHECK ((source_type = ANY (ARRAY['pdf_upload'::text, 'url_crawl'::text, 'manual_seed'::text]))),
    CONSTRAINT onboarding_sessions_status_check CHECK ((status = ANY (ARRAY['active'::text, 'completed'::text, 'abandoned'::text])))
);


--
-- Name: one_tap_actions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.one_tap_actions (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    restaurant_id uuid NOT NULL,
    user_id uuid,
    action_type public.one_tap_action_type DEFAULT 'custom'::public.one_tap_action_type NOT NULL,
    title character varying(255) NOT NULL,
    description text,
    action_url character varying(500),
    priority public.one_tap_priority DEFAULT 'medium'::public.one_tap_priority NOT NULL,
    color character varying(50) DEFAULT 'wine'::character varying,
    icon character varying(50) DEFAULT 'Zap'::character varying,
    status public.one_tap_action_status DEFAULT 'pending'::public.one_tap_action_status NOT NULL,
    related_wine_id uuid,
    related_order_id uuid,
    related_provider_id uuid,
    metadata jsonb DEFAULT '{}'::jsonb,
    executed_at timestamp with time zone,
    executed_by uuid,
    execution_result jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    expires_at timestamp with time zone,
    deleted_at timestamp with time zone
);


--
-- Name: order_interactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_interactions (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    order_id uuid NOT NULL,
    interaction_type character varying(20) NOT NULL,
    interaction_direction character varying(20) NOT NULL,
    recording_url text,
    transcript text,
    call_duration_seconds integer,
    call_uuid character varying(100),
    ai_summary text,
    detected_intent character varying(100),
    detected_sentiment character varying(50),
    important_dates_detected jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    barcode_scanned character varying(50),
    vintage_confirmed integer,
    vintage_mismatch_detected boolean DEFAULT false,
    vintage_mismatch_details jsonb,
    CONSTRAINT order_interactions_interaction_direction_check CHECK (((interaction_direction)::text = ANY ((ARRAY['OUTBOUND'::character varying, 'INBOUND'::character varying])::text[]))),
    CONSTRAINT order_interactions_interaction_type_check CHECK (((interaction_type)::text = ANY ((ARRAY['VOICE'::character varying, 'SMS'::character varying, 'EMAIL'::character varying, 'WHATSAPP'::character varying])::text[])))
);


--
-- Name: order_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_items (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    order_id character varying(100) NOT NULL,
    wine_id character varying(50) NOT NULL,
    wine_name character varying(255) NOT NULL,
    quantity integer NOT NULL,
    unit_type character varying(10) NOT NULL,
    bottles_per_case integer DEFAULT 12,
    unit_price numeric(10,2) NOT NULL,
    total_price numeric(10,2) NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    CONSTRAINT order_items_quantity_check CHECK ((quantity > 0)),
    CONSTRAINT order_items_unit_type_check CHECK (((unit_type)::text = ANY ((ARRAY['case'::character varying, 'bottle'::character varying])::text[])))
);


--
-- Name: organization_invites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization_invites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    restaurant_id uuid NOT NULL,
    code character(8) NOT NULL,
    invited_by uuid NOT NULL,
    role character varying(50) DEFAULT 'manager'::character varying NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '7 days'::interval) NOT NULL,
    used_at timestamp with time zone,
    used_by_email character varying(255),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT organization_invites_role_check CHECK (((role)::text = ANY ((ARRAY['owner'::character varying, 'manager'::character varying, 'staff'::character varying])::text[])))
);


--
-- Name: organization_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role character varying(50) DEFAULT 'manager'::character varying NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    invited_via uuid,
    CONSTRAINT organization_members_role_check CHECK (((role)::text = ANY ((ARRAY['owner'::character varying, 'manager'::character varying, 'staff'::character varying])::text[])))
);


--
-- Name: organizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organizations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    owner_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: outbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.outbox (
    id bigint NOT NULL,
    event_type text NOT NULL,
    exchange text NOT NULL,
    routing_key text NOT NULL,
    payload jsonb NOT NULL,
    published boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    published_at timestamp with time zone
);


--
-- Name: outbox_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.outbox_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: outbox_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.outbox_id_seq OWNED BY public.outbox.id;


--
-- Name: override_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.override_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid,
    submission_id uuid NOT NULL,
    actor_id uuid NOT NULL,
    field_name character varying(100) NOT NULL,
    old_value text,
    new_value text NOT NULL,
    old_confidence numeric(3,2),
    reason text,
    citation_url text,
    citation_snippet text,
    promotion_status text DEFAULT 'pending'::text NOT NULL,
    approved_by uuid,
    approval_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    decided_at timestamp with time zone,
    CONSTRAINT override_events_promotion_status_check CHECK ((promotion_status = ANY (ARRAY['pending'::text, 'auto_promoted'::text, 'approved'::text, 'rejected'::text])))
);


--
-- Name: pos_checks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pos_checks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    source text NOT NULL,
    external_check_id text NOT NULL,
    table_id uuid,
    server_external_id text,
    server_name text,
    opened_at timestamp with time zone NOT NULL,
    closed_at timestamp with time zone,
    covers integer,
    subtotal numeric(12,2),
    total numeric(12,2),
    tip numeric(12,2),
    items jsonb DEFAULT '[]'::jsonb NOT NULL,
    raw jsonb,
    imported_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: pos_item_mappings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pos_item_mappings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    source text DEFAULT '*'::text NOT NULL,
    external_item_id text DEFAULT ''::text NOT NULL,
    item_name text DEFAULT ''::text NOT NULL,
    category text,
    is_wine boolean DEFAULT false NOT NULL,
    master_wine_id uuid,
    inventory_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: pour_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pour_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    inventory_id uuid NOT NULL,
    master_wine_id uuid,
    pours integer NOT NULL,
    pour_ml integer NOT NULL,
    bottles_opened integer DEFAULT 0 NOT NULL,
    location_id uuid,
    source character varying(20) DEFAULT 'pos'::character varying NOT NULL,
    performed_by uuid,
    idempotency_key text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: prediction_outcomes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prediction_outcomes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid,
    agent_name character varying(100) NOT NULL,
    prediction_type character varying(100) NOT NULL,
    predicted_value jsonb NOT NULL,
    actual_value jsonb,
    accuracy_score double precision,
    prediction_made_at timestamp with time zone NOT NULL,
    outcome_recorded_at timestamp with time zone,
    context jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: price_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.price_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid,
    master_wine_id uuid,
    provider_id uuid,
    price numeric(10,2) NOT NULL,
    quantity integer DEFAULT 1,
    unit character varying(20) DEFAULT 'BOTTLE'::character varying,
    effective_date date NOT NULL,
    source character varying(50) NOT NULL,
    order_id uuid,
    notes text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: procurement_conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.procurement_conversations (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    order_id uuid,
    restaurant_id uuid NOT NULL,
    provider_id uuid NOT NULL,
    direction character varying(20) NOT NULL,
    channel character varying(50) NOT NULL,
    message_text text NOT NULL,
    ai_generated boolean DEFAULT false,
    llm_model character varying(50),
    detected_intent character varying(100),
    detected_sentiment character varying(50),
    important_dates_detected jsonb,
    sent_at timestamp with time zone,
    received_at timestamp with time zone,
    delivery_status character varying(50),
    created_at timestamp with time zone DEFAULT now(),
    thread_id uuid,
    message_id character varying(500),
    parent_message_id uuid,
    email_headers jsonb DEFAULT '{}'::jsonb,
    confidence_score numeric(4,3),
    conversation_summary text,
    summary_updated_at timestamp with time zone,
    content text,
    gmail_thread_id text,
    gmail_message_id text,
    conversation_context jsonb DEFAULT '{"disclosure_default": "send_as_is", "manager_instructions": [], "relationship_posture": "standard", "is_close_relationship": false}'::jsonb,
    outbound_email_type character varying(50),
    round_count integer DEFAULT 0,
    constraint_flags jsonb DEFAULT '{}'::jsonb,
    disclaimer_appended boolean DEFAULT false,
    rolling_summary text,
    status character varying(20) DEFAULT 'DRAFT'::character varying,
    scheduled_send_at timestamp with time zone,
    thread_key text,
    order_number_snapshot text,
    CONSTRAINT chk_outbound_email_type CHECK (((outbound_email_type IS NULL) OR ((outbound_email_type)::text = ANY (ARRAY['PRICE_INQUIRY'::text, 'DEMAND_OFFER'::text, 'PROMO_INQUIRY'::text, 'WINE_INQUIRY'::text, 'MANUAL_REPLY'::text, 'ORDER_CONFIRMATION'::text, 'ACCEPTANCE_CONFIRM_REQUEST'::text, 'CLARIFICATION'::text, 'COUNTER_OFFER'::text, 'ESCALATION'::text]))))
);


--
-- Name: procurement_credits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.procurement_credits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    provider_id uuid,
    order_id uuid,
    document_id uuid,
    document_line_id uuid,
    reason character varying(30) NOT NULL,
    summary text,
    currency character varying(3) DEFAULT 'USD'::character varying NOT NULL,
    claimed_amount numeric(12,2) NOT NULL,
    claimed_qty numeric(12,3),
    credited_amount numeric(12,2),
    credit_document_id uuid,
    state character varying(20) DEFAULT 'open'::character varying NOT NULL,
    self_evidenced boolean DEFAULT false NOT NULL,
    evidence jsonb,
    opened_at timestamp with time zone DEFAULT now() NOT NULL,
    requested_at timestamp with time zone,
    promised_at timestamp with time zone,
    settled_at timestamp with time zone,
    opened_by uuid,
    requested_by uuid,
    settled_by uuid,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT procurement_credits_claimed_positive CHECK ((claimed_amount >= (0)::numeric)),
    CONSTRAINT procurement_credits_credited_needs_proof CHECK ((((state)::text <> 'credited'::text) OR ((credited_amount IS NOT NULL) AND (credit_document_id IS NOT NULL)))),
    CONSTRAINT procurement_credits_reason_check CHECK (((reason)::text = ANY ((ARRAY['overbilled_vs_ship'::character varying, 'qty_short'::character varying, 'short_shipped'::character varying, 'damaged'::character varying, 'price_variance'::character varying, 'never_ordered'::character varying, 'other'::character varying])::text[]))),
    CONSTRAINT procurement_credits_state_check CHECK (((state)::text = ANY ((ARRAY['open'::character varying, 'requested'::character varying, 'promised'::character varying, 'credited'::character varying, 'rejected'::character varying, 'written_off'::character varying])::text[])))
);


--
-- Name: procurement_document_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.procurement_document_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    document_id uuid NOT NULL,
    restaurant_id uuid NOT NULL,
    line_no integer NOT NULL,
    vendor_sku character varying(120),
    description character varying(500),
    vintage integer,
    format_ml integer,
    qty numeric(12,3) DEFAULT 0 NOT NULL,
    uom character varying(20) DEFAULT 'bottle'::character varying NOT NULL,
    pack_size integer DEFAULT 1 NOT NULL,
    qty_bottles numeric(12,3) DEFAULT 0 NOT NULL,
    free_goods_qty numeric(12,3) DEFAULT 0 NOT NULL,
    unit_price numeric(12,4),
    line_total numeric(12,2),
    allowance numeric(12,2),
    deposit numeric(12,2),
    order_line_id uuid,
    match_confidence numeric(4,3),
    match_method character varying(30),
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT procurement_document_lines_match_method_check CHECK (((match_method IS NULL) OR ((match_method)::text = ANY ((ARRAY['vendor_sku'::character varying, 'description'::character varying, 'qty_price'::character varying, 'manual'::character varying, 'edi_reference'::character varying])::text[])))),
    CONSTRAINT procurement_document_lines_pack_size_check CHECK ((pack_size >= 1)),
    CONSTRAINT procurement_document_lines_uom_check CHECK (((uom)::text = ANY ((ARRAY['bottle'::character varying, 'case'::character varying, 'keg'::character varying, 'pack'::character varying, 'split_case'::character varying, 'each'::character varying, 'liter'::character varying])::text[])))
);


--
-- Name: procurement_document_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.procurement_document_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    document_id uuid NOT NULL,
    order_id uuid NOT NULL,
    restaurant_id uuid NOT NULL,
    linked_by uuid,
    link_method character varying(30) DEFAULT 'manual'::character varying NOT NULL,
    confidence numeric(4,3),
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT procurement_document_links_method_check CHECK (((link_method)::text = ANY ((ARRAY['manual'::character varying, 'doc_reference'::character varying, 'po_number'::character varying, 'provider_date'::character varying, 'line_overlap'::character varying, 'edi_reference'::character varying])::text[])))
);


--
-- Name: procurement_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.procurement_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    provider_id uuid,
    doc_type character varying(30) NOT NULL,
    source_channel character varying(20) NOT NULL,
    doc_number character varying(120),
    doc_date date,
    references_doc_number character varying(120),
    storage_path text,
    content_type character varying(100),
    file_bytes integer,
    raw_payload text,
    extracted jsonb,
    extraction_model character varying(100),
    extraction_confidence numeric(4,3),
    currency character varying(3) DEFAULT 'USD'::character varying,
    subtotal numeric(12,2),
    freight numeric(12,2),
    fuel_surcharge numeric(12,2),
    split_case_fee numeric(12,2),
    delivery_fee numeric(12,2),
    deposit_total numeric(12,2),
    tax numeric(12,2),
    other_charges numeric(12,2),
    discount_total numeric(12,2),
    total numeric(12,2),
    computed_lines_total numeric(12,2),
    tie_out_delta numeric(12,2),
    ties_out boolean,
    status character varying(20) DEFAULT 'received'::character varying NOT NULL,
    verified_by uuid,
    verified_at timestamp with time zone,
    source_ref character varying(500),
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    sha256 text,
    CONSTRAINT procurement_documents_doc_type_check CHECK (((doc_type)::text = ANY ((ARRAY['purchase_order'::character varying, 'packing_slip'::character varying, 'delivery_receipt'::character varying, 'invoice'::character varying, 'credit_memo'::character varying, 'statement'::character varying, 'unknown'::character varying])::text[]))),
    CONSTRAINT procurement_documents_source_channel_check CHECK (((source_channel)::text = ANY ((ARRAY['email'::character varying, 'photo'::character varying, 'upload'::character varying, 'edi'::character varying, 'sftp'::character varying, 'manual'::character varying, 'api'::character varying])::text[]))),
    CONSTRAINT procurement_documents_status_check CHECK (((status)::text = ANY ((ARRAY['received'::character varying, 'extracting'::character varying, 'needs_review'::character varying, 'verified'::character varying, 'rejected'::character varying, 'superseded'::character varying])::text[])))
);


--
-- Name: procurement_order_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.procurement_order_items (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    order_id uuid NOT NULL,
    inventory_id uuid,
    master_wine_id uuid,
    sku character varying(100),
    vendor_sku character varying(100),
    upc character varying(50),
    wine_name character varying(255) NOT NULL,
    producer character varying(255),
    vintage integer,
    quantity integer NOT NULL,
    unit_type character varying(20) DEFAULT 'bottles'::character varying,
    bottles_per_unit integer DEFAULT 1,
    total_bottles integer GENERATED ALWAYS AS ((quantity * bottles_per_unit)) STORED,
    quoted_unit_price numeric(10,2),
    negotiated_unit_price numeric(10,2),
    final_unit_price numeric(10,2),
    line_total numeric(10,2),
    quantity_received integer,
    quantity_accepted integer,
    quantity_rejected integer,
    rejection_reason text,
    received_sku character varying(100),
    sku_match boolean,
    vintage_match boolean,
    received_vintage integer,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    restaurant_id uuid,
    line_no integer,
    free_goods_qty numeric(12,3) DEFAULT 0 NOT NULL
);


--
-- Name: procurement_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.procurement_orders (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    order_number character varying(50) NOT NULL,
    restaurant_id uuid NOT NULL,
    inventory_id uuid NOT NULL,
    provider_id uuid NOT NULL,
    quantity integer NOT NULL,
    unit_type character varying(20) DEFAULT 'bottles'::character varying,
    bottles_total integer NOT NULL,
    quoted_price numeric(10,2),
    negotiated_price numeric(10,2),
    final_price numeric(10,2) NOT NULL,
    total_cost numeric(10,2) NOT NULL,
    status character varying(50) DEFAULT 'PENDING'::character varying NOT NULL,
    requested_at timestamp with time zone DEFAULT now(),
    approved_at timestamp with time zone,
    approved_by uuid,
    confirmed_at timestamp with time zone,
    shipped_at timestamp with time zone,
    expected_delivery_date date,
    delivered_at timestamp with time zone,
    completed_at timestamp with time zone,
    tracking_number character varying(100),
    delivery_notes text,
    received_by uuid,
    quantity_received integer,
    price_verified boolean DEFAULT false,
    invoice_image_url text,
    discrepancy_notes text,
    manager_notes text,
    rejection_reason text,
    is_emergency boolean DEFAULT false,
    priority_level integer DEFAULT 5,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    state_machine_state character varying(50) DEFAULT 'DRAFT_LOW_STOCK'::character varying,
    is_recurring boolean DEFAULT false,
    cron_schedule character varying(100),
    total_estimated_cost numeric(10,2),
    final_confirmed_cost numeric(10,2),
    negotiation_attempts integer DEFAULT 0,
    last_negotiation_at timestamp with time zone,
    is_offline_sync boolean DEFAULT false,
    ai_autonomy_paused boolean DEFAULT false NOT NULL,
    invoice_quantity integer,
    invoice_unit_price numeric(10,2),
    accepted_quantity integer,
    rejected_quantity integer DEFAULT 0,
    rejected_reason text,
    backorder_quantity integer DEFAULT 0,
    match_status character varying(30),
    price_override_reason text,
    match_verified_at timestamp with time zone,
    match_verified_by uuid
);


--
-- Name: procurement_receipt_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.procurement_receipt_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    order_id uuid,
    document_id uuid,
    stage character varying(20) NOT NULL,
    counted_qty numeric(12,3),
    counted_uom character varying(20) DEFAULT 'case'::character varying,
    counted_qty_bottles numeric(12,3),
    rejected_qty numeric(12,3) DEFAULT 0,
    damage_photo_path text,
    received_by uuid,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    client_captured_at timestamp with time zone,
    idempotency_key character varying(200),
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT procurement_receipt_events_stage_check CHECK (((stage)::text = ANY ((ARRAY['signed_at_door'::character varying, 'case_count'::character varying, 'bottle_count'::character varying, 'reconciled'::character varying])::text[]))),
    CONSTRAINT procurement_receipt_events_uom_check CHECK (((counted_uom)::text = ANY ((ARRAY['bottle'::character varying, 'case'::character varying, 'keg'::character varying, 'pack'::character varying, 'split_case'::character varying, 'each'::character varying, 'liter'::character varying])::text[])))
);


--
-- Name: producers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.producers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    normalized_name text NOT NULL,
    country text,
    region text,
    sub_region text,
    appellation text,
    founding_year integer,
    winemaker_name text,
    production_volume_cases integer,
    certifications jsonb DEFAULT '{}'::jsonb NOT NULL,
    website_url text,
    portfolio jsonb DEFAULT '[]'::jsonb NOT NULL,
    verified_at timestamp with time zone,
    verification_sources text[] DEFAULT '{}'::text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: profit_margins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profit_margins (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    restaurant_id uuid,
    date date NOT NULL,
    total_revenue numeric(10,2) NOT NULL,
    total_cost numeric(10,2) NOT NULL,
    profit_margin numeric(5,2) NOT NULL,
    wine_revenue numeric(10,2),
    wine_cost numeric(10,2),
    wine_profit_margin numeric(5,2),
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: prompt_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prompt_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agent_name character varying(100) NOT NULL,
    prompt_name character varying(200) NOT NULL,
    prompt_template text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    is_active boolean DEFAULT true,
    performance_score double precision,
    avg_tokens_used integer,
    avg_latency_ms integer,
    total_uses integer DEFAULT 0,
    total_successes integer DEFAULT 0,
    total_failures integer DEFAULT 0,
    ab_experiment_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    retired_at timestamp with time zone
);


--
-- Name: provider_contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.provider_contacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider_id uuid NOT NULL,
    name character varying(255) NOT NULL,
    email character varying(255),
    phone character varying(50),
    role character varying(100),
    is_primary boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    phone_type text DEFAULT 'main_line'::text
);


--
-- Name: provider_conversation_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.provider_conversation_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider_id uuid NOT NULL,
    restaurant_id uuid NOT NULL,
    session_type text NOT NULL,
    status text DEFAULT 'active'::text,
    initiated_by text NOT NULL,
    intent jsonb DEFAULT '{}'::jsonb,
    context jsonb DEFAULT '{}'::jsonb,
    topic_stack text[] DEFAULT '{}'::text[],
    approval_pending boolean DEFAULT false,
    approval_type text,
    pending_message text,
    messages_count integer DEFAULT 0,
    started_at timestamp with time zone DEFAULT now(),
    last_message_at timestamp with time zone DEFAULT now(),
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    closed_at timestamp with time zone,
    turn_count integer DEFAULT 0,
    checkpoint_summary text,
    running_summary text,
    sensitive_message_count integer DEFAULT 0,
    sentiment_summary character varying(20),
    gmail_thread_id text,
    session_status character varying(20) DEFAULT 'active'::character varying,
    draft_content text,
    draft_created_at timestamp with time zone,
    draft_approved_at timestamp with time zone,
    draft_discarded_at timestamp with time zone,
    reminder_sent_at timestamp with time zone,
    conversation_context jsonb DEFAULT '{}'::jsonb,
    CONSTRAINT provider_conversation_sessions_sentiment_summary_check CHECK (((sentiment_summary)::text = ANY ((ARRAY['positive'::character varying, 'neutral'::character varying, 'negative'::character varying, 'mixed'::character varying])::text[]))),
    CONSTRAINT provider_conversation_sessions_session_type_check CHECK ((session_type = ANY (ARRAY['negotiation'::text, 'general_inquiry'::text, 'promo_discovery'::text, 'price_check'::text, 'order_followup'::text, 'relationship_building'::text, 'onboarding'::text, 'complaint'::text]))),
    CONSTRAINT provider_conversation_sessions_status_check CHECK ((status = ANY (ARRAY['active'::text, 'paused_for_approval'::text, 'waiting_response'::text, 'follow_up_scheduled'::text, 'completed'::text, 'abandoned'::text])))
);


--
-- Name: provider_knowledge; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.provider_knowledge (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider_id uuid NOT NULL,
    restaurant_id uuid NOT NULL,
    category text NOT NULL,
    subcategory text,
    label text NOT NULL,
    attributes jsonb DEFAULT '{}'::jsonb NOT NULL,
    confidence double precision DEFAULT 1.0,
    source_conversation_id uuid,
    source_message_text text,
    previous_value jsonb,
    verified boolean DEFAULT false,
    verified_by uuid,
    verified_at timestamp with time zone,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    is_active boolean DEFAULT true,
    version integer DEFAULT 1,
    CONSTRAINT provider_knowledge_category_check CHECK ((category = ANY (ARRAY['company'::text, 'people'::text, 'wine_portfolio'::text, 'promotion'::text, 'pricing'::text, 'logistics'::text, 'financial'::text, 'relationship'::text, 'compliance'::text]))),
    CONSTRAINT provider_knowledge_confidence_check CHECK (((confidence >= (0)::double precision) AND (confidence <= (1)::double precision)))
);


--
-- Name: provider_locations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.provider_locations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider_id uuid NOT NULL,
    restaurant_id uuid NOT NULL,
    name text DEFAULT 'Main Location'::text NOT NULL,
    type text DEFAULT 'office'::text NOT NULL,
    address text,
    is_primary boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT provider_locations_type_check CHECK ((type = ANY (ARRAY['office'::text, 'warehouse'::text, 'store'::text, 'other'::text])))
);


--
-- Name: provider_performance_metrics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.provider_performance_metrics (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    provider_id uuid NOT NULL,
    restaurant_id uuid,
    period_start date NOT NULL,
    period_end date NOT NULL,
    total_orders integer DEFAULT 0,
    on_time_deliveries integer DEFAULT 0,
    late_deliveries integer DEFAULT 0,
    on_time_percentage numeric(5,2),
    avg_delivery_delay_days numeric(5,2),
    total_communications integer DEFAULT 0,
    avg_response_time_hours numeric(8,2),
    response_rate numeric(5,2),
    total_quotes integer DEFAULT 0,
    quotes_within_budget integer DEFAULT 0,
    avg_price_deviation_percent numeric(5,2),
    price_consistency_score numeric(3,2),
    quality_issues_count integer DEFAULT 0,
    order_fulfillment_rate numeric(5,2),
    avg_sentiment_score numeric(3,2),
    communication_quality_score numeric(3,2),
    overall_performance_score numeric(3,2),
    reliability_score numeric(3,2),
    calculated_at timestamp with time zone DEFAULT now(),
    next_calculation_date date,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: provider_promotions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.provider_promotions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider_id uuid NOT NULL,
    restaurant_id uuid NOT NULL,
    name text NOT NULL,
    promo_type text NOT NULL,
    description text,
    conditions jsonb DEFAULT '{}'::jsonb,
    discount_value jsonb DEFAULT '{}'::jsonb,
    applicable_wines jsonb DEFAULT '[]'::jsonb,
    applicable_categories text[],
    start_date date,
    end_date date,
    is_active boolean DEFAULT true,
    source_conversation_id uuid,
    confidence double precision DEFAULT 1.0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT provider_promotions_promo_type_check CHECK ((promo_type = ANY (ARRAY['volume_discount'::text, 'seasonal'::text, 'bundle'::text, 'loyalty'::text, 'closeout'::text, 'new_vintage'::text, 'free_shipping'::text, 'sample'::text, 'early_payment'::text, 'referral'::text])))
);


--
-- Name: provider_sentiment_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.provider_sentiment_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider_id uuid NOT NULL,
    restaurant_id uuid NOT NULL,
    conversation_id uuid,
    session_id uuid,
    sentiment text NOT NULL,
    sentiment_score double precision,
    detected_emotions text[],
    trigger_context text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT provider_sentiment_history_sentiment_check CHECK ((sentiment = ANY (ARRAY['positive'::text, 'neutral'::text, 'negative'::text]))),
    CONSTRAINT provider_sentiment_history_sentiment_score_check CHECK (((sentiment_score >= ('-1'::integer)::double precision) AND (sentiment_score <= (1)::double precision)))
);


--
-- Name: providers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.providers (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    name character varying(255) NOT NULL,
    company_name character varying(255),
    primary_contact jsonb NOT NULL,
    alternative_contacts jsonb[],
    address jsonb,
    specialties text[],
    regions_covered text[],
    minimum_order integer,
    lead_time_days integer DEFAULT 7,
    important_dates jsonb,
    conversation_history jsonb[],
    response_pattern jsonb,
    personality_notes text,
    reliability_score numeric(3,2) DEFAULT 5.0,
    avg_response_time_hours numeric(6,2),
    on_time_delivery_rate numeric(5,2),
    price_consistency_score numeric(3,2),
    total_orders_count integer DEFAULT 0,
    price_deviation_history jsonb[],
    is_active boolean DEFAULT true,
    tier character varying(50),
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    competitor_group character varying(100),
    restaurant_id uuid,
    contact_email character varying(255),
    contact_phone character varying(50),
    last_contact_date timestamp with time zone,
    last_contact_notes text,
    close_relationship boolean DEFAULT false,
    relationship_health_score numeric(5,2),
    agent_permissions jsonb DEFAULT '{"tier": 1, "auto_complaints": false, "auto_operational": false, "recurring_orders": []}'::jsonb,
    catalogue_vendor_id uuid,
    is_custom boolean DEFAULT true NOT NULL,
    auto_reply_enabled boolean DEFAULT false,
    profile_foundational jsonb DEFAULT '{}'::jsonb,
    profile_dynamic jsonb DEFAULT '{}'::jsonb,
    contact_first_name character varying(100),
    contact_last_name character varying(150),
    website character varying(500),
    rating numeric(2,1),
    payment_terms text DEFAULT 'Net 30'::text,
    CONSTRAINT providers_rating_check CHECK (((rating >= (0)::numeric) AND (rating <= (5)::numeric)))
);


--
-- Name: recommendation_actions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recommendation_actions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    rule_key text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    reason text,
    snooze_until timestamp with time zone,
    pinned boolean DEFAULT false NOT NULL,
    acted_at timestamp with time zone,
    feedback text,
    observation text,
    recommendation text,
    category text,
    urgency text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    assigned_to uuid,
    assigned_name text,
    assigned_at timestamp with time zone
);


--
-- Name: recommendation_digest_prefs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recommendation_digest_prefs (
    restaurant_id uuid NOT NULL,
    digest_enabled boolean DEFAULT false NOT NULL,
    digest_hour integer DEFAULT 7 NOT NULL,
    digest_min_urgency text DEFAULT 'this_week'::text NOT NULL,
    recipient_email text,
    last_sent_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: recurring_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recurring_orders (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    restaurant_id uuid,
    wine_id character varying(50),
    quantity integer NOT NULL,
    unit_type character varying(10) NOT NULL,
    frequency character varying(20) NOT NULL,
    frequency_day integer,
    preferred_providers text[],
    auto_approve boolean DEFAULT false,
    next_order_date date NOT NULL,
    last_order_date date,
    active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    CONSTRAINT recurring_orders_frequency_check CHECK (((frequency)::text = ANY ((ARRAY['daily'::character varying, 'weekly'::character varying, 'biweekly'::character varying, 'monthly'::character varying])::text[]))),
    CONSTRAINT recurring_orders_quantity_check CHECK ((quantity > 0)),
    CONSTRAINT recurring_orders_unit_type_check CHECK (((unit_type)::text = ANY ((ARRAY['case'::character varying, 'bottle'::character varying])::text[])))
);


--
-- Name: research_run_stats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.research_run_stats (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    run_id uuid NOT NULL,
    wine_id uuid NOT NULL,
    fields_targeted integer DEFAULT 0 NOT NULL,
    fields_filled integer DEFAULT 0 NOT NULL,
    fields_conflicted integer DEFAULT 0 NOT NULL,
    fields_unchanged integer DEFAULT 0 NOT NULL,
    cost_usd numeric(10,6) DEFAULT 0 NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    null_rate_before numeric(5,4),
    null_rate_after numeric(5,4),
    time_to_fill_hours numeric(10,4),
    created_at timestamp with time zone DEFAULT now(),
    regression_blocked_count integer DEFAULT 0 NOT NULL
);


--
-- Name: research_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.research_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    started_at timestamp with time zone DEFAULT now(),
    completed_at timestamp with time zone,
    records_eligible integer DEFAULT 0 NOT NULL,
    records_processed integer DEFAULT 0 NOT NULL,
    fields_filled integer DEFAULT 0 NOT NULL,
    cost_usd numeric(10,6) DEFAULT 0 NOT NULL,
    pii_policy_flags integer DEFAULT 0 NOT NULL,
    status character varying(20) DEFAULT 'running'::character varying NOT NULL,
    CONSTRAINT valid_run_status CHECK (((status)::text = ANY ((ARRAY['running'::character varying, 'completed'::character varying, 'partial'::character varying, 'failed'::character varying])::text[])))
);


--
-- Name: resolution_challenges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.resolution_challenges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    submission_id uuid NOT NULL,
    field_name character varying(100) NOT NULL,
    existing_value text NOT NULL,
    challenging_value text NOT NULL,
    challenging_source_url text NOT NULL,
    challenging_source_tier character(1) DEFAULT 'A'::bpchar NOT NULL,
    snippet text,
    challenged_at timestamp with time zone DEFAULT now(),
    status character varying(20) DEFAULT 'open'::character varying NOT NULL,
    resolved_by text,
    resolved_at timestamp with time zone,
    CONSTRAINT valid_challenge_status CHECK (((status)::text = ANY ((ARRAY['open'::character varying, 'accepted'::character varying, 'dismissed'::character varying])::text[])))
);


--
-- Name: restaurant_branding; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.restaurant_branding (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    logo_url text,
    primary_color character varying(7) DEFAULT '#7c2d12'::character varying,
    secondary_color character varying(7),
    display_name character varying(255),
    tagline character varying(500),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: restaurant_chains; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.restaurant_chains (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    cuisine_type character varying(100),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: restaurant_directory; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.restaurant_directory (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_name text NOT NULL,
    city text NOT NULL,
    state text,
    neighborhood text,
    cuisine_type text,
    price_range text,
    rating numeric(3,1),
    website_url text,
    opentable_url text,
    yelp_url text,
    google_place_id text,
    discovery_sources text[] DEFAULT '{}'::text[],
    crawl_status text DEFAULT 'pending'::text NOT NULL,
    last_crawled_at timestamp with time zone,
    content_hash text,
    menu_type text,
    wine_count_estimate integer,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT restaurant_directory_crawl_status_check CHECK ((crawl_status = ANY (ARRAY['pending'::text, 'crawled'::text, 'failed'::text, 'no_menu'::text, 'skipped'::text])))
);


--
-- Name: restaurant_feature_flags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.restaurant_feature_flags (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid,
    flag_name character varying(100) NOT NULL,
    enabled boolean DEFAULT false,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    enable_ai_autonomous_send boolean DEFAULT false NOT NULL
);


--
-- Name: restaurant_inbound_addresses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.restaurant_inbound_addresses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    address text NOT NULL,
    token text NOT NULL,
    provider text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: restaurant_menus; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.restaurant_menus (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    name text DEFAULT 'Wine List'::text NOT NULL,
    season text DEFAULT 'year_round'::text NOT NULL,
    year integer,
    menu_type text DEFAULT 'beverage'::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT restaurant_menus_menu_type_check CHECK ((menu_type = ANY (ARRAY['beverage'::text, 'food'::text, 'full'::text, 'bar'::text, 'events'::text]))),
    CONSTRAINT restaurant_menus_season_check CHECK ((season = ANY (ARRAY['spring'::text, 'summer'::text, 'fall'::text, 'winter'::text, 'year_round'::text, 'event'::text]))),
    CONSTRAINT restaurant_menus_status_check CHECK ((status = ANY (ARRAY['active'::text, 'draft'::text, 'archived'::text])))
);


--
-- Name: restaurant_providers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.restaurant_providers (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    restaurant_id uuid NOT NULL,
    provider_id uuid NOT NULL,
    tier character varying(50) NOT NULL,
    wine_categories text[],
    custom_lead_time_days integer,
    custom_minimum_order integer,
    orders_placed integer DEFAULT 0,
    last_order_date date,
    total_spent numeric(12,2) DEFAULT 0,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: restaurant_tables; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.restaurant_tables (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    label text NOT NULL,
    seats integer DEFAULT 2 NOT NULL,
    zone text,
    is_outdoor boolean DEFAULT false NOT NULL,
    distance_to_kitchen_m numeric(6,2),
    distance_to_bar_m numeric(6,2),
    distance_to_pool_m numeric(6,2),
    x_pos numeric(8,2),
    y_pos numeric(8,2),
    pos_refs jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: restaurant_venue_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.restaurant_venue_profiles (
    restaurant_id uuid NOT NULL,
    features jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: restaurant_wine_roster; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.restaurant_wine_roster (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    signature_hash text NOT NULL,
    wine_name text,
    price_reference numeric(10,2),
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: rfq_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rfq_requests (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    inventory_id uuid NOT NULL,
    restaurant_id uuid NOT NULL,
    wine_name character varying(255) NOT NULL,
    quantity integer NOT NULL,
    requested_delivery_date date,
    vendor_responses jsonb[],
    selected_vendor_id uuid,
    selected_price numeric(10,2),
    selection_reason text,
    status character varying(50) DEFAULT 'pending'::character varying,
    presented_at timestamp with time zone,
    approved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: saga_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.saga_state (
    saga_id uuid DEFAULT gen_random_uuid() NOT NULL,
    saga_type text NOT NULL,
    current_step text DEFAULT 'INIT'::text NOT NULL,
    status text DEFAULT 'IN_PROGRESS'::text NOT NULL,
    context jsonb DEFAULT '{}'::jsonb NOT NULL,
    compensations jsonb DEFAULT '[]'::jsonb NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deadline_at timestamp with time zone,
    error text
);


--
-- Name: sales_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sales_events (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    restaurant_id uuid NOT NULL,
    inventory_id uuid NOT NULL,
    event_type character varying(50) NOT NULL,
    quantity integer NOT NULL,
    unit_price numeric(10,2) NOT NULL,
    total_price numeric(10,2) NOT NULL,
    pos_order_id character varying(100),
    pos_check_id character varying(100),
    pos_item_id character varying(100),
    pos_event_timestamp timestamp with time zone NOT NULL,
    pos_raw_data jsonb,
    day_of_week integer,
    hour_of_day integer,
    is_weekend boolean,
    time_window character varying(50),
    stock_before integer,
    stock_after integer,
    server_name character varying(100),
    server_id character varying(100),
    created_at timestamp with time zone DEFAULT now(),
    processed_at timestamp with time zone,
    sku character varying(100),
    pos_item_guid character varying(100),
    pos_sku character varying(100),
    wine_id character varying(20)
);


--
-- Name: schedule_receipts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schedule_receipts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    schedule_id uuid NOT NULL,
    member_id uuid NOT NULL,
    seen_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: schedules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schedules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    week_start date NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    published_at timestamp with time zone,
    published_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sender_reputation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sender_reputation (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    domain text NOT NULL,
    provider_id uuid,
    trusted boolean DEFAULT false NOT NULL,
    trusted_at timestamp with time zone,
    suspended boolean DEFAULT false NOT NULL,
    suspended_reason text,
    suspended_at timestamp with time zone,
    injection_signals integer DEFAULT 0 NOT NULL,
    spam_signals integer DEFAULT 0 NOT NULL,
    bounce_signals integer DEFAULT 0 NOT NULL,
    completed_orders integer DEFAULT 0 NOT NULL,
    last_signal_at timestamp with time zone,
    score real DEFAULT 0.5 NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: server_sales; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.server_sales (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    member_id uuid NOT NULL,
    service_date date NOT NULL,
    covers integer DEFAULT 0 NOT NULL,
    net_sales numeric(12,2) DEFAULT 0 NOT NULL,
    wine_sales numeric(12,2) DEFAULT 0 NOT NULL,
    checks integer DEFAULT 0 NOT NULL,
    source text DEFAULT 'manual'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: shift_breaks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shift_breaks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shift_id uuid NOT NULL,
    start_time text NOT NULL,
    duration_min integer DEFAULT 30 NOT NULL,
    covered_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: shifts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shifts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    schedule_id uuid,
    member_id uuid,
    shift_date date NOT NULL,
    start_time text NOT NULL,
    end_time text NOT NULL,
    role text,
    shift_type text DEFAULT 'pm'::text NOT NULL,
    state text DEFAULT 'scheduled'::text NOT NULL,
    note text,
    labor_cost numeric(10,2),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sim_ground_truth_facts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sim_ground_truth_facts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    run_id uuid NOT NULL,
    restaurant_id uuid NOT NULL,
    fact_type text NOT NULL,
    sku_key text,
    entity_ref jsonb DEFAULT '{}'::jsonb NOT NULL,
    payload jsonb NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sim_ground_truth_facts_fact_type_check CHECK ((fact_type = ANY (ARRAY['profile'::text, 'roster'::text, 'sku'::text, 'menu_price'::text, 'opening_stock'::text, 'menu_quality_meta'::text])))
);


--
-- Name: sim_ground_truth_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sim_ground_truth_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    archetype_id text NOT NULL,
    seed_version text NOT NULL,
    menu_quality text NOT NULL,
    snapshot_path text NOT NULL,
    snapshot_sha256 text NOT NULL,
    params jsonb NOT NULL,
    sku_count integer NOT NULL,
    priced_sku_count integer NOT NULL,
    seeded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sim_ground_truth_runs_menu_quality_check CHECK ((menu_quality = ANY (ARRAY['full'::text, 'partial'::text])))
);


--
-- Name: sku_mappings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sku_mappings (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    restaurant_id uuid,
    master_wine_id uuid,
    inventory_id uuid,
    sku_type character varying(50) NOT NULL,
    sku_value character varying(100) NOT NULL,
    source_system character varying(50),
    source_id character varying(100),
    provider_id uuid,
    is_primary boolean DEFAULT false,
    is_active boolean DEFAULT true,
    verified_at timestamp with time zone,
    verified_by uuid,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: sommelier_conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sommelier_conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    title text DEFAULT 'New Chat'::text NOT NULL,
    messages jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: spend_alert_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.spend_alert_state (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider character varying(50) NOT NULL,
    last_alert_month character varying(7),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: storage_locations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.storage_locations (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    restaurant_id uuid NOT NULL,
    zone character varying(100),
    section character varying(100),
    shelf character varying(50),
    "position" character varying(50),
    full_location character varying(255),
    capacity_bottles integer NOT NULL,
    current_occupancy integer DEFAULT 0,
    temperature_zone character varying(50),
    temperature_min numeric(5,2),
    temperature_max numeric(5,2),
    humidity_controlled boolean DEFAULT false,
    requires_special_access boolean DEFAULT false,
    access_notes text,
    display_order integer,
    color_code character varying(7),
    is_active boolean DEFAULT true,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    name text
);


--
-- Name: supplier_catalogs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supplier_catalogs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider_id uuid,
    catalog_name character varying(255),
    items jsonb DEFAULT '[]'::jsonb NOT NULL,
    pricing_tier character varying(50),
    valid_from date,
    valid_until date,
    last_synced_at timestamp with time zone,
    source character varying(50),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: swap_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.swap_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    shift_id uuid,
    from_member_id uuid,
    to_member_id uuid,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: system_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_audit_log (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    actor_type character varying(50) NOT NULL,
    actor_id uuid,
    action character varying(100) NOT NULL,
    entity_type character varying(50) NOT NULL,
    entity_id uuid,
    changes jsonb,
    restaurant_id uuid,
    ip_address inet,
    user_agent text,
    reason text,
    is_suspicious boolean DEFAULT false,
    flagged_reason text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: system_learning_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_learning_state (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid,
    model_name character varying(100) NOT NULL,
    model_version integer DEFAULT 1,
    training_data_size integer DEFAULT 0,
    last_trained_at timestamp with time zone,
    accuracy_metrics jsonb,
    parameters jsonb,
    status character varying(20) DEFAULT 'DISABLED'::character varying,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: team_availability; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.team_availability (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    member_id uuid NOT NULL,
    day_of_week integer NOT NULL,
    start_time text,
    end_time text,
    is_available boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: team_certifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.team_certifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    member_id uuid NOT NULL,
    cert_type text NOT NULL,
    issued_at date,
    expires_at date,
    doc_url text,
    status text DEFAULT 'valid'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: team_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.team_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    user_id uuid,
    invite_id uuid,
    display_name text NOT NULL,
    email text,
    phone text,
    avatar_url text,
    "position" text,
    employment_type text DEFAULT 'full_time'::text NOT NULL,
    home_location text,
    hourly_wage numeric(10,2),
    skills text[] DEFAULT '{}'::text[] NOT NULL,
    hire_date date,
    status text DEFAULT 'active'::text NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: team_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.team_settings (
    restaurant_id uuid NOT NULL,
    labor_tracking_enabled boolean DEFAULT true NOT NULL,
    wage_visible boolean DEFAULT true NOT NULL,
    labor_target_pct numeric(5,2) DEFAULT 28 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: time_off_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.time_off_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    member_id uuid NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    reason text,
    status text DEFAULT 'pending'::text NOT NULL,
    reviewed_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: toast_item_mappings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.toast_item_mappings (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    restaurant_id uuid NOT NULL,
    toast_guid character varying(100) NOT NULL,
    toast_menu_item_id character varying(100),
    toast_item_name character varying(255) NOT NULL,
    toast_price numeric(10,2),
    toast_sku character varying(100),
    toast_plu character varying(50),
    inventory_id uuid,
    master_wine_id uuid,
    mapping_status character varying(50) DEFAULT 'unmapped'::character varying,
    mapping_confidence numeric(3,2),
    mapped_at timestamp with time zone,
    mapped_by uuid,
    total_sales_count integer DEFAULT 0,
    total_revenue numeric(12,2) DEFAULT 0,
    last_sale_at timestamp with time zone,
    last_synced_at timestamp with time zone,
    sync_error text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    sale_unit character varying(10),
    CONSTRAINT toast_item_mappings_sale_unit_check CHECK (((sale_unit)::text = ANY ((ARRAY['glass'::character varying, 'bottle'::character varying])::text[])))
);


--
-- Name: training_datasets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.training_datasets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    dataset_type character varying(50) NOT NULL,
    input_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    output_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    model_version character varying(50) DEFAULT 'gemini-2.0-flash'::character varying,
    confidence numeric(4,3) DEFAULT 0.000,
    human_verified boolean DEFAULT false,
    restaurant_id uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: trending_wines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trending_wines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    wine_id uuid NOT NULL,
    window_days integer NOT NULL,
    restaurant_count_start integer DEFAULT 0 NOT NULL,
    restaurant_count_end integer DEFAULT 0 NOT NULL,
    delta integer DEFAULT 0 NOT NULL,
    pct_change numeric(10,4),
    trend_score numeric(10,4),
    burst_detected_at timestamp with time zone,
    computed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT trending_wines_window_days_check CHECK ((window_days = ANY (ARRAY[30, 60, 90])))
);


--
-- Name: unit_conversions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.unit_conversions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    from_unit character varying(20) NOT NULL,
    to_unit character varying(20) NOT NULL,
    factor numeric(10,4) NOT NULL,
    notes text
);


--
-- Name: user_oauth_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_oauth_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    provider character varying(50) NOT NULL,
    provider_user_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_oauth_accounts_provider_check CHECK (((provider)::text = ANY ((ARRAY['google'::character varying, 'microsoft'::character varying])::text[])))
);


--
-- Name: user_onboarding_progress; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_onboarding_progress (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    restaurant_id uuid NOT NULL,
    menu_uploaded boolean DEFAULT false NOT NULL,
    vendor_added boolean DEFAULT false NOT NULL,
    team_member_invited boolean DEFAULT false NOT NULL,
    checklist_dismissed boolean DEFAULT false NOT NULL,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_preferences (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    preferences jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: user_restaurant_access; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_restaurant_access (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    restaurant_id uuid NOT NULL,
    role character varying(50) DEFAULT 'manager'::character varying,
    created_at timestamp with time zone DEFAULT now(),
    is_active boolean DEFAULT true NOT NULL,
    valid_from timestamp with time zone DEFAULT now() NOT NULL,
    valid_until timestamp with time zone,
    invited_via uuid,
    deactivated_at timestamp with time zone,
    deactivated_by uuid
);


--
-- Name: user_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    role text NOT NULL,
    granted_by uuid,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    consecutive_approved_overrides integer DEFAULT 0 NOT NULL,
    promotion_policy text DEFAULT 'queue'::text NOT NULL,
    auto_promote_earned_at timestamp with time zone,
    CONSTRAINT user_roles_promotion_policy_check CHECK ((promotion_policy = ANY (ARRAY['queue'::text, 'auto_promote'::text]))),
    CONSTRAINT user_roles_role_check CHECK ((role = ANY (ARRAY['developer'::text, 'certified_contributor'::text, 'review_admin'::text])))
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    user_id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    email character varying(255) NOT NULL,
    password_hash text,
    name character varying(255) NOT NULL,
    restaurant_id uuid,
    role character varying(20) DEFAULT 'manager'::character varying NOT NULL,
    phone character varying(50),
    oauth_provider character varying(50),
    oauth_id text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    email_verified boolean DEFAULT false NOT NULL
);


--
-- Name: ux_learnings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ux_learnings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid,
    page text,
    target_key text,
    proposal_id uuid,
    hypothesis text NOT NULL,
    outcome text,
    metric text,
    baseline numeric,
    observed numeric,
    lift_pct numeric(8,4),
    verdict text,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ux_overrides; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ux_overrides (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid,
    page text NOT NULL,
    target_key text NOT NULL,
    kind text NOT NULL,
    patch jsonb DEFAULT '{}'::jsonb NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    rollout_pct integer DEFAULT 10 NOT NULL,
    proposal_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ux_proposals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ux_proposals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid,
    page text NOT NULL,
    kind text NOT NULL,
    target_key text NOT NULL,
    title text NOT NULL,
    rationale text NOT NULL,
    change jsonb DEFAULT '{}'::jsonb NOT NULL,
    evidence jsonb DEFAULT '{}'::jsonb NOT NULL,
    confidence numeric(4,3),
    source text DEFAULT 'heuristic'::text NOT NULL,
    status text DEFAULT 'proposed'::text NOT NULL,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ux_signals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ux_signals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid,
    page text NOT NULL,
    event text NOT NULL,
    target_key text,
    value numeric,
    session_id text,
    meta jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: v_active_inventory; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_active_inventory AS
 SELECT ri.id,
    ri.restaurant_id,
    ri.master_wine_id,
    ri.provider_id,
    ri.stock_live,
    ri.physical_stock,
    ri.shadow_stock,
    ri.expected_stock,
    ri.in_transit_quantity,
    ri.threshold_min,
    ri.validation_max,
    ri.buffer_window_minutes,
    ri.inventory_state,
    ri.last_alerted_at,
    ri.last_alert_level,
    ri.alert_count,
    ri.last_manual_edit_at,
    ri.last_manual_edit_by,
    ri.manual_edit_reason,
    ri.custom_price,
    ri.last_purchase_price,
    ri.negotiated_price,
    ri.margin_percentage,
    ri.sales_velocity_30d,
    ri.sales_velocity_7d,
    ri.last_sold_at,
    ri.times_ordered_count,
    ri.total_revenue,
    ri.expected_delivery_date,
    ri.last_delivery_date,
    ri.is_active,
    ri.menu_section,
    ri.menu_position,
    ri.created_at,
    ri.updated_at,
    ri.deleted_at,
    mw.name AS wine_name,
    mw.producer,
    mw.vintage,
    mw.primary_type,
    mw.region,
    p.name AS provider_name,
    p.primary_contact AS provider_contact
   FROM ((public.restaurant_inventory ri
     JOIN public.master_wine_library mw ON ((ri.master_wine_id = mw.id)))
     LEFT JOIN public.providers p ON ((ri.provider_id = p.id)))
  WHERE ((ri.deleted_at IS NULL) AND (ri.is_active = true));


--
-- Name: v_low_stock_items; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_low_stock_items AS
 SELECT ri.id,
    ri.restaurant_id,
    ri.master_wine_id,
    ri.provider_id,
    ri.stock_live,
    ri.physical_stock,
    ri.shadow_stock,
    ri.expected_stock,
    ri.in_transit_quantity,
    ri.threshold_min,
    ri.validation_max,
    ri.buffer_window_minutes,
    ri.inventory_state,
    ri.last_alerted_at,
    ri.last_alert_level,
    ri.alert_count,
    ri.last_manual_edit_at,
    ri.last_manual_edit_by,
    ri.manual_edit_reason,
    ri.custom_price,
    ri.last_purchase_price,
    ri.negotiated_price,
    ri.margin_percentage,
    ri.sales_velocity_30d,
    ri.sales_velocity_7d,
    ri.last_sold_at,
    ri.times_ordered_count,
    ri.total_revenue,
    ri.expected_delivery_date,
    ri.last_delivery_date,
    ri.is_active,
    ri.menu_section,
    ri.menu_position,
    ri.created_at,
    ri.updated_at,
    ri.deleted_at,
    mw.name AS wine_name,
    mw.producer,
    mw.vintage,
    r.name AS restaurant_name
   FROM ((public.restaurant_inventory ri
     JOIN public.master_wine_library mw ON ((ri.master_wine_id = mw.id)))
     JOIN public.restaurants r ON ((ri.restaurant_id = r.id)))
  WHERE ((ri.stock_live < ri.threshold_min) AND (ri.is_active = true) AND (ri.deleted_at IS NULL) AND ((ri.inventory_state)::text <> 'IN_TRANSIT'::text));


--
-- Name: v_one_tap_action_history; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_one_tap_action_history AS
 SELECT ota.id,
    ota.restaurant_id,
    ota.user_id,
    ota.action_type,
    ota.title,
    ota.description,
    ota.action_url,
    ota.priority,
    ota.color,
    ota.icon,
    ota.status,
    ota.related_wine_id,
    ota.related_order_id,
    ota.related_provider_id,
    ota.metadata,
    ota.executed_at,
    ota.executed_by,
    ota.execution_result,
    ota.created_at,
    ota.updated_at,
    ota.expires_at,
    ota.deleted_at,
    r.name AS restaurant_name,
    u.email AS executed_by_email
   FROM ((public.one_tap_actions ota
     LEFT JOIN public.restaurants r ON ((ota.restaurant_id = r.id)))
     LEFT JOIN auth.users u ON ((ota.executed_by = u.id)))
  WHERE ((ota.status = ANY (ARRAY['completed'::public.one_tap_action_status, 'cancelled'::public.one_tap_action_status])) AND (ota.deleted_at IS NULL))
  ORDER BY ota.executed_at DESC;


--
-- Name: v_pending_one_tap_actions; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_pending_one_tap_actions AS
 SELECT ota.id,
    ota.restaurant_id,
    ota.user_id,
    ota.action_type,
    ota.title,
    ota.description,
    ota.action_url,
    ota.priority,
    ota.color,
    ota.icon,
    ota.status,
    ota.related_wine_id,
    ota.related_order_id,
    ota.related_provider_id,
    ota.metadata,
    ota.executed_at,
    ota.executed_by,
    ota.execution_result,
    ota.created_at,
    ota.updated_at,
    ota.expires_at,
    ota.deleted_at,
    r.name AS restaurant_name,
    mwl.name AS wine_name,
    po.order_number,
    p.name AS provider_name
   FROM ((((public.one_tap_actions ota
     LEFT JOIN public.restaurants r ON ((ota.restaurant_id = r.id)))
     LEFT JOIN public.master_wine_library mwl ON ((ota.related_wine_id = mwl.id)))
     LEFT JOIN public.procurement_orders po ON ((ota.related_order_id = po.id)))
     LEFT JOIN public.providers p ON ((ota.related_provider_id = p.id)))
  WHERE ((ota.status = 'pending'::public.one_tap_action_status) AND (ota.deleted_at IS NULL) AND ((ota.expires_at IS NULL) OR (ota.expires_at > now())))
  ORDER BY
        CASE ota.priority
            WHEN 'critical'::public.one_tap_priority THEN 1
            WHEN 'high'::public.one_tap_priority THEN 2
            WHEN 'medium'::public.one_tap_priority THEN 3
            WHEN 'low'::public.one_tap_priority THEN 4
            ELSE NULL::integer
        END, ota.created_at DESC;


--
-- Name: v_restaurant_sku_reference; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_restaurant_sku_reference AS
 SELECT ri.restaurant_id,
    r.name AS restaurant_name,
    ri.id AS inventory_id,
    ri.master_wine_id,
    mw.name AS wine_name,
    mw.producer,
    mw.vintage,
    COALESCE(ri.sku, mw.sku) AS primary_sku,
    ri.internal_sku,
    ri.pos_sku,
    mw.sku AS master_sku,
    mw.upc,
    mw.ean,
    mw.manufacturer_sku,
    ri.toast_item_guid,
    ri.toast_menu_item_id,
    ri.square_item_id,
    ri.clover_item_id,
    ri.stock_live AS current_stock,
    ri.threshold_min,
    ri.is_active
   FROM ((public.restaurant_inventory ri
     JOIN public.restaurants r ON ((ri.restaurant_id = r.id)))
     JOIN public.master_wine_library mw ON ((ri.master_wine_id = mw.id)))
  WHERE (ri.deleted_at IS NULL);


--
-- Name: v_sales_summary_30d; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_sales_summary_30d AS
 SELECT se.restaurant_id,
    se.inventory_id,
    mw.name AS wine_name,
    count(*) AS total_sales_count,
    sum(se.quantity) AS total_bottles_sold,
    sum(se.total_price) AS total_revenue,
    avg(se.unit_price) AS avg_price_per_bottle,
    min(se.pos_event_timestamp) AS first_sale,
    max(se.pos_event_timestamp) AS last_sale
   FROM ((public.sales_events se
     JOIN public.restaurant_inventory ri ON ((se.inventory_id = ri.id)))
     JOIN public.master_wine_library mw ON ((ri.master_wine_id = mw.id)))
  WHERE ((se.pos_event_timestamp >= (now() - '30 days'::interval)) AND ((se.event_type)::text = 'sale'::text))
  GROUP BY se.restaurant_id, se.inventory_id, mw.name;


--
-- Name: v_sku_conflicts; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_sku_conflicts AS
 SELECT restaurant_id,
    sku_value,
    sku_type,
    count(*) AS conflict_count,
    array_agg(DISTINCT master_wine_id) AS conflicting_wines,
    array_agg(DISTINCT inventory_id) AS conflicting_inventory
   FROM public.sku_mappings
  WHERE (is_active = true)
  GROUP BY restaurant_id, sku_value, sku_type
 HAVING (count(*) > 1);


--
-- Name: v_unmapped_toast_items; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_unmapped_toast_items AS
 SELECT tim.restaurant_id,
    r.name AS restaurant_name,
    tim.toast_guid,
    tim.toast_item_name,
    tim.toast_price,
    tim.toast_sku,
    tim.toast_plu,
    tim.total_sales_count,
    tim.total_revenue,
    tim.last_sale_at,
    tim.created_at
   FROM (public.toast_item_mappings tim
     JOIN public.restaurants r ON ((tim.restaurant_id = r.id)))
  WHERE ((tim.mapping_status)::text = 'unmapped'::text)
  ORDER BY tim.total_revenue DESC;


--
-- Name: vendor_catalogue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vendor_catalogue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    type text,
    country text DEFAULT 'US'::text NOT NULL,
    state text,
    city text,
    address text,
    phone text,
    email text,
    website text,
    wine_specialties text,
    notes text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT vendor_catalogue_type_check CHECK ((type = ANY (ARRAY['distributor'::text, 'importer'::text, 'wholesaler'::text, 'winery_direct'::text, 'broker'::text, 'other'::text])))
);


--
-- Name: vendor_deadlines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vendor_deadlines (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    restaurant_id uuid,
    provider_id character varying(50) NOT NULL,
    provider_name character varying(255) NOT NULL,
    deadline_day integer NOT NULL,
    deadline_time time without time zone NOT NULL,
    notification_hours_before integer DEFAULT 48,
    active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    CONSTRAINT vendor_deadlines_deadline_day_check CHECK (((deadline_day >= 0) AND (deadline_day <= 6)))
);


--
-- Name: vendor_promotions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vendor_promotions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider_id uuid NOT NULL,
    restaurant_id uuid NOT NULL,
    detected_from_conversation_id uuid,
    detected_from_email_subject text,
    product_name text,
    grape_variety text,
    region text,
    discount_pct numeric(5,2),
    discount_fixed numeric(10,2),
    valid_from date,
    valid_until date,
    promo_description text,
    conditions text,
    min_quantity integer,
    menu_fit character varying(20) DEFAULT 'PENDING'::character varying,
    menu_fit_detail text,
    dedup_hash text,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    urgency_score numeric(4,2) DEFAULT NULL::numeric,
    linked_event_ids uuid[] DEFAULT '{}'::uuid[],
    last_comparison_price numeric(10,2) DEFAULT NULL::numeric,
    price_source_inventory_id uuid,
    snoozed_until timestamp with time zone,
    CONSTRAINT vendor_promotions_menu_fit_check CHECK (((menu_fit)::text = ANY ((ARRAY['STRONG_FIT'::character varying, 'PARTIAL_FIT'::character varying, 'NO_FIT'::character varying, 'PENDING'::character varying])::text[]))),
    CONSTRAINT vendor_promotions_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'actioned'::character varying, 'expired'::character varying, 'suppressed'::character varying])::text[])))
);


--
-- Name: vintage_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vintage_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    region_id uuid,
    appellation_name text NOT NULL,
    rule_type character varying(20) DEFAULT 'standard'::character varying NOT NULL,
    min_release_delay_months integer NOT NULL,
    allows_nv boolean DEFAULT false NOT NULL,
    notes text,
    source_ref text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT valid_rule_type CHECK (((rule_type)::text = ANY ((ARRAY['standard'::character varying, 'riserva'::character varying, 'gran_reserva'::character varying, 'nouveau'::character varying, 'special'::character varying])::text[])))
);


--
-- Name: vintage_substitution_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vintage_substitution_rules (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    restaurant_id uuid NOT NULL,
    master_wine_id uuid NOT NULL,
    primary_vintage integer NOT NULL,
    acceptable_vintages integer[],
    price_adjustment_rules jsonb,
    auto_approve boolean DEFAULT false,
    max_auto_approve_price_diff numeric(10,2),
    notes text,
    reason_for_rule text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: wine_acquisition_details; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wine_acquisition_details (
    wine_id character varying(50) NOT NULL,
    acquisition_type character varying(50) DEFAULT 'standard'::character varying,
    auction_details jsonb,
    acquisition_date date,
    acquisition_price numeric(10,2),
    notes text,
    created_at timestamp without time zone DEFAULT now(),
    CONSTRAINT wine_acquisition_details_acquisition_type_check CHECK (((acquisition_type)::text = ANY ((ARRAY['standard'::character varying, 'auction'::character varying, 'direct_import'::character varying, 'special_allocation'::character varying])::text[])))
);


--
-- Name: wine_aliases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wine_aliases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    canonical_id uuid NOT NULL,
    alias_name text NOT NULL,
    alias_name_normalized text,
    alias_source text DEFAULT 'human_review'::text NOT NULL,
    language text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: wine_consumption_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wine_consumption_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    inventory_id uuid NOT NULL,
    wine_name character varying(500),
    consumption_type character varying(10) NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    volume_ml double precision NOT NULL,
    unit_price numeric(10,2),
    total_revenue numeric(10,2),
    source character varying(20) DEFAULT 'manual'::character varying,
    recorded_at timestamp with time zone DEFAULT now(),
    recorded_by uuid,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT wine_consumption_log_consumption_type_check CHECK (((consumption_type)::text = ANY ((ARRAY['bottle'::character varying, 'glass'::character varying])::text[]))),
    CONSTRAINT wine_consumption_log_source_check CHECK (((source)::text = ANY ((ARRAY['manual'::character varying, 'pos'::character varying, 'ai_agent'::character varying])::text[])))
);


--
-- Name: wine_consumption_summary; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.wine_consumption_summary AS
 SELECT restaurant_id,
    inventory_id,
    wine_name,
    sum(
        CASE
            WHEN ((consumption_type)::text = 'bottle'::text) THEN quantity
            ELSE 0
        END) AS bottles_consumed,
    sum(
        CASE
            WHEN ((consumption_type)::text = 'glass'::text) THEN quantity
            ELSE 0
        END) AS glasses_consumed,
    sum(volume_ml) AS total_volume_ml,
    sum(
        CASE
            WHEN ((consumption_type)::text = 'bottle'::text) THEN COALESCE(total_revenue, (0)::numeric)
            ELSE (0)::numeric
        END) AS bottle_revenue,
    sum(
        CASE
            WHEN ((consumption_type)::text = 'glass'::text) THEN COALESCE(total_revenue, (0)::numeric)
            ELSE (0)::numeric
        END) AS glass_revenue,
    sum(COALESCE(total_revenue, (0)::numeric)) AS total_revenue
   FROM public.wine_consumption_log cl
  GROUP BY restaurant_id, inventory_id, wine_name;


--
-- Name: wine_location_mappings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wine_location_mappings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid,
    wine_id character varying(255) NOT NULL,
    location_id uuid,
    quantity integer DEFAULT 1,
    assigned_at timestamp with time zone DEFAULT now()
);


--
-- Name: wine_menu_prices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wine_menu_prices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    wine_id uuid NOT NULL,
    menu_price numeric(10,2) NOT NULL,
    currency character varying(3) DEFAULT 'USD'::character varying NOT NULL,
    source character varying(50) DEFAULT 'menu_scan'::character varying NOT NULL,
    scanned_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: wine_popularity; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wine_popularity (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    wine_id uuid NOT NULL,
    restaurant_count integer DEFAULT 0 NOT NULL,
    computed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: wine_regions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wine_regions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    level character varying(20) NOT NULL,
    parent_id uuid,
    country_code character(2),
    classification_system character varying(20),
    path public.ltree,
    canonical_name text DEFAULT ''::text NOT NULL,
    aliases text[] DEFAULT '{}'::text[] NOT NULL,
    effective_from date,
    source_ref text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT valid_level CHECK (((level)::text = ANY ((ARRAY['country'::character varying, 'region'::character varying, 'sub_region'::character varying, 'appellation'::character varying, 'commune'::character varying, 'vineyard'::character varying])::text[])))
);


--
-- Name: wine_unit_defaults; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wine_unit_defaults (
    wine_id character varying(50) NOT NULL,
    default_unit_type character varying(10) NOT NULL,
    bottles_per_case integer DEFAULT 12,
    notes text,
    updated_at timestamp without time zone DEFAULT now(),
    CONSTRAINT wine_unit_defaults_bottles_per_case_check CHECK ((bottles_per_case > 0)),
    CONSTRAINT wine_unit_defaults_default_unit_type_check CHECK (((default_unit_type)::text = ANY ((ARRAY['case'::character varying, 'bottle'::character varying])::text[])))
);


--
-- Name: _migrations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._migrations ALTER COLUMN id SET DEFAULT nextval('public._migrations_id_seq'::regclass);


--
-- Name: dead_letter_queue id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dead_letter_queue ALTER COLUMN id SET DEFAULT nextval('public.dead_letter_queue_id_seq'::regclass);


--
-- Name: event_schema_registry id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_schema_registry ALTER COLUMN id SET DEFAULT nextval('public.event_schema_registry_id_seq'::regclass);


--
-- Name: outbox id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbox ALTER COLUMN id SET DEFAULT nextval('public.outbox_id_seq'::regclass);


--
-- Name: _migrations _migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._migrations
    ADD CONSTRAINT _migrations_pkey PRIMARY KEY (id);


--
-- Name: _migrations _migrations_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._migrations
    ADD CONSTRAINT _migrations_version_key UNIQUE (version);


--
-- Name: ab_experiments ab_experiments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ab_experiments
    ADD CONSTRAINT ab_experiments_pkey PRIMARY KEY (id);


--
-- Name: agent_activity_logs agent_activity_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_activity_logs
    ADD CONSTRAINT agent_activity_logs_pkey PRIMARY KEY (id);


--
-- Name: agent_evolution_log agent_evolution_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_evolution_log
    ADD CONSTRAINT agent_evolution_log_pkey PRIMARY KEY (id);


--
-- Name: ai_feedback_loop ai_feedback_loop_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_feedback_loop
    ADD CONSTRAINT ai_feedback_loop_pkey PRIMARY KEY (id);


--
-- Name: analytics_cache analytics_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_cache
    ADD CONSTRAINT analytics_cache_pkey PRIMARY KEY (id);


--
-- Name: analytics_cache analytics_cache_restaurant_id_cache_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_cache
    ADD CONSTRAINT analytics_cache_restaurant_id_cache_key_key UNIQUE (restaurant_id, cache_key);


--
-- Name: analytics_goals analytics_goals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_goals
    ADD CONSTRAINT analytics_goals_pkey PRIMARY KEY (id);


--
-- Name: analytics_insight_prefs analytics_insight_prefs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_insight_prefs
    ADD CONSTRAINT analytics_insight_prefs_pkey PRIMARY KEY (restaurant_id, category);


--
-- Name: analytics_insights analytics_insights_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_insights
    ADD CONSTRAINT analytics_insights_pkey PRIMARY KEY (id);


--
-- Name: api_idempotency_keys api_idempotency_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_idempotency_keys
    ADD CONSTRAINT api_idempotency_keys_pkey PRIMARY KEY (key);


--
-- Name: api_spend api_spend_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_spend
    ADD CONSTRAINT api_spend_pkey PRIMARY KEY (id);


--
-- Name: appellation_rules appellation_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appellation_rules
    ADD CONSTRAINT appellation_rules_pkey PRIMARY KEY (id);


--
-- Name: batch_operations batch_operations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.batch_operations
    ADD CONSTRAINT batch_operations_pkey PRIMARY KEY (id);


--
-- Name: budgets budgets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budgets
    ADD CONSTRAINT budgets_pkey PRIMARY KEY (id);


--
-- Name: calendar_event_types calendar_event_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_event_types
    ADD CONSTRAINT calendar_event_types_pkey PRIMARY KEY (id);


--
-- Name: calendar_event_types calendar_event_types_restaurant_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_event_types
    ADD CONSTRAINT calendar_event_types_restaurant_id_name_key UNIQUE (restaurant_id, name);


--
-- Name: calendar_events calendar_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_events
    ADD CONSTRAINT calendar_events_pkey PRIMARY KEY (id);


--
-- Name: calendar_recurrence_exceptions calendar_recurrence_exceptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_recurrence_exceptions
    ADD CONSTRAINT calendar_recurrence_exceptions_pkey PRIMARY KEY (id);


--
-- Name: calendar_recurrence_rules calendar_recurrence_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_recurrence_rules
    ADD CONSTRAINT calendar_recurrence_rules_pkey PRIMARY KEY (id);


--
-- Name: check_scans check_scans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.check_scans
    ADD CONSTRAINT check_scans_pkey PRIMARY KEY (id);


--
-- Name: collection_metadata collection_metadata_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collection_metadata
    ADD CONSTRAINT collection_metadata_pkey PRIMARY KEY (id);


--
-- Name: communication_templates communication_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communication_templates
    ADD CONSTRAINT communication_templates_pkey PRIMARY KEY (id);


--
-- Name: confidence_thresholds confidence_thresholds_field_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.confidence_thresholds
    ADD CONSTRAINT confidence_thresholds_field_name_key UNIQUE (field_name);


--
-- Name: confidence_thresholds confidence_thresholds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.confidence_thresholds
    ADD CONSTRAINT confidence_thresholds_pkey PRIMARY KEY (id);


--
-- Name: contact_addresses contact_addresses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_addresses
    ADD CONSTRAINT contact_addresses_pkey PRIMARY KEY (id);


--
-- Name: contacts contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_pkey PRIMARY KEY (id);


--
-- Name: conversation_attachments conversation_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_attachments
    ADD CONSTRAINT conversation_attachments_pkey PRIMARY KEY (id);


--
-- Name: conversation_embeddings conversation_embeddings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_embeddings
    ADD CONSTRAINT conversation_embeddings_pkey PRIMARY KEY (id);


--
-- Name: coverage_templates coverage_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coverage_templates
    ADD CONSTRAINT coverage_templates_pkey PRIMARY KEY (id);


--
-- Name: crawl_log crawl_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crawl_log
    ADD CONSTRAINT crawl_log_pkey PRIMARY KEY (id);


--
-- Name: crawl_schedule crawl_schedule_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crawl_schedule
    ADD CONSTRAINT crawl_schedule_pkey PRIMARY KEY (id);


--
-- Name: custom_reminders custom_reminders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_reminders
    ADD CONSTRAINT custom_reminders_pkey PRIMARY KEY (id);


--
-- Name: dead_letter_queue dead_letter_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dead_letter_queue
    ADD CONSTRAINT dead_letter_queue_pkey PRIMARY KEY (id);


--
-- Name: decision_log decision_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.decision_log
    ADD CONSTRAINT decision_log_pkey PRIMARY KEY (id);


--
-- Name: email_prospects email_prospects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_prospects
    ADD CONSTRAINT email_prospects_pkey PRIMARY KEY (id);


--
-- Name: email_verifications email_verifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_verifications
    ADD CONSTRAINT email_verifications_pkey PRIMARY KEY (id);


--
-- Name: email_verifications email_verifications_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_verifications
    ADD CONSTRAINT email_verifications_token_key UNIQUE (token);


--
-- Name: email_watch_state email_watch_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_watch_state
    ADD CONSTRAINT email_watch_state_pkey PRIMARY KEY (id);


--
-- Name: email_watch_state email_watch_state_restaurant_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_watch_state
    ADD CONSTRAINT email_watch_state_restaurant_id_key UNIQUE (restaurant_id);


--
-- Name: enrichment_queue enrichment_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrichment_queue
    ADD CONSTRAINT enrichment_queue_pkey PRIMARY KEY (id);


--
-- Name: enrichment_queue enrichment_queue_wine_id_status_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrichment_queue
    ADD CONSTRAINT enrichment_queue_wine_id_status_key UNIQUE (wine_id, status);


--
-- Name: event_dead_letters event_dead_letters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_dead_letters
    ADD CONSTRAINT event_dead_letters_pkey PRIMARY KEY (id);


--
-- Name: event_replay_jobs event_replay_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_replay_jobs
    ADD CONSTRAINT event_replay_jobs_pkey PRIMARY KEY (id);


--
-- Name: event_schema_registry event_schema_registry_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_schema_registry
    ADD CONSTRAINT event_schema_registry_pkey PRIMARY KEY (id);


--
-- Name: event_store event_store_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_store
    ADD CONSTRAINT event_store_pkey PRIMARY KEY (event_id);


--
-- Name: events events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_pkey PRIMARY KEY (id);


--
-- Name: evidence_citations evidence_citations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evidence_citations
    ADD CONSTRAINT evidence_citations_pkey PRIMARY KEY (id);


--
-- Name: evidence_url_cache evidence_url_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evidence_url_cache
    ADD CONSTRAINT evidence_url_cache_pkey PRIMARY KEY (url);


--
-- Name: export_history export_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.export_history
    ADD CONSTRAINT export_history_pkey PRIMARY KEY (id);


--
-- Name: field_calibration field_calibration_field_name_confidence_bin_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.field_calibration
    ADD CONSTRAINT field_calibration_field_name_confidence_bin_key UNIQUE (field_name, confidence_bin);


--
-- Name: field_calibration field_calibration_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.field_calibration
    ADD CONSTRAINT field_calibration_pkey PRIMARY KEY (id);


--
-- Name: field_corrections field_corrections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.field_corrections
    ADD CONSTRAINT field_corrections_pkey PRIMARY KEY (id);


--
-- Name: field_review_queue field_review_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.field_review_queue
    ADD CONSTRAINT field_review_queue_pkey PRIMARY KEY (id);


--
-- Name: generated_reports generated_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generated_reports
    ADD CONSTRAINT generated_reports_pkey PRIMARY KEY (id);


--
-- Name: glass_pour_tracking glass_pour_tracking_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.glass_pour_tracking
    ADD CONSTRAINT glass_pour_tracking_pkey PRIMARY KEY (id);


--
-- Name: grape_varieties grape_varieties_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grape_varieties
    ADD CONSTRAINT grape_varieties_pkey PRIMARY KEY (id);


--
-- Name: idempotency_keys idempotency_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.idempotency_keys
    ADD CONSTRAINT idempotency_keys_pkey PRIMARY KEY (message_id);


--
-- Name: inventory_alert_state inventory_alert_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_alert_state
    ADD CONSTRAINT inventory_alert_state_pkey PRIMARY KEY (restaurant_id, inventory_id);


--
-- Name: inventory_events inventory_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_events
    ADD CONSTRAINT inventory_events_pkey PRIMARY KEY (id);


--
-- Name: inventory_lots inventory_lots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_lots
    ADD CONSTRAINT inventory_lots_pkey PRIMARY KEY (id);


--
-- Name: inventory_transactions inventory_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_transactions
    ADD CONSTRAINT inventory_transactions_pkey PRIMARY KEY (id);


--
-- Name: invite_tokens invite_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invite_tokens
    ADD CONSTRAINT invite_tokens_pkey PRIMARY KEY (id);


--
-- Name: invite_tokens invite_tokens_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invite_tokens
    ADD CONSTRAINT invite_tokens_token_key UNIQUE (token);


--
-- Name: invoice_scans invoice_scans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_scans
    ADD CONSTRAINT invoice_scans_pkey PRIMARY KEY (id);


--
-- Name: keyboard_shortcuts keyboard_shortcuts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.keyboard_shortcuts
    ADD CONSTRAINT keyboard_shortcuts_pkey PRIMARY KEY (id);


--
-- Name: keyboard_shortcuts keyboard_shortcuts_user_id_action_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.keyboard_shortcuts
    ADD CONSTRAINT keyboard_shortcuts_user_id_action_key UNIQUE (user_id, action);


--
-- Name: manager_preferences manager_preferences_manager_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manager_preferences
    ADD CONSTRAINT manager_preferences_manager_id_key UNIQUE (manager_id);


--
-- Name: manager_preferences manager_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manager_preferences
    ADD CONSTRAINT manager_preferences_pkey PRIMARY KEY (id);


--
-- Name: manager_report_profiles manager_report_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manager_report_profiles
    ADD CONSTRAINT manager_report_profiles_pkey PRIMARY KEY (id);


--
-- Name: manager_report_profiles manager_report_profiles_restaurant_id_manager_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manager_report_profiles
    ADD CONSTRAINT manager_report_profiles_restaurant_id_manager_id_key UNIQUE (restaurant_id, manager_id);


--
-- Name: master_wine_library master_wine_library_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.master_wine_library
    ADD CONSTRAINT master_wine_library_pkey PRIMARY KEY (id);


--
-- Name: master_wine_library master_wine_library_sequential_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.master_wine_library
    ADD CONSTRAINT master_wine_library_sequential_id_key UNIQUE (sequential_id);


--
-- Name: master_wine_library_submissions master_wine_library_submissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.master_wine_library_submissions
    ADD CONSTRAINT master_wine_library_submissions_pkey PRIMARY KEY (id);


--
-- Name: master_wine_library master_wine_library_wine_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.master_wine_library
    ADD CONSTRAINT master_wine_library_wine_id_key UNIQUE (wine_id);


--
-- Name: menu_changes menu_changes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.menu_changes
    ADD CONSTRAINT menu_changes_pkey PRIMARY KEY (id);


--
-- Name: menu_items menu_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.menu_items
    ADD CONSTRAINT menu_items_pkey PRIMARY KEY (id);


--
-- Name: message_templates message_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_templates
    ADD CONSTRAINT message_templates_pkey PRIMARY KEY (id);


--
-- Name: mobile_devices mobile_devices_expo_push_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mobile_devices
    ADD CONSTRAINT mobile_devices_expo_push_token_key UNIQUE (expo_push_token);


--
-- Name: mobile_devices mobile_devices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mobile_devices
    ADD CONSTRAINT mobile_devices_pkey PRIMARY KEY (id);


--
-- Name: negotiation_facts negotiation_facts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.negotiation_facts
    ADD CONSTRAINT negotiation_facts_pkey PRIMARY KEY (id);


--
-- Name: notification_deliveries notification_deliveries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_deliveries
    ADD CONSTRAINT notification_deliveries_pkey PRIMARY KEY (notification_id);


--
-- Name: notification_preferences notification_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_pkey PRIMARY KEY (id);


--
-- Name: notification_preferences notification_preferences_restaurant_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_restaurant_id_user_id_key UNIQUE (restaurant_id, user_id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: onboarding_sessions onboarding_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_sessions
    ADD CONSTRAINT onboarding_sessions_pkey PRIMARY KEY (id);


--
-- Name: one_tap_actions one_tap_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.one_tap_actions
    ADD CONSTRAINT one_tap_actions_pkey PRIMARY KEY (id);


--
-- Name: order_interactions order_interactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_interactions
    ADD CONSTRAINT order_interactions_pkey PRIMARY KEY (id);


--
-- Name: order_items order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_pkey PRIMARY KEY (id);


--
-- Name: organization_invites organization_invites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_invites
    ADD CONSTRAINT organization_invites_pkey PRIMARY KEY (id);


--
-- Name: organization_members organization_members_organization_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_members
    ADD CONSTRAINT organization_members_organization_id_user_id_key UNIQUE (organization_id, user_id);


--
-- Name: organization_members organization_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_members
    ADD CONSTRAINT organization_members_pkey PRIMARY KEY (id);


--
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);


--
-- Name: outbox outbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbox
    ADD CONSTRAINT outbox_pkey PRIMARY KEY (id);


--
-- Name: override_events override_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.override_events
    ADD CONSTRAINT override_events_pkey PRIMARY KEY (id);


--
-- Name: pos_checks pos_checks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_checks
    ADD CONSTRAINT pos_checks_pkey PRIMARY KEY (id);


--
-- Name: pos_item_mappings pos_item_mappings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_item_mappings
    ADD CONSTRAINT pos_item_mappings_pkey PRIMARY KEY (id);


--
-- Name: pour_events pour_events_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pour_events
    ADD CONSTRAINT pour_events_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: pour_events pour_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pour_events
    ADD CONSTRAINT pour_events_pkey PRIMARY KEY (id);


--
-- Name: prediction_outcomes prediction_outcomes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prediction_outcomes
    ADD CONSTRAINT prediction_outcomes_pkey PRIMARY KEY (id);


--
-- Name: price_history price_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_history
    ADD CONSTRAINT price_history_pkey PRIMARY KEY (id);


--
-- Name: procurement_conversations procurement_conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_conversations
    ADD CONSTRAINT procurement_conversations_pkey PRIMARY KEY (id);


--
-- Name: procurement_credits procurement_credits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_credits
    ADD CONSTRAINT procurement_credits_pkey PRIMARY KEY (id);


--
-- Name: procurement_document_lines procurement_document_lines_document_id_line_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_document_lines
    ADD CONSTRAINT procurement_document_lines_document_id_line_no_key UNIQUE (document_id, line_no);


--
-- Name: procurement_document_lines procurement_document_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_document_lines
    ADD CONSTRAINT procurement_document_lines_pkey PRIMARY KEY (id);


--
-- Name: procurement_document_links procurement_document_links_document_id_order_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_document_links
    ADD CONSTRAINT procurement_document_links_document_id_order_id_key UNIQUE (document_id, order_id);


--
-- Name: procurement_document_links procurement_document_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_document_links
    ADD CONSTRAINT procurement_document_links_pkey PRIMARY KEY (id);


--
-- Name: procurement_documents procurement_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_documents
    ADD CONSTRAINT procurement_documents_pkey PRIMARY KEY (id);


--
-- Name: procurement_order_items procurement_order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_order_items
    ADD CONSTRAINT procurement_order_items_pkey PRIMARY KEY (id);


--
-- Name: procurement_orders procurement_orders_order_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_orders
    ADD CONSTRAINT procurement_orders_order_number_key UNIQUE (order_number);


--
-- Name: procurement_orders procurement_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_orders
    ADD CONSTRAINT procurement_orders_pkey PRIMARY KEY (id);


--
-- Name: procurement_receipt_events procurement_receipt_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_receipt_events
    ADD CONSTRAINT procurement_receipt_events_pkey PRIMARY KEY (id);


--
-- Name: producers producers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.producers
    ADD CONSTRAINT producers_pkey PRIMARY KEY (id);


--
-- Name: profit_margins profit_margins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profit_margins
    ADD CONSTRAINT profit_margins_pkey PRIMARY KEY (id);


--
-- Name: profit_margins profit_margins_restaurant_id_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profit_margins
    ADD CONSTRAINT profit_margins_restaurant_id_date_key UNIQUE (restaurant_id, date);


--
-- Name: prompt_versions prompt_versions_agent_name_prompt_name_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prompt_versions
    ADD CONSTRAINT prompt_versions_agent_name_prompt_name_version_key UNIQUE (agent_name, prompt_name, version);


--
-- Name: prompt_versions prompt_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prompt_versions
    ADD CONSTRAINT prompt_versions_pkey PRIMARY KEY (id);


--
-- Name: provider_contacts provider_contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_contacts
    ADD CONSTRAINT provider_contacts_pkey PRIMARY KEY (id);


--
-- Name: provider_conversation_sessions provider_conversation_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_conversation_sessions
    ADD CONSTRAINT provider_conversation_sessions_pkey PRIMARY KEY (id);


--
-- Name: provider_knowledge provider_knowledge_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_knowledge
    ADD CONSTRAINT provider_knowledge_pkey PRIMARY KEY (id);


--
-- Name: provider_locations provider_locations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_locations
    ADD CONSTRAINT provider_locations_pkey PRIMARY KEY (id);


--
-- Name: provider_performance_metrics provider_performance_metrics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_performance_metrics
    ADD CONSTRAINT provider_performance_metrics_pkey PRIMARY KEY (id);


--
-- Name: provider_promotions provider_promotions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_promotions
    ADD CONSTRAINT provider_promotions_pkey PRIMARY KEY (id);


--
-- Name: provider_sentiment_history provider_sentiment_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_sentiment_history
    ADD CONSTRAINT provider_sentiment_history_pkey PRIMARY KEY (id);


--
-- Name: providers providers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.providers
    ADD CONSTRAINT providers_pkey PRIMARY KEY (id);


--
-- Name: recommendation_actions recommendation_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recommendation_actions
    ADD CONSTRAINT recommendation_actions_pkey PRIMARY KEY (id);


--
-- Name: recommendation_actions recommendation_actions_restaurant_id_rule_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recommendation_actions
    ADD CONSTRAINT recommendation_actions_restaurant_id_rule_key_key UNIQUE (restaurant_id, rule_key);


--
-- Name: recommendation_digest_prefs recommendation_digest_prefs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recommendation_digest_prefs
    ADD CONSTRAINT recommendation_digest_prefs_pkey PRIMARY KEY (restaurant_id);


--
-- Name: recurring_orders recurring_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recurring_orders
    ADD CONSTRAINT recurring_orders_pkey PRIMARY KEY (id);


--
-- Name: research_run_stats research_run_stats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_run_stats
    ADD CONSTRAINT research_run_stats_pkey PRIMARY KEY (id);


--
-- Name: research_runs research_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_runs
    ADD CONSTRAINT research_runs_pkey PRIMARY KEY (id);


--
-- Name: resolution_challenges resolution_challenges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resolution_challenges
    ADD CONSTRAINT resolution_challenges_pkey PRIMARY KEY (id);


--
-- Name: restaurant_branding restaurant_branding_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurant_branding
    ADD CONSTRAINT restaurant_branding_pkey PRIMARY KEY (id);


--
-- Name: restaurant_branding restaurant_branding_restaurant_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurant_branding
    ADD CONSTRAINT restaurant_branding_restaurant_id_key UNIQUE (restaurant_id);


--
-- Name: restaurant_chains restaurant_chains_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurant_chains
    ADD CONSTRAINT restaurant_chains_pkey PRIMARY KEY (id);


--
-- Name: restaurant_directory restaurant_directory_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurant_directory
    ADD CONSTRAINT restaurant_directory_pkey PRIMARY KEY (id);


--
-- Name: restaurant_feature_flags restaurant_feature_flags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurant_feature_flags
    ADD CONSTRAINT restaurant_feature_flags_pkey PRIMARY KEY (id);


--
-- Name: restaurant_feature_flags restaurant_feature_flags_restaurant_id_flag_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurant_feature_flags
    ADD CONSTRAINT restaurant_feature_flags_restaurant_id_flag_name_key UNIQUE (restaurant_id, flag_name);


--
-- Name: restaurant_inbound_addresses restaurant_inbound_addresses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurant_inbound_addresses
    ADD CONSTRAINT restaurant_inbound_addresses_pkey PRIMARY KEY (id);


--
-- Name: restaurant_inventory restaurant_inventory_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurant_inventory
    ADD CONSTRAINT restaurant_inventory_pkey PRIMARY KEY (id);


--
-- Name: restaurant_inventory restaurant_inventory_restaurant_id_master_wine_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurant_inventory
    ADD CONSTRAINT restaurant_inventory_restaurant_id_master_wine_id_key UNIQUE (restaurant_id, master_wine_id);


--
-- Name: restaurant_menus restaurant_menus_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurant_menus
    ADD CONSTRAINT restaurant_menus_pkey PRIMARY KEY (id);


--
-- Name: restaurant_providers restaurant_providers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurant_providers
    ADD CONSTRAINT restaurant_providers_pkey PRIMARY KEY (id);


--
-- Name: restaurant_providers restaurant_providers_restaurant_id_provider_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurant_providers
    ADD CONSTRAINT restaurant_providers_restaurant_id_provider_id_key UNIQUE (restaurant_id, provider_id);


--
-- Name: restaurant_tables restaurant_tables_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurant_tables
    ADD CONSTRAINT restaurant_tables_pkey PRIMARY KEY (id);


--
-- Name: restaurant_venue_profiles restaurant_venue_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurant_venue_profiles
    ADD CONSTRAINT restaurant_venue_profiles_pkey PRIMARY KEY (restaurant_id);


--
-- Name: restaurant_wine_roster restaurant_wine_roster_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurant_wine_roster
    ADD CONSTRAINT restaurant_wine_roster_pkey PRIMARY KEY (id);


--
-- Name: restaurants restaurants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurants
    ADD CONSTRAINT restaurants_pkey PRIMARY KEY (id);


--
-- Name: restaurants restaurants_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurants
    ADD CONSTRAINT restaurants_slug_key UNIQUE (slug);


--
-- Name: rfq_requests rfq_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rfq_requests
    ADD CONSTRAINT rfq_requests_pkey PRIMARY KEY (id);


--
-- Name: saga_state saga_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saga_state
    ADD CONSTRAINT saga_state_pkey PRIMARY KEY (saga_id);


--
-- Name: sales_events sales_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_events
    ADD CONSTRAINT sales_events_pkey PRIMARY KEY (id);


--
-- Name: schedule_receipts schedule_receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_receipts
    ADD CONSTRAINT schedule_receipts_pkey PRIMARY KEY (id);


--
-- Name: schedules schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedules
    ADD CONSTRAINT schedules_pkey PRIMARY KEY (id);


--
-- Name: sender_reputation sender_reputation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sender_reputation
    ADD CONSTRAINT sender_reputation_pkey PRIMARY KEY (id);


--
-- Name: server_sales server_sales_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.server_sales
    ADD CONSTRAINT server_sales_pkey PRIMARY KEY (id);


--
-- Name: shift_breaks shift_breaks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_breaks
    ADD CONSTRAINT shift_breaks_pkey PRIMARY KEY (id);


--
-- Name: shifts shifts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shifts
    ADD CONSTRAINT shifts_pkey PRIMARY KEY (id);


--
-- Name: sim_ground_truth_facts sim_ground_truth_facts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sim_ground_truth_facts
    ADD CONSTRAINT sim_ground_truth_facts_pkey PRIMARY KEY (id);


--
-- Name: sim_ground_truth_runs sim_ground_truth_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sim_ground_truth_runs
    ADD CONSTRAINT sim_ground_truth_runs_pkey PRIMARY KEY (id);


--
-- Name: sim_ground_truth_runs sim_ground_truth_runs_restaurant_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sim_ground_truth_runs
    ADD CONSTRAINT sim_ground_truth_runs_restaurant_id_key UNIQUE (restaurant_id);


--
-- Name: sku_mappings sku_mappings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sku_mappings
    ADD CONSTRAINT sku_mappings_pkey PRIMARY KEY (id);


--
-- Name: sku_mappings sku_mappings_restaurant_id_master_wine_id_sku_type_sku_valu_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sku_mappings
    ADD CONSTRAINT sku_mappings_restaurant_id_master_wine_id_sku_type_sku_valu_key UNIQUE (restaurant_id, master_wine_id, sku_type, sku_value);


--
-- Name: sommelier_conversations sommelier_conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sommelier_conversations
    ADD CONSTRAINT sommelier_conversations_pkey PRIMARY KEY (id);


--
-- Name: spend_alert_state spend_alert_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spend_alert_state
    ADD CONSTRAINT spend_alert_state_pkey PRIMARY KEY (id);


--
-- Name: spend_alert_state spend_alert_state_provider_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spend_alert_state
    ADD CONSTRAINT spend_alert_state_provider_key UNIQUE (provider);


--
-- Name: storage_locations storage_locations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storage_locations
    ADD CONSTRAINT storage_locations_pkey PRIMARY KEY (id);


--
-- Name: supplier_catalogs supplier_catalogs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_catalogs
    ADD CONSTRAINT supplier_catalogs_pkey PRIMARY KEY (id);


--
-- Name: swap_requests swap_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.swap_requests
    ADD CONSTRAINT swap_requests_pkey PRIMARY KEY (id);


--
-- Name: system_audit_log system_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_audit_log
    ADD CONSTRAINT system_audit_log_pkey PRIMARY KEY (id);


--
-- Name: system_learning_state system_learning_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_learning_state
    ADD CONSTRAINT system_learning_state_pkey PRIMARY KEY (id);


--
-- Name: team_availability team_availability_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_availability
    ADD CONSTRAINT team_availability_pkey PRIMARY KEY (id);


--
-- Name: team_certifications team_certifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_certifications
    ADD CONSTRAINT team_certifications_pkey PRIMARY KEY (id);


--
-- Name: team_members team_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_members
    ADD CONSTRAINT team_members_pkey PRIMARY KEY (id);


--
-- Name: team_settings team_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_settings
    ADD CONSTRAINT team_settings_pkey PRIMARY KEY (restaurant_id);


--
-- Name: time_off_requests time_off_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_off_requests
    ADD CONSTRAINT time_off_requests_pkey PRIMARY KEY (id);


--
-- Name: toast_item_mappings toast_item_mappings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.toast_item_mappings
    ADD CONSTRAINT toast_item_mappings_pkey PRIMARY KEY (id);


--
-- Name: toast_item_mappings toast_item_mappings_restaurant_id_toast_guid_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.toast_item_mappings
    ADD CONSTRAINT toast_item_mappings_restaurant_id_toast_guid_key UNIQUE (restaurant_id, toast_guid);


--
-- Name: training_datasets training_datasets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_datasets
    ADD CONSTRAINT training_datasets_pkey PRIMARY KEY (id);


--
-- Name: trending_wines trending_wines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trending_wines
    ADD CONSTRAINT trending_wines_pkey PRIMARY KEY (id);


--
-- Name: unit_conversions unit_conversions_from_unit_to_unit_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_conversions
    ADD CONSTRAINT unit_conversions_from_unit_to_unit_key UNIQUE (from_unit, to_unit);


--
-- Name: unit_conversions unit_conversions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_conversions
    ADD CONSTRAINT unit_conversions_pkey PRIMARY KEY (id);


--
-- Name: crawl_schedule uq_crawl_schedule_restaurant; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crawl_schedule
    ADD CONSTRAINT uq_crawl_schedule_restaurant UNIQUE (restaurant_id);


--
-- Name: event_store uq_event_store_aggregate_sequence; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_store
    ADD CONSTRAINT uq_event_store_aggregate_sequence UNIQUE (aggregate_type, aggregate_id, sequence_number);


--
-- Name: events uq_events_idempotency; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT uq_events_idempotency UNIQUE (restaurant_id, idempotency_key);


--
-- Name: calendar_recurrence_exceptions uq_exception_date; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_recurrence_exceptions
    ADD CONSTRAINT uq_exception_date UNIQUE (recurrence_rule_id, original_date);


--
-- Name: inventory_events uq_inventory_events_idempotency; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_events
    ADD CONSTRAINT uq_inventory_events_idempotency UNIQUE (idempotency_key);


--
-- Name: restaurant_directory uq_restaurant_city; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurant_directory
    ADD CONSTRAINT uq_restaurant_city UNIQUE (restaurant_name, city);


--
-- Name: restaurant_wine_roster uq_roster_restaurant_hash; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurant_wine_roster
    ADD CONSTRAINT uq_roster_restaurant_hash UNIQUE (restaurant_id, signature_hash);


--
-- Name: event_schema_registry uq_schema_version; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_schema_registry
    ADD CONSTRAINT uq_schema_version UNIQUE (event_type, schema_version);


--
-- Name: trending_wines uq_trending_wines; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trending_wines
    ADD CONSTRAINT uq_trending_wines UNIQUE (wine_id, window_days);


--
-- Name: wine_popularity uq_wine_popularity; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wine_popularity
    ADD CONSTRAINT uq_wine_popularity UNIQUE (wine_id);


--
-- Name: user_oauth_accounts user_oauth_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_oauth_accounts
    ADD CONSTRAINT user_oauth_accounts_pkey PRIMARY KEY (id);


--
-- Name: user_oauth_accounts user_oauth_accounts_provider_provider_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_oauth_accounts
    ADD CONSTRAINT user_oauth_accounts_provider_provider_user_id_key UNIQUE (provider, provider_user_id);


--
-- Name: user_oauth_accounts user_oauth_accounts_user_id_provider_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_oauth_accounts
    ADD CONSTRAINT user_oauth_accounts_user_id_provider_key UNIQUE (user_id, provider);


--
-- Name: user_onboarding_progress user_onboarding_progress_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_onboarding_progress
    ADD CONSTRAINT user_onboarding_progress_pkey PRIMARY KEY (id);


--
-- Name: user_onboarding_progress user_onboarding_progress_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_onboarding_progress
    ADD CONSTRAINT user_onboarding_progress_user_id_key UNIQUE (user_id);


--
-- Name: user_preferences user_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_preferences
    ADD CONSTRAINT user_preferences_pkey PRIMARY KEY (id);


--
-- Name: user_preferences user_preferences_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_preferences
    ADD CONSTRAINT user_preferences_user_id_key UNIQUE (user_id);


--
-- Name: user_restaurant_access user_restaurant_access_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_restaurant_access
    ADD CONSTRAINT user_restaurant_access_pkey PRIMARY KEY (id);


--
-- Name: user_restaurant_access user_restaurant_access_user_id_restaurant_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_restaurant_access
    ADD CONSTRAINT user_restaurant_access_user_id_restaurant_id_key UNIQUE (user_id, restaurant_id);


--
-- Name: user_roles user_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id);


--
-- Name: user_roles user_roles_user_id_role_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_role_key UNIQUE (user_id, role);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (user_id);


--
-- Name: ux_learnings ux_learnings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ux_learnings
    ADD CONSTRAINT ux_learnings_pkey PRIMARY KEY (id);


--
-- Name: ux_overrides ux_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ux_overrides
    ADD CONSTRAINT ux_overrides_pkey PRIMARY KEY (id);


--
-- Name: ux_overrides ux_overrides_rest_page_target_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ux_overrides
    ADD CONSTRAINT ux_overrides_rest_page_target_uniq UNIQUE NULLS NOT DISTINCT (restaurant_id, page, target_key);


--
-- Name: ux_proposals ux_proposals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ux_proposals
    ADD CONSTRAINT ux_proposals_pkey PRIMARY KEY (id);


--
-- Name: ux_signals ux_signals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ux_signals
    ADD CONSTRAINT ux_signals_pkey PRIMARY KEY (id);


--
-- Name: vendor_catalogue vendor_catalogue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_catalogue
    ADD CONSTRAINT vendor_catalogue_pkey PRIMARY KEY (id);


--
-- Name: vendor_deadlines vendor_deadlines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_deadlines
    ADD CONSTRAINT vendor_deadlines_pkey PRIMARY KEY (id);


--
-- Name: vendor_promotions vendor_promotions_dedup_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_promotions
    ADD CONSTRAINT vendor_promotions_dedup_hash_key UNIQUE (dedup_hash);


--
-- Name: vendor_promotions vendor_promotions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_promotions
    ADD CONSTRAINT vendor_promotions_pkey PRIMARY KEY (id);


--
-- Name: vintage_rules vintage_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vintage_rules
    ADD CONSTRAINT vintage_rules_pkey PRIMARY KEY (id);


--
-- Name: vintage_substitution_rules vintage_substitution_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vintage_substitution_rules
    ADD CONSTRAINT vintage_substitution_rules_pkey PRIMARY KEY (id);


--
-- Name: vintage_substitution_rules vintage_substitution_rules_restaurant_id_master_wine_id_pri_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vintage_substitution_rules
    ADD CONSTRAINT vintage_substitution_rules_restaurant_id_master_wine_id_pri_key UNIQUE (restaurant_id, master_wine_id, primary_vintage);


--
-- Name: wine_acquisition_details wine_acquisition_details_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wine_acquisition_details
    ADD CONSTRAINT wine_acquisition_details_pkey PRIMARY KEY (wine_id);


--
-- Name: wine_aliases wine_aliases_canonical_id_alias_name_normalized_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wine_aliases
    ADD CONSTRAINT wine_aliases_canonical_id_alias_name_normalized_key UNIQUE (canonical_id, alias_name_normalized);


--
-- Name: wine_aliases wine_aliases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wine_aliases
    ADD CONSTRAINT wine_aliases_pkey PRIMARY KEY (id);


--
-- Name: wine_consumption_log wine_consumption_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wine_consumption_log
    ADD CONSTRAINT wine_consumption_log_pkey PRIMARY KEY (id);


--
-- Name: wine_location_mappings wine_location_mappings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wine_location_mappings
    ADD CONSTRAINT wine_location_mappings_pkey PRIMARY KEY (id);


--
-- Name: wine_menu_prices wine_menu_prices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wine_menu_prices
    ADD CONSTRAINT wine_menu_prices_pkey PRIMARY KEY (id);


--
-- Name: wine_popularity wine_popularity_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wine_popularity
    ADD CONSTRAINT wine_popularity_pkey PRIMARY KEY (id);


--
-- Name: wine_regions wine_regions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wine_regions
    ADD CONSTRAINT wine_regions_pkey PRIMARY KEY (id);


--
-- Name: wine_unit_defaults wine_unit_defaults_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wine_unit_defaults
    ADD CONSTRAINT wine_unit_defaults_pkey PRIMARY KEY (wine_id);


--
-- Name: appellation_rules_allowed_grapes_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appellation_rules_allowed_grapes_idx ON public.appellation_rules USING gin (allowed_grapes);


--
-- Name: appellation_rules_appellation_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appellation_rules_appellation_id_idx ON public.appellation_rules USING btree (appellation_id);


--
-- Name: appellation_rules_appellation_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appellation_rules_appellation_name_idx ON public.appellation_rules USING btree (appellation_name);


--
-- Name: appellation_rules_required_grapes_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appellation_rules_required_grapes_idx ON public.appellation_rules USING gin (required_grapes);


--
-- Name: grape_varieties_aliases_gin_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grape_varieties_aliases_gin_idx ON public.grape_varieties USING gin (aliases);


--
-- Name: grape_varieties_canonical_name_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX grape_varieties_canonical_name_key ON public.grape_varieties USING btree (canonical_name);


--
-- Name: grape_varieties_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grape_varieties_name_idx ON public.grape_varieties USING btree (name);


--
-- Name: idx_ab_experiments_agent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ab_experiments_agent ON public.ab_experiments USING btree (agent_name, status);


--
-- Name: idx_addresses_channel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_addresses_channel ON public.contact_addresses USING btree (channel);


--
-- Name: idx_addresses_contact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_addresses_contact ON public.contact_addresses USING btree (contact_id);


--
-- Name: idx_addresses_primary; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_addresses_primary ON public.contact_addresses USING btree (contact_id, is_primary) WHERE (is_primary = true);


--
-- Name: idx_addresses_unique_primary; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_addresses_unique_primary ON public.contact_addresses USING btree (contact_id, channel) WHERE (is_primary = true);


--
-- Name: idx_addresses_value; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_addresses_value ON public.contact_addresses USING btree (address_value);


--
-- Name: idx_agent_activity_logs_agent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_activity_logs_agent ON public.agent_activity_logs USING btree (agent_name);


--
-- Name: idx_agent_activity_logs_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_activity_logs_created ON public.agent_activity_logs USING btree (created_at DESC);


--
-- Name: idx_agent_activity_logs_edge_cases; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_activity_logs_edge_cases ON public.agent_activity_logs USING btree (edge_case_detected) WHERE (edge_case_detected = true);


--
-- Name: idx_agent_activity_logs_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_activity_logs_restaurant ON public.agent_activity_logs USING btree (restaurant_id);


--
-- Name: idx_agent_activity_logs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_activity_logs_status ON public.agent_activity_logs USING btree (status);


--
-- Name: idx_agg_daily_pk; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_agg_daily_pk ON public.event_aggregates_daily USING btree (restaurant_id, day, event_type);


--
-- Name: idx_agg_hourly_pk; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_agg_hourly_pk ON public.event_aggregates_hourly USING btree (restaurant_id, hour, event_type, source_page);


--
-- Name: idx_analytics_cache_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_analytics_cache_expires ON public.analytics_cache USING btree (expires_at);


--
-- Name: idx_analytics_cache_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_analytics_cache_key ON public.analytics_cache USING btree (cache_key);


--
-- Name: idx_analytics_cache_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_analytics_cache_restaurant ON public.analytics_cache USING btree (restaurant_id);


--
-- Name: idx_analytics_goals_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_analytics_goals_restaurant ON public.analytics_goals USING btree (restaurant_id, status);


--
-- Name: idx_analytics_insights_computed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_analytics_insights_computed ON public.analytics_insights USING btree (restaurant_id, computed_at DESC);


--
-- Name: idx_analytics_insights_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_analytics_insights_restaurant ON public.analytics_insights USING btree (restaurant_id, category, score DESC);


--
-- Name: idx_api_idempotency_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_api_idempotency_created ON public.api_idempotency_keys USING btree (created_at);


--
-- Name: idx_api_spend_provider_timestamp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_api_spend_provider_timestamp ON public.api_spend USING btree (provider, "timestamp");


--
-- Name: idx_api_spend_restaurant_timestamp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_api_spend_restaurant_timestamp ON public.api_spend USING btree (restaurant_id, "timestamp") WHERE (restaurant_id IS NOT NULL);


--
-- Name: idx_batch_operations_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_batch_operations_created ON public.batch_operations USING btree (created_at DESC);


--
-- Name: idx_batch_operations_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_batch_operations_restaurant ON public.batch_operations USING btree (restaurant_id);


--
-- Name: idx_batch_operations_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_batch_operations_type ON public.batch_operations USING btree (operation_type);


--
-- Name: idx_budgets_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_budgets_active ON public.budgets USING btree (status) WHERE ((status)::text = 'active'::text);


--
-- Name: idx_budgets_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_budgets_period ON public.budgets USING btree (period_start, period_end);


--
-- Name: idx_budgets_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_budgets_restaurant ON public.budgets USING btree (restaurant_id);


--
-- Name: idx_calendar_event_types_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_calendar_event_types_restaurant ON public.calendar_event_types USING btree (restaurant_id);


--
-- Name: idx_calendar_events_approved_by_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_calendar_events_approved_by_date ON public.calendar_events USING btree (restaurant_id, event_date) WHERE ((status)::text = 'approved'::text);


--
-- Name: idx_calendar_events_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_calendar_events_date ON public.calendar_events USING btree (event_date);


--
-- Name: idx_calendar_events_occurrence; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_calendar_events_occurrence ON public.calendar_events USING btree (restaurant_id, occurrence_date) WHERE (occurrence_date IS NOT NULL);


--
-- Name: idx_calendar_events_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_calendar_events_parent ON public.calendar_events USING btree (parent_event_id) WHERE (parent_event_id IS NOT NULL);


--
-- Name: idx_calendar_events_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_calendar_events_provider ON public.calendar_events USING btree (provider_id);


--
-- Name: idx_calendar_events_recurring; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_calendar_events_recurring ON public.calendar_events USING btree (restaurant_id, is_recurring) WHERE (is_recurring = true);


--
-- Name: idx_calendar_events_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_calendar_events_restaurant ON public.calendar_events USING btree (restaurant_id);


--
-- Name: idx_calendar_events_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_calendar_events_type ON public.calendar_events USING btree (event_type);


--
-- Name: idx_ce_embedding_hnsw; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ce_embedding_hnsw ON public.conversation_embeddings USING hnsw (embedding public.vector_cosine_ops) WITH (m='16', ef_construction='64');


--
-- Name: idx_ce_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ce_provider ON public.conversation_embeddings USING btree (provider_id);


--
-- Name: idx_ce_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ce_restaurant ON public.conversation_embeddings USING btree (restaurant_id);


--
-- Name: idx_ce_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ce_session ON public.conversation_embeddings USING btree (session_id);


--
-- Name: idx_ce_signal; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ce_signal ON public.conversation_embeddings USING btree (provider_id) WHERE ((has_signal = true) AND (sensitive = false));


--
-- Name: idx_challenges_open; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_challenges_open ON public.resolution_challenges USING btree (status) WHERE ((status)::text = 'open'::text);


--
-- Name: idx_challenges_submission; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_challenges_submission ON public.resolution_challenges USING btree (submission_id);


--
-- Name: idx_check_scans_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_check_scans_date ON public.check_scans USING btree (scan_date);


--
-- Name: idx_check_scans_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_check_scans_restaurant ON public.check_scans USING btree (restaurant_id);


--
-- Name: idx_cl_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cl_restaurant ON public.crawl_log USING btree (restaurant_id);


--
-- Name: idx_cl_visited_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cl_visited_at ON public.crawl_log USING btree (visited_at);


--
-- Name: idx_collection_annotated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_collection_annotated ON public.collection_metadata USING btree (annotated) WHERE (annotated = false);


--
-- Name: idx_collection_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_collection_category ON public.collection_metadata USING btree (category);


--
-- Name: idx_collection_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_collection_hash ON public.collection_metadata USING btree (perceptual_hash);


--
-- Name: idx_collection_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_collection_source ON public.collection_metadata USING btree (source);


--
-- Name: idx_comm_templates_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_comm_templates_restaurant ON public.communication_templates USING btree (restaurant_id);


--
-- Name: idx_comm_templates_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_comm_templates_type ON public.communication_templates USING btree (type);


--
-- Name: idx_consumption_inventory; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_consumption_inventory ON public.wine_consumption_log USING btree (inventory_id);


--
-- Name: idx_consumption_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_consumption_restaurant ON public.wine_consumption_log USING btree (restaurant_id, recorded_at DESC);


--
-- Name: idx_consumption_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_consumption_type ON public.wine_consumption_log USING btree (consumption_type);


--
-- Name: idx_contacts_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contacts_active ON public.contacts USING btree (is_active) WHERE (is_active = true);


--
-- Name: idx_contacts_linked_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contacts_linked_provider ON public.contacts USING btree (linked_provider_id) WHERE (linked_provider_id IS NOT NULL);


--
-- Name: idx_contacts_linked_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contacts_linked_user ON public.contacts USING btree (linked_user_id) WHERE (linked_user_id IS NOT NULL);


--
-- Name: idx_contacts_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contacts_name_trgm ON public.contacts USING gin (display_name public.gin_trgm_ops);


--
-- Name: idx_contacts_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contacts_restaurant ON public.contacts USING btree (restaurant_id) WHERE (restaurant_id IS NOT NULL);


--
-- Name: idx_contacts_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contacts_type ON public.contacts USING btree (type);


--
-- Name: idx_contacts_type_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contacts_type_restaurant ON public.contacts USING btree (type, restaurant_id);


--
-- Name: idx_conv_attach_conversation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conv_attach_conversation ON public.conversation_attachments USING btree (conversation_id);


--
-- Name: idx_conv_attach_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conv_attach_order ON public.conversation_attachments USING btree (order_id);


--
-- Name: idx_conv_attach_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conv_attach_restaurant ON public.conversation_attachments USING btree (restaurant_id);


--
-- Name: idx_conv_restaurant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conv_restaurant_id ON public.procurement_conversations USING btree (restaurant_id);


--
-- Name: idx_conv_status_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conv_status_restaurant ON public.procurement_conversations USING btree (restaurant_id, status) WHERE (status IS NOT NULL);


--
-- Name: idx_conversations_channel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_channel ON public.procurement_conversations USING btree (channel);


--
-- Name: idx_conversations_content_text_search; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_content_text_search ON public.procurement_conversations USING gin (to_tsvector('english'::regconfig, COALESCE(content, ''::text)));


--
-- Name: idx_conversations_direction; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_direction ON public.procurement_conversations USING btree (direction);


--
-- Name: idx_conversations_message_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_message_id ON public.procurement_conversations USING btree (message_id);


--
-- Name: idx_conversations_order_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_order_date ON public.procurement_conversations USING btree (order_id, created_at DESC);


--
-- Name: idx_conversations_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_order_id ON public.procurement_conversations USING btree (order_id, created_at);


--
-- Name: idx_conversations_provider_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_provider_date ON public.procurement_conversations USING btree (provider_id, created_at);


--
-- Name: idx_conversations_thread_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_thread_id ON public.procurement_conversations USING btree (thread_id, created_at);


--
-- Name: idx_coverage_templates_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coverage_templates_restaurant ON public.coverage_templates USING btree (restaurant_id);


--
-- Name: idx_cs_next_crawl; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cs_next_crawl ON public.crawl_schedule USING btree (next_crawl_at, status);


--
-- Name: idx_decision_log_agent_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_decision_log_agent_created ON public.decision_log USING btree (agent_name, created_at DESC);


--
-- Name: idx_decision_log_correlation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_decision_log_correlation ON public.decision_log USING btree (correlation_id);


--
-- Name: idx_dlq_agent_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dlq_agent_created ON public.dead_letter_queue USING btree (agent_name, created_at DESC);


--
-- Name: idx_dlq_error_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dlq_error_code ON public.event_dead_letters USING btree (error_code);


--
-- Name: idx_dlq_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dlq_restaurant ON public.event_dead_letters USING btree (restaurant_id, failed_at DESC);


--
-- Name: idx_dlq_status_retry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dlq_status_retry ON public.event_dead_letters USING btree (status, next_retry_at) WHERE (status = ANY (ARRAY['pending'::public.dlq_status, 'retrying'::public.dlq_status]));


--
-- Name: idx_dlq_unresolved; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dlq_unresolved ON public.dead_letter_queue USING btree (created_at) WHERE (resolved_at IS NULL);


--
-- Name: idx_email_verifications_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_verifications_token ON public.email_verifications USING btree (token);


--
-- Name: idx_email_verifications_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_verifications_user ON public.email_verifications USING btree (user_id);


--
-- Name: idx_enrichment_queue_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_enrichment_queue_status ON public.enrichment_queue USING btree (status, queued_at) WHERE (status = ANY (ARRAY['queued'::text, 'in_progress'::text]));


--
-- Name: idx_enrichment_queue_wine; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_enrichment_queue_wine ON public.enrichment_queue USING btree (wine_id);


--
-- Name: idx_event_store_aggregate; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_store_aggregate ON public.event_store USING btree (aggregate_type, aggregate_id, sequence_number);


--
-- Name: idx_events_archive_candidates; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_events_archive_candidates ON public.events USING btree (created_at) WHERE (is_archive_candidate = true);


--
-- Name: idx_events_correlation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_events_correlation ON public.events USING btree (correlation_id) WHERE (correlation_id IS NOT NULL);


--
-- Name: idx_events_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_events_created ON public.events USING btree (created_at DESC);


--
-- Name: idx_events_not_archived; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_events_not_archived ON public.events USING btree (restaurant_id, created_at DESC) WHERE (archived_at IS NULL);


--
-- Name: idx_events_recent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_events_recent ON public.events USING btree (restaurant_id, created_at DESC) WHERE (is_recent = true);


--
-- Name: idx_events_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_events_restaurant ON public.events USING btree (restaurant_id);


--
-- Name: idx_events_restaurant_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_events_restaurant_created ON public.events USING btree (restaurant_id, created_at DESC);


--
-- Name: idx_events_restaurant_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_events_restaurant_type ON public.events USING btree (restaurant_id, event_type);


--
-- Name: idx_events_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_events_source ON public.events USING btree (source_page);


--
-- Name: idx_events_trace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_events_trace ON public.events USING btree (trace_id) WHERE (trace_id IS NOT NULL);


--
-- Name: idx_events_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_events_type ON public.events USING btree (event_type);


--
-- Name: idx_evidence_citations_field; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_evidence_citations_field ON public.evidence_citations USING btree (wine_id, field_name);


--
-- Name: idx_evidence_citations_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_evidence_citations_run ON public.evidence_citations USING btree (run_id);


--
-- Name: idx_evidence_citations_tier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_evidence_citations_tier ON public.evidence_citations USING btree (source_tier, fetch_verified);


--
-- Name: idx_evidence_citations_wine; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_evidence_citations_wine ON public.evidence_citations USING btree (wine_id);


--
-- Name: idx_evolution_log_agent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_evolution_log_agent ON public.agent_evolution_log USING btree (agent_name, created_at DESC);


--
-- Name: idx_export_history_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_export_history_created ON public.export_history USING btree (created_at DESC);


--
-- Name: idx_export_history_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_export_history_restaurant ON public.export_history USING btree (restaurant_id);


--
-- Name: idx_export_history_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_export_history_user ON public.export_history USING btree (user_id);


--
-- Name: idx_feedback_agent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_feedback_agent ON public.ai_feedback_loop USING btree (agent_name, created_at DESC);


--
-- Name: idx_feedback_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_feedback_restaurant ON public.ai_feedback_loop USING btree (restaurant_id);


--
-- Name: idx_feedback_signal; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_feedback_signal ON public.ai_feedback_loop USING btree (improvement_signal) WHERE (improvement_signal < (0)::double precision);


--
-- Name: idx_field_corrections_field_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_field_corrections_field_name ON public.field_corrections USING btree (field_name);


--
-- Name: idx_field_corrections_submission; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_field_corrections_submission ON public.field_corrections USING btree (submission_id);


--
-- Name: idx_field_review_queue_field; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_field_review_queue_field ON public.field_review_queue USING btree (field_name, status);


--
-- Name: idx_field_review_queue_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_field_review_queue_status ON public.field_review_queue USING btree (status) WHERE ((status)::text = 'pending'::text);


--
-- Name: idx_field_review_queue_submission; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_field_review_queue_submission ON public.field_review_queue USING btree (submission_id);


--
-- Name: idx_generated_reports_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_generated_reports_created ON public.generated_reports USING btree (created_at DESC);


--
-- Name: idx_generated_reports_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_generated_reports_period ON public.generated_reports USING btree (report_period_start, report_period_end);


--
-- Name: idx_generated_reports_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_generated_reports_restaurant ON public.generated_reports USING btree (restaurant_id);


--
-- Name: idx_generated_reports_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_generated_reports_type ON public.generated_reports USING btree (report_type);


--
-- Name: idx_glass_pour_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_glass_pour_restaurant ON public.glass_pour_tracking USING btree (restaurant_id, bottle_opened_at DESC);


--
-- Name: idx_glass_pour_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_glass_pour_status ON public.glass_pour_tracking USING btree (status) WHERE ((status)::text = 'OPEN'::text);


--
-- Name: idx_idempotency_keys_agent_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_idempotency_keys_agent_name ON public.idempotency_keys USING btree (agent_name, processed_at DESC);


--
-- Name: idx_idempotency_keys_expires_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_idempotency_keys_expires_at ON public.idempotency_keys USING btree (expires_at);


--
-- Name: idx_inv_txn_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inv_txn_date ON public.inventory_transactions USING btree (transaction_date DESC);


--
-- Name: idx_inv_txn_inventory; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inv_txn_inventory ON public.inventory_transactions USING btree (inventory_id);


--
-- Name: idx_inv_txn_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inv_txn_order ON public.inventory_transactions USING btree (order_id) WHERE (order_id IS NOT NULL);


--
-- Name: idx_inv_txn_pos; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inv_txn_pos ON public.inventory_transactions USING btree (pos_transaction_id) WHERE (pos_transaction_id IS NOT NULL);


--
-- Name: idx_inv_txn_reference; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inv_txn_reference ON public.inventory_transactions USING btree (reference_type, reference_id) WHERE (reference_id IS NOT NULL);


--
-- Name: idx_inv_txn_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inv_txn_restaurant ON public.inventory_transactions USING btree (restaurant_id);


--
-- Name: idx_inv_txn_restaurant_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inv_txn_restaurant_date ON public.inventory_transactions USING btree (restaurant_id, transaction_date DESC);


--
-- Name: idx_inv_txn_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inv_txn_source ON public.inventory_transactions USING btree (source);


--
-- Name: idx_inv_txn_summary_pk; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_inv_txn_summary_pk ON public.inventory_transaction_summary USING btree (restaurant_id, wine_id, inventory_id, day, transaction_type, source);


--
-- Name: idx_inv_txn_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inv_txn_type ON public.inventory_transactions USING btree (transaction_type);


--
-- Name: idx_inv_txn_wine; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inv_txn_wine ON public.inventory_transactions USING btree (wine_id);


--
-- Name: idx_inventory_alert_state_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_alert_state_restaurant ON public.inventory_alert_state USING btree (restaurant_id, last_alert_level);


--
-- Name: idx_inventory_events_master; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_events_master ON public.inventory_events USING btree (master_wine_id) WHERE (master_wine_id IS NOT NULL);


--
-- Name: idx_inventory_events_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_events_restaurant ON public.inventory_events USING btree (restaurant_id, created_at);


--
-- Name: idx_inventory_lots_inv; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_lots_inv ON public.inventory_lots USING btree (inventory_id);


--
-- Name: idx_inventory_lots_loc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_lots_loc ON public.inventory_lots USING btree (location_id);


--
-- Name: idx_inventory_lots_ri; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_lots_ri ON public.inventory_lots USING btree (restaurant_id, master_wine_id);


--
-- Name: idx_invite_tokens_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invite_tokens_created_by ON public.invite_tokens USING btree (created_by);


--
-- Name: idx_invite_tokens_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invite_tokens_token ON public.invite_tokens USING btree (token) WHERE (used_at IS NULL);


--
-- Name: idx_invoice_scans_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoice_scans_provider ON public.invoice_scans USING btree (provider_id);


--
-- Name: idx_invoice_scans_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoice_scans_restaurant ON public.invoice_scans USING btree (restaurant_id);


--
-- Name: idx_invoice_scans_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoice_scans_status ON public.invoice_scans USING btree (ocr_status);


--
-- Name: idx_keyboard_shortcuts_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_keyboard_shortcuts_user ON public.keyboard_shortcuts USING btree (user_id);


--
-- Name: idx_learning_state_model; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_learning_state_model ON public.system_learning_state USING btree (model_name, status);


--
-- Name: idx_manager_preferences_manager; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_manager_preferences_manager ON public.manager_preferences USING btree (manager_id);


--
-- Name: idx_manager_report_profiles_manager; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_manager_report_profiles_manager ON public.manager_report_profiles USING btree (manager_id);


--
-- Name: idx_manager_report_profiles_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_manager_report_profiles_restaurant ON public.manager_report_profiles USING btree (restaurant_id);


--
-- Name: idx_master_wine_library_barcode; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_master_wine_library_barcode ON public.master_wine_library USING btree (barcode) WHERE (barcode IS NOT NULL);


--
-- Name: idx_master_wine_library_canonical; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_master_wine_library_canonical ON public.master_wine_library USING btree (canonical_name_verified) WHERE (canonical_name_verified = true);


--
-- Name: idx_master_wine_library_country_region; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_master_wine_library_country_region ON public.master_wine_library USING btree (country, region);


--
-- Name: idx_master_wine_library_deleted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_master_wine_library_deleted_at ON public.master_wine_library USING btree (deleted_at) WHERE (deleted_at IS NULL);


--
-- Name: idx_master_wine_library_distributor_skus; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_master_wine_library_distributor_skus ON public.master_wine_library USING gin (distributor_skus);


--
-- Name: idx_master_wine_library_ean; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_master_wine_library_ean ON public.master_wine_library USING btree (ean) WHERE (ean IS NOT NULL);


--
-- Name: idx_master_wine_library_embedding; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_master_wine_library_embedding ON public.master_wine_library USING ivfflat (embedding public.vector_cosine_ops) WITH (lists='100');


--
-- Name: idx_master_wine_library_manufacturer_sku; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_master_wine_library_manufacturer_sku ON public.master_wine_library USING btree (manufacturer_sku) WHERE (manufacturer_sku IS NOT NULL);


--
-- Name: idx_master_wine_library_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_master_wine_library_name ON public.master_wine_library USING btree (name);


--
-- Name: idx_master_wine_library_normalized_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_master_wine_library_normalized_name ON public.master_wine_library USING btree (normalized_name) WHERE (normalized_name IS NOT NULL);


--
-- Name: idx_master_wine_library_normalized_producer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_master_wine_library_normalized_producer ON public.master_wine_library USING btree (normalized_producer) WHERE (normalized_producer IS NOT NULL);


--
-- Name: idx_master_wine_library_primary_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_master_wine_library_primary_type ON public.master_wine_library USING btree (primary_type);


--
-- Name: idx_master_wine_library_producer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_master_wine_library_producer ON public.master_wine_library USING btree (producer);


--
-- Name: idx_master_wine_library_review_queue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_master_wine_library_review_queue ON public.master_wine_library USING btree (library_tier, created_at DESC) WHERE (library_tier >= 3);


--
-- Name: idx_master_wine_library_review_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_master_wine_library_review_status ON public.master_wine_library USING btree (review_status) WHERE (review_status = ANY (ARRAY['pending'::text, 'needs_review'::text]));


--
-- Name: idx_master_wine_library_search_vector; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_master_wine_library_search_vector ON public.master_wine_library USING gin (search_vector);


--
-- Name: idx_master_wine_library_signature_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_master_wine_library_signature_hash ON public.master_wine_library USING btree (signature_hash) WHERE (signature_hash IS NOT NULL);


--
-- Name: idx_master_wine_library_sku; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_master_wine_library_sku ON public.master_wine_library USING btree (sku) WHERE (sku IS NOT NULL);


--
-- Name: idx_master_wine_library_tier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_master_wine_library_tier ON public.master_wine_library USING btree (library_tier);


--
-- Name: idx_master_wine_library_upc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_master_wine_library_upc ON public.master_wine_library USING btree (upc) WHERE (upc IS NOT NULL);


--
-- Name: idx_master_wine_library_wine_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_master_wine_library_wine_id ON public.master_wine_library USING btree (wine_id);


--
-- Name: idx_mc_change_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mc_change_type ON public.menu_changes USING btree (change_type, detected_at DESC);


--
-- Name: idx_mc_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mc_hash ON public.menu_changes USING btree (wine_signature_hash, detected_at DESC);


--
-- Name: idx_mc_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mc_restaurant ON public.menu_changes USING btree (restaurant_id, detected_at DESC);


--
-- Name: idx_menu_items_menu; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_menu_items_menu ON public.menu_items USING btree (menu_id);


--
-- Name: idx_menu_items_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_menu_items_restaurant ON public.menu_items USING btree (restaurant_id);


--
-- Name: idx_menu_items_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_menu_items_status ON public.menu_items USING btree (restaurant_id, status);


--
-- Name: idx_menu_items_submission_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_menu_items_submission_id ON public.menu_items USING btree (submission_id) WHERE (submission_id IS NOT NULL);


--
-- Name: idx_menu_items_wine_library; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_menu_items_wine_library ON public.menu_items USING btree (wine_library_id);


--
-- Name: idx_message_templates_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_message_templates_active ON public.message_templates USING btree (is_active) WHERE (is_active = true);


--
-- Name: idx_message_templates_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_message_templates_category ON public.message_templates USING btree (category);


--
-- Name: idx_message_templates_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_message_templates_restaurant ON public.message_templates USING btree (restaurant_id);


--
-- Name: idx_migrations_applied_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_migrations_applied_at ON public._migrations USING btree (applied_at);


--
-- Name: idx_migrations_version; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_migrations_version ON public._migrations USING btree (version);


--
-- Name: idx_mobile_devices_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mobile_devices_restaurant ON public.mobile_devices USING btree (restaurant_id);


--
-- Name: idx_mobile_devices_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mobile_devices_user ON public.mobile_devices USING btree (user_id);


--
-- Name: idx_mwls_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mwls_created_at ON public.master_wine_library_submissions USING btree (created_at);


--
-- Name: idx_mwls_ontology_validated_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mwls_ontology_validated_at ON public.master_wine_library_submissions USING btree (ontology_validated_at) WHERE (ontology_validated_at IS NOT NULL);


--
-- Name: idx_mwls_ontology_validation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mwls_ontology_validation ON public.master_wine_library_submissions USING gin (ontology_validation);


--
-- Name: idx_mwls_restaurant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mwls_restaurant_id ON public.master_wine_library_submissions USING btree (restaurant_id);


--
-- Name: idx_mwls_signature_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mwls_signature_hash ON public.master_wine_library_submissions USING btree (signature_hash) WHERE (signature_hash IS NOT NULL);


--
-- Name: idx_mwls_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mwls_status ON public.master_wine_library_submissions USING btree (status);


--
-- Name: idx_neg_facts_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_neg_facts_active ON public.negotiation_facts USING btree (session_id, status) WHERE ((status)::text = 'active'::text);


--
-- Name: idx_neg_facts_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_neg_facts_provider ON public.negotiation_facts USING btree (provider_id, fact_key);


--
-- Name: idx_neg_facts_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_neg_facts_session ON public.negotiation_facts USING btree (session_id);


--
-- Name: idx_notification_deliveries_event_channel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notification_deliveries_event_channel ON public.notification_deliveries USING btree (event_id, channel);


--
-- Name: idx_notification_deliveries_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notification_deliveries_restaurant ON public.notification_deliveries USING btree (restaurant_id, created_at DESC);


--
-- Name: idx_notification_prefs_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notification_prefs_restaurant ON public.notification_preferences USING btree (restaurant_id);


--
-- Name: idx_notification_prefs_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notification_prefs_user ON public.notification_preferences USING btree (user_id);


--
-- Name: idx_notifications_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_created ON public.notifications USING btree (created_at DESC);


--
-- Name: idx_notifications_group; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_group ON public.notifications USING btree (user_id, group_key, created_at DESC);


--
-- Name: idx_notifications_recipient; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_recipient ON public.notifications USING btree (recipient_id);


--
-- Name: idx_notifications_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_restaurant ON public.notifications USING btree (restaurant_id);


--
-- Name: idx_notifications_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_status ON public.notifications USING btree (user_id, status);


--
-- Name: idx_notifications_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_type ON public.notifications USING btree (notification_type);


--
-- Name: idx_notifications_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_unread ON public.notifications USING btree (recipient_id, read_at) WHERE (read_at IS NULL);


--
-- Name: idx_notifications_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_user ON public.notifications USING btree (user_id, created_at DESC);


--
-- Name: idx_onboarding_progress_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_onboarding_progress_restaurant ON public.user_onboarding_progress USING btree (restaurant_id);


--
-- Name: idx_onboarding_progress_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_onboarding_progress_user ON public.user_onboarding_progress USING btree (user_id);


--
-- Name: idx_onboarding_sessions_actor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_onboarding_sessions_actor ON public.onboarding_sessions USING btree (actor_id);


--
-- Name: idx_onboarding_sessions_scan; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_onboarding_sessions_scan ON public.onboarding_sessions USING btree (scan_session_id);


--
-- Name: idx_onboarding_sessions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_onboarding_sessions_status ON public.onboarding_sessions USING btree (status) WHERE (status = 'active'::text);


--
-- Name: idx_one_tap_actions_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_one_tap_actions_created ON public.one_tap_actions USING btree (created_at DESC);


--
-- Name: idx_one_tap_actions_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_one_tap_actions_pending ON public.one_tap_actions USING btree (restaurant_id, status) WHERE ((status = 'pending'::public.one_tap_action_status) AND (deleted_at IS NULL));


--
-- Name: idx_one_tap_actions_priority; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_one_tap_actions_priority ON public.one_tap_actions USING btree (priority);


--
-- Name: idx_one_tap_actions_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_one_tap_actions_restaurant ON public.one_tap_actions USING btree (restaurant_id);


--
-- Name: idx_one_tap_actions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_one_tap_actions_status ON public.one_tap_actions USING btree (status);


--
-- Name: idx_one_tap_actions_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_one_tap_actions_type ON public.one_tap_actions USING btree (action_type);


--
-- Name: idx_one_tap_actions_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_one_tap_actions_user ON public.one_tap_actions USING btree (user_id);


--
-- Name: idx_order_interactions_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_interactions_created ON public.order_interactions USING btree (created_at DESC);


--
-- Name: idx_order_interactions_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_interactions_order ON public.order_interactions USING btree (order_id);


--
-- Name: idx_order_interactions_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_interactions_type ON public.order_interactions USING btree (interaction_type);


--
-- Name: idx_order_items_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_items_order ON public.order_items USING btree (order_id);


--
-- Name: idx_order_items_wine; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_items_wine ON public.order_items USING btree (wine_id);


--
-- Name: idx_org_invites_code; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_org_invites_code ON public.organization_invites USING btree (code);


--
-- Name: idx_org_invites_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_org_invites_org ON public.organization_invites USING btree (organization_id);


--
-- Name: idx_org_invites_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_org_invites_restaurant ON public.organization_invites USING btree (restaurant_id);


--
-- Name: idx_org_members_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_org_members_org ON public.organization_members USING btree (organization_id);


--
-- Name: idx_org_members_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_org_members_user ON public.organization_members USING btree (user_id);


--
-- Name: idx_outbox_unpublished; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_outbox_unpublished ON public.outbox USING btree (created_at) WHERE (published = false);


--
-- Name: idx_override_events_actor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_override_events_actor ON public.override_events USING btree (actor_id);


--
-- Name: idx_override_events_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_override_events_pending ON public.override_events USING btree (promotion_status, created_at) WHERE (promotion_status = 'pending'::text);


--
-- Name: idx_override_events_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_override_events_session ON public.override_events USING btree (session_id);


--
-- Name: idx_override_events_submission; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_override_events_submission ON public.override_events USING btree (submission_id);


--
-- Name: idx_pc_document; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pc_document ON public.procurement_credits USING btree (document_id);


--
-- Name: idx_pc_open_age; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pc_open_age ON public.procurement_credits USING btree (restaurant_id, opened_at) WHERE ((state)::text = ANY ((ARRAY['open'::character varying, 'requested'::character varying, 'promised'::character varying])::text[]));


--
-- Name: idx_pc_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pc_order ON public.procurement_credits USING btree (order_id);


--
-- Name: idx_pc_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pc_provider ON public.procurement_credits USING btree (restaurant_id, provider_id, state);


--
-- Name: idx_pc_restaurant_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pc_restaurant_state ON public.procurement_credits USING btree (restaurant_id, state);


--
-- Name: idx_pcs_open; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pcs_open ON public.provider_conversation_sessions USING btree (provider_id, closed_at) WHERE (closed_at IS NULL);


--
-- Name: idx_pcs_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pcs_provider ON public.provider_conversation_sessions USING btree (provider_id, started_at DESC);


--
-- Name: idx_pcs_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pcs_restaurant ON public.provider_conversation_sessions USING btree (restaurant_id);


--
-- Name: idx_pcs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pcs_status ON public.provider_conversation_sessions USING btree (status) WHERE (status = ANY (ARRAY['active'::text, 'paused_for_approval'::text]));


--
-- Name: idx_pd_doc_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pd_doc_number ON public.procurement_documents USING btree (restaurant_id, doc_number);


--
-- Name: idx_pd_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pd_provider ON public.procurement_documents USING btree (provider_id);


--
-- Name: idx_pd_references; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pd_references ON public.procurement_documents USING btree (restaurant_id, references_doc_number);


--
-- Name: idx_pd_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pd_restaurant ON public.procurement_documents USING btree (restaurant_id);


--
-- Name: idx_pd_source_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pd_source_ref ON public.procurement_documents USING btree (restaurant_id, source_ref);


--
-- Name: idx_pd_type_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pd_type_status ON public.procurement_documents USING btree (restaurant_id, doc_type, status);


--
-- Name: idx_pdl_document; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pdl_document ON public.procurement_document_lines USING btree (document_id);


--
-- Name: idx_pdl_order_line; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pdl_order_line ON public.procurement_document_lines USING btree (order_line_id);


--
-- Name: idx_pdl_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pdl_restaurant ON public.procurement_document_lines USING btree (restaurant_id);


--
-- Name: idx_pdlink_document; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pdlink_document ON public.procurement_document_links USING btree (document_id);


--
-- Name: idx_pdlink_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pdlink_order ON public.procurement_document_links USING btree (order_id);


--
-- Name: idx_pk_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pk_provider ON public.provider_knowledge USING btree (provider_id, category);


--
-- Name: idx_pk_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pk_restaurant ON public.provider_knowledge USING btree (restaurant_id);


--
-- Name: idx_pk_verified; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pk_verified ON public.provider_knowledge USING btree (verified) WHERE (verified = false);


--
-- Name: idx_poi_inventory; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_poi_inventory ON public.procurement_order_items USING btree (inventory_id);


--
-- Name: idx_poi_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_poi_order ON public.procurement_order_items USING btree (order_id);


--
-- Name: idx_poi_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_poi_restaurant ON public.procurement_order_items USING btree (restaurant_id);


--
-- Name: idx_poi_vendor_sku; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_poi_vendor_sku ON public.procurement_order_items USING btree (restaurant_id, vendor_sku);


--
-- Name: idx_pos_checks_open_live; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pos_checks_open_live ON public.pos_checks USING btree (restaurant_id) WHERE (closed_at IS NULL);


--
-- Name: idx_pos_checks_restaurant_opened; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pos_checks_restaurant_opened ON public.pos_checks USING btree (restaurant_id, opened_at DESC);


--
-- Name: idx_pos_checks_table; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pos_checks_table ON public.pos_checks USING btree (table_id) WHERE (table_id IS NOT NULL);


--
-- Name: idx_pos_item_mappings_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pos_item_mappings_restaurant ON public.pos_item_mappings USING btree (restaurant_id, source);


--
-- Name: idx_pour_events_ri; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pour_events_ri ON public.pour_events USING btree (restaurant_id, inventory_id, created_at DESC);


--
-- Name: idx_pp_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pp_active ON public.provider_promotions USING btree (is_active, end_date) WHERE (is_active = true);


--
-- Name: idx_pp_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pp_provider ON public.provider_promotions USING btree (provider_id);


--
-- Name: idx_pp_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pp_restaurant ON public.provider_promotions USING btree (restaurant_id);


--
-- Name: idx_pre_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pre_order ON public.procurement_receipt_events USING btree (order_id);


--
-- Name: idx_pre_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pre_restaurant ON public.procurement_receipt_events USING btree (restaurant_id, occurred_at DESC);


--
-- Name: idx_prediction_accuracy; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prediction_accuracy ON public.prediction_outcomes USING btree (accuracy_score) WHERE (accuracy_score IS NOT NULL);


--
-- Name: idx_prediction_agent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prediction_agent ON public.prediction_outcomes USING btree (agent_name, prediction_type);


--
-- Name: idx_price_history_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_price_history_restaurant ON public.price_history USING btree (restaurant_id);


--
-- Name: idx_price_history_wine_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_price_history_wine_provider ON public.price_history USING btree (master_wine_id, provider_id, effective_date DESC);


--
-- Name: idx_proc_conv_scheduled_send; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_proc_conv_scheduled_send ON public.procurement_conversations USING btree (scheduled_send_at) WHERE ((status)::text = 'AUTO_SEND_SCHEDULED'::text);


--
-- Name: idx_procurement_conversations_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_procurement_conversations_created ON public.procurement_conversations USING btree (created_at DESC);


--
-- Name: idx_procurement_conversations_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_procurement_conversations_order ON public.procurement_conversations USING btree (order_id);


--
-- Name: idx_procurement_conversations_order_number_snapshot; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_procurement_conversations_order_number_snapshot ON public.procurement_conversations USING btree (order_number_snapshot);


--
-- Name: idx_procurement_conversations_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_procurement_conversations_provider ON public.procurement_conversations USING btree (provider_id);


--
-- Name: idx_procurement_conversations_provider_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_procurement_conversations_provider_created ON public.procurement_conversations USING btree (provider_id, created_at DESC);


--
-- Name: idx_procurement_conversations_thread_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_procurement_conversations_thread_key ON public.procurement_conversations USING btree (thread_key);


--
-- Name: idx_procurement_order_items_sku; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_procurement_order_items_sku ON public.procurement_order_items USING btree (sku) WHERE (sku IS NOT NULL);


--
-- Name: idx_procurement_order_items_vendor_sku; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_procurement_order_items_vendor_sku ON public.procurement_order_items USING btree (vendor_sku) WHERE (vendor_sku IS NOT NULL);


--
-- Name: idx_procurement_order_items_wine; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_procurement_order_items_wine ON public.procurement_order_items USING btree (master_wine_id);


--
-- Name: idx_procurement_orders_expected_delivery; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_procurement_orders_expected_delivery ON public.procurement_orders USING btree (expected_delivery_date) WHERE ((status)::text = 'IN_TRANSIT'::text);


--
-- Name: idx_procurement_orders_match_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_procurement_orders_match_status ON public.procurement_orders USING btree (restaurant_id, match_status) WHERE ((match_status IS NOT NULL) AND ((match_status)::text <> 'matched'::text));


--
-- Name: idx_procurement_orders_open_backorder; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_procurement_orders_open_backorder ON public.procurement_orders USING btree (restaurant_id, provider_id) WHERE (backorder_quantity > 0);


--
-- Name: idx_procurement_orders_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_procurement_orders_provider ON public.procurement_orders USING btree (provider_id);


--
-- Name: idx_procurement_orders_recurring; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_procurement_orders_recurring ON public.procurement_orders USING btree (is_recurring) WHERE (is_recurring = true);


--
-- Name: idx_procurement_orders_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_procurement_orders_restaurant ON public.procurement_orders USING btree (restaurant_id);


--
-- Name: idx_procurement_orders_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_procurement_orders_state ON public.procurement_orders USING btree (state_machine_state);


--
-- Name: idx_procurement_orders_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_procurement_orders_status ON public.procurement_orders USING btree (status);


--
-- Name: idx_profit_margins_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profit_margins_date ON public.profit_margins USING btree (date);


--
-- Name: idx_profit_margins_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profit_margins_restaurant ON public.profit_margins USING btree (restaurant_id);


--
-- Name: idx_prompt_versions_agent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prompt_versions_agent ON public.prompt_versions USING btree (agent_name, is_active);


--
-- Name: idx_prospect_gmail_msg; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prospect_gmail_msg ON public.email_prospects USING btree (gmail_message_id) WHERE (gmail_message_id IS NOT NULL);


--
-- Name: idx_prospect_restaurant_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prospect_restaurant_status ON public.email_prospects USING btree (restaurant_id, status);


--
-- Name: idx_provider_contacts_primary; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_provider_contacts_primary ON public.provider_contacts USING btree (provider_id) WHERE (is_primary = true);


--
-- Name: idx_provider_contacts_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_provider_contacts_provider ON public.provider_contacts USING btree (provider_id);


--
-- Name: idx_provider_knowledge_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_provider_knowledge_active ON public.provider_knowledge USING btree (provider_id, is_active) WHERE (is_active = true);


--
-- Name: idx_provider_knowledge_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_provider_knowledge_category ON public.provider_knowledge USING btree (category);


--
-- Name: idx_provider_knowledge_provider_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_provider_knowledge_provider_id ON public.provider_knowledge USING btree (provider_id);


--
-- Name: idx_provider_locations_provider_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_provider_locations_provider_id ON public.provider_locations USING btree (provider_id);


--
-- Name: idx_provider_locations_restaurant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_provider_locations_restaurant_id ON public.provider_locations USING btree (restaurant_id);


--
-- Name: idx_provider_performance_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_provider_performance_period ON public.provider_performance_metrics USING btree (period_start, period_end);


--
-- Name: idx_provider_performance_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_provider_performance_provider ON public.provider_performance_metrics USING btree (provider_id);


--
-- Name: idx_provider_performance_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_provider_performance_restaurant ON public.provider_performance_metrics USING btree (restaurant_id);


--
-- Name: idx_providers_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_providers_active ON public.providers USING btree (is_active) WHERE (is_active = true);


--
-- Name: idx_providers_catalogue_vendor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_providers_catalogue_vendor ON public.providers USING btree (catalogue_vendor_id) WHERE (catalogue_vendor_id IS NOT NULL);


--
-- Name: idx_providers_competitor_group; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_providers_competitor_group ON public.providers USING btree (competitor_group) WHERE (competitor_group IS NOT NULL);


--
-- Name: idx_providers_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_providers_name ON public.providers USING btree (name);


--
-- Name: idx_providers_profile_dynamic; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_providers_profile_dynamic ON public.providers USING gin (profile_dynamic) WHERE (profile_dynamic <> '{}'::jsonb);


--
-- Name: idx_providers_profile_foundational; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_providers_profile_foundational ON public.providers USING gin (profile_foundational) WHERE (profile_foundational <> '{}'::jsonb);


--
-- Name: idx_providers_tier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_providers_tier ON public.providers USING btree (tier);


--
-- Name: idx_psh_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_psh_provider ON public.provider_sentiment_history USING btree (provider_id, created_at DESC);


--
-- Name: idx_psh_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_psh_restaurant ON public.provider_sentiment_history USING btree (restaurant_id);


--
-- Name: idx_rd_city_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rd_city_status ON public.restaurant_directory USING btree (city, crawl_status);


--
-- Name: idx_rd_crawl_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rd_crawl_status ON public.restaurant_directory USING btree (crawl_status);


--
-- Name: idx_rd_sources; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rd_sources ON public.restaurant_directory USING gin (discovery_sources);


--
-- Name: idx_recommendation_actions_assignee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_recommendation_actions_assignee ON public.recommendation_actions USING btree (restaurant_id, assigned_to) WHERE (assigned_to IS NOT NULL);


--
-- Name: idx_recommendation_actions_pinned; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_recommendation_actions_pinned ON public.recommendation_actions USING btree (restaurant_id) WHERE pinned;


--
-- Name: idx_recommendation_actions_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_recommendation_actions_restaurant ON public.recommendation_actions USING btree (restaurant_id, status);


--
-- Name: idx_recommendation_actions_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_recommendation_actions_updated ON public.recommendation_actions USING btree (restaurant_id, updated_at DESC);


--
-- Name: idx_recurrence_exceptions_rule; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_recurrence_exceptions_rule ON public.calendar_recurrence_exceptions USING btree (recurrence_rule_id);


--
-- Name: idx_recurrence_rules_event; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_recurrence_rules_event ON public.calendar_recurrence_rules USING btree (calendar_event_id);


--
-- Name: idx_recurrence_rules_next_gen; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_recurrence_rules_next_gen ON public.calendar_recurrence_rules USING btree (next_generation_date) WHERE (next_generation_date IS NOT NULL);


--
-- Name: idx_recurrence_rules_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_recurrence_rules_restaurant ON public.calendar_recurrence_rules USING btree (restaurant_id);


--
-- Name: idx_recurring_orders_next_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_recurring_orders_next_date ON public.recurring_orders USING btree (next_order_date) WHERE (active = true);


--
-- Name: idx_recurring_orders_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_recurring_orders_restaurant ON public.recurring_orders USING btree (restaurant_id);


--
-- Name: idx_recurring_orders_wine; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_recurring_orders_wine ON public.recurring_orders USING btree (wine_id);


--
-- Name: idx_reminders_next_fire; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reminders_next_fire ON public.custom_reminders USING btree (next_fire_at) WHERE (is_active = true);


--
-- Name: idx_reminders_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reminders_restaurant ON public.custom_reminders USING btree (restaurant_id);


--
-- Name: idx_reminders_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reminders_type ON public.custom_reminders USING btree (reminder_type);


--
-- Name: idx_replay_jobs_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_replay_jobs_restaurant ON public.event_replay_jobs USING btree (restaurant_id);


--
-- Name: idx_replay_jobs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_replay_jobs_status ON public.event_replay_jobs USING btree (status) WHERE (status = ANY (ARRAY['pending'::public.replay_job_status, 'running'::public.replay_job_status, 'paused'::public.replay_job_status]));


--
-- Name: idx_research_run_stats_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_research_run_stats_run ON public.research_run_stats USING btree (run_id);


--
-- Name: idx_research_run_stats_wine; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_research_run_stats_wine ON public.research_run_stats USING btree (wine_id);


--
-- Name: idx_research_runs_started; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_research_runs_started ON public.research_runs USING btree (started_at DESC);


--
-- Name: idx_research_runs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_research_runs_status ON public.research_runs USING btree (status) WHERE ((status)::text = 'running'::text);


--
-- Name: idx_restaurant_chains_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_restaurant_chains_org ON public.restaurant_chains USING btree (organization_id);


--
-- Name: idx_restaurant_feature_flags_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_restaurant_feature_flags_restaurant ON public.restaurant_feature_flags USING btree (restaurant_id);


--
-- Name: idx_restaurant_inventory_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_restaurant_inventory_active ON public.restaurant_inventory USING btree (restaurant_id, is_active) WHERE (is_active = true);


--
-- Name: idx_restaurant_inventory_clover; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_restaurant_inventory_clover ON public.restaurant_inventory USING btree (clover_item_id) WHERE (clover_item_id IS NOT NULL);


--
-- Name: idx_restaurant_inventory_internal_sku; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_restaurant_inventory_internal_sku ON public.restaurant_inventory USING btree (internal_sku) WHERE (internal_sku IS NOT NULL);


--
-- Name: idx_restaurant_inventory_low_stock; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_restaurant_inventory_low_stock ON public.restaurant_inventory USING btree (restaurant_id, stock_live) WHERE ((stock_live < threshold_min) AND (is_active = true));


--
-- Name: idx_restaurant_inventory_pos_sku; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_restaurant_inventory_pos_sku ON public.restaurant_inventory USING btree (pos_sku) WHERE (pos_sku IS NOT NULL);


--
-- Name: idx_restaurant_inventory_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_restaurant_inventory_provider ON public.restaurant_inventory USING btree (provider_id);


--
-- Name: idx_restaurant_inventory_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_restaurant_inventory_restaurant ON public.restaurant_inventory USING btree (restaurant_id);


--
-- Name: idx_restaurant_inventory_restaurant_sku; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_restaurant_inventory_restaurant_sku ON public.restaurant_inventory USING btree (restaurant_id, sku) WHERE (sku IS NOT NULL);


--
-- Name: idx_restaurant_inventory_restaurant_toast; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_restaurant_inventory_restaurant_toast ON public.restaurant_inventory USING btree (restaurant_id, toast_item_guid) WHERE (toast_item_guid IS NOT NULL);


--
-- Name: idx_restaurant_inventory_sku; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_restaurant_inventory_sku ON public.restaurant_inventory USING btree (sku) WHERE (sku IS NOT NULL);


--
-- Name: idx_restaurant_inventory_sku_aliases; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_restaurant_inventory_sku_aliases ON public.restaurant_inventory USING gin (sku_aliases);


--
-- Name: idx_restaurant_inventory_square; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_restaurant_inventory_square ON public.restaurant_inventory USING btree (square_item_id) WHERE (square_item_id IS NOT NULL);


--
-- Name: idx_restaurant_inventory_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_restaurant_inventory_state ON public.restaurant_inventory USING btree (inventory_state);


--
-- Name: idx_restaurant_inventory_storage_location; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_restaurant_inventory_storage_location ON public.restaurant_inventory USING btree (storage_location_id);


--
-- Name: idx_restaurant_inventory_target_price; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_restaurant_inventory_target_price ON public.restaurant_inventory USING btree (target_price) WHERE (target_price IS NOT NULL);


--
-- Name: idx_restaurant_inventory_toast_guid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_restaurant_inventory_toast_guid ON public.restaurant_inventory USING btree (toast_item_guid) WHERE (toast_item_guid IS NOT NULL);


--
-- Name: idx_restaurant_inventory_toast_menu; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_restaurant_inventory_toast_menu ON public.restaurant_inventory USING btree (toast_menu_item_id) WHERE (toast_menu_item_id IS NOT NULL);


--
-- Name: idx_restaurant_inventory_version; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_restaurant_inventory_version ON public.restaurant_inventory USING btree (id, version);


--
-- Name: idx_restaurant_inventory_wine; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_restaurant_inventory_wine ON public.restaurant_inventory USING btree (master_wine_id);


--
-- Name: idx_restaurant_menus_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_restaurant_menus_restaurant ON public.restaurant_menus USING btree (restaurant_id);


--
-- Name: idx_restaurant_menus_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_restaurant_menus_status ON public.restaurant_menus USING btree (restaurant_id, status);


--
-- Name: idx_restaurant_providers_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_restaurant_providers_provider ON public.restaurant_providers USING btree (provider_id);


--
-- Name: idx_restaurant_providers_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_restaurant_providers_restaurant ON public.restaurant_providers USING btree (restaurant_id);


--
-- Name: idx_restaurant_providers_tier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_restaurant_providers_tier ON public.restaurant_providers USING btree (tier);


--
-- Name: idx_restaurant_tables_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_restaurant_tables_restaurant ON public.restaurant_tables USING btree (restaurant_id) WHERE is_active;


--
-- Name: idx_restaurants_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_restaurants_active ON public.restaurants USING btree (is_active) WHERE (is_active = true);


--
-- Name: idx_restaurants_calendar_ical_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_restaurants_calendar_ical_token ON public.restaurants USING btree (calendar_ical_token) WHERE (calendar_ical_token IS NOT NULL);


--
-- Name: idx_restaurants_chain; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_restaurants_chain ON public.restaurants USING btree (chain_id);


--
-- Name: idx_restaurants_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_restaurants_org ON public.restaurants USING btree (organization_id);


--
-- Name: idx_restaurants_org_name_city_area; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_restaurants_org_name_city_area ON public.restaurants USING btree (organization_id, lower((name)::text), lower((city)::text), lower((country)::text), lower((COALESCE(neighborhood, ''::character varying))::text)) WHERE ((organization_id IS NOT NULL) AND (postal_code IS NULL) AND (city IS NOT NULL) AND (country IS NOT NULL));


--
-- Name: idx_restaurants_org_name_full_location; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_restaurants_org_name_full_location ON public.restaurants USING btree (organization_id, lower((name)::text), lower((city)::text), lower((country)::text), postal_code) WHERE ((organization_id IS NOT NULL) AND (city IS NOT NULL) AND (country IS NOT NULL));


--
-- Name: idx_restaurants_org_name_postal; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_restaurants_org_name_postal ON public.restaurants USING btree (organization_id, lower((name)::text), postal_code) WHERE ((organization_id IS NOT NULL) AND (postal_code IS NOT NULL));


--
-- Name: idx_restaurants_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_restaurants_parent ON public.restaurants USING btree (parent_restaurant_id);


--
-- Name: idx_restaurants_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_restaurants_slug ON public.restaurants USING btree (slug);


--
-- Name: idx_rfq_requests_inventory; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rfq_requests_inventory ON public.rfq_requests USING btree (inventory_id);


--
-- Name: idx_rfq_requests_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rfq_requests_restaurant ON public.rfq_requests USING btree (restaurant_id);


--
-- Name: idx_rfq_requests_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rfq_requests_status ON public.rfq_requests USING btree (status);


--
-- Name: idx_rwr_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rwr_hash ON public.restaurant_wine_roster USING btree (signature_hash);


--
-- Name: idx_rwr_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rwr_restaurant ON public.restaurant_wine_roster USING btree (restaurant_id);


--
-- Name: idx_saga_state_status_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_saga_state_status_type ON public.saga_state USING btree (status, saga_type);


--
-- Name: idx_sales_events_event_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sales_events_event_type ON public.sales_events USING btree (event_type);


--
-- Name: idx_sales_events_inventory; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sales_events_inventory ON public.sales_events USING btree (inventory_id);


--
-- Name: idx_sales_events_pos_guid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sales_events_pos_guid ON public.sales_events USING btree (pos_item_guid) WHERE (pos_item_guid IS NOT NULL);


--
-- Name: idx_sales_events_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sales_events_restaurant ON public.sales_events USING btree (restaurant_id);


--
-- Name: idx_sales_events_sku; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sales_events_sku ON public.sales_events USING btree (sku) WHERE (sku IS NOT NULL);


--
-- Name: idx_sales_events_time_analysis; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sales_events_time_analysis ON public.sales_events USING btree (restaurant_id, day_of_week, hour_of_day);


--
-- Name: idx_sales_events_timestamp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sales_events_timestamp ON public.sales_events USING btree (pos_event_timestamp DESC);


--
-- Name: idx_sales_events_wine_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sales_events_wine_id ON public.sales_events USING btree (wine_id) WHERE (wine_id IS NOT NULL);


--
-- Name: idx_schema_registry_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schema_registry_active ON public.event_schema_registry USING btree (is_active) WHERE (is_active = true);


--
-- Name: idx_schema_registry_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schema_registry_type ON public.event_schema_registry USING btree (event_type);


--
-- Name: idx_sender_rep_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sender_rep_restaurant ON public.sender_reputation USING btree (restaurant_id);


--
-- Name: idx_server_sales_restaurant_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_server_sales_restaurant_date ON public.server_sales USING btree (restaurant_id, service_date);


--
-- Name: idx_shift_breaks_shift; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shift_breaks_shift ON public.shift_breaks USING btree (shift_id);


--
-- Name: idx_shifts_member; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shifts_member ON public.shifts USING btree (member_id);


--
-- Name: idx_shifts_restaurant_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shifts_restaurant_date ON public.shifts USING btree (restaurant_id, shift_date);


--
-- Name: idx_shifts_schedule; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shifts_schedule ON public.shifts USING btree (schedule_id);


--
-- Name: idx_sim_gt_facts_rest_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sim_gt_facts_rest_type ON public.sim_ground_truth_facts USING btree (restaurant_id, fact_type);


--
-- Name: idx_sim_gt_facts_run_sku; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sim_gt_facts_run_sku ON public.sim_ground_truth_facts USING btree (run_id, fact_type, sku_key);


--
-- Name: idx_sku_mappings_inventory; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sku_mappings_inventory ON public.sku_mappings USING btree (inventory_id);


--
-- Name: idx_sku_mappings_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sku_mappings_lookup ON public.sku_mappings USING btree (sku_type, sku_value) WHERE (is_active = true);


--
-- Name: idx_sku_mappings_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sku_mappings_provider ON public.sku_mappings USING btree (provider_id);


--
-- Name: idx_sku_mappings_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sku_mappings_restaurant ON public.sku_mappings USING btree (restaurant_id);


--
-- Name: idx_sku_mappings_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sku_mappings_type ON public.sku_mappings USING btree (sku_type);


--
-- Name: idx_sku_mappings_value; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sku_mappings_value ON public.sku_mappings USING btree (sku_value);


--
-- Name: idx_sku_mappings_wine; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sku_mappings_wine ON public.sku_mappings USING btree (master_wine_id);


--
-- Name: idx_sommelier_conversations_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sommelier_conversations_user ON public.sommelier_conversations USING btree (user_id, updated_at DESC);


--
-- Name: idx_storage_locations_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_storage_locations_active ON public.storage_locations USING btree (is_active) WHERE (is_active = true);


--
-- Name: idx_storage_locations_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_storage_locations_restaurant ON public.storage_locations USING btree (restaurant_id);


--
-- Name: idx_storage_locations_zone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_storage_locations_zone ON public.storage_locations USING btree (zone);


--
-- Name: idx_submissions_auto_blocked; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_submissions_auto_blocked ON public.master_wine_library_submissions USING btree (auto_blocked) WHERE (auto_blocked = true);


--
-- Name: idx_submissions_field_confidence; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_submissions_field_confidence ON public.master_wine_library_submissions USING gin (field_confidence);


--
-- Name: idx_submissions_last_research; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_submissions_last_research ON public.master_wine_library_submissions USING btree (last_research_run_at) WHERE (last_research_run_at IS NOT NULL);


--
-- Name: idx_supplier_catalogs_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_supplier_catalogs_provider ON public.supplier_catalogs USING btree (provider_id);


--
-- Name: idx_supplier_catalogs_valid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_supplier_catalogs_valid ON public.supplier_catalogs USING btree (valid_from, valid_until);


--
-- Name: idx_swap_requests_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_swap_requests_restaurant ON public.swap_requests USING btree (restaurant_id);


--
-- Name: idx_system_audit_log_actor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_system_audit_log_actor ON public.system_audit_log USING btree (actor_id);


--
-- Name: idx_system_audit_log_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_system_audit_log_created ON public.system_audit_log USING btree (created_at DESC);


--
-- Name: idx_system_audit_log_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_system_audit_log_entity ON public.system_audit_log USING btree (entity_type, entity_id);


--
-- Name: idx_system_audit_log_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_system_audit_log_restaurant ON public.system_audit_log USING btree (restaurant_id);


--
-- Name: idx_system_audit_log_suspicious; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_system_audit_log_suspicious ON public.system_audit_log USING btree (is_suspicious) WHERE (is_suspicious = true);


--
-- Name: idx_team_availability_member; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_team_availability_member ON public.team_availability USING btree (member_id);


--
-- Name: idx_team_certs_expiry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_team_certs_expiry ON public.team_certifications USING btree (restaurant_id, expires_at);


--
-- Name: idx_team_certs_member; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_team_certs_member ON public.team_certifications USING btree (member_id);


--
-- Name: idx_team_members_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_team_members_email ON public.team_members USING btree (lower(email));


--
-- Name: idx_team_members_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_team_members_restaurant ON public.team_members USING btree (restaurant_id);


--
-- Name: idx_time_off_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_time_off_restaurant ON public.time_off_requests USING btree (restaurant_id);


--
-- Name: idx_toast_mappings_guid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_toast_mappings_guid ON public.toast_item_mappings USING btree (toast_guid);


--
-- Name: idx_toast_mappings_inventory; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_toast_mappings_inventory ON public.toast_item_mappings USING btree (inventory_id);


--
-- Name: idx_toast_mappings_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_toast_mappings_restaurant ON public.toast_item_mappings USING btree (restaurant_id);


--
-- Name: idx_toast_mappings_restaurant_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_toast_mappings_restaurant_status ON public.toast_item_mappings USING btree (restaurant_id, mapping_status);


--
-- Name: idx_toast_mappings_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_toast_mappings_status ON public.toast_item_mappings USING btree (mapping_status);


--
-- Name: idx_toast_mappings_unmapped; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_toast_mappings_unmapped ON public.toast_item_mappings USING btree (restaurant_id) WHERE ((mapping_status)::text = 'unmapped'::text);


--
-- Name: idx_training_datasets_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_training_datasets_created ON public.training_datasets USING btree (created_at DESC);


--
-- Name: idx_training_datasets_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_training_datasets_restaurant ON public.training_datasets USING btree (restaurant_id) WHERE (restaurant_id IS NOT NULL);


--
-- Name: idx_training_datasets_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_training_datasets_type ON public.training_datasets USING btree (dataset_type);


--
-- Name: idx_training_datasets_verified; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_training_datasets_verified ON public.training_datasets USING btree (human_verified) WHERE (human_verified = true);


--
-- Name: idx_tw_score; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tw_score ON public.trending_wines USING btree (trend_score DESC) WHERE (window_days = 30);


--
-- Name: idx_ura_restaurant_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ura_restaurant_active ON public.user_restaurant_access USING btree (restaurant_id, is_active) WHERE (is_active = true);


--
-- Name: idx_ura_user_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ura_user_active ON public.user_restaurant_access USING btree (user_id, is_active) WHERE (is_active = true);


--
-- Name: idx_url_cache_age; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_url_cache_age ON public.evidence_url_cache USING btree (cached_at);


--
-- Name: idx_user_oauth_accounts_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_oauth_accounts_user ON public.user_oauth_accounts USING btree (user_id);


--
-- Name: idx_user_preferences_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_preferences_user ON public.user_preferences USING btree (user_id);


--
-- Name: idx_user_restaurant_access_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_restaurant_access_restaurant ON public.user_restaurant_access USING btree (restaurant_id);


--
-- Name: idx_user_restaurant_access_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_restaurant_access_user ON public.user_restaurant_access USING btree (user_id);


--
-- Name: idx_user_roles_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_roles_active ON public.user_roles USING btree (user_id, role) WHERE (revoked_at IS NULL);


--
-- Name: idx_user_roles_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_roles_role ON public.user_roles USING btree (role);


--
-- Name: idx_user_roles_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_roles_user_id ON public.user_roles USING btree (user_id);


--
-- Name: idx_users_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_email ON public.users USING btree (email);


--
-- Name: idx_users_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_restaurant ON public.users USING btree (restaurant_id);


--
-- Name: idx_ux_learnings_page; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ux_learnings_page ON public.ux_learnings USING btree (page, created_at DESC);


--
-- Name: idx_ux_overrides_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ux_overrides_active ON public.ux_overrides USING btree (page) WHERE enabled;


--
-- Name: idx_ux_proposals_page; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ux_proposals_page ON public.ux_proposals USING btree (page, status);


--
-- Name: idx_ux_proposals_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ux_proposals_status ON public.ux_proposals USING btree (status, created_at DESC);


--
-- Name: idx_ux_signals_page; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ux_signals_page ON public.ux_signals USING btree (page, created_at DESC);


--
-- Name: idx_ux_signals_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ux_signals_restaurant ON public.ux_signals USING btree (restaurant_id, page, created_at DESC);


--
-- Name: idx_vendor_catalogue_country; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vendor_catalogue_country ON public.vendor_catalogue USING btree (country);


--
-- Name: idx_vendor_catalogue_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vendor_catalogue_name ON public.vendor_catalogue USING gin (to_tsvector('english'::regconfig, name));


--
-- Name: idx_vendor_catalogue_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vendor_catalogue_state ON public.vendor_catalogue USING btree (state);


--
-- Name: idx_vendor_deadlines_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vendor_deadlines_provider ON public.vendor_deadlines USING btree (provider_id);


--
-- Name: idx_vendor_deadlines_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vendor_deadlines_restaurant ON public.vendor_deadlines USING btree (restaurant_id);


--
-- Name: idx_vintage_rules_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vintage_rules_active ON public.vintage_substitution_rules USING btree (is_active) WHERE (is_active = true);


--
-- Name: idx_vintage_rules_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vintage_rules_restaurant ON public.vintage_substitution_rules USING btree (restaurant_id);


--
-- Name: idx_vintage_rules_wine; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vintage_rules_wine ON public.vintage_substitution_rules USING btree (master_wine_id);


--
-- Name: idx_vp_dedup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vp_dedup ON public.vendor_promotions USING btree (dedup_hash);


--
-- Name: idx_vp_expiry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vp_expiry ON public.vendor_promotions USING btree (valid_until) WHERE ((status)::text = 'active'::text);


--
-- Name: idx_vp_provider_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vp_provider_active ON public.vendor_promotions USING btree (provider_id, status) WHERE ((status)::text = 'active'::text);


--
-- Name: idx_vp_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vp_restaurant ON public.vendor_promotions USING btree (restaurant_id);


--
-- Name: idx_wine_aliases_canonical; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wine_aliases_canonical ON public.wine_aliases USING btree (canonical_id);


--
-- Name: idx_wine_aliases_normalized; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wine_aliases_normalized ON public.wine_aliases USING btree (alias_name_normalized);


--
-- Name: idx_wine_menu_prices_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wine_menu_prices_restaurant ON public.wine_menu_prices USING btree (restaurant_id, wine_id, scanned_at DESC);


--
-- Name: idx_wine_menu_prices_wine; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wine_menu_prices_wine ON public.wine_menu_prices USING btree (wine_id);


--
-- Name: idx_wlm_location; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wlm_location ON public.wine_location_mappings USING btree (location_id);


--
-- Name: idx_wlm_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wlm_restaurant ON public.wine_location_mappings USING btree (restaurant_id);


--
-- Name: idx_wp_count; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wp_count ON public.wine_popularity USING btree (restaurant_count DESC);


--
-- Name: mwls_web_verified_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mwls_web_verified_at_idx ON public.master_wine_library_submissions USING btree (web_verified_at) WHERE (web_verified_at IS NOT NULL);


--
-- Name: negotiation_facts_commitment_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX negotiation_facts_commitment_idx ON public.negotiation_facts USING btree (commitment_type);


--
-- Name: negotiation_facts_provider_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX negotiation_facts_provider_idx ON public.negotiation_facts USING btree (provider_id);


--
-- Name: negotiation_facts_restaurant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX negotiation_facts_restaurant_idx ON public.negotiation_facts USING btree (restaurant_id);


--
-- Name: procurement_conversations_thread_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX procurement_conversations_thread_idx ON public.procurement_conversations USING btree (gmail_thread_id) WHERE (gmail_thread_id IS NOT NULL);


--
-- Name: producers_country_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX producers_country_idx ON public.producers USING btree (country);


--
-- Name: producers_normalized_name_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX producers_normalized_name_key ON public.producers USING btree (normalized_name);


--
-- Name: producers_region_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX producers_region_idx ON public.producers USING btree (region);


--
-- Name: provider_conversation_sessions_thread_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX provider_conversation_sessions_thread_idx ON public.provider_conversation_sessions USING btree (gmail_thread_id);


--
-- Name: uq_conv_attach_sha; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_conv_attach_sha ON public.conversation_attachments USING btree (conversation_id, sha256) WHERE (sha256 IS NOT NULL);


--
-- Name: uq_inbound_active_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_inbound_active_restaurant ON public.restaurant_inbound_addresses USING btree (restaurant_id) WHERE is_active;


--
-- Name: uq_inbound_address; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_inbound_address ON public.restaurant_inbound_addresses USING btree (lower(address));


--
-- Name: uq_inbound_token; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_inbound_token ON public.restaurant_inbound_addresses USING btree (token);


--
-- Name: uq_inventory_transactions_idem; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_inventory_transactions_idem ON public.inventory_transactions USING btree (idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: uq_pc_line_reason; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pc_line_reason ON public.procurement_credits USING btree (document_line_id, reason) WHERE ((document_line_id IS NOT NULL) AND ((state)::text <> 'written_off'::text));


--
-- Name: uq_pd_restaurant_provider_type_number; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pd_restaurant_provider_type_number ON public.procurement_documents USING btree (restaurant_id, provider_id, doc_type, doc_number) WHERE ((doc_number IS NOT NULL) AND ((status)::text <> 'superseded'::text));


--
-- Name: uq_pd_restaurant_sha256; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pd_restaurant_sha256 ON public.procurement_documents USING btree (restaurant_id, sha256) WHERE (sha256 IS NOT NULL);


--
-- Name: uq_pos_checks_source_check; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pos_checks_source_check ON public.pos_checks USING btree (restaurant_id, source, external_check_id);


--
-- Name: uq_pos_item_mappings_identity; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pos_item_mappings_identity ON public.pos_item_mappings USING btree (restaurant_id, source, external_item_id, item_name);


--
-- Name: uq_pre_idempotency; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pre_idempotency ON public.procurement_receipt_events USING btree (idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: uq_prospect_domain; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_prospect_domain ON public.email_prospects USING btree (restaurant_id, domain);


--
-- Name: uq_prospect_triage_domain; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_prospect_triage_domain ON public.email_prospects USING btree (domain) WHERE (restaurant_id IS NULL);


--
-- Name: uq_providers_restaurant_email; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_providers_restaurant_email ON public.providers USING btree (restaurant_id, lower((contact_email)::text)) WHERE ((contact_email IS NOT NULL) AND ((contact_email)::text <> ''::text) AND (deleted_at IS NULL));


--
-- Name: uq_restaurant_tables_label; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_restaurant_tables_label ON public.restaurant_tables USING btree (restaurant_id, label);


--
-- Name: uq_schedule_receipts; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_schedule_receipts ON public.schedule_receipts USING btree (schedule_id, member_id);


--
-- Name: uq_schedules_week; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_schedules_week ON public.schedules USING btree (restaurant_id, week_start);


--
-- Name: uq_sender_rep_domain; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_sender_rep_domain ON public.sender_reputation USING btree (restaurant_id, domain);


--
-- Name: uq_server_sales; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_server_sales ON public.server_sales USING btree (restaurant_id, member_id, service_date);


--
-- Name: uq_team_members_user; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_team_members_user ON public.team_members USING btree (restaurant_id, user_id) WHERE (user_id IS NOT NULL);


--
-- Name: vendor_promotions_provider_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vendor_promotions_provider_id_idx ON public.vendor_promotions USING btree (provider_id);


--
-- Name: vendor_promotions_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vendor_promotions_status_idx ON public.vendor_promotions USING btree (status);


--
-- Name: vendor_promotions_urgency_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vendor_promotions_urgency_idx ON public.vendor_promotions USING btree (urgency_score DESC NULLS LAST);


--
-- Name: vintage_rules_appellation_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vintage_rules_appellation_name_idx ON public.vintage_rules USING btree (appellation_name);


--
-- Name: vintage_rules_region_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vintage_rules_region_id_idx ON public.vintage_rules USING btree (region_id);


--
-- Name: wine_regions_canonical_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wine_regions_canonical_name_idx ON public.wine_regions USING btree (canonical_name);


--
-- Name: wine_regions_country_code_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wine_regions_country_code_idx ON public.wine_regions USING btree (country_code);


--
-- Name: wine_regions_level_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wine_regions_level_idx ON public.wine_regions USING btree (level);


--
-- Name: wine_regions_parent_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wine_regions_parent_id_idx ON public.wine_regions USING btree (parent_id);


--
-- Name: wine_regions_path_btree_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wine_regions_path_btree_idx ON public.wine_regions USING btree (path);


--
-- Name: wine_regions_path_gist_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wine_regions_path_gist_idx ON public.wine_regions USING gist (path);


--
-- Name: communication_templates communication_templates_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER communication_templates_updated_at BEFORE UPDATE ON public.communication_templates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: contacts contacts_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER contacts_updated_at BEFORE UPDATE ON public.contacts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: custom_reminders custom_reminders_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER custom_reminders_updated_at BEFORE UPDATE ON public.custom_reminders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: events events_time_flags_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER events_time_flags_trigger BEFORE INSERT OR UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION public.events_set_time_flags();


--
-- Name: user_onboarding_progress onboarding_progress_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER onboarding_progress_updated_at BEFORE UPDATE ON public.user_onboarding_progress FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: procurement_orders order_delivery_logger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER order_delivery_logger AFTER UPDATE ON public.procurement_orders FOR EACH ROW WHEN ((((new.status)::text = 'delivered'::text) AND ((old.status)::text <> 'delivered'::text))) EXECUTE FUNCTION public.log_order_delivery();


--
-- Name: provider_contacts provider_contacts_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER provider_contacts_updated_at BEFORE UPDATE ON public.provider_contacts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: restaurant_branding restaurant_branding_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER restaurant_branding_updated_at BEFORE UPDATE ON public.restaurant_branding FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: restaurant_menus restaurant_menus_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER restaurant_menus_updated_at BEFORE UPDATE ON public.restaurant_menus FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: master_wine_library set_master_wine_library_search_vector; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_master_wine_library_search_vector BEFORE INSERT OR UPDATE ON public.master_wine_library FOR EACH ROW EXECUTE FUNCTION public.master_wine_library_set_search_vector();


--
-- Name: storage_locations set_storage_locations_full_location; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_storage_locations_full_location BEFORE INSERT OR UPDATE ON public.storage_locations FOR EACH ROW EXECUTE FUNCTION public.storage_locations_set_full_location();


--
-- Name: calendar_events sync_calendar_dates_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER sync_calendar_dates_trigger BEFORE INSERT OR UPDATE ON public.calendar_events FOR EACH ROW EXECUTE FUNCTION public.sync_calendar_event_date_columns();


--
-- Name: restaurant_inventory sync_sku_on_inventory_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER sync_sku_on_inventory_insert BEFORE INSERT ON public.restaurant_inventory FOR EACH ROW EXECUTE FUNCTION public.sync_sku_to_new_inventory();


--
-- Name: master_wine_library trg_library_tier_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_library_tier_updated BEFORE UPDATE ON public.master_wine_library FOR EACH ROW EXECUTE FUNCTION public.update_library_tier_timestamp();


--
-- Name: wine_aliases trg_normalize_alias; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_normalize_alias BEFORE INSERT OR UPDATE ON public.wine_aliases FOR EACH ROW EXECUTE FUNCTION public.normalize_wine_alias();


--
-- Name: procurement_orders trg_order_inventory_restaurant; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_order_inventory_restaurant BEFORE INSERT OR UPDATE OF inventory_id, restaurant_id ON public.procurement_orders FOR EACH ROW EXECUTE FUNCTION public.fn_check_order_inventory_restaurant();


--
-- Name: procurement_credits trg_pc_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_pc_updated_at BEFORE UPDATE ON public.procurement_credits FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: procurement_documents trg_pd_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_pd_updated_at BEFORE UPDATE ON public.procurement_documents FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: procurement_order_items trg_poi_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_poi_updated_at BEFORE UPDATE ON public.procurement_order_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: procurement_conversations trg_procurement_conversations_thread_key; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_procurement_conversations_thread_key BEFORE INSERT OR UPDATE ON public.procurement_conversations FOR EACH ROW EXECUTE FUNCTION public.set_conversation_thread_key();


--
-- Name: producers trg_producers_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_producers_updated_at BEFORE UPDATE ON public.producers FOR EACH ROW EXECUTE FUNCTION public.update_producers_updated_at();


--
-- Name: inventory_lots trg_project_stock_from_lots; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_project_stock_from_lots AFTER INSERT OR DELETE OR UPDATE ON public.inventory_lots FOR EACH ROW EXECUTE FUNCTION public.project_stock_from_lots();


--
-- Name: restaurant_directory trg_rd_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_rd_updated_at BEFORE UPDATE ON public.restaurant_directory FOR EACH ROW EXECUTE FUNCTION public.update_rd_updated_at();


--
-- Name: storage_locations trg_storage_location_name; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_storage_location_name BEFORE INSERT OR UPDATE ON public.storage_locations FOR EACH ROW EXECUTE FUNCTION public._sync_storage_location_name();


--
-- Name: one_tap_actions trigger_one_tap_actions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_one_tap_actions_updated_at BEFORE UPDATE ON public.one_tap_actions FOR EACH ROW EXECUTE FUNCTION public.update_one_tap_actions_updated_at();


--
-- Name: calendar_events update_calendar_events_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_calendar_events_updated_at BEFORE UPDATE ON public.calendar_events FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: manager_preferences update_manager_preferences_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_manager_preferences_updated_at BEFORE UPDATE ON public.manager_preferences FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: manager_report_profiles update_manager_report_profiles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_manager_report_profiles_updated_at BEFORE UPDATE ON public.manager_report_profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: master_wine_library update_master_wine_library_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_master_wine_library_updated_at BEFORE UPDATE ON public.master_wine_library FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: master_wine_library_submissions update_mwls_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_mwls_updated_at BEFORE UPDATE ON public.master_wine_library_submissions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: order_interactions update_order_interactions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_order_interactions_updated_at BEFORE UPDATE ON public.order_interactions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: procurement_order_items update_procurement_order_items_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_procurement_order_items_updated_at BEFORE UPDATE ON public.procurement_order_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: procurement_orders update_procurement_orders_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_procurement_orders_updated_at BEFORE UPDATE ON public.procurement_orders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: providers update_providers_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_providers_updated_at BEFORE UPDATE ON public.providers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: recurring_orders update_recurring_orders_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_recurring_orders_updated_at BEFORE UPDATE ON public.recurring_orders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: restaurant_inventory update_restaurant_inventory_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_restaurant_inventory_updated_at BEFORE UPDATE ON public.restaurant_inventory FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: restaurant_providers update_restaurant_providers_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_restaurant_providers_updated_at BEFORE UPDATE ON public.restaurant_providers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: restaurants update_restaurants_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_restaurants_updated_at BEFORE UPDATE ON public.restaurants FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: rfq_requests update_rfq_requests_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_rfq_requests_updated_at BEFORE UPDATE ON public.rfq_requests FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: sku_mappings update_sku_mappings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_sku_mappings_updated_at BEFORE UPDATE ON public.sku_mappings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: toast_item_mappings update_toast_item_mappings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_toast_item_mappings_updated_at BEFORE UPDATE ON public.toast_item_mappings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: vendor_deadlines update_vendor_deadlines_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_vendor_deadlines_updated_at BEFORE UPDATE ON public.vendor_deadlines FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: wine_unit_defaults update_wine_unit_defaults_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_wine_unit_defaults_updated_at BEFORE UPDATE ON public.wine_unit_defaults FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: user_preferences user_preferences_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER user_preferences_updated_at BEFORE UPDATE ON public.user_preferences FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: agent_activity_logs agent_activity_logs_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_activity_logs
    ADD CONSTRAINT agent_activity_logs_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id);


--
-- Name: agent_evolution_log agent_evolution_log_experiment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_evolution_log
    ADD CONSTRAINT agent_evolution_log_experiment_id_fkey FOREIGN KEY (experiment_id) REFERENCES public.ab_experiments(id);


--
-- Name: ai_feedback_loop ai_feedback_loop_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_feedback_loop
    ADD CONSTRAINT ai_feedback_loop_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: analytics_cache analytics_cache_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_cache
    ADD CONSTRAINT analytics_cache_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: appellation_rules appellation_rules_appellation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appellation_rules
    ADD CONSTRAINT appellation_rules_appellation_id_fkey FOREIGN KEY (appellation_id) REFERENCES public.wine_regions(id) ON DELETE SET NULL;


--
-- Name: batch_operations batch_operations_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.batch_operations
    ADD CONSTRAINT batch_operations_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: budgets budgets_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budgets
    ADD CONSTRAINT budgets_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: calendar_event_types calendar_event_types_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_event_types
    ADD CONSTRAINT calendar_event_types_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: calendar_events calendar_events_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_events
    ADD CONSTRAINT calendar_events_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.procurement_orders(id);


--
-- Name: calendar_events calendar_events_parent_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_events
    ADD CONSTRAINT calendar_events_parent_event_id_fkey FOREIGN KEY (parent_event_id) REFERENCES public.calendar_events(id) ON DELETE CASCADE;


--
-- Name: calendar_events calendar_events_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_events
    ADD CONSTRAINT calendar_events_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.providers(id);


--
-- Name: calendar_events calendar_events_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_events
    ADD CONSTRAINT calendar_events_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: calendar_recurrence_exceptions calendar_recurrence_exceptions_recurrence_rule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_recurrence_exceptions
    ADD CONSTRAINT calendar_recurrence_exceptions_recurrence_rule_id_fkey FOREIGN KEY (recurrence_rule_id) REFERENCES public.calendar_recurrence_rules(id) ON DELETE CASCADE;


--
-- Name: calendar_recurrence_exceptions calendar_recurrence_exceptions_replacement_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_recurrence_exceptions
    ADD CONSTRAINT calendar_recurrence_exceptions_replacement_event_id_fkey FOREIGN KEY (replacement_event_id) REFERENCES public.calendar_events(id) ON DELETE SET NULL;


--
-- Name: calendar_recurrence_rules calendar_recurrence_rules_calendar_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_recurrence_rules
    ADD CONSTRAINT calendar_recurrence_rules_calendar_event_id_fkey FOREIGN KEY (calendar_event_id) REFERENCES public.calendar_events(id) ON DELETE CASCADE;


--
-- Name: calendar_recurrence_rules calendar_recurrence_rules_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_recurrence_rules
    ADD CONSTRAINT calendar_recurrence_rules_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: communication_templates communication_templates_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communication_templates
    ADD CONSTRAINT communication_templates_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: contact_addresses contact_addresses_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_addresses
    ADD CONSTRAINT contact_addresses_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE;


--
-- Name: contacts contacts_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE SET NULL;


--
-- Name: conversation_attachments conversation_attachments_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_attachments
    ADD CONSTRAINT conversation_attachments_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.procurement_conversations(id) ON DELETE CASCADE;


--
-- Name: conversation_embeddings conversation_embeddings_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_embeddings
    ADD CONSTRAINT conversation_embeddings_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.providers(id) ON DELETE CASCADE;


--
-- Name: conversation_embeddings conversation_embeddings_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_embeddings
    ADD CONSTRAINT conversation_embeddings_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: crawl_log crawl_log_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crawl_log
    ADD CONSTRAINT crawl_log_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurant_directory(id) ON DELETE CASCADE;


--
-- Name: crawl_schedule crawl_schedule_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crawl_schedule
    ADD CONSTRAINT crawl_schedule_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurant_directory(id) ON DELETE CASCADE;


--
-- Name: custom_reminders custom_reminders_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_reminders
    ADD CONSTRAINT custom_reminders_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: decision_log decision_log_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.decision_log
    ADD CONSTRAINT decision_log_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE SET NULL;


--
-- Name: email_verifications email_verifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_verifications
    ADD CONSTRAINT email_verifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: email_watch_state email_watch_state_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_watch_state
    ADD CONSTRAINT email_watch_state_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: enrichment_queue enrichment_queue_wine_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrichment_queue
    ADD CONSTRAINT enrichment_queue_wine_id_fkey FOREIGN KEY (wine_id) REFERENCES public.master_wine_library(id) ON DELETE CASCADE;


--
-- Name: event_dead_letters event_dead_letters_resolved_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_dead_letters
    ADD CONSTRAINT event_dead_letters_resolved_event_id_fkey FOREIGN KEY (resolved_event_id) REFERENCES public.events(id);


--
-- Name: event_dead_letters event_dead_letters_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_dead_letters
    ADD CONSTRAINT event_dead_letters_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id);


--
-- Name: event_replay_jobs event_replay_jobs_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_replay_jobs
    ADD CONSTRAINT event_replay_jobs_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id);


--
-- Name: events events_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: evidence_citations evidence_citations_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evidence_citations
    ADD CONSTRAINT evidence_citations_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.research_runs(id) ON DELETE SET NULL;


--
-- Name: export_history export_history_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.export_history
    ADD CONSTRAINT export_history_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: field_review_queue field_review_queue_submission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.field_review_queue
    ADD CONSTRAINT field_review_queue_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.master_wine_library_submissions(id) ON DELETE CASCADE;


--
-- Name: inventory_events fk_inventory_events_master; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_events
    ADD CONSTRAINT fk_inventory_events_master FOREIGN KEY (master_wine_id) REFERENCES public.master_wine_library(id) ON DELETE SET NULL;


--
-- Name: master_wine_library_submissions fk_mwls_master; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.master_wine_library_submissions
    ADD CONSTRAINT fk_mwls_master FOREIGN KEY (matched_master_id) REFERENCES public.master_wine_library(id) ON DELETE SET NULL;


--
-- Name: generated_reports generated_reports_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generated_reports
    ADD CONSTRAINT generated_reports_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.manager_report_profiles(id);


--
-- Name: generated_reports generated_reports_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generated_reports
    ADD CONSTRAINT generated_reports_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: glass_pour_tracking glass_pour_tracking_inventory_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.glass_pour_tracking
    ADD CONSTRAINT glass_pour_tracking_inventory_id_fkey FOREIGN KEY (inventory_id) REFERENCES public.restaurant_inventory(id);


--
-- Name: glass_pour_tracking glass_pour_tracking_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.glass_pour_tracking
    ADD CONSTRAINT glass_pour_tracking_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: inventory_lots inventory_lots_inventory_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_lots
    ADD CONSTRAINT inventory_lots_inventory_id_fkey FOREIGN KEY (inventory_id) REFERENCES public.restaurant_inventory(id) ON DELETE CASCADE;


--
-- Name: inventory_lots inventory_lots_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_lots
    ADD CONSTRAINT inventory_lots_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.storage_locations(id) ON DELETE SET NULL;


--
-- Name: inventory_transactions inventory_transactions_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_transactions
    ADD CONSTRAINT inventory_transactions_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: manager_report_profiles manager_report_profiles_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manager_report_profiles
    ADD CONSTRAINT manager_report_profiles_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: menu_changes menu_changes_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.menu_changes
    ADD CONSTRAINT menu_changes_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurant_directory(id) ON DELETE CASCADE;


--
-- Name: menu_items menu_items_menu_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.menu_items
    ADD CONSTRAINT menu_items_menu_id_fkey FOREIGN KEY (menu_id) REFERENCES public.restaurant_menus(id) ON DELETE CASCADE;


--
-- Name: menu_items menu_items_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.menu_items
    ADD CONSTRAINT menu_items_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: menu_items menu_items_submission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.menu_items
    ADD CONSTRAINT menu_items_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.master_wine_library_submissions(id) ON DELETE SET NULL;


--
-- Name: menu_items menu_items_wine_library_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.menu_items
    ADD CONSTRAINT menu_items_wine_library_id_fkey FOREIGN KEY (wine_library_id) REFERENCES public.master_wine_library(id) ON DELETE SET NULL;


--
-- Name: message_templates message_templates_parent_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_templates
    ADD CONSTRAINT message_templates_parent_template_id_fkey FOREIGN KEY (parent_template_id) REFERENCES public.message_templates(id);


--
-- Name: message_templates message_templates_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_templates
    ADD CONSTRAINT message_templates_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: negotiation_facts negotiation_facts_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.negotiation_facts
    ADD CONSTRAINT negotiation_facts_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.providers(id) ON DELETE CASCADE;


--
-- Name: negotiation_facts negotiation_facts_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.negotiation_facts
    ADD CONSTRAINT negotiation_facts_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: negotiation_facts negotiation_facts_supersedes_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.negotiation_facts
    ADD CONSTRAINT negotiation_facts_supersedes_id_fkey FOREIGN KEY (supersedes_id) REFERENCES public.negotiation_facts(id);


--
-- Name: notification_preferences notification_preferences_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: one_tap_actions one_tap_actions_executed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.one_tap_actions
    ADD CONSTRAINT one_tap_actions_executed_by_fkey FOREIGN KEY (executed_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: one_tap_actions one_tap_actions_related_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.one_tap_actions
    ADD CONSTRAINT one_tap_actions_related_order_id_fkey FOREIGN KEY (related_order_id) REFERENCES public.procurement_orders(id) ON DELETE SET NULL;


--
-- Name: one_tap_actions one_tap_actions_related_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.one_tap_actions
    ADD CONSTRAINT one_tap_actions_related_provider_id_fkey FOREIGN KEY (related_provider_id) REFERENCES public.providers(id) ON DELETE SET NULL;


--
-- Name: one_tap_actions one_tap_actions_related_wine_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.one_tap_actions
    ADD CONSTRAINT one_tap_actions_related_wine_id_fkey FOREIGN KEY (related_wine_id) REFERENCES public.master_wine_library(id) ON DELETE SET NULL;


--
-- Name: one_tap_actions one_tap_actions_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.one_tap_actions
    ADD CONSTRAINT one_tap_actions_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: one_tap_actions one_tap_actions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.one_tap_actions
    ADD CONSTRAINT one_tap_actions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: order_interactions order_interactions_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_interactions
    ADD CONSTRAINT order_interactions_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.procurement_orders(id) ON DELETE CASCADE;


--
-- Name: organization_invites organization_invites_invited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_invites
    ADD CONSTRAINT organization_invites_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: organization_invites organization_invites_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_invites
    ADD CONSTRAINT organization_invites_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: organization_invites organization_invites_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_invites
    ADD CONSTRAINT organization_invites_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: organization_members organization_members_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_members
    ADD CONSTRAINT organization_members_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: organization_members organization_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_members
    ADD CONSTRAINT organization_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: organizations organizations_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- Name: override_events override_events_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.override_events
    ADD CONSTRAINT override_events_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.onboarding_sessions(id) ON DELETE CASCADE;


--
-- Name: pos_checks pos_checks_table_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_checks
    ADD CONSTRAINT pos_checks_table_id_fkey FOREIGN KEY (table_id) REFERENCES public.restaurant_tables(id);


--
-- Name: prediction_outcomes prediction_outcomes_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prediction_outcomes
    ADD CONSTRAINT prediction_outcomes_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: price_history price_history_master_wine_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_history
    ADD CONSTRAINT price_history_master_wine_id_fkey FOREIGN KEY (master_wine_id) REFERENCES public.master_wine_library(id);


--
-- Name: price_history price_history_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_history
    ADD CONSTRAINT price_history_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.procurement_orders(id);


--
-- Name: price_history price_history_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_history
    ADD CONSTRAINT price_history_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.providers(id);


--
-- Name: price_history price_history_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_history
    ADD CONSTRAINT price_history_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: procurement_conversations procurement_conversations_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_conversations
    ADD CONSTRAINT procurement_conversations_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.procurement_orders(id) ON DELETE SET NULL;


--
-- Name: procurement_conversations procurement_conversations_parent_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_conversations
    ADD CONSTRAINT procurement_conversations_parent_message_id_fkey FOREIGN KEY (parent_message_id) REFERENCES public.procurement_conversations(id);


--
-- Name: procurement_conversations procurement_conversations_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_conversations
    ADD CONSTRAINT procurement_conversations_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.providers(id);


--
-- Name: procurement_conversations procurement_conversations_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_conversations
    ADD CONSTRAINT procurement_conversations_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: procurement_credits procurement_credits_credit_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_credits
    ADD CONSTRAINT procurement_credits_credit_document_id_fkey FOREIGN KEY (credit_document_id) REFERENCES public.procurement_documents(id) ON DELETE SET NULL;


--
-- Name: procurement_credits procurement_credits_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_credits
    ADD CONSTRAINT procurement_credits_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.procurement_documents(id) ON DELETE SET NULL;


--
-- Name: procurement_credits procurement_credits_document_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_credits
    ADD CONSTRAINT procurement_credits_document_line_id_fkey FOREIGN KEY (document_line_id) REFERENCES public.procurement_document_lines(id) ON DELETE SET NULL;


--
-- Name: procurement_credits procurement_credits_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_credits
    ADD CONSTRAINT procurement_credits_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.procurement_orders(id) ON DELETE SET NULL;


--
-- Name: procurement_credits procurement_credits_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_credits
    ADD CONSTRAINT procurement_credits_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.providers(id);


--
-- Name: procurement_credits procurement_credits_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_credits
    ADD CONSTRAINT procurement_credits_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: procurement_document_lines procurement_document_lines_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_document_lines
    ADD CONSTRAINT procurement_document_lines_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.procurement_documents(id) ON DELETE CASCADE;


--
-- Name: procurement_document_lines procurement_document_lines_order_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_document_lines
    ADD CONSTRAINT procurement_document_lines_order_line_id_fkey FOREIGN KEY (order_line_id) REFERENCES public.procurement_order_items(id) ON DELETE SET NULL;


--
-- Name: procurement_document_lines procurement_document_lines_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_document_lines
    ADD CONSTRAINT procurement_document_lines_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: procurement_document_links procurement_document_links_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_document_links
    ADD CONSTRAINT procurement_document_links_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.procurement_documents(id) ON DELETE CASCADE;


--
-- Name: procurement_document_links procurement_document_links_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_document_links
    ADD CONSTRAINT procurement_document_links_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.procurement_orders(id) ON DELETE CASCADE;


--
-- Name: procurement_document_links procurement_document_links_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_document_links
    ADD CONSTRAINT procurement_document_links_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: procurement_documents procurement_documents_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_documents
    ADD CONSTRAINT procurement_documents_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.providers(id);


--
-- Name: procurement_documents procurement_documents_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_documents
    ADD CONSTRAINT procurement_documents_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: procurement_order_items procurement_order_items_inventory_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_order_items
    ADD CONSTRAINT procurement_order_items_inventory_id_fkey FOREIGN KEY (inventory_id) REFERENCES public.restaurant_inventory(id);


--
-- Name: procurement_order_items procurement_order_items_master_wine_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_order_items
    ADD CONSTRAINT procurement_order_items_master_wine_id_fkey FOREIGN KEY (master_wine_id) REFERENCES public.master_wine_library(id);


--
-- Name: procurement_order_items procurement_order_items_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_order_items
    ADD CONSTRAINT procurement_order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.procurement_orders(id) ON DELETE CASCADE;


--
-- Name: procurement_order_items procurement_order_items_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_order_items
    ADD CONSTRAINT procurement_order_items_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: procurement_orders procurement_orders_inventory_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_orders
    ADD CONSTRAINT procurement_orders_inventory_id_fkey FOREIGN KEY (inventory_id) REFERENCES public.restaurant_inventory(id);


--
-- Name: procurement_orders procurement_orders_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_orders
    ADD CONSTRAINT procurement_orders_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.providers(id);


--
-- Name: procurement_orders procurement_orders_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_orders
    ADD CONSTRAINT procurement_orders_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: procurement_receipt_events procurement_receipt_events_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_receipt_events
    ADD CONSTRAINT procurement_receipt_events_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.procurement_documents(id) ON DELETE SET NULL;


--
-- Name: procurement_receipt_events procurement_receipt_events_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_receipt_events
    ADD CONSTRAINT procurement_receipt_events_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.procurement_orders(id) ON DELETE CASCADE;


--
-- Name: procurement_receipt_events procurement_receipt_events_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_receipt_events
    ADD CONSTRAINT procurement_receipt_events_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: provider_contacts provider_contacts_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_contacts
    ADD CONSTRAINT provider_contacts_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.providers(id) ON DELETE CASCADE;


--
-- Name: provider_conversation_sessions provider_conversation_sessions_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_conversation_sessions
    ADD CONSTRAINT provider_conversation_sessions_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.providers(id) ON DELETE CASCADE;


--
-- Name: provider_knowledge provider_knowledge_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_knowledge
    ADD CONSTRAINT provider_knowledge_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.providers(id) ON DELETE CASCADE;


--
-- Name: provider_locations provider_locations_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_locations
    ADD CONSTRAINT provider_locations_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.providers(id) ON DELETE CASCADE;


--
-- Name: provider_locations provider_locations_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_locations
    ADD CONSTRAINT provider_locations_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: provider_performance_metrics provider_performance_metrics_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_performance_metrics
    ADD CONSTRAINT provider_performance_metrics_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.providers(id) ON DELETE CASCADE;


--
-- Name: provider_performance_metrics provider_performance_metrics_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_performance_metrics
    ADD CONSTRAINT provider_performance_metrics_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id);


--
-- Name: provider_promotions provider_promotions_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_promotions
    ADD CONSTRAINT provider_promotions_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.providers(id) ON DELETE CASCADE;


--
-- Name: provider_sentiment_history provider_sentiment_history_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_sentiment_history
    ADD CONSTRAINT provider_sentiment_history_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.providers(id) ON DELETE CASCADE;


--
-- Name: provider_sentiment_history provider_sentiment_history_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_sentiment_history
    ADD CONSTRAINT provider_sentiment_history_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.provider_conversation_sessions(id);


--
-- Name: providers providers_catalogue_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.providers
    ADD CONSTRAINT providers_catalogue_vendor_id_fkey FOREIGN KEY (catalogue_vendor_id) REFERENCES public.vendor_catalogue(id) ON DELETE SET NULL;


--
-- Name: providers providers_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.providers
    ADD CONSTRAINT providers_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: research_run_stats research_run_stats_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_run_stats
    ADD CONSTRAINT research_run_stats_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.research_runs(id) ON DELETE CASCADE;


--
-- Name: restaurant_branding restaurant_branding_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurant_branding
    ADD CONSTRAINT restaurant_branding_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: restaurant_chains restaurant_chains_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurant_chains
    ADD CONSTRAINT restaurant_chains_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: restaurant_feature_flags restaurant_feature_flags_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurant_feature_flags
    ADD CONSTRAINT restaurant_feature_flags_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: restaurant_inbound_addresses restaurant_inbound_addresses_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurant_inbound_addresses
    ADD CONSTRAINT restaurant_inbound_addresses_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: restaurant_inventory restaurant_inventory_master_wine_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurant_inventory
    ADD CONSTRAINT restaurant_inventory_master_wine_id_fkey FOREIGN KEY (master_wine_id) REFERENCES public.master_wine_library(id) ON DELETE CASCADE;


--
-- Name: restaurant_inventory restaurant_inventory_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurant_inventory
    ADD CONSTRAINT restaurant_inventory_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.providers(id);


--
-- Name: restaurant_inventory restaurant_inventory_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurant_inventory
    ADD CONSTRAINT restaurant_inventory_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: restaurant_inventory restaurant_inventory_storage_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurant_inventory
    ADD CONSTRAINT restaurant_inventory_storage_location_id_fkey FOREIGN KEY (storage_location_id) REFERENCES public.storage_locations(id);


--
-- Name: restaurant_menus restaurant_menus_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurant_menus
    ADD CONSTRAINT restaurant_menus_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: restaurant_providers restaurant_providers_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurant_providers
    ADD CONSTRAINT restaurant_providers_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.providers(id) ON DELETE CASCADE;


--
-- Name: restaurant_providers restaurant_providers_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurant_providers
    ADD CONSTRAINT restaurant_providers_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: restaurant_wine_roster restaurant_wine_roster_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurant_wine_roster
    ADD CONSTRAINT restaurant_wine_roster_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurant_directory(id) ON DELETE CASCADE;


--
-- Name: restaurants restaurants_chain_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurants
    ADD CONSTRAINT restaurants_chain_id_fkey FOREIGN KEY (chain_id) REFERENCES public.restaurant_chains(id) ON DELETE SET NULL;


--
-- Name: restaurants restaurants_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurants
    ADD CONSTRAINT restaurants_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE SET NULL;


--
-- Name: restaurants restaurants_parent_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurants
    ADD CONSTRAINT restaurants_parent_restaurant_id_fkey FOREIGN KEY (parent_restaurant_id) REFERENCES public.restaurants(id);


--
-- Name: rfq_requests rfq_requests_inventory_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rfq_requests
    ADD CONSTRAINT rfq_requests_inventory_id_fkey FOREIGN KEY (inventory_id) REFERENCES public.restaurant_inventory(id);


--
-- Name: rfq_requests rfq_requests_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rfq_requests
    ADD CONSTRAINT rfq_requests_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: rfq_requests rfq_requests_selected_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rfq_requests
    ADD CONSTRAINT rfq_requests_selected_vendor_id_fkey FOREIGN KEY (selected_vendor_id) REFERENCES public.providers(id);


--
-- Name: sales_events sales_events_inventory_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_events
    ADD CONSTRAINT sales_events_inventory_id_fkey FOREIGN KEY (inventory_id) REFERENCES public.restaurant_inventory(id);


--
-- Name: sales_events sales_events_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_events
    ADD CONSTRAINT sales_events_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: schedule_receipts schedule_receipts_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_receipts
    ADD CONSTRAINT schedule_receipts_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.team_members(id) ON DELETE CASCADE;


--
-- Name: schedule_receipts schedule_receipts_schedule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_receipts
    ADD CONSTRAINT schedule_receipts_schedule_id_fkey FOREIGN KEY (schedule_id) REFERENCES public.schedules(id) ON DELETE CASCADE;


--
-- Name: server_sales server_sales_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.server_sales
    ADD CONSTRAINT server_sales_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.team_members(id) ON DELETE CASCADE;


--
-- Name: shift_breaks shift_breaks_covered_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_breaks
    ADD CONSTRAINT shift_breaks_covered_by_fkey FOREIGN KEY (covered_by) REFERENCES public.team_members(id) ON DELETE SET NULL;


--
-- Name: shift_breaks shift_breaks_shift_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_breaks
    ADD CONSTRAINT shift_breaks_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES public.shifts(id) ON DELETE CASCADE;


--
-- Name: shifts shifts_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shifts
    ADD CONSTRAINT shifts_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.team_members(id) ON DELETE CASCADE;


--
-- Name: shifts shifts_schedule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shifts
    ADD CONSTRAINT shifts_schedule_id_fkey FOREIGN KEY (schedule_id) REFERENCES public.schedules(id) ON DELETE SET NULL;


--
-- Name: sim_ground_truth_facts sim_ground_truth_facts_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sim_ground_truth_facts
    ADD CONSTRAINT sim_ground_truth_facts_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: sim_ground_truth_facts sim_ground_truth_facts_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sim_ground_truth_facts
    ADD CONSTRAINT sim_ground_truth_facts_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.sim_ground_truth_runs(id) ON DELETE CASCADE;


--
-- Name: sim_ground_truth_runs sim_ground_truth_runs_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sim_ground_truth_runs
    ADD CONSTRAINT sim_ground_truth_runs_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: sku_mappings sku_mappings_inventory_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sku_mappings
    ADD CONSTRAINT sku_mappings_inventory_id_fkey FOREIGN KEY (inventory_id) REFERENCES public.restaurant_inventory(id);


--
-- Name: sku_mappings sku_mappings_master_wine_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sku_mappings
    ADD CONSTRAINT sku_mappings_master_wine_id_fkey FOREIGN KEY (master_wine_id) REFERENCES public.master_wine_library(id);


--
-- Name: sku_mappings sku_mappings_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sku_mappings
    ADD CONSTRAINT sku_mappings_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.providers(id);


--
-- Name: sku_mappings sku_mappings_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sku_mappings
    ADD CONSTRAINT sku_mappings_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: sommelier_conversations sommelier_conversations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sommelier_conversations
    ADD CONSTRAINT sommelier_conversations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: storage_locations storage_locations_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storage_locations
    ADD CONSTRAINT storage_locations_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: supplier_catalogs supplier_catalogs_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_catalogs
    ADD CONSTRAINT supplier_catalogs_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.providers(id) ON DELETE CASCADE;


--
-- Name: swap_requests swap_requests_from_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.swap_requests
    ADD CONSTRAINT swap_requests_from_member_id_fkey FOREIGN KEY (from_member_id) REFERENCES public.team_members(id) ON DELETE SET NULL;


--
-- Name: swap_requests swap_requests_shift_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.swap_requests
    ADD CONSTRAINT swap_requests_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES public.shifts(id) ON DELETE CASCADE;


--
-- Name: swap_requests swap_requests_to_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.swap_requests
    ADD CONSTRAINT swap_requests_to_member_id_fkey FOREIGN KEY (to_member_id) REFERENCES public.team_members(id) ON DELETE SET NULL;


--
-- Name: system_audit_log system_audit_log_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_audit_log
    ADD CONSTRAINT system_audit_log_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id);


--
-- Name: system_learning_state system_learning_state_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_learning_state
    ADD CONSTRAINT system_learning_state_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: team_availability team_availability_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_availability
    ADD CONSTRAINT team_availability_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.team_members(id) ON DELETE CASCADE;


--
-- Name: team_certifications team_certifications_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_certifications
    ADD CONSTRAINT team_certifications_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.team_members(id) ON DELETE CASCADE;


--
-- Name: time_off_requests time_off_requests_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_off_requests
    ADD CONSTRAINT time_off_requests_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.team_members(id) ON DELETE CASCADE;


--
-- Name: toast_item_mappings toast_item_mappings_inventory_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.toast_item_mappings
    ADD CONSTRAINT toast_item_mappings_inventory_id_fkey FOREIGN KEY (inventory_id) REFERENCES public.restaurant_inventory(id);


--
-- Name: toast_item_mappings toast_item_mappings_master_wine_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.toast_item_mappings
    ADD CONSTRAINT toast_item_mappings_master_wine_id_fkey FOREIGN KEY (master_wine_id) REFERENCES public.master_wine_library(id);


--
-- Name: toast_item_mappings toast_item_mappings_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.toast_item_mappings
    ADD CONSTRAINT toast_item_mappings_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: training_datasets training_datasets_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_datasets
    ADD CONSTRAINT training_datasets_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE SET NULL;


--
-- Name: trending_wines trending_wines_wine_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trending_wines
    ADD CONSTRAINT trending_wines_wine_id_fkey FOREIGN KEY (wine_id) REFERENCES public.master_wine_library(id) ON DELETE CASCADE;


--
-- Name: user_oauth_accounts user_oauth_accounts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_oauth_accounts
    ADD CONSTRAINT user_oauth_accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: user_onboarding_progress user_onboarding_progress_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_onboarding_progress
    ADD CONSTRAINT user_onboarding_progress_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: user_onboarding_progress user_onboarding_progress_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_onboarding_progress
    ADD CONSTRAINT user_onboarding_progress_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: user_restaurant_access user_restaurant_access_deactivated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_restaurant_access
    ADD CONSTRAINT user_restaurant_access_deactivated_by_fkey FOREIGN KEY (deactivated_by) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- Name: user_restaurant_access user_restaurant_access_invited_via_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_restaurant_access
    ADD CONSTRAINT user_restaurant_access_invited_via_fkey FOREIGN KEY (invited_via) REFERENCES public.organization_invites(id) ON DELETE SET NULL;


--
-- Name: user_restaurant_access user_restaurant_access_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_restaurant_access
    ADD CONSTRAINT user_restaurant_access_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: users users_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE SET NULL;


--
-- Name: vendor_promotions vendor_promotions_detected_from_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_promotions
    ADD CONSTRAINT vendor_promotions_detected_from_conversation_id_fkey FOREIGN KEY (detected_from_conversation_id) REFERENCES public.procurement_conversations(id);


--
-- Name: vendor_promotions vendor_promotions_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_promotions
    ADD CONSTRAINT vendor_promotions_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.providers(id) ON DELETE CASCADE;


--
-- Name: vendor_promotions vendor_promotions_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_promotions
    ADD CONSTRAINT vendor_promotions_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: vintage_rules vintage_rules_region_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vintage_rules
    ADD CONSTRAINT vintage_rules_region_id_fkey FOREIGN KEY (region_id) REFERENCES public.wine_regions(id) ON DELETE SET NULL;


--
-- Name: vintage_substitution_rules vintage_substitution_rules_master_wine_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vintage_substitution_rules
    ADD CONSTRAINT vintage_substitution_rules_master_wine_id_fkey FOREIGN KEY (master_wine_id) REFERENCES public.master_wine_library(id);


--
-- Name: vintage_substitution_rules vintage_substitution_rules_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vintage_substitution_rules
    ADD CONSTRAINT vintage_substitution_rules_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: wine_aliases wine_aliases_canonical_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wine_aliases
    ADD CONSTRAINT wine_aliases_canonical_id_fkey FOREIGN KEY (canonical_id) REFERENCES public.master_wine_library(id) ON DELETE CASCADE;


--
-- Name: wine_consumption_log wine_consumption_log_inventory_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wine_consumption_log
    ADD CONSTRAINT wine_consumption_log_inventory_id_fkey FOREIGN KEY (inventory_id) REFERENCES public.restaurant_inventory(id) ON DELETE CASCADE;


--
-- Name: wine_consumption_log wine_consumption_log_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wine_consumption_log
    ADD CONSTRAINT wine_consumption_log_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: wine_location_mappings wine_location_mappings_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wine_location_mappings
    ADD CONSTRAINT wine_location_mappings_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.storage_locations(id) ON DELETE CASCADE;


--
-- Name: wine_location_mappings wine_location_mappings_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wine_location_mappings
    ADD CONSTRAINT wine_location_mappings_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: wine_menu_prices wine_menu_prices_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wine_menu_prices
    ADD CONSTRAINT wine_menu_prices_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: wine_menu_prices wine_menu_prices_wine_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wine_menu_prices
    ADD CONSTRAINT wine_menu_prices_wine_id_fkey FOREIGN KEY (wine_id) REFERENCES public.master_wine_library(id) ON DELETE CASCADE;


--
-- Name: wine_popularity wine_popularity_wine_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wine_popularity
    ADD CONSTRAINT wine_popularity_wine_id_fkey FOREIGN KEY (wine_id) REFERENCES public.master_wine_library(id) ON DELETE CASCADE;


--
-- Name: wine_regions wine_regions_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wine_regions
    ADD CONSTRAINT wine_regions_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.wine_regions(id) ON DELETE SET NULL;


--
-- Name: order_interactions Managers can view order interactions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Managers can view order interactions" ON public.order_interactions FOR SELECT USING ((order_id IN ( SELECT procurement_orders.id
   FROM public.procurement_orders
  WHERE (procurement_orders.restaurant_id IN ( SELECT user_restaurant_access.restaurant_id
           FROM public.user_restaurant_access
          WHERE (user_restaurant_access.user_id = auth.uid()))))));


--
-- Name: restaurant_inventory Managers can view their restaurant data; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Managers can view their restaurant data" ON public.restaurant_inventory FOR SELECT USING ((restaurant_id IN ( SELECT user_restaurant_access.restaurant_id
   FROM public.user_restaurant_access
  WHERE (user_restaurant_access.user_id = auth.uid()))));


--
-- Name: sommelier_conversations Service role full access on sommelier_conversations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role full access on sommelier_conversations" ON public.sommelier_conversations TO service_role USING (true) WITH CHECK (true);


--
-- Name: training_datasets Service role full access on training_datasets; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role full access on training_datasets" ON public.training_datasets USING (true) WITH CHECK (true);


--
-- Name: events Users can insert events for their restaurant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert events for their restaurant" ON public.events FOR INSERT WITH CHECK ((restaurant_id IN ( SELECT user_restaurant_access.restaurant_id
   FROM public.user_restaurant_access
  WHERE (user_restaurant_access.user_id = auth.uid()))));


--
-- Name: inventory_transactions Users can insert transactions for their restaurant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert transactions for their restaurant" ON public.inventory_transactions FOR INSERT WITH CHECK ((restaurant_id IN ( SELECT user_restaurant_access.restaurant_id
   FROM public.user_restaurant_access
  WHERE (user_restaurant_access.user_id = auth.uid()))));


--
-- Name: manager_preferences Users can manage own preferences; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can manage own preferences" ON public.manager_preferences USING ((manager_id = auth.uid())) WITH CHECK ((manager_id = auth.uid()));


--
-- Name: calendar_event_types Users can manage their restaurant event types; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can manage their restaurant event types" ON public.calendar_event_types USING (true) WITH CHECK (true);


--
-- Name: calendar_recurrence_rules Users can manage their restaurant recurrence rules; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can manage their restaurant recurrence rules" ON public.calendar_recurrence_rules USING ((restaurant_id IN ( SELECT user_restaurant_access.restaurant_id
   FROM public.user_restaurant_access
  WHERE (user_restaurant_access.user_id = auth.uid()))));


--
-- Name: sku_mappings Users can view SKU mappings for their restaurant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view SKU mappings for their restaurant" ON public.sku_mappings FOR SELECT USING (((restaurant_id IS NULL) OR (restaurant_id IN ( SELECT user_restaurant_access.restaurant_id
   FROM public.user_restaurant_access
  WHERE (user_restaurant_access.user_id = auth.uid())))));


--
-- Name: event_replay_jobs Users can view replay jobs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view replay jobs" ON public.event_replay_jobs FOR SELECT USING (((restaurant_id IS NULL) OR (restaurant_id IN ( SELECT user_restaurant_access.restaurant_id
   FROM public.user_restaurant_access
  WHERE (user_restaurant_access.user_id = auth.uid())))));


--
-- Name: event_dead_letters Users can view their restaurant DLQ; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their restaurant DLQ" ON public.event_dead_letters FOR SELECT USING ((restaurant_id IN ( SELECT user_restaurant_access.restaurant_id
   FROM public.user_restaurant_access
  WHERE (user_restaurant_access.user_id = auth.uid()))));


--
-- Name: events Users can view their restaurant events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their restaurant events" ON public.events FOR SELECT USING ((restaurant_id IN ( SELECT user_restaurant_access.restaurant_id
   FROM public.user_restaurant_access
  WHERE (user_restaurant_access.user_id = auth.uid()))));


--
-- Name: calendar_recurrence_exceptions Users can view their restaurant recurrence exceptions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their restaurant recurrence exceptions" ON public.calendar_recurrence_exceptions FOR SELECT USING ((recurrence_rule_id IN ( SELECT calendar_recurrence_rules.id
   FROM public.calendar_recurrence_rules
  WHERE (calendar_recurrence_rules.restaurant_id IN ( SELECT user_restaurant_access.restaurant_id
           FROM public.user_restaurant_access
          WHERE (user_restaurant_access.user_id = auth.uid()))))));


--
-- Name: calendar_recurrence_rules Users can view their restaurant recurrence rules; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their restaurant recurrence rules" ON public.calendar_recurrence_rules FOR SELECT USING ((restaurant_id IN ( SELECT user_restaurant_access.restaurant_id
   FROM public.user_restaurant_access
  WHERE (user_restaurant_access.user_id = auth.uid()))));


--
-- Name: inventory_transactions Users can view their restaurant transactions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their restaurant transactions" ON public.inventory_transactions FOR SELECT USING ((restaurant_id IN ( SELECT user_restaurant_access.restaurant_id
   FROM public.user_restaurant_access
  WHERE (user_restaurant_access.user_id = auth.uid()))));


--
-- Name: sommelier_conversations Users manage own sommelier conversations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own sommelier conversations" ON public.sommelier_conversations USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: _migrations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public._migrations ENABLE ROW LEVEL SECURITY;

--
-- Name: ab_experiments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ab_experiments ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_activity_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agent_activity_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_evolution_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agent_evolution_log ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_feedback_loop; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_feedback_loop ENABLE ROW LEVEL SECURITY;

--
-- Name: analytics_cache; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.analytics_cache ENABLE ROW LEVEL SECURITY;

--
-- Name: analytics_goals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.analytics_goals ENABLE ROW LEVEL SECURITY;

--
-- Name: analytics_insight_prefs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.analytics_insight_prefs ENABLE ROW LEVEL SECURITY;

--
-- Name: analytics_insights; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.analytics_insights ENABLE ROW LEVEL SECURITY;

--
-- Name: master_wine_library anon_read_master_wine_library; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_read_master_wine_library ON public.master_wine_library FOR SELECT TO authenticated, anon USING (true);


--
-- Name: api_idempotency_keys; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.api_idempotency_keys ENABLE ROW LEVEL SECURITY;

--
-- Name: api_spend; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.api_spend ENABLE ROW LEVEL SECURITY;

--
-- Name: appellation_rules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.appellation_rules ENABLE ROW LEVEL SECURITY;

--
-- Name: batch_operations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.batch_operations ENABLE ROW LEVEL SECURITY;

--
-- Name: budgets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;

--
-- Name: calendar_event_types; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.calendar_event_types ENABLE ROW LEVEL SECURITY;

--
-- Name: calendar_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.calendar_events ENABLE ROW LEVEL SECURITY;

--
-- Name: calendar_recurrence_exceptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.calendar_recurrence_exceptions ENABLE ROW LEVEL SECURITY;

--
-- Name: calendar_recurrence_rules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.calendar_recurrence_rules ENABLE ROW LEVEL SECURITY;

--
-- Name: restaurant_chains chains_org_member_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY chains_org_member_read ON public.restaurant_chains FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.organization_members
  WHERE ((organization_members.organization_id = restaurant_chains.organization_id) AND ((organization_members.user_id)::text = (auth.uid())::text)))));


--
-- Name: restaurant_chains chains_org_owner_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY chains_org_owner_insert ON public.restaurant_chains FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.organizations
  WHERE ((organizations.id = restaurant_chains.organization_id) AND ((organizations.owner_id)::text = (auth.uid())::text)))));


--
-- Name: restaurant_chains chains_org_owner_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY chains_org_owner_update ON public.restaurant_chains FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.organizations
  WHERE ((organizations.id = restaurant_chains.organization_id) AND ((organizations.owner_id)::text = (auth.uid())::text)))));


--
-- Name: check_scans; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.check_scans ENABLE ROW LEVEL SECURITY;

--
-- Name: collection_metadata; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.collection_metadata ENABLE ROW LEVEL SECURITY;

--
-- Name: communication_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.communication_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: confidence_thresholds; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.confidence_thresholds ENABLE ROW LEVEL SECURITY;

--
-- Name: contact_addresses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contact_addresses ENABLE ROW LEVEL SECURITY;

--
-- Name: contacts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

--
-- Name: conversation_attachments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.conversation_attachments ENABLE ROW LEVEL SECURITY;

--
-- Name: conversation_attachments conversation_attachments_restaurant_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY conversation_attachments_restaurant_access ON public.conversation_attachments USING ((restaurant_id IN ( SELECT user_restaurant_access.restaurant_id
   FROM public.user_restaurant_access
  WHERE (user_restaurant_access.user_id = auth.uid()))));


--
-- Name: conversation_embeddings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.conversation_embeddings ENABLE ROW LEVEL SECURITY;

--
-- Name: conversation_embeddings conversation_embeddings_restaurant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY conversation_embeddings_restaurant_isolation ON public.conversation_embeddings USING ((restaurant_id = ( SELECT users.restaurant_id
   FROM public.users
  WHERE (conversation_embeddings.id = auth.uid()))));


--
-- Name: coverage_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.coverage_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: crawl_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crawl_log ENABLE ROW LEVEL SECURITY;

--
-- Name: crawl_schedule; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crawl_schedule ENABLE ROW LEVEL SECURITY;

--
-- Name: custom_reminders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.custom_reminders ENABLE ROW LEVEL SECURITY;

--
-- Name: dead_letter_queue; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.dead_letter_queue ENABLE ROW LEVEL SECURITY;

--
-- Name: decision_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.decision_log ENABLE ROW LEVEL SECURITY;

--
-- Name: email_prospects; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_prospects ENABLE ROW LEVEL SECURITY;

--
-- Name: email_prospects email_prospects_restaurant_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY email_prospects_restaurant_access ON public.email_prospects USING ((restaurant_id IN ( SELECT user_restaurant_access.restaurant_id
   FROM public.user_restaurant_access
  WHERE (user_restaurant_access.user_id = auth.uid()))));


--
-- Name: email_verifications email_verif_read_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY email_verif_read_own ON public.email_verifications FOR SELECT USING (((user_id)::text = (auth.uid())::text));


--
-- Name: email_verifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_verifications ENABLE ROW LEVEL SECURITY;

--
-- Name: email_watch_state; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_watch_state ENABLE ROW LEVEL SECURITY;

--
-- Name: enrichment_queue; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.enrichment_queue ENABLE ROW LEVEL SECURITY;

--
-- Name: event_dead_letters; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.event_dead_letters ENABLE ROW LEVEL SECURITY;

--
-- Name: event_replay_jobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.event_replay_jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: event_schema_registry; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.event_schema_registry ENABLE ROW LEVEL SECURITY;

--
-- Name: event_store; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.event_store ENABLE ROW LEVEL SECURITY;

--
-- Name: events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

--
-- Name: events events_restaurant_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY events_restaurant_policy ON public.events USING ((restaurant_id IN ( SELECT user_restaurant_access.restaurant_id
   FROM public.user_restaurant_access
  WHERE (user_restaurant_access.user_id = auth.uid()))));


--
-- Name: evidence_citations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.evidence_citations ENABLE ROW LEVEL SECURITY;

--
-- Name: evidence_url_cache; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.evidence_url_cache ENABLE ROW LEVEL SECURITY;

--
-- Name: export_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.export_history ENABLE ROW LEVEL SECURITY;

--
-- Name: field_calibration; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.field_calibration ENABLE ROW LEVEL SECURITY;

--
-- Name: field_corrections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.field_corrections ENABLE ROW LEVEL SECURITY;

--
-- Name: field_review_queue; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.field_review_queue ENABLE ROW LEVEL SECURITY;

--
-- Name: generated_reports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.generated_reports ENABLE ROW LEVEL SECURITY;

--
-- Name: glass_pour_tracking; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.glass_pour_tracking ENABLE ROW LEVEL SECURITY;

--
-- Name: grape_varieties; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.grape_varieties ENABLE ROW LEVEL SECURITY;

--
-- Name: idempotency_keys; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;

--
-- Name: inventory_alert_state; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inventory_alert_state ENABLE ROW LEVEL SECURITY;

--
-- Name: inventory_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inventory_events ENABLE ROW LEVEL SECURITY;

--
-- Name: inventory_lots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inventory_lots ENABLE ROW LEVEL SECURITY;

--
-- Name: inventory_transactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inventory_transactions ENABLE ROW LEVEL SECURITY;

--
-- Name: invite_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.invite_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: invite_tokens invite_tokens_admin_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY invite_tokens_admin_all ON public.invite_tokens USING ((((auth.jwt() -> 'app_metadata'::text) -> 'roles'::text) ? 'review_admin'::text));


--
-- Name: invite_tokens invite_tokens_read_for_redemption; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY invite_tokens_read_for_redemption ON public.invite_tokens FOR SELECT USING (((used_at IS NULL) AND (expires_at > now())));


--
-- Name: invoice_scans; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.invoice_scans ENABLE ROW LEVEL SECURITY;

--
-- Name: keyboard_shortcuts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.keyboard_shortcuts ENABLE ROW LEVEL SECURITY;

--
-- Name: manager_preferences; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.manager_preferences ENABLE ROW LEVEL SECURITY;

--
-- Name: manager_report_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.manager_report_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: master_wine_library; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.master_wine_library ENABLE ROW LEVEL SECURITY;

--
-- Name: master_wine_library_submissions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.master_wine_library_submissions ENABLE ROW LEVEL SECURITY;

--
-- Name: menu_changes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.menu_changes ENABLE ROW LEVEL SECURITY;

--
-- Name: menu_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY;

--
-- Name: menu_items menu_items_restaurant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY menu_items_restaurant_isolation ON public.menu_items USING ((restaurant_id IN ( SELECT users.restaurant_id
   FROM public.users
  WHERE (users.user_id = auth.uid()))));


--
-- Name: restaurant_menus menus_restaurant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY menus_restaurant_isolation ON public.restaurant_menus USING ((restaurant_id IN ( SELECT users.restaurant_id
   FROM public.users
  WHERE (users.user_id = auth.uid()))));


--
-- Name: message_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.message_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: mobile_devices; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mobile_devices ENABLE ROW LEVEL SECURITY;

--
-- Name: negotiation_facts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.negotiation_facts ENABLE ROW LEVEL SECURITY;

--
-- Name: notification_deliveries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notification_deliveries ENABLE ROW LEVEL SECURITY;

--
-- Name: notification_preferences; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

--
-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: user_onboarding_progress onboarding_progress_self; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY onboarding_progress_self ON public.user_onboarding_progress USING ((user_id = auth.uid()));


--
-- Name: onboarding_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.onboarding_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: one_tap_actions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.one_tap_actions ENABLE ROW LEVEL SECURITY;

--
-- Name: order_interactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.order_interactions ENABLE ROW LEVEL SECURITY;

--
-- Name: order_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

--
-- Name: organization_invites org_invites_owner_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_invites_owner_insert ON public.organization_invites FOR INSERT WITH CHECK (((invited_by)::text = (auth.uid())::text));


--
-- Name: organization_invites org_invites_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_invites_public_read ON public.organization_invites FOR SELECT USING (true);


--
-- Name: organization_members org_members_read_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_members_read_own ON public.organization_members FOR SELECT USING (((user_id)::text = (auth.uid())::text));


--
-- Name: organizations org_owner_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_owner_access ON public.organizations USING (((owner_id)::text = (auth.uid())::text));


--
-- Name: organization_members org_owner_insert_members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_owner_insert_members ON public.organization_members FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.organizations
  WHERE ((organizations.id = organization_members.organization_id) AND ((organizations.owner_id)::text = (auth.uid())::text)))));


--
-- Name: organization_members org_owner_read_members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_owner_read_members ON public.organization_members FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.organizations
  WHERE ((organizations.id = organization_members.organization_id) AND ((organizations.owner_id)::text = (auth.uid())::text)))));


--
-- Name: organization_invites; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.organization_invites ENABLE ROW LEVEL SECURITY;

--
-- Name: organization_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

--
-- Name: organizations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

--
-- Name: outbox; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.outbox ENABLE ROW LEVEL SECURITY;

--
-- Name: override_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.override_events ENABLE ROW LEVEL SECURITY;

--
-- Name: override_events override_insert_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY override_insert_policy ON public.override_events FOR INSERT WITH CHECK ((auth.uid() = actor_id));


--
-- Name: override_events override_read_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY override_read_admin ON public.override_events FOR SELECT USING (((((auth.jwt() -> 'app_metadata'::text) -> 'roles'::text) ? 'review_admin'::text) OR (((auth.jwt() -> 'app_metadata'::text) -> 'roles'::text) ? 'developer'::text)));


--
-- Name: override_events override_read_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY override_read_own ON public.override_events FOR SELECT USING ((auth.uid() = actor_id));


--
-- Name: override_events override_update_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY override_update_admin ON public.override_events FOR UPDATE USING ((((auth.jwt() -> 'app_metadata'::text) -> 'roles'::text) ? 'review_admin'::text));


--
-- Name: pos_checks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pos_checks ENABLE ROW LEVEL SECURITY;

--
-- Name: pos_item_mappings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pos_item_mappings ENABLE ROW LEVEL SECURITY;

--
-- Name: pour_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pour_events ENABLE ROW LEVEL SECURITY;

--
-- Name: prediction_outcomes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.prediction_outcomes ENABLE ROW LEVEL SECURITY;

--
-- Name: price_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.price_history ENABLE ROW LEVEL SECURITY;

--
-- Name: procurement_conversations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.procurement_conversations ENABLE ROW LEVEL SECURITY;

--
-- Name: procurement_conversations procurement_conversations_restaurant_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY procurement_conversations_restaurant_access ON public.procurement_conversations USING ((restaurant_id IN ( SELECT user_restaurant_access.restaurant_id
   FROM public.user_restaurant_access
  WHERE (user_restaurant_access.user_id = auth.uid()))));


--
-- Name: procurement_order_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.procurement_order_items ENABLE ROW LEVEL SECURITY;

--
-- Name: procurement_orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.procurement_orders ENABLE ROW LEVEL SECURITY;

--
-- Name: producers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.producers ENABLE ROW LEVEL SECURITY;

--
-- Name: profit_margins; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profit_margins ENABLE ROW LEVEL SECURITY;

--
-- Name: prompt_versions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.prompt_versions ENABLE ROW LEVEL SECURITY;

--
-- Name: provider_contacts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.provider_contacts ENABLE ROW LEVEL SECURITY;

--
-- Name: provider_conversation_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.provider_conversation_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: provider_conversation_sessions provider_conversation_sessions_restaurant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY provider_conversation_sessions_restaurant_isolation ON public.provider_conversation_sessions USING ((restaurant_id = ( SELECT users.restaurant_id
   FROM public.users
  WHERE (provider_conversation_sessions.id = auth.uid()))));


--
-- Name: provider_knowledge; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.provider_knowledge ENABLE ROW LEVEL SECURITY;

--
-- Name: provider_locations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.provider_locations ENABLE ROW LEVEL SECURITY;

--
-- Name: provider_locations provider_locations_restaurant_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY provider_locations_restaurant_access ON public.provider_locations USING ((restaurant_id IN ( SELECT user_restaurant_access.restaurant_id
   FROM public.user_restaurant_access
  WHERE (user_restaurant_access.user_id = auth.uid()))));


--
-- Name: provider_performance_metrics; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.provider_performance_metrics ENABLE ROW LEVEL SECURITY;

--
-- Name: provider_promotions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.provider_promotions ENABLE ROW LEVEL SECURITY;

--
-- Name: provider_sentiment_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.provider_sentiment_history ENABLE ROW LEVEL SECURITY;

--
-- Name: providers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.providers ENABLE ROW LEVEL SECURITY;

--
-- Name: providers providers_restaurant_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY providers_restaurant_access ON public.providers USING ((restaurant_id IN ( SELECT user_restaurant_access.restaurant_id
   FROM public.user_restaurant_access
  WHERE (user_restaurant_access.user_id = auth.uid()))));


--
-- Name: recommendation_actions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.recommendation_actions ENABLE ROW LEVEL SECURITY;

--
-- Name: recommendation_digest_prefs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.recommendation_digest_prefs ENABLE ROW LEVEL SECURITY;

--
-- Name: recurring_orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.recurring_orders ENABLE ROW LEVEL SECURITY;

--
-- Name: research_run_stats; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.research_run_stats ENABLE ROW LEVEL SECURITY;

--
-- Name: research_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.research_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: resolution_challenges; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.resolution_challenges ENABLE ROW LEVEL SECURITY;

--
-- Name: restaurant_branding; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.restaurant_branding ENABLE ROW LEVEL SECURITY;

--
-- Name: restaurant_chains; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.restaurant_chains ENABLE ROW LEVEL SECURITY;

--
-- Name: restaurant_directory; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.restaurant_directory ENABLE ROW LEVEL SECURITY;

--
-- Name: restaurant_feature_flags; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.restaurant_feature_flags ENABLE ROW LEVEL SECURITY;

--
-- Name: restaurant_inbound_addresses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.restaurant_inbound_addresses ENABLE ROW LEVEL SECURITY;

--
-- Name: restaurant_inbound_addresses restaurant_inbound_addresses_restaurant_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY restaurant_inbound_addresses_restaurant_access ON public.restaurant_inbound_addresses USING ((restaurant_id IN ( SELECT user_restaurant_access.restaurant_id
   FROM public.user_restaurant_access
  WHERE (user_restaurant_access.user_id = auth.uid()))));


--
-- Name: restaurant_inventory; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.restaurant_inventory ENABLE ROW LEVEL SECURITY;

--
-- Name: restaurant_menus; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.restaurant_menus ENABLE ROW LEVEL SECURITY;

--
-- Name: restaurant_providers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.restaurant_providers ENABLE ROW LEVEL SECURITY;

--
-- Name: restaurant_tables; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.restaurant_tables ENABLE ROW LEVEL SECURITY;

--
-- Name: restaurant_venue_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.restaurant_venue_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: restaurant_wine_roster; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.restaurant_wine_roster ENABLE ROW LEVEL SECURITY;

--
-- Name: restaurants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.restaurants ENABLE ROW LEVEL SECURITY;

--
-- Name: user_roles review_admin_manage_roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY review_admin_manage_roles ON public.user_roles USING ((((auth.jwt() -> 'app_metadata'::text) -> 'roles'::text) ? 'review_admin'::text));


--
-- Name: rfq_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rfq_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: saga_state; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.saga_state ENABLE ROW LEVEL SECURITY;

--
-- Name: sales_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sales_events ENABLE ROW LEVEL SECURITY;

--
-- Name: schedule_receipts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.schedule_receipts ENABLE ROW LEVEL SECURITY;

--
-- Name: schedules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.schedules ENABLE ROW LEVEL SECURITY;

--
-- Name: sender_reputation; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sender_reputation ENABLE ROW LEVEL SECURITY;

--
-- Name: sender_reputation sender_reputation_restaurant_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sender_reputation_restaurant_access ON public.sender_reputation USING ((restaurant_id IN ( SELECT user_restaurant_access.restaurant_id
   FROM public.user_restaurant_access
  WHERE (user_restaurant_access.user_id = auth.uid()))));


--
-- Name: server_sales; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.server_sales ENABLE ROW LEVEL SECURITY;

--
-- Name: crawl_log service_role_full_access_cl; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_full_access_cl ON public.crawl_log USING (true) WITH CHECK (true);


--
-- Name: restaurant_directory service_role_full_access_rd; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_full_access_rd ON public.restaurant_directory USING (true) WITH CHECK (true);


--
-- Name: onboarding_sessions session_insert_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY session_insert_policy ON public.onboarding_sessions FOR INSERT WITH CHECK ((auth.uid() = actor_id));


--
-- Name: onboarding_sessions session_read_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY session_read_policy ON public.onboarding_sessions FOR SELECT USING (((auth.uid() = actor_id) OR (((auth.jwt() -> 'app_metadata'::text) -> 'roles'::text) ? 'review_admin'::text) OR (((auth.jwt() -> 'app_metadata'::text) -> 'roles'::text) ? 'developer'::text)));


--
-- Name: shift_breaks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.shift_breaks ENABLE ROW LEVEL SECURITY;

--
-- Name: shifts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;

--
-- Name: sim_ground_truth_facts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sim_ground_truth_facts ENABLE ROW LEVEL SECURITY;

--
-- Name: sim_ground_truth_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sim_ground_truth_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: sku_mappings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sku_mappings ENABLE ROW LEVEL SECURITY;

--
-- Name: sommelier_conversations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sommelier_conversations ENABLE ROW LEVEL SECURITY;

--
-- Name: spend_alert_state; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.spend_alert_state ENABLE ROW LEVEL SECURITY;

--
-- Name: storage_locations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.storage_locations ENABLE ROW LEVEL SECURITY;

--
-- Name: supplier_catalogs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.supplier_catalogs ENABLE ROW LEVEL SECURITY;

--
-- Name: swap_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.swap_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: system_audit_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.system_audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: system_learning_state; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.system_learning_state ENABLE ROW LEVEL SECURITY;

--
-- Name: team_availability; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.team_availability ENABLE ROW LEVEL SECURITY;

--
-- Name: team_certifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.team_certifications ENABLE ROW LEVEL SECURITY;

--
-- Name: team_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;

--
-- Name: team_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.team_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: time_off_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.time_off_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: toast_item_mappings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.toast_item_mappings ENABLE ROW LEVEL SECURITY;

--
-- Name: training_datasets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.training_datasets ENABLE ROW LEVEL SECURITY;

--
-- Name: trending_wines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.trending_wines ENABLE ROW LEVEL SECURITY;

--
-- Name: unit_conversions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.unit_conversions ENABLE ROW LEVEL SECURITY;

--
-- Name: user_restaurant_access ura_org_owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ura_org_owner_read ON public.user_restaurant_access FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (public.restaurants r
     JOIN public.organizations o ON ((o.id = r.organization_id)))
  WHERE ((r.id = user_restaurant_access.restaurant_id) AND ((o.owner_id)::text = (auth.uid())::text)))));


--
-- Name: user_restaurant_access ura_read_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ura_read_own ON public.user_restaurant_access FOR SELECT USING (((user_id)::text = (auth.uid())::text));


--
-- Name: user_onboarding_progress; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_onboarding_progress ENABLE ROW LEVEL SECURITY;

--
-- Name: user_preferences; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

--
-- Name: user_restaurant_access; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_restaurant_access ENABLE ROW LEVEL SECURITY;

--
-- Name: user_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

--
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

--
-- Name: user_roles users_read_own_roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_read_own_roles ON public.user_roles FOR SELECT USING (((auth.uid() = user_id) AND (revoked_at IS NULL)));


--
-- Name: ux_learnings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ux_learnings ENABLE ROW LEVEL SECURITY;

--
-- Name: ux_overrides; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ux_overrides ENABLE ROW LEVEL SECURITY;

--
-- Name: ux_proposals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ux_proposals ENABLE ROW LEVEL SECURITY;

--
-- Name: ux_signals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ux_signals ENABLE ROW LEVEL SECURITY;

--
-- Name: vendor_catalogue; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.vendor_catalogue ENABLE ROW LEVEL SECURITY;

--
-- Name: vendor_catalogue vendor_catalogue_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY vendor_catalogue_read ON public.vendor_catalogue FOR SELECT TO authenticated USING ((is_active = true));


--
-- Name: vendor_deadlines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.vendor_deadlines ENABLE ROW LEVEL SECURITY;

--
-- Name: vendor_promotions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.vendor_promotions ENABLE ROW LEVEL SECURITY;

--
-- Name: vendor_promotions vendor_promotions_restaurant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY vendor_promotions_restaurant_isolation ON public.vendor_promotions USING ((restaurant_id = ( SELECT users.restaurant_id
   FROM public.users
  WHERE (vendor_promotions.id = auth.uid()))));


--
-- Name: vintage_rules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.vintage_rules ENABLE ROW LEVEL SECURITY;

--
-- Name: vintage_substitution_rules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.vintage_substitution_rules ENABLE ROW LEVEL SECURITY;

--
-- Name: wine_acquisition_details; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.wine_acquisition_details ENABLE ROW LEVEL SECURITY;

--
-- Name: wine_aliases; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.wine_aliases ENABLE ROW LEVEL SECURITY;

--
-- Name: wine_consumption_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.wine_consumption_log ENABLE ROW LEVEL SECURITY;

--
-- Name: wine_location_mappings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.wine_location_mappings ENABLE ROW LEVEL SECURITY;

--
-- Name: wine_menu_prices; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.wine_menu_prices ENABLE ROW LEVEL SECURITY;

--
-- Name: wine_popularity; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.wine_popularity ENABLE ROW LEVEL SECURITY;

--
-- Name: wine_regions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.wine_regions ENABLE ROW LEVEL SECURITY;

--
-- Name: wine_unit_defaults; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.wine_unit_defaults ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--


