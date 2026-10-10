## Saved sommelier conversations: the surface is gone and so is the grant — OPEN — 2026-10-09

Closing note for `v3.0-TECH-DEBT.md:154`, "44.1e — Saved sommelier conversations never load. Same shape as OD-45, different cause." Filed by `fix/sim-db-views-leftovers` (F-531); it lives here because that register is frozen (ADR 0240).

`/sommelier` redirects to `/ask` (`App.tsx:557`) and `useSommelierQueries.ts` has no importer but the barrel. `20270102500000_every_view_reads_as_its_caller.sql` revokes anon/authenticated on `sommelier_conversations` and the lockdown guard's DEBT list is empty. Still owed: delete the dead hook (CLAIMS `OD-72`, `status: open`) so `lib/supabase.ts` stops shipping.
