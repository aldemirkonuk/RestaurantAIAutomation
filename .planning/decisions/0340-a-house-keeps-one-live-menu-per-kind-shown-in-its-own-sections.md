# 0340 — A house keeps one live menu per kind, shown in its own sections

> **Number.** 0340 was the next free number on 2026-10-12 (lane 0): every local and remote
> ref, the diff of every open PR (`gh pr list`, 100 open), the main checkout and every
> `sim-run/wt-*` and `sim-run/fix-wt/*` worktree were swept, and none holds an ADR at 0340
> or above (highest 0339). `check_adr_numbers_unique` re-checks it at merge. Migrations are
> cited by slug and numbered at merge
> ([[0235-a-migration-is-numbered-at-merge-and-cited-by-its-slug]]).
>
> **Not built at this commit.** This record and its amendment brackets are the decision
> only. At its base, `24ee6705f`, the code is as **Context** describes; each rule below lands
> with its lane (`p4-scratch/sim-run/arch/menus-lanes.md`, lanes 1-8). The five
> `status: open` rows in `claims.d/docs-menus-kinds-adr.jsonl` fail the build if their rule
> holds before the row is edited to `resolved`, so this record cannot silently go stale in
> either direction. Gate G0 (the production read), lane 8 (the evaluation, which spends model
> money) and every flag flip wait for the founder's word.

- **Status:** Proposed → **Accepted by the founder, S208** (sim ledger, 2026-10-11 ~22:30Z, filed 2026-10-12). His words: *"think SOTA and take it up a notch while taking covering up every possible need in general to fulfill customer needs ... -> yes build it"*. He approved the coordinator's kinds/sections proposal, which is `sim-run/arch/menus-plan.md` plus S208 items 1-5. **Not built** (see the note above).
  - **Amends LOCKED [[0193]], round-2 decision item 7 "Menu versions" (`0193:261`)** and the round-2 technical choice "no unique index on one active menu per house" (`0193:284-286`). Not decision item 7 "target margin" (`0193:132`), which is untouched. It also **adds to 0193 L13** (`0193:357`): two groups (Conflicts, Unsure) above L13's price list, whose order and Keep switches are kept.
  - **Amends LOCKED [[0186]]**: a section layer and a menu kind on top of the closed drink vocabulary; `category` stays the vocabulary contract.
  - **Applies LOCKED [[0333]] without amending it**: only a vocabulary token ever reaches `menu_category`, never heading text, and the owner's confirmed category is written as a **declared** kind (0333 item 3).
  - **Preserves LOCKED [[0130]]** (a house's generic name stays its own wine): the new guard changes *whether* a line is resolved, never *how*.
  - **Rebases [[0293]] decision 2** (Proposed).
  - The forks in §F are the coordinator's calls under the founder's 2026-10-07 delegation; each is open to his veto and none is recorded as his word. The two forks that are genuinely his are listed in "Founder forks" at the end.
- **Date:** 2026-10-12
- **Decider:** Aldemir (founder) for S208 items 1-5 and the S198/S202/S203 sources. The coordinator, under delegation, for the shapes in §F.
- **Keywords:** menus, menu kind, menu_type, Drinks, Food, Desserts, one active per kind, restaurant_menus_one_active_per_kind, make_menu_current, make_menus_current, carried_at, menu_sections, section key, section_id, line_kind, drink_category, effective drink category, dish price, Full menu, mixed file, read_together_id, part_read, unsure, kindOf, gone, keep, price conflict, owner picks, F-696, S198, S202, S203, S208
- **Links:** [[0193-a-house-price-follows-its-menu-and-its-manager-and-advice-aims-at-its-own-margin]] (round-2 item 7 amended; L11, L13, item 3 and the S202 note kept); [[0186-a-menu-upload-classifies-every-drink-not-only-the-wine]] (amended); [[0333-a-drink-is-filed-by-its-kind-not-as-a-wine]] (applied: tokens only, declared kind); [[0130-a-generic-name-stays-the-venues-own-wine]] (preserved); [[0293-the-off-library-tile-names-the-wine-library-and-a-draft-menu-is-not-current]] (decision 2 rebased); [[0331-a-till-sale-takes-its-recipe-off-stock]] (OD-113 decided: food depletion by recipe); [[0336-a-drink-can-be-86d-and-the-stock-out-is-kept]] (86 marks, drinks with a house item only); [[0147-the-pages-endpoints-answer-only-for-the-callers-house-and-person]] (every new route: house from the JWT, foreign id 404); [[0067-a-failed-read-is-never-an-empty-one]] (every new reader binds its error); [[0112-one-modal-policy-three-shapes-one-primitive]] ("Move to…" sheet, kind pick); [[0113-the-assistant-proposes-the-seal-applies]] and [[0145-mudavym-answers-out-of-a-reading]] (the AI proposes, rules check, a person applies); [[0160-the-founders-sketch-review-what-he-valued-and-what-each-page-becomes]] (§110 `/menu` layout, sketch 121); [[0158]] (public-surface headers, phase 2); [[0235-a-migration-is-numbered-at-merge-and-cited-by-its-slug]]; `p4-scratch/sim-ledger.md` S198, S202, S203, S208; `p4-scratch/sim-run/arch/menus-plan.md`; `p4-scratch/sim-run/arch/menus-lanes.md` (build order). Code basis: integ tip `24ee6705f` (`wt-sim49`), read only.

## Context

**What the founder asked for.** On F-696 he asked for a full menu view in sections the
house can format: drinks, food, desserts, soft drinks, and wines split into
white/red/champagne/dessert. He wants at least Drinks, Food and Desserts (S198). Two live
prices for one item go to the owner, who picks one (S198). Making a menu current is its
own dated price change, the house holds the **list** price, and "never two prices in
silence" (S202). Timed promos come later, as derived items (S203). S208 approved:

1. **Kinds** are what can be live at once.
2. **Sections** are the house's own nested, renamable, draggable headings, with a Full menu view.
3. **AI suggests** sections and kinds; guardrails apply, and the owner taps.
4. **A mixed file is split by section.** No kind is picked before upload.
5. **Each section maps to a fixed drink category.**

**What the code does at `24ee6705f`.**

- **One live menu per house, held by a function only.**
  - `make_menu_current` archives every other active menu of the house, whatever its type
    (`20270103500000_an_empty_menu_is_never_made_current.sql:73-82`); its `already_current`
    short-circuit is house-wide (`:52-58`).
  - No index enforces even that (`0193:284-286`, `20260922230700:68-73`).
  - The `status` column default is `'active'` (baseline `:5135`). The baseline seed RPC
    and `scripts/synth/seed.py` do **not** rely on it: both write `status` explicitly,
    defaulting to `'active'` in their own code (`20260805000000:1560-1566`,
    `seed.py:631-640`).
  - A retry after a crash mid-carry answers `already_current` with zero lines carried
    (`makeCurrent`, `menus.service.ts:2177`, returns at `:2266`): the carry can never be
    finished.
- **Every upload is filed as Drinks.** `createVersion` hard-codes `menu_type: "beverage"`
  (`menus.service.ts:835`); its second caller `importParsedItems` (`:755`) serves arrival's
  manual line (`arrival.service.ts:379`). The CHECK allows `beverage|food|full|bar|events`
  (baseline `:5138`). The part-read mark lives in the menu **name**
  (`PART_READ_PREFIX`, `menus.service.ts:56-62`, read at `:1918, :2225, :2348`).
- **Three readers break when two menus are live.** `getMenu` (`:1427-1432`) and
  `getDiscardedLines` (`:1175-1180`) use `.eq("status","active").maybeSingle()` and 500.
  Onboarding (`:3089-3094`) ignores the error and reads "no menu" (absence as health; its
  row is in `scripts/read_error_baseline.json:57`). The plan's "being replaced"
  (`:2000-2013`), "retiring" (`:2107-2127`), `returned` (`:2079`, from `onReplaced` `:1998`)
  and `dormantLocks` (`:2087`, from `onThisMenu` `:2021`) are all computed against one menu.
- **A section is the free text `menu_items.category`.** No id, order, nesting or kind. The
  scan prompt fills it from the closed drink vocabulary ("MUST be exactly one of",
  `scan-parser.service.ts:91-105`) and drops the printed heading. The value is also sent to
  the shared `master_wine_library.data_enrichment.menu_category`
  (`menus.service.ts:2447` → `wine-submissions.service.ts:466-469, :744, :887, :1110`), and
  `menuCategoryOf` returns unrecognised text unchanged (`menu-line-view.ts:330-345`).
- **Drink-ness is guessed from text on every read.** `isKitchenLine` defaults to drink
  (`menu-line-view.ts:287-305`), lets a known drink section win "whatever its raw line names"
  (`:103-111`), and drives `kitchen_line` (`:369`), the plan (`menus.service.ts:2029`), the
  carry (`:2305`), the import guard (`:2426-2428`), the manual add path
  (`addMenuItem` `:881` → `resolveAndPersistItems(…, isCurrent)`, `:929-936`) and
  `readKitchenInventoryIds` (`menu-line-view.ts:388`). It has no notion of the menu's kind.
- **A draft's lines have no `inventory_item_id`.** It is back-filled only at carry
  (`:2576-2585`, `:2286`); the real link is `wine_library_id` → house row by
  `master_wine_id` (`carriedWine`, `:128-135`; `computePlan` `:1941-1951`).
- **A line has no dish price.** `menu_items` holds `bottle_price` and `by_glass_price` only
  (baseline `:3790-3791`; `wine-extract-item.interface.ts:48-49`). Food lines have no identity:
  the plan stamps them "kitchen" and compares nothing (`:2029`).
- **Seam dedupe keys on `(producer, name, vintage)`** and keeps the first
  (`scan-parser.service.ts:377-393`). **xlsx reads only the first sheet with items**
  (`csv-parser.service.ts:283-305`).
- **The price-follow trigger skips `import` and `menu_current`**
  (`current_menu_line_follows_house_price`, `20270106000000:260`). A live-line correction
  writes `set_house_menu_price` with source `import` (`menus.service.ts:1347-1366`), so the
  same house item on another live menu keeps its old price. The RPC already sets
  `mudavym.menu_price_menu_id` (`:210`).
- **Union readers** take `max()` of two prices silently (`house_beverage_ledger`,
  `20261223060000`: the `menu` CTE at `:241-246`, `max()` at `:375-376`); the cellar's
  `notPlaced` would count food (`unplacedMenuLines`, `cellar-registers.ts:373-375`).

**Production.** Postgres 15 or later (`UNIQUE NULLS NOT DISTINCT` in baseline `:8208`).
**Not measured:** houses with more than one active menu; any `full|bar|events` row; row
counts and category variants per menu. Gate G0 measures them (lanes plan).

## Options considered

1. **One live menu per kind, with the house's own sections on top (chosen).** Toast, Square
   and Lightspeed run several live menus over one item list. It keeps 0193's versions,
   carry, locks and dating per kind. It costs a sections table, a per-kind index and a pass
   over every reader.
2. **One "ultimate" menu, merged on every upload.** A wine-list-only upload would mark every
   food line gone. Rejected (menus-plan §4).
3. **Keep one live menu per house.** Rejected by S208 item 1.
4. **House-defined kinds (Brunch, Kids, Cocktails).** Rejected for now: each kind multiplies
   live menus, versions and conflicts; "Brunch" is a time window, Cocktails a Drinks section.
   Dayparts reuse the S203 window mechanism later (§F6).
5. **Square-style item library, menus as views.** Cleanest long-term, but rebuilds versions,
   carry and locks. Deferred, not rejected.
6. **Sections as a JSON tree on `restaurant_menus`.** Rejected: lines cannot reference a
   section id, a move is not one statement, the tenant FK is unchecked.
7. **Keep `menu_items.category` as heading and category.** Rejected: a house heading ("From
   the bar") breaks every text guess (F-1470) and, through `menuCategoryOf`, reaches the
   shared library (the 0333 failure).
8. **Infer drink-ness from text forever, with a better word list.** Rejected: a guess that is
   recomputed on every read can flip a live line between drink and dish with no one deciding.
   The decided kind is stored (rule 7).
9. **Do nothing.** Two live menus already crash `/menu`.

## Decision

A house keeps **one live menu per kind**: Drinks, Food and Desserts can all be live at once.
Each menu is shown in the **house's own sections**. Whether a line is a **drink** or a
**dish** is **stored**, and a drink's **category** comes from a fixed vocabulary that stock
and reports read. The AI suggests, the rules check, and nothing goes live without the owner's
tap. "Kind" below always means the **menu kind** (Drinks/Food/Desserts); 0333's
`beverage_kind` (wine/beer/spirit) is called the **drink category's filing kind** and is a
different axis (§F19).

### Kinds

1. **Three kinds, in `restaurant_menus.menu_type`.** Drinks is the existing `beverage` value,
   shown as "Drinks". Food is `food`. Desserts is a new value, **`desserts`** (§F1).
   - The CHECK is widened: DROP, then ADD NOT VALID, then VALIDATE.
   - `full|bar|events` stay in the CHECK so unmeasured rows validate, but **nothing may make
     them live**: `make_menu_current` and `make_menus_current` refuse a legacy kind with
     22023, and a claim forbids a new write. Version timelines show a legacy row read-only in
     the Drinks timeline, labelled with its old kind; it can be read again as a new draft
     but not restored as itself (0193's "every extraction stays accessible" holds).
   - "Full menu" is a **read across every live menu**, not a kind.
2. **One active menu per house per kind, enforced by the database.**
   - Partial unique index `restaurant_menus_one_active_per_kind ON (restaurant_id,
     menu_type) WHERE status = 'active'`.
   - A fail-loud DO block runs first and RAISEs with counts if a house has two active menus
     of one kind or any active legacy row. It never archives anything quietly (§F7).
     Because migrations auto-apply on merge, **G0 is re-run in the hour before lane 1
     merges** and its result goes in the PR body; the rollback is stated there (the
     migration is one transaction, so a refusal applies nothing; the cleanup is a person
     choosing through `make_menu_current`, then the deploy is re-run).
   - `make_menu_current` keeps the house-row lock and adds `AND menu_type =
     v_menu.menu_type` to **both** the `already_current` test and the archive UPDATE.
     Archive-before-activate keeps the non-deferred index satisfied.
3. **Several kinds go live in one transaction.** `make_menus_current(p_restaurant_id,
   p_menu_ids uuid[], p_actor)`: locks the house row, archives per kind, activates every id,
   and sets `made_current_at` once for the batch. It refuses a kind listed twice, a menu of
   another house, an empty menu (F-681, per menu) and a legacy kind. SECURITY INVOKER,
   `search_path` pinned, EXECUTE revoked from PUBLIC/anon/authenticated, granted to
   service_role.
4. **The carry can always be finished.** New `restaurant_menus.carried_at timestamptz NULL`,
   set when a menu's per-line carry completes. Lines for **every** kind in the batch are read
   before the switch (the existing read-before-switch rule, per menu). A retry whose menus
   are already current re-runs the carry for any of them with `carried_at IS NULL`, dated at
   that menu's `made_current_at` (`set_house_menu_price` treats an equal date as not stale,
   so the rerun writes the same values). The toast and `listVersions` show "carry not
   finished" until it is. The carry is still not atomic with activation (inherited), but it
   is now always finishable.
5. **A new menu is a draft by default.** `status` DEFAULT becomes `'draft'`. The baseline
   seed RPC and `scripts/synth/seed.py` already write `status` explicitly (Context), so the
   new DEFAULT leaves them unchanged; a seed adding two active menus of one kind now fails on
   the index, which is correct.

### Sections

6. **New table `public.menu_sections`.**
   - `id`, `restaurant_id`, `menu_id`, `parent_id` (nullable), `position int`.
   - `title`: the house's heading, renamable.
   - `title_as_read`: immutable; the printed heading. **NULL for back-filled sections**, so
     they never enter the AI feedback signal.
   - `key text NOT NULL`: the **path-scoped** normalised slug (parent key + `/` + the
     casefolded, Turkish-aware, `\p{L}\p{N}`-only heading), so "Glass" under Red and under
     White differ. `UNIQUE (menu_id, key)`; normalisation makes "Red" / "red " one key.
   - `drink_category text NULL`: CHECK against the 0186 vocabulary. NULL means "inherit from
     the parent", and at the top level "not a drink section, or not mapped yet". Which of
     those it is never rests on NULL: the lines' stored `line_kind` decides (rule 7).
   - Suggestion fields: `suggested_kind`, `suggested_category`, `suggestion_confidence`,
     `suggested_by`, `inherited_from_section_id` (rule 12).
   - Owner's tap: `confirmed_by` → `public.users(user_id)` **ON DELETE SET NULL** (a tap is
     not the audit record; the change log is), and `confirmed_at`.
   - `created_at`, `updated_at`.

   **Integrity:**
   - **Same house.** `UNIQUE (id, restaurant_id)` on `restaurant_menus`; `(menu_id,
     restaurant_id) → restaurant_menus(id, restaurant_id) ON DELETE CASCADE`.
   - **Same menu as the parent.** `UNIQUE (menu_id, id)`; `(menu_id, parent_id) →
     menu_sections(menu_id, id)`.
   - **No cycles, at most three levels** (Wines › Red › Turkey). A BEFORE trigger walks the
     parents and refuses a cycle or a fourth level (§F2).
   - **Order.** `UNIQUE NULLS NOT DISTINCT (menu_id, parent_id, position) DEFERRABLE
     INITIALLY DEFERRED`. Creating, reordering and reparenting go through RPCs
     (`add_menu_section`, `reorder_menu_sections(p_restaurant_id, p_menu_id, p_parent_id,
     p_ids uuid[])`) that lock the menu row, compute positions server-side, and refuse ids
     that are not **exactly** the sibling set of that menu, parent and house (409; another
     house's id is 404 per [[0147]]). No client sends `max+1`.
   - **Change log.** New append-only `public.menu_section_changes` (section, menu, house,
     actor → `users` RESTRICT, at, action, before/after jsonb). Every create, rename,
     reorder, reparent, move, category edit, confirm and delete writes one row (0193
     round-2 item 1 "audited"). `account-delete-blockers.ts` `RECORD_WORDS` gains "menu
     section changes".
   - **Lock-down.** RLS on, ALL revoked from anon and authenticated, no client policy; the
     gateway uses service_role (OD-72/94, `check_new_tables_are_locked_down.py`).
7. **Lines join sections, and a line's kind is stored.** New `menu_items` columns:
   - `section_id`: `(menu_id, section_id) → menu_sections(menu_id, id)`; NULL = **Unsorted**.
   - `position int`: NULL falls back to today's name sort (`menus.service.ts:1745-1751`).
   - **`line_kind text NULL CHECK (line_kind IN ('drink','dish'))`**: decided by the owner's
     tap or by rules that agree (rule 15). NULL = **legacy or undecided**.
   - `drink_category text NULL`: per-line override (a "Bar" section mixes beer and spirits);
     CHECK against the vocabulary; must be NULL when `line_kind = 'dish'`.
   - **`price numeric(10,2) NULL`**: a **dish's** price. CHECK: a `dish` line has
     `bottle_price` and `by_glass_price` NULL; a `drink` line has `price` NULL. So no
     `bottle_price` reader (the ledger's `menu` CTE, `price-locks.service.ts:589`,
     the cellar) can ever read a dish price as a bottle price.
   - `kind_flag text NULL`: why the rules disagreed (shown in Unsure).

   **`category` keeps the 0186 contract.** For a drink line it holds a vocabulary token, as
   today (its SQL regex and `a-beer-line-classifies-as-beer.spec.ts` keep working). For a
   dish line it is **NULL**. The printed heading lives only in `menu_sections.title_as_read`.

   **Is a line a drink?** One function, `lineIsDrink(line, menu)`, used by every gate below:
   - `line_kind = 'drink'` → yes; `'dish'` → no.
   - `line_kind IS NULL` (legacy rows, restored old versions): **today's rule exactly** — a
     drink unless `isKitchenLine(category, raw)` says kitchen. So no existing line on an
     existing Drinks menu changes status, leaves `/cellar` or the ledger, or turns Unsure.
     [2026-10-12, lane 3a: narrowed to menus that are not Food or Desserts. A NULL
     `line_kind` on a Food or Desserts menu is **not** a drink; see the Review log, "Lane 3a
     corrections".]
   - A NULL `line_kind` on a **new** line cannot reach make-live: the plan counts it Unsure.

   **The effective drink category** of a drink line is `line.drink_category ?? nearest
   ancestor section's drink_category ?? (category if it is a vocabulary token)`; otherwise
   the line is Unsure. It is **always a vocabulary token**. Stock, the cellar, cocktails
   (F-1470) and reports read it, never heading text.
8. **Gates that use `lineIsDrink` and the effective category** (all of them, not only upload):
   - the import resolver call (`menus.service.ts:2426-2447`);
   - the manual add path `addMenuItem` (`:881`, its resolver call `:929-936`), on drafts
     and live menus;
   - the confirm tap and a section move into Drinks (resolve-on-tap, rule 16);
   - the carry (`:2305`, `addToInventory` `:2696`) and `carriedWine`;
   - `kitchen_line` in the line view (`menu-line-view.ts:369`) and
     `readKitchenInventoryIds` (`:388`);
   - `menuCategory` sent to the resolver is the **effective token**, never `category` text
     passed through `menuCategoryOf` (0333). [2026-10-12, lane 3a: the token step keeps
     `menuCategoryOf`'s Turkish heading → token mapping (F-1293); its output is still always
     a vocabulary token, never heading text. See "Lane 3a corrections".]
   - **0333 item 3:** at carry, when the owner confirmed a category (line or section), the
     house item's kind is written as **declared** from it, so a later library reclassify
     never overwrites it. The shared library row's `menu_category` is never edited by a
     house.
   - Only a line with `parent_item_id IS NULL` will carry or count in a conflict once S203
     adds derived items (reserved now as an open CLAIMS row).
9. **Section edits on a live menu.** Rename, reorder, reparent, and delete of an **empty**
   section are presentation: no version, no price or stock effect, logged. Deleting a
   non-empty live section moves its lines to Unsorted (logged). **Editing a section's or
   line's drink category, or a line's kind, on a live menu is refused** (409, "change it in a
   review"): it would change stock filing outside 0193's dated carry. It is done by reading
   again or restoring (rule 20).
10. **Moving a section to another kind** (drafts only). One statement updates the section's
    `menu_id`, **sets `parent_id = NULL` and `position` to the end of the target's top level
    in the same UPDATE** (the composite parent FK refuses otherwise), and cascades to its
    child sections and lines. A BEFORE trigger first locks the **house row** (the same lock
    `make_menu_current` takes, so a concurrent make-live cannot activate the target in
    between) and refuses unless both menus are drafts of the same `read_together_id`.
    Dragging to a kind the upload did not produce creates that kind's draft in the same batch
    (and from then on that kind's other live lines show as Gone in the review; the screen
    says so before the drop). Each draft's `extraction` and `lines_extracted` stay as read;
    the review's counts are computed from the lines.
11. **Back-fill (lane 1).**
    - Every menu, archived ones included (§F4), gets one top-level section per distinct
      **normalised** non-blank `category` (trimmed, casefolded, Turkish-aware), ordered as
      `:1750` sorts today. The title is the house-language display word for the token (a
      fixed map, e.g. `red` → "Kırmızı şaraplar" / "Red wines"); a non-vocabulary value keeps
      its most frequent spelling. `title_as_read` NULL, `key` set, `drink_category` = the
      token when it is one, else NULL.
    - **This UPDATEs every `menu_items` row's `section_id`** (it is not insert-only).
      `line_kind` stays NULL (legacy rule). G0 sizes it; the `updated_at` trigger is allowed
      to fire.
    - A blank category leaves `section_id` NULL: **Unsorted**, never "Other".
    - Food lines already on live Drinks menus stay there; the Full menu handles them
      (rule 22). Nothing is split automatically.

### Upload, AI and guardrails

12. **Sections exist from the first upload, and the house's layout carries over.** From lane
    3b, every `createVersion` (upload, CSV, arrival's manual line) materialises sections:
    from the extractor's tree once lane 5b ships, from `category` before that (the back-fill
    rule). Then, for each new section, the **live** menu of the same kind (else its latest
    archived one) is searched for the same `key`; a match copies `title`, parent, `position`
    and `drink_category`, sets `inherited_from_section_id`, and **does not copy
    `confirmed_by`**. An inherited mapping is pre-filled and **does not block** when every
    line's rules agree with it ("Same as last time", collapsed); any disagreement makes the
    section Unsure. A heading whose wording changed ("Reds" → "Red wines") is offered as
    "Same section as Reds?" with one tap; never matched silently. **Restore** brings back
    that version's own sections as they were.
13. **One upload, one batch, one draft per kind found.** Drafts are linked by
    `restaurant_menus.read_together_id` (§F3). They share the content-addressed
    `source_path` and `sha256`; each draft's `extraction` holds **its own slice** and
    `lines_extracted` its count. No kind is picked before upload (S208 item 4).
    - **All or nothing.** If any draft, section or line write fails, every sibling of the
      batch is dropped as a group (the F-1296 `dropUnfinishedVersion` generalised to
      `read_together_id`). Discarding one draft later is allowed; its siblings stay.
    - **Reply shape.** `POST /menus/import` keeps `menuId` (the Drinks draft, else the first)
      and adds `drafts[]` (`{menuId, kind, lines}`) and `readTogetherId`, so every existing
      caller keeps working.
    - **The split ships behind `MENUS_SPLIT_BY_KIND`, default off.** Off: one Drinks draft
      as today (with sections). It is turned on by the founder's keystroke only after the
      readers (lane 4), the review (lane 6), onboarding (lane 6b) and the evaluation (lane 8)
      are in.
    - **Arrival's manual line** (`importParsedItems`) stays one Drinks draft, named
      explicitly, not by default.
14. **The extractor returns a section table**, not a flat list: a compact list of
    sections (`path`, `heading_as_printed`, `kind_suggested`, `drink_category?`,
    `continues_from_previous?`) and per item a section index, `line_kind_suggested`, and
    either drink prices or a dish `price`. Items stay terse (the 16,000-token cap and the
    122-vs-159 wine A/B at `scan-parser.service.ts:58-80`).
    - The prompt changes from "every drink" to "every priced line"; the vocabulary clause
      becomes "`category`: one of … for a drink; **null for food**".
    - Food descriptions stay out of v1 (§F11).
    - CSV heading rows become sections (`csv-parser.service.ts:377-386`). **xlsx reads every
      sheet**; a sheet's name becomes a top heading and a kind hint; an unreadable sheet is
      recorded as a gap.
    - Chunk seams pass the open heading path forward. The seam dedupe key becomes
      `(producer, name, vintage, section_path)`, normalised with `\p{L}\p{N}`; **prices stay
      out of the key**, so a seam repeat is still dropped. Two lines of one wine in two
      sections both survive and meet rule 17.
    - "By the glass" / "By the bottle" headings are formats (§F17): a line under one is merged
      with the same wine in its sibling format section **of the same parent** only; never
      across parents.
    - **Turkish prices** like "1.250,00": the current `scanPrice` drops them by design
      (`:39-52`); lane 8's corpus measures the loss before 5b ships, and a fix is owed if it
      is above zero.
15. **The model's kind is a suggestion; rules decide Unsure.** `kindOf(heading, line) →
    drinks | food | desserts | unknown` replaces the text guess **for new reads**; the
    default is `unknown`. `isKitchenLine` stays for the legacy rule (rule 7), and its CLAIMS
    rows are kept or edited in place (lanes plan).
    A line or section is **Unsure** when any of these holds:
    - the model and `kindOf` disagree;
    - `kindOf` returns `unknown`;
    - a line's kind differs from its section's kind;
    - a drink line has no effective vocabulary category;
    - the shape contradicts the heading (a dish under "Dessert wines"; a wine under
      "Desserts" with no drink category);
    - the heading golden set misses it, even when model and rules agree (rules and model can
      share a blind spot).
    Confidence is recorded but **never clears** Unsure. **An Unsure or dish line never
    reaches the resolver.** A known heading resolves its whole section with one tap (rule 18).
    - **Second opinion (§F12):** a text-only classification of the heading list, made from
      `scan-parser.service.ts` (so the ten-file model-client claim holds) under the same
      AI-spend ledger: `allowance: "unlimited"` like the menu read (0193 round 3 answer 2),
      and an unreadable ledger fails closed **for this call only**: the upload continues with
      rules only, every section without an agreeing rule marked Unsure. It never 503s a read
      already paid for.
16. **Resolve on tap.** When the owner taps a line or section "Drink", sets a category, or
    moves a section into Drinks, the gateway resolves those lines then (the same
    `resolveLibraryWinesBatch` and submissions path, extracted from `resolveAndPersistItems`).
    The review shows "N drinks not linked yet" before make-live; an unlinked drink line still
    goes live as a line and is listed by the carry's existing `not_linked` count.
17. **Partial reads count per kind.** New `restaurant_menus.part_read text NULL` replaces
    the name prefix (the prefix is still parsed for legacy rows). Each chunk records its page
    range; a gap taints only the kinds whose sections it touched, and only those need
    `partReadAccepted`. A kind already live whose new read keeps under ~60% of its lines
    (to be measured in lane 8) is treated as a suspected partial read. When an upload covers
    only some of a kind's sections, the review offers **"Update only these sections"**,
    which scopes Gone to the section keys present (§F18). Drafts are named "Drinks list",
    "Food menu", "Desserts menu" (house language), with no data in the name.

### Review and going live

18. **The review is grouped by kind, then by section**, in this order:
    1. **Conflicts** (block; rule 19).
    2. **Unsure** (block). One tap per **section** (Drink / Food / Dessert, plus the
       category for a drink section) applies to every line that agrees; a line that
       disagrees stays for its own tap. The screen states the count ("2 sections, 3 lines
       to check").
    3. **Price changed**, with 0193 L13 kept: prices a person set after the read come first,
       each with its Keep switch. Drinks compare through the house item; **dishes compare by
       `(section key, normalised name)`** (display only: a dish has no house price in v1).
       A renamed dish shows as Gone + New side by side in its section.
    4. **New.**
    5. **Gone from this kind** (scoped to the kinds, or with §F18 the sections, in the
       upload). **Keep** — a swipe *and* a visible button — copies the live line (kind,
       category, section key, prices) into the draft as a new line. Without Keep a Gone line
       leaves the menu; a drink's stock is untouched and it is tagged "not on any menu" when
       no other live menu lists it.
    6. **Same as last time** (inherited sections) and **Unchanged**, collapsed.

    Above the groups, a kind strip ("Drinks 84 · Food 41 · Desserts 9") takes a section
    drag; long-press opens "Move to…" ([[0112]] sheet shape) as the accessible alternative.
    Lines can be assigned to a section (Unsorted is never a dead end); sections can be
    created, merged and deleted in the draft. The plan's "being replaced", "retiring",
    `returned` and `dormantLocks` are computed against the **post-switch live set** (every
    other kind's live menu plus the batch). The batch fingerprint covers every draft's
    lines, prices, line kinds, section→kind assignment and picks; any change after the plan
    was shown returns 409.
19. **Two prices: the owner picks, and every pick is a draft edit** (S198, S202).
    - **What conflicts.** Two lines that resolve to the **same house item** (through
      `wine_library_id` → `master_wine_id`, as `carriedWine` does; a draft line has no
      `inventory_item_id` yet) with different prices **of the same price kind** (bottle vs
      bottle, glass vs glass; a blank is not a conflict), across the **post-switch set**:
      within one draft, between drafts of the batch, and between a draft and another kind's
      live menu. A drink line that resolves to no house item cannot conflict and is counted
      "not linked" (rule 16).
    - **The pick never touches a live price before the RPC.** Picking the **live** price
      corrects the draft line to it. Picking the **draft** price records the pick; the
      carry's `menu_current` write, dated at the batch's `made_current_at`, sets the house
      price, and the price-follow trigger (rule 21) brings the other kind's live line to it.
      Within the batch, the losing draft line is corrected to the winner. So a refused or
      failed make-live leaves every live price as it was (0193 round-2 item 7 "a draft
      touches neither inventory nor prices" holds).
    - A **price-locked** item keeps its lock: the carry holds it and S202's "Locked at X —
      the menu says Y" pick appears after go-live, unchanged.
    - Two pours of one wine at two glass prices (a 75 ml dessert pour and a 150 ml glass)
      are a conflict in v1; see Founder forks.
20. **One tap makes every ready kind in the batch live** through `make_menus_current`
    (blocks are per kind: the owner may make live any non-empty subset of the batch's kinds
    with nothing blocking; the rest stay drafts in the batch), then the
    carry runs per menu (`menus.service.ts:2284`, `source: "menu_current"`, all at the
    batch's `made_current_at`), only for lines where `lineIsDrink`. A dessert **wine** in a
    Desserts section carries like any drink: stock follows its effective category, not the
    menu's kind (§F9). Dish lines go live as lines; their stock follows [[0331]] when the
    recipe lane links them; a dish's price lives on its line only. The toast reads, e.g.,
    "Drinks + Desserts updated · 3 prices changed, 2 new · Food untouched".
    - **Versions and restore are per kind.** Each kind has its own timeline (legacy rows in
      Drinks, rule 1). Restore opens the same review, prefilled, and keeps 0193 L11: a price
      is dated by the choice. No instant undo (§F8). Desktop shows versions side by side.
    - **Compatibility.** `POST /menu-versions/:menuId/make-current` with the single-id body
      keeps working (it becomes a one-menu batch) until every web caller
      has moved: the call (`services/api/menus.ts:555`, made from `MenuPlan.tsx:267`) and
      the readers of its reply through `makeCurrentSentence` (`MenuVersions.tsx:327, :505`,
      `HouseMenu.tsx:306`, `onboarding/MenuReviewScreen.tsx:106`).
21. **After go-live, one house item has one list price on every live menu** (S202: the
    house holds the list price). `current_menu_line_follows_house_price` stops skipping by
    source and instead skips **only the menu named in `mudavym.menu_price_menu_id`** (the
    menu whose line made the change); it follows on every other active menu of the house.
    A live-line correction or add on Drinks therefore also updates the same item's line on
    Desserts, and the correction's reply and toast name it ("also changed on Desserts").
    Mutation-tested in lane 1.

### Who sees what

22. **The Full menu** shows every live kind as one document: kind blocks in the house's order
    (default Drinks, Food, Desserts; draggable, stored on `restaurants.menu_kind_order`),
    each in its own sections and order. Owners and managers rename and drag sections there
    (rule 9 limits apply).
    - **86 marks** ([[0336]]) show on drink lines that have a house item; dishes, cocktails
      and unlinked drinks cannot be 86'd yet (F-1434).
    - **Legacy dishes on a Drinks menu** (lines where the legacy rule says kitchen) are hidden
      from the Full menu once a Food menu is live, and a one-time card offers "Move these 12
      dishes to Food" through a review. Before a Food menu is live they show in their
      section, as today.
    - Composed by the server in one endpoint (§F10); exports and the phase-2 guest page reuse it.
    - **Print to PDF** is a print stylesheet, labelled "House copy — no allergen
      information".
    - The last live Full menu is cached for offline reading, with an "as of" time.
23. **Roles are unchanged from today.** Every role reads the Full menu with the prices it
    reads today; when MENU-02 (the pending money-policy rule in the `menu-line-view.ts`
    header) withholds sale prices from members, the Full menu endpoint follows it through the
    same `MEMBER_LINE_KEYS` allowlist. Only an owner or manager reviews, makes live, or edits
    sections. Raw line text stays withheld from staff (`menus.controller.ts:49-52`, `:264-271`).
24. **Every new route is house-scoped.** The house comes from the JWT; every section, line
    and menu id is looked up with `restaurant_id` (as `addMenuItem` does); a foreign id
    answers 404 ([[0147]]). Each route has a tenant spec and a CLAIMS row.

### Readers that change

25. **Every current-menu reader goes through one function.** `readCurrentMenus` returns
    `menu_type`, `section_id` and `line_kind`, binds its error ([[0067]]), and takes a
    `kinds` filter.
    - `getMenu`, `getDiscardedLines`, onboarding (its `read_error_baseline.json` row is
      removed), `listVersions` (`currentByKind`, keeping `current`) and arrival
      (`arrival.service.ts:170`; `:226` limited to the active Drinks menu) are rewritten on it.
    - A claim fails the build if `.eq("status","active")…maybeSingle()` on `restaurant_menus`
      remains in `apps/api-gateway/src`.
    - `MEMBER_LINE_KEYS` (`menu-line-view.ts:239`) and `CURRENT_MENU_LINE_COLUMNS`
      (`current-menu-lines.ts:40`) name the new columns.
    - **Drink readers** (cellar and beverages via `current-menu-lines.ts`, vendor supply,
      promotions, the ledger) select lines on **`menu_type` first** (any live menu), then
      `lineIsDrink`, then the effective category. So a dessert wine on Desserts is in the
      cellar (§F9) and no existing Drinks line drops out.
    - Price-lock rows name their menu and kind.
    - `house_beverage_ledger` is DROPped and recreated (its return type gains
      `menu_price_conflict`, which `CREATE OR REPLACE` cannot do) from the latest body
      (`20261223060000`), with its GRANTs re-issued; it counts a wine once and flags two
      prices instead of `max()`. The plain inner join on `restaurant_menus rm` stays
      (`CELLAR-MENU-READERS-READ-THE-CURRENT-MENU`).
26. **Onboarding "a menu is live"** means any live kind with a drink line (§F13).

### Brackets written into the amended records (lane 0, verbatim)

Each bracket is appended to an existing line, so no line of the amended record moves.

**[[0193]], end of round-2 decision item 7 "Menu versions" (`0193:278`):**

> **[Amended 2026-10-12 by ADR 0340 (founder answer S208, sim ledger): one current menu per house *per kind* (Drinks `beverage`, Food `food`, Desserts `desserts`). Decided, not yet built: when ADR 0340's lane 1 merges, `make_menu_current` archives only the house's other active menu **of the same `menu_type`**, under the house row's lock, answers `already_current` per kind and refuses a legacy `full|bar|events` menu; a new `make_menus_current` makes several kinds current in one transaction; a new `carried_at` lets a retry finish an unfinished carry; the partial unique index `restaurant_menus_one_active_per_kind` reverses round 2's "no unique index" choice below, once Gate G0 has measured production; and a new menu defaults to `draft`. Until lane 1 merges the code is as this item says. Everything else in this item stands: every read is a new draft, a draft touches neither inventory nor prices (two-price picks are draft edits, ADR 0340 rule 19), and the carry is dated by the choice (L11). Item 3 and its S202 note are unchanged. Open CLAIMS rows that fail the build if this lands unrecorded: `claims.d/docs-menus-kinds-adr.jsonl`.]**

**[[0193]], status line (`0193:3`):**

> **[Amended 2026-10-12 by ADR 0340 (founder answer S208): one current menu per house per kind (Drinks, Food, Desserts) -- see the bracket at the end of round-2 item 7. Decided, not yet built.]**

**[[0193]], L13 row (`0193:357`):**

> **[Amended 2026-10-12 by ADR 0340, decided, not yet built (its lanes 3c and 6): the plan gains a Conflicts group and an Unsure group above this price list; the list's order and its Keep switches are kept.]**

**[[0293]], decision 2 heading paragraph (`0293:44`):**

> **[Amended 2026-10-12 by ADR 0340 (rebase of this Proposed decision): once ADR 0340's lane 1 merges, "the current menu" means "the current menus, at most one per kind" (Drinks, Food, Desserts). A draft still is not current. Decided, not yet built (its lanes 2 and 4): the cellar readers named here will read the **drink** lines of the current menus, so a dish is never "not placed". F2 and F3 ("the figure stays as it is today") hold for drink items. F1 (whether a kept draft counts as evidence) stays the founder's call.]**

**[[0186]], status line (`0186:3`):**

> **[Amended 2026-10-12 by ADR 0340 (founder answer S208). Decided, not yet built (its lanes 3b and 5b): the extraction will also return a section table (kept as `menu_sections.title_as_read`) with a suggested menu kind per section, and a dish price. The closed drink vocabulary is unchanged: `menu_items.category` keeps holding a vocabulary token for a drink line and will be NULL for a dish line, and a section's or line's `drink_category` uses the same tokens. Only a token reaches `menu_category` (ADR 0333). The /menu "Section" label will edit the section title, not `category`. The new prompt is re-measured against this ADR's baseline (identity agreement 0.909 against self-agreement 0.888, `scan-parser.service.ts:64-65`) before it ships.]**

### F. Forks decided by the coordinator (under the 2026-10-07 delegation; open to the founder's veto)

| # | Fork | Call | Why (the attack it survived) |
|---|---|---|---|
| F1 | Store Desserts as | `desserts` | `dessert` already means dessert wine (`wine-extract-item.interface.ts:26`). |
| F2 | Section depth cap | 3 | Wines › Red › Turkey. No deeper printed case in the corpus; the trigger is cheap to relax. |
| F3 | Mixed file stored as | One draft per kind, linked by `read_together_id`, each with its own extraction slice | The index, `make_menu_current` and 0293's "a draft is not current" work unchanged; one draft split at go-live needs a second rule in every live reader. |
| F4 | Back-fill archived menus | Yes | History views stay uniform; the UPDATE is sized by G0. |
| F5 | Where price picks apply | **Draft edits only**; the draft-price pick reaches the other live kind through the dated carry and the follow trigger | Review: picks written to live lines before the RPC changed a live price even when make-live then failed. |
| F6 | Kinds | Fixed three | Option 4. Dayparts later as S203 windows. |
| F7 | Duplicate actives at migration time | Refuse loudly; G0 re-run within the hour before merge | Archiving in a migration picks a winner on unseen data. |
| F8 | Kind move after go-live; restore | Only in a review; restore goes through the review | A live move bypasses carry and dating (0193 L11). |
| F9 | Dessert wine in a Desserts section | Stock and price follow its effective drink category | Kind is display and liveness; stock reads the category (S208 item 5). |
| F10 | Full menu composed by | Server | One read for exports and the guest page. |
| F11 | Food descriptions in v1 | Out | A per-line text field cost 37 wines on one menu. Second read of food sections when allergens are built. |
| F12 | Second-opinion heading classifier | Yes: text-only, in the scan parser, same ledger, degrades to rules-only | Independent of the rules; cost is one short call per upload. |
| F13 | Onboarding "activated" | Any live kind with a drink line | Beverage-first product. |
| F14 | "Dessert" (singular) heading | Unsure, resolved by line shape | In US menus often a food heading. |
| F15 | Coffee, tea, hot drinks | `non-alcoholic`, house heading shown | A `hot drink` token needs a 0186 change. Later. |
| F16 | Cheese course (Fromages) | Food, flagged Unsure | |
| F17 | "By the glass" / "By the bottle" | Formats, merged with the same wine **under the same parent only** | Merging across parents can fuse two wines. |
| F18 | Partial photo of a kind | Offer "Update only these sections" (Gone scoped to section keys present) | A Red-page photo keeps ~70% of a list, passes the 60% check, and would mark the rest Gone. |
| F19 | Word for the new axis | "menu kind" (Drinks/Food/Desserts) everywhere; 0333's axis stays "beverage kind" | Two axes named "kind" would confuse reports and the refile. |
| F20 | Dish price storage | New `menu_items.price`, with CHECKs keeping drink and dish price columns exclusive | Reusing `bottle_price` leaves every reader that forgets a filter misreading dishes as bottles. |
| F21 | Inherited section mapping | Pre-filled, not confirmed; blocks only when lines disagree | Re-asking every upload makes Unsure block every week; carrying the confirmation would keep a stale tap (a "Bar" that changed from beer to spirits). |
| F22 | Live price edit vs other live kind | The other kind's line follows, and the reply names it | S202: the house holds one list price; a silent split is the failure the founder ruled out. |

## Consequences

- **Easier.**
  - Drinks, Food and Desserts live at once; a wine-list re-upload leaves Food alone.
  - The house's headings, order and mappings survive uploads.
  - Stock, cellar and reports read a stored kind and a fixed category, whatever the heading.
  - No dish can create a library row, a stock row or a house price.
  - Two live menus can no longer crash `/menu`; the database holds "one live per kind".
  - An interrupted carry can be finished.
- **Harder or given up.**
  - A section cannot change kind, category or drink-ness on a live menu without a review.
  - Legacy `full|bar|events` rows stay as dead CHECK values, readable only.
  - The carry is still not atomic with activation (inherited), though now finishable.
  - Dishes have no house-level price, identity or stock in v1; a renamed dish is Gone + New.
  - The prompt change needs an evaluation set that does not exist yet (lanes 5a, 8).
  - The word lists stay in three copies until the single-source lane lands (0333 item 4
    requires them equal meanwhile).
  - No CI workflow runs `supabase/tests`; the SQL tests are local (PGlite), so the
    invariants are also held by static CLAIMS rows.
- **Revisit when:**
  - a house asks for a fourth kind that is not a time window;
  - the Unsure rate on the document set is above 10%;
  - the "wrong kind with no Unsure" count on the document set is above 0;
  - production shows `full|bar|events` rows in use;
  - a house needs two pours of one wine at two prices (Founder forks).

## Not covered (owed, each with its own record)

- **Guest/QR page.** Its own ADR, [[0158]] headers, per-house token URLs. Phase 2.
- **Timed promos as derived items (S203).** `menu_items.parent_item_id` and
  `menu_item_windows`. The carry and conflict check exclude `parent_item_id IS NOT NULL`
  from the day the column exists (open CLAIMS row now).
- **Allergens, dietary tags, descriptions, photos, translations.**
- **Food stock and recipes.** [[0331]] (OD-113, decided) covers depletion; a dish's price
  stays on its line until a food item model exists.
- **One word-list source** (gateway, web and SQL from one JSON file, with a guard).
  Recommended before lane 5a.
- **Rakı tek / duble / 70 cl** and other multi-pour prices: no slot in v1.
- **Pre-existing, not caused here:** procurement vintage reads every menu of any status
  (`procurement.service.ts:1857-1863`).

## Verification (owed by the lanes)

- **PGlite SQL tests**, each mutated so it fails when its rule is removed, run as superuser
  with no Supabase platform (the claims say so; CI does not run them):
  1. Drinks and Food both active.
  2. A second Drinks made current archives only Drinks.
  3. A direct INSERT of a second active Drinks raises 23505.
  4. `already_current` is per kind; a legacy kind is refused.
  5. `make_menus_current` is atomic and refuses a duplicate kind.
  6. A retry with `carried_at` NULL is allowed to re-carry.
  7. A cycle, a fourth level and a parent on another menu are refused.
  8. A draft section move nulls `parent_id`, cascades children and lines, and is refused on a
     live menu.
  9. `reorder_menu_sections` refuses another house's id and a non-sibling set.
  10. A new menu is a draft.
  11. Back-fill counts match; "Red" and "red " become one section.
  12. A live-line price change follows onto another active kind's line, but not back onto
      the originating line.
  13. The dish/drink price CHECKs.
- **Static CLAIMS rows** (CI): the index; the `menu_type` filter in both
  `make_menu_current` clauses; legacy-kind refusal; no `menu_type: "beverage"` literal in
  `createVersion`'s upload path; no new legacy write; no single-row active-menu read; unknown
  and dish lines never reach the resolver; `menuCategory` is the effective token; the pick
  writes no live price before the RPC; RLS and revokes on both new tables (replacing a PGlite
  privilege test, which PGlite cannot run); every new route house-scoped.
- **Heading golden set.** About 400 headings in English, Turkish, French, Italian, Spanish
  and German, plus the adversarial list, as a pure spec in CI.
- **Document set (lane 8).** 10-15 mixed menus including real phone photos (glare, skew,
  chalkboards, Turkish `İ`/`ı`, "1.250,00" prices); measures wrong-kind-with-no-Unsure,
  Unsure rate, line recall, run agreement, identity agreement, the 60% threshold, and tokens
  per item.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-11 | Founder (S208) | Proposal accepted: "yes build it" |
| 2026-10-12 | Coordinator research (data, flow, readers, AI briefs; code at `24ee6705f`) | Drafted; F1-F17 under delegation; one adversarial finding changed F5 |
| 2026-10-12 | Four adversarial reviews (prices/stock, claims/contracts, product/AI, lane feasibility) | Not ready as written: 43 musts across reviews (many shared). All valid ones fixed here and in the lanes plan; rejected points in the Review log |
| 2026-10-12 | Lane 0 (`docs/menus-kinds-adr`, records only) | Filed as 0340 after a sweep of refs, open PRs and worktrees; brackets written into 0193, 0293 and 0186; the two founder forks filed as OD-228 and OD-229; five open CLAIMS rows, each mutation-tested; 16 code citations corrected against `24ee6705f` (Review log, "Lane 0 corrections") |
| 2026-10-12 | Lane 1 (`feat/menus-kinds-schema`, schema only) | Four migrations `20270107100000`-`20270107400000` and their SQL tests (PASS on the PGlite corpus, FAIL on a build without each); 38 SQL mutations and 7 claim mutations all killed; three lane-0 rows flipped to resolved, four new rows; nine corrections (Review log, "Lane 1 corrections"). Not run: G0 (production read), any Postgres other than PGlite |
| 2026-10-12 | Lane 2 (`fix/menus-readers-per-kind`, gateway readers only) | Every gateway reader of "the" active menu that this lane names reads the live menus as a list through one function (`readCurrentMenuRows`); 14 new jest cases fail on the base and pass after; 11 code mutations all killed; one lane-0 row flipped, three new rows, two existing rows edited in place; eight corrections (Review log, "Lane 2 corrections"). Not run: G0, L8, web tsc/vitest |
| 2026-10-12 | Lane 3a (`fix/menus-line-kind`, a line is a drink only when stored or proven) | One `lineIsDrink(line, menuKind)` in `menu-line-view.ts` (the web's twin in `firstProof.ts`) now gates the import resolver call, `addMenuItem`, the carry, `kitchen_line` and `readKitchenInventoryIds`; the resolver gets only the effective token; a confirmed category is written on the house item as declared. 20 new jest cases (18 fail on the base; the 2 that pass pin unchanged legacy behaviour) and 3 vitest cases; 9 code mutations all killed; three new claim rows, five existing rows edited in place; seven corrections (Review log, "Lane 3a corrections"). Not run: G0, L8 |

| 2026-10-12 | Lane 3b (`feat/menus-sections-api`, the sections API and sections on every upload) | Migration `20270107500000` adds ten section functions (materialise, rename, reparent, delete, move to a kind, set category, confirm a section, confirm a line, assign lines, keep a Gone line), each writing its `menu_section_changes` row in the same step and looking every id up inside the house; `MenuSectionsController` serves 12 owner/manager routes under `/menu-versions/:menuId`; every upload now materialises its sections and gets a `read_together_id`; resolve-on-tap links lines a tap made drinks. SQL test T1-T7 PASS on the PGlite corpus and FAIL without the migration; 5 new `menus.service` cases fail on the base; 59 cases in `menu-sections.service.spec.ts`, role-gating cases in the price-corrections spec; SQL, code and claim mutations all killed; one new claims fragment (two rows), one row edited in place; corrections in the Review log, "Lane 3b corrections". Not run: G0, L8 |
## Review log

Fixed (grouped; reviewer.item): conflict key and scopes (R1.M1, R2.M5, R3.M6) → rule 19;
picks before the RPC (R1.M2, R2.M11, R3.S7, R4.M7) → rule 19, F5; NULL meaning both dish and
unmapped, food tagged as drink, add-line path, owner's category not reaching stock, `category`
contents, legacy flood (R1.M3-M5, R2.M2-M3, R3.M1-M2, R3.M7, R4.M6) → rules 7, 8, 15, 16;
follow trigger (R1.M6) → rule 21; sections from the first upload and inherited (R1.M7, R3.M5,
R4.M4, R1.S6) → rule 12, F21; legacy kinds (R1.M8) → rule 1; claims rows (R2.M1, R2.S6-S8) →
lanes plan; 0333 (R2.M2, R3.M1) → status, rule 8; dish identity and price (R2.M4, R3.S1,
R4.M2) → rules 7, 18, F20; tenant scope and reorder RPC (R2.M6-M7, R3.M11, R4.S4) → rules 6,
24; contract changes (R2.M8-M9, R3.M3, R4.M10) → rules 13, 20, lanes 6b; all-or-nothing
(R2.M10, R1.S11) → rule 13; item-7 ambiguity (R2.M12) → status and bracket; missing
endpoints (R3.M4, R4.M3) → rules 9, 10, 18, lane 3b; xlsx (R3.M8) → rule 14; lane order
(R3.M9) → flag in rule 13; migration wedge (R3.M10, all .S) → rule 2; Full-menu duplicates
(R3.M12) → rule 22; dormant/returned (R4.M1) → rule 18; live category edit (R4.M5) → rule 9;
carry finish (R1.S4, R4.M8) → rule 4; part-read storage (R2.S10, R4.M9) → rule 17; missed
files (R4.M11) → rule 25, lanes; F12 spend (R1.S8, R3.S8, R4.M12) → rule 15; ledger DROP
(R1.S10) → rule 25; back-fill is an UPDATE, key collisions, titles (R1.S2, R2.S2-S3, R3.S2,
R4.S11) → rules 6, 11; move lock and parent (R1.S3, R2.S12, R3.S10, R4.M3) → rule 10;
resolve on tap (R1.S5, R3.M2) → rule 16; L13 and README (R1.S8) → status, lanes; derived
items (R1.S9) → rule 8, Not covered; account-delete words (R2.S4, R3.S12, R4.M11) → rule 6;
synth lists (R2.S5) → lanes; naming (R2.S1) → F19; 86 and OD-113 wording (R2.S9, R3.S10,
R4.S7) → rules 20, 22; partial photo (R3.S3) → F18; F17 vs depth example (R3.S5) → F2, F17;
IT/ES golden (R3.S6) → Verification; corpus photos and "1.250,00" (R3.S9) → rule 14;
token budget (R2.S11, R3.S4) → rule 14; kind order, child category inheritance (R3.S10) →
rules 7, 22; CI does not run SQL tests (R3.S11, R4.S1) → Verification; Keep button, PDF label
(R3.S12) → rules 18, 22; 0293 F2/F3 wording (R3.S12) → bracket; position race (R4.S3) →
rule 6; extraction duplication and single-draft discard (R4.S5) → rule 13; ADRs to name
(R4.S6, R2.S12) → Links; Gone after a drag (R4.S8) → rule 10; arrival `:226` contradiction
(R4.S9) → rule 25 (now covered, removed from Not covered); LockedPrices, offline cache, PDF
homes, serial merges (R4.S9) → lanes; MENU-02 (R4.S6) → rule 23.

Lane 0 corrections (2026-10-12, each re-read at `24ee6705f`; the smallest right fix is the
corrected citation or sentence, recorded here and in the lanes plan):
- **Seeds and the `status` DEFAULT.** The draft said the baseline seed RPC and
  `scripts/synth/seed.py` rely on the `'active'` DEFAULT. Both write `status` explicitly
  (`20260805000000:1566` `COALESCE(v_menu->>'status', 'active')`; `seed.py:640`
  `menu.get("status") or "active"`), so rule 5's DEFAULT change needs no seed edit. Rejected
  alternative: adding explicit writes to both, which would be a no-op change.
- **The make-current web callers.** The one call is `makeMenuCurrent` from `MenuPlan.tsx:267`;
  the four places the draft listed read its reply through `makeCurrentSentence`. Rule 20 now
  names both.
- **`vendor-menu-supply.ts:220` is not a price reader.** It selects `id, wine_library_id`; it
  was removed from rule 7's list of `bottle_price` readers (it stays a drink reader in rule 25).
- **Line numbers re-anchored:** `makeCurrent` `:2177` (was `:2196-2204`), `addMenuItem` `:881`
  and its resolver call `:929-936` (was `:947-955`), `addToInventory` `:2696` (was
  `:2596-2606`), `readKitchenInventoryIds` `:388` (was `:375-419`), `isKitchenLine`
  `:287-305` (was `:301-304`), `menu_items` prices baseline `:3790-3791` (was `:3783`),
  `wine-extract-item.interface.ts:48-49` (was `:44-45`), the ledger's `max()` at
  `20261223060000:375-376` (was `:240-262`), `unplacedMenuLines` `cellar-registers.ts:373-375`
  (was `:373-390`), raw-line withholding `menus.controller.ts:49-52, :264-271` (was `:91-99`),
  `price-locks.service.ts:589` (was `:588`), the 0186 baseline figures at
  `scan-parser.service.ts:64-65`.


Lane 1 corrections (2026-10-12, against the lane 0 tip `0266eee31`; each is the smallest
right fix, with the alternative it rejects):
- **`reorder_menu_sections` takes `p_actor`** (rule 6 lists no actor). The change log's
  `actor` is NOT NULL and `users` RESTRICT, so the RPC must be told who reordered. Rejected:
  a nullable actor, which would make the "audited" log optional.
- **The change log refuses UPDATE, not DELETE** (rule 6 says "append-only"). A house's own
  hard delete cascades its rows (`restaurant_id ... ON DELETE CASCADE`) and the sim teardown
  deletes sim houses' rows; refusing DELETE would break both. Rejected: a DELETE trigger with
  a bypass setting, a second mechanism for the same two callers.
- **`menu_items` has no `updated_at`** (baseline `:3783` table, no trigger), so rule 11's "the
  `updated_at` trigger is allowed to fire" does not apply; the back-fill UPDATE fires nothing.
- **The follow trigger keeps one old skip** (rule 21 narrowed): a change with source `import`
  or `menu_current` that names **no** menu still follows nowhere. Basis: such a call cannot
  say which menu already shows the price, and `supabase/tests/20270105500000` T4 writes exactly
  that and expects no line to move; the gateway's callers of both sources pass `menuId`.
  Rejected: following everywhere, which would rewrite the line the import itself just wrote.
- **A dish's price CHECK is NULL-safe.** `price IS NULL OR (line_kind = 'dish' AND ...)`
  passes a NULL `line_kind`, so a legacy line could hold a dish price; the test caught it and
  the CHECK reads `coalesce(line_kind = 'dish', false)`.
- **A heading with no letter or digit** (`'---'`) has an empty key; the back-fill leaves its
  lines Unsorted exactly as a blank category (rule 11), and `add_menu_section` refuses it
  (22023).
- **The key is "Turkish-aware" as far as the database can be:** `İ`, `I` and `ı` fold to `i`
  before `lower()`, and `[^[:alnum:]]` is dropped (`menu_section_key_part`). `lower()` and
  `[:alnum:]` on other non-ASCII letters follow the database ctype: PGlite's is `C.UTF-8`
  (measured); **production's was not read** (G0). The back-fill order is `lower()` of the
  lowest spelling in the database collation, which approximates the JS `localeCompare` at
  `menus.service.ts:1748-1751` and can differ on non-ASCII first letters. Positions are
  0-based.
- **Synth teardown order:** `menu_section_changes` and `menu_sections` go **after**
  `menu_items` and before `restaurant_menus` (the lanes plan said before `menu_items`): a line
  points at its section with `ON DELETE SET NULL`, so deleting lines first rewrites nothing.
  Order pairs added to `assert_teardown_coverage`.
- **Claims:** the three lane-0 rows lane 1 resolves were flipped **in place** in
  `claims.d/docs-menus-kinds-adr.jsonl` (R2.S8 above), not re-filed. The legacy-kind row's
  verify now reads the refusal of any kind outside beverage/food/desserts, since neither
  function names `'full'`, `'bar'` or `'events'`. New rows are in
  `claims.d/feat-menus-kinds-schema.jsonl`. The lane is 15 files, not 13 (this record, the
  lane-0 fragment and `account-delete-blockers.ts` were not in the plan's count).
- **The back-fill is proved outside CI.** SQL tests run on a migrated database, where the
  back-fill has already run on no rows; it is proved by a PGlite harness that seeds rows
  before `20270107200000` and then applies it (Verification item 11), plus three mutations.

Rejected or narrowed, with why:
- **R4.S2 "a later edit on one kind silently rewrites the other kind's line."** The code says
  the opposite: the trigger skips source `import`, which a live correction uses
  (`20270106000000:260`, `menus.service.ts:1347-1366`), so the other line keeps the old price
  (R1.M6 is right). The drift is real and fixed by rule 21, in the direction R1 gives.
- **R1.S6 "never carry a confirmation" vs R3.M5 "carry the confirmed mapping".** Both taken
  in part (F21): the mapping is pre-filled, the confirmation is not copied, and it blocks only
  when lines disagree.
- **R3.S4 "offer a 'different pour, not a conflict' outcome".** Narrowed: one house item has
  one glass price, so v1 cannot store two pours without a new model. Kept as a conflict
  (S198 "owner picks"); the two-pour shape is a founder fork.
- **R4.S10 "teardown and write_set need no change".** Narrowed: cascades would delete the
  rows, but both files keep explicit table lists with guards (`teardown.py:55-80, 369`,
  `write_set.py:32`); lane 1 adds the two new tables, which costs nothing and keeps the
  guards honest.
- **R2.S8 "one fragment per lane branch".** Taken; where an existing row in
  `CLAIMS.jsonl` or another fragment pins changed code, it is edited **in place** rather than
  re-filed, so no id is duplicated.
- **R3.M4 "make-live for some kinds only".** Taken as: make-live takes any non-empty subset of
  the batch's kinds that has no blocking item (rule 18's blocks are per kind), so one Unsure
  Food line no longer blocks Drinks. Recorded here because rule 3's RPC already takes a list.
- **R3.S1 "OD-113 stands for food price is unsupported".** Taken; wording now says OD-113
  (ADR 0331) covers depletion only.
- **R1.S1 / R3.M10 "skip the index with a notice instead of RAISE".** Rejected: an index that
  may silently not exist makes every later rule unprovable. Kept RAISE with a G0 re-run at
  merge and a stated rollback (F7).

Lane 2 corrections (2026-10-12, against the lane 1 tip `2d2aaa513`; each is the smallest
right fix, with the alternative it rejects):
- **One read, in `current-menu-lines.ts`.** `readCurrentMenuRows(db, restaurantId, kinds?)`
  is the one read of the live menus (status `active`, ordered Drinks, Food, Desserts, then
  id; a failed read throws, an empty `kinds` list reads nothing). `getMenu`,
  `getDiscardedLines`, `readCurrentMenus`, `listVersions`, `getOnboardingProgress`,
  `readCurrentMenuLines` and Arrival's opening menu call it. `readCurrentMenus` already
  existed and now takes `{ kinds }`. Rejected: a private MenusService helper, which the
  cellar's `readCurrentMenuLines` could not import without a module cycle.
- **`getMenu` keeps its one-menu fields** (`menuId`, `name`, `status`) and adds `kinds`.
  They name the Drinks menu, or the first live kind when Drinks is not live, so a house with
  one menu of any kind reads exactly as before. Rejected: null when Drinks is not live, which
  would show a Food-only house as having no menu on every page that reads `menuId` today.
- **`listVersions` adds `currentByKind`** and keeps `current` on the same rule as `getMenu`.
- **Onboarding counts any live kind** as "a current menu" and now throws on a failed read
  instead of reading "no menu" (ADR 0067). Rule 26's "with a drink line" is **not** built
  here: it needs lane 3a's `lineIsDrink`; the code comment says so.
- **Arrival `:170` needed no code change** (comment only); `current()` for `menu_item`
  (`:226` at base) now states a line only on a live **Drinks** menu, and a failed menus read
  answers 503 (`SAFE_FAILURE`), not "not stated".
- **Claims:** the lane-0 row ADR-0340-NO-SINGLE-ROW-ACTIVE-MENU-READ was flipped **in place**
  in `claims.d/docs-menus-kinds-adr.jsonl`; new rows are in
  `claims.d/fix-menus-readers-per-kind.jsonl`. Two existing rows that pinned the old code were
  edited in place, not re-filed: PROMOTIONS-HOUSE-FIRST-LADDER in `CLAIMS.jsonl` (its verify
  named the old one-argument signature) and A-MENU-LINE-RAW-LINE-GOES-ONLY-TO-A-HOLDER in
  `claims.d/fix-a-menu-line-carries-its-raw-line.jsonl` (the line read moved into
  `readLinesOf`).
- **Files differ from the plan.** Not needed: `menu-line-view.spec.ts`,
  `onboarding-progress-per-house.spec.ts`, `check_read_columns_exist.py` (the new columns
  already pass it). Needed instead: `onboarding-threshold.spec.ts` (its fake answered one
  row). `read_error_baseline.json` drops the `activeMenu` site (123 sites, 30 files).
  `DELIVERY-AUDIT.md`'s denominator was **not** updated, to stay within 15 files; the base
  measured 124 sites, not the 125 that file states, so the edit is owed by a later lane.
- **Left on their own active reads** for lanes 3c and 4: the plan reads in `menus.service.ts`
  (`:2002`, `:2110` at base), vendor-menu-supply and price-locks. They do not use
  `.maybeSingle()` on the menus row, so they do not fail with two kinds live.

Lane 3a corrections (2026-10-12, against the lane 2 tip `75aaed332`; each is the smallest
right fix, with the alternative it rejects):
- **Branch name.** Built on `fix/menus-line-kind` (the task's name), not the plan's
  `fix/menus-line-kind-gates`; the claims fragment is `claims.d/fix-menus-line-kind.jsonl`.
- **An undecided line on a Food or Desserts menu is not a drink.** Rule 7 said a NULL
  `line_kind` follows today's rule everywhere. `lineIsDrink(line, menuKind)` applies today's
  rule only when the menu is not Food or Desserts (Drinks, a legacy kind, or a kind the
  caller does not know). Basis: every line stored before lane 1 sits on a beverage menu
  (`createVersion` wrote `beverage` only), so no stored line changes status; on a Food menu
  the legacy rule would send "Baklava" to the library and seed a stock row. Rejected: the
  legacy rule everywhere. `NON_DRINK_MENU_KINDS` is the same list on the gateway and the web
  (claim A-MENU-LINE-SAYS-IF-IT-IS-A-KITCHEN-LINE).
- **The effective token keeps F-1293.** `effectiveDrinkCategory` ends with the token
  `menuCategoryOf(category)` names, so a Turkish drink section ("Rakı", "Kırmızı") still
  sends its kind. Its output is always a vocabulary token or null. Rejected: exact tokens
  only, which would undo F-1293. **Cost:** an English heading that is not a token
  ("House pour", "Bourbon") no longer reaches `wine_classify_beverage_kind()`, so the new
  library row stays `unknown` until its section is mapped and resolved on tap (lane 3b).
- **Declared means `identity_provenance = 'house_declared'` with an explicit `kind`.**
  `addToInventory` writes both on a new house item and updates an existing one whose kind or
  provenance differs; a failed update is said on the line (`failed`) and no price is
  carried. Rejected: writing `kind` alone, which a refile that follows `wine_library`
  provenance would overwrite; a new `kind_provenance` column, which needs a migration and is
  outside this lane.
- **What counts as confirmed.** The line's own `drink_category` (rule 7: a per-line
  override, set by a person) or the nearest categorised section's only when that section has
  `confirmed_at`. A back-filled or inherited section category, and a token read out of
  `category`, are not confirmations. `makeCurrent` reads the sections before the switch and
  changes nothing when that read fails.
- **Files differ from the plan.** The plan's separate spec files were merged into
  `menus.service.spec.ts` and `menu-line-view.spec.ts`; `wine-submissions.service.ts` needed
  no change (the declared kind is written by the carry, not the resolver).
- **Not built here:** onboarding's "with a drink line" (rule 26, owed to lane 6b); the
  plan's per-kind active reads (lane 3c); the confirm tap, a section move into Drinks, and
  the plan counting a new NULL-kind line Unsure (lanes 3b/3c). The README row for 0340 is
  owed in a later PR. Founder-gated and not done: the G0 production read, the L8 eval and
  every flag flip.

Lane 3b corrections (2026-10-12, against base `79e62714f`; each is the smallest right fix,
with the alternative it rejects):
- **Sections are made after the lines are stored, not inside `createVersion`'s insert.**
  `importMenu` and `importParsedItems` call `materialise_menu_sections` once the lines are
  written; a failure there drops the version like any other failed import step. Basis: the
  function reuses the SQL key function `menu_section_key_part` and lane 1's back-fill rule,
  so a key is cut in exactly one place. Rejected: cutting keys in TypeScript at insert time,
  which would be a second normaliser that could drift from the SQL one.
- **Every upload gets a `read_together_id`.** `createVersion` now sets
  `read_together_id: crypto.randomUUID()`. Basis: `move_menu_section_to_kind` finds or makes
  the target draft by that id and refuses a draft without one; before this lane nothing set
  it. Rejected: deriving "the same upload" from `created_at` or the source file, which two
  uploads can share.
- **Inheritance matches the exact key only.** A draft section inherits the title, position
  and `drink_category` of the section with the same key on the house's live menu of the same
  kind (else its latest archived one), plus `inherited_from_section_id`; `confirmed_by` and
  `confirmed_at` are never copied. A renamed or re-spelled heading whose key differs starts
  fresh. Rejected for now: fuzzy key matching, which can carry a category to the wrong
  section; owed if the review shows it is needed.
- **Inherited sections keep the source position only on a menu with no sections yet;**
  any other new section goes after the existing ones. Rejected: renumbering the house's
  existing order on every materialise.
- **Two actions added to the log.** The `menu_section_changes.action` CHECK gains `assign`
  (lines moved between sections) and `keep` (a Gone line kept). Rejected: logging them as
  `move`/`create`, which would make the log say something that did not happen.
- **The functions this lane adds refuse an archived menu (55000 → 409).** On the live
  menu, a rename and the delete of an empty section are allowed (a section that still holds
  lines is refused, as the plan says); a category edit, a move to another kind,
  confirmation and line assignment are drafts only, and a reparent is refused when it would
  change the inherited category of a section that holds lines and has no category of its
  own. Rejected: letting a live edit change what a line is filed under without a new
  version. **Gap, owed:** lane 1's `add_menu_section` and `reorder_menu_sections`
  (`20270107300000`) read no menu state, so create and reorder are not refused on an
  archived menu; changing them belongs with a lane that may edit that migration's functions.
- **The URL's menu is checked, not assumed.** The service reads the section or line by id,
  menu and house before calling a function, so a section of another menu of the same house
  is a 404 too. Rejected: trusting the function alone, which looks up by id and house but
  does not take the URL's menu.
- **Resolve-on-tap is not fatal.** `MenusService.resolveOnTap` links lines a tap made
  drinks (unlinked, not discarded, passing `lineIsDrink`) with `.is("wine_library_id",
  null)`; a failure is returned as `error` on the answer and the tap stays made. The
  resolver step was extracted to `resolveDrinkLines` so the import and the tap call the same
  code; the A-LINE-IS-A-DRINK claim row was edited in place to follow it.
- **ENDPOINTS not regenerated.** The generated catalogue is stale against this tree, so a
  regenerate here would carry unrelated drift; the 12 routes are owed in the next
  regenerate.
- **Not built here:** the web review UI for sections and their restore (lanes 3c/5b), the
  extractor's own section tree, fuzzy inheritance. The README row for 0340 is owed in a
  later PR. Founder-gated and not done: the G0 production read, the L8 eval and every flag
  flip.

## Founder forks

Filed as OD-228 (OPEN-DECISIONS.md:327) and OD-229 (OPEN-DECISIONS.md:328), marked decided under delegation and open to his veto.

1. **Two pours of one wine at two prices** (e.g. a 75 ml dessert pour on Desserts and a
   150 ml glass on Drinks): recommended — v1 treats it as a conflict and the owner picks
   (S198); later a pour becomes a derived item of the bottle with its own price, using the
   S203 derived-item shape.
2. **Staff reading prices on the Full menu** once MENU-02 lands: recommended — the Full
   menu follows MENU-02 exactly (same allowlist), with no Full-menu-specific rule.


**Founder forks — decided by the coordinator under the founder's 2026-10-07T20:04:10Z delegation ("Do not ask me questions"), 2026-10-12:** both forks take the recommended option (1: two pours at two prices = a conflict the owner picks in v1, later derived items per S203; 2: Full menu follows MENU-02's staff allowlist exactly). Basis: both are the industry-standard default and follow S198/S203; rejected: per-pour prices as separate lines now (pre-empts the S203 shape), a Full-menu-specific staff rule (two rules for one read).
