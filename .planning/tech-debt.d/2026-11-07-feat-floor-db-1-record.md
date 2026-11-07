## Deleting an account that has punches fails after the person is removed from every house — OPEN — 2026-11-07

Filed by `feat/floor-db-1-record` (PR #772), found by its ADR 0090 correctness review at `011467e8d`.

**What is true.** `floor_punches.user_id` is `ON DELETE RESTRICT`, so ADR 0350 `:71` keeps a person's hours when their account goes (`supabase/migrations/20270302100000_the_floor_keeps_its_own_record.sql`). `AuthService.deleteAccount` (`apps/api-gateway/src/auth/auth.service.ts:4650-4665`) first removes the person from every house and deletes their access rows, and only then deletes `public.users`. For a person with a punch, that last step fails with "Failed to delete account", after the earlier steps have already run. Today no code writes a punch, so no account is affected.

**What closes it.** Either `deleteAccount` checks for punches before it changes anything and says why it refuses, or it ends the person's sign-in and keeps the `public.users` row. Which of the two is a fork, and it belongs to the floor module PR that first writes punches.

## The punch table leaves some correction rules to the gateway — OPEN — 2026-11-07

Filed with the entry above, from the same review and the adversary's.

**What is true.** The append-only trigger on `floor_punches` refuses a rewrite, a DELETE while the house still exists, and TRUNCATE. It does not check the following. This is not a closed list.
- A `superseded_at` mark has a correction row naming the punch.
- A Back's `resumes_id` names the same person's `break` punch, and that punch is resumed once.
- `shift_id` goes to null only because its shift was deleted.
- A `user_id` (on punches, assignments, `pos_server_links` and nudge sends) belongs to the house. ADR 0345 E5 keys only house-owned rows by `(id, restaurant_id)`.
- Undoing a Paid clears `paid_at` and records the undo in `floor_events`. ADR 0353 keeps only the last undo on the seating.

**What closes it.** The floor module's write paths enforce each rule, each with a spec, in the PR that first writes the table concerned.
