## /vendors walk-through leftovers — OPEN — found on `fix/review-vendors` — 2026-10-08

Defects seen on the founder's /vendors walk (ADR 0319, `06-pages/providers.md` §14) and **not** fixed on this branch.

1. **`GET /vendor-terms` reads the whole house's register to show one vendor's terms.** Measured ~1.3 s on YAREN in the P9 headless run; the sheet reads it once per opening in production (P10, Chrome, Tuzlu Rüzgar). `providers.md` §13 item 0 already names the fix (narrow the read to one provider, `providerIds` filter). Not done here: `apps/api-gateway/src/vendor-terms/**` is a gateway lane of its own.
2. **A failed vendor-list read draws an empty book** (VEN-W25, approved, SHARED). `hooks/queries/useProviderQueries.ts:49-62` returns `[]` in dev and the last IndexedDB copy in production on any error, so the page's own failure notice never shows. Eight pages use the hook; queued in `p4-scratch/review-shared-queue.md`.
3. **On charcoal every text box is white with #1f2937 text** (`globals.css` `!important`; `mudavym.css:260-300` fixed date inputs only) and **the page tip band stays paper** — both SHARED, queued 2026-10-08.
4. **`/auth/me` is read three times per page load** — the shell, not this page (P9).
5. **"Supplies my menu" matches wines only** — said on the page; the lane is OD-227.
