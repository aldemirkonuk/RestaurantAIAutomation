# vendor_catalogue website fixtures

`vendor_catalogue_rows.json` is the SHAPE of the four rows, not a copy of
production. The ids, names, types, countries, cities and websites are the values
the two seed files write (`supabase/migrations/seed/27_vendor_catalogue_seed.sql`
and `supabase/migrations/20260807001752_turkey_distributors_seed.sql`), read out
of those files on 2026-09-05; `created_at` / `updated_at` are the seed
migrations' own timestamps and `notes` is the seed's own sentence where it has
one. Nothing here was read out of the production database, so the fixture can
live in the repository without publishing a tenant's data — and the self-test
still exercises the whole decision path, because the only fields the decision
reads are the website, the id and the note column.

The fetch evidence the self-test asserts against is in the script itself
(`RECORDED_EVIDENCE`), measured live on 2026-09-05 with the sweep's own agent;
`--refetch` re-measures it.
