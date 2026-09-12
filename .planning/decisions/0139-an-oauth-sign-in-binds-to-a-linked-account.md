# 0139 — An OAuth sign-in binds to a linked account, and a provider token is a credential only when it was minted for us

- **Status:** Locked (founder, 2026-09-12, in session) — built in this PR
- **Date:** 2026-09-12
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** oauth, microsoft, google, id token, jwks, audience, issuer, user_oauth_accounts, provider_user_id, account takeover, enumeration, fail closed, ADR 0139
- **Links:** [[0024-identity-first-signin]] (identity-first sign-in, the provider registry, the `oauth_provider` legacy hint), [[0020-no-fabricated-answers]] (a surface never invents an answer), [[0096-a-route-declares-its-own-exposure]] (`@Public()` by decision, not omission), PR #179 (the Google self-provision hole), `apps/api-gateway/src/auth/microsoft-id-token.ts`, `.planning/06-pages/login.md`

## Context

`POST /api/v1/auth/oauth/microsoft` is `@Public()` by decision
(`apps/api-gateway/src/auth/auth.controller.ts:129-131`). Anyone on the internet
can post a string to it. On main `6e6f2f94` that string was not verified in any
sense of the word.

**Defect 1 — the token was never checked.** `verifyMicrosoftToken`
(`auth.service.ts:630-655` on `6e6f2f94`) took the body string, sent it to
`https://graph.microsoft.com/v1.0/me` as a Bearer token, and trusted
`data.mail || data.userPrincipalName`. Graph answers for **any** valid Microsoft
Graph access token, including one minted by an Azure application the attacker
owns. There was no audience check, so a token issued to someone else's app was
as good as one issued to us; no issuer check; no signature we verified
ourselves; and no verified-address check. Compare `verifyGoogleToken`
(`auth.service.ts:590-625` on `6e6f2f94`), which at least compared `aud` against
`GOOGLE_CLIENT_ID` and required `email_verified`.

**Defect 2 — the account was resolved by address alone.**
`findOrCreateOAuthUser` (`auth.service.ts:1559-1589` on `6e6f2f94`) normalised the address,
read one row out of `users`, and returned it. It never read
`user_oauth_accounts`, never read `users.oauth_provider`, and never compared the
provider's own subject id. An address is not an authorisation, and here it was
treated as one.

Composed, the two are an account takeover: a Microsoft token minted for an
unrelated application, carrying an address that matches a Mudavym user, signed
the holder in **as that user** — including a password-only user who had never
touched Microsoft, and including an owner. This is the sibling of the Google
self-provision hole closed in PR #179; that fix removed the auto-create, and
left the resolve-by-email underneath it untouched.

Production, measured read-only by the parent session on 2026-09-12 before any
change: **8 users; all 8 carry a password hash; 1 row in `user_oauth_accounts`,
provider `google`; 0 Microsoft links; 1 user with the legacy
`users.oauth_provider` set; and ZERO users with no password, no link row and no
legacy provider.** So a strict link requirement locks nobody out, and every user
retains a working way in. That measurement is what made "require a link" a
decision that could be taken now rather than a migration.

## Decision

**An OAuth sign-in returns an account only when that account is linked to that
provider, and a provider token is a credential only when it was minted for us.**

Six arms, all in this PR:

1. **The link requirement** (`auth.service.ts`, `findOrCreateOAuthUser` →
   `oauthAccountIsLinked`). After the account is found by address, it must
   actually use the provider: a row in `user_oauth_accounts` for
   `(user_id, provider)`, or — only when there are **no rows at all** — the
   legacy pair in `users`. This follows `resolveLinkedProviderIds`
   (`auth.service.ts` §"The providers actually linked to a user") rather than
   forming a second opinion; that method is the existing source of truth and its
   legacy fallback is deliberate (ADR 0024, measured 2026-08-26: the column was
   NULL for 9 of 10 production users, including the one who genuinely had a
   linked Google account).

   **Every branch compares a subject.** Where the stored row carries a
   `provider_user_id`, the provider's own subject id must match it; both
   providers supply one — Google's `sub`, Microsoft's `oid`. A row with a blank
   `provider_user_id` is matched on the provider alone, because that is a row
   this codebase could have written and locking a real user out over our own gap
   is not a security gain.

   The **legacy branch compares `users.oauth_id`** — the column
   `linkOAuthProvider` writes beside `oauth_provider` and which nothing had ever
   read back. Without it, `oauth_provider = 'google'` with no rows is an UNBOUND
   claim: it names a provider but no account, so any Google identity presenting
   that verified address signs in. That is not hypothetical — see arm 5.

2. **A failed read of the link table REFUSES.** supabase-js *resolves*
   `{ data, error }`; it does not throw. Without an explicit branch an
   unreachable table arrives as `rows: null`, reads as "no links", and is
   reported as "not linked" — the repo's standing fault, absence reported as
   health, sitting on an authorisation decision. It now throws its own sentence,
   distinct from the refusal, so "we could not check" is never collapsed into
   either "linked" or "not linked".

3. **Microsoft verifies an ID token** (`apps/api-gateway/src/auth/microsoft-id-token.ts`).
   RS256 and nothing else; the signature checked against Microsoft's published
   JWKS; `aud` equal to `MICROSOFT_CLIENT_ID`; `iss` equal to the configured
   issuer; `exp`/`nbf` with 60s skew; a verified address (`xms_edov`, the
   Microsoft analogue of Google's `email_verified`); and `oid` present, because
   without it nothing can bind the token to a link row. The JWKS is cached for
   10 minutes and re-fetched once on an unknown `kid` to survive key rotation;
   a fetch failure, an empty key set, and a `kid` that survives the re-fetch are
   all **refusals**. Unset `MICROSOFT_CLIENT_ID`, or unset issuer configuration,
   refuses with a sentence rather than falling back to anything.

   Two narrowings added after the merge gate's security angle. **It must be an
   ID token:** `ver` is `"2.0"` and `scp` is absent — the exact v2.0 issuer
   already rules out a v1.0 token, but not an access token minted for this same
   application by an app registration that exposes an API scope, and `scp` is
   what separates those. `roles` is deliberately NOT refused: Azure app-role
   assignments appear in a legitimate ID token. And **`xms_edov` may only vouch
   for the claim it attests**, so the `preferred_username` fallback is gone; a
   token with no `email` claim refuses rather than borrowing a proof.

4. **Google keeps its checks and gains the link requirement**, and its audience
   check now fails closed. It read `if (expectedClientId && data.aud !== ...)`,
   so an unset `GOOGLE_CLIENT_ID` silently removed the audience check entirely —
   the same shape of hole on the other provider, found while hardening this one.

5. **`unlinkOAuthProvider` recomputes the legacy pair FROM THE ROWS,
   unconditionally.** It used to ask `getLinkedProviders` what to write, and
   `resolveLinkedProviderIds` underneath it falls back to reading
   `users.oauth_provider` when there are no rows. Having just deleted the last
   row, it read the very column it was about to overwrite and wrote the same
   value back: unlinking Google left `oauth_provider = 'google'` with **zero
   rows** and `oauth_id = null`. Proven with a probe by the merge gate's
   correctness angle on PR #357, which measured rows `[]`, provider `google`,
   and a subsequent Google sign-in for a **different `sub`** resolving that
   account. Arm 1's subject comparison closes the sign-in side; this closes the
   write side, so the state cannot be created in the first place. It also
   carries `oauth_id` over from a surviving row instead of nulling it, which the
   old code did even when it kept a provider name — the same unbound pair from
   the other direction.

6. **The Microsoft endpoint configuration is validated, not merely read.**
   `MICROSOFT_ISSUER` and `MICROSOFT_JWKS_URI` are operator overrides; an
   `http://` JWKS uri makes key retrieval MITM-able, and an issuer naming one
   tenant paired with a JWKS naming another checks the right issuer string
   against the wrong signing keys. Both must be `https`, on a known Microsoft
   identity host, and must agree on host and tenant segment. Consequence,
   stated plainly: override one and you must override both, consistently.

The refusals for "no account uses that address" and "that account does not use
this provider" are **the same sentence**. The route is public; two sentences
would make it an address oracle answering "someone here uses that address" to a
stranger holding a token for their own account. ADR 0024 made the enumeration on
`POST /auth/sign-in-methods` deliberate, narrow and rate-limited; this route was
never part of that grant. The replaced string ("No WineOps account uses that
address…") also carried the old brand, filed as a rebrand surface in
`.planning/06-pages/login.md` §7; the new sentence names no brand.

Microsoft's `enabled: false` in `identity-providers.ts` is **not** flipped.
`enabled: true` means a person can complete a sign-in from the login page today,
and there is no Microsoft button. This change makes the endpoint safe; it does
not make the provider shippable, and saying otherwise on the login page would be
exactly the fabrication ADR 0024 removed.

## Alternatives rejected

1. **Keep the Graph call and add an audience check to it.** There is nothing to
   check: `/v1.0/me` returns a user profile, not the token's claims, and Graph
   will not tell us who the token was issued to. Verification has to happen
   against the token itself. Rejected on impossibility, not preference.

2. **Add a JWKS library (`jwks-rsa`, `jose`, `openid-client`).** The brief ruled
   out a new npm dependency, and Node's `crypto` covers the whole requirement:
   `createPublicKey({ key, format: "jwk" })` plus `crypto.verify("RSA-SHA256",
   ...)` is RS256 verification. Rejected as unnecessary surface.

3. **`jsonwebtoken` through `@nestjs/jwt`.** Checked, not assumed: it is a
   declared dependency of `@nestjs/jwt@10.2.0`, but pnpm's strict layout keeps it
   at `node_modules/.pnpm/jsonwebtoken@9.0.2/...` and
   `require.resolve("jsonwebtoken", { paths: ["apps/api-gateway"] })` throws
   MODULE_NOT_FOUND. An import that works on a hoisted install and breaks on ours
   is worse than no import.

4. **`JwtService.verify(token, { publicKey })`.** Rejected because it would
   **silently verify with the wrong key**. `JwtService#getSecretKey` resolves
   `options.secret || this.options.secret || … || options.publicKey`, and
   `AuthModule` registers `JwtModule` with a `secret` (`auth.module.ts:29`), so
   the application's own HS256 secret wins over the RSA public key passed at the
   call site. A token signed with our own JWT secret would then verify as a
   Microsoft identity — a worse hole than the one being closed, and a silent one.

5. **Accept `common` as the tenant and skip the issuer check.** With `common`,
   Microsoft signs `iss: https://login.microsoftonline.com/{tid}/v2.0` for
   whatever tenant the caller belongs to, so an issuer check against it checks
   nothing. Multi-tenant sign-in is a decision about *which* tenants may sign in;
   until it is made, a placeholder tenant refuses.

6. **Trust Microsoft's `email` claim without `xms_edov`.** Microsoft documents
   `email` as mutable and not owner-verified unless that optional claim is
   emitted. Since the account is matched by address, accepting an unverified one
   reopens the hole through the front door. Refusing costs a one-field change in
   the Azure app registration; accepting costs an account.

7. **Match the link on the address only, ignoring `provider_user_id`.** Simpler,
   and it would have let the one production Google link keep working under any
   circumstance. Rejected: two different provider accounts can present the same
   address over time, and the subject id is the only thing that separates them.
   The measured cost is bounded — all 8 production users have a password.

8. **Do nothing / file it as tech debt.** The endpoint is public, unauthenticated
   and live. Rejected by the founder on sight.

9. **Close the TECH-DEBT gap the other way: write the missing
   `user_oauth_accounts` row on sign-in.** That entry
   (`v3.0-TECH-DEBT.md`, under the PR #179 closure) described a real
   truthfulness gap — `resolveSignInMethods` reporting an identity as
   password-only while Google demonstrably worked for it. Writing the row would
   have made the report true and preserved the frictionless path. Rejected:
   persisting a link off the back of a check that was passed **by address
   alone** would have made permanent exactly the thing that made the Microsoft
   endpoint a takeover. Refusing is the arm that removes the premise instead of
   recording it. The entry is struck and the reasoning recorded there.

10. **Make the CLAIMS verify run the behavioural test.** The merge gate was
    right that "an address is no longer an authorisation" is a property a grep
    cannot check. Rejected on measurement: the `decision-claims` CI job
    (`.github/workflows/ci.yml:539-547`) is checkout-only — no Node setup, no
    install — so `npx jest` there is a command that CANNOT RUN, which this repo
    counts as a failure, not a skip. The claim is narrowed to what the grep
    proves and labelled a SHAPE CLAIM; the property itself is proven by
    `oauth-provider-binding.spec.ts` in the `test-typescript` job.

11. **Refuse `roles` alongside `scp` when separating ID tokens from access
    tokens.** Symmetrical and tempting. Rejected: Azure app-role assignments
    appear in a legitimate ID token as `roles`, so refusing it would reject a
    real sign-in from any tenant that uses app roles. `scp` carries no such
    ambiguity, and `ver` covers the version axis.

## Consequences

- **Easier:** an address stops being an authorisation anywhere in the OAuth path;
  `POST /auth/oauth/*` stops answering questions about which addresses have
  accounts; Microsoft's endpoint can exist without being a liability while its
  button is still unbuilt.
- **Harder / given up:** linking a provider is now a prerequisite for signing in
  with it, so the "sign in with Google and it just works" path requires a link
  first (`POST /auth/me/link/:provider`, `auth.controller.ts:286-289`, already built). Enabling Microsoft now also
  requires a concrete tenant and the `xms_edov` optional claim in the Azure app
  registration, not just a client id.
- **Operationally:** with `MICROSOFT_CLIENT_ID` unset — its state in production
  today — the route refuses every call. That is the intended resting state.
- **Revisit when:** a second tenant needs to sign in (the multi-tenant fork
  below must be decided), or `user_oauth_accounts` acquires rows with a blank
  `provider_user_id` (the lenient branch in arm 1 stops being a compatibility
  shim and becomes a hole).

## What this does NOT settle

- **Multi-tenant Microsoft sign-in.** Named, not decided. A `common`/
  `organizations`/`consumers` tenant is refused; deciding which tenants may sign
  in is a founder call that has not been made.
- **Whether Microsoft ships at all.** `enabled` stays `false`; there is still no
  button, no web flow, and no Azure app registration in this repo's environment.
- **The pre-existing `users` read in `findOrCreateOAuthUser`.** It still
  destructures `{ data: user }` without `error` (a baselined site,
  `scripts/read_error_baseline.json`, key `auth.service.ts::users::user`). It
  fails *closed* — a failed read becomes the refusal — so it is out of scope
  here and named rather than silently left.
- **Session revocation.** Nothing in this change invalidates a token already
  issued through the old path. Nothing in this codebase tracks issued tokens; see
  the same note under `resetPassword`.
- **Whether the one production Google link's stored `provider_user_id` matches
  what Google sends today.** Unverifiable from here without a production write
  path or a live sign-in; that user has a password, so the worst case is one
  provider button that refuses, not a lockout.
- **Whether Microsoft's real JWKS and ID tokens match the shapes assumed here.**
  There is no Azure app registration in this environment and no outbound call was
  made. The JWKS path is exercised against locally generated RSA keys, through
  both a stub fetcher and the production `axios` fetcher; what is unproven is
  that a real token carries `kid`, `xms_edov` and an `iss` in the exact derived
  form.
- **The Profile page's link buttons when a provider is unconfigured.** They now
  refuse with the server's sentence (`linkOAuthProvider` runs the same
  verifiers); nothing pre-checks configuration or greys the button, so a
  misconfigured environment reads as a broken button. Recorded in
  `.planning/06-pages/profile.md` §4 and §9, not fixed here.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-12 | Aldemir (founder) | Decided in session: fix properly in ONE PR, harden BOTH providers, first PR off main |
| 2026-09-12 | Claude (builder) | Created; 15 of the first 39 tests observed failing against `6e6f2f94` before being kept |
| 2026-09-12 | Merge gate, PR #357 (3 angles + adversary) | **BLOCK** from the compliance angle: a live TECH-DEBT item this PR falsified, a route name that does not exist in two documents, and a test header that over-claimed the pre-fix evidence |
| 2026-09-12 | Merge gate, correctness angle | Probe-proved `unlinkOAuthProvider` reaching the unbound-legacy state; arms 1 and 5 above are the answer. Spec now 54 tests: **21 fail against `6e6f2f94`**, **6 against the first version of this fix** (`2815c742`, the unlink and legacy-subject cases), **7 against the first version of `microsoft-id-token.ts`** (`ver`/`scp`, the `email` claim, the endpoint-override validation) |
