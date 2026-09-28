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
| 15 | Who may notify whom | Close the five uncalled POST senders (internal only); `send-email` owner/manager, recipients limited to the house's members and its vendors' contacts; map every resolver site to a category (eleven measured 2026-09-17, not the seven first counted), an unmapped category is refused **[2026-09-25: the `send-email` half is superseded. The founder, round 4 item 14, took the recommended option: *"close the endpoint (merge #410; #422 drops HouseEmailService + its caller edits)"*. `POST /notifications/send-email` answers 403 and never sends (PR #410, ADR 0147); the house's own send is `POST /communications/letters`. The owner/manager + house-recipients constraint is not built anywhere. The five-senders and category-mapping halves stand (PR #422).]** | ADR 0147; OD-121 |
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
| 31 | What vendor sentiment is for | An operational vendor scorecard: what vendors do, measured from records (on time, short or refused lines, price agreement, reply latency, credits recovered), tone a minor input, a labelled evaluation and a shadow run before any alert | page note documents-reports.md (to carry) **[2026-09-21: sketch 117 picked — A, the ledger card in the vendor sheet and one fact on the card, with B's Roll Call as a second view of `/providers` and C's Docket as the rows behind each figure, not in the Sorting Office. Built read-only and with no alert as ADR 0207; the shadow run and the labelled set are its follow-ups.]** |
| 32 | Studio, after the Codex-conversation check (no Studio update exists; the pages date from April 2026) | Keep as an internal tool, outside the redesign and outside the deletion | ADR 0143 §5 |
| 33 | `/ask` launch | Codex's fifteen house readings after audit; standing questions later in their own record; the floating "Wine Agent" button removed, so `/ask` and the palette panel are the two doors | ADR 0145 |
| 34 | OD-121's two ambiguous senders | The weekly report is `financial_reports`; the recurring-order reminder is `order_approval` | OD-121 |
| 35 | `/login` and `/register` look | option chosen: "Flyleaf look on login too" — the paper-book look of sketch 104 direction C, same fields and flow; sketch 118 first. [2026-09-19: sketch 118 = **B, the endpaper**, the founder's answer, chosen over the README's recommended A. It is built as `EndpaperShell` on `/login` and `/register`.] [2026-09-19, about 05:00Z: the founder also put "Sign in with Google" on `/login`'s first page, under the address field as well as on the method step ("Also on the first page"). This deliberately changes "same fields and flow" for the house path. An unknown Google account is still refused by the gateway, and the OFF branch is unchanged.] [2026-09-19, the front-matter Easter egg (sketch 118 `front-matter.html`): the founder said "Book is great", asked for the dog-ear hint to be removed ("not intrigued by that") so nothing invites the click, and left the rest to the builder ("you decide rest"). The builder picked Direction 1, turning back to the front matter; the back cover is not built. It is on `/login` only, on the house path (`EndpaperShell` `frontMatter`, PR #398).] | ADR 0143 |
| 36 | Pages to give life now | option chosen: "16 locked pages" — Mudavym resolves for every house in code on dashboard, orders, receiving door, providers, communications, team, inventory, receipts, documents-reports, document, reports, calendar, profile, connections, notifications and logs; no database write; legacy code stays until the manifest is approved; settings, cellar, recommendations and the receiving desk wait for their sketch review **[2026-09-21, the cellar lane's merge: the cellar and its new `/menu` register join `LIVE_PAGES` (18 keys) on his 2026-09-19 blocking answer, recorded as "cellar = build the sketch-121 beside-the-list layout FIRST, then go live for every house" (`.planning/06-pages/wines.md`, Seventh pass, which built that layout); settings, recommendations and the receiving desk still wait. CLAIMS row ADR-0149-LIVE-PAGES-16 amended to match.]** **[2026-09-25, lane L4 of the web-rebuild finish (PR on `feat/live-shell-admin-authorize`): `shell`, `admin` and `authorize_integration` join `LIVE_PAGES` (23 keys; they move from `ACTIVE_FEATURE_FLAGS` to `LIVE_IN_CODE_FLAGS`; their three columns stay, unread) on the founder's 2026-09-22 page-gap answers, Q2 "I want all locked pages to be live (production)" and Q4 "turn on for every house the instant each PR merges — no staged single-house rollout" (memory `founder-answers-2026-09-22-page-gap`). Why code and not the rows: a 2026-09-25 production read found `shell` and `admin` ON for all 14 houses, but both columns default to false, so a house created after that read got the legacy shell and admin. Still flag-gated: recommendations, the receiving desk, and `arrival` (its `legacy` slot is ADR 0213's `/get-started` plan of record). CLAIMS rows ADR-0149-LIVE-PAGES-16 and SHELL-GATE-IS-OFF-BY-DEFAULT-AND-THREE-LAYERED amended to match.]** **[2026-09-25, lane W3-recs (PR on `feat/recs-round6-direction-b`): `recommendations` joins `LIVE_PAGES` (25 keys with `ask`, which joined on ADR 0145's 2026-09-25 amendment in #475; `mudavym_design_recommendations` moves from `ACTIVE_FEATURE_FLAGS` to `LIVE_IN_CODE_FLAGS`; its column stays, unread) — its sketch review is done: ADR 0160 §108's round-5 bracket (sketch 122 direction B, questions 2-10). Still flag-gated: the receiving desk and `arrival`. CLAIMS row ADR-0149-LIVE-PAGES-16 amended to match.]** **[2026-09-26/27: the receiving desk, promotions and vendor prices joined — row 54. `arrival` is the only page still flag-gated.]** | this record; ADR 0131, 0138 |
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
| 54 | The receiving desk, promotions and vendor prices go live in code (2026-09-26) | **[2026-09-26 — the founder, Round 8 item 53 (project memory `founder-answers-2026-09-25-web-rebuild.md`, verbatim: "Promotions and vendor-prices go live in code at cutover (flags-to-code PR, every house incl. new ones)"), option chosen: "Live in code at cutover (Recommended)"; rejected: "Promotions only", "Keep both dark".]** `promotions` and `vendor_prices` join `LIVE_PAGES` / `LIVE_IN_CODE_FLAGS` for every house, including houses created later, via this flags-to-code PR (#487), once #470 (senders home — ADR 0160 §113's answer), #474, #473 and #482 (provenance — PR #482's own body cites a 2026-09-25 founder round-5 answer, item 30, saying it "must land before `mudavym_design_vendor_prices` is turned on for any house"; not independently re-verified against a memory file in this session, so treat that attribution as PR #482's claim, not a re-checked one **[VERIFIED 2026-09-27: memory `founder-answers-2026-09-25-web-rebuild.md` item 30 reads "provenance = follow-on lane that must land before the flag goes live for any house"; ADR 0160 §112's 2026-09-26 bracket records the same]**) have merged **[2026-09-27: all four merged — `gh pr view` 470/473/474/482 → MERGED]**. This supersedes the 2026-09-19 lane answer that vendor-prices ship "behind a flag … he flips it; NOT live on merge" and #474's "dark until the founder turns it on". ~~**NOT DONE in this PR**: `promotions` and `vendor_prices` do not exist on `main` yet (only on #474 and #473/#482), so this half cannot compile until those merge — see this PR's body for the exact remaining steps.~~ **[DONE 2026-09-27, #487 phase 2 after merging `origin/main`: both keys are in `LIVE_PAGES` (28 keys) and `LIVE_IN_CODE_FLAGS` (28 keys), out of `ACTIVE_FEATURE_FLAGS`; the flip script's `PAGES` gains `vendor_prices` (PR #473 enrolled the page without a slug) and its `LIVE_IN_CODE` gains both; CLAIMS `PROMOTIONS-DARK-BEHIND-FLAG` amended in place, `ADR-0149-ROW-54-DESK-PROMOTIONS-VPRICES-LIVE-IN-CODE` extended to all three pages.]** The receiving desk (`receiving`) is NOT part of item 53: it joins on the same basis as row 36's 2026-09-25 bracket — page-gap Q2 "I want all locked pages to be live (production)" and Q4 "turn on for every house the instant each PR merges — no staged single-house rollout" — now that its sketch review closed (Q7 Approach 1, 2026-09-22; history from door receipts, 2026-09-25 answer 2). **Applied in this PR:** `receiving` is in `LIVE_PAGES` and `LIVE_IN_CODE_FLAGS`, out of `ACTIVE_FEATURE_FLAGS`. This PR must still not be MERGED before #436 and #480 (the Approach-1 desk build) land — merging this PR is what makes every house see whatever `ReceivingNext.tsx` currently is, and before #480 that is not yet the Approach-1 build the founder reviewed. **[2026-09-27, ADR 0090 audit of #487 at 222a27d39, BLOCK: that sentence was prose only. CLAIMS, the anchors guard and branch protection all passed with #436 and #480 open, and the PR Audit Gate ran NOT RUN [no-credit]. It is now enforced by CLAIMS `ADR-0149-ROW-54-DESK-LIVE-ONLY-ON-APPROACH-1` (resolved). That row requires `receiving` in `LIVE_PAGES` AND #480's line history (`RcLineHistory.tsx` rendered by `RcManagerQueue.tsx`, gateway `receiving-line-history.ts`) AND #436's receiving base plus a file only #436's head carries. It fails `Decision register matches reality`, a need of the required `CI Complete`, until both PRs are on `main` and `main` is merged into #487. It was mutation-tested against #480's and #436's heads: each marker removed fails, both present hold.]** Before: receiving ON for 1 of 14 houses (census J1), promotions and vendor prices OFF everywhere. No database write; the three columns (receiving's, 20260926160000, 20260926170000) stay, unread **[CORRECTED 2026-09-27: the promotions and vendor-prices columns were renumbered before merge — they are `20261015000000` and `20261022000000`; receiving's is `20260831090000`]**. Accepted knowingly: no per-house kill switch — rollback is a revert plus a redeploy (row 52's trade). After this row's receiving half, the flag-gated pages remaining are `recommendations` and `arrival` (ADR 0213's /get-started plan of record); after the promotions/vendor-prices half also lands, only `arrival` remains. **[2026-09-27: `recommendations` joined separately (row 36's W3-recs bracket, merged first), so with both halves applied `arrival` is the only flag-gated page and `mudavym_design_arrival` the only `mudavym_design_*` ACTIVE key.]** Legacy made unreachable (QA override only) for the deletion manifest's G1b: `ReceivingHome.tsx` (+ its test); `Promotions.tsx` and `VendorPriceCompare.tsx` **[2026-09-27: now, with phase 2]**. | this record, row 36; ADR 0160 §107/§112/§113 |

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
- **[2026-09-27, founder, round 9 item 56 / round 10 item 61 — the low-stock digest hour.** Chosen: "UTC, said on the page (Recommended)". Rejected: "New York time, said on the page", "No digest until a zone is set". Built on `fix/low-stock-digest-house-timezone`.]
  The hourly UTC-anchored sweep now picks each house whose OWN local clock has
  just crossed its configured digest hour (`low-stock-digest-clock.ts:
  isDigestTick`) [2026-09-27, founder item 70: superseded — `isDigestTick` is
  gone; a house is now DUE from its hour to local midnight (`isDigestDue`) and
  sent once per house date, see the item 70 bracket below], instead of gating everyone on one hard-coded New York hour
  (`low-stock-alerts.service.ts` previously ran `@Cron(..., {timeZone:
  "America/New_York"})` and compared against `currentEtHour()`).
  - **Zone order:** the house's own `restaurants.timezone` first
    (`digestClockFor`); then UTC, per ADR 0116:297-301's locked rule for a
    zone this server cannot read — the low-stock digest is now a THIRD
    consumer of that fallback, alongside the recommendation digest and the
    calendar reminders. The country step (#435's `common/house-frame.ts`:
    a country's zone only when it keeps exactly one) is NOT wired in yet —
    #435 was still open on `origin/main` when this lane built, so a house
    with no zone and a single-zone country (e.g. Turkey) still falls back to
    UTC rather than resolving to its country's zone, until a follow-up wires
    it in once #435 merges.
  - **The per-house-date gate on `last_digest_at` is now READ.** The column
    was write-only on `main` before this lane (`upsertState`'s `digestAt`,
    confirmed by grep — nothing selected it), so the digest's only protection
    against a double send was an inbox dedupe that never stopped the EMAIL
    (`notifications.service.ts:630-643` skips the inbox row but `sendDigest`
    still calls `emailDigest` regardless). `runDigestSweepAt` now reads the
    most recent `last_digest_at`, converts it to the house's own local date,
    and skips a restaurant already sent for that date.
  - **DST:** spring-forward sends at the first hourly tick after the gap (no
    day is skipped); the repeated hour on fall-back does not cross the
    target a second time, so there is no double send [2026-09-27, item 70:
    under catch-up the repeated hour is still due, and it is today's
    `last_digest_at` stamp that stops the second send]; half-hour and
    45-minute zones (India, Nepal, parts of Australia, Chatham) send at the
    next top of the UTC hour after their target, because the sweep stays
    hourly rather than becoming a 15-minute poll.
  - **`groupKey` now uses the house's own local date**
    (`low_stock_digest:<house date>`), not the UTC date, so the digest is not
    keyed on a date the house itself would not recognise as "today".
  - **/notifications copy:** not yet changed by this lane. #486 (the held
    low-stock queue, which owns `HeldCrossingsView.digest` and the
    "New York time" copy in `nt-held.ts`) was still open on `origin/main`
    when this lane built, so wiring the house's zone into that view is a
    follow-up named in this PR's body rather than done here; the new public
    `digestClockForRestaurant()` exists so that follow-up has something to
    call.
  - **Builder's choices, Proposed:** the `last_digest_at` read fails OPEN — an
    unreadable dedupe sends anyway, on the reasoning that `isDigestTick`
    alone already caps a single sweep run to one crossing per house-local
    date, so the exposure is a possible duplicate against another gateway
    replica or an overlapping deploy, not a silently lost reminder day
    [Overturned 2026-09-27 by founder item 70: "a failed dedupe read SKIPS
    (never double-send)". With catch-up the read is the only fence, so the
    house is skipped for that tick and the next tick reads again]; the
    fallback-zone warn (`LOW_STOCK_DIGEST_TIMEZONE_UNKNOWN`) logs only on the
    tick that actually fires, not on every sweep; a malformed `digest_time`
    is skipped with a warn (`LOW_STOCK_DIGEST_TIME_UNREADABLE`) rather than
    defaulting silently, which is new — the old `parseInt` returned `NaN` and
    the hour comparison simply never matched.
  - **[2026-09-27 correction, PR #488 audit at f2f196558] No catch-up — a
    missed crossing tick loses that house's day.** The fix at 59d5d36f4 was
    described (service comment, commit message, PR body) as "skip and retry
    on the next hourly tick". That was wrong: `isDigestTick` is true only on
    the one tick that crosses the house's hour, so a failed batched
    `restaurants` read on that tick, a cron run more than 30 minutes late
    (`hourTick` judges it as the next hour), or a gateway outage loses that
    house's digest for that local date, and no later tick sends it. The
    fail-open dedupe reasoning above ("not a silently lost reminder day")
    holds only for a failed `last_digest_at` read. Pinned as a known loss by
    specs i and j in `low-stock-digest-house-clock.spec.ts`; filed in
    v3.0-TECH-DEBT with the open CLAIMS row
    `TD-2026-09-27-LOW-STOCK-DIGEST-NO-CATCH-UP`. Whether to add catch-up is an
    open fork, not decided here. [Decided 2026-09-27, founder item 70: catch
    up. See the next bracket.] Same audit: `last_digest_at` is now stamped
    with the sweep's tick, not the run time, so a late run before house-local
    midnight and the on-time run for the same tick cannot both send (spec j2);
    the `LOW_STOCK_DIGEST_TIMEZONE_UNKNOWN` log no longer says "the page says
    so" (no /notifications copy states the zone yet); and the page-statement
    duty is attributed to founder item 61, not ADR 0116:297-301, which asks
    only for a log line.
  - **[2026-09-27, founder, item 70 — digest catch-up.** Chosen: "Catch up same
    day (Recommended)" (`founder-answers-2026-09-25-web-rebuild.md:104`). The other
    option, keeping the loss (v3.0-TECH-DEBT fork (b)), was not taken; its
    verbatim label is not in the memory record. Built on
    `fix/low-stock-digest-house-timezone` (PR #488).]
    - **Rule.** Send once the house's local time has reached today's digest
      hour (`isDigestDue`) and `last_digest_at` is not on today's house-local
      date (`digestAlreadySentOn`, which also treats a stamp on a later date
      as covering today; no real stamp can be). The first tick that is
      actually evaluated sends. A late, skipped or failed tick is made up by
      the next one that same local day.
    - **A failed dedupe read SKIPS the house for that tick**
      (`LOW_STOCK_DIGEST_DEDUPE_UNREADABLE`, "skipping this tick so it cannot
      send twice"). It is retried on the next tick, so one failed read delays
      the digest by an hour and does not lose the day.
    - **A failed preferences read SKIPS too** [2026-09-27, PR #488 audit at
      7b2ab8d3f]. The sweep read preferences through
      `getEffectiveLowStockPrefs`, which turns a failed read into the defaults
      (on, daily, 12:00). Under catch-up every tick from local noon is due, so
      a house set to 18:00, or with the digest off, was sent at the first
      failed tick after noon, and that stamp suppressed its real hour for the
      day. The sweep now uses the throwing `readLowStockPrefs` (#486; strict
      member read) and skips with `LOW_STOCK_DIGEST_PREFS_UNREADABLE` (spec o,
      three tests, each failing with the old call swapped back in). Not
      changed: `triggerDailyDigest` and the instant path keep the defaults,
      by #486's rule that a missed alert is worse than a default one. A house
      whose preferences fail on every due tick of a date loses that date.
    - **Builder's addition, Proposed.** There is an in-process fence,
      `digestSentOn` (restaurant → house date sent) [2026-09-27, PR #488 audit
      at f835811bc: now restaurant → the tick instant sent, re-read in the
      house's zone at each tick like `last_digest_at`; see the zone-change
      bullet below]. Under catch-up, a
      `last_digest_at` stamp that failed to write would otherwise re-send
      every hour until midnight. The fence covers this process; a restart or
      another replica has only `last_digest_at`. `sendDigest` now warns
      `LOW_STOCK_DIGEST_STAMP_UNWRITTEN` when no row was stamped. The fence is
      set before `sendDigest` runs, so a send that throws part-way is also not
      repeated by this process. As before, a failed email is recorded on the
      notification row and is not retried. [Superseded 2026-09-27, founder
      item 74: `digestSentOn` is gone; the durable `low_stock_digest_fence`
      does this for every process. See the item 74 bracket below.]
    - **Consequence, stated.** A house with no low wine at its hour but one
      going low later that day now gets that day's digest on the next tick.
      Before, it waited for the next day's hour. The founder's rule ("no
      digest today") covers this case literally; the audit and the founder
      should know it happens.
    - **Still lost ("same day").** A house whose every due tick that date went
      unevaluated still loses the day. For hour 23 that is only the 23:00
      tick. A run more than 30 minutes late at 23:00 is judged as the next
      date's 00:00 (`hourTick`).
    - **A house whose zone changes mid-day** [2026-09-27, PR #488 audit at
      f835811bc]. "Today" is the house-local date in the zone the house has at
      the tick, and both fences hold an instant re-read in that zone, so each
      date of the NEW zone gets at most one digest. Counted in the OLD zone, a
      change in either direction can give two digests on one date: UTC →
      Pacific/Kiritimati at hour 9 sends at 09:00Z and 19:00Z the same UTC
      day; Pacific/Kiritimati → UTC at hour 9 sends at 19:00Z on the 25th and
      09:00Z on the 26th, both on Kiritimati's 26th (spec n). Before this
      audit the in-process fence held a date string in the old zone, so the
      backward case skipped UTC's 26th in a process that had not restarted
      (spec n failed on f835811bc). Reachable once a house's zone can be
      edited (#435).
    - **Specs** in `low-stock-digest-house-clock.spec.ts`: i and j were
      rewritten from KNOWN LOSS to catch-up. New: k (failed dedupe read), l
      (gateway down across the hour, then a second restart the same day), m
      (unwritten stamp). The clock spec's full-year property test now drives
      the send rule, and a catch-up property drops every date's first due
      tick. Each part was mutation-checked (PR #488 body). Spec n (zone
      change mid-day, both directions) was added at the f835811bc audit.
  - **Merged with #486** [2026-09-27, PR #488 audit at 7b2ab8d3f]. #486
    landed first. Three things changed on the merge: (1) `sendDigest` takes
    #486's `rowsSnapshotAt` 4th and this PR's `{ periodKey, digestAt }` 5th;
    (2) the held-queue view reports the zone the sweep keeps
    (`digestClockForRestaurant`: `timezone` + `zone_source`; `digest: null`
    when that read fails) instead of the New York literal, and `nt-held.ts`
    says it, with item 61's "UTC — this house has no time zone set yet" for
    the fallback [2026-09-27, train-6 BLOCK: the line keyed on
    `zone_source === 'fallback' || timezone === 'UTC'`, so a house that
    deliberately set UTC was told it had no zone. It now keys on
    `zone_source` alone; that house reads "…, UTC time."]; (3) #486's rule that a digest writing no inbox row stamps
    nothing now also means no durable once-a-day fence for that date. See
    v3.0-TECH-DEBT "a digest that wrote no inbox row is not fenced", which
    also records the tick stamp running up to 29 minutes ahead of the
    held-queue read filter. [Both closed 2026-09-27 by founder item 74, next
    bracket.]
  - **[2026-09-27, founder, item 74 — the digest's own fence.** Chosen: "Own
    fence column (Recommended)" (`founder-answers-2026-09-25-web-rebuild.md:109`:
    a separate "digest sent on <house date>" record stamped whenever an email
    is attempted, independent of inbox/held rows; one additive migration). The
    other options in v3.0-TECH-DEBT's fork (stamp `last_digest_at` without
    clearing holds; accept the re-send on restart) were not taken; their
    verbatim labels are not in the memory record. Built on
    `fix/low-stock-digest-house-timezone` (PR #488).]
    - **Where.** Migration `20261021173000_a_low_stock_digest_is_fenced_once_a_house_day.sql`
      [renamed 2026-09-27, PR #488 merge-train, to `20261102110000_...`: origin/main
      had landed a newer migration (`20261022000000`) while this PR sat open, so
      `check_migration_order.py` required a version after it]:
      `low_stock_digest_fence`, one row per house (`sent_on date`,
      `attempted_at timestamptz`), RLS on, service_role only, backfilled from
      each house's newest `last_digest_at`. A one-row-per-house table, not a
      column on `restaurants`, because `restaurants` has a `BEFORE UPDATE`
      trigger on `updated_at`, which the gateway returns as the operating
      hours' `updatedAt`; a daily write there would say the house changed.
    - **Rule.** The sweep reads every house's fence once per tick. A house is
      already done today when `attempted_at`, read in its current zone, is on
      (or after) today's house date. Otherwise it claims the date
      compare-and-set BEFORE `sendDigest`: INSERT when no row was read (the
      primary key makes one of two inserts lose with 23505), else `UPDATE …
      WHERE attempted_at = <the raw value read>`. Only the claim holder sends.
      A failed read, or a failed claim write, SKIPS the house for that tick
      (item 70's "never double-send"), and the next tick retries. A lost claim
      skips too.
    - **Why the compare is on `attempted_at`, not `sent_on`.** `sent_on` is
      the date in the zone the house had at the attempt. After a westward zone
      change it can equal the new zone's next date (spec n, backward: both
      claims read 2026-09-26), and comparing it would lose that date.
      `attempted_at` re-read in the current zone keeps spec n's rule: each
      date of the new zone gets at most one digest.
    - **Held band.** `last_digest_at` is no longer the dedupe, so it is
      stamped with `snapshotAt` (when the rows were read), not the tick that
      can run 29 minutes ahead. A hold written in that window stays listed
      (spec q).
    - **Specs** p, q, r are new; e, k, l, m, n, j2 moved to the fence. Each
      new branch was mutation-checked (PR #488 body).
    - **Not covered.** The migration/deploy cutover (an old-code send after
      the backfill and before the new gateway starts is not in the fence);
      `triggerDailyDigest` (no production caller) neither reads nor claims it;
      a claimed date whose send fails is not retried that day, as before.
  - **CLAIMS:** `ADR-0149-LOW-STOCK-DIGEST-FOLLOWS-THE-HOUSE-CLOCK`,
    `ADR-0149-LOW-STOCK-DIGEST-PREFS-READ-SKIPS` (7b2ab8d3f audit),
    `ADR-0149-LOW-STOCK-DIGEST-DST-TESTED` [narrowed 2026-09-27, f835811bc
    audit: it named a "tick-crossing" guarantee item 70 removed, and its
    verify held with the full-year test deleted; it now pins both property
    tests by title and their per-date assertion],
    `TD-2026-09-27-LOW-STOCK-DIGEST-NO-CATCH-UP` (open) [resolved 2026-09-27,
    item 70], `TD-2026-09-27-LOW-STOCK-DIGEST-UNTOLD-NOT-FENCED` and
    `ADR-0149-LOW-STOCK-DIGEST-STAMPS-THE-READ-NOT-THE-TICK` [2026-09-27,
    item 74], `ITEM-61-UTC-LINE-ONLY-WHEN-NO-ZONE` [2026-09-27, train-6
    BLOCK: a house that set UTC itself is not told it has no zone]; item 61's page half: `ITEM-61-NOTIFICATIONS-SAYS-UTC-FALLBACK`
    (open, owed by #486) [resolved 2026-09-27 on the #486 merge, in the held
    band only] and `ITEM-61-NOTIFICATIONS-NEVER-SAYS-NEW-YORK-TIME`
    (v3.0-TECH-DEBT 2026-09-27).
  - **Source note:** the verbatim option labels above come from the
    orchestrator's relayed task text for this lane, not from a session this
    builder ran directly; the founder-answers memory (round 9 item 56, round
    10 item 61) holds a paraphrase without the option wording, so this
    bracket is the first place the exact labels are on record.
    [Corrected 2026-09-27, PR #488 audit at f2f196558: wrong as of that
    audit. `founder-answers-2026-09-25-web-rebuild.md:93` (item 61) holds the
    verbatim labels: "UTC, said on the page (Recommended)", rejected "New York
    time, said on the page" and "No digest until a zone is set". The memory
    file was probably updated after this bracket was written (commit
    fad5ad471), so the memory entry is the primary record and this bracket
    repeats it.]
  - **Cost accepted:** the real tenant, Meyhouse Palo Alto
    (`550e8400…`), has `restaurants.timezone = NULL` (cleared by migration
    `20260903170000`, per ADR 0207) and a `country` (`US`) that keeps many
    zones, so its digest moves from 09:00 PT (12:00 "New York" today) to
    05:00 PDT until the founder sets `America/Los_Angeles` for it in Settings
    after #435 merges — his keystroke, not this lane's.
  **[founder, 2026-09-26, round 8 — the held low-stock queue. Asked: "Three features exist only on legacy pages: editing a vendor's branch locations, the held low-stock queue on notifications, and team coverage-template delete plus hand-entered sales. Deleting legacy loses them. What do we do?" Chosen: "Build into new pages (Recommended)" — "Add each to its Mudavym page before the cutover PR. It costs one small lane, and nothing a house uses today disappears." Rejected: "Waive all three" ("Delete them with the legacy pages and file them in FUTURES. Faster cutover, but the features are gone until rebuilt.") and "Decide per feature" ("I ask about each one separately."). Built for the held queue on `feat/notifications-held-low-stock`: `/notifications` (NotificationsNext) now reads `GET /notifications/low-stock/held/:restaurantId` through `HeldBand` + `useHeldLowStock`, so `fetchHeldLowStock` gains a live caller and leaves the manifest's legacy-only method list (G3b) and endpoint list; the legacy strip had no actions to port, and the Mudavym band adds the reason in words, every wine listable, when (or whether) the digest will tell them, per-wine inventory links and the settings link. The gateway's hold lifecycle was corrected in the same PR (a failed instant write, the digest and recovery each left or created a false hold) — `.planning/06-pages/notifications.md` §13.41. CLAIMS rows ADR-0149-HELD-LOW-STOCK-QUEUE-ON-THE-MUDAVYM-PAGE and ADR-0149-HELD-QUEUE-A-HOLD-ENDS-ONLY-WHEN-TOLD.]**
- **Revisit when:** a cutover revert is needed in production, or a house asks for the
  old design (the signal that a per-house switch was load-bearing after all).

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-16 | Aldemir (founder), in session | Locked — goal plus six rounds of answers |
| 2026-09-17 | Aldemir (founder), in session | Rows 27-34 added — two further rounds; the motion sketch renumbered 105 to 116 (105 was the rejected login redraw) |
| 2026-09-17 | Aldemir (founder), in session | Rows 35-38 added — go-live of 16 locked pages, the public switch on, the flyleaf login, the sketch style |
| 2026-09-26 | Aldemir (founder, Round 8 item 53) + lane W8-flags | Row 54 added — receiving desk, promotions, vendor prices live in code |
| 2026-09-27 | lane W8-flags (#487 phase 2) | Row 54 completed — promotions and vendor prices applied after #470/#473/#474/#482 merged; the #482 provenance attribution verified against memory item 30 |
