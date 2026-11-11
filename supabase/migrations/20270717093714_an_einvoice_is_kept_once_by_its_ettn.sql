-- An e-invoice is kept once, by its ETTN (proposal-receipt rows 2.3 and 3.3).
--
-- Every Turkish e-invoice (e-Fatura, e-Arşiv) and e-despatch (e-İrsaliye)
-- carries an ETTN: a UUID the issuer's system stamps and GİB registers. It is
-- the one number that is the same on the zip, the bare XML, the PDF view and a
-- re-sent copy, so it is the right key for "this house already holds it".
--
-- The gateway reads it from the UBL-TR file (cbc:UUID), lower-cased, and asks
-- before filing (`paperWithEttn`); this unique index closes the race between
-- two arrivals of the same file (mail and upload in the same minute).
--
-- Shape follows uq_pd_restaurant_provider_type_number: a superseded paper
-- leaves the index, so a correction can be filed under the same ETTN.
-- Additive and nullable: every existing row keeps NULL and is untouched.

ALTER TABLE public.procurement_documents
  ADD COLUMN IF NOT EXISTS ettn text;

COMMENT ON COLUMN public.procurement_documents.ettn IS
  'The e-invoice''s ETTN (UBL cbc:UUID), lower-cased; NULL for a paper that is not an e-invoice.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_pd_restaurant_ettn
  ON public.procurement_documents (restaurant_id, ettn)
  WHERE ettn IS NOT NULL AND (status)::text <> 'superseded'::text;
