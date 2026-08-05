-- Normalize 10-digit US phone numbers to E.164 format (+1XXXXXXXXXX)
UPDATE providers
SET contact_phone = '+1' || regexp_replace(contact_phone, '\D', '', 'g')
WHERE contact_phone IS NOT NULL
  AND contact_phone NOT LIKE '+%'
  AND length(regexp_replace(contact_phone, '\D', '', 'g')) = 10;

-- Normalize 11-digit numbers already starting with country code 1 (+1XXXXXXXXXX)
UPDATE providers
SET contact_phone = '+' || regexp_replace(contact_phone, '\D', '', 'g')
WHERE contact_phone IS NOT NULL
  AND contact_phone NOT LIKE '+%'
  AND length(regexp_replace(contact_phone, '\D', '', 'g')) = 11
  AND regexp_replace(contact_phone, '\D', '', 'g') LIKE '1%';
