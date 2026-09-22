# 0149 — Mudavym is the only design: finish every page, then delete legacy once

- **Status:** Locked 2026-09-16 — the founder's goal for the session and his answers to nine rounds of forks in session (his typed words in italics, chosen options named, below). The deletion itself is a gated stop inside this record: the deletion manifest goes to him file group by file group, and nothing is deleted without his word on that manifest. **[2026-09-19: row 6 revised by [[0169-the-ground-is-white-by-default-and-each-person-chooses]] — "declared paper surfaces only" is no longer the shape; paper is the default everywhere and a person chooses charcoal for themselves. Answered, not fully built for every page — see that record's measurement.]**
- **Date:** 2026-09-16
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** cutover, legacy deletion, dark launch superseded, mudavym_design flags, PageGate, useMudavymDesign, VITE_MUDAVYM_PUBLIC, deletion manifest, Codex adoption, theme toggle, SimPOS, Studio, app shell, finish
- **Links:** supersedes the per-house rollout of [[0131-the-new-house-goes-live-dark-then-one-house-at-a-time]] (its dark-merge half already happened) · [[0133-a-public-page-has-no-house-so-the-public-door-has-one-switch]] (the one public switch becomes permanent-on at cutover; [2026-09-17, row 37: turned on in code before cutover]) · [[0138-the-mudavym-ground-is-not-a-theme-and-the-rollout-starts-at-one-house]] · [[0143-the-arrival-the-desk-the-sommelier-and-the-two-rooms]] · [[0144-the-book-opens-on-evidence-and-three-pages-get-a-job]] · [[0145-mudavym-answers-out-of-a-reading]] · [[0147-the-pages-endpoints-answer-only-for-the-callers-house-and-person]] · [[0134-one-motion-per-act-across-every-page]] (Proposed, on branch `docs/motions-and-overlays-per-page`) · `.planning/handoff/PROGRESS.md` §5–6

## Context

On 2026-09-16 the founder set one goal for a session: *"complete every page there is
with every UI, UX page detected, planned, tracked ... and remove legacy pages and
actually full delete them. Commit oush deploy everyhting ... So finish the mudavim.com
and deploy it."* (verbatim, typos kept)

Measured at `origin/main` `60ed83a7` that day (census in the session scratchpad, outside the repo;
the numbers below were measured that day and are not yet CLAIMS rows):

- `apps/web/src/App.tsx` declares 61 route paths. Twenty pages render a Mudavym
  `next/` build behind a per-house `PageGate` (`useMudavymDesign.ts` reads a
  `restaurant_feature_flags` column, browser override first). Production holds one
  flag row (ALDEMIR, 11 of 20 columns true); thirteen houses have none, so they see
  legacy on every page (ADR 0138 §amendment; not re-measured in production by this
  record).
- About a dozen routes have no Mudavym build on `main`: `/vendor-prices`,
  `/promotions`, `/help`, `/admin` (+`/admin/health`), `/ask` (+`/sommelier`),
  `/get-started` (+`/onboarding`), `/authorize/:integrationId`,
  `/recommendations/catalog`, and seven public doors. Uncommitted Codex work covers
  several of them (rescued byte-for-byte to
  `/Users/aldemirkonuk/Projects/codex-rescue-2026-09-16/`, outside the repo).
- `VITE_MUDAVYM_PUBLIC` is unset in the production bundle (its `readEnv()` compiles to
  a bare return), so every public route renders the old design today.
- Deleting the legacy roots of the 17 deletable gated pages frees about 150 files
  (59,445 lines) plus 52 test/story files; `ReceiptsNext.tsx` still lazy-loads the
  legacy `ReceiptsPage` for `?tab=credits`, and four capabilities (distributor
  discovery, the operating-hours editor, the order email-thread actions, the credits
  tab) have no Mudavym home.

ADR 0131 locked a dark merge followed by a house-by-house rollout. Deleting legacy
removes the only thing a house could be rolled back to, so that half of 0131 cannot
stand beside this goal.

## Options considered

1. **Build every remaining page first, then one cutover** — no house loses a working
   surface at any point; the whole estate is swept on a sim house before the cutover
   merge; rollback is `git revert` plus redeploy. Slowest to the first deletion.
2. **Flip ALDEMIR to 20/20 first, cut over later** — a live soak for the founder while
   building; a production write per flip.
3. **Delete the built pages' legacy now, the rest as each lands** — fastest, but nine
   pages no house has ever had switched on go live for every house with no soak.
   [2026-09-17, row 36: the founder then chose to put sixteen locked pages live before
   cutover, six of them among those nine (reports, calendar, profile, connections,
   notifications, logs); the sweep in that change is their soak. The rest of Option 3
   stays rejected: legacy is still deleted only at the one approved cutover.]
4. *(Keep the dark launch)* — contradicts the goal; legacy never goes.

## Decision

**Option 1.** Every remaining page is built to the full-purpose bar first; then one
cutover merge deletes the legacy frontend, the gate machinery and legacy-only backend,
for every house at once — and only the file groups the founder approves on the
deletion manifest. His words: *"option1 with my approval what to delete and not, we
don't want to delete the wrong thing (the pages we will delete are the ones we carried
from restauran-ai-automation.com)"*.

What deletion means, in his words: *"delete code as frontend and legacy backend, not
the current restaurants or users, or tables, dbs or such"*. So:

- **Deleted (after manifest approval):** legacy page components carried from the
  WineOps / restaurant-ai-automation.com era that a Mudavym page replaces; `PageGate`,
  `useMudavymDesign` and their call sites; the gateway flag registry entries for the
  twenty `mudavym_design_*` keys and the settings UI that toggles them;
  `scripts/flip_mudavym_design_flags.py`; the public switch's off branch; endpoints
  whose only caller was a deleted legacy page.
- **Never deleted:** any table, column, row, house, user or migration. The twenty
  `mudavym_design_*` columns stay in `restaurant_feature_flags`, unread.

### Founder answers, 2026-09-16 and 2026-09-17 (in session; italics are his words, other cells paraphrase the option he chose; "Carried into" names the record that carries or will carry each answer, and "to carry" marks one not yet written there)

| # | Fork | Answer | Carried into |
|---|---|---|---|
| 1 | Codex's uncommitted page work | *"adopt it only if the quality baseline is great and align with our needs"* — each lane is audited, adversarially judged and confirmed before adoption | this record |
| 2 | Flags end-state | *"delete code as frontend and legacy backend, not the current restaurants or users, or tables, dbs or such"* | this record |
| 3 | When legacy is deleted | Build all, then one cutover, with his approval of the deletion manifest (quoted above) | this record |
| 4 | Studio and SimPOS | *"/studio was getting another update I'm not sure tho, check codex convos but imPOS keep-asis"* — SimPOS stays an internal tool outside the design and the deletion; Studio waits on the Codex-conversation check | this record; ADR 0143 §5 |
| 5 | App shell (sidebar, header, toasts, error, loader, offline banner, 404, floating agent button) | Rebuild as house chrome after a Fable 5.1 sketch and his review — *"only if it s not already done"* | this record |
| 6 | Light/dark toggle | Retired: charcoal everywhere, declared paper surfaces only. **[2026-09-19: reversed by [[0169-the-ground-is-white-by-default-and-each-person-chooses]] — the founder found all-charcoal not to his taste and asked for a per-person choice, default paper.]** | ADR 0138; ADR 0169 |
| 7 | Public doors built by Codex | Ratify its treatment: readable `/privacy`, vendor board at `/v/:slug`, sign in before resending verification, today's invite preview fields, publisher attribution with no Mudavym seal | ADR 0133, 0143 §1 |
| 8 | Contact address | `support@mudavym.com` everywhere (privacy, help, auth-email footers) | ADR 0143 |
| 9 | Fonts on public pages | Self-host every face; no Google Fonts request | ADR 0133 |
| 10 | `/admin` desk defaults | Keep: the five local-only knobs removed, other tabs linked out, owners-only health read | ADR 0143 §2 |
| 11 | Arrival threshold and `/onboarding` | The house-wide low-stock threshold is one line on folio 2; `/onboarding` redirects permanently to `/get-started`; *"+ improve the UI for tutorial action boxes"* | ADR 0143 §4, 0144 |
| 12 | ADR 0134 motion rules | option chosen: "Review motion first" — rendered as live specimens (sketch 116) before locking; 0134 stays Proposed until then | ADR 0134 (to carry when 0134 lands on main) |
| 13 | Proposed ADRs the page ADRs lean on | Lock 0124, 0126 and 0113 (0113 Q4 asked separately); 0054, 0108, 0117, 0128 stay Proposed; pages build only on built behaviour | ADRs 0113, 0124, 0126, 0144 |
| 14 | Consent panel (opened only from legacy `/settings`, no reader) | Delete it and say plainly on `/settings` that no analytics consent is collected yet | page note settings.md (to carry) |
| 15 | Who may notify whom | Close the five uncalled POST senders (internal only); `send-email` owner/manager, recipients limited to the house's members and its vendors' contacts; map every resolver site to a category (eleven measured 2026-09-17, not the seven first counted), an unmapped category is refused | ADR 0147; OD-121 |
| 16 | `/authorize` residue | The disclosure and every factual claim the page makes are served by the gateway and sealed; the connection keeps the seal id and words digest as a receipt; each return page reads the outcome | ADR 0144 |
| 17 | Vendor-intel public-register rows | A new nullable deciding-house column; the person's name and undo only inside that house | ADR 0124, 0147 |
| 18 | Ex-member OAuth disconnect | The creator of a grant may always end it, and the ADR 0118 mail sweep runs | ADR 0147, 0118 |
| 19 | `POST /communications/email` open relay | Two locked doors: the orchestrator through the internal service key; users by JWT, owner/manager, own house, recipients limited to its vendor contacts and members, an audit row per send | ADR 0147 |
| 20 | Report generation (OD-81) | Build a real export: CSV plus a print-ready page, stored, with an honest queued/ready/failed status | OD-81 (carried); page note reports.md (to carry) |
| 21 | Settings, Cellar, Recommendations "rework" verdicts | option chosen: "Sketch all three again" — 2-3 new directions each for his review | page notes settings.md, wines.md, recommendations.md (to carry) |
| 22 | Capabilities with no Mudavym home | Rebuild all four before cutover: discovery in `/providers`, hours in `/settings`, thread actions in `/orders`, a credits lane in `/receipts` | this record |
| 23 | Receiving verdict shape | Append-only records, plus a sketch of more structure for his review | page note receiving.md (to carry) |
| 24 | `/soft-drinks` | *"when there is no alcohols in a restaurants then it's already soft-drinks only, and some restaurants do not like non-alcoholic term"* — the adaptive name of the non-alcoholic register in an alcohol-free house, not a new classification | page note wines.md (to carry) |
| 25 | Conversation list on two pages | Only on `/communications`; and research whether the vendor sentiment analysis behind `/documents-reports` has deep, robust pipelines with promising results | page notes communications.md, documents-reports.md (to carry) |
| 26 | Recommendations digest | Build the sender | page note recommendations.md (to carry) **[carried; PR #391 audit B2, 2026-09-19: the five builder's choices this row's silence left open (a)-(e) are now the founder's own words, and (b) — the subscription alone gates the digest, `notification_preferences.categories.ai` is not a second gate — is built. See recommendations.md §9.]** |
| 27 | ADR 0113 Q4, the market-drop threshold | *"per house, everything will must deployed finished"* — an additive per-house value, today's deployment value as the default | ADR 0113 |
| 28 | Legacy hostname `restaurant-ai-automation-web.vercel.app` | Permanent redirect of every path to `https://mudavym.com`, after the OAuth redirect URIs are checked | ADR 0133 |
| 29 | Search engines and link previews | *"robots.txt must be unique, use already created teams to build upon geo, seo and the projectile it will go."* — built in its own session from the growth teams' plans | ADR 0133 |
| 30 | OD-112, `--ink-3` on paper | Captions on the paper ground use `--ink-4`; `--ink-3` is decorative only | ADR 0042 |
| 31 | What vendor sentiment is for | An operational vendor scorecard: what vendors do, measured from records (on time, short or refused lines, price agreement, reply latency, credits recovered), tone a minor input, a labelled evaluation and a shadow run before any alert | page note documents-reports.md (to carry) |
| 32 | Studio, after the Codex-conversation check (no Studio update exists; the pages date from April 2026) | Keep as an internal tool, outside the redesign and outside the deletion | ADR 0143 §5 |
| 33 | `/ask` launch | Codex's fifteen house readings after audit; standing questions later in their own record; the floating "Wine Agent" button removed, so `/ask` and the palette panel are the two doors | ADR 0145 |
| 34 | OD-121's two ambiguous senders | The weekly report is `financial_reports`; the recurring-order reminder is `order_approval` | OD-121 |
| 35 | `/login` and `/register` look | option chosen: "Flyleaf look on login too" — the paper-book look of sketch 104 direction C, same fields and flow; sketch 118 first. [2026-09-19: sketch 118 = **B, the endpaper**, the founder's answer, chosen over the README's recommended A. It is built as `EndpaperShell` on `/login` and `/register`.] [2026-09-19, about 05:00Z: the founder also put "Sign in with Google" on `/login`'s first page, under the address field as well as on the method step ("Also on the first page"). This deliberately changes "same fields and flow" for the house path. An unknown Google account is still refused by the gateway, and the OFF branch is unchanged.] [2026-09-19, the front-matter Easter egg (sketch 118 `front-matter.html`): the founder said "Book is great", asked for the dog-ear hint to be removed ("not intrigued by that") so nothing invites the click, and left the rest to the builder ("you decide rest"). The builder picked Direction 1, turning back to the front matter; the back cover is not built. It is on `/login` only, on the house path (`EndpaperShell` `frontMatter`, PR #398).] | ADR 0143 |
| 36 | Pages to give life now | option chosen: "16 locked pages" — Mudavym resolves for every house in code on dashboard, orders, receiving door, providers, communications, team, inventory, receipts, documents-reports, document, reports, calendar, profile, connections, notifications and logs; no database write; legacy code stays until the manifest is approved; settings, cellar, recommendations and the receiving desk wait for their sketch review | this record; ADR 0131, 0138 |
| 37 | Public doors switch | option chosen: "Yes, turn on now" — the public design switch is on in code once the doors pass their fixes | ADR 0133 |
| 38 | Sketch style | People-facing pages follow the Wave Four, The Arrival and Documents and Reports artifacts (simpler, easy to read); technical pages (the logs and admin designs he liked) may stay dense; Fable used minimally, Sonnet where it is capable | this record |
| 39 | Notification preferences scope (2026-09-18) | option chosen: "Per person per house" — upsert on (house, person) from the token; reads and the resolver filter by house; push subscriptions move out of the preferences table | ADR 0147, OD-121 |
| 40 | The six never-seen pages' soak (2026-09-18) | option chosen: "Isolated-page sweep counts" — each page mounted alone with its real hooks and every read failing is accepted as row 36's soak, because no local gateway can run; a real sim-house sweep is not required before the 16-pages merge | this record, row 36 |
| 41 | Orchestrator core/ growth from the admin desk (2026-09-18) | option chosen: "Accept as-is" — ADR 0039's no-extension clause does not bind this product lane; +231 lines, the hold-unacknowledged overflow and `stop_consuming()` land with the desk | ADR 0039, OD-03 |
| 42 | Receipt read-repair (2026-09-18) | option chosen: "Keep it" — the in-memory operation record (24 h, at most 500, lost on restart) behind `GET /health/agent-operations/{request_id}` stays | ADR 0143 |
| 43 | Who may pull back a queued mail (2026-09-18) | his words: "only author is the best option but I also belirve the pool inbox is a good idea" — cancel is the author's alone on both queues; a pooled inbox that owners share while keeping their own accounts is recorded as a direction, not built | ADR 0118 Q4 |
| 44 | Delivery decisions in an owner-only house (2026-09-18) | option chosen: "Owners get the queue too" — the delivery decision queue opens for owner and manager | receiving dossier §12 |
| 45 | The orchestrator's link origin (2026-09-18) | option chosen: "mudavym.com unless dev" — `frontend_url` defaults to https://mudavym.com; localhost only when ENVIRONMENT or DEBUG says development | ADR 0149 row 21 |
| 46 | Unsettled notification categories (2026-09-18) | option chosen: "Ratify, and add SMS to the default" — daily SMS summary and experiment-ended stay in financial_reports, the inventory-audit reminder in calendar_reminders, and financial_reports' default channels gain sms | OD-121 |
| 47 | /privacy legal facts (2026-09-18) | his words: "hold as is per now but will be dealt later after the web deployment finishes" — the page keeps its current text; the facts are a fork after the web deployment | OD-132 **[filed 2026-09-19, PR #391 audit M4: OPEN-DECISIONS.md, next free number across all refs and worktrees — the numbers 124 through 131 were already allocated to other lanes at filing time, so this one sits above them. Written without the `OD-` prefix on purpose: `check_od_ids_exist.py` reads every `OD-NNN` in the corpus as a citation owed a register row, and these are an allocation note, not citations.]** |
| 48 | ADR 0133's byte-identical off path (2026-09-18) | option chosen: "Waive it in 0133" — byte-identical ended with row 37; the off path is QA-only until the cutover deletes it | ADR 0133 |
| 49 | Invite unavailable copy (2026-09-18) | option chosen: "Say which" — the gateway preview returns used, expired or not found and the page names which | ADR 0143 |
| 50 | Self-registration naming a house (2026-09-18, measured, not asked) | closed rather than decided: no web or mobile surface called `POST /auth/register`, so it answers 410 and the writer is deleted (PR #392); joining an existing house is by invitation, opening one is `/auth/register/restaurant` | ADR 0147 addendum |
| 51 | The soak for the sixteen | option chosen: "Ship, then sweep production immediately" — merge the go-live, let Vercel deploy, then run the nightly production walk against all sixteen pages at once, with a revert ready. **This answers the fork PR #421's own `.planning/handoff/PROGRESS.md:159` reserved to him** ("ship them now with unit and DOM coverage only, or hold the merge until the 16-page sweep with screenshots has run?"), raised because the backend-driven sweep this record calls these pages' soak at :129-130 did not run — the local Docker/Supabase stack did not respond (`PROGRESS.md:71`). Rejected: *hold until the local sweep runs* (the environment had already failed once, and it would have gated the vendor-email link fix behind it); and *ship on unit and DOM coverage alone* (no added verification at all). The chosen path is not the weaker of the two originally offered — the nightly walks **production**, on real houses' data, which is a stronger soak than the local sweep would have been; ADR 0135 rebuilt that harness for exactly this. What is traded is a short window in which a defect is live for every house. Known and accepted when he chose it: the isolated-mount sweep proves the sixteen are honest when a read fails, not that they are correct when one succeeds, and about five had never been rendered by any production house | this record; ADR 0135 |
| 52 | /help renders for every house with no flag (2026-09-21) | option chosen: "Always-on, record it" — `/help` joins `LIVE_PAGES` as the **eighteenth** always-on page (row 36's sixteen + settings + help). Raised by PR #413's audit gate, which blocked the PR because an earlier draft introduced a separate `ALWAYS_ON_PAGES` while row 36 named only sixteen pages and this record listed "111 help" as a gated stop. The gate was right that no decision existed; this row is that decision. No `mudavym_design_help` ACTIVE registry entry, no migration. Listed in `LIVE_IN_CODE_FLAGS` only so the LIVE_PAGES ↔ registry guard stays exact. **Accepted knowingly:** all houses change `/help` the moment #413 merges, there is no per-house kill switch, and the only rollback is a revert plus a redeploy — the founder was shown that cost and the alternative (an ordinary per-restaurant flag) and chose this | this record row 36; ADR 0160 §111; PR #413 |
| 53 | Web banner when mail access is revoked (2026-09-22) | option chosen: **"Yes — persistent routine-tone banner on `/connections`, in addition to the already-decided phone push"** — closes ADR 0160 §111 Open item 5 / PAGE-GAP Q8. Phone push stays `MailGrantAbsentProducer`. Web surface is a durable banner on the broken feature's own page (`/connections`), shown only when `enable_house_inbox_read` is ON and `HouseInboxService.statusFor` reports `granted === false` (not when off, not when unknown). Tone is routine reconnect, not a security alarm. Research backing: `.planning/07-reference/deploy/HELP-ALERT-INDUSTRY-RESEARCH-2026-09-22.md` (recommendation only until this row). Rejected: *no web alert, phone-only* (the research default the founder had leaned toward, and the PAGE-GAP "Recommended" option) — he overruled it in the merge queue for PR #413 ("Founder wants a persistent routine-tone banner on /connections when mail access is revoked"). Still open and NOT decided here: distinguishing expired/self-revoked from for-cause revocation (research §"One open item") | ADR 0160 §111 Open item 5; PAGE-GAP Q8; PR #413 |

## Consequences

- **Easier:** one design to build, test and document; no flag state to reason about in
  a bug report; the public switch and twenty page gates disappear from every page.
- **Harder / given up:** there is no per-house rollback after cutover — rollback is a
  revert of the cutover merge plus a redeploy, which reaches every house at once. The
  cutover waits on the slowest page. Nine pages that no house has had switched on get
  their first real traffic at cutover, so the pre-cutover sweep on a sim house is the
  soak. [2026-09-17, row 36: overtaken for sixteen locked pages, which go live for every house before the cutover; the sim-house sweep in that change is their soak.]
- **Gated stops inside this record:** (a) every sketch the founder asked to review
  (116 motion, 107 receiving, 108 recommendations, 110 cellar, 112 vendor prices, 113 promotions, 115 arrival action boxes, and the shell
  if it is not already designed); (b) the deletion manifest, file group by file group.
- **Revisit when:** a cutover revert is needed in production, or a house asks for the
  old design (the signal that a per-house switch was load-bearing after all).

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-16 | Aldemir (founder), in session | Locked — goal plus six rounds of answers |
| 2026-09-17 | Aldemir (founder), in session | Rows 27-34 added — two further rounds; the motion sketch renumbered 105 to 116 (105 was the rejected login redraw) |
| 2026-09-17 | Aldemir (founder), in session | Rows 35-38 added — go-live of 16 locked pages, the public switch on, the flyleaf login, the sketch style |
