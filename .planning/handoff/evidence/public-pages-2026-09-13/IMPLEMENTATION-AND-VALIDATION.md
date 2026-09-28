# Public-page and vault integration delivery — 2026-09-13

Base: `60ed83a7e6d5eb8b8e0e631783a598cd0f562bff`. Working branch: `codex/public-page-finalization`. Source edits exist only in the assigned `worktrees/public-pages` checkout. No stage, commit, push, merge, production write or deployment was performed by this agent.

## Implementation

Seven pages now use the existing `PublicShell` when `usePublicDesign()` is enabled: ForgotPassword, ResetPassword, VerifyEmail, InviteLanding, NoAccess, Privacy, VendorPortal. They keep their legacy rendering when the existing switch is off. No new App route or feature registry entry was added; root owns integration and rollout. All new shell wordmarks link to `/login`.

- Forgot/reset preserve enumeration resistance, the login email prefill, validation, throttles and token routes. Success wording distinguishes an accepted request from proof of email delivery.
- Signed-out verification has a sign-in path before authenticated resend. Existing verified-token behavior stays. Resend errors are readable inline.
- Invitation preview read failures have retry and no longer become expired invitations. Restaurant/role preview disclosure is unchanged; accept remains explicit, refreshing branches before navigation.
- NoAccess explains the lack of a restaurant and preserves sign-out/invitation directions. ProtectedRoute wiring is root-owned.
- Privacy becomes a readable document. Both new and legacy copy correct unsupported “only app-created files” for Excel, automatic provider revocation, and universal analytics-checkbox guarantees. The copy does not invent legal entity, retention, support address or processor commitments.
- Vendor public catalogue becomes a board with search, currency-grouped price sorting, keyboard-scrollable table and explicit unknown values. No 750ml conversion without volume; no unknown vintage→NV or unknown stock→InStock. Vendor publisher attribution remains, with no approval seal pending the founder's endorsement decision. Page/listing DB faults return503; absent/unpublished pages still404. Both gateway and browser structured data omit unknown availability. Browser loading/retry clears stale catalogue/JSON-LD.
- Verification, password-reset and Studio-invitation mail now use Mudavym in subjects/body/header/footer and sender display name. The configured sending address, credentials, recipient, links and expiry rules stay unchanged. Other restaurant messages keep their existing identity; no test sent mail.
- PublicShell now honors explicit `ground="paper"` on the same token element. The current token default is Warm Charcoal, independent of the old app theme. Scoped input rules override globals.css's forced white fields, using tokens in both grounds and44px minimum control height.

## Vault integration

The existing `.planning` Obsidian vault is retained. The dated report bundle is `.planning/07-reference/mudavym-transition-2026-09-13/`, indexed from `07-reference/INDEX.md`; its `MUDAVYM-TRANSITION-2026-09-13.md` links nine detailed Markdown reports, the final PDF and evidence inventories.22 original payloads total about1.04MB. Worktree/user paths in Markdown are converted to versioned repository references or stated local evidence; original PDF remains the dated rendered report. Import hashes and51 relative Markdown links were verified. The four isolated historical reproductions now discover their repo relative to the vault and all execute successfully against the fixed audit SHA.

Seven existing page dossiers and `handoff/PROGRESS.md` record current changes separately from historical audits. The founder authorization is additive: older history is retained. `decisions/OPEN-DECISIONS.md` adds an unnumbered pending-choice section so this agent does not collide with root's ADR allocation.

## Verification

- Web TypeScript: pass.
- Gateway TypeScript including tests: pass.
- Web regression:107passed +14optional capture cases skipped across PublicShell, publicDesign, public recovery and existing login/register design tests. One subsequent privacy flag-off regression increased unique passing web coverage to108; the final changed pair passed30/30.
- Gateway:10/10passed across vendor read/structured-data, account email templates and sender identity. No real database/provider I/O.
- Web production build with `VITE_MUDAVYM_PUBLIC=true`: pass. Existing chunk-size warning remains (main bundle about2.12MB uncompressed/506KB gzip); this group did not claim to solve bundle sizing.
- `git diff --check`: clean.
- Runtime: ignored local node_modules symlinks point to the user's already-installed source checkout dependencies. No dependency/lock changes. Tests use `--no-cache` to avoid writing through those links; Vite cache goes to `/tmp/mudavym-public-vite-cache`.
- Persistent test/build logs are `.planning/handoff/evidence/public-pages-2026-09-13/`.

## Actual visual coverage and remaining checks

CUA native Safari successfully rendered the real routes through the temporary same-origin harness at `http://127.0.0.1:5275/.public-qa.html`:

| Route/state | Width | Ground | Observed |
|---|---:|---|---|
| forgot-password form |1080|Charcoal|Shared masthead, plate, field and submit; no horizontal overflow|
| forgot-password form |375|Charcoal|Page scrollWidth375; readable layout, token field,44px control, /login links|
| forgot-password form |375|Paper|Actual explicit paper screenshot; page scrollWidth375; readable field and seal button|
| reset-password missing token |375|Charcoal|Missing-token sentence and new-link action; no overflow|

The first Chrome charcoal screenshot revealed white fields caused by globals.css; this was repaired and confirmed in Safari. Native screenshots are inline tool evidence, not claimed as local screenshot files. Broader route/ground/state visual QA remains incomplete because the foreground repeatedly returned to another Safari window during checks. No unrelated screenshot has been imported into the vault. Do not claim the other five pages or successful email/invite mutations were visually tested.

The temporary `.public-qa.html` and `.public-preview.config.ts` are excluded from delivery manifest. They can be reused for remaining local QA; the one server is5275, the existing development server process. They must not enter production. Root may remove them once QA finishes.

## Pending founder choices

1. Staffed support/privacy address and whether the configured account-mail sending address should use it. Display name is already Mudavym.
2. Signed-out verification: keep sign-in-before-resend (recommended) or explicitly build a separate enumeration-resistant anonymous flow.
3. Invitation preview: retain current public restaurant/role (current implementation) or restrict the read-model until authenticated.
4. Vendor board endorsement: publisher attribution without approval seal (recommended) or intentionally vouch for published vendor content.
5. Complete privacy policy details: legal entity, retention/deletion and processor commitments. Keep verified provider-scope disclosures regardless.
6. Font hosting: existing Google Fonts request is retained and disclosed; self-hosting should cover all entrances if selected.

Existing backend verification resend may acknowledge a queue attempt despite a delivery failure. This group changed truthful request copy; it did not repair delivery-outcome persistence and does not claim actual delivery.

Next bounded work suggestion: vendor-prices read-error/currency/normalization integrity can progress independently with existing contracts; final trend and identity-scope choices need the founder. Arrival has decided flyleaf/folio/skip/proposal requirements in ADR0143 but needs coordinated persistence and provenance work. Help's public contact wiring should await the address.

## Integration

Use the parent integration file manifest as the explicit copy list. It includes modified/new source, tests and vault documents, and excludes the temporary preview files, node_modules and build outputs. Root owns App/AGENTS/flags/ADR and git operations. If merging this group while root also changed handoff or OPEN-DECISIONS, merge these additive sections rather than overwriting root's additions.
