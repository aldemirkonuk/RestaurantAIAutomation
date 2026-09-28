---
type: review-evidence
status: historical-audit
updated: 2026-09-13
audited_commit: 60ed83a7e6d5eb8b8e0e631783a598cd0f562bff
links: ["[[MUDAVYM-TRANSITION-2026-09-13]]"]
---

> Dated audit evidence imported into the existing vault. Later implementation status lives in [[handoff/PROGRESS]]. Findings and counts describe their explicitly cited versions, not future work.

# Mudavym — documentation, design and handoff audit

Audit date: 2026-09-13. Prepared from the supplied repository, its registered Git worktrees, and the current GitHub handoff at commit `60ed83a7e6d5eb8b8e0e631783a598cd0f562bff`. This is a research record, not a deployment instruction.

The founder confirmed in the current conversation that the product/company spelling is **Mudavym**, with **mudavym.com canonical and www.mudavym.com redirecting to the apex**. This final host decision supersedes the earlier mention of www as the destination. The Turkish word *müdavim* supplies the story of the restaurant's regular; it is not an instruction to substitute a different domain.

## 1. Findings that change the handoff

The supplied directory is a real but older branch checkout: `feat/p1-readout` at `fb19885e80275f03c0817716671f05006823ede2`. Its documentation alone does not describe the current project. The critical continuation document was initially found in the registered `wt-handoff` worktree, then obtained from current GitHub main. The durable copy is [current-main-PROGRESS-2026-09-13.md](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/60ed83a7e6d5eb8b8e0e631783a598cd0f562bff/.planning/handoff/PROGRESS.md), sourced from [the immutable GitHub handoff](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/60ed83a7e6d5eb8b8e0e631783a598cd0f562bff/.planning/handoff/PROGRESS.md).

Even this newest handoff contains an already-stale sentence: line 20 says endpoint faults will follow in a separate PR. The current commit is that PR. [PR #373](https://github.com/aldemirkonuk/RestaurantAIAutomation/pull/373), “fix(endpoints): the pages' endpoints answer only for the caller's house and person (ADR 0147),” merged at **2026-09-13 16:53:55 UTC** into `60ed83a7`. GitHub metadata was checked directly, read-only.

The essential distinction is between **the founder's complete company ambition**, **the decided product/design contract**, **code that has merged**, and **capability verified in a running restaurant**. The corpus repeatedly collapses these categories and then records corrections. A new assistant must preserve the categories explicitly.

The latest continuation state is:

- Merge train #372 landed parity, go-live documentation, ledger guard, migration-probe safety, P4 work after #289, MCP server port, and handoff documentation. The broader endpoint repair landed next in #373.
- The current handoff still identifies #368 text-sender port, #362 security gate, and #349 nightly E2E as open; the parent audit independently checked the live PR list.
- Calendar push, overlay packets 0/1/2, and the proposed motion document remained stranded ports in that handoff. The remaining page builds did not start before the prior session ran out of credit.
- `GET /logs/timeline/:restaurantId` correlation access and missing Meta phone-number uniqueness are still explicitly named as unfixed in the latest handoff. The first was separately confirmed structurally by the code audit; the second is a branch/schema finding requiring reconciliation to the current database.
- A merged redesign does not establish that a restaurant sees it. The decided rollout is a dark merge followed by per-house switches. Account-level flags, production migrations, and runtime build identities must be read independently.

Sources: current-main handoff lines 15–36, 204–261; PR #373 metadata; [ADR 0131](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/7051b088a06816bc9041c42e2b9c10fdab5f07e5/.planning/decisions/0131-the-new-house-goes-live-dark-then-one-house-at-a-time.md#L62).

## 2. What Mudavym is trying to become

### Company mission

Mudavym is one company and one brand containing many individually understandable pieces of software. Restaurant operations is the flagship platform, with research, engineering, design, marketing, social/community, partnerships, and company operations inside the same entity. Floor Checker, Email Watcher, Order Watcher, Invoice Understanding, Vendor Finder, the guest app, and other capabilities each need a clear purpose and interface, then connect into the whole.

The founder explicitly considered separating a research company from the application company and reaffirmed one entity. Research retains its own long-horizon work and measurement; its independence is expressed in the organization and data architecture, rather than a second company. This matters: reducing the vision to a restaurant dashboard or a wine inventory tool would erase a major part of the intended company.

The product's north star is a full restaurant backend whose infrastructure makes ordinary operators and agents reliable: inventory truth, procurement, vendor communications, POS sell-through, receiving, reconciliation, and operational intelligence. The kitchen metaphor is practical: quality should come from repeatable systems, rather than dependence on exceptional individuals.

Sources: [PROJECT.md](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/fb19885e80275f03c0817716671f05006823ede2/.planning/PROJECT.md#L6); [ADR 0001](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/fb19885e80275f03c0817716671f05006823ede2/.planning/decisions/0001-mudavym-single-entity.md#L36).

### Expansion contract

The locked sequence is **wine → all beverages → bakery → the rest of the kitchen**. Wine is the initial vertical and the quality standard for extraction: producer, vintage, region, appellation, grape, alcohol, label/packaging images, provenance, and useful fine attributes. Beer, spirits, nonalcoholic drinks and recipes should reach comparable depth rather than becoming generic SKU rows.

Bakery is the first food proving ground: ingredients, intermediate dough/batter, finished goods, recipe yield, manual waste, pars, and eventual POS depletion and lot-cost rollups. Full kitchen expansion comes after that model earns trust. The intended master product catalogue has common identity and media, with type-specific attributes.

The guest experience is a second product surface under Mudavym: independent guest identities, preferences, ratings, sharing/recommendation, verified visits, and a points ledger. Its signal should improve restaurant decisions about stocking, promotion and service. Restaurant membership and guest identity may belong to the same person but remain separate and consent-linkable. The recorded initial reward posture is badges/status and optional restaurant-funded perks, rather than a platform cash-value promise. Guest activation remains an explicit product decision in the older roadmap, not an inference from an existing database table.

Sources: [FUTURES.md, expansion](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/fb19885e80275f03c0817716671f05006823ede2/.planning/FUTURES.md#L28); [extraction standard](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/fb19885e80275f03c0817716671f05006823ede2/.planning/FUTURES.md#L90); [guest contract](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/fb19885e80275f03c0817716671f05006823ede2/.planning/FUTURES.md#L146).

### AI-native and the research ambition

AI-native means that the product can understand context, propose structured work, carry out authorized actions through real services, and learn from measured outcomes. The recorded architecture is `ask → propose → confirm → execute`, with role-aware allowlists and an audit trail. Stock, money and vendor messages must not silently change because a model produced a plausible sentence. This is broader than a chat UI; the page system remains necessary for inspecting and doing the work.

The **Neural Footprint** is the project's own term for a durable trace linking stimulus, context, choice and outcome:

| Track | Intended subject and purpose | Evidence category |
|---|---|---|
| NF-A | Agent task/model/token/latency/cost/retry/outcome records; routing, quality evaluation and training signal | Instrumentation is reported shipped; current coverage must be measured from code/data |
| NF-B | Guest exposures, choices, repeat visits, preferences and context; taste and personalization | Product architecture/held activation, not a shipped guest app |
| NF-C | Biological/neuro response research | Explicitly gated research, requiring an entry trigger; not a launch participant |

ADR 0006 locks different production and research stores sharing an event vocabulary: narrow, low-latency production records, with wider append-only research records. The foundation document's older “emits nothing yet” state is contradicted by P1/P3 records and must not be carried forward.

Sources: [FUTURES.md, Ask AI](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/fb19885e80275f03c0817716671f05006823ede2/.planning/FUTURES.md#L203); [foundation stack and AI-native](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/fb19885e80275f03c0817716671f05006823ede2/.planning/foundation/README.md#L70); [ADR 0006](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/fb19885e80275f03c0817716671f05006823ede2/.planning/decisions/0006-neural-footprint-architecture.md#L51).

### The organization is an ambitious operating design

The organization map records seven internal divisions: Research & Math, Platform, Applied AI, Intelligence, Product, Commercial, and Corporate, with Architecture Review, Red Team and Decision Office as advisory functions. Departments span data, reliability, skills, analytics, security, guest experience, design, integrations, growth, finance, sales, media/brand, legal, privacy, documentation, people/agent operations, and fundraising.

This internal company map is different from the eight **product ecosystem** divisions: Restaurant, Customer, Vendor, POS, Sommelier, Intelligence/Analytics, Platform/Admin, and Agent Fleet/Runtime. A third layer, the software catalogue, groups user-facing capabilities; a fourth, page notes, describes what screens render. These are related maps, not competing totals.

The August 28 Home record deliberately says the organization is “designed, barely operating”: 485 declared loops but five live, 102 declared agent cards but eight executing scripts, and many provisional agendas. Those are dated measurements, not new counts and not employees. The supplied checkout contains 889 org Markdown files. Their size proves documentation effort, not deployed capability. The research and company ambition should be preserved without presenting a virtual org chart as a staffed organization.

Sources: [ORG-MAP.md](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/fb19885e80275f03c0817716671f05006823ede2/.planning/00-index/ORG-MAP.md#L11); [HOME.md](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/fb19885e80275f03c0817716671f05006823ede2/.planning/00-index/HOME.md#L36); [ECOSYSTEM-PLAN.md](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/fb19885e80275f03c0817716671f05006823ede2/.planning/04-specs/ECOSYSTEM-PLAN.md#L45).

## 3. Product map and operational story

The main operational loop is: connect/import a restaurant's POS and documents; identify what the restaurant sells and holds; record sales/depletion; detect stock or cost conditions; propose a procurement action; have a person approve; contact the vendor; receive at the door; reconcile order, delivery, count and invoice; resolve discrepancies and credits; put landed costs and outcomes back into the books and analytics.

A recurring theme in the corpus is that the two ends of that loop were stronger than the middle: inventory-lot accounting and receiving/reconciliation had substantial implementations while buy-side triggers, queues, autonomous drafts and cross-runtime sends had gaps. Old findings must be checked against main, since several were fixed on other branches while their prose remained. The loop is still the right unit of verification; a green page alone is insufficient evidence.

The supplied software catalogue contains 25 named softwares:

| Area | Named softwares and purpose |
|---|---|
| Restaurant operations | Dashboard Home; Inventory Command; Orders; Recurring Orders; Receiving; Receipts & Invoice Match; Calendar; Notifications |
| Vendor work | Communications Hub; Global Vendor Search; Promotions; Vendor Directory & Intel; Vendor Portal; Vendor Price Compare |
| POS | POS Bridge; SimPOS |
| Beverage knowledge | Wine Library & Sommelier; Wine Studio |
| Intelligence | Recommendations; Reports & Analytics |
| Platform and people | Auth & Onboarding; Settings & Integrations; Team Command; Admin & Health; App Shell & Support |

The catalogue labels most as partial; some hollow and two backend-only. Those September 1 labels are **historical findings**, not a current product score. The catalogue itself warns that page verdicts went stale in the same PR that fixed the code. It also names cross-module ownership gaps for six products and warns that an infrastructure-named orchestrator module contains otherwise-unowned product logic.

Later work adds the `/connections` house surface and a Mudavym MCP server, and decides a future `/ask` Reading surface. The current `60ed83a7` router still serves `/sommelier`; `/ask` and the redirect to it remain unbuilt. These belong to different implementation states and are not all present in the supplied checkout's older software map. The code audit supplies the current implementation matrix; runtime activation is a further check.

The expanded [surface capability matrix](mudavym-2026-09-13-surface-capability-matrix.md) covers **all 25 software domains and all 48 page dossiers in the supplied older checkout**. Current main has **26 software dossiers and 49 page dossiers**; the [current documentation delta](mudavym-2026-09-13-current-documentation-delta.md) supplies the new Connections/MCP domains and changed semantic features across current main. Neither appendix promotes a dossier maturity label into a production verdict. Current main has real per-order recurrence, sealed outgoing MCP calls and ten inbound read tools, despite older roadmap-only descriptions.

The page-note inventory measured **48 documents with `type: page`** in the supplied checkout; the folder has 56 Markdown files total. Historical prose says 46, 47, 48, 50 and 51 in different places. A route count, page-note count, product count, and design-flag count are different denominators and must never be substituted for one another. page-doc-index.csv (local audit evidence: page-doc-index.csv; not imported) retains the frontmatter, source path, and historical dossier excerpt for each of those 48 notes.

Sources: [SOFTWARE-MAP.md](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/fb19885e80275f03c0817716671f05006823ede2/.planning/08-softwares/SOFTWARE-MAP.md#L25); [catalogue staleness warning](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/fb19885e80275f03c0817716671f05006823ede2/.planning/08-softwares/SOFTWARE-MAP.md#L91); [ECOSYSTEM-PLAN.md, ten-hop spine](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/fb19885e80275f03c0817716671f05006823ede2/.planning/04-specs/ECOSYSTEM-PLAN.md#L14).

### The canonical document is a major product wedge

The earlier YC wedge plan emphasizes recovering value from real purchasing discrepancies. It distinguishes purchase order, vendor dispatch/packing slip, the restaurant's receipt, vendor invoice and credit memo; money requested is never counted as money recovered. The September founder decisions deepen this into a delivery that is agreed before verified, with separate evidence and judgments. A door count can make stock available while its cost stays provisional; verification settles the agreed cost.

ADR 0104 describes one conditional document presentation across invoice, credit memo, delivery note, receiving advice, statement, price list and portal export. Its information model separates immutable **EXTRACTED** evidence (including per-field source, original text and location), **RESOLVED** identities/units/mappings, and computed **ADJUDICATED** results. Original bytes are content-addressed; corrections append evidence rather than erasing the source; empty/blank/duplicate or unread extraction receives a named state. Later source additions describe seller tax-identity resolution and remembered vendor-to-shelf mappings. A human-readable canonical export with embedded structured data is a target in the ADR; this audit does not establish that all export formats work.

Sources: [YC wedge plan](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/fb19885e80275f03c0817716671f05006823ede2/.planning/YC_WEDGE_PLAN.md#L26); [ADR0103 delivery contract](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/fb19885e80275f03c0817716671f05006823ede2/.planning/decisions/0103-a-delivery-is-agreed-before-it-is-verified.md#L1); [ADR0104 data/presentation contract](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/fb19885e80275f03c0817716671f05006823ede2/.planning/decisions/0104-every-incoming-document-renders-as-one-canonical-mudavym-document.md#L64).

## 4. Design direction and founder decisions

### What is locked, what is inspiration

The governing feeling is hospitality and passion with technical superiority: warm, calm, detailed, and operationally credible. The founder reviewed by eliminating parts and combining favorites, rather than selecting one whole style board. The result is per-archetype composition.

The August 29 Makeover Verdicts explicitly records **preferences and inspiration**, not a blanket lock on every page. The palette is the one locked decision within that particular review. Later ADRs lock specific work, and the Wave Four gallery records further founder verdicts in its own store. A local sketch or a KEEP label is not, by itself, proof that every endpoint and behavior was approved or implemented.

The palette lock is İznik blue-teal: seal `#1A5E6B` on paper and `#5FB0BC` on dark; light paper `#FAF7F1`; Warm Charcoal `#15130F`; secondary papers `#F3EFE6` and `#EAE4D8`; dark inset grounds `#1D1813` and `#262019`. Both light and dark are first-class. The earlier burgundies are superseded brand directions. The `--info` hue was retired in favor of ink plus underline. Small light-ground text in the historical `--ink-3` requires attention: the register specifically records contrast failures; a palette lock is not proof of accessible use.

The mark is the trued A+M interlock under ADR 0047, superseding the Rivet M the founder withdrew. The wordmark is **Mudavym.**, including the seal-colored full stop. Fraunces carries the house voice; the broader UI still has legacy font and token layers, so styling should be inspected rather than assumed uniform.

Sources: [Design Foundation, review and current-state section](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/fb19885e80275f03c0817716671f05006823ede2/.planning/06-pages/DESIGN-FOUNDATION.md#L22); [Makeover Verdicts](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/fb19885e80275f03c0817716671f05006823ede2/.planning/06-pages/MAKEOVER-VERDICTS.md#L15); [ADR 0042](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/fb19885e80275f03c0817716671f05006823ede2/.planning/decisions/0042-iznik-seal-and-warm-charcoal.md#L22); [ADR 0047](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/fb19885e80275f03c0817716671f05006823ede2/.planning/decisions/0047-am-interlock-supersedes-rivet-m.md#L20); [OD-112](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/fb19885e80275f03c0817716671f05006823ede2/.planning/decisions/OPEN-DECISIONS.md#L67).

### Important page requirements carried forward

| Surface | Founder intent recovered from the record | Current interpretation |
|---|---|---|
| Dashboard | A TradeZella-like day calendar whose selected day exposes the actual work; warm greeting and an actionable waiting rail | Day-based operational evidence is central, not merely decorative KPI cards |
| Inventory | Preserve and deepen row expansion; receipt/invoice actions need detail | Avoid crowding; retain access to the evidence under a stock figure |
| Orders | Clear order-stage spine; suggested/drafted orders with context | Approving a consequential act and drafting it are distinct stages |
| Receiving/door | One-handed photo and delivered-box count; much stronger structure and matching | The door captures evidence; the desk resolves complex line detail |
| Receipts/documents | Correct document identity, rich backend integration, edit and confirm immediately | Later canonical-document ADRs turn delivery and provenance into explicit objects |
| Providers | Quiet, small vendor cards with richer detail on demand | Combine scanability with the vendor's learned relationship record |
| Communications | At-a-glance completeness, integrations and template clarity; avoid too much prose | Inspect send-state truth and tenant identity, not only the composer |
| Reports | More meaningful graphs, insight focus, rearrangement kept | Wave Four added graph/analysis switching; evidence behind a block matters more than motion |
| Notifications | Rework; preserve density and visually quiet already-handled work | The day rail and decision handling evolve through multiple review rounds |
| Cellar | Parent for wine, beer, whiskey and cocktails; adapt to what the house actually carries | Separate the approved information architecture from the rejected crowded page |
| Login/register | Improve today's pages; founder rejected the generic modern redraw | Now improved behind the public design switch, per latest handoff |
| Profile/connections | Richer linked accounts, payments and MCP access | Later ADR 0114 places house-owned connections on `/connections`, personal matters on `/profile` |
| Sommelier/assistant | Early HOLD; later a real general assistant with controlled actions | Latest ADRs supersede HOLD by specifying a future `/sommelier` redirect to `/ask`, reusing the actual Ask AI backend; the page and redirect remain unbuilt at `60ed83a7` |

Sources: [Makeover Verdicts, page review](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/fb19885e80275f03c0817716671f05006823ede2/.planning/06-pages/MAKEOVER-VERDICTS.md#L48); [Wave Four second pass](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/449342f0f4b0cc4617650f2a073691d958bbb044/.planning/decisions/0044-mudavym-implementation-kickoff.md#L186); [ADR 0114](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/449342f0f4b0cc4617650f2a073691d958bbb044/.planning/decisions/0114-connections-are-the-houses-profile-is-the-persons.md#L1).

### Wave Four

The artifact shown by the founder is exactly the Wave Four gallery named by ADR 0044: [Mudavym Wave Four](https://claude.ai/code/artifact/fb2f9455-8d35-411c-85c9-cfb0dbbf7abe). The initial seven surfaces were reports, notifications, recommendations, calendar, settings, profile, and cellar, each behind an off-by-default page flag. Founder verdicts are stored in the artifact, so only the browser/artifact record can establish the latest note on a card.

The September 3 second pass asks for real icons rather than emoji, one-tap actions in the dashboard rail, graph and analysis switching while arranging reports, binding recommendation dismissal, new full-picture comparisons for the weak pages, real payments and MCP behavior, and adaptive cellar registers. The third pass records MCP runtime probing, beverage catalogue depth, server-side reminders, and payment-provider integration as substantial builds. These are beyond the supplied branch's September 2 “ten pages” summary.

Source: [ADR 0044, P4 record](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/449342f0f4b0cc4617650f2a073691d958bbb044/.planning/decisions/0044-mudavym-implementation-kickoff.md#L146).

### Overlays and motion

The parent audit observed the current hosted Motion Canvas at **145 motions** and the Shortlist at **47** on September13. Older corpus totals of133/136 describe previous snapshots. See [artifact audit](mudavym-2026-09-13-artifact-design-audit.md) for the observed URLs and latest UI text.

ADR 0112 is locked: one primitive supports three purpose-led shapes. A right sheet is a record, a centered panel is a question, an anchored popover is its control's menu. The overlay adopts the page's paper/charcoal ground, focus handling and dismissal live centrally, and flag-off pages preserve their existing rendering. Width and focus rules are part of the contract, not details for each page to reinvent.

The later motion synthesis, ADR 0134, is **Proposed**. Its fourteen named forks include wax versus no ceremony, swipe distance, reduced-motion cross-fades versus no animation, dirty-form dismissal, keyboard-triggered motion, and width exceptions. The current handoff explicitly says to land this as Proposed. Do not silently turn its recommendations into founder decisions.

The existing seven named motion tokens in the go-live record are settle 320 ms, ink 160, tuck 300, turn 420, pour 620, stamp 360 and tally 840. Counts of motion demos vary by version (62, 85, 133, 136); they describe distinct revisions, not an accurate current count without an artifact census.

Sources: [ADR 0112](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/ad045405be11e9b57ee33edc0b084bbcef8e63b3/.planning/decisions/0112-one-modal-policy-three-shapes-one-primitive.md#L73); [ADR 0134 forks](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/3f962e3de4f07b3190b85dbaa0290d0154776f86/.planning/decisions/0134-one-motion-per-act-across-every-page.md#L201); [ADR 0131, tokens](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/7051b088a06816bc9041c42e2b9c10fdab5f07e5/.planning/decisions/0131-the-new-house-goes-live-dark-then-one-house-at-a-time.md#L35).

## 5. The latest decided page wave

ADRs 0143–0145 add specific choices that supersede several old open items:

- **Seven public doors share PublicShell:** forgot/reset password, verify email, invite, no-access, privacy, vendor public page. Home/wordmark links point to `/login` until a true public landing page exists. Login/register are improved in place.
- **One operations desk:** `/admin` absorbs `/admin/health`, with a redirect retained. Restart/stop affects the shared platform, so the founder chose operators only, requiring both a SQL-controlled platform flag and Studio's developer role. An ordinary restaurant owner is not a platform operator.
- **Arrival as a book:** the flyleaf opens `/get-started`; five folios carry their own states, not a completion percentage. Folio 0 is an optional last invoice; skipping is itself a recorded fact. Spoken/interpreted/inferred/imported proposals wait for one held seal; direct typing posts immediately. Currency already stated at registration should not be asked again.
- **Help:** searchable FAQ with the house's known connection/readiness/failure state, not a ticketing interface without a ticket service.
- **Vendor prices:** a price register with source, date, unit and trends; identity evidence is an attached drawer. Navigation from the cellar and documents needs to make the register discoverable.
- **Promotions:** compare an offer with what this house actually paid, and state absence when it has never purchased the item. Dismissal is house-wide. The historic example sentence does not settle the measurement window, role visibility or agreed-versus-landed cost policy.
- **Authorize:** a server challenge is redeemed once, bound to the integration, exact terms shown and retention, with the resulting provider URL bound to the sealing browser.
- **Auth emails:** rename verification, reset and invite surfaces to Mudavym; do not interpret this as an instruction to replace every legacy internal identifier.

The speech privacy requirement needs implementation verification: ADR 0143 says on-device speech recognition and structured rows only, but the statement that the browser's speech API guarantees no audio leaves the device is not established by the document. It must be treated as a requirement to prove, not a capability inferred from an API name. Unsupported local processing should be surfaced honestly.

Sources: [ADR 0143](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/449342f0f4b0cc4617650f2a073691d958bbb044/.planning/decisions/0143-the-arrival-the-desk-the-sommelier-and-the-two-rooms.md#L25); [operator and voice amendments](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/449342f0f4b0cc4617650f2a073691d958bbb044/.planning/decisions/0143-the-arrival-the-desk-the-sommelier-and-the-two-rooms.md#L203); [ADR 0144](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/449342f0f4b0cc4617650f2a073691d958bbb044/.planning/decisions/0144-the-book-opens-on-evidence-and-three-pages-get-a-job.md#L24); current-main handoff lines 204–261.

### The assistant is specified more deeply than a chatbot

ADR 0145 chooses a **Reading** as the answer unit. Figures and source outcomes must be minted by the query runner; a figure in prose binds to a real cell in that reading. A pretty source label authored by a builder is not sufficient provenance. Question classes must be enumerated, unbuilt classes identified, and a nonzero set of working readings tested before shipping. Query failure, absent house data, no matching reading, unbuilt capability, and a register not in service are distinct outcomes.

The founder's amendments answer the five original forks: Haiku selects, Sonnet 5 answers within a 60-second `/ask` budget; general model knowledge is allowed but explicitly marked as not from the house's books; `/ask` can reach every house behind its switch; `/sommelier` redirects to it; and the held seal belongs on the **order at approval** or the **letter at send**, not on an extra assistant-level ceremony. Confirming an assistant proposal creates a draft; it is not permission to send or purchase. Supporting readings should be rechecked at the consequential approval.

The same ADR names unbuilt reading infrastructure, provenance guards, persistence, catalogue contents, and other gaps. Latest handoff says this page build remains outstanding. The rate/spend-cap work in #366 is a prerequisite that landed, not proof that the full `/ask` design exists.

Source: [ADR 0145 decision and amendments](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/449342f0f4b0cc4617650f2a073691d958bbb044/.planning/decisions/0145-mudavym-answers-out-of-a-reading.md#L91); [founder answers](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/449342f0f4b0cc4617650f2a073691d958bbb044/.planning/decisions/0145-mudavym-answers-out-of-a-reading.md#L179).

## 6. Domain and deployment transition implications

This audit treats the domain migration equally with the design transition, but distinguishes them. Moving the browser origin is not a database migration, account migration, sender-identity migration, or redesign activation; each has independent state and failure modes.

The recorded web stack is a **Vite SPA with react-router-dom**, hosted on Vercel, with NestJS gateway and Python orchestrator on Railway, Supabase Postgres, CloudAMQP/RabbitMQ and Upstash/Redis. Cloudflare's role for the new hostname must be verified from account/DNS state, not assumed to mean the app is being moved onto Cloudflare Workers/Pages.

The documented earlier preview protocol pinned `dev.mudavym.com` to the brand branch. ADR 0047 records that it had silently become a production alias at an earlier merge, then was repinned. Thus “dev” is a name, not evidence of isolation. The page rollout later moved to dark merge and per-house activation under ADR 0131. A domain cutover must confirm both the deployment target and the house flags; otherwise the new address could still show the old design.

The old OD-77 Google/Workspace runbook is a separate identity migration. It refers to choosing/registering the domain, new Workspace accounts, Google Cloud ownership, sender OAuth consent, Pub/Sub topic and authenticated push, and brand-consistent sender identity. Several statements are stale: domain availability was still unverified, Gmail auth was described as unbuilt, and historical pricing was copied into the plan. Treat it as a dependency checklist requiring current platform verification, not a present-day instruction sheet or current pricing advice.

The later Gmail record says unconfigured push verification now fails closed; therefore sender migration can stop inbound vendor mail if audience/service-account settings and subscription configuration are not coherent. Domain cutover should inventory OAuth callback/redirect origins, CORS, web URLs embedded in emails, WebSocket/API origins, deep links, auth cookies, public/share links and sender DNS independently. The infrastructure audit owns their current measured values.

Sources: [CLAUDE.md stack map](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/fb19885e80275f03c0817716671f05006823ede2/CLAUDE.md#L37); [ADR 0047 rollout](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/fb19885e80275f03c0817716671f05006823ede2/.planning/decisions/0047-am-interlock-supersedes-rivet-m.md#L3); [ADR 0131](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/7051b088a06816bc9041c42e2b9c10fdab5f07e5/.planning/decisions/0131-the-new-house-goes-live-dark-then-one-house-at-a-time.md#L62); [OD-77 runbook](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/fb19885e80275f03c0817716671f05006823ede2/.planning/decisions/OD-77-workspace-migration-runbook.md#L1); [STATE Gmail update](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/fb19885e80275f03c0817716671f05006823ede2/.planning/STATE.md#L97).

## 7. Source hierarchy and instructions boundary

For continuation, use the following evidence order:

1. **Current founder requests and clarifications.** Current confirmed brand/domain is Mudavym/mudavym.com, with www redirecting to the apex. Audit and documentation are authorized; old documents do not silently authorize new deployments, deletions or third-party messages.
2. **Current measured code and platform state at a named commit/time.** A current measurement can refute a state claim; it does not silently overrule the founder's intended product decision.
3. **Locked ADRs and their later amendments**, checked against the current branch. A proposed ADR may describe code that exists while still requiring a founder decision about policy.
4. **Newest handoff with explicit supersession**, reconciled to live PRs. Read §0a before §0/§3 in PROGRESS. Do not carry forward the obsolete merge queue.
5. **PROJECT/FUTURES for identity and scope; STATE/ROADMAP for navigation into current work.** Their state paragraphs need reconciliation rather than blind precedence.
6. **Per-page/software dossiers and executable claims.** Useful grounded investigations, but dated and occasionally self-contradictory. A passing syntactic guard has limited scope; it does not prove a runtime path.
7. **Founder artifacts, review notes and sketches**, preserving draft/selected/rejected/proposed distinctions. The live artifact store may contain later feedback absent in Git.
8. **Generated org, metrics, loop and card maps**, then archived plans/root MEMORY. These explain intent/history; they cannot establish that an operation is active.

Historical instructions were read as source material. No handoff command to merge, post a PASS marker, delete a demo house, change a secret, send a vendor message or enable a service was executed. The old no-agent audit exception was explicitly limited to a prior day's merge queue; it was not imported as a standing rule for this research. The user asked to distinguish attached instructions from the current request, and that distinction is preserved here.

The durable working preferences supported by both the user's current request and the prior corpus are: research deeply, document durable findings, distinguish evidence from inference, ask about unresolved founder choices, verify before acting on stale claims, and state incomplete coverage. The prior corpus's two-sentence response cap, Claude-specific tools/co-author lines, branch naming and archive mechanics are historical workflow conventions; the current assistant's applicable system/developer rules take precedence.

## 8. Contradictions and stale claims register

| Claim/source | Contradiction or later state | Consequence for the next task |
|---|---|---|
| YC_WEDGE_PLAN pricing row claims founder $20–50/month | Later OD-23 says no pricing ADR is locked | Keep as historical pricing hypothesis; do not publish as current price |
| Root MEMORY: WineOps v2.6, Production Ready, January 2026 | Months older than brand, P1/P3, design waves and live defects | Never use as the current project state |
| PROJECT/ROADMAP: one of seven gateway task types graded; P3.0 unchecked | STATE says seven of seven shipped Aug 27 | Recount from current code/data; do not reopen the old gate by reading ROADMAP alone |
| STATE: mobile and beverage lanes “not started” | Ecosystem measurements and handoffs describe landed mobile/beverage work | Current code/simulator audit decides maturity; copied status is not enough |
| STATE footer says Aug 27 | Body contains Sep 2–4 amendments and a malformed canonical-document insertion | Date footers are unreliable freshness indicators |
| DESIGN-FOUNDATION title: “plan only, no build” | Frontmatter and §0b say implementation underway | Read the amendment, not just the heading |
| MAKEOVER-VERDICTS says nothing built, sommelier HOLD, calendar-classic still open | Later page builds and ADR 0145; retired page redirects documented elsewhere | Historical preference record, not current freeze list |
| Supplied `feat/p1-readout` checkout lacks 0112/0131/0134/0143–0145 and sketch 102/104 | References exist; registered P4/new-pages worktrees contain them; several now merged | Resolve source checkout before reporting a missing capability/document |
| ADR 0136 says no PR yet and future full tests needed | Same ADR later records PR353 audits and waiver; parent verified merged Sep12 | Treat initial pending section as superseded |
| Latest PROGRESS line20 says endpoint repair forthcoming | PR373 is already merged at the commit containing that sentence | Remove it from pending work; retain remaining targeted security findings |
| Software/page verdicts say hollow/broken | SOFTWARE-MAP documents fixes in same earlier PR without dossier updates | Re-verify each alleged bug before prioritizing it |
| Page/agent/loop counts vary | Different revisions and denominators; generated/planned versus runtime counts differ | Every metric needs object, scope, commit/date and measurement method |
| Motion census counts vary; ADR0112 table and prose differ | Different review rounds and reclassification | Count the current census.json and artifact store before batch work |
| Browser speech means “nothing leaves device” | The document does not prove local processing implementation/support | Privacy promise needs a dedicated capability check |
| Source comment says schema/client/guard verified | Repeated phantom tables, false 200-empty, untyped client, syntactic guard blind spots recorded | Prove the real operation and its failure behavior |
| “Deploy to Production” workflow name | Prior register says it audits auto-deployments rather than initiating them | Inspect workflow and platform state, not the job title |

Sources: root [MEMORY.md](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/fb19885e80275f03c0817716671f05006823ede2/MEMORY.md#L5); [ROADMAP.md](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/fb19885e80275f03c0817716671f05006823ede2/.planning/ROADMAP.md#L30); [STATE.md](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/fb19885e80275f03c0817716671f05006823ede2/.planning/STATE.md#L112); [ADR 0136](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/fb19885e80275f03c0817716671f05006823ede2/.planning/decisions/0136-session-2026-09-11-p1-readout-and-brand-sync-push.md#L8); current-main handoff; cited design/software records above.

## 9. Recommended continuation, within the research scope

1. Preserve the source/commit manifest and current founder answers. Treat current main as the code baseline; inspect each stranded worktree before planning a port. Never replace dirty branch work without understanding it.
2. Reconcile the three open PRs and five ports to their actual checks and diffs. The text-sender's five CLAIMS reportedly pass locally but fail CI; that is a test-environment/claim reliability problem requiring inspection, not permission to waive it.
3. Verify and prioritize tenant isolation. The `/logs/timeline/:restaurantId` correlation path merits correction before broader exposure. Meta routing uniqueness and the product policy for who may notify whom need explicit closure. PR373's broad endpoint hardening does not establish that every named issue disappeared.
4. Build the decided page work against current ADRs and real endpoint contracts. Separate already-answered design choices from remaining forks: help state/contact policy, promotions tabs/measurement window/roles, public privacy/vendor-page treatment, catalogue actionability, vendor-price scopes/currency/log access, threshold placement, and tenantless OAuth disconnection.
5. Complete the domain-readiness audit and house-by-house review together. Prove the new origin, the served commit, flags, auth/redirects, server behavior and migrated email identity. Document a rollback for each type of change independently.
6. Validate a full restaurant loop with identified real-versus-simulated data, observable failure states and human gates. A synthetic venue built from a real menu is valuable test evidence but not a real merchant's live POS feed.
7. Keep long-term vision alive as a separate roadmap: deeper beverages, bakery/kitchen, mobile parity, guest/NF-B, Floor Checker, research/NF-C, and the full AI-native operating company. Do not label these shipped merely because charters, routes, or migrations exist.

No code change, merge, deployment, data deletion, account modification or message send was performed by this documentation subtask.

## 10. Coverage and durable inventory

[documentation-inventory.csv](mudavym-2026-09-13-documentation-inventory.csv) records the supplied checkout's **1,541 documentation artifacts**, totaling **31,419,946 bytes**: **1,424 Markdown, 116 HTML, and one DOCX**. It excludes dependencies, Git internals, repeated worktree/snapshot copies, dataset PDFs/DOCX, and unrelated HTML. This is a documentation inventory, not an inventory of every data asset or source-code file.

The report is based on detailed reading of the live spine, major founder/brand records, full latest handoff, selected newer ADRs, every software dossier's product/maturity/future narrative and every page dossier's purpose/features/gaps/design/roadmap, including later receiving and Studio amendments. The CSV distinguishes `read_full`, `read_targeted` and `inventoried_only`; machine-extracted titles/headings do not count as semantic review. Most of the 889 repeated organization-unit records were inventoried rather than individually read. The page index CSV is machine-generated; the separate 73-row surface matrix is human-written semantic review. The long endpoint/schema/producer tables were selectively read, not all read word for word; none of this is a claim that all 48 historical dossiers were individually re-audited against current code.

The historical source repository and registered worktrees were read-only. Current GitHub PROGRESS was saved as a dated evidence copy, not edited in the source. Secrets, `.env` values and credentials were not opened or included. Browser-rendered artifact inspection and current runtime/platform verification are separate parent audit workstreams, and their results should be linked into the final synthesis.

The attached evidence files are a recoverable knowledge base, not a claim of permanent model memory or total exhaustive understanding. Future work should add dated corrections and point to changed source evidence rather than duplicate a new unbounded account of the entire project.


## Final current-main reconciliation

The [current documentation delta](mudavym-2026-09-13-current-documentation-delta.md) is the final semantic supplement for 60ed83a7. It reads current feature narratives and records 38 changed files containing 18,088 added lines across the page/software catalogue. The [current manifest](mudavym-2026-09-13-current-documentation-manifest.csv) fingerprints all 85 current directory documents and separates full/targeted/diff/unchanged/inventory-only reading. The newer source retains historical prose even after changes; for example PAGES-MAP says 47, SOFTWARE-MAP says MCP planned, and a page may retain an old absence alongside a later build.

Current code verification also supersedes reassuring dossier language: the door-to-desk receipt path can reinterpret bottles as cases and derive a −660 adjustment for 5 cases of 12; native price submissions omit the required currency; the correlation Logs read remains tenant-incomplete. Conversely, staff certification-file reads are now restricted to their own member, so the old disclosure finding is closed in current code. Live platform evidence confirms 184 migrations and 11 of 20 design flags true in one inspected settings row, while PUBLIC SECURITY DEFINER trust-counter function exposure remains a current infrastructure finding. These current results must accompany any older maturity or default-off statements in this report.
