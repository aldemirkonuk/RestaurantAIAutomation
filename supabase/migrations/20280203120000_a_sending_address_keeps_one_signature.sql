-- r110 mail-gap g3: a signature per sending address.
--
-- Stored in communication_templates as type 'mail_signature', name = the
-- lower-cased address it signs for, body <= 600 characters (no new table).
-- Two saves of the same house and address must never make two rows: the
-- gateway reads, then updates or inserts, and a racing insert loses here.
-- Version taken past every migration on the open branches at write time; the
-- merge guard re-numbers it if it collides.

CREATE UNIQUE INDEX IF NOT EXISTS communication_templates_one_mail_signature
  ON public.communication_templates (restaurant_id, lower(name))
  WHERE type = 'mail_signature';
