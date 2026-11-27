-- The floor keeps its own record (ADR 0345, Proposed; E4, E5, E7).
--
-- WHAT THIS IS
-- ------------
-- The Floor Checker is ported into Mudavym (ADR 0345 § Decision). Its tables
-- become new floor tables beside Mudavym's own: tables stay
-- `restaurant_tables`, people stay `public.users` + `user_restaurant_access`,
-- web-push devices stay `notification_push_devices` (ADR 0352: the floor adds
-- no device store). What the checker had and Mudavym lacks is added here:
--
--   floor_settings            warn/late minutes per house (checker defaults 6/10)
--   floor_sections            his pick: a new table, not house_areas
--   floor_section_tables      which section a table sits in (one per table)
--   floor_assignments         a waiter on a section or a table, per service day
--   floor_seatings            one party at one table, seated → Paid → left
--   floor_visits              the honour-system visit tap
--   floor_events              the floor's own tap log (not system_audit_log)
--   floor_table_merges        two or more tables pushed together, and members
--   floor_punches             clock-in / clock-out, linked to public.shifts
--   floor_out_tonight         items marked out tonight (marks only)
--   pos_server_links          a till server name → a person, on confirm (E4)
--   floor_nudge_ticks         the scanner's single-runner lock (E3)
--   floor_nudge_sends         the scanner's sends, claimed once (E3, ADR 0352)
--
-- and the house switch `restaurant_feature_flags.floor_checker`, default OFF
-- (E7, ADR 0131). Its registry entry and the gateway's fail-closed read land
-- with the floor module; until then nothing reads it and the floor is dark.
--
-- WHAT IT DOES NOT DO
-- -------------------
-- - No run-dry half of Out tonight: "run dry" waits on OD-242 (ADR 0345 pick
--   11, § The lot rule); this table holds a person's marks only.
-- - No change to `restaurant_tables.seats`: its DEFAULT 2 and the analytics
--   writer are E9's own change. The floor writes no table row here; party
--   size is NULL when nobody said (E9: seats are never guessed).
-- - No device store (ADR 0352), no Expo (OD-237).
--
-- RULES (E5)
-- ----------
-- Every tenant table carries `restaurant_id` → restaurants with an index; every
-- actor column → public.users(user_id) (auth.users and public.users are
-- disjoint, so a key to auth.users would 23503 on the first write). A row that
-- names a table, section, shift or menu item names its house twice and a
-- composite key makes them agree, as house_area_members does
-- (20260930100000). RLS on, service_role only, in this file.
--
-- Additive and idempotent. No BEGIN/COMMIT: the CLI wraps each file.

-- ---------------------------------------------------------------------------
-- 0. Rows this file references can be referenced together with their house
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS uq_restaurant_tables_id_restaurant
  ON public.restaurant_tables (id, restaurant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_shifts_id_restaurant
  ON public.shifts (id, restaurant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_menu_items_id_restaurant
  ON public.menu_items (id, restaurant_id);

-- ---------------------------------------------------------------------------
-- 1. The house switch (E7)
-- ---------------------------------------------------------------------------

ALTER TABLE public.restaurant_feature_flags
  ADD COLUMN IF NOT EXISTS floor_checker boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.restaurant_feature_flags.floor_checker IS
  'On the ''restaurant_settings'' row only. TRUE opens the floor (ADR 0345) for this house: /floor routes answer and the nudge scanner reads it. FALSE (default) keeps every floor route at 404 and the scanner silent (E7, ADR 0131).';

-- ---------------------------------------------------------------------------
-- 2. Settings and sections
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.floor_settings (
  restaurant_id UUID PRIMARY KEY REFERENCES public.restaurants(id) ON DELETE CASCADE,
  -- The checker's defaults (`0001_init.sql`: warn 6, late 10).
  warn_after_min INTEGER NOT NULL DEFAULT 6,
  late_after_min INTEGER NOT NULL DEFAULT 10,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  CONSTRAINT ck_floor_settings_minutes CHECK (
    warn_after_min >= 0 AND late_after_min > warn_after_min AND late_after_min <= 240
  )
);

CREATE TABLE IF NOT EXISTS public.floor_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (btrim(name) <> '' AND char_length(name) <= 60),
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  -- A removed section is kept for the reports that name it.
  archived_at TIMESTAMPTZ,
  archived_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_floor_sections_id_restaurant
  ON public.floor_sections (id, restaurant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_floor_sections_live_name
  ON public.floor_sections (restaurant_id, lower(btrim(name)))
  WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_floor_sections_house
  ON public.floor_sections (restaurant_id, sort);

CREATE TABLE IF NOT EXISTS public.floor_section_tables (
  table_id UUID PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  section_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  CONSTRAINT fk_floor_section_tables_table FOREIGN KEY (table_id, restaurant_id)
    REFERENCES public.restaurant_tables (id, restaurant_id) ON DELETE CASCADE,
  CONSTRAINT fk_floor_section_tables_section FOREIGN KEY (section_id, restaurant_id)
    REFERENCES public.floor_sections (id, restaurant_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_floor_section_tables_section
  ON public.floor_section_tables (restaurant_id, section_id);

-- ---------------------------------------------------------------------------
-- 3. Assignments: a waiter on a section, or on one table, for a service day
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.floor_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,
  section_id UUID,
  table_id UUID,
  -- The house-local service day the assignment is for.
  service_date DATE NOT NULL,
  -- manager: set on the board; self: a waiter claimed the table;
  -- reassignment: applied from a proposal (pick 4).
  source TEXT NOT NULL DEFAULT 'manager' CHECK (source IN ('manager', 'self', 'reassignment')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  released_at TIMESTAMPTZ,
  released_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  CONSTRAINT ck_floor_assignments_one_target CHECK ((section_id IS NULL) <> (table_id IS NULL)),
  CONSTRAINT ck_floor_assignments_order CHECK (released_at IS NULL OR released_at >= started_at),
  CONSTRAINT fk_floor_assignments_section FOREIGN KEY (section_id, restaurant_id)
    REFERENCES public.floor_sections (id, restaurant_id) ON DELETE CASCADE,
  CONSTRAINT fk_floor_assignments_table FOREIGN KEY (table_id, restaurant_id)
    REFERENCES public.restaurant_tables (id, restaurant_id) ON DELETE CASCADE
);
-- One live holder per table; a section may have several waiters.
CREATE UNIQUE INDEX IF NOT EXISTS uq_floor_assignments_live_table
  ON public.floor_assignments (table_id) WHERE released_at IS NULL AND table_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_floor_assignments_live_section_person
  ON public.floor_assignments (section_id, user_id, service_date)
  WHERE released_at IS NULL AND section_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_floor_assignments_house_day
  ON public.floor_assignments (restaurant_id, service_date);
CREATE INDEX IF NOT EXISTS idx_floor_assignments_person
  ON public.floor_assignments (restaurant_id, user_id) WHERE released_at IS NULL;

-- ---------------------------------------------------------------------------
-- 4. Seatings and visits
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.floor_seatings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  table_id UUID NOT NULL,
  seated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  seated_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  -- The waiter holding the table when the party sat (ADR 0346 D4 c).
  caretaker_at_seat_id UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  -- NULL when nobody said (E9). The checker defaulted 2.
  party_size INTEGER CHECK (party_size IS NULL OR (party_size > 0 AND party_size <= 200)),
  -- Paid never ends a seating; only a person's Leave does (ADR 0353).
  paid_at TIMESTAMPTZ,
  paid_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  paid_source TEXT CHECK (paid_source IN ('tap', 'till')),
  -- The last undo of Paid; the late clock restarts here (ADR 0353 § The undo).
  paid_undone_at TIMESTAMPTZ,
  paid_undone_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  left_at TIMESTAMPTZ,
  left_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  -- The checker's per-seating guards, kept apart (0018_meal_run_alerts.sql:14-18).
  last_nudge_at TIMESTAMPTZ,
  last_meal_alert_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_floor_seatings_paid_pair CHECK ((paid_at IS NULL) = (paid_source IS NULL)),
  CONSTRAINT ck_floor_seatings_left_order CHECK (left_at IS NULL OR left_at >= seated_at),
  CONSTRAINT fk_floor_seatings_table FOREIGN KEY (table_id, restaurant_id)
    REFERENCES public.restaurant_tables (id, restaurant_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_floor_seatings_id_restaurant
  ON public.floor_seatings (id, restaurant_id);
-- One open party per table.
CREATE UNIQUE INDEX IF NOT EXISTS uq_floor_seatings_open_table
  ON public.floor_seatings (table_id) WHERE left_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_floor_seatings_house_seated
  ON public.floor_seatings (restaurant_id, seated_at DESC);
CREATE INDEX IF NOT EXISTS idx_floor_seatings_open
  ON public.floor_seatings (restaurant_id) WHERE left_at IS NULL;

CREATE TABLE IF NOT EXISTS public.floor_visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  seating_id UUID NOT NULL,
  table_id UUID NOT NULL,
  user_id UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  visited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- tap: the visit button; food_delivered: a Food-up "Delivered" counts as one.
  source TEXT NOT NULL DEFAULT 'tap' CHECK (source IN ('tap', 'food_delivered')),
  -- A mistaken tap is struck, not deleted (checker 0017).
  struck_at TIMESTAMPTZ,
  struck_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  CONSTRAINT fk_floor_visits_seating FOREIGN KEY (seating_id, restaurant_id)
    REFERENCES public.floor_seatings (id, restaurant_id) ON DELETE CASCADE,
  CONSTRAINT fk_floor_visits_table FOREIGN KEY (table_id, restaurant_id)
    REFERENCES public.restaurant_tables (id, restaurant_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_floor_visits_seating
  ON public.floor_visits (seating_id, visited_at) WHERE struck_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_floor_visits_house_time
  ON public.floor_visits (restaurant_id, visited_at DESC);

-- ---------------------------------------------------------------------------
-- 5. The floor's own tap log
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.floor_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN (
    'seated', 'paid', 'paid_undone', 'left', 'visit_struck',
    'claimed', 'released', 'assigned', 'reassigned',
    'food_up', 'food_ack', 'on_break', 'back', 'clock_in', 'clock_out',
    'nudged', 'overdue_alert', 'merged', 'split'
  )),
  table_id UUID,
  seating_id UUID,
  actor_id UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  -- The other person the act names (the cover on On break, the new holder).
  subject_user_id UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_floor_events_table FOREIGN KEY (table_id, restaurant_id)
    REFERENCES public.restaurant_tables (id, restaurant_id) ON DELETE CASCADE,
  CONSTRAINT fk_floor_events_seating FOREIGN KEY (seating_id, restaurant_id)
    REFERENCES public.floor_seatings (id, restaurant_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_floor_events_house_time
  ON public.floor_events (restaurant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_floor_events_seating
  ON public.floor_events (seating_id, created_at) WHERE seating_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_floor_events_actor_kind
  ON public.floor_events (restaurant_id, actor_id, kind, created_at DESC);

-- ---------------------------------------------------------------------------
-- 6. Merged tables (checker 0003, 0004, 0014, 0016)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.floor_table_merges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  orientation TEXT CHECK (orientation IN ('horizontal', 'vertical')),
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  split_at TIMESTAMPTZ,
  split_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_floor_table_merges_id_restaurant
  ON public.floor_table_merges (id, restaurant_id);
CREATE INDEX IF NOT EXISTS idx_floor_table_merges_live
  ON public.floor_table_merges (restaurant_id) WHERE split_at IS NULL;

CREATE TABLE IF NOT EXISTS public.floor_table_merge_members (
  merge_id UUID NOT NULL,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  table_id UUID NOT NULL,
  seating_id UUID,
  joined_empty BOOLEAN NOT NULL DEFAULT false,
  active BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (merge_id, table_id),
  CONSTRAINT fk_floor_merge_members_merge FOREIGN KEY (merge_id, restaurant_id)
    REFERENCES public.floor_table_merges (id, restaurant_id) ON DELETE CASCADE,
  CONSTRAINT fk_floor_merge_members_table FOREIGN KEY (table_id, restaurant_id)
    REFERENCES public.restaurant_tables (id, restaurant_id) ON DELETE CASCADE,
  CONSTRAINT fk_floor_merge_members_seating FOREIGN KEY (seating_id, restaurant_id)
    REFERENCES public.floor_seatings (id, restaurant_id) ON DELETE SET NULL (seating_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_floor_merge_members_one_active_per_table
  ON public.floor_table_merge_members (table_id) WHERE active;
CREATE INDEX IF NOT EXISTS idx_floor_merge_members_house
  ON public.floor_table_merge_members (restaurant_id);

-- ---------------------------------------------------------------------------
-- 7. Punches (pick 10; ADR 0350): kept as tapped, shown beside the plan
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.floor_punches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- RESTRICT, as the door record's house key is (20261201120000): a house
  -- with punches cannot be hard-deleted under them either (`0350:71`).
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE RESTRICT,
  -- RESTRICT, not CASCADE: ADR 0350 keeps every punch until counsel answers
  -- (`0350:71`), so a person with punches cannot be hard-deleted under them.
  user_id UUID NOT NULL REFERENCES public.users(user_id) ON DELETE RESTRICT,
  -- The planned shift it was punched against, when one was found; a punch
  -- with no planned shift is kept (pick 10).
  shift_id UUID,
  clocked_in_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  clocked_out_at TIMESTAMPTZ,
  clocked_out_reason TEXT CHECK (clocked_out_reason IN ('clock_out', 'break')),
  source TEXT NOT NULL DEFAULT 'floor' CHECK (source IN ('floor', 'my_shifts', 'manager')),
  created_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- A correction writes a new row naming the one it replaces (ADR 0350).
  supersedes_id UUID,
  superseded_at TIMESTAMPTZ,
  -- A *Back* names the break it resumes (ADR 0350 `:78`): the punch closed
  -- with clocked_out_reason 'break'.
  resumes_id UUID,
  CONSTRAINT uq_floor_punches_id_restaurant UNIQUE (id, restaurant_id),
  -- Both links stay inside the house, like every other key here (E5).
  CONSTRAINT fk_floor_punches_supersedes FOREIGN KEY (supersedes_id, restaurant_id)
    REFERENCES public.floor_punches (id, restaurant_id),
  CONSTRAINT fk_floor_punches_resumes FOREIGN KEY (resumes_id, restaurant_id)
    REFERENCES public.floor_punches (id, restaurant_id),
  CONSTRAINT ck_floor_punches_out_pair CHECK ((clocked_out_at IS NULL) = (clocked_out_reason IS NULL)),
  CONSTRAINT ck_floor_punches_order CHECK (clocked_out_at IS NULL OR clocked_out_at >= clocked_in_at),
  CONSTRAINT fk_floor_punches_shift FOREIGN KEY (shift_id, restaurant_id)
    REFERENCES public.shifts (id, restaurant_id) ON DELETE SET NULL (shift_id)
);
-- One open punch per person per house.
CREATE UNIQUE INDEX IF NOT EXISTS uq_floor_punches_one_open
  ON public.floor_punches (restaurant_id, user_id)
  WHERE clocked_out_at IS NULL AND superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_floor_punches_house_time
  ON public.floor_punches (restaurant_id, clocked_in_at DESC);
CREATE INDEX IF NOT EXISTS idx_floor_punches_shift
  ON public.floor_punches (shift_id) WHERE shift_id IS NOT NULL;

-- Append-only (ADR 0350 `:78`): a row is written once, its clock-out filled
-- once and its superseded mark set once; the shift link may only go to null.
-- Any other change is a new row naming the old one. Every DELETE and every
-- TRUNCATE is refused; with both of its keys RESTRICT, neither a person nor a
-- house is deleted with punches under it. A role allowed to switch triggers
-- off (session_replication_role, DISABLE TRIGGER) is not stopped by this. The trigger does not check that a superseded
-- mark has a correction row naming it, why a shift link goes to null, or that
-- a Back's resumes_id names the same person's break, resumed once: the
-- gateway that writes punches owes those. user_id is RESTRICT, so deleting an
-- account that has punches fails (ADR 0350 `:71` keeps the hours); the
-- account-delete path owes a check before it tears anything down.
CREATE OR REPLACE FUNCTION public.floor_punches_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'floor_punches is append-only: TRUNCATE refused'
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'floor_punches is append-only: punch % is kept (ADR 0350)', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.restaurant_id IS DISTINCT FROM OLD.restaurant_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     -- The shift link only ever goes to null (a deleted shift, `:78`).
     OR (NEW.shift_id IS DISTINCT FROM OLD.shift_id AND NEW.shift_id IS NOT NULL)
     OR NEW.clocked_in_at IS DISTINCT FROM OLD.clocked_in_at
     OR NEW.source IS DISTINCT FROM OLD.source
     -- Who entered it only goes to null (their account deleted; the FK's SET NULL).
     OR (NEW.created_by IS DISTINCT FROM OLD.created_by AND NEW.created_by IS NOT NULL)
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.supersedes_id IS DISTINCT FROM OLD.supersedes_id
     OR NEW.resumes_id IS DISTINCT FROM OLD.resumes_id
     OR (OLD.clocked_out_at IS NOT NULL AND (NEW.clocked_out_at IS DISTINCT FROM OLD.clocked_out_at
                                             OR NEW.clocked_out_reason IS DISTINCT FROM OLD.clocked_out_reason))
     OR (OLD.superseded_at IS NOT NULL AND NEW.superseded_at IS DISTINCT FROM OLD.superseded_at)
  THEN
    RAISE EXCEPTION 'floor_punches is append-only: write a correction row naming punch %', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.floor_punches_append_only() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_floor_punches_append_only ON public.floor_punches;
CREATE TRIGGER trg_floor_punches_append_only
  BEFORE UPDATE OR DELETE ON public.floor_punches
  FOR EACH ROW EXECUTE FUNCTION public.floor_punches_append_only();
DROP TRIGGER IF EXISTS trg_floor_punches_no_truncate ON public.floor_punches;
CREATE TRIGGER trg_floor_punches_no_truncate
  BEFORE TRUNCATE ON public.floor_punches
  FOR EACH STATEMENT EXECUTE FUNCTION public.floor_punches_append_only();

-- ---------------------------------------------------------------------------
-- 8. Out tonight: a person's marks only (no run-dry half; OD-242)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.floor_out_tonight (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  menu_item_id UUID,
  -- An item not on the house's menu, named by the person who marks it.
  label TEXT CHECK (label IS NULL OR (btrim(label) <> '' AND char_length(label) <= 80)),
  service_date DATE NOT NULL,
  marked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  marked_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  back_at TIMESTAMPTZ,
  back_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  CONSTRAINT ck_floor_out_tonight_names_one CHECK ((menu_item_id IS NULL) <> (label IS NULL)),
  CONSTRAINT fk_floor_out_tonight_item FOREIGN KEY (menu_item_id, restaurant_id)
    REFERENCES public.menu_items (id, restaurant_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_floor_out_tonight_open_item
  ON public.floor_out_tonight (restaurant_id, service_date, menu_item_id)
  WHERE back_at IS NULL AND menu_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_floor_out_tonight_house_day
  ON public.floor_out_tonight (restaurant_id, service_date);

-- ---------------------------------------------------------------------------
-- 9. Till server names (E4): a name is a person only once a manager confirms
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.pos_server_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  -- The till provider (`pos_checks.source` / connection provider).
  source TEXT NOT NULL CHECK (btrim(source) <> ''),
  -- `pos_checks.server_external_id`, else the normalised `server_name`.
  till_server_id TEXT CHECK (till_server_id IS NULL OR btrim(till_server_id) <> ''),
  till_server_name_norm TEXT CHECK (till_server_name_norm IS NULL OR btrim(till_server_name_norm) <> ''),
  -- The raw words as the till sent them, for display; past checks are never rewritten.
  till_server_name TEXT,
  user_id UUID REFERENCES public.users(user_id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'proposed' CHECK (state IN ('proposed', 'confirmed', 'unlinked')),
  proposed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  proposed_reason JSONB NOT NULL DEFAULT '{}'::jsonb,
  confirmed_at TIMESTAMPTZ,
  confirmed_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  unlinked_at TIMESTAMPTZ,
  unlinked_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  CONSTRAINT ck_pos_server_links_key CHECK (till_server_id IS NOT NULL OR till_server_name_norm IS NOT NULL),
  CONSTRAINT ck_pos_server_links_confirmed CHECK (
    state <> 'confirmed' OR (user_id IS NOT NULL AND confirmed_at IS NOT NULL)
  )
);
-- One live link per till server per house (E4: keyed by the till's id when it
-- sends one, else by the normalised name).
CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_server_links_live_id
  ON public.pos_server_links (restaurant_id, source, till_server_id)
  WHERE state <> 'unlinked' AND till_server_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_server_links_live_name
  ON public.pos_server_links (restaurant_id, source, till_server_name_norm)
  WHERE state <> 'unlinked' AND till_server_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_pos_server_links_house
  ON public.pos_server_links (restaurant_id, state);

-- ---------------------------------------------------------------------------
-- 10. The nudge scanner (E3): one runner per tick, each send claimed once
-- ---------------------------------------------------------------------------

-- A tick is the scanner's minute. Two replicas both INSERT the same tick_at;
-- the primary key lets one win, and only the winner scans. Not per house.
CREATE TABLE IF NOT EXISTS public.floor_nudge_ticks (
  tick_at TIMESTAMPTZ PRIMARY KEY,
  runner TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  houses INTEGER NOT NULL DEFAULT 0,
  claimed INTEGER NOT NULL DEFAULT 0,
  error TEXT
);

-- Claim before send (the notification_producer_claims shape, 20260903143000):
-- the key is seating, kind, the visit its lateness counts from and the
-- 15-minute window (E3); a Food-up's is its meal run and threshold; a handoff
-- copy's is the alert, 'handoff' and the cover. Open as OD-236.
CREATE TABLE IF NOT EXISTS public.floor_nudge_sends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL CHECK (btrim(idempotency_key) <> ''),
  user_id UUID NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('late', 'food_up', 'handoff', 'manager_step')),
  seating_id UUID,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- "sent to a device", never "reached" (ADR 0352 § Sent is not seen).
  outcome TEXT CHECK (outcome IN ('sent', 'not_sent', 'failed')),
  detail TEXT,
  CONSTRAINT fk_floor_nudge_sends_seating FOREIGN KEY (seating_id, restaurant_id)
    REFERENCES public.floor_seatings (id, restaurant_id) ON DELETE SET NULL (seating_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_floor_nudge_sends_once
  ON public.floor_nudge_sends (restaurant_id, idempotency_key, user_id);
CREATE INDEX IF NOT EXISTS idx_floor_nudge_sends_house_time
  ON public.floor_nudge_sends (restaurant_id, claimed_at DESC);

-- ---------------------------------------------------------------------------
-- 11. Lock every new table down in the file that creates it (E5)
-- ---------------------------------------------------------------------------

-- Written out per table, not as a loop: the lockdown guard reads static SQL
-- (scripts/check_new_tables_are_locked_down.py), and a FOREACH over format()
-- is a dynamic block it cannot credit.

ALTER TABLE public.floor_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS floor_settings_service_role ON public.floor_settings;
CREATE POLICY floor_settings_service_role ON public.floor_settings FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.floor_settings FROM anon, authenticated;

ALTER TABLE public.floor_sections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS floor_sections_service_role ON public.floor_sections;
CREATE POLICY floor_sections_service_role ON public.floor_sections FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.floor_sections FROM anon, authenticated;

ALTER TABLE public.floor_section_tables ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS floor_section_tables_service_role ON public.floor_section_tables;
CREATE POLICY floor_section_tables_service_role ON public.floor_section_tables FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.floor_section_tables FROM anon, authenticated;

ALTER TABLE public.floor_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS floor_assignments_service_role ON public.floor_assignments;
CREATE POLICY floor_assignments_service_role ON public.floor_assignments FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.floor_assignments FROM anon, authenticated;

ALTER TABLE public.floor_seatings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS floor_seatings_service_role ON public.floor_seatings;
CREATE POLICY floor_seatings_service_role ON public.floor_seatings FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.floor_seatings FROM anon, authenticated;

ALTER TABLE public.floor_visits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS floor_visits_service_role ON public.floor_visits;
CREATE POLICY floor_visits_service_role ON public.floor_visits FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.floor_visits FROM anon, authenticated;

ALTER TABLE public.floor_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS floor_events_service_role ON public.floor_events;
CREATE POLICY floor_events_service_role ON public.floor_events FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.floor_events FROM anon, authenticated;

ALTER TABLE public.floor_table_merges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS floor_table_merges_service_role ON public.floor_table_merges;
CREATE POLICY floor_table_merges_service_role ON public.floor_table_merges FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.floor_table_merges FROM anon, authenticated;

ALTER TABLE public.floor_table_merge_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS floor_table_merge_members_service_role ON public.floor_table_merge_members;
CREATE POLICY floor_table_merge_members_service_role ON public.floor_table_merge_members FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.floor_table_merge_members FROM anon, authenticated;

ALTER TABLE public.floor_punches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS floor_punches_service_role ON public.floor_punches;
CREATE POLICY floor_punches_service_role ON public.floor_punches FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.floor_punches FROM anon, authenticated;

ALTER TABLE public.floor_out_tonight ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS floor_out_tonight_service_role ON public.floor_out_tonight;
CREATE POLICY floor_out_tonight_service_role ON public.floor_out_tonight FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.floor_out_tonight FROM anon, authenticated;

ALTER TABLE public.pos_server_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pos_server_links_service_role ON public.pos_server_links;
CREATE POLICY pos_server_links_service_role ON public.pos_server_links FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.pos_server_links FROM anon, authenticated;

ALTER TABLE public.floor_nudge_ticks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS floor_nudge_ticks_service_role ON public.floor_nudge_ticks;
CREATE POLICY floor_nudge_ticks_service_role ON public.floor_nudge_ticks FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.floor_nudge_ticks FROM anon, authenticated;

ALTER TABLE public.floor_nudge_sends ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS floor_nudge_sends_service_role ON public.floor_nudge_sends;
CREATE POLICY floor_nudge_sends_service_role ON public.floor_nudge_sends FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.floor_nudge_sends FROM anon, authenticated;

COMMENT ON TABLE public.floor_seatings IS
  'One party at one table (ADR 0345). Paid never ends it; only a person''s Leave does (ADR 0353). party_size NULL when nobody said (E9). RLS on, service_role only.';
COMMENT ON TABLE public.floor_events IS
  'The floor''s own tap log (ADR 0345 § Reuse map). Staff, section, settings and link changes go to system_audit_log as well. RLS on, service_role only.';
COMMENT ON TABLE public.floor_punches IS
  'Clock-in and clock-out as tapped (pick 10, ADR 0350). Shown beside the plan; wages stay on planned hours. RLS on, service_role only.';
COMMENT ON TABLE public.pos_server_links IS
  'A till server name → a person, only once an owner or manager confirms (ADR 0345 E4). Unlinked names print unlinked, never a guessed person. RLS on, service_role only.';
COMMENT ON TABLE public.floor_out_tonight IS
  'Items a manager or a kitchen/bar lead marked out tonight (pick 11). Marks only: the run-dry half waits on OD-242. RLS on, service_role only.';
