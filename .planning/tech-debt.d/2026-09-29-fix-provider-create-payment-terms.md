## Adding your own vendor with Payment terms was refused with a 400 and shown as "saved offline" — CLOSED on `fix/provider-create-payment-terms` — 2026-09-28

**Where.** Web endpoint sweep 2026-09-28, row 15 (`/vendors`, add own
vendor). `apps/api-gateway/src/providers/dto/providers.dto.ts`
(`CreateProviderDto`), `providers.service.ts` (`createProvider`, custom
branch), `apps/web/src/hooks/queries/useProviderQueries.ts`
(`useCreateProvider`), `apps/web/src/pages/providers/next/NewVendorSheet.tsx`.

**What was wrong.** The new-vendor sheet sends `paymentTerms` whenever a
term is chosen; `CreateProviderDto` never declared it (only
`UpdateProviderDto` did), so the global ValidationPipe (`main.ts`:
whitelist + forbidNonWhitelisted) refused the whole create with a 400.
`useCreateProvider` caught every failure — that 400 included — queued it
for offline sync and resolved with a fabricated `temp_…` id, so the page
said "Provider saved offline", wrote delivery days and an address against
an id naming no row, and the vendor was never created (the queued replay
would be refused the same way). Re-verified on `origin/main` 2ba1326e3.

**Fix.** `paymentTerms` declared on the create DTO and written to
`providers.payment_terms` on the custom branch (NULL when unstated — the
column already exists, its default dropped by migration 20260903170000; no
migration). `useCreateProvider` queues only when the request got no
response; any 4xx/5xx or non-network throw rejects and the sheet shows it.
A genuinely queued create writes nothing against its temp id and says what
was not recorded. Tests: `create-payment-terms.spec.ts` (through the pipe
options read from `main.ts`), `useProviderQueries.create-offline.test.tsx`,
one case in `NewVendor.test.tsx`; all failed on main. CLAIMS
`SWEEP-2026-09-28-R15-PROVIDER-CREATE-PAYMENT-TERMS`.

**Left open.** The catalogue path (`catalogue_vendor_id`) still ignores
`paymentTerms`; `useUpdateProvider` and the legacy `pages/Providers.tsx`
still share the queue-on-any-failure / temp-id pattern — not in this row.

**[Amended 2026-09-29, ADR 0090 audit of #508 at `8e5a5098b`, adversary blocker.]**
"No response" (`error.request && !error.response`) includes a timeout after the
gateway committed the vendor, so the queued replay (`sync-manager.ts`
`provider.create`) could create a second vendor, and the custom-vendor branch
of `providers.service.ts` has no duplicate guard. Fixed with the replay
mechanism the gateway already has: `useCreateProvider` mints one
`Idempotency-Key` per create, sends it on the first attempt and stores it in
the queued data; the sync handler sends it back as the header (not as a vendor
field). The global `IdempotencyInterceptor` (`common/idempotency`, table
`api_idempotency_keys`) answers a repeated key with the stored first response
and does not run the handler. Evidence: two cases in
`useProviderQueries.create-offline.test.tsx`, one in `sync-manager.test.ts`,
and `idempotency.interceptor.spec.ts` (replay returns the stored vendor, handler
not called). **Residual:** the interceptor stores the response after the
handler returns and fails open, so a replay that lands while the first request
is still executing, or when the key table is unreachable, can still duplicate;
entries queued before this change carry no key and replay as before.
