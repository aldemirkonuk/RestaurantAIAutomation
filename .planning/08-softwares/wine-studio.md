---
type: software
slug: wine-studio
name: Wine Studio
division: sommelier
status: partial
tier: internal
routes: ["/studio", "/studio/queue", "/studio/certify", "/studio/invite/:token"]
pages: [studio, studio-queue, studio-certify, studio-invite-redeem]
api_modules: [common-orchestrator]
agents: []
owner_unit: ""
gap_reason: "Backed by proxy controllers inside `common/orchestrator/`, which no charter owns; the Studio product itself is unclaimed"
updated: 2026-09-01
links: ["[[studio]]", "[[studio-queue]]", "[[studio-certify]]", "[[studio-invite-redeem]]", "[[wine-library-sommelier]]", "[[SOFTWARE-MAP]]"]
---

# Wine Studio

## §0 What it is

The back room where the wine catalogue gets made. A trusted contributor drops in a wine
list — a PDF, a photo, a link — and the machine reads it into rows; the contributor
corrects what it got wrong, an admin approves the corrections, and only then does a wine
enter the library every restaurant sees. Nobody outside the company uses it. It exists
because [[wine-library-sommelier]] is only as good as the corpus behind it, and somebody
has to be accountable for each row.

## §1 Features today

- Redeem an invite link into a studio role on the account you are signed in with — one
  explicit button, single-use token
- See a roster of certified contributors
- Invite a contributor by email; revoke, enable or disable one
- Ingest a wine list three ways: PDF or photo via Claude Vision, URL via the Gemini
  crawler, or an empty manual record
- Review extracted records field by field with per-field confidence badges — 14 columns
  including grape, colour, sweetness and tasting notes
- Override a value; a high-confidence field requires a written reason
- Approve or reject a contributor's overrides one decision at a time, with an optional note
- Watch contributor trust progress
- Promote reviewed records into the master library (409 on a duplicate)
- Read a session metrics dashboard
- Crawl a URL for wines — *dark*: the toast says the crawler started; nothing starts, and
  nothing polls (§7)
- Invite someone who has no Mudavym account — *broken*: the grant can only land on an
  account that already exists, so they see "issued to a different email", which is true and
  unhelpful (`studio-invite-redeem.md:44-46`)

## §2 Screens

Four routes, and they are the one cluster in the app that does **not** live inside
`DashboardLayout` — confirmed at `apps/web/src/App.tsx:175` (*"Studio routes — separate
layout with StudioLayout, outside DashboardLayout"*) and in the components themselves:
`Studio.tsx:14`, `StudioApprovalQueue.tsx:51`, `StudioCertify.tsx:45` each wrap their body
in `<StudioLayout>` (`pages/studio/StudioLayout.tsx:16`), which renders its own nav and a
studio-role badge (`:10-13`).

- [[studio]] (`/studio`, `App.tsx:176-185`) — ingest and field review. Gated on
  `developer`, `certified_contributor` or `review_admin`.
- [[studio-queue]] (`/studio/queue`, `:186-193`) — the approval queue. `developer` or
  `review_admin` only.
- [[studio-certify]] (`/studio/certify`, `:194-201`) — the contributor roster and invites.
  Same two roles.
- [[studio-invite-redeem]] (`/studio/invite/:token`, `:208-215`) — **authenticated but
  deliberately not studio-role gated**: *"the invitee has no studio role yet — granting one
  is what this page does"* (`App.tsx:202-207`). It is also the one page not wrapped in
  `StudioLayout`, for the same reason (`StudioInviteRedeem.tsx:4-5`). A logged-out invitee
  is bounced to [[login]] and returned via `location.state.from`, so the token survives the
  detour.

  ⚠️ **Stale citation in the source.** That comment credits the decision to "ADR 0020", but
  [ADR 0020](../decisions/0020-no-fabricated-answers.md) is *"A surface with no data says so;
  it never invents one"* — a hollow-page honesty rule with nothing to say about role gating.
  The decision that actually made invites self-service and dropped the role requirement on
  redemption is [ADR 0021](../decisions/0021-studio-invites-are-self-service.md), whose
  effect [[studio-certify]]§14 describes: *"`redeem_invite` no longer requires a studio
  role — it binds the grant to the invited email instead"* (`studio-certify.md:208-210`).
  The code comment is off by one; not corrected here, since editing `App.tsx` is outside a
  docs pass.

## §3 Backend

**Found, and it is not where the page notes say it is.** Wine Studio has no dedicated
gateway module. It is served by a **proxy pair inside `apps/api-gateway/src/common/orchestrator/`**,
forwarding to a **FastAPI router in the Python orchestrator**.

*Gateway side* — `apps/api-gateway/src/common/orchestrator/`:

| Controller | Routes |
|---|---|
| `studio-proxy.controller.ts:41` — `@Controller("studio")` | 5 wildcard verbs: `@Get("*")` `:51`, `@Post("*")` `:61`, `@Patch("*")` `:72`, `@Put("*")` `:83`, `@Delete("*")` `:94` |
| `studio-invite.controller.ts:48` — `@Controller("studio")` | `@Post("invite")` `:60` — gateway-side because that is where the mail credentials live |

Verbs are enumerated rather than using `@All`, deliberately (`studio-proxy.controller.ts:47-50`),
and route order matters: the invite controller must be declared before the proxy's
`@Post("*")` on the same prefix (`studio-invite.controller.ts:13`).

*Orchestrator side* — `services/agent-orchestrator/api/studio_routes.py:59`,
`APIRouter(prefix="/api/v1/studio")`, mounted at `main.py:156`. **14 endpoints:**
`POST /sessions` `:73`, `GET /sessions/{id}` `:110`, `POST /overrides` `:171`,
`GET /queue` `:297`, `PATCH /queue/{id}` `:423`, `POST /invite` `:496`,
`POST /invite/redeem` `:533`, `GET /metrics` `:653`, `GET /me/roles` `:759`,
`GET /contributors` `:835`, `PATCH /contributors/{id}/revoke` `:865`,
`.../enable` `:893`, `.../disable` `:1113`, `POST /promote` `:920`.

Ingestion additionally calls `POST /api/v1/onboarding/extract` through a sibling proxy
(`onboarding-proxy.controller.ts`), reached from `CommandBar.tsx:77`.

**Why this shape** — [ADR 0021](../decisions/0021-studio-invites-are-self-service.md). The
client originally pointed straight at the orchestrator on `VITE_AGENT_ORCHESTRATOR_URL`
because the gateway genuinely had no studio module; the founder chose the gateway proxy
instead, for three stated reasons: it is what ADR 0012 already decided, it keeps one origin
and one auth boundary (no CORS, no orchestrator URL in the browser bundle), and the invite
send has to be gateway-side regardless (`pages/studio/studioApi.ts:1-24`).
`STUDIO_API_BASE` is therefore *deliberately* the empty string — *"a configurable origin
here is what allowed the browser to be pointed at the wrong service"* (`:33-38`).

**Auth crosses two runtimes.** The gateway's `JwtAuthGuard` validates the bearer token,
then the orchestrator re-verifies the same token and does the per-endpoint role check
(`services/override_service.py:34`). This requires the gateway's `JWT_SECRET` and the
orchestrator's `SUPABASE_JWT_SECRET` to hold the same value — verified equal in production,
both hashing to `641ddc1b5254` (`studioApi.ts:26-30`).

## §4 Automation

`none (every action is human-initiated)` — no agent, no `@Cron`. That is the point: this
software exists to put a human between machine extraction and the master library.

The Claude Vision and Gemini extractors it calls are model invocations inside the
onboarding path, not fleet agents.

## §5 Data

Verified from `.table("…")` in `api/studio_routes.py` and `services/override_service.py`:

| Table | Refs | Created in |
|---|---|---|
| `user_roles` | 13 | `…20260805000000_baseline_from_production.sql` |
| `override_events` | 8 | baseline |
| `master_wine_library_submissions` | 8 | baseline |
| `master_wine_library` | 4 | baseline |
| `invite_tokens` | 4 | baseline |
| `onboarding_sessions` | 2 | baseline |
| `field_review_queue` | 1 | baseline |
| `field_corrections` | 1 | baseline |
| `users` | 1 | baseline |

Owns `override_events`, `invite_tokens`, `field_review_queue` and `field_corrections`
outright. **Shares `master_wine_library_submissions` and `master_wine_library` with
[[wine-library-sommelier]]**, which writes the same submissions table from NestJS
(`wines.controller.ts:89,102,111`) — one table, two runtimes, no shared contract. That is
this software's sharpest seam, because `POST /promote` is precisely the moment a row
crosses from "someone's submission" to "what every restaurant sees".

## §6 Owner

`unowned — gap.` Add the row to [[SOFTWARE-MAP]]'s gap table.

Resolved rather than guessed, and three plausible-sounding candidates were checked and
**rejected on charter text**:

- **`exploration-studio`** — name collision only. It is a *design* team producing throwaway
  HTML sketches; its own non-goals hand production code to engineering: *"Sketches are
  throwaway HTML by design. Sketch 038 reaching `apps/web/src/pages/inventory/command/` is a
  handoff succeeding, not the studio shipping"* (`exploration-studio-charter.md:59`).
- **`standards-verification`** — the "certify" collision. It owns *"whether a document is
  still true"*, the 60-day anti-sprawl rule, and regeneration of `ENDPOINTS.md` /
  `PAGE_MAP.md` (`standards-verification-charter.md:19-24`). Studio certification is a
  *human contributor role*, not a document standard.
- **`annotation-ground-truth`** — the closest in spirit, and still not it. It owns
  *"human-verified truth: labelling operations, inter-annotator agreement, the gold sets"*
  (`annotation-ground-truth-charter.md:19-20`), but every asset it names is different
  tooling: `scripts/start_label_studio.sh`, `docker/label-studio/docker-compose.yml`,
  `datasets/annotation_tasks/`, `datasets/annotated/` (`:36-47`). Label Studio, not Wine
  Studio. The two are the same *idea* — machine pre-label, human verify — implemented
  twice, in two places, by nobody in common. That duplication is itself worth a decision.

Grepping all 79 team charters for `studio_routes`, `override_service`, `certified_contributor`
or `studio/queue` returns two mentions, neither an ownership claim:
[[release-engineering-charter]]:98 (*"Black debt on studio_routes.py may keep main red"* —
a CI concern) and [[surface-portfolio-charter]]:98,103, which lists `/studio`,
`/studio/certify` and `/studio/queue` among the **24 routes with no inbound in-app link**
and the **13 route components that could not be traced**. Surface Portfolio owns a verdict
per route, not the software.

**ADR 0049 §3a does not map these pages at all** (§7). The org has no owner and the
division layer has no row — the two gaps are the same gap seen from two directions.

## §7 Maturity & seams

**partial** — and this is a rollup that *disagrees with two of its four page notes*, on
evidence those notes could not have had.

The page notes stand at `broken` ([[studio]], [[studio-queue]]) and `partial`
([[studio-certify]], [[studio-invite-redeem]]). All three `broken`/degraded verdicts rest on
one shared claim: that every studio call is a bare relative fetch to a gateway with **no
studio controller** — *"grep `@Controller("studio"` across `apps/api-gateway/src`: zero
hits"* (`studio.md:141-143`; the same sentence in `studio-queue.md:83-86` and
`studio-certify.md:87-89`).

**That claim is now false.** On origin/main the grep returns **two** hits —
`studio-proxy.controller.ts:41` and `studio-invite.controller.ts:48` — landed
2026-08-26 in `cc10c228` (*"settle the routing fork"*, PR #73), while `studio.md` was last
touched the same day in an unrelated commit (`5a08f7a0`). Every call site now routes through
`studioApi.ts`: promote `WineRecordsTable.tsx:51`, override `FieldCell.tsx:73`, metrics
`metrics/MetricsDashboard.tsx:27`, queue `StudioApprovalQueue.tsx:15,19`, contributors
`StudioCertify.tsx:13,32,38`, invite `certify/InviteDialog.tsx:58`. [[studio-certify]]
already records the correction in its own §14 (*"The four 404s are gone… Maturity moves
**broken → working-with-one-known-gap**"*, `studio-certify.md:196-217`); [[studio]] and
[[studio-queue]] have not been updated and should be.

Not everything the notes found was routing, and the rest still stands:

1. **The URL crawler is hollow, independently of routing.** `CommandBar.tsx:122` toasts
   *"URL crawler started — records will appear as they are extracted"*, but `create_session`
   only inserts a row into `onboarding_sessions` (`studio_routes.py:66-99`) — it starts no
   crawl, and nothing on the page polls for records. The crawler has **no HTTP entry point
   at all**: `scan_routes.py`'s main router `/api/v1/scan` (`scan_routes.py:81`) is never
   mounted — `main.py:55` imports only `router_preview` from that module, and the mounted
   set at `:151-186` confirms it. Verified on origin/main, unchanged.
2. **Failure still reads as emptiness in two places.** [[studio-certify]]'s roster has no
   `isError` branch, so a failed load renders "No certified contributors" rather than an
   error — its §14 flags this as *"Still true… unchanged by ADR 0021"*. The metrics strip
   renders `?? 0` on undefined data (`MetricsDashboard.tsx:41,47,53,59`), so "Total
   Overrides 0 / Pending Queue 0" is what a dead endpoint looks like.
3. **The success path of invite redemption has never run live.** It is unit-covered only —
   `tests/test_studio_routes.py::TestRedeemInvite` plus `studio-proxy.controller.spec.ts` —
   and that branch contains the `refreshToken()` call the granted role depends on. *"The one
   thing that has never run live is also the one thing that is easy to get wrong. First real
   invite should be watched, not assumed"* (`studio-invite-redeem.md:122-128`).
4. **Stale comment, live belief.** `MetricsDashboard.tsx:24` still says *"Use relative URL —
   Vite proxy routes /api → FastAPI (port 8000)"*. It does not (`vite.config.ts:24-27` →
   the gateway on :4000). The comment is now accidentally harmless and still wrong.
5. **Two-runtime auth.** The JWT is validated twice against two env vars that must agree
   (§3). Nothing in CI proves they still do; today's evidence is a one-time production hash
   comparison.

`partial` rather than `live` because of (1) and (3): one of the three ingest paths does
nothing, and the entry point into the whole software has never completed against a real
user.

**Taxonomy finding — ADR 0049 §3a maps none of this.** Grepping
`.planning/04-specs/ECOSYSTEM-PLAN.md` for "studio" returns **zero hits**. The Sommelier
division row (`:57`) names `apps/api-gateway/src/wines`, `sommelier_agent.py`, the
`datasets/` corpora and pages `sommelier` / `wine-agent` — and stops. So four live routes,
four page dossiers, 14 orchestrator endpoints, two gateway controllers and eight tables sit
outside the division layer entirely. This is a different failure from the `wine-agent` error
recorded in [[wine-library-sommelier]] §7: that row names something that no longer exists,
this one omits something that does. Both need the same §3a amendment.

## §8 Where it's going

- ADR 0049 §3a needs a Sommelier-division row covering these four pages and the
  `common/orchestrator` studio proxy (§7). Until then this software is invisible to the
  ecosystem phasing — it is in no E-phase because it is in no division row.
- [[studio]] and [[studio-queue]] should carry a §14 update the way [[studio-certify]] does;
  their `broken` verdicts are superseded by `cc10c228` and currently mislead.
- The URL-crawler path is the one real build item: mount `scan_routes.py`'s router, or
  remove the affordance rather than keep toasting a crawl that never starts.
- The ownership gap (§6) and the Label-Studio / Wine-Studio duplication it exposes both want
  a founder call, not a default.
