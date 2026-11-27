-- The 30-day count says whose it is (r104 mail fixer, finding 3 on the #2042 stack).
--
-- in_30d is every kind's letters for an owner or a manager (the same `others` the day's count uses) and
-- the vendors' alone when the house letters are withheld (staff). The page labels it by who reads it;
-- this comment says the same where the function is read, so the next reader does not take it for the
-- vendors' figure. No behaviour changes: a comment only.

COMMENT ON FUNCTION public.mail_inbox_summary(uuid, boolean, text) IS
  'Mail header counts. in_today and in_30d count every kind of letter in (vendor, team, guest; automatic mail and copies left out) when p_withhold_house_letters is false, and the vendors'' letters alone when it is true. out_today follows the same rule.';
