-- A price names its paper and its messenger — ADR 0160 §112 fork 6(a).
--
-- WHAT WAS DECIDED
-- ----------------
-- Founder, 2026-09-18 ("Accept, full provenance first (Recommended)"): fork 6
-- moves to (a) — every price carries its source document and, where it came
-- from a conversation (WhatsApp, mail), the message and the person — "built in
-- the first pass ... not deferred" (ADR 0160 §112, Owed). Founder, 2026-09-25
-- (web-rebuild round 5, item 30): the provenance is a follow-on lane that must
-- land before `mudavym_design_vendor_prices` is turned on for any house.
--
-- Sketch 112's README (`112-vendor-prices-directions/README.md`, the graft
-- costing, snapshot 9c8d181d3) names what the graft needs: "a `document_id` +
-- line reference on the observation, two writer changes (receipt verification
-- and order confirmation ...), and an attach-a-paper step in Record a price (an
-- upload plus `document_id` on `POST /vendor-intel/observations`)". This file
-- is the schema half of that list, plus the two columns the message and the
-- person need.
--
-- THE FOUR COLUMNS
-- ----------------
--   document_id              the `procurement_documents` row the price was read
--                            from (a verified invoice, or a paper a person
--                            attached when recording the price).
--   document_line_id         the line ON that document — the "line reference".
--   conversation_message_id  the `procurement_conversations` row (one row is one
--                            message) the price came from — the vendor's reply
--                            a confirmed deal was read out of, or the message a
--                            person names when recording a quote.
--   source_contact_id        the person, when a person named them from the
--                            vendor's contacts. When it is null and a message is
--                            named, the reader derives the person from the
--                            message's own headers at read time, fresh.
--
-- HOUSE BOUNDARY, ENFORCED BY THE DATABASE AND NOT ONLY BY THE WRITERS
-- --------------------------------------------------------------------
-- A document, a document line and a message each belong to exactly one house.
-- A sighting must never point at another house's paper, and a public-register
-- row (`restaurant_id IS NULL`, ADR 0117) must never point at any house's
-- paper at all, or the compare read would hand one house's invoice to every
-- other house's ladder.
--
--   * `document_id` and `conversation_message_id` are COMPOSITE foreign keys
--     with `restaurant_id`, against new UNIQUE (id, restaurant_id) indexes on
--     the parents. So the database refuses a sighting naming another house's
--     document or message, whatever a writer does.
--   * `document_line_id` carries a composite foreign key with `document_id`,
--     so whenever BOTH are set the line is a line of the document the row
--     names, and so of the row's house (and a plain key of its own, so a
--     deleted line never dangles — see section 2).
--   * NOT ENFORCED HERE: a house row that names a line with `document_id`
--     NULL. The composite key is MATCH SIMPLE, so it is not checked when
--     `document_id` is NULL, and the plain line key has no house. The
--     database alone would accept another house's line on such a row. The
--     CHECK that would close it ("no line without its document") is refused
--     by the delete ordering in section 2. Both writers refuse a line named
--     without its document before any write (`own-paper-sighting.ts`
--     `provenanceIds`, `vendor-comparison.service.ts`
--     `assertProvenanceIsThisHouses`), and the reader reads lines only
--     from the viewer's own house (`vendor-comparison.service.ts`
--     `loadProvenance`). This is named, not hidden (PR #482 audit,
--     2026-09-26).
--   * Four CHECKs refuse each of the four on a row with no house.
--   * `source_contact_id` cannot be composite: `provider_contacts` has no
--     `restaurant_id` (it hangs off `providers`). The writer verifies the
--     contact's vendor belongs to the house before writing it, and the reader
--     re-checks it on every read. This is named, not hidden.
--
-- DELETE RULES, AND WHY NOT CASCADE OR RESTRICT
-- ---------------------------------------------
-- `ON DELETE SET NULL (<the id column only>)` (Postgres 15+; this project runs
-- 17, `supabase/config.toml` `major_version = 17`). A plain `SET NULL` on a
-- composite key would null `restaurant_id` too and turn a house's own price
-- into a public-register row — the one outcome the boundary above exists to
-- prevent. CASCADE would delete a price because its paper was deleted.
-- RESTRICT/NO ACTION would make deleting a house fail: `procurement_documents`
-- and `procurement_conversations` cascade from `restaurants`, while
-- `vendor_price_observations.restaurant_id` has no foreign key at all, so a
-- restrictive rule here would block the house deletion the founder ruled on
-- 2026-09-25 (item 26). The writers also copy each id into `raw.provenance`,
-- so a sighting whose paper was later deleted can say so rather than read as
-- one that never had any.
--
-- REJECTED
-- --------
--   * Parsing `source_ref` ("receipt_verified:<orderId>") at read time to find
--     the invoice. That is fork 6(b), already shipped; it names the ORDER, not
--     the paper, and an order can carry several invoices.
--   * A jsonb provenance blob only. It cannot hold a foreign key, so it cannot
--     enforce the house boundary above, and a reader could not tell a deleted
--     paper from a mistyped id.
--   * A separate `vendor_price_observation_sources` table. One sighting has at
--     most one paper, one line, one message and one person; a join table would
--     add a read to every compare for no extra shape.
--
-- ADDITIVE ONLY: four nullable columns, three unique indexes on parents (each
-- over a column that is already the primary key, so no existing row can
-- violate them), five foreign keys, four CHECKs, three partial indexes and
-- comments. No row is written, no column dropped, no type changed, no RLS
-- change (`vendor_price_observations` keeps its posture).
set local statement_timeout = '120s';

-- ---------------------------------------------------------------------------
-- 1. Parents: a (id, house) key each composite foreign key can point at.
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS procurement_documents_id_restaurant_key
  ON public.procurement_documents (id, restaurant_id);

CREATE UNIQUE INDEX IF NOT EXISTS procurement_document_lines_id_document_key
  ON public.procurement_document_lines (id, document_id);

CREATE UNIQUE INDEX IF NOT EXISTS procurement_conversations_id_restaurant_key
  ON public.procurement_conversations (id, restaurant_id);

-- ---------------------------------------------------------------------------
-- 2. The four columns.
-- ---------------------------------------------------------------------------

ALTER TABLE public.vendor_price_observations
  ADD COLUMN IF NOT EXISTS document_id uuid,
  ADD COLUMN IF NOT EXISTS document_line_id uuid,
  ADD COLUMN IF NOT EXISTS conversation_message_id uuid,
  ADD COLUMN IF NOT EXISTS source_contact_id uuid;

ALTER TABLE public.vendor_price_observations
  DROP CONSTRAINT IF EXISTS vpo_document_same_house_fkey;
ALTER TABLE public.vendor_price_observations
  ADD CONSTRAINT vpo_document_same_house_fkey
  FOREIGN KEY (document_id, restaurant_id)
  REFERENCES public.procurement_documents (id, restaurant_id)
  ON DELETE SET NULL (document_id);

-- The line takes TWO keys, and the split is measured, not stylistic. A single
-- composite `(document_line_id, document_id) ... ON DELETE SET NULL
-- (document_line_id)` left the line id DANGLING in a PGlite build of the whole
-- corpus (2026-09-25): deleting the document fired the key above first, which
-- nulled `document_id`, so when the line's own cascade delete arrived no
-- sighting matched `(line, document)` any more and the line id stayed, pointing
-- at a deleted line. So:
--   * `vpo_document_line_fkey` — the line alone, `SET NULL`: whatever order the
--     deletes arrive in, a deleted line clears the reference;
--   * `vpo_document_line_on_document_fkey` — the pair, NO ACTION (checked at
--     the end of the statement, after the `SET NULL` above has run): whenever
--     both are set, the line is a line OF that document.
-- A CHECK "no line without its document" was rejected for the same ordering
-- reason: the document key nulls `document_id` before the line key clears the
-- line, and the CHECK would then fail the document's deletion.
ALTER TABLE public.vendor_price_observations
  DROP CONSTRAINT IF EXISTS vpo_document_line_fkey;
ALTER TABLE public.vendor_price_observations
  ADD CONSTRAINT vpo_document_line_fkey
  FOREIGN KEY (document_line_id)
  REFERENCES public.procurement_document_lines (id)
  ON DELETE SET NULL;

ALTER TABLE public.vendor_price_observations
  DROP CONSTRAINT IF EXISTS vpo_document_line_on_document_fkey;
ALTER TABLE public.vendor_price_observations
  ADD CONSTRAINT vpo_document_line_on_document_fkey
  FOREIGN KEY (document_line_id, document_id)
  REFERENCES public.procurement_document_lines (id, document_id);

ALTER TABLE public.vendor_price_observations
  DROP CONSTRAINT IF EXISTS vpo_message_same_house_fkey;
ALTER TABLE public.vendor_price_observations
  ADD CONSTRAINT vpo_message_same_house_fkey
  FOREIGN KEY (conversation_message_id, restaurant_id)
  REFERENCES public.procurement_conversations (id, restaurant_id)
  ON DELETE SET NULL (conversation_message_id);

ALTER TABLE public.vendor_price_observations
  DROP CONSTRAINT IF EXISTS vpo_source_contact_fkey;
ALTER TABLE public.vendor_price_observations
  ADD CONSTRAINT vpo_source_contact_fkey
  FOREIGN KEY (source_contact_id)
  REFERENCES public.provider_contacts (id)
  ON DELETE SET NULL;

-- A public-register row carries no house's paper, message or person.
ALTER TABLE public.vendor_price_observations
  DROP CONSTRAINT IF EXISTS vpo_document_needs_a_house;
ALTER TABLE public.vendor_price_observations
  ADD CONSTRAINT vpo_document_needs_a_house
  CHECK (document_id IS NULL OR restaurant_id IS NOT NULL);

-- The line's own. Unlike "no line without its document" (section 2), this one
-- survives every delete order: no delete rule here ever nulls restaurant_id.
ALTER TABLE public.vendor_price_observations
  DROP CONSTRAINT IF EXISTS vpo_document_line_needs_a_house;
ALTER TABLE public.vendor_price_observations
  ADD CONSTRAINT vpo_document_line_needs_a_house
  CHECK (document_line_id IS NULL OR restaurant_id IS NOT NULL);

ALTER TABLE public.vendor_price_observations
  DROP CONSTRAINT IF EXISTS vpo_message_needs_a_house;
ALTER TABLE public.vendor_price_observations
  ADD CONSTRAINT vpo_message_needs_a_house
  CHECK (conversation_message_id IS NULL OR restaurant_id IS NOT NULL);

ALTER TABLE public.vendor_price_observations
  DROP CONSTRAINT IF EXISTS vpo_contact_needs_a_house;
ALTER TABLE public.vendor_price_observations
  ADD CONSTRAINT vpo_contact_needs_a_house
  CHECK (source_contact_id IS NULL OR restaurant_id IS NOT NULL);

-- "Which prices were read off this paper / this message" — the reverse reads a
-- document or a thread will want, and the delete rules above need them so a
-- parent delete does not scan the register.
CREATE INDEX IF NOT EXISTS idx_vpo_document
  ON public.vendor_price_observations (document_id)
  WHERE document_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_vpo_conversation_message
  ON public.vendor_price_observations (conversation_message_id)
  WHERE conversation_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_vpo_source_contact
  ON public.vendor_price_observations (source_contact_id)
  WHERE source_contact_id IS NOT NULL;

COMMENT ON COLUMN public.vendor_price_observations.document_id IS
  'ADR 0160 §112 fork 6(a): the procurement_documents row this price was read from — a verified invoice (receipt_verified writer) or a paper a person attached when recording it. Same house as the row (composite FK). NULL means no paper is linked; if raw.provenance.documentId is set while this is NULL, the paper was deleted after the price was recorded.';
COMMENT ON COLUMN public.vendor_price_observations.document_line_id IS
  'ADR 0160 §112 fork 6(a): the line on document_id this price is. When document_id is set, always a line of that document (composite FK, MATCH SIMPLE: not checked while document_id is NULL, so the writers refuse a line without its document). Never on a public-register row (CHECK). NULL means the price is tied to the paper but not to one line of it.';
COMMENT ON COLUMN public.vendor_price_observations.conversation_message_id IS
  'ADR 0160 §112 fork 6(a): the procurement_conversations row (one message) this price came from — the vendor reply a confirmed deal was read from (order_confirmed writer) or a message a person named. Same house as the row (composite FK).';
COMMENT ON COLUMN public.vendor_price_observations.source_contact_id IS
  'ADR 0160 §112 fork 6(a): the vendor contact a person named as the one who gave this price. provider_contacts has no restaurant_id, so the house check is the writer''s (vendor-comparison.service.ts) and the reader''s, not a foreign key''s. NULL with a message named means the person is read from the message''s own headers at read time.';

-- ---------------------------------------------------------------------------
-- 3. Assertions: the catalog, not the data. No probe rows are written.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(c, ', ') INTO missing
  FROM unnest(ARRAY['document_id', 'document_line_id', 'conversation_message_id', 'source_contact_id']) AS c
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'vendor_price_observations'
      AND column_name = c
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'vendor_price_observations is missing provenance column(s): %', missing;
  END IF;

  -- By name AND kind: a constraint of the right name that is not a foreign
  -- key (or not a CHECK) is not the rule this file exists to add.
  SELECT string_agg(k.conname, ', ') INTO missing
  FROM (VALUES
    ('vpo_document_same_house_fkey', 'f'),
    ('vpo_document_line_fkey', 'f'),
    ('vpo_document_line_on_document_fkey', 'f'),
    ('vpo_message_same_house_fkey', 'f'),
    ('vpo_source_contact_fkey', 'f'),
    ('vpo_document_needs_a_house', 'c'),
    ('vpo_document_line_needs_a_house', 'c'),
    ('vpo_message_needs_a_house', 'c'),
    ('vpo_contact_needs_a_house', 'c')
  ) AS k(conname, kind)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.vendor_price_observations'::regclass
      AND conname = k.conname
      AND contype::text = k.kind
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'vendor_price_observations is missing provenance constraint(s): %', missing;
  END IF;

  -- The SET NULL column lists are the whole safety of the composite keys: a
  -- key whose delete rule nulls restaurant_id would publish a house's price.
  -- confdelsetcols lists the columns SET NULL touches, and is EMPTY for a
  -- plain `SET NULL` — which nulls every column of the key, restaurant_id
  -- included. So the check is positive: each of the two keys must be
  -- `SET NULL` (confdeltype 'n') with exactly one listed column, its own id.
  SELECT string_agg(k.conname, ', ') INTO missing
  FROM (VALUES
    ('vpo_document_same_house_fkey', 'document_id'),
    ('vpo_message_same_house_fkey', 'conversation_message_id')
  ) AS k(conname, idcol)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_attribute a
      ON a.attrelid = c.conrelid AND a.attnum = c.confdelsetcols[1]
    WHERE c.conrelid = 'public.vendor_price_observations'::regclass
      AND c.conname = k.conname
      AND c.confdeltype = 'n'
      AND cardinality(c.confdelsetcols) = 1
      AND a.attname = k.idcol
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'provenance foreign key(s) % do not null only their own id on delete — a plain SET NULL would null restaurant_id and publish a house''s price', missing;
  END IF;

  RAISE NOTICE 'vendor_price_observations: 4 provenance columns, 5 foreign keys, 4 house checks present.';
END
$$;
