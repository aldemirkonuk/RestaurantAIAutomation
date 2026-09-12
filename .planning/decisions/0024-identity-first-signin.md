# 0024 — Sign-in reveals the methods an identity actually has

- **Status:** Locked
- **Date:** 2026-08-26
- **Decider:** Aldemir (founder) — decided 2026-08-26: *"keep the options for google sign in button — maybe we'll decide more in the future, keep the structure for maybe future additions (apple, microsoft) and so on."*
- **Keywords:** auth, login, sign-in, identity-first, oauth, provider registry, enumeration, user_oauth_accounts, oauth_provider, validateUser, NO_SIGNIN_METHOD, OAUTH_ONLY
- **Links:** [[0020-no-fabricated-answers]], [[0023-email-verification-is-enforced]], `.planning/06-pages/login.md`, `.planning/06-pages/register.md`

## Context

`aldemirkonuk@hotmail.com` could not sign in by any route. `AuthService#validateUser`
answered the question *"which provider does this password-less account use?"* like this:

```ts
const provider: "google" | "microsoft" | null =
  user.oauth_provider === "microsoft" ? "microsoft" : "google";
```

`oauth_provider` was NULL, so it fell through to `"google"` and told the user
*"This account uses Google sign-in. Use the 'Sign in with Google' button below."*
That is a guess presented as a fact, and it pointed at a flow that could never
work for that row. ADR 0020 forbids exactly this.

**The production census (2026-08-26 10:13 UTC, 10 users) is what makes it damning.**
Not "sometimes wrong" — wrong every time it fired:

| Shape | Count | What the old branch said |
|---|---|---|
| No password, no `user_oauth_accounts` row, `oauth_provider` NULL | 4 | "uses Google sign-in" — **fabricated, 4 of 4** |
| Has password | 6 | (branch not reached) |
| Has a `user_oauth_accounts` row | 1 | that user also has a password, so the branch never fires for them |

So there was **no production account for which the message was true**. Every
firing was a fabrication. `oauth_provider` is also nearly empty — set on 1 of
10 users — and NULL even for the single user who genuinely has a linked Google
account. It is not the source of truth and never was; `user_oauth_accounts` is.

A second, quieter instance of the same class sat on the client. `Login.tsx`
intercepted any `@gmail.com` address before `login()` ran and opened Google's
chooser. Two production accounts (`demo@gmail.com`, `yarenccinar@gmail.com`) are
gmail addresses holding a real password and **no** linked Google account — the
shortcut made their password unusable from that page. A domain is not an
identity provider.

Someone had already written this gap up accurately in comments at
`apps/web/src/pages/Login.tsx:46-60`; this ADR is that note carried to a decision.

**Mid-session correction, recorded because it changes what a reader should expect:**
at 10:16 UTC — three minutes after the census above — a password-reset token
that had been issued at 10:10 UTC was consumed, and `aldemirkonuk@hotmail.com`
gained a `password_hash`. The founder's named example is therefore **no longer**
in the broken state. The three `sim-*@wineops.internal` accounts still are, and
were used for the end-to-end verification below. The defect class is unchanged;
only the poster child moved.

## Options considered

1. **Reveal nothing — one form, password + every button, always** (status quo minus
   the lie). Cheapest, leaks least. Rejected: it leaves the method-less account with
   no honest path — the user still sees a password box that can never accept
   anything, and nothing tells them why. It also keeps the "silently missing
   option" shape that let the fabricated message look plausible.
2. **Domain heuristic — hotmail/outlook → Microsoft, gmail → Google.** Rejected
   outright, and named here so it is not re-proposed. It is the same fabrication
   with better manners: a claim about an identity derived from a string. Verified
   against production it would be wrong for `demo@gmail.com` and
   `yarenccinar@gmail.com` (password, no Google) and for `konukp@hotmail.com`
   (password, no Microsoft) — 3 of the 4 addresses whose domain implies a
   provider. **At most a UI hint clearly labelled a guess. Never a claim.**
3. **Show every declared provider as a button, all the time.** Honest about the
   product, useless about the account: a method-less user still gets no answer,
   and two permanently dead buttons train everyone to ignore the row.
4. **Identity-first: email → resolve → render exactly what that identity has.**
   The Google/Microsoft/Okta shape. Costs a round-trip and makes an existing
   enumeration leak deliberate. **Chosen.**

## Decision

**Sign-in asks who you are first, then shows the methods that identity actually
has — sourced from `password_hash` and rows in `user_oauth_accounts`, never
inferred.** Providers are declared once in a registry; nothing else branches on a
provider name.

Three pieces:

- **Registry** — `apps/api-gateway/src/auth/identity-providers.ts` declares
  `password`, `google` (enabled) and `microsoft`, `apple` (declared, disabled,
  each with a user-visible reason). Adding a provider is an entry here, a strategy
  in `AuthService`, and one id in the web `RENDERABLE_PROVIDER_IDS`. Labels,
  order and disabled-reasons travel on the wire, so the login page branches on no
  provider name of its own.
- **Resolution** — `POST /auth/sign-in-methods`. POST with a body, not
  `GET ?email=`: the address is personal data and a query string reaches access
  logs, proxy caches and history. (`GET /auth/check-email` predates that rule and
  is left alone.) Rate-limited to **10 per 10 minutes per IP** via the existing
  `@RateLimit` decorator on the already-global `RateLimitGuard` — tighter than the
  10-per-60s every `/auth/` route already gets.
- **Truth in `validateUser`** — a password-less account is told either *"This
  account signs in with X"* (X read from its rows) or, when it has nothing,
  *"This account doesn't have a sign-in method set up yet"* with the set-password
  path. New code `NO_SIGNIN_METHOD`; `OAUTH_ONLY` keeps its singular `provider`
  field so the existing web client is unbroken, and gains a truthful `providers`
  array.

### Unknown emails return the standard set

An address matching no account gets `methods: [password, google]` — byte-identical
to a fully-provisioned account, with **no** field marking it unresolved.

The alternative was `methods: []` / `noSignInMethod: true`, which reads as
"kinder to no one" once you follow it through: the page would then tell someone
who mistyped their address *"This account has no sign-in method set up"* — a
statement that **fabricates the existence of an account**. That is ADR 0020
violated in the opposite direction, by the very change meant to enforce it. It
would also make the endpoint a crisper oracle than `check-email` already is.

Returning the standard set claims nothing about the address at all, and the user
falls through to the existing, honest `Invalid credentials` from `POST /auth/login`.

### On enumeration: revealing is deliberate, and the leak already existed

This endpoint tells a stranger which methods an address has. That is accepted, not
overlooked. The relevant fact is that the leak is not new:

- `GET /auth/check-email` is `@Public()` and answers `available: true/false` to
  anyone (`auth.controller.ts`).
- `POST /auth/register` replies *"Email already registered"*.

This decision makes an accidental leak deliberate, narrower in shape, and
rate-limited. **The one thing it confirms that `check-email` does not** is
"this address belongs to an account with no sign-in method" — and that population
is precisely who the change exists to unbreak. Named here rather than discovered
later.

**`requestPasswordReset` is untouched and stays enumeration-safe.** It returns the
identical response for every address, known or not, and that property is pinned by
`password-reset.spec.ts`. Nothing in this ADR licenses weakening it.

## Consequences

- **Easier:** a method-less account now has an honest screen and a working exit.
  Adding Apple or Microsoft is a registry entry plus a button, not a rewrite.
  No provider name is inferred anywhere in the auth path.
- **Harder / given up:** one extra round-trip before the password box appears.
  Enumeration is now intentional on this route. The registry mirrors two things it
  cannot enforce from one place — the DB `CHECK` on
  `user_oauth_accounts.provider` (`google|microsoft` only, so **`apple` cannot be
  linked without a migration**) and the web renderer map. Both are covered by
  `identity-first-signin.spec.ts`, which fails the build if an OAuth provider is
  enabled that the database cannot store.
- **Retires:** roadmap items 1 and 3 in `.planning/06-pages/login.md` §13 (fold
  `OAUTH_ONLY` into a generic error; let a Gmail user fall through to password
  login). Item 1 is answered differently than it proposed — the message is made
  *true* rather than generic — and that is the substance of this ADR.
- **Revisit when:** a second gateway replica runs (the in-memory rate-limit store
  stops being a fleet-wide limit — same caveat as
  `password-reset-throttle.guard.ts:20-28`), or if abuse logs show the endpoint
  being farmed, in which case the answer is proof-of-address-control, not a
  quieter lie.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-08-26 | Aldemir | Direction set: identity-first, keep Google, keep structure for Apple/Microsoft |
| 2026-08-26 | — | Created; production census re-verified, 21 tests each proven to fail against the reverted fix |
