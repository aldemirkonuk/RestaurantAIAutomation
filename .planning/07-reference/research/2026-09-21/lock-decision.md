# Price lock: the decision (ADR 0193 open question 1, founder round 6c)

The founder delegated this on 2026-09-21. His words, verbatim: *"add a section to that where you can lock price,
but wha f that menu item disappears? so think verify validate your decision and build"*. That means the
decision is ours, on condition that it is researched, adversarially validated and then built. This file is
the decision. It is not the build.

**Inputs read in full:** ADR 0193 in `wt-r5-cellar` @ `703c47a0a`; the round-2 last-call report
(`land/r2/cellar-lastcall.md`); `land/c3/lock-sota.md` (13 products); `land/c3/lock-cases.md` (12 cases).
**Code read and cited** at `703c47a0a`:
- `set_house_menu_price` and the version trigger (`20260921113200`)
- `make_menu_current` (`20260921115100`)
- `menus.service.ts` (`makeCurrent`, `addToInventory`, `carryMenuPrice`, `namesOf`)
- `house-menu-price.ts`, `margin-advice.service.ts` (`accept`)
- `MenuVersions.tsx`
- `merge_library_wines` (latest: `20260902180000`)
- the baseline FKs

**Method:** I drafted a design (v1, §4), attacked it case by case in a separate adversarial pass (§4),
and revised it into the rules in §2.

**Honest limits (§0.5):**
- The adversarial pass was run by this same agent as a distinct step. It was not run by an independent
  agent: this subagent has no agent or workflow tool to fan out with.
- No code, PGlite probe, spec or browser was run. Every "Test:" line below says how a rule is to be
  proven in the build. None of them is a result.

---

## 1. The decision in one paragraph

A lock is a per-house, per-kind (bottle or glass) hold on the price the house charges now. While it is
open, nothing can change that price: not a menu (new, or an older one chosen again), not a menu line
correction, not a manager's edit, not accepted advice, not a direct SQL write. The one exception is an
explicit "change and keep locked" by an owner or manager. Locks are set and released only by the house's
owners and managers. Every act is kept on the record, and no lock is ever deleted by the product.

Choosing a menu, new or old, sets every unlocked price it states, dated by the moment of the choice. The
"section" the founder asked for is the plan shown before the choice. It lists each price the menu would
change and offers "Keep" (lock) on each one. It also lists every lock whose wine is not on that menu.

A locked wine that leaves the menu keeps its lock, dormant. It is listed as "locked, not on the current
menu" and is applied again if the wine comes back with the same identity (the same library wine). A
rename or a new vintage is a different wine, unless a manager moves the lock to it. Advice still shows
for a locked price but cannot be accepted. Staleness is shown as facts, never on a timer.

---

## 2. Final rules (each testable)

"PGlite" means an assertion in a `p4-scratch/pglite-probe` script built on all migrations. "jest" and
"vitest" mean specs in the gateway and the web.

### Shape
- **L1. One open lock per house wine row and per kind.** A lock is a row in a new table `house_price_locks`
  with these columns:
  - `restaurant_id` and `inventory_id`
  - `kind`: `bottle` or `glass`
  - `locked_price`, `locked_by` (FK `public.users`, RESTRICT), `locked_at`, and an optional `note`
  - `released_by`, `released_at` and `release_note`
  - `moved_from_lock_id`

  A partial UNIQUE on `(inventory_id, kind) WHERE released_at IS NULL` enforces one open lock. The bottle
  and glass locks are independent (lock-cases 3c).
  *Test:* PGlite. A second open lock on the same kind raises 23505. A bottle lock leaves a glass write free.
- **L2. A lock holds a price that exists.** Setting a lock records the house's price for that kind at that
  moment as `locked_price`. Locking a kind that has no price is refused (409 `nothing_to_lock`). A kind
  that was never priced therefore cannot be "held". It is flagged instead (round 6c answer 4).
  *Test:* PGlite and jest.
- **L3. Invariant.** While a lock is open, the house price for its kind equals `locked_price`.
  *Test:* PGlite asserts it after every scenario in the probe.

### What a lock holds against
- **L4. Every writer of that kind is held.** This covers:
  - a menu made current, whether a new read or an older menu chosen again;
  - a priced line added to, or corrected on, the current menu;
  - the "Your price" edit;
  - the add-wine price paths;
  - accepting advice.

  `set_house_menu_price` reads the open locks under its existing `FOR UPDATE` and writes nothing for a
  held kind. A new BEFORE UPDATE trigger on `restaurant_inventory` refuses a value change to a locked
  column from any other writer, with an error naming the lock.
  *Test:* PGlite. Each change source against a locked kind produces no change and no version row. A plain
  `UPDATE` raises.
- **L5. Outcomes are per kind.** Take a write that names both bottle and glass when only the bottle is
  locked. It writes the glass price and reports `bottle: locked, glass: changed`. No line summary may say
  `changed` without naming a kind that was held. `house-menu-price.ts` must learn the new outcomes, and an
  outcome it does not know must still throw (`:115`).
  *Test:* PGlite and jest.
- **L6. Changing a locked price is one explicit act.** "Change and keep locked" is for owners and managers.
  In one transaction it releases the open lock, writes the new price as `manual` by that person, and opens
  a new lock. Both lock rows and one version row are kept. The caller names the open lock it saw. If a
  different lock is now open, the answer is 409 and nothing changes.
  *Test:* PGlite atomicity, and a 409 on a lock id that is not current.
- **L7. Advice cannot be accepted on a locked kind.** `accept` checks the lock before any write, so no price
  changes and no `pricing_analyses` row is written. It answers 409 naming who locked the price and when.
  If a lock lands between that check and the write (`margin-advice.service.ts:313` inserts the analysis
  row before `:356` writes the price), the SQL answers `locked` and `accept` answers 409. The analysis row
  then stays unapplied, with no version row pointing at it. That is what `stale` already does today.
  *Test:* jest for the pre-check, PGlite for the race outcome.

### Who, and the record
- **L8. Owners and managers only.** Setting, changing, moving and releasing a lock go through the same
  `assertCanManageRestaurant` gate as a price edit. The role is evaluated at the time of the act. Staff get
  403 before any write. Staff see lock status read-only wherever they see the price.
  *Test:* controller specs, plus a static CLAIMS row that the lock routes call the gate.
- **L9. The lock table is its own audit, and it is append-only.** On an open lock, only `released_*` may be
  written, and only once. `inventory_id`, `kind`, `locked_price`, `locked_by` and `locked_at` never change
  while the lock is open. No gateway path deletes a lock row.
  *Test:* PGlite: the UPDATE is refused. CLAIMS: no `.from("house_price_locks").delete(` anywhere in `apps/`.
- **L10. A lock outlives its author.** It stays binding whether or not the person who set it still has
  access. Any current owner or manager can release it. The name stays resolvable through the RESTRICT FK,
  the same pattern as `menu_price_versions.changed_by`.
  *Test:* PGlite. Deactivate the author's access: the lock still holds, and a second manager releases it.

### Choosing a menu (the re-pick answer)
- **L11. A chosen menu sets its prices from the moment of the choice.** Making a menu current applies to a
  new read and to an older menu chosen again alike. It writes every linked line's stated kinds except
  locked kinds, each:
  - dated by the menu's `made_current_at`, which `make_menu_current` returns;
  - with `change_source = import` and `changed_by` = the person who chose;
  - with the menu's id on the version row (new nullable `menu_price_versions.menu_id`).

  This replaces "dated by the line" (`menus.service.ts:1320`) and flips the spec that pins it
  (`menus.service.spec.ts:740`).
  *Test:* PGlite and jest. Re-picking menu A over menu C brings A's unlocked prices back with
  `effective_from = made_current_at`.
- **L12. Silence changes nothing.** A wine that is not on the chosen menu keeps its price, locked or not. A
  kind that a line leaves blank keeps its price and is flagged (answer 3, and round 6c answer 4 for a
  never-priced blank). *Test:* PGlite and jest.
- **L13. The section: a plan before the choice.** Before an owner or manager confirms, the page shows, per
  line and per kind:
  - the house price and the menu price;
  - the planned result: `change`, `unchanged`, `held by lock`, `blank kept`, `blank, never priced`,
    `not linked` or `new wine`;
  - for a price that would be replaced, who set it and when;
  - a **Keep** toggle, which sets a lock (L2) there and then and refreshes the plan.

  The plan also lists every open lock whose wine is not on this menu. It carries a fingerprint.
  `POST make-current` requires that fingerprint. It recomputes the plan before the switch and refuses with
  409 (nothing changed) if the two differ. The onboarding path goes through the same plan.
  *Test:* jest (400 without a fingerprint, 409 on a mismatch, no write in either case), and vitest (the
  section renders held and dormant rows).
- **L14. A person's later price wins a race.** If a person writes a price after `made_current_at` but
  before that wine's line is carried, the line comes out `stale` and is reported. The carry is dated by the
  choice, and the newest dated change wins (Decision 3, unchanged).
  *Test:* PGlite. Write a manual price with `effective_from > made_current_at`, then carry: the result is
  `stale`.
- **L15. Nothing is dropped from a sentence.** The make-current result and every page sentence give the
  held kinds as a count and name each returned lock (L18). A sentence prints every outcome it receives,
  and an unknown one generically. Today `makeCurrentSentence` only knows fixed keys
  (`MenuVersions.tsx:74-83`), so a `locked` count would vanish.
  *Test:* vitest with a `locked` key and an unknown key.

### When the item disappears, and when it comes back
- **L16. Only a person ends a lock.** A wine leaving the menu, being removed from inventory
  (`is_active = false`) or time passing does not end it. Only a person's release does, or the deletion of
  the house.
  *Test:* PGlite. A menu without the wine, then a soft delete: the lock is still open, and the price is
  unchanged.
- **L17. "Locked, not on the current menu."** An open lock goes in this group on /menu's **Locked prices**
  section and in `GET /pricing/locks` when its wine (`master_wine_id`) has no line on the house's current
  menu. With no current menu, every lock goes in the group. This list never filters `is_active`. The
  advice list does (`margin-advice.service.ts:148`), which is why the lock list is not built on top of it.
  A removed wine is marked.
  *Test:* jest, with a locked wine that is off the menu and inactive and still listed.
- **L18. Coming back with the same identity.** Suppose a chosen menu has a line whose `wine_library_id`
  equals the locked row's `master_wine_id`. Then:
  - the lock holds again (L4);
  - the line is reported `returned` if the menu being replaced had no line for that wine;
  - the plan shows the line as read (name, producer, vintage) beside the locked wine's stored name and
    vintage;
  - it marks `vintage_mismatch` when both vintages are years and they differ.

  The lock still holds in the mismatch case. The mark is there so a person sees a wrong link.
  *Test:* PGlite and jest.
- **L19. A different identity is a different wine.** A renamed or re-vintaged line can resolve to another
  `master_wine_id`. It then gets its own row: unlocked, and priced by the menu. The old lock stays dormant.
  No fuzzy or automatic carry happens.
  *Test:* PGlite. A 2020 line next to a locked 2019 row leaves the 2019 lock dormant and the 2020 row free.
- **L20. Linking is a person's act: "move lock".** An owner or manager does it in one transaction:
  - it releases the dormant lock, with a note naming the target wine;
  - it locks the target wine's kind at a price that the request names explicitly (there is no server
    default), and writes that price as `manual` by the mover;
  - it sets `moved_from_lock_id`.

  *Test:* jest (400 without a price), PGlite (atomicity).
- **L21. Library merges and deletes cannot move or erase a lock quietly.**
  - Merge: `merge_library_wines` repoints every FK to `restaurant_inventory` generically
    (`20260902180000`, loop 1). Because an open lock's `inventory_id` is immutable (L9), a merge that
    would move an open lock aborts, with a message naming the house and the lock. That matches loop 1's
    own "aborting is the safe direction" (`:83-86`). A released lock's history follows its wine.
  - Delete: `house_price_locks.inventory_id` is `ON DELETE NO ACTION` and `restaurant_id` is
    `ON DELETE CASCADE`. So deleting a house still works, because both cascades resolve within one
    statement. But deleting a library row that cascades to a locked wine
    (`restaurant_inventory_master_wine_id_fkey` CASCADE) is refused.

  *Test:* PGlite fixtures. The merge aborts on an open lock and passes on a released one. Deleting the
  house succeeds. Deleting the library row of a locked wine is refused.

### Advice and staleness
- **L22. Advice shows a locked price but cannot move it.** Advice is still computed for a locked kind and
  shows its state, marked with `locked: {by, at}`. The kind is left out of `margin_to_target`'s list of
  actions and counted in a new feed entry, `price_locks_to_review`. The information is regrouped, not
  hidden. *Test:* jest.
- **L23. Staleness is shown as facts, with no timer.** Every open lock shows its age in days and these
  markers, computed at read time:
  - `off_target`: the advice says raise or lower. For a glass, the per-wine pour is used once it is
    confirmed, otherwise the house pour (round 6c answer 3).
  - `advice_unknown`: no target, no cost, or an unconfirmed pour, with the reason.
  - `author_without_access`
  - `not_on_current_menu` or `no_current_menu`
  - `wine_removed`
  - `menu_differs`: the current menu's line reads another price.

  `price_locks_to_review` counts the locks that carry `off_target`, `author_without_access`,
  `not_on_current_menu` or `wine_removed`. Nothing expires or releases automatically.
  *Test:* jest, one fixture per marker.
- **L24. Releasing never changes a price.** When the current menu's price for that kind differs, the answer
  says so, for example: "the current menu reads 110.00; the house price stays 95.00 until a menu is chosen
  or a manager changes it". *Test:* PGlite (no version row on release) and jest (the sentence).

### Reads fail closed, one house only, serialised
- **L25. An unread lock is never "no lock".**
  - A failed read in `GET /pricing/locks` answers `readable: false` with the reason, never an empty list.
  - A failed read in the plan (L13) is a 5xx, so make-current cannot go ahead.
  - Advice marks the lock status unreadable, and `accept` refuses.
  - The lock list's read of the people behind each lock binds its error (`namesReadable: false` plus the
    reason). `namesOf` does not do this today (`menus.service.ts:927`).

  *Test:* jest, one failing read per surface.
- **L26. One house only.** A lock at house A has no effect on the same wine at house B, and every lock
  surface says "at this house". *Test:* PGlite with two houses.
- **L27. Locks and price writes are serialised.** Lock, change-and-keep, move, release and
  `set_house_menu_price` all take the wine row `FOR UPDATE`. *Test:* a static CLAIMS row per function.
  PGlite runs on one connection and cannot race, so this is verified by reading, and the build must say so.

---

## 3. Rejected alternatives

| Alternative | Why rejected |
|---|---|
| Keep dating the carry by the scan (as built) | Re-picking an older menu brings back nothing that changed since (`stale`), which defeats the point of a lock. It also backdates history: the trigger closes the previous version at the scan time (`20260921113200:103`, fed by `menus.service.ts:1320`), so "the price on day X" is wrong between the read and the choice. |
| Date by the choice only for a menu that was current before; keep scan dating for a first choice | Killed by the adversary (K2). A draft read before a re-pick and chosen after it is refused as `stale`: the newest scan loses to an older one. |
| Date by the choice only when the chosen menu's scan is older than the current menu's | Killed (K2). Current C, re-pick A, then C again: the second C is scan-dated behind A's choice, so C cannot come back. |
| A price a person typed after a menu was read stays automatically ("implicit stickiness", as in Dynamics) | A hold nobody set and nobody sees, and it depends on time. It leaves two ways of keeping a price where one explicit lock does the job. It also stops most of an older menu's prices coming back, which is the opposite of what the founder described. |
| A price per menu (Toast's pattern: each menu keeps its own price, and the house points at one) | It rebuilds pricing. Every margin, valuation and POS reader uses the one column `menu_price_current` (ADR 0193, Decision 1). |
| One lock flag per wine row | It cannot express "bottle locked, glass free" (lock-cases 3c). |
| Lock columns on `restaurant_inventory` | A release erases who locked it and when unless that is audited somewhere else. No history, and no link from a moved lock. |
| A lock held only against the menu, with manual edits and accepted advice passing through | One Accept tap silently ends the lock's protection (K1, lock-cases 5). |
| Hiding advice for a locked price | It hides a true margin. A pour or cost change would erode a locked glass price with no signal (lock-cases 8 and 12). |
| Automatic expiry after N days, or a "lock until" date | N would be a number nobody chose (ADR 0020). An expiry also exposes the price to the next menu without anyone acting. A timed lock was not asked for. It is recorded as a later option. |
| Deleting or releasing a lock when its wine leaves the menu | That leaves the returning wine unprotected, which is exactly the founder's question. It also destroys history (Shopify's variant-delete failure, lock-sota §3). |
| Carrying a lock to a similar wine automatically (name or vintage match, or an embedding) | It links the wrong wine: a 2020 would be priced by a 2019 lock nobody re-checked. R365's "Missing Items" pattern is human re-linking only. |
| Releasing a lock put the current menu's price back | That is a price change nobody made. |
| Letting a library merge release or carry a lock | A lock would end, or change its number, through a platform act nobody at the house took. Aborting matches merge loop 1's own rule. |
| A trigger that refuses every DELETE on the lock table | It would block deleting a house, which the founder has ordered before (the demo house). NO ACTION on the wine plus CASCADE on the house gets the protection without that cost. |
| A cross-house "lock at all my houses" | Not asked. Every key in this lane is per house. Recorded as a later option. |
| "Apply the current menu's prices again" (re-choosing the current menu) | It changes the `already_current` behaviour that the round-2 last call relied on (Attack A), and nothing asked for it. After a release, the difference is stated (L24). |

---

## 4. Draft v1, and what the adversary killed

Draft v1:
- lock columns on `restaurant_inventory`, per kind;
- a lock that holds only against `import`, so manual edits and accepted advice go through;
- choice-dating for a re-pick only, and scan-dating for a first choice;
- "locked N days ago" as the only staleness signal;
- release left unspecified;
- the lock list built from the advice list;
- the rest of the recommended candidate: kept dormant, never deleted, applied again by identity, a rename
  is a different wine unless linked.

| # | Attack (case / threat) | Result | Now |
|---|---|---|---|
| K1 | Silent price change: Accept on a locked kind (case 5) | **Killed** the import-only hold | L4, L7 |
| K2 | Silent price change: the dating rules (case 2). Draft D read Mar 20; A re-picked Apr 1; D chosen Apr 15. D is scan-dated behind A's choice and refused as stale, so the newest scan loses. The variant "older by scan" fails on C, then A, then C again | **Killed** mixed dating | L11, L14 |
| K3 | Record integrity: scan-dating closes the previous price's version at the scan time, before it really ended (`:103` with `:1320`) | **Killed** scan-dating (a finding in the built code) | L11 |
| K4 | A lock outlives its author (case 6): the columns lose who and when on release | **Killed** the columns | L1, L9, L10 |
| K5 | A lock nobody can see (cases 3a, 11): a list built on advice drops `is_active = false` wines (`margin-advice.service.ts:148`) | **Killed** the derived list | L17 |
| K6 | Silent price change: release unspecified, and the tempting "release restores the menu price" | **Killed** | L24 |
| K7 | A lock nobody can see (case 12): age alone never says whether a lock is still right | **Killed** age-only staleness | L23 |
| K8 | A lock nobody can see: `makeCurrentSentence` drops unknown keys (`MenuVersions.tsx:74-83`) | **Killed** "just add an outcome" | L15 |
| K9 | Loud but wrong: the TS wrapper throws on an unknown outcome (`house-menu-price.ts:115`), so every held line would read `failed` | **Revised** | L5 |
| K10 | Silent price change: a writer that bypasses `set_house_menu_price` (the trigger only records "no person named") | **Revised**: a BEFORE trigger | L4 |
| K11 | Silent price change: an old client or onboarding makes a menu current without seeing the plan, or the plan is out of date | **Revised**: fingerprint required | L13 |
| K12 | Identity links the wrong wine (case 4): the matcher links a returning line with no vintage to the locked 2019 row | **Revised**: `returned` plus a side-by-side view plus `vintage_mismatch`, and still no automatic re-link | L18, L19 |
| K13 | A lock on an empty price holds nothing, and would block a menu from adding a glass price | **Revised** | L2 |
| K14 | A lock nobody can see: a library merge's generic repoint moves an open lock onto a row with another price, or its delete cascade erases it | **Revised** | L21 |
| K15 | A lock nobody can see: `namesOf` fails open, so "locked by" is blank with no reason (`menus.service.ts:927`) | **Revised** | L25 |
| K16 | Record integrity: the `pricing_analyses` row is written before the price, so a lock landing in between leaves an unapplied row | **Revised**: a pre-check, and the race named | L7 |

**What survived the attacks:**
- the per-kind scope (case 3c);
- per-house by construction (case 9);
- a failed menu read writes nothing, so it touches no lock (case 10);
- the owner/manager tier. Staff already have no path to a price (case 7); L8 tests it anyway, for the lock
  routes;
- dormant and never deleted, applied again by identity, and a rename is a different wine unless moved
  (cases 3a, 3b, 4);
- a glass lock holds a number, not a margin, and a pour change surfaces as `off_target` (case 8).

---

## 5. Findings outside the lock (for the ADR and the register, not decided here)

- **F-a.** In the built code, scan-dating backdates price history. See K3. L11 fixes it.
- **F-b.** `make_menu_current` overwrites `made_current_at`/`_by` and clears `retired_*` on a re-pick
  (`20260921115100:267-269`), so the menu row loses its earlier period as current. With L11, the version
  rows record which menu set each price, per wine, through `menu_id`. A log of when each menu was current
  is recommended, but it is not a lock rule.
- **F-c.** The stale check is per wine, not per kind: the open version row carries both prices
  (`20260921113200:199-208`). So a later glass edit makes the bottle price on a line stale. Under L11 only
  a race can reach this.
- **F-d.** `merge_library_wines` loop 1 aborts on 23505 when both of a house's rows have an open price
  version (`idx_menu_price_versions_one_open`). ADR 0193's trigger now writes versions for every priced
  wine, so this is reachable. It predates the lock and was not measured against production.
- **F-e.** A library-row delete cascades a house's wine and its whole price history
  (`restaurant_inventory_master_wine_id_fkey` CASCADE, baseline `:13334`). L21 blocks this only for a
  locked wine.

## 6. Build notes (sizing, not rules)

- **Migration:**
  - the `house_price_locks` table, its partial UNIQUE and FKs, RLS on with no policy, and the append-only
    trigger;
  - the BEFORE UPDATE guard on `restaurant_inventory`;
  - the functions `lock_house_menu_price`, `change_locked_house_menu_price`, `move_house_price_lock` and
    `release_house_price_lock`, all invoker-rights and granted to `service_role` only;
  - `set_house_menu_price` with a lock read, per-kind outcomes and `p_menu_id`;
  - `menu_price_versions.menu_id` (nullable, `ON DELETE SET NULL`);
  - `make_menu_current` returning `made_current_at`.
- **Gateway:**
  - `GET /pricing/locks`, plus POST routes to lock, change and keep, move and release;
  - `GET /menu-versions/:menuId/plan`, and `make-current` taking a fingerprint;
  - the carry dated by the choice, the accept pre-check, the lock field on advice, and the
    `price_locks_to_review` feed entry.
- **Web:**
  - /menu's **Locked prices** section, with its dormant group;
  - the plan section with Keep toggles, in the make-current step on /menu and in onboarding;
  - the lock mark on /inventory's "Your price";
  - `makeCurrentSentence` printing every outcome it receives.
- **CLAIMS (static):**
  - the carry no longer passes `item.created_at`;
  - the lock routes call `assertCanManageRestaurant`;
  - no gateway delete on `house_price_locks`;
  - `set_house_menu_price` reads `house_price_locks`;
  - each lock function takes the row lock.

## 7. For the founder (the one fork that changes an earlier answer)

L11 makes a chosen menu set its prices from the moment of the choice. For an older menu chosen again,
that is the question you delegated. It also changes one case under your answer 7 ("newest scan wins"):
**a price someone typed after a menu was read, but before it was chosen.**

- **As built**, that typed price stays automatically.
- **Under L11**, the chosen menu's price replaces it. The plan section lists it first, with who typed it
  and when, and one tap on Keep locks it.

The other path keeps typed-after-read prices automatically. That brings back a hold nobody set explicitly,
and it stops an older menu's prices coming back for every wine that someone edited since it was read.

**Recommendation:** L11. One rule ("the menu you choose sets its prices, except what you lock"), and
nothing is held that you cannot see.


## Founder, 2026-09-21 (after this decision)
L11 confirmed verbatim: "The menu sets it, locks keep" (the recommended road: the menu you choose sets its prices, except what you lock; a typed-after-read price is listed first in the plan with who typed it and when, with a Keep toggle).
