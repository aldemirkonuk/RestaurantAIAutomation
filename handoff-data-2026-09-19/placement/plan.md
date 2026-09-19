# Placement plan -- v3.0-TECH-DEBT.md retirement, 230 items

Generated 2026-09-19; **fixed 2026-09-19 against `r4-placement.json` (ok=false)**, then **fixed again 2026-09-19 against a second independent-verifier NOT-READY pass** -- see `FIXLOG` and `FIXLOG ROUND 2` below and `citation_rewrites.md` for the full citation ledger. Originally verified against `/Users/aldemirkonuk/Projects/wt-review @ 804a1bdb5 (train/finish-2, detached at main cb756083e + the train)`. Source: the founder's 230-item triaged export (`export.json`) plus the 8 parallel batch agents' placements, consolidated, deduplicated, polarity-checked, structure-critiqued, fixed against a second (r4) critic pass, and now fixed again against a second independent-verifier pass over that fix. **The plan is not executed by this pass -- scratch only.**

**Totals:** 230/230 items placed exactly once. Marks: 100 remove, 78 work, 30 decide, 22 move (all 11 founder decide->work flips honored as WORK).

## FIXLOG -- what this pass changed, against r4-placement.json's issues


1. **Citation coverage (issue 4).** citation_rewrites.md classifies all 354 fresh git-grep hits across 9 tiers. 64 of the 230 plan items carry >=1 citations_to_rewrite entry (112 array-entries total, re-measured 2026-09-19 against the live file, not copied forward). 38 of those items hold one 'Citation sweep (2026-09-19...)' entry each (36 from the original classification pass + 2 more added fixing this round's independent-verifier findings: offline-storage-swallow, orders-wire-item2-recurrence), bundling 128 individual file:line references in total across those 38 strings (no cross-item de-dup -- a source line can legitimately support more than one item). The remaining 26 items carry 74 pre-existing, non-sweep-style entries from earlier (pre-citelib) passes. This replaces the field's earlier phrasing ('110 new item-level citations added across 36 items, on top of the original 74/41') which the independent verifier flagged as ambiguous (LOW) between an array-entry count and a distinct-file:line count -- and whose '41' item-count does not reproduce against the live file (26 is the correct figure, checked by the same script as everything else in this field). Full ledger: `citation_rewrites.md` (all 353
   fresh `git grep` hits from `wt-retire-debt@9c6bdc0be`, classified and given a rewrite rule each, plus 1
   out-of-band note for ADR 0159 which lives only on an unmerged lane). Two concrete citation-drift bugs found
   and fully resolved along the way (the iCal cluster, 19 files; `cellar-format.ts`'s market-price mis-citation).
2. **False/unflippable CLAIMS rows (issues 1-3).** DEBT-CI-PYTHON-LINT-SCOPE-GAP (was false CI-ESLINT-NOT-WIRED); DEBT-2866.D3 (verify rewritten); DEBT-2825.A3 (verify rewritten); DEBT-REPORTINGAGENT-STOCK-EVENTS-INTENTIONAL (new, resolved, pins test_event_topology.py:76-80 for 44.2b).
   All four mutation-tested in a fresh `git archive` mirror of `wt-retire-debt@9c6bdc0be` (baseline holds, a
   realistic fix flips it, restore is clean) -- see `citelib/` in this folder for the exact mirror commands.
3. **Dropped:** atlas-backbone-missed-M2 / MOBILE-TSC-TYPES-JEST-MISSING (not a repo defect -- local install-state only).
4. **Retirement record (issue 5).** points at EXISTING ADR 0166 (docs/retire-tech-debt@9c6bdc0be) -- no new ADR created. See the `retirement_record` block in
   `plan.json` and the CLAUDE.md:124/130 exact rewrites in `citation_rewrites.md`.
5. **44.2b (issue 6).** Given a `resolved` CLAIMS row (`DEBT-REPORTINGAGENT-STOCK-EVENTS-INTENTIONAL`) pinning
   `test_event_topology.py:76-80`, replacing the earlier bare "flagged drop."
6. **OD recommendations (issue 7).** Added to: adr0141-fk-no-tenant-tie, google-signin-open-question, modules-F3.
7. **CLAIMS id scheme (issue 8).** 29 renamed from TD-2026-09-19-*/ad-hoc to DEBT-<slug> or ADR-0105-<slug> (1 genuinely ADR-owned); all 60 claims-row ids now ADR-NNNN-<slug> or DEBT-<slug>, zero other schemes.
8. **Paperwork, not CLAIMS rows (issue 9).** Converted to a new `doc-correction` home kind (direct text edit in
   the execution PR, not a self-verifying row): modules-F1, modules-F2, modules-F9, modules-missed-M1, modules-missed-M3.
9. **OD-NEW placeholders (issue 10 area).** Re-verified: all 14 primary new OD rows carry the `OD-NEW`
   placeholder; the other 12 `od-row` keys are cluster members whose content lives in their primary row
   (`home_section` says which) -- this was already correct and needed no change.
10. **Sequencing/ambiguity (issue 10 tail, problems_left).** 3007.5 / PR #394 sequencing and the ADR-0104:694 nine-findings double-count question are genuinely open forks, not silently resolved -- returned as founder questions in the session report per house rules, not decided in this plan.
11. **Mutation testing (house rules).** Every CLAIMS verify touched in this pass was mutation-tested in a
    `git archive` mirror (never the checkout) -- baseline, realistic-fix flip, restore-clean, for all four
    rewritten/added verifies. The 29 id-only renames did not touch verify logic, so were not re-mutation-tested
    (nothing about their pass/fail behavior changed).

## FIXLOG ROUND 2 -- against a second independent-verifier NOT-READY pass


**HIGH finding: citation-coverage claim was false for 4 critic-named targets (11 references).** Each
checked by direct read on `wt-retire-debt@9c6bdc0be` and moved out of `GENERIC-DOSSIER-UNVERIFIED`
into the correct tier in `citation_rewrites.md` (154 -> 143; EXPLICIT 48->55, MANUAL 43->47):


1. **Finding (a)** (.planning/decisions/0141-a-stock-write-names-the-house-it-is-for.md:114; .planning/decisions/0141-a-stock-write-names-the-house-it-is-for.md:182) -> `adr0141-null-restaurant-id-deferred (existing ADR-0141 CLAIMS row)`. Both lines restate the identical gap the existing citation (supabase/migrations/20260912163000_...sql:55) already resolves to: services/agent-orchestrator/core/database.py:1077's update_stock cannot name a restaurant. Read directly on wt-retire-debt@9c6bdc0be.

2. **Finding (b)** (.planning/decisions/0162-managers-grant-manager-or-staff-on-both-doors.md:115) -> `44.1i (ADR-0162-USERS-ROW-FALLBACK-RETIRED, existing CLAIMS row)`. Line 115 is the header 'Still open, filed rather than fixed here (v3.0-TECH-DEBT.md):' and line 116, the very next line, spells out '44.1i.' verbatim -- git grep is line-scoped and missed the wrap, the exact same failure mode already documented and correctly handled elsewhere in citation_rewrites.md for team.service.ts:453 -> 44.1n. Confirmed with awk on wt-retire-debt@9c6bdc0be.

3. **Finding (c)** (apps/web/src/lib/doorOutbox.ts:71) -> `offline-storage-swallow (new CLAIMS row ADR-0140-STORAGE-SWALLOW, this plan)`. The comment quotes the register section title verbatim -- 'v3.0-TECH-DEBT.md, "The offline queue reports a write it swallowed as a write that succeeded"' -- and names localStoragePut / idbGetAll, the exact two functions offline-storage-swallow's own verify checks.

4. **Finding (d)** (.planning/decisions/0125-an-order-changes-state-through-a-sealed-transition.md:568; apps/api-gateway/src/procurement/dto/procurement.dto.ts:1077; apps/api-gateway/src/procurement/order-recurrence.service.spec.ts:19; apps/api-gateway/src/procurement/order-recurrence.ts:12; apps/web/src/pages/orders/next/Recurrence.test.tsx:18; apps/web/src/pages/orders/next/recurrence.ts:11; apps/web/src/services/api/types.ts:367) -> `orders-wire-item2-recurrence (mark=remove; citations_to_rewrite was [], now 7 refs)`. All 7 read directly on wt-retire-debt@9c6bdc0be; every one quotes '.planning/v3.0-TECH-DEBT.md "The orders wire" item 2' by name and describes the identical fixed defect (useOrdersNextData.toRow set recurring=false unconditionally). None mentions the separate, still-open legacy-page half (orders-wire-item2b-legacy-not-migrated / Orders.tsx / mapApiOrderToUi), so the two were not conflated. A closely-named 8th citation, order-recurrence.service.ts:22, was individually checked and found to cite a DIFFERENT, still-open defect (an auto_approve schedule with no seal/threshold check) -- left untouched in GENERIC-DOSSIER-UNVERIFIED, not swept in by proximity.


**LOW finding: the citation_ledger figure was ambiguous, and on re-measurement also partly wrong.**
citation_ledger field rewritten with numbers re-measured live against plan.json by script, not copied forward; also caught and disclosed a second, previously-undetected defect in the same field while fixing the ambiguity: the old text's '41' pre-existing-item count does not reproduce (the real figure is 26). Current, re-measured text: citation_rewrites.md classifies all 354 fresh git-grep hits across 9 tiers. 64 of the 230 plan items carry >=1 citations_to_rewrite entry (112 array-entries total, re-measured 2026-09-19 against the live file, not copied forward). 38 of those items hold one 'Citation sweep (2026-09-19...)' entry each (36 from the original classification pass + 2 more added fixing this round's independent-verifier findings: offline-storage-swallow, orders-wire-item2-recurrence), bundling 128 individual file:line references in total across those 38 strings (no cross-item de-dup -- a source line can legitimately support more than one item). The remaining 26 items carry 74 pre-existing, non-sweep-style entries from earlier (pre-citelib) passes. This replaces the field's earlier phrasing ('110 new item-level citations added across 36 items, on top of the original 74/41') which the independent verifier flagged as ambiguous (LOW) between an array-entry count and a distinct-file:line count -- and whose '41' item-count does not reproduce against the live file (26 is the correct figure, checked by the same script as everything else in this field).

**Not touched this round:** No CLAIMS.jsonl verify command's logic was changed this pass -- this round is citation-coverage and ledger-wording only. All 60 claims-row verifies re-run at the end of this pass, unchanged result from the R4-FIX pass (0 stderr, 0 polarity mismatches).


---

**Consolidations made by the original r4 pass (still valid, unchanged by this fix pass):**
- 4 clusters of low-stakes DECIDE findings folded into single OD-NEW rows with lettered sub-options: atlas/codebase-audit follow-ups (9 keys -> 1 row), agent-stack audit follow-ups (3 keys -> 1 row), two procurement/recurring cron findings (2 keys -> 1 row), two ADR-0159 residual-acceptance questions (2 keys -> 1 row).
- 2 DECIDE items merged into an EXISTING OPEN-DECISIONS row instead of a new one: `gitignore-duplicate-files` -> OD-60, `modules-F4` -> OD-23.
- 2 DECIDE items resolved as already-decided-elsewhere, so no new artifact at all: `44.1f` and `atlas-backbone-F4` both point at existing CLAIMS rows (ADR 0162's addendum and ADR 0103 D5 respectively already answered the underlying fork).
- 1 cross-batch CLAIMS duplicate merged: `44.1f`'s own drafted row was dropped in favor of `44.1r`'s broader row, which already covers the same switchRestaurant code.
- 17 of the original drafted CLAIMS rows had their `verify` command's exit-code polarity corrected before this fix pass began (confirmed against 8 sampled existing CLAIMS.jsonl rows' actual behavior). This fix pass (2026-09-19, against r4-placement.json) additionally rewrote 2 more verifies whose ANCHOR (not polarity) was wrong -- see FIXLOG above.


## `.planning/decisions/CLAIMS.jsonl`  (65 items)

### 1. `1602` -- WORK / claims-row
**Section:** flat JSONL, append as new line

```
{"id": "DEBT-WEB-PRETTIER-GAP", "status": "open", "claim": "apps/web is still outside Prettier: its .eslintrc.cjs override for apps/web/**/*.{ts,tsx} has no 'prettier' extends/plugin (unlike apps/api-gateway's override, which has both), and apps/web/package.json has no format script. Deliberately not fixed 2026-08-27 pending a pick between a one-commit whole-tree reformat and an OD-105-style ratchet.", "verify": "python3 -c \"s=open('.eslintrc.cjs').read(); i=s.index('apps/web/**/*.{ts,tsx}'); j=s.index('apps/api-gateway/**/*.ts'); import sys; sys.exit(0 if 'prettier' in s[i:j] else 1)\" && grep -q '\"format\"' apps/web/package.json", "verified": "2026-09-19"}
```

- **Workstream:** web-quality | **Effort:** L
- **Why:** Founder flip decide->work (one of 11). Fully grep-checkable, so CLAIMS not OD; the remediation direction (reformat vs ratchet) is a fix-time choice, not a triage blocker, since the mark is work not decide.
- **Verified today:** Confirmed on wt-review 804a1bdb5 (2026-09-19): .eslintrc.cjs lines 37-40 (web override) carry no 'prettier'; lines 113-115 (api-gateway override) do; apps/web/package.json scripts block has no 'format' key.
- **Duplicates checked:** No hit for 'prettier' in CLAIMS.jsonl/OPEN-DECISIONS.md; no page/software note tracks this.

### 2. `1642` -- WORK / claims-row
**Section:** flat JSONL, append as new line

```
{"id": "DEBT-HOURSHEATMAP-DARK-INVERT", "status": "open", "claim": "HoursHeatmap's ramp still inverts salience on the dark ground: bits.tsx's HEAT_SHADES anchors on near-white #F1F7F8 for the quietest hours, so on Warm Charcoal the quiet cells glow brightest instead of the busy ones. Fix direction: paint over var(--seal) opacity rather than the raw hex ramp.", "verify": "! grep -q \"HEAT_SHADES = \\['#F1F7F8'\" apps/web/src/pages/inventory/command/bits.tsx", "verified": "2026-09-19"}
```

- **Workstream:** web-quality | **Effort:** S
- **Why:** Small, self-contained, purely visual; single grep on an unchanged hex literal.
- **Verified today:** bits.tsx:112 HEAT_SHADES array unchanged since the 2026-08-31 finding; line 132 indexes it by pctile.
- **Duplicates checked:** No existing CLAIMS/OD row; unrelated hits only for BusyHoursHeatmap.tsx (already-fixed fabricated-data finding).

### 3. `1653` -- WORK / claims-row
**Section:** flat JSONL, append as new line

```
{"id": "DEBT-TWINSHEET-LEGACY-PANEL", "status": "open", "claim": "TwinSheet still hosts ProviderIntelligencePanel, the shared legacy grey/blue-skinned component, unre-skinned inside the Iznik sheet (also recorded in providers.md §9). Deliberately not patched with scoped CSS overrides -- the panel needs its own token re-skin.", "verify": "! grep -q '<ProviderIntelligencePanel providerId={provider.id}' apps/web/src/pages/providers/next/TwinSheet.tsx", "verified": "2026-09-19"}
```

- **Workstream:** web-quality | **Effort:** M
- **Why:** providers.md §9 names 'v3.0-TECH-DEBT' by id at two spots that dangle once the register is deleted; both should point at this CLAIMS row instead. Page dossier keeps the narrative; only the checkable fact needs a new home.
- **Verified today:** TwinSheet.tsx:33-35 lazy-imports it, :155 renders it unchanged; providers.md:208-209 independently confirms.
- **Duplicates checked:** Prose already at providers.md:396-399 (§9 gap bullet) and referenced at :191, :208 -- not mechanically checkable there, so this CLAIMS row is additive, not a duplicate.
- **Citations to rewrite:**
  - .planning/06-pages/providers.md:191
  - .planning/06-pages/providers.md:399
  - Citation sweep (2026-09-19, git grep in wt-retire-debt@9c6bdc0be): .planning/07-reference/pr-audits/354-424312e5.md:17 -- rewrite to point at this item's home once the register is deleted.

### 4. `1662` -- WORK / claims-row
**Section:** flat JSONL, append as new line

```
{"id": "DEBT-EMDASH-AT-SILENT", "status": "open", "claim": "The honesty idiom's em dash ('unknown') is still silent to assistive tech: no aria-label=\"unknown\" (or equivalent accessible name) span exists anywhere under apps/web/src. The entry's other half (TwinSheet/TemplateSheet lacking a focus trap) is STALE and NOT carried into this row: components/mudavym/Sheet.tsx (ADR 0112, shipped 2026-09-03) now traps Tab and restores focus on close for both sheets.", "verify": "grep -rq 'aria-label=\"unknown\"' apps/web/src", "verified": "2026-09-19"}
```

- **Workstream:** web-quality | **Effort:** S
- **Why:** Re-checked per the task's explicit re-verify instruction: the batch evidence claimed BOTH halves were open, but Sheet.tsx's focus trap (ADR 0112, 2026-09-03) already closed the second half -- confirmed independently against the live file, not copied from the original entry. Narrowed to the half that is still genuinely open; downgraded effort M->S since only a small aria-label wrapper remains.
- **Verified today:** Re-checked directly on wt-review: grep -rq 'aria-label="unknown"' apps/web/src exits 1 (0 hits), confirming the a11y gap stands. Focus-trap half independently re-verified FIXED: Sheet.tsx has focusables() (:122) and a Tab-trap loop (:850-874, 'if (!modal || e.key !== "Tab") return'); TwinSheet.tsx:27 and apps/web/src/pages/communications/next/TemplateSheet.tsx both import Sheet from components/mudavym/Sheet.
- **Duplicates checked:** No hit in CLAIMS.jsonl/OPEN-DECISIONS.md; other 'em dash' hits are unrelated design-convention docs.

### 5. `1672` -- WORK / claims-row
**Section:** flat JSONL, append as new line

```
{"id": "DEBT-EDITLINE-NOTIF-NO-SPEC", "status": "open", "claim": "document-intake.service.ts's editLine and notifications.service.ts's persistForRestaurant still have no service-level spec exercising their own logic: document-intake.service.spec.ts never calls .editLine(, and apps/api-gateway/src/notifications/notifications.service.spec.ts does not exist -- every caller-side spec mocks persistForRestaurant instead of calling it.", "verify": "python3 -c \"import os; a=os.path.exists('apps/api-gateway/src/notifications/notifications.service.spec.ts'); s=open('apps/api-gateway/src/procurement/documents/document-intake.service.spec.ts').read(); b='.editLine(' in s; import sys; sys.exit(0 if (a and b) else 1)\"", "verified": "2026-09-19"}
```

- **Workstream:** ci-tooling | **Effort:** M
- **Why:** Unifying defect is 'no service-level test' (a testing-discipline gap), a coherent ci-tooling fix lane even though the two paths sit in different softwares.
- **Verified today:** document-intake.service.spec.ts's describe blocks cover only original-bytes persistence, sweepUningestedAttachments, refileMoneyForCurrency, EDI 832 currency -- 0 hits for '.editLine('; notifications.service.spec.ts does not exist; persistForRestaurant is mocked (not exercised) in 3 caller specs.
- **Duplicates checked:** Only unrelated design-spec mentions of onlyUserIds (HOP4-BRIDGE-DESIGN.md, ADR 0109); no existing row.

### 6. `1682.4` -- WORK / claims-row
**Section:** flat JSONL, append as new line

```
{"id": "DEBT-MAXDRAWDOWN-ZERO", "status": "open", "claim": "maxDrawdown is still identically zero by construction and unrendered (defect 4 of 4 in the 1682 finding; 1-3 are separately closed): analytics.service.ts builds levels as a running cumulative sum of demand with no floor or reset, so the series is monotonically non-decreasing and engine/risk.ts's maxDrawdown(levels) can never be nonzero; the field has zero call sites in apps/web or apps/mobile.", "verify": "! python3 -c \"import subprocess,sys; s=open('apps/api-gateway/src/analytics/analytics.service.ts').read(); i=s.find('const levels: number[] = []'); block=s[i:i+220]; ok=('cum += v' in block and 'levels.push(cum)' in block); web=subprocess.run(['grep','-rl','maxDrawdown','apps/web/src','apps/mobile/src'],capture_output=True); sys.exit(0 if (ok and web.returncode==1) else 1)\"", "verified": "2026-09-19"}
```

- **Workstream:** analytics-models | **Effort:** S
- **Why:** Pure analytics engine defect; the other 3 defects from the same finding are already closed, only this residual needs tracking.
- **Verified today:** analytics.service.ts:742-747 (cum+=v; levels.push(cum)) and :784 (maxDrawdown call) unchanged; grep -rl maxDrawdown apps/web/src apps/mobile/src returns 0 files.
- **Duplicates checked:** No hits anywhere in the corpus outside v3.0-TECH-DEBT.md itself.

### 7. `1994` -- WORK / claims-row
**Section:** flat JSONL, append as new line

```
{"id": "DEBT-SPOTCOUNT-DROP-SILENT", "status": "open", "claim": "lib/spotCountOutbox.ts still cannot distinguish a permanently-dropped spot count from a delivered one (the sibling lib/doorOutbox.ts half of this finding is CLOSED, 5ba2972a): watchSpotCountOutbox discards flushSpotCountOutbox's {sent,failed} result via .then(() => onChange?.()), and unlike doorOutbox.ts there is no DROPS_KEY_PREFIX record of a permanently dropped count.", "verify": "! python3 -c \"s=open('apps/web/src/lib/spotCountOutbox.ts').read(); import sys; sys.exit(0 if ('void flushSpotCountOutbox().then(() => onChange?.())' in s and 'DROPS_KEY_PREFIX' not in s) else 1)\"", "verified": "2026-09-19"}
```

- **Workstream:** receiving-documents | **Effort:** S
- **Why:** Direct sibling of the already-fixed doorOutbox.ts bug -- same file family, same outbox pattern, same fix shape (surface 'dropped' where pending count already renders).
- **Verified today:** flushSpotCountOutbox returns only {sent,failed} (no dropped field); watchSpotCountOutbox (~:133) still 'void flushSpotCountOutbox().then(() => onChange?.())'; 0 occurrences of DROPS_KEY_PREFIX.
- **Duplicates checked:** No existing row; only neutral architecture citations of spotCountOutbox elsewhere.
- **Citations to rewrite:**
  - Citation sweep (2026-09-19, git grep in wt-retire-debt@9c6bdc0be): .planning/06-pages/receipts.md:46; .planning/decisions/0103-a-delivery-is-agreed-before-it-is-verified.md:345; apps/api-gateway/src/procurement/canonical/from-parsed-document.spec.ts:132; apps/api-gateway/src/procurement/canonical/from-parsed-document.ts:796; apps/api-gateway/src/procurement/documents/document-intake.service.ts:282; apps/api-gateway/src/procurement/documents/door-count.spec.ts:207; apps/web/src/components/documents/__tests__/canonical-sections.test.tsx:919; apps/web/src/pages/receiving/next/RcOutboxRail.tsx:10; supabase/tests/20260906233000_stock_at_the_door_cost_at_verified_test.sql:2 -- rewrite to point at this item's home once the register is deleted.

### 8. `2159` -- WORK / claims-row
**Section:** flat JSONL, append as new line

```
{"id": "DEBT-QTY-RECEIVED-TWO-UNITS", "status": "open", "claim": "procurement_orders.quantity_received still has four writers disagreeing on unit, and verifyReceipt still assumes one (ADR 0119 line 43 says this LIVE-DEFECT entry stands). Three writers state the column in the ORDER's unit; ReceivingService's door path writes BOTTLES. verifyReceipt reads the column as stockedQtyInCountedUom and invoice-match.ts multiplies a door-written bottle count by the pack size a second time. Production not yet exposed (0 of 2 orders carried a non-null non-zero quantity_received, measured 2026-09-02) but the first real door-to-desk delivery will misread by the pack size. The two-way remediation fork (teach the door the order's unit, vs teach verifyReceipt the value is bottles) is unresolved and will need a founder call at fix time.", "verify": "! python3 -c \"p=open('apps/api-gateway/src/procurement/procurement.service.ts').read(); r=open('apps/api-gateway/src/procurement/receiving.service.ts').read(); m=open('apps/api-gateway/src/procurement/invoice-match.ts').read(); ok=('quantity_received: acceptedQty + rejectedQty' in p and 'ITS UNIT IS NOT AGREED' in p and 'orderUpdate.quantity_received = totals.receivedBottles' in r and 'stockedQty: rawStocked === null ? null : conv(rawStocked, counted)' in m); import sys; sys.exit(0 if ok else 1)\"", "verified": "2026-09-19"}
```

- **Workstream:** procurement-orders | **Effort:** M
- **Why:** Founder flip decide->work (one of 11); a static check exists so this is CLAIMS not OD per the placement rules, even though the original entry framed the remediation fork as needing a founder call -- that fork is preserved in the claim text so it is not lost, just not blocking triage. Only HIGH-severity item in this group.
- **Verified today:** procurement.service.ts:4912-4949 carries the inline warning comment verbatim; :5222 quantity_received write; receiving.service.ts:543 receivedBottles write; invoice-match.ts:558 conv() call -- all four confirmed present.
- **Duplicates checked:** No hit for 2159/quantityReceivedInOrderUom/'four writer' in CLAIMS.jsonl/OPEN-DECISIONS.md.
- **Citations to rewrite:**
  - .planning/decisions/0119-an-agreed-price-states-its-unit.md:43
  - Citation sweep (2026-09-19, git grep in wt-retire-debt@9c6bdc0be): apps/api-gateway/src/procurement/quantity-received-unit.ts:67 -- rewrite to point at this item's home once the register is deleted.

### 9. `2433.1` -- WORK / claims-row
**Section:** flat JSONL, append as new line

```
{"id": "DEBT-POSHUB-DISCARDALL-SILENT", "status": "open", "claim": "pos-hub.service.ts's discard-all path still logs nothing: when adapter.normalize(payload) returns no checks, ingest returns received:0 with errors ['No recognizable checks in payload'] and no this.logger call anywhere between the length check and the return.", "verify": "! python3 -c \"s=open('apps/api-gateway/src/pos-hub/pos-hub.service.ts').read(); i=s.index('if (!checks.length)'); j=s.index('No recognizable checks in payload'); import sys; sys.exit(0 if 'this.logger' not in s[i:j] else 1)\"", "verified": "2026-09-19"}
```

- **Workstream:** ci-tooling | **Effort:** S
- **Why:** Pure observability gap (ingest logic itself is not wrong); grouped under ci-tooling since no POS-bridge workstream exists in the given list.
- **Verified today:** pos-hub.service.ts ~455-465 confirmed: no this.logger between the guard and the string.
- **Duplicates checked:** No hits in CLAIMS.jsonl/OPEN-DECISIONS.md or 06-pages/08-softwares.
- **Citations to rewrite:**
  - .planning/decisions/0105-a-pos-connection-is-a-row-not-an-env-var.md:139-141

### 10. `2433.2` -- WORK / claims-row
**Section:** flat JSONL, append as new line

```
{"id": "DEBT-POSHUB-SIGREJECT-SILENT", "status": "open", "claim": "A rejected POS webhook signature still produces no log line: verifyWebhookSignature's final guard in pos-hub.service.ts has no this.logger call before it, and the controller's resulting 401 is thrown with no logger call either.", "verify": "! python3 -c \"svc=open('apps/api-gateway/src/pos-hub/pos-hub.service.ts').read(); ctl=open('apps/api-gateway/src/pos-hub/pos-hub.controller.ts').read(); i=svc.index('if (!signature || !rawBody) return false;'); j=ctl.index('Webhook signature verification failed'); ok=('this.logger' not in svc[max(0,i-250):i]) and ('this.logger' not in ctl[max(0,j-300):j]); import sys; sys.exit(0 if ok else 1)\"", "verified": "2026-09-19"}
```

- **Workstream:** ci-tooling | **Effort:** S
- **Why:** Same reasoning as 2433.1 (observability gap, not business logic).
- **Verified today:** pos-hub.service.ts:411 guard has no logger in that branch; controller.ts:108-111 throws with no logger call.
- **Duplicates checked:** Same dedupe check as 2433.1; none found. Re-traced the silent branch one file more precisely than the original evidence (service.ts's guard, not just the controller).
- **Citations to rewrite:**
  - .planning/decisions/0105-a-pos-connection-is-a-row-not-an-env-var.md:139-141

### 11. `2433.4` -- WORK / claims-row
**Section:** flat JSONL, append as new line

```
{"id": "ADR-0105-POSADAPTERS-NOT-VENDOR-EVIDENCE", "status": "open", "claim": "pos-adapters.spec.ts's Square/Clover tests are still hand-fabricated envelopes with no citation to a captured or spec-documented vendor payload (ADR 0105 D4 names this file the 'standing counter-example until replaced'): the Square test has no voided key and the file has no captured/spec-cited comment anywhere.", "verify": "! python3 -c \"import re; s=open('apps/api-gateway/src/pos-hub/pos-adapters.spec.ts').read(); i=s.index('square converts cents and reads the webhook envelope'); j=s.index('clover converts epoch millis and cents'); block=s[i:j]; bad=bool(re.search(r'captured|spec-cited|squareup.com|developer.square', block, re.I)) or ('voided' in block); import sys; sys.exit(0 if not bad else 1)\"", "verified": "2026-09-19"}
```

- **Workstream:** ci-tooling | **Effort:** M
- **Why:** Test-fixture rigor issue, distinct in kind from 2433.1/2433.2 but same POS-bridge engineering-discipline lane; ADR 0105 D4 already names the fix bar.
- **Verified today:** pos-adapters.spec.ts:59-91 still builds a hand-written literal, no voided field, no citation comment; pos-adapters.ts has 0 hits for 'variation_name'.
- **Duplicates checked:** ADR 0105 D4 already names this file/lines as a decision criterion (not a checkable row) -- additive, not a duplicate.

### 12. `2478.1` -- WORK / claims-row
**Section:** flat JSONL, append as new line

```
{"id": "DEBT-MARKDELIVERED-ORDER-KEYED-FALLBACK", "status": "open", "claim": "markDelivered's older per-ORDER idempotency key is still live as a bounded fallback (ADR 0103 line 198): when deliveryOwns.value.booked is false, procurement.service.ts still falls through to the old order-delivered:${orderId} key, so a caller outside the new delivery-first flow can still double-book or drop a split shipment's second truck. The code's own comment says this bounds the older defect rather than pretending it is gone.", "verify": "! grep -q 'const idempotencyKey = `order-delivered:${orderId}`;' apps/api-gateway/src/procurement/procurement.service.ts", "verified": "2026-09-19"}
```

- **Workstream:** procurement-orders | **Effort:** S
- **Why:** Code self-documents this as an accepted, bounded residual; founder's WORK mark confirms it should stay tracked as open.
- **Verified today:** procurement.service.ts:4349-4371 confirmed: comment block, deliveryHasBookedOrder check, then the fallthrough key.
- **Duplicates checked:** ADR 0103:196-198 already narrates this in prose (not checkable); no existing CLAIMS row.
- **Citations to rewrite:**
  - .planning/decisions/0103-a-delivery-is-agreed-before-it-is-verified.md:196-198

### 13. `2478.2` -- WORK / claims-row
**Section:** flat JSONL, append as new line

```
{"id": "DEBT-SYNCORDERSTATE-DROPS-CONTRADICTION", "status": "open", "claim": "syncOrderState still drops a contradicting vendor reply with no structured record: inbound-responder.service.ts's APPROVED branch advances to CONFIRMED only when the receipt matches; a mismatch falls through to a comment-only 'stay APPROVED' with no delivery_proposals write and no persistManagerNotification call, unlike the sibling isDecline branch in the same file.", "verify": "! python3 -c \"s=open('apps/api-gateway/src/common/orchestrator/inbound-responder.service.ts').read(); i=s.index('Otherwise stay APPROVED'); j=s.index('agreedPriceToWrite = vendorPrice'); block=s[max(0,i-400):j]; bad=('delivery_proposals' in block) or ('persistManagerNotification' in block); import sys; sys.exit(0 if not bad else 1)\"", "verified": "2026-09-19"}
```

- **Workstream:** procurement-orders | **Effort:** M
- **Why:** Still fully open (state=OPEN in source, confirmed unchanged); the fix pattern already exists one branch away in the same file.
- **Verified today:** inbound-responder.service.ts:1254-1259 confirmed: no delivery_proposals write, no persistManagerNotification in this branch; contrast isDecline branch just above, which does both.
- **Duplicates checked:** No hit for delivery_proposals/syncOrderState in CLAIMS.jsonl/OPEN-DECISIONS.md; a later, different 2026-09-06 finding (ADR 0103 A11) is not the same defect.

### 14. `2666.A6` -- WORK / claims-row
**Section:** flat JSONL, append as new line

```
{"id": "DEBT-INVCOMMAND-UNKNOWN-COST-ZERO", "status": "open", "claim": "InventoryCommandPage still renders unknown cost as $0 in aggregate KPIs (the new page's smaller residual of the legacy-page absence-6 finding): six sites compute value as (wac ?? price ?? 0) * stock, so a lot with unknown cost is silently counted as worth $0 in 'Value on hand' rather than flagged unknown, even though the page's per-lot display is honest elsewhere.", "verify": "! grep -q 'wac ?? .*price ?? 0' apps/web/src/pages/inventory/command/InventoryCommandPage.tsx", "verified": "2026-09-19"}
```

- **Workstream:** security-money | **Effort:** S
- **Why:** Kept source's group=security_money classification (financial-honesty defect) rather than defaulting to web-quality.
- **Verified today:** InventoryCommandPage.tsx lines 348,469,525,724,1201 all repeat (i.wac ?? i.price ?? 0); 'Value on hand' KPI at :879.
- **Duplicates checked:** inventory.md's own absence-5/6 note is about the LEGACY page, a different code path; no CLAIMS/OD hit.
- **Citations to rewrite:**
  - .planning/03-scenarios/S04-pos-order-flows-to-inventory.md:156

### 15. `2717.F10` -- WORK / claims-row
**Section:** flat JSONL, append as new line

```
{"id": "DEBT-SLUG-TURKISH-CHAR-DROPPED", "status": "open", "claim": "A Turkish venue name is still mangled in its slug: organizations.service.ts's slugBase does .toLowerCase().replace(/[^a-z0-9]+/g, '-') with no transliteration table, so a character like c-cedilla collapses into a hyphen rather than becoming a plain c. Filed as harmless today -- the slug is suffixed with a random UUID and is not user-facing identity.", "verify": "! python3 -c \"s=open('apps/api-gateway/src/organizations/organizations.service.ts').read(); i=s.index('const slugBase = dto.name'); j=s.index('const slug = ', i); block=s[i:j]; import sys; sys.exit(0 if ('replace(/[^a-z0-9]+/g' in block and 'transliterat' not in s.lower()) else 1)\"", "verified": "2026-09-19"}
```

- **Workstream:** auth-tenancy | **Effort:** S
- **Why:** organizations.service.ts is the tenant-provisioning service, so auth-tenancy by file ownership even though the defect is cosmetic i18n.
- **Verified today:** organizations.service.ts:606-610 confirmed verbatim; 0 hits for 'transliterat' in the file.
- **Duplicates checked:** No hits anywhere.
- **Citations to rewrite:**
  - .planning/03-scenarios/S04-pos-order-flows-to-inventory.md:205

### 16. `2717.F6` -- WORK / claims-row
**Section:** flat JSONL, append as new line

```
{"id": "DEBT-SALE-UNIT-NO-CARAFE", "status": "open", "claim": "sale_unit still has no word for a carafe: pos-mapping-review.dto.ts's SALE_UNITS is still ['glass','bottle'] with @IsIn(SALE_UNITS), while pos-hub.service.ts's own comments already treat 'carafe' as a valid open label internally -- a manager answering the mapping-review screen for an open-poured carafe still gets a 400.", "verify": "! python3 -c \"import re; s=open('apps/api-gateway/src/pos-hub/dto/pos-mapping-review.dto.ts').read(); m=re.search(r'SALE_UNITS = \\[([^\\]]*)\\]', s); units=m.group(1); import sys; sys.exit(0 if ('carafe' not in units and 'glass' in units and 'bottle' in units) else 1)\"", "verified": "2026-09-19"}
```

- **Workstream:** security-money | **Effort:** S
- **Why:** Money-correctness lane (like 2666.A6): blocks correctly recording what a sale was, affecting depletion/COGS.
- **Verified today:** pos-mapping-review.dto.ts:29 confirmed; pos-hub.service.ts:1015,1107 comments list carafe among internally-accepted labels.
- **Duplicates checked:** No hits anywhere.
- **Citations to rewrite:**
  - .planning/03-scenarios/S04-pos-order-flows-to-inventory.md:205

### 17. `2717.F7` -- WORK / claims-row
**Section:** new line, grouped near DEBT-* rows

```
{"id": "DEBT-2717.F7", "status": "open", "claim": "SimPOS still defaults an unsized catalog item to a 750 ml bottle: simpos.service.ts:182 falls back to inv.bottle_size_ml || 750, and :283 falls back to item.sizeMl ?? 750, so every cocktail, coffee, tea and soft drink with no stated size inherits bottle-sized depletion arithmetic (133 of 268 SKUs on the measured venue). Resolved when neither fallback exists, or an unsized item is flagged unpriced/unsized rather than defaulted.", "verify": "! (grep -q 'bottle_size_ml || 750' apps/api-gateway/src/simpos/simpos.service.ts && grep -q 'sizeMl ?? 750' apps/api-gateway/src/simpos/simpos.service.ts)", "verified": "2026-09-19"}
```

- **Workstream:** security-money | **Effort:** S
- **Why:** Checkable purely by grep; no owning ADR for POS-catalog sizing defaults; sole citation is the register being deleted, and grep for '2717' in .planning/decisions/ is empty so nothing else needs a rewrite.
- **Verified today:** Confirmed both literals live at simpos.service.ts:182 and :283.
- **Duplicates checked:** Only unrelated CLAIMS hit is LENS-POS-2026-09-03 (a different, already-resolved $45 placeholder-price defect).

### 18. `2717.F8` -- WORK / claims-row
**Section:** new line, near DEBT-2717.F7

```
{"id": "DEBT-2717.F8", "status": "open", "claim": "pos_checks has no currency column (confirmed against its baseline CREATE TABLE and all three later touching migrations), so every money figure renders with a template-chosen symbol regardless of the tenant's real currency (e.g. a Turkish lira Moet line rendering as $13000.00). Resolved when a migration adds a currency column to pos_checks and a reader populates it.", "verify": "python3 -c \"import re,glob,sys; sys.exit(0 if any(re.search(r'alter table[^;]*pos_checks[^;]*add column[^;]*currency', open(f, errors='ignore').read(), re.I|re.S) for f in glob.glob('supabase/migrations/*.sql')) else 1)\"", "verified": "2026-09-19"}
```

- **Workstream:** security-money | **Effort:** M
- **Why:** Checkable by grep across migrations; no owning ADR for pos_checks schema; sole citation is the register (grep for '2717' in .planning/decisions/ is empty).
- **Verified today:** Baseline CREATE TABLE and its 3 touching migrations confirmed to carry no currency column.
- **Duplicates checked:** No hit for pos_checks+currency anywhere.

### 19. `2825.A3` -- WORK / claims-row
**Section:** new line

```
{"id": "DEBT-2825.A3", "status": "open", "claim": "public.inventory_analytics's dead_stock column is (last_sold_at IS NULL OR last_sold_at < now() - 90 days) AND on_hand > 0, with no reference to the row's own created_at, so a tenant whose stock was written minutes ago is flagged dead stock on a null last_sold_at alone (a 31-minute-old Sim Vanilla Kaleici tenant shown Dead stock 17). Resolved when the view's dead_stock expression also excludes rows newer than some measured floor of created_at.", "verify": "python3 -c \"import glob,re,sys; files=sorted(glob.glob('supabase/migrations/*.sql')); pat=re.compile(r'CREATE\\s+(?:OR\\s+REPLACE\\s+)?VIEW\\s+public\\.inventory_analytics\\b', re.I); block=None; [block := src[m.start():src.index(';', src.index('dead_stock', m.start()))+1] for f in files for src in [open(f, encoding='utf-8', errors='replace').read()] for m in [pat.search(src)] if m]; sys.exit(1 if block is None else (0 if 'created_at' in block else 1))\"", "verified": "2026-09-19"}
```

- **Workstream:** security-money | **Effort:** S
- **Why:** Statically checkable, one SQL view; no owning ADR; sole citation is the Antalya 'absence reported as health' section being deleted.
- **Verified today:** inventory_analytics defined in exactly one file (baseline); the CREATE VIEW block containing dead_stock has zero occurrences of created_at. REWRITTEN 2026-09-19 (r4-placement.json issue 2): the prior verify only ever read 20260805000000_baseline_from_production.sql, so a real fix -- a NEW migration with CREATE OR REPLACE VIEW -- would never be seen (mutation-tested, confirmed blind to it). New verify globs every supabase/migrations/*.sql in filename (= chronological) order and keeps the LAST CREATE [OR REPLACE] VIEW public.inventory_analytics block found, so a later migration's redefinition wins. Mutation-tested in a fresh git-archive mirror: baseline exit 1 (open, only the baseline definition exists, no created_at); after adding a new later-dated migration with CREATE OR REPLACE VIEW ... created_at ..., exit 0 (resolved); mutation file removed, exit 1 again, mirror clean.
- **Duplicates checked:** No hits for dead_stock/inventory_analytics in CLAIMS.jsonl/OPEN-DECISIONS.md.

### 20. `2866.D3` -- WORK / claims-row
**Section:** new line

```
{"id": "DEBT-2866.D3", "status": "open", "claim": "Notifications.tsx's header stat still counts unread notifications before the fold: the stats useMemo (~:424-426) filters the raw notifications array, while visible rows come from collapseStackedNotifications (dedupedNotifications, ~:316); foldedById is read only for a per-row fold badge (~:1317), never to adjust the header count. So the Unread tile can read higher than the number of visible unread rows (unresolved since PR #313 fixed the wine-set keying but not this count). Resolved when stats.unread is computed from the folded list, or corrected by foldedById.", "verify": "python3 -c \"import sys; src=open('apps/web/src/pages/Notifications.tsx').read(); start=src.index('const stats = useMemo('); i=src.index('(', start); depth=[0]; end=next(k for k in range(i, len(src)) if (depth.__setitem__(0, depth[0]+(1 if src[k]=='(' else -1 if src[k]==')' else 0)) or depth[0]==0) and src[k]==')'); block=src[start:end+1]; sys.exit(0 if 'dedupedNotifications' in block else 1)\"", "verified": "2026-09-19"}
```

- **Workstream:** web-quality | **Effort:** S
- **Why:** Checkable by isolating the stats useMemo block; no owning ADR for Notifications.tsx's stat tiles.
- **Verified today:** Notifications.tsx:300-320 and :418-440 confirmed: stats useMemo uses raw notifications, not dedupedNotifications; foldedById used only once at :1317 for a per-row badge. REWRITTEN 2026-09-19 (r4-placement.json issue 2): the prior verify looked up the literal '}, [notifications, starredNotifications]);' by string index, so the real fix (changing the deps array) makes .index() raise ValueError and the check never reaches a clean exit 1/0 -- it error-exits, mutation-tested. New verify brace-matches from 'useMemo(' to its own closing paren, independent of what the deps array contains. Mutation-tested in a fresh git-archive mirror: baseline exit 1 (open); after applying the exact realistic fix (safeNotifications = dedupedNotifications AND the deps array updated), exit 0 (resolved); restored, exit 1, mirror clean.
- **Duplicates checked:** No existing row.

### 21. `3144` -- WORK / claims-row
**Section:** new line, near procurement/documents rows

```
{"id": "DEBT-3144", "status": "open", "claim": "The PGRST204/42703 schema-lag retry v3.0-TECH-DEBT.md calls a temporary shape to delete is still live: DocumentIntakeService's schemaLagNote retry and CanonicalDocumentService's UNDEFINED_COLUMN_CODES/SCHEMA_LAG_NOTE mirror both still exist, though migration 20260904120000_document_lines_price_base_and_printed.sql (the reason for the retry) has been on main since 2026-09-04. Resolved when both retries and SCHEMA_LAG_NOTE are removed.", "verify": "! (grep -q 'SCHEMA_LAG_NOTE' apps/api-gateway/src/procurement/canonical/canonical-document.service.ts && grep -q 'schemaLagNote' apps/api-gateway/src/procurement/documents/document-intake.service.ts)", "verified": "2026-09-19"}
```

- **Workstream:** receiving-documents | **Effort:** S
- **Why:** Pure code-cleanup fact, checkable by grep; no owning ADR names this shim specifically.
- **Verified today:** schemaLagNote (10 occurrences) and SCHEMA_LAG_NOTE/UNDEFINED_COLUMN_CODES (4 occurrences) both still present; the migration is confirmed in supabase/migrations/.
- **Duplicates checked:** No existing row.
- **Citations to rewrite:**
  - Citation sweep (2026-09-19, git grep in wt-retire-debt@9c6bdc0be): apps/api-gateway/src/procurement/documents/document-intake.service.ts:1002 -- rewrite to point at this item's home once the register is deleted.

### 22. `3165` -- WORK / claims-row
**Section:** new line, near DEBT-3144

```
{"id": "DEBT-3165", "status": "open", "claim": "POST /procurement/documents/:id/extraction (documents.controller.ts -> DocumentIntakeService.applyExternalExtraction) is still wired: a workaround door letting a session post extraction JSON for a document the gateway's own extractor could not read, opened 2026-09-04 because the configured ANTHROPIC_API_KEY had no credit. Whether the key now has credit is not checkable from the repo. Resolved when the route/method are deleted and DocumentExtractorService.normalize is the only supplier again.", "verify": "! grep -q 'applyExternalExtraction' apps/api-gateway/src/procurement/documents/documents.controller.ts", "verified": "2026-09-19"}
```

- **Workstream:** receiving-documents | **Effort:** S
- **Why:** Tracks only the checkable half (code presence); the actual removal trigger (API key credit) is explicitly not checkable from the repo.
- **Verified today:** applyExternalExtraction confirmed defined (document-intake.service.ts:1415) and called from the controller (:1318,1321).
- **Duplicates checked:** No existing row.

### 23. `44.1i` -- WORK / pointer to an EXISTING claims row
**Section:** existing row id ADR-0162-USERS-ROW-FALLBACK-RETIRED (line ~370)

```
No new entry. Reuse the existing CLAIMS row ADR-0162-USERS-ROW-FALLBACK-RETIRED (status open, verified 2026-09-18), whose claim pins the same fallback sites 44.1i names.
```

- **Workstream:** auth-tenancy | **Effort:** S
- **Why:** Reuse rule: an existing row already tracks this exactly.
- **Verified today:** Ran the row's own verify (pins assertMembership/resolveRestaurantRole/assertAccess fallback text) against wt-review: 'retired or changed: []', exit 1 -- per the row's inverted polarity this means all three fallbacks are still present, correctly holding open.
- **Duplicates checked:** This IS the duplicate-check result: 44.1i is already fully tracked by ADR-0162-USERS-ROW-FALLBACK-RETIRED.
- **Citations to rewrite:**
  - Citation sweep (2026-09-19, git grep in wt-retire-debt@9c6bdc0be): .planning/decisions/0162-managers-grant-manager-or-staff-on-both-doors.md:115; .planning/decisions/CLAIMS.jsonl:350; .planning/decisions/CLAIMS.jsonl:351; .planning/decisions/CLAIMS.jsonl:356; .planning/decisions/CLAIMS.jsonl:357; apps/api-gateway/src/auth/auth.service.ts:1120; apps/api-gateway/src/auth/house-role.ts:20; supabase/migrations/20260918153000_a_setup_era_manager_holds_their_house_by_a_row.sql:5 -- rewrite to point at this item's home once the register is deleted.

### 24. `44.1k` -- WORK / claims-row
**Section:** new line, near other DEBT-44.1* rows

```
{"id": "DEBT-44.1k", "status": "open", "claim": "public.users.role carries no CHECK constraint (varchar(20) NOT NULL DEFAULT 'manager') and user_restaurant_access.role's existing check (ADR 0088) is nullable, so a NULL access role or any other 20-char string in users.role both pass every constraint even though RolesGuard/assertMembership compare against exact known strings (0 live violations measured 2026-09-18, so this closes a hole rather than fixing an active incident). Resolved when a migration adds a CHECK on users.role restricted to the three known roles and sets user_restaurant_access.role NOT NULL.", "verify": "python3 -c \"import re,glob,sys; files=glob.glob('supabase/migrations/*.sql'); a=any(re.search(r'alter table[^;]*public\\.users[^;]*add constraint[^;]*check[^;]*role', open(f,errors='ignore').read(), re.I|re.S) for f in files); b=any(re.search(r'alter table[^;]*user_restaurant_access[^;]*alter column\\s+role\\s+set not null', open(f,errors='ignore').read(), re.I|re.S) for f in files); sys.exit(0 if (a and b) else 1)\"", "verified": "2026-09-19"}
```

- **Workstream:** auth-tenancy | **Effort:** S
- **Why:** Checkable by scanning migrations; ADR 0162 confirms this is genuinely uncovered.
- **Verified today:** Baseline confirms users.role has no CHECK; 20260902200000 adds a nullable check on user_restaurant_access.role only; no migration adds the users.role CHECK.
- **Duplicates checked:** No existing row; ADR 0162's 4th addendum lists 44.1k as still open and uncovered.

### 25. `44.1l` -- WORK / claims-row
**Section:** new line

```
{"id": "DEBT-44.1l", "status": "open", "claim": "AuthService.generateInvite still swallows two reads: the restaurant lookup binds only data, so a failed read looks like 'no organization' and answers 400 Complete registration first; and the invite-code collision loop's existing-code read also binds only data, so a failed read looks like code-free and a real collision later surfaces as a generic 400. Both absent from scripts/read_error_baseline.json. Resolved when both reads bind and check their error.", "verify": "! (grep -A8 'const { data: restaurant } = await this.databaseService.supabase' apps/api-gateway/src/auth/auth.service.ts | grep -q 'Complete registration first' && grep -B4 '.eq(\"code\", code)' apps/api-gateway/src/auth/auth.service.ts | grep -q 'const { data: existing } = await this.databaseService.supabase')", "verified": "2026-09-19"}
```

- **Workstream:** auth-tenancy | **Effort:** S
- **Why:** Checkable via each read's unique surrounding text; ADR 0162 confirms still open and uncovered.
- **Verified today:** Both unread patterns confirmed present at the cited anchors.
- **Duplicates checked:** Other 'generateInvite' hits are about the unrelated GRANT-ceiling rule; no existing row for these two reads.

### 26. `44.1m` -- WORK / claims-row
**Section:** new line

```
{"id": "DEBT-44.1m", "status": "open", "claim": "AuthService.registerRestaurant still awaits its three post-registration writes (organizations.owner_id update, organization_members insert, user_restaurant_access insert) with no destructured error and no rollback, unlike the users insert three lines above which throws on failure. If the access insert fails, the new house has an owner by users.role alone with no access row, invisible to the last-owner guards (production measured 2026-09-18: 4 of 14 houses with no active owner access row, cause not attributed). Resolved when each write reads its error and rolls back registration on failure.", "verify": "python3 -c \"import sys; src=open('apps/api-gateway/src/auth/auth.service.ts').read(); n1='await this.databaseService.supabase\\n        .from(\\\"organizations\\\")\\n        .update({ owner_id: userId })\\n        .eq(\\\"id\\\", orgId);' in src; n2='await this.databaseService.supabase.from(\\\"organization_members\\\").insert({' in src; n3='await this.databaseService.supabase\\n        .from(\\\"user_restaurant_access\\\")\\n        .insert({' in src; sys.exit(0 if not (n1 and n2 and n3) else 1)\"", "verified": "2026-09-19"}
```

- **Workstream:** auth-tenancy | **Effort:** S
- **Why:** Checkable via exact-substring presence; ADR 0162 confirms still open and uncovered.
- **Verified today:** All three naked-await substrings present verbatim at auth.service.ts:882-900.
- **Duplicates checked:** No existing row.

### 27. `44.1n` -- WORK / claims-row
**Section:** new line, group near ADR-0162-OWNERS-REMOVE-OWNERS/ADR-0162-TEAM-REMOVE-OWNERS

```
{"id": "DEBT-44.1n-LAST-OWNER-GUARD-GAPS", "status": "open", "claim": "MembersService.updateMemberRole's last-owner guard runs only when the actor changes their OWN role (actorUserId === targetUserId && newRole !== owner): the count-then-write it guards has no lock (two owners self-demoting simultaneously could both pass, theoretical/unmeasured), and it never fires when a DIFFERENT actor demotes the only access-row owner. These are the two items ADR 0162's second addendum left open under 44.1n after the Team-page removal guard and the any-owner-may-demote answer closed the rest. Resolved when the guard also covers a different-actor demotion of the sole owner and/or the count-then-write is made atomic.", "verify": "! grep -q 'if (actorUserId === targetUserId && newRole !== \"owner\") {' apps/api-gateway/src/restaurants/members.service.ts", "verified": "2026-09-19"}
```

- **Workstream:** auth-tenancy | **Effort:** M
- **Why:** Register text and ADR 0162's addendum both separate the closed parts from this open remainder.
- **Verified today:** Exact guard condition present verbatim at members.service.ts:220, no lock/transaction around the count-then-write (220-233).
- **Duplicates checked:** 44.1n's two closed sub-items already have their own rows (ADR-0162-OWNERS-REMOVE-OWNERS, ADR-0162-TEAM-REMOVE-OWNERS, both resolved) -- this row covers only the still-open remainder.
- **Citations to rewrite:**
  - Citation sweep (2026-09-19, git grep in wt-retire-debt@9c6bdc0be): .planning/decisions/0162-managers-grant-manager-or-staff-on-both-doors.md:213; .planning/decisions/0162-managers-grant-manager-or-staff-on-both-doors.md:363; .planning/decisions/CLAIMS.jsonl:353; .planning/decisions/CLAIMS.jsonl:359; apps/api-gateway/src/team/team.service.ts:453 -- rewrite to point at this item's home once the register is deleted.

### 28. `44.1o` -- WORK / claims-row
**Section:** new line

```
{"id": "DEBT-44.1o", "status": "open", "claim": "MembersService.addMember still upserts organization_members unconditionally on (organization_id, user_id) with the role just granted in ONE house, and does not read the upsert's error: an org owner added as staff to a second house of the same org becomes org staff everywhere. Not live today -- no web or mobile client calls addMember (ADR 0162) -- but the code is wrong regardless. Resolved when the upsert only inserts a fresh row (never overwrites) and its error is read.", "verify": "python3 -c \"import sys; src=open('apps/api-gateway/src/restaurants/members.service.ts').read(); naked='await this.databaseService.supabase.from(\\\"organization_members\\\").upsert(\\n        {\\n          organization_id: restaurant.organization_id,\\n          user_id: targetUser.user_id,\\n          role,\\n        },\\n        { onConflict: \\\"organization_id,user_id\\\" },\\n      );' in src; sys.exit(0 if not naked else 1)\"", "verified": "2026-09-19"}
```

- **Workstream:** auth-tenancy | **Effort:** S
- **Why:** Checkable via exact-substring presence; ADR 0162 confirms still open and uncovered.
- **Verified today:** Exact naked upsert present verbatim at members.service.ts:531-538.
- **Duplicates checked:** Other 'addMember' hits are about the unrelated GRANT-ceiling rule; no existing row for this upsert.

### 29. `44.1r` -- WORK / claims-row
**Section:** new line, group with other ADR-0162-* rows

```
{"id": "ADR-0162-MEMBERSHIP-ONLY-SESSIONS", "status": "open", "claim": "The founder's 'Membership only' answer (ADR 0162, 4th addendum, 2026-09-18) is decided but not built: AuthService.refreshAccessToken still re-mints a token naming scopedRestaurantId = payload.restaurantId ?? user.restaurant_id with no membership check (auth.service.ts:399), so a route not gated by @Roles keeps answering a removed person; and switchRestaurant's legacy org-level fallback (auth.service.ts:460-511) still opens a session in any house of the caller's organisation without a user_restaurant_access row there (measured 2026-09-18: 7 such pairs, all simulation accounts). This row also covers the SAME switchRestaurant fallback that register item 44.1f separately named -- 44.1f is placed as a pointer to this row rather than a second one (see 44.1f). Resolved by the follow-up PR the addendum names: a token naming a house with no membership row is refused (401) on refresh, and the organisation fallback opens nothing.", "verify": "! (grep -q 'const scopedRestaurantId = payload.restaurantId ?? user.restaurant_id;' apps/api-gateway/src/auth/auth.service.ts && grep -q 'Legacy fallback: org-level check for users who have no URA row yet' apps/api-gateway/src/auth/auth.service.ts)", "verified": "2026-09-19"}
```

- **Workstream:** auth-tenancy | **Effort:** M
- **Why:** Decision already locked (ADR 0162 4th addendum); only the build is owed, hence WORK. STRUCTURE-CRITIC MERGE: consolidates what would otherwise be two near-duplicate open CLAIMS rows for the same code gap (see 44.1f).
- **Verified today:** Both anchors present: line 399 (scopedRestaurantId) and line 474 (Legacy fallback comment introducing switchRestaurant's org-level check).
- **Duplicates checked:** MERGED with 44.1f (see that key's own placement): both register entries (44.1f, 44.1r) describe the same switchRestaurant org-fallback code; two different batch agents independently drafted overlapping CLAIMS rows (this one, and a near-duplicate 'ADR-0162-SWITCH-MEMBERSHIP-ONLY'). Kept this one (broader: also covers refreshAccessToken) and dropped the duplicate id.
- **Citations to rewrite:**
  - Citation sweep (2026-09-19, git grep in wt-retire-debt@9c6bdc0be): .planning/decisions/0162-managers-grant-manager-or-staff-on-both-doors.md:419 -- rewrite to point at this item's home once the register is deleted.

### 30. `44.1s` -- WORK / claims-row
**Section:** new line, group with other ADR-0162-* rows

```
{"id": "ADR-0162-OWNER-ROUTES-RELABEL", "status": "open", "claim": "The founder's 'Keep managers in' answer (ADR 0162, 4th addendum, 2026-09-18) is decided but not built: RolesGuard intentionally keeps admitting manager wherever a route requires owner or manager, so today's behaviour is correct and stays -- but non-spec @Roles(\"owner\")-only decorators still exist (re-measured 2026-09-19 by exact-line grep: 10, not the register's uncorroborated 11 -- 8 in vendor-intel.controller.ts, 2 in price-index.controller.ts), so the decorator lies about what the route actually admits. Resolved when those routes are relabelled @Roles(\"owner\",\"manager\").", "verify": "test \"$(grep -rnE '^[[:space:]]*@Roles\\(\"owner\"\\)[[:space:]]*$' apps/api-gateway/src --include='*.ts' | grep -v '.spec.ts' | wc -l | tr -d ' ')\" = 0", "verified": "2026-09-19"}
```

- **Workstream:** auth-tenancy | **Effort:** S
- **Why:** Re-measured the count myself (10, not the register's 11) per CLAUDE §5b rather than copying the stale figure forward; the verify checks the count reaches 0, so this discrepancy does not affect correctness.
- **Verified today:** Independently re-ran the exact grep on wt-review: 10 hits (vendor-intel.controller.ts x8, price-index.controller.ts x2); an apparent 11th at price-index.controller.ts:238 is inside a JSDoc comment, correctly excluded by the anchored regex.
- **Duplicates checked:** No existing row covers the relabel (only unrelated ADR-0162-ROLE-IN-TOKEN-HOUSE, about role source not decorator labeling).

### 31. `44.1t` -- WORK / claims-row
**Section:** new line, group with other ADR-0162-* rows

```
{"id": "ADR-0162-LEAVER-ROLE-RESET", "status": "open", "claim": "Following ADR 0162 answer A and the 44.1r fix it is bundled with: all three sites that clear a leaver's house pointer (AuthService.leaveRestaurant, MembersService.clearUsersRowHouse, TeamService.deleteMember) still .update({ restaurant_id: null }) alone, leaving users.role at whatever the house last gave them. A fresh login after leaving names no house, so JwtStrategy falls back to users.role and the leaver's session still carries their old role there. Resolved when the same follow-up PR that builds 44.1r also resets role alongside restaurant_id at all three sites.", "verify": "python3 -c \"import sys; a=open('apps/api-gateway/src/auth/auth.service.ts').read(); m=open('apps/api-gateway/src/restaurants/members.service.ts').read(); t=open('apps/api-gateway/src/team/team.service.ts').read(); c=('.update({ restaurant_id: null })' in a) and ('.update({ restaurant_id: null })' in m) and ('.update({ restaurant_id: null })' in t); sys.exit(0 if not c else 1)\"", "verified": "2026-09-19"}
```

- **Workstream:** auth-tenancy | **Effort:** S
- **Why:** ADR 0162's 4th addendum states this explicitly as owed; distinct code fact (3 call sites) from 44.1r, kept as its own row.
- **Verified today:** All three exact calls present at the cited sites, none also setting role.
- **Duplicates checked:** The related ADR-0162-LEAVING-ENDS-MEMBERSHIP row (resolved) covers whether the pointer is cleared, not whether role resets alongside it -- not a duplicate.
- **Citations to rewrite:**
  - Citation sweep (2026-09-19, git grep in wt-retire-debt@9c6bdc0be): .planning/decisions/0162-managers-grant-manager-or-staff-on-both-doors.md:419 -- rewrite to point at this item's home once the register is deleted.

### 32. `44.2d` -- WORK / pointer to an EXISTING claims row
**Section:** existing row, id DEBT-44.2d (line 264)

```
No new entry. Reuse the existing CLAIMS row DEBT-44.2d (status open, verified 2026-09-06): the deploy-audit ancestry-check gap, verify greps for is[-_]ancestor in scripts/check_deployed_sha.py and scripts/resolve_watched_commit.py.
```

- **Workstream:** ci-tooling | **Effort:** M
- **Why:** Reuse rule: the item's own evidence and the placement-rules prompt both name DEBT-44.2d as the worked reuse example.
- **Verified today:** Ran the row's own verify directly: no match, exit 1, correctly holding open (no ancestry check exists in either script).
- **Duplicates checked:** This IS the duplicate-check result: already tracked verbatim.
- **Citations to rewrite:**
  - Citation sweep (2026-09-19, git grep in wt-retire-debt@9c6bdc0be): .planning/decisions/0097-the-gateway-says-which-build-it-is.md:267; .planning/decisions/CLAIMS.jsonl:263 -- rewrite to point at this item's home once the register is deleted.

### 33. `44.3b` -- WORK / claims-row
**Section:** new line, end of file

```
{"id": "DEBT-44.3b", "status": "open", "claim": "procurement.service.ts#approveDraft still creates the delivery calendar event in its own try/catch AFTER the conversation-status write (the 'Calendar creation after draft approval failed' warn-and-swallow branch), so a calendar-creation failure is logged but never rolled back with the status change -- the write is not atomic across status, stock and calendar, contradicting Phase 34's 'atomically' wording. The double-send half of this defect is already fixed (an atomic SENDING claim step, proven by approve-draft-concurrency.spec.ts). Only the calendar half remains. Flips to resolved once the calendar write is folded into the same atomic step, or a decision to accept it as best-effort is recorded here.", "verify": "! grep -q 'Calendar creation after draft approval failed' apps/api-gateway/src/procurement/procurement.service.ts", "verified": "2026-09-19"}
```

- **Workstream:** procurement-orders | **Effort:** M
- **Why:** Register being deleted whole; live, still-true, checkable defect with no owning ADR gets its own row, reusing the DEBT-44.x id convention already established by DEBT-44.2d.
- **Verified today:** Confirmed exit 1 (open) -- the catch-and-log pattern is still at lines 5954-5977.
- **Duplicates checked:** Only unrelated ADR 0066/0068/0073 hits (calendar event vocabulary); no existing row tracks the atomicity gap.

### 34. `44.5` -- WORK / claims-row
**Section:** new line, end of file

```
{"id": "DEBT-44.5", "status": "open", "claim": "Of v3.0-TECH-DEBT 44.5's 5-item dead-code list, 3 are confirmed gone (InvoiceScannerModal deleted 2026-08-26 per ADR 0019; Reports.v1.backup.tsx and inventoryData.ts both absent) and root REPORT.md (a stale April 2026 Phase-2 crawl report) is still committed and cited nowhere load-bearing. CORRECTION: the list's other 'still remaining' item, apps/mobile/src/lib/invoiceMatch.ts, was misdiagnosed as zero-importers -- apps/mobile/app/(tabs)/cellar/receive/[orderId].tsx imports it via the @/lib/invoiceMatch alias, and its own header documents it as a deliberate mobile mirror of apps/web/src/lib/invoiceMatch.ts kept in sync by hand. It is live code, out of this row's scope, and must not be deleted. Flips to resolved once REPORT.md is deleted.", "verify": "! test -f REPORT.md", "verified": "2026-09-19"}
```

- **Workstream:** docs-records | **Effort:** S
- **Why:** Only genuinely-open, checkable remainder of a 5-item list. Keeping the invoiceMatch.ts correction in the claim text matters: acting on the original register text ('delete both remaining files') today would have deleted a file with a real importer.
- **Verified today:** InvoiceScannerModal/Reports.v1.backup.tsx/inventoryData.ts confirmed absent; REPORT.md present (3780 bytes, 2026-04-06 content); invoiceMatch.ts confirmed live-imported by orderId].tsx, contradicting the original 'zero importers' claim.
- **Duplicates checked:** v3.0-TECH-DEBT.md:1338 already self-corrected the InvoiceScannerModal half; this row folds that plus a fresh invoiceMatch.ts correction into one place.
- **Citations to rewrite:**
  - Citation sweep (2026-09-19, git grep in wt-retire-debt@9c6bdc0be): .planning/06-pages/reports.md:1143; .planning/06-pages/reports.md:741; .planning/06-pages/reports.md:896 -- rewrite to point at this item's home once the register is deleted.

### 35. `arm-b-grant-option-credit-bug` -- WORK / claims-row
**Section:** new line

```
{"id": "ADR-0159-ARM-B-GRANT-OPTION", "status": "open", "claim": "check_new_tables_are_locked_down.py's arm (b) RE_REVOKE, the table-lockdown regex, has no named group distinguishing 'revoke grant option for ... from anon' from a full revoke, unlike arm (c)'s RE_FN_PRIV, already fixed with a (?P<gof>grant option for )? group. The event loop sets granted=False for ANY match touching a client role, with no check for a grant-option-only revoke, so a planted grant+revoke-grant-option-only shape still credits the table as locked down when the privilege stands. Grep of current migrations finds zero uses of this shape today. Flips to resolved once RE_REVOKE gets an equivalent gof group, the event loop skips crediting a grant-option-only match, and arm (b) gets a --self-test proving it.", "verify": "python3 -c \"import pathlib,sys; s=pathlib.Path('scripts/check_new_tables_are_locked_down.py').read_text(); i=s.index('RE_REVOKE = re.compile('); sys.exit(0 if 'gof' in s[i:i+216] else 1)\"", "verified": "2026-09-19"}
```

- **Workstream:** security-money | **Effort:** S
- **Why:** Directly checkable; anchored to ADR 0159 as the explicit arm-b sibling of the already-fixed arm-c bug its round-4 sweep found.
- **Verified today:** Confirmed exit 1 (open); slice length measured exactly against the gap before RE_GRANT begins so it cannot spill into RE_FN_PRIV's own gof group elsewhere.
- **Duplicates checked:** Only the resolved OD-72 row (arm c, function-side) exists; nothing tracks the table-side arm (b).

### 36. `atlas-backbone-F1` -- WORK / claims-row
**Section:** new line

```
{"id": "ADR-0033-ATLAS-STALENESS-GUARD", "status": "open", "claim": "The committed .planning/00-index/atlas-graph.json can drift from the code it describes with nothing in CI to catch it -- ADR 0033's own Consequences names this directly (a CI freshness guard is the natural next ratchet, deliberately not added in the same PR). No workflow under .github/workflows references generate_design_atlas.py or atlas-graph.json at all. Measured 2026-09-18: regenerating against origin/main gives 507 endpoints/233 features and against this tree 689/581, against the committed file's own 468/186 -- real growth, not a measurement change. Flips to resolved once a CI step regenerates the atlas and fails the build on any diff.", "verify": "grep -rlqE 'generate_design_atlas|atlas-graph' .github/workflows/", "verified": "2026-09-19"}
```

- **Workstream:** ci-tooling | **Effort:** M
- **Why:** Did not re-run the full generator (writes into tracked .planning/00-index); confirmed the committed-side half directly and the no-CI-guard half by grep. Historical 507/689 figures cited as the 2026-09-18 audit's own measurement, not re-derived here.
- **Verified today:** Confirmed committed file's own counts (468/186) by reading its 'counts' key directly; confirmed no CI workflow references either script or the graph file (exit 1).
- **Duplicates checked:** No existing row; ADR 0033 names the gap only in prose.

### 37. `atlas-backbone-F8` -- WORK / claims-row
**Section:** new line

```
{"id": "DEBT-GATEWAY-ZERO-TEST-FOLDERS", "status": "open", "claim": "apps/api-gateway/src/common/idempotency and apps/api-gateway/src/database ship with zero *.spec.ts files between them, despite idempotency being the dedup guard for repeat orders/background jobs and database being the DB access layer every other module goes through. A 2026-09-18 coverage run additionally found src/common/orchestrator at 44.72% and src/conversations at 23.54% statement coverage (lighter-tested, not zero; needs a fresh run to re-confirm, not pinned by this row's verify). Flips to resolved once either zero-test folder gains at least one spec file.", "verify": "test \"$(find apps/api-gateway/src/common/idempotency apps/api-gateway/src/database -name '*.spec.ts' | wc -l)\" -eq 0 && exit 1 || exit 0", "verified": "2026-09-19"}
```

- **Workstream:** web-quality | **Effort:** M
- **Why:** Coverage percentages need jest (disallowed for a static claim); narrowed to the structurally-checkable core (two folders with literally zero tests). No gateway/backend-specific workstream exists in the given 9; flagged as an imperfect fit.
- **Verified today:** Confirmed 0 spec files across both folders (exit 1, open).
- **Duplicates checked:** No existing row for these 4 folder names.

### 38. `atlas-backbone-F9` -- WORK / claims-row
**Section:** new line

```
{"id": "DEBT-SELF-EVOLUTION-DEPLOY-PATH-MISSING", "status": "open", "claim": "services/self-evolution (main.py, 561 lines, plus requirements.txt only) still has no Dockerfile and no railway.toml, unlike services/agent-orchestrator, which has both -- so it has no way to run anywhere outside a developer machine. Flips to resolved once either deployment file is added, or the service is retired if the founder decides not to deploy it.", "verify": "test -f services/self-evolution/Dockerfile -o -f services/self-evolution/railway.toml -o ! -d services/self-evolution", "verified": "2026-09-19"}
```

- **Workstream:** ci-tooling | **Effort:** S
- **Why:** Founder flip decide->work (one of 11): tracked as the checkable fact (files missing) rather than forcing a fresh ceremony; the Dockerfile-vs-retire fork stays implicit in the claim's resolution clause.
- **Verified today:** Confirmed services/self-evolution has only main.py+requirements.txt; agent-orchestrator has both Dockerfile and railway.toml (exit 1, open).
- **Duplicates checked:** Only a coincidental unrelated hit (OD-91's restaurant_feature_flags row named self_evolution); no OD/ADR covers this service's deployment gap.

### 39. `atlas-surfaces-F1` -- WORK / claims-row
**Section:** new line

```
{"id": "ADR-0033-ATLAS-PAGEGATE-BLIND", "status": "open", "claim": "generate_design_atlas.py has no handling for ADR 0149's PageGate(page, legacy, next) rollout pattern -- the string PageGate does not appear anywhere in the script. App.tsx carries 27 PageGate elements today (re-counted 2026-09-19; the audit's first count of 24 was wrong, corrected to 27 in its own follow-up). A 2026-09-18 reproduction found only 20 of 61 routes (33%) resolving to a real component/edge in the generated atlas, because the resolver never walks into a components/mudavym/<Page>/index.ts barrel directory. Flips to resolved once the resolver is PageGate-aware.", "verify": "grep -q 'PageGate' scripts/generate_design_atlas.py", "verified": "2026-09-19"}
```

- **Workstream:** web-quality | **Effort:** M
- **Why:** Did not reproduce the exact 61/20/33 percent figures myself (would require running the generator against the tracked tree); verified the structurally durable half instead (27 PageGate elements today; zero PageGate awareness in the resolver source).
- **Verified today:** grep -c PageGate App.tsx -> 27 (matches the audit's corrected count exactly); grep for PageGate in the generator script -> absent (exit 1, open).
- **Duplicates checked:** No existing row; distinct from atlas-backbone-F1 (that one is staleness/no-CI-guard, this is a specific resolver blind spot).

### 40. `atlas-surfaces-F9` -- WORK / claims-row
**Section:** new line

```
{"id": "DEBT-ATLAS-TODO-FALSE-POSITIVES", "status": "open", "claim": "one-tap-actions.service.ts:64 and weather-prefetch.service.ts:40 still read as live TODO/not-implemented markers to a naive grep, though neither is an open stub: line 64 is a module-docstring aside describing three TODO branches REMOVED by the ADR 0083 fix (2026-09-05; only 1 TODO occurrence remains in the file, and it is this historical one); weather-prefetch's line 40 says a skip is delegated to WeatherService.windowFor, a deliberate delegation. The register's original 4-TODO-file selection was already inconsistent; these 2 are confirmed false positives, the other 2 are genuine and already ADR-tracked (44.6/ADR 0083). Flips to resolved once the wording no longer contains the literal strings a TODO/not-implemented grep matches.", "verify": "! (grep -q 'not implemented here' apps/api-gateway/src/weather/weather-prefetch.service.ts && grep -q 'branches and a default log' apps/api-gateway/src/one-tap-actions/one-tap-actions.service.ts)", "verified": "2026-09-19"}
```

- **Workstream:** web-quality | **Effort:** S
- **Why:** Did not attempt to reproduce the exact recount of TODO files (pattern/scope-dependent); the placement only needs the 2 named false positives confirmed, which it is.
- **Verified today:** Confirmed both false-positive strings still present (exit 1, open); one-tap-actions.service.ts line 64 read as a historical aside citing ADR 0083.
- **Duplicates checked:** No existing row for either filename.

### 41. `canonical-amount-due-tautology` -- WORK / claims-row
**Section:** new line

```
{"id": "ADR-0104-BR-CO-16-TAUTOLOGY", "status": "open", "claim": "from-parsed-document.ts still derives layer1.totals.amountDue from the same parsed.total as taxInclusiveAmount, and hardcodes paidAmount/roundingAmount to env<number>(null, ...), so canonical-invariants.ts's BR-CO-16 check (amountDue = taxInclusiveAmount - paidAmount + roundingAmount) reduces to withVat - 0 + 0 == withVat and can never fail -- a tautology, not a real cross-check, until a genuine amount-already-paid field is extracted separately from the total. Flips to resolved once paidAmount (or roundingAmount) stops being a hardcoded null.", "verify": "! grep -q 'paidAmount: env<number>(null,' apps/api-gateway/src/procurement/canonical/from-parsed-document.ts", "verified": "2026-09-19"}
```

- **Workstream:** receiving-documents | **Effort:** S
- **Why:** Confirmed the mechanism by reading canonical-invariants.ts's amountDue function directly; the math genuinely collapses to a tautology.
- **Verified today:** from-parsed-document.ts:744-753 confirmed: paidAmount/roundingAmount both env<number>(null,...); amountDue sourced from the same parsed.total as taxInclusiveAmount (exit 1, open).
- **Duplicates checked:** No existing row for BR-CO-16/amountDue.

### 42. `canonical-slice3-stop1-finding1-mock-drift` -- WORK / claims-row
**Section:** new line

```
{"id": "ADR-0104-MOCK-CURRENTTABLE-DRIFT", "status": "open", "claim": "canonical-document.service.spec.ts and price-base-round-trip.spec.ts still mock Supabase's table-chain with one shared, mutable let currentTable variable, so under Promise.all two concurrent chains can interleave and one can read the other's canned answer. document-correction.service.spec.ts and 4 sibling spec files already fixed this with a makeChain(table) closure with no shared mutable state. Flips to resolved once both older files adopt the same pattern.", "verify": "! (grep -q 'let currentTable' apps/api-gateway/src/procurement/canonical/canonical-document.service.spec.ts && grep -q 'let currentTable' apps/api-gateway/src/procurement/canonical/price-base-round-trip.spec.ts)", "verified": "2026-09-19"}
```

- **Workstream:** receiving-documents | **Effort:** S
- **Why:** Pure test-infrastructure fix with a directly comparable already-fixed sibling in the same directory; filed under receiving-documents since test quality is not one of the 9 given workstreams.
- **Verified today:** Both files confirmed to still declare a shared let currentTable; document-correction.service.spec.ts confirmed to use the fixed makeChain(table) pattern (exit 1, open).
- **Duplicates checked:** No existing row.

### 43. `canonical-slice3-stop2-d9-deputy-not-wired` -- WORK / claims-row
**Section:** new line

```
{"id": "ADR-0103-D9-DEPUTY-NOT-ADDRESSED", "status": "open", "claim": "delivery-clock.service.ts#climb fetches deputy_user_id via ownersOf() for every rung but never reads it -- at the 50% rung the notification is restricted to onlyUserIds:[owners.owner]; at the 80% rung there is no onlyUserIds restriction at all, so the notification just broadcasts restaurant-wide. D9 clause 2's own inline comment says the deputy should also be notified at 80%, but that is prose, not code. Flips to resolved once the escalated branch's onlyUserIds includes owners.deputy alongside owner.", "verify": "grep -q 'owners\\.deputy' apps/api-gateway/src/procurement/canonical/delivery-clock.service.ts", "verified": "2026-09-19"}
```

- **Workstream:** receiving-documents | **Effort:** S
- **Why:** Deputy is queried and destructured but never referenced again -- a clean, unambiguous grep target; ADR 0103 D9/A10 names the owning ADR directly.
- **Verified today:** Confirmed only the notified_half branch restricts onlyUserIds; no equivalent branch for escalated; owners.deputy is never read after being destructured (exit 1, open).
- **Duplicates checked:** No existing row.

### 44. `canonical-slice3-stop2-tr-vendor-terms-unseeded` -- WORK / claims-row
**Section:** new line

```
{"id": "ADR-0103-TR-VENDOR-TERMS-UNSEEDED", "status": "open", "claim": "No migration inserts a public.vendor_terms row for jurisdiction=TR with clock=response_window or clock=invoice_issuance (only objection_window and US-CA payment are seeded). delivery-clock.service.ts's lapseDeeming() already has TR-specific legal wording ready for response_window (e-Irsaliye silence-accepts), but with no matching vendor_terms row a TR delivery on that clock resolves blocked_unknown instead of running the real countdown. Both clocks are unseeded for every jurisdiction, not only TR. Flips to resolved once a seeding migration inserts platform-default response_window AND invoice_issuance rows for TR.", "verify": "grep -rlq \"'TR', 'any', 'invoice', 'response_window'\" supabase/migrations/ && grep -rlq \"'TR', 'any', 'invoice', 'invoice_issuance'\" supabase/migrations/", "verified": "2026-09-19"}
```

- **Workstream:** receiving-documents | **Effort:** S
- **Why:** Re-verification sharpened the finding: confirmed both clocks are unseeded for EVERY jurisdiction, not only TR, noted explicitly rather than silently narrowing scope.
- **Verified today:** Confirmed only the objection_window TR row exists in the 5 vendor_terms-touching migrations; no response_window/invoice_issuance row for TR anywhere (verify is a positive-match check and correctly exits 1 today, open).
- **Duplicates checked:** No existing row.

### 45. `deferred-ci-tooling-debt` -- WORK / claims-row
**Section:** new line

```
{"id": "DEBT-CI-PYTHON-LINT-SCOPE-GAP", "status": "open", "claim": "CI's only Python lint job (ci.yml's lint-python, running ruff 0.8.4 + black 24.10.0) is scoped to services/agent-orchestrator only (cd services/agent-orchestrator before both checks) -- scripts/*.py and services/self-evolution/main.py are never linted in CI. This replaces v3.0-TECH-DEBT's bundled 'CI ruff/black/eslint-config debt + Security-Scan permission bug' row, which was FALSE on its eslint half: ci.yml's 'Run ESLint' step (line 1065) runs `pnpm run lint`, which runs `turbo run lint` (package.json:19), which runs every workspace's own eslint script -- the original claim's `grep -q 'eslint'` verify only ever read 'open' because the step name is spelled 'ESLint' (capital-sensitive grep). The Security-Scan-permission half could not be substantiated either (security job permissions -- contents:read, security-events:write -- are correct for its Trivy SARIF upload, and no other reference to a permission bug exists anywhere in the repo) and is dropped rather than carried forward unverified. Flips to resolved once the lint-python job (or a new one) lints scripts/ and/or services/self-evolution.", "verify": "python3 -c \"import re,sys; src=open('.github/workflows/ci.yml').read(); i=src.index('lint-python:'); rest=src[i+len('lint-python:'):]; m=re.search(r'\\n  [A-Za-z_-]+:\\n', rest); j=(i+len('lint-python:')+m.start()) if m else len(src); block=src[i:j]; sys.exit(0 if ('scripts' in block or 'self-evolution' in block) else 1)\"", "verified": "2026-09-19"}
```

- **Workstream:** ci-tooling | **Effort:** M
- **Why:** Fixing r4-placement.json issue 1 (false CLAIMS row): the eslint half was substantiated as FALSE (CI does run eslint via turbo), so it is replaced outright with the TRUE half (Python lint's scope gap), not patched. Same effort/workstream as before (ci-tooling, M): turning on lint for two more directories for the first time will likely surface a pre-existing violation backlog needing triage.
- **Verified today:** Confirmed against wt-retire-debt@9c6bdc0be: 'Run ESLint' step IS present (ci.yml:1065-1066, pnpm run lint -> turbo run lint -> every workspace's own eslint script, package.json:19) -- the original claim was false. lint-python job (ci.yml:1164-1191) only cd's into services/agent-orchestrator for both ruff and black; zero mention of scripts/ or self-evolution anywhere in ci.yml. Mutation-tested in a fresh git-archive mirror of wt-retire-debt@9c6bdc0be: baseline exit 1 (open); after adding a 'ruff check scripts/ services/self-evolution/' step, exit 0 (resolved); restored, exit 1 again, mirror left clean.
- **Duplicates checked:** v3.0-TECH-DEBT.md is the only other mention anywhere in the repo.

### 46. `expired-session-drops-door-receipts` -- WORK / claims-row
**Section:** new line

```
{"id": "ADR-0140-401-403-NOT-RETRYABLE", "status": "open", "claim": "doorOutbox.ts's permanent-4xx check (status>=400 && status<500 && status!==408 && status!==429) still does not exclude 401/403, at both the synchronous send path (skips queueing entirely and re-throws) and the retry-sweep drop path -- so a delivery receipt logged while the phone's session has expired is thrown away rather than held for retry after sign-in, even though the file's own reason:'auth' documentation says the remedy is signing in again. Flips to resolved once both sites also exclude 401 and 403.", "verify": "grep -q 'status !== 401' apps/web/src/lib/doorOutbox.ts", "verified": "2026-09-19"}
```

- **Workstream:** receiving-documents | **Effort:** S
- **Why:** Found a second, earlier data-loss site (the synchronous send path, which skips queueing entirely on 401/403 -- worse than the sweep-drop the original evidence named) -- included both in the claim. High severity confirmed as described (real data loss on session expiry).
- **Verified today:** Confirmed both sites (sync send path and retry-sweep) still use the same 4-condition check with no 401/403 exclusion; line ~102 documents the intended auth remedy as signing in again.
- **Duplicates checked:** No existing row for doorOutbox/401.

### 47. `inventory-add-remove-item7` -- WORK / claims-row
**Section:** new line

```
{"id": "DEBT-INVENTORY-DELETE-NO-REFERENCE-GUARD", "status": "open", "claim": "softDeleteItem() (inventory.service.ts) still flips is_active straight to false with no check for an open order or an active menu_items/POS mapping still referencing the row -- the removal-hardening item in INVENTORY_ADD_REMOVE_SCENARIOS.md §4/7, the only one of that file's 7-item build list still open per its own status table. (Two other sub-parts of item 7 -- verifying openMl/multi-location zeroing on reconcile, and a bulk reconcile-to-zero-and-archive action -- remain open too; this row's verify pins the delete-guard part only.) Flips to resolved once softDeleteItem (or its caller) refuses or warns when an open order or an active menu/POS mapping still references the item.", "verify": "python3 -c \"import pathlib,sys; s=pathlib.Path('apps/api-gateway/src/inventory/inventory.service.ts').read_text(); i=s.index('async softDeleteItem'); body=s[i:i+1860]; sys.exit(0 if ('menu_items' in body or 'procurement_orders' in body) else 1)\"", "verified": "2026-09-19"}
```

- **Workstream:** wine-library | **Effort:** M
- **Why:** Picked the safety-critical, cleanly-checkable sub-part (pre-delete reference guard) as the verify target, and named the other two sub-parts as context so nothing about scope is silently dropped. wine-library is the closest available workstream bucket; no dedicated inventory workstream exists in the given 9.
- **Verified today:** softDeleteItem confirmed to go straight to .update({is_active:false}) with zero reference checks (lines ~1762-1811); bulk archive action also confirmed absent from InventoryCommandPage.tsx.
- **Duplicates checked:** INVENTORY_ADD_REMOVE_SCENARIOS.md's own section 6 table already tracks item 7 as open informally; this promotes it to a checkable row rather than duplicating the prose.
- **Citations to rewrite:**
  - Citation sweep (2026-09-19, git grep in wt-retire-debt@9c6bdc0be): apps/web/src/pages/cellar/next/cellar-format.ts:10 -- rewrite to point at this item's home once the register is deleted.

### 48. `library-identity-item3-check-constraint-missing` -- WORK / claims-row
**Section:** new line (reuses id ADR-0130, already used by 4 other resolved rows for different parts of the same ADR)

```
{"id": "ADR-0130", "status": "open", "claim": "The CHECK that would make an unowned generic master_wine_library row impossible -- CHECK (provisional_for_restaurant_id IS NOT NULL OR wine_identity_is_specific(producer, name, vintage, region)) -- is still not added. It has been enforceable since #318 removed the producer=name fabrication, but wine-submissions.service.ts#processPendingSubmissions still upserts into master_wine_library with no provisional_for_restaurant_id in its insertPayload, so the constraint would 23514 every promoted submission today. Flips to resolved once that path is given an owner (or an explicit shared-row assertion) and the CHECK lands NOT VALID.", "verify": "grep -rq 'wine_identity_is_specific(producer, name, vintage, region)' supabase/migrations/*.sql && python3 -c \"import pathlib,sys; s=pathlib.Path('apps/api-gateway/src/wines/wine-submissions.service.ts').read_text(); i=s.index('async processPendingSubmissions'); sys.exit(0 if 'provisional_for_restaurant_id' in s[i:i+10220] else 1)\"", "verified": "2026-09-19"}
```

- **Workstream:** wine-library | **Effort:** S
- **Why:** Deliberately reused id ADR-0130 rather than inventing a new one, matching this file's own convention of one ADR id spanning several independent claim lines.
- **Verified today:** No CHECK exists in any migration; processPendingSubmissions's insertPayload confirmed to have no provisional_for_restaurant_id key among its 11 fields.
- **Duplicates checked:** Read all 4 existing ADR-0130 rows: none covers this CHECK constraint. ADR 0130's own file (line 281-293) states this gap almost verbatim -- this promotes existing, still-accurate prose into an active, CI-enforced row.

### 49. `models-F2` -- WORK / claims-row
**Section:** new line

```
{"id": "DEBT-API-SPEND-NODE-GAP", "status": "open", "claim": "Every one of apps/api-gateway's 9 Node LLM call sites (ux-optimizer, vendor-page-extractor, inbound-responder, document-extractor, photo-count, scan-parser, ask-ai, goals.service, consultants.service) writes to api_spend when it invokes a model, so Node-issued calls are not invisible to the cost ledger the way they are today (0 of 9 reference it). api_spend's own 25-day production silence (183 rows, last 2026-08-24) is a separate fact about the Python-side spend jobs and is not what this claim checks.", "verify": "python3 -c \"files=['apps/api-gateway/src/ux-optimizer/ux-optimizer.service.ts','apps/api-gateway/src/vendor-intel/vendor-page-extractor.service.ts','apps/api-gateway/src/common/orchestrator/inbound-responder.service.ts','apps/api-gateway/src/procurement/documents/document-extractor.service.ts','apps/api-gateway/src/inventory/photo-count.service.ts','apps/api-gateway/src/menus/parsers/scan-parser.service.ts','apps/api-gateway/src/ask-ai/ask-ai.service.ts','apps/api-gateway/src/analytics/goals.service.ts','apps/api-gateway/src/analytics/consultants.service.ts']; covered=sum(1 for f in files if 'api_spend' in open(f).read()); import sys; sys.exit(0 if covered==len(files) else 1)\"", "verified": "2026-09-19"}
```

- **Workstream:** security-money | **Effort:** M
- **Why:** Founder flip decide->work (one of 11). Checkable purely by grep across 9 named files; the 25-day production-gap half is a live-data fact and stays as descriptive context only, per the static-check constraint.
- **Verified today:** Confirmed 0 of the 9 named files reference api_spend.
- **Duplicates checked:** Only OD-04/OD-61/OD-74 track the Python ledger's own columns, not this Node-side gap. PR #394 (unmerged) states the same fact in prose in a new SOFTWARE-MAP.md section -- that is narrative, this is the enforced check; both can stand.

### 50. `no-eval-harness-9-llm-call-sites` -- WORK / claims-row
**Section:** new line

```
{"id": "DEBT-NO-EVAL-HARNESS-9-SITES", "status": "open", "claim": "Every one of the 9 apps/api-gateway LLM call sites (ux-optimizer, vendor-page-extractor, inbound-responder, document-extractor, photo-count, scan-parser, ask-ai, goals.service, consultants.service -- 8 distinct directories) has an eval or golden-set test file of its own; currently none of the 8 directories has one.", "verify": "python3 -c \"import os,sys; dirs=['apps/api-gateway/src/ux-optimizer','apps/api-gateway/src/vendor-intel','apps/api-gateway/src/common/orchestrator','apps/api-gateway/src/procurement/documents','apps/api-gateway/src/inventory','apps/api-gateway/src/menus/parsers','apps/api-gateway/src/ask-ai','apps/api-gateway/src/analytics']; covered=0\nfor d in dirs:\n    has=False\n    for root,_,files in os.walk(d):\n        for f in files:\n            if 'eval' in f.lower() or 'golden' in f.lower(): has=True\n    if has: covered+=1\nsys.exit(0 if covered==len(dirs) else 1)\"", "verified": "2026-09-19"}
```

- **Workstream:** analytics-models | **Effort:** L
- **Why:** Verify requires ALL 8 directories to gain an eval file before flipping resolved, so a partial harness build-out does not prematurely mark this stale.
- **Verified today:** Confirmed 0 of 8 call-site directories have an eval/golden file; also independently confirmed the 9-call-site count (not the register's original 5) by grepping for modelClient.call.
- **Duplicates checked:** No existing row; PR #394's model-client-router section states the same fact in prose (complementary, not duplicate).

### 51. `offline-storage-swallow` -- WORK / claims-row
**Section:** new line

```
{"id": "ADR-0140-STORAGE-SWALLOW", "status": "open", "claim": "offline-storage.ts's write and read paths (idbPut/localStoragePut, idbGetAll/localStorageGetAll) still swallow a persistence failure silently -- a write failure does not propagate so addPendingMutation/updatePendingMutation cannot reject, and a read failure is indistinguishable from a genuinely empty queue (ADR 0140 point 5: 'the real fix is at the storage layer', filed there and deferred -- five prior fix attempts at the door-outbox layer above this were each withdrawn as themselves unsafe).", "verify": "python3 -c \"import re,sys\ns=open('apps/web/src/lib/offline-storage.ts').read()\ndef body(name):\n    m=re.search(r'\\n(?:export )?(?:async )?function '+re.escape(name)+r'(<[^>]*>)?\\(', s)\n    rest=s[m.end():]\n    nxt=re.search(r'\\n(?:export )?(?:async )?function |\\nexport const', rest)\n    return rest[:nxt.start()] if nxt else rest\nb0=body('idbPut'); b1=body('localStoragePut'); b2=body('idbGetAll'); b3=body('localStorageGetAll')\ndefect = ('throw' not in b0 and 'localStoragePut(storeName, value)' in b0 and 'throw' not in b1 and 'throw' not in b2 and 'localStorageGetAll' in b2 and 'throw' not in b3 and 'return []' in b3)\nsys.exit(1 if defect else 0)\"", "verified": "2026-09-19"}
```

- **Workstream:** receiving-documents | **Effort:** M
- **Why:** ADR 0140 explicitly names this as filed-but-deferred to the file being deleted, making it one of the most load-bearing items needing a new home; both its citations of v3.0-TECH-DEBT.md should be repointed to this row.
- **Verified today:** Confirmed all four function bodies swallow the failure (idbPut's catch calls localStoragePut with no throw; localStoragePut's catch is console.error only; both getAll variants catch-and-return [] with no throw); exit 1 on this pass = defect confirmed still present.
- **Duplicates checked:** The existing ADR-0140 CLAIMS row covers a different fact (no durable stranded-receipt witness, resolved) and explicitly defers this exact defect to the register being deleted -- not a duplicate, first row for the storage-layer swallow itself.
- **Citations to rewrite:**
  - .planning/decisions/0140-the-door-outbox-keeps-the-receipt-and-claims-nothing-it-cannot-prove.md:7
  - .planning/decisions/0140-the-door-outbox-keeps-the-receipt-and-claims-nothing-it-cannot-prove.md:62-63
  - Citation sweep (2026-09-19, git grep in wt-retire-debt@9c6bdc0be): apps/web/src/lib/doorOutbox.ts:71 -- rewrite to point at this item's home once the register is deleted.

### 52. `orders-wire-item4-createorderrequest-mismatch` -- WORK / claims-row
**Section:** new line

```
{"id": "DEBT-CREATEORDERREQUEST-DTO-MISMATCH", "status": "open", "claim": "CreateOrderRequest/UpdateOrderRequest (apps/web/src/services/api/types.ts) declare only fields their gateway DTOs actually have -- CreateOrderDto uses inventoryId with no unitPrice, UpdateOrderDto uses finalPrice/totalCost with no unitPrice. Currently CreateOrderRequest still declares wineId/unitPrice and UpdateOrderRequest still declares unitPrice, neither of which its DTO has.", "verify": "python3 -c \"import re,sys\nweb=open('apps/web/src/services/api/types.ts').read()\ndto=open('apps/api-gateway/src/procurement/dto/procurement.dto.ts').read()\ndef iface(name,text):\n    m=re.search(r'export interface '+name+r' \\{', text)\n    rest=text[m.end():]\n    return rest[:rest.index(chr(10)+'}')]\ndef cls(name,text):\n    m=re.search(r'export class '+name+r' \\{', text)\n    rest=text[m.end():]\n    nxt=re.search(r'\\nexport (class|interface) ', rest)\n    return rest[:nxt.start()] if nxt else rest\ncreate_req=iface('CreateOrderRequest',web); update_req=iface('UpdateOrderRequest',web)\ncreate_dto=cls('CreateOrderDto',dto); update_dto=cls('UpdateOrderDto',dto)\nmismatch = ('wineId' in create_req and 'wineId:' not in create_dto and 'unitPrice' in create_req and 'unitPrice:' not in create_dto and 'unitPrice' in update_req and 'unitPrice:' not in update_dto)\nsys.exit(1 if mismatch else 0)\"", "verified": "2026-09-19"}
```

- **Workstream:** procurement-orders | **Effort:** S
- **Why:** Destination explicitly names an existing guard script to extend; the CLAIMS row proves the guard row would pass today and documents the exact literal to add.
- **Verified today:** Confirmed: CreateOrderRequest (types.ts:390-396) has wineId/unitPrice; CreateOrderDto has inventoryId and no unitPrice; UpdateOrderDto has quotedPrice/negotiatedPrice/finalPrice/totalCost, no unitPrice.
- **Duplicates checked:** scripts/check_web_reads_gateway_dto_keys.py's MIRRORS tuple has 4 rows, none for these two interfaces -- not a duplicate; drafted as proof a new MIRRORS row would pass, since this pass cannot edit code.

### 53. `orders-wire-item5-menu-import-unclassified` -- WORK / claims-row
**Section:** new line

```
{"id": "DEBT-MENU-IMPORT-CLASSIFIER-NOT-WIRED", "status": "open", "claim": "wine-submissions.service.ts's menu_import writer supplies a data_enrichment.menu_category hint so trg_wine_beverage_kind's classifier can set classification_status to 'classified' instead of unconditionally 'unclassified' -- currently the insert payload sets primary_type:'unknown' and never sets data_enrichment at all, so every menu_import row is unclassified by construction regardless of production row counts (78 of 78 live 2026-09-18).", "verify": "python3 -c \"import sys\ns=open('apps/api-gateway/src/wines/wine-submissions.service.ts').read()\nsys.exit(1 if 'data_enrichment' not in s else 0)\"", "verified": "2026-09-19"}
```

- **Workstream:** wine-library | **Effort:** M
- **Why:** Traced the mechanism to the DB trigger (wine_classify_beverage_kind) to confirm this is a deterministic, always-unclassified construction bug rather than merely a correlated production count.
- **Verified today:** Confirmed 'data_enrichment' does not appear anywhere in the file; both insert payloads hardcode primary_type:'unknown' with no menu_category input.
- **Duplicates checked:** No existing row for menu_import/classification_status/beverage_kind.

### 54. `provider-intelligence-12-cross-tenant` -- WORK / claims-row
**Section:** new line

```
{"id": "DEBT-PROVIDER-INTELLIGENCE-CROSS-TENANT", "status": "open", "claim": "Every one of the 12 ProviderIntelligenceService read methods without a tenancy fix yet (getKnowledge, getContradictions, getPromotions, getAllActivePromotions, getExpiringPromotions, getPromoSavings, comparePromotions, getConversationMemory, searchConversationMemory, getSessions, getSessionSummary, getLeverageSignals) takes a restaurantId and scopes its query by it, the same fix already shipped for compareProviders/getSentimentTrend/getIntelligence. Currently 0 of the 12 do, and provider-intelligence.controller.ts calls the 4 promotions routes with zero arguments, so any signed-in user at any restaurant reads every other restaurant's vendor promotions, knowledge, conversation memory and sessions.", "verify": "python3 -c \"import re,sys\ns=open('apps/api-gateway/src/providers/provider-intelligence.service.ts').read()\nmethods=['getKnowledge','getContradictions','getPromotions','getAllActivePromotions','getExpiringPromotions','getPromoSavings','comparePromotions','getConversationMemory','searchConversationMemory','getSessions','getSessionSummary','getLeverageSignals']\ndef signature(name):\n    m=re.search(r'\\basync '+name+r'\\(', s)\n    i=m.end(); depth=1; j=i\n    while depth>0:\n        if s[j]=='(': depth+=1\n        elif s[j]==')': depth-=1\n        j+=1\n    return s[i:j]\nscoped=sum(1 for m in methods if 'restaurantId' in signature(m))\nsys.exit(0 if scoped==len(methods) else 1)\"", "verified": "2026-09-19"}
```

- **Workstream:** auth-tenancy | **Effort:** M
- **Why:** High-severity live cross-tenant data leak; reclassified from the source's security-money bucket to auth-tenancy since the defect class is missing tenant scoping, matching the already-fixed sibling methods' fix pattern. Verify requires ALL 12 methods scoped before flipping, so partial fixing keeps this correctly open.
- **Verified today:** Confirmed 0 of 12 now take restaurantId; separately confirmed the controller calls getAllActivePromotions()/comparePromotions()/getPromoSavings() with zero arguments.
- **Duplicates checked:** No existing row for ProviderIntelligenceService/getAllActivePromotions/comparePromotions.

### 55. `retire-doorreceipt-markdelivered` -- WORK / claims-row
**Section:** new line

```
{"id": "DEBT-RETIRE-DOORRECEIPT-MARKDELIVERED", "status": "open", "claim": "recordDoorReceipt (apps/web/src/services/api/receiving.ts) and ProcurementService.markDelivered (apps/api-gateway/src/procurement/procurement.service.ts) are retired once their remaining callers -- doorOutbox.ts, useOrdersData.ts, the one-tap-actions delivery-confirm flow, and apps/mobile's supply/[id].tsx -- move onto one booking path. Currently both functions still exist and are still called from all of these.", "verify": "! grep -q \"async markDelivered\" apps/api-gateway/src/procurement/procurement.service.ts && ! grep -q \"async recordDoorReceipt\" apps/web/src/services/api/receiving.ts", "verified": "2026-09-19"}
```

- **Workstream:** receiving-documents | **Effort:** M
- **Why:** Re-traced all call sites individually to confirm none has moved off these two functions yet; both are simple existence checks so the row auto-flips once the last caller migrates.
- **Verified today:** Both functions confirmed present (procurement.service.ts:4077, receiving.ts:123) and called from doorOutbox.ts, useOrdersData.ts, one-tap-actions.service.ts, and apps/mobile's supply/[id].tsx.
- **Duplicates checked:** No existing row names this retirement.

### 56. `seal-migrations-character-class` -- WORK / claims-row
**Section:** new line

```
{"id": "ADR-0104-SEAL-KIND-CHARACTER-CLASS", "status": "open", "claim": "Every seal-widening migration parses the admitted subject_kind list with a full-quoted-literal regex (matching 20260906200000's corrected pattern), never the character class that silently drops a kind holding a digit or a capital. Currently 3 files still use the old character-class pattern at 5 sites (20260905225000, 20260905233000, 20260906070000); all three are already applied to production so the fix is a new migration, not an edit to these three. Latent only: no existing kind holds a digit or capital yet.", "verify": "python3 -c \"files=['supabase/migrations/20260905225000_a_message_is_metered_before_it_is_billed.sql','supabase/migrations/20260905233000_a_house_keeps_its_own_copy_of_its_mail.sql','supabase/migrations/20260906070000_a_series_is_armed_by_a_person.sql']\nn=sum(open(f).read().count(chr(39)*3+'([a-z_]+)'+chr(39)*3) for f in files)\nimport sys; sys.exit(0 if n==0 else 1)\"", "verified": "2026-09-19"}
```

- **Workstream:** ci-tooling | **Effort:** S
- **Why:** ADR 0104 is the clear owning ADR (already fixed the 4th sibling file with this exact pattern) and explicitly defers this one to the file being deleted. Workstream is a judgment call -- the 3 broken migrations are messaging/mail/scheduling-flavored, not one product bucket, so filed under ci-tooling as a shared migration-safety-pattern defect.
- **Verified today:** Confirmed 5 occurrences of the vulnerable pattern across the 3 named files at exactly the cited line numbers; 20260906200000 confirmed to already use the corrected full-literal pattern.
- **Duplicates checked:** No existing row; ADR 0104 line 615 says this was filed as OPEN in v3.0-TECH-DEBT.md, confirming no CLAIMS/OD row exists yet.
- **Citations to rewrite:**
  - .planning/decisions/0104-every-incoming-document-renders-as-one-canonical-mudavym-document.md:615

### 57. `seasonality-zero-fill` -- WORK / claims-row
**Section:** new line

```
{"id": "DEBT-SEASONALITY-ZERO-FILL", "status": "open", "claim": "getSeasonality (advanced-analytics.service.ts) only counts a day as a zero-sales night when that day falls within the restaurant's own recorded history, excluding a day before its first recorded row from dayOfWeekProfile/seasonalDecompose/trendPerPeriodPct instead of dragging a new or patchy house's numbers down. Currently values.push(byDay.get(day) || 0) runs unconditionally across the full fixed 90-day window.", "verify": "! grep -q \"values.push(byDay.get(day) || 0)\" apps/api-gateway/src/analytics/advanced-analytics.service.ts", "verified": "2026-09-19"}
```

- **Workstream:** analytics-models | **Effort:** S
- **Why:** Single deterministic line, exact match to the finding's own evidence.
- **Verified today:** Confirmed advanced-analytics.service.ts:387 literally reads values.push(byDay.get(day) || 0), feeding dayOfWeekProfile, seasonalDecompose and trendPerPeriodPct exactly as claimed.
- **Duplicates checked:** No hits anywhere in the corpus (source tag: found 2026-09-18, owed) -- genuinely new finding.

### 58. `slice4-uuid-guard-gap` -- WORK / claims-row
**Section:** new line

```
{"id": "ADR-0104-ID-ONLY-ROUTES-UUID-GUARD", "status": "open", "claim": "documents.controller.ts's plain :id routes (GET /procurement/documents/:id detail, POST :id/verify verify, POST :id/match match) call requireUuid on their id param before it reaches Postgres, the same guard ADR 0104 already put on the 8 :lineId call sites. Currently none of the three does (detail:1251, match:1361, verify:1991), so a malformed id 500s instead of 400ing.", "verify": "python3 -c \"import re,sys\ns=open('apps/api-gateway/src/procurement/documents/documents.controller.ts').read()\ndef handler_body(name):\n    m=re.search(r'\\n  async '+name+r'\\(', s)\n    rest=s[m.end():]\n    nxt=re.search(r'\\n  @|\\n  async ', rest)\n    return rest[:nxt.start()] if nxt else rest\nguarded=sum(1 for n in ('detail','match','verify') if 'requireUuid(id' in handler_body(n))\nsys.exit(0 if guarded==3 else 1)\"", "verified": "2026-09-19"}
```

- **Workstream:** procurement-orders | **Effort:** S
- **Why:** ADR 0104 is the clear owning ADR; this row tracks precisely the gap its own resolved CLAIMS row does not cover, verified against the actual handler bodies.
- **Verified today:** Confirmed all three NOT guarded by reading each handler body directly (detail queries .eq('id', id) straight from @Param; match passes id straight to matchDocumentLines; verify passes id straight through).
- **Duplicates checked:** The existing resolved CLAIMS row id 'ADR-0104' already asserts >=8 requireUuid( calls exist (true, on the :lineId routes) and is not contradicted by this new row, which targets the 3 :id-only routes that same ADR's text says were explicitly out of scope.

### 59. `vendor-lens-memory-no-reconciler` -- WORK / claims-row
**Section:** new line

```
{"id": "DEBT-VENDOR-LINE-MAPPING-RECONCILER", "status": "open", "claim": "line-mapping.service.ts exports a reconcile/replay function so a memory write that failed (record() returning ok:false, already logged honestly via linkLineToItem's logger.warn and surfaced as memoryNote -- this is not an absence-reported-as-health bug) can be retried later instead of being lost for that document/line forever. Currently no such export exists. Not yet observed in practice -- low severity, build only if the failure is actually seen.", "verify": "grep -qiE \"export (async )?function (reconcile|replay)|reconcile\\(|replayMapping\" apps/api-gateway/src/procurement/canonical/line-mapping.service.ts", "verified": "2026-09-19"}
```

- **Workstream:** procurement-orders | **Effort:** M
- **Why:** Read record()'s and linkLineToItem's actual bodies to confirm the failure mode precisely rather than assuming from the title; low severity and conditional build-priority preserved in the claim text itself.
- **Verified today:** Confirmed no reconcile/replay identifier anywhere in the file's export list (MappableLine, MappingKey, RememberedPairing, compositeKey, mappingKeyFor, LineMappingService only) -- since this is a positive-match grep (not negated), a 0-match result correctly means exit 1, i.e. the fix does not exist yet, matching status open.
- **Duplicates checked:** ADR 0104 D12 slice-4 CLAIMS rows cover memory forgets-on-unlink, no-percentage-shown, failed-READ surfacing, and restaurant+provider scoping -- all reads, none about a failed WRITE's reconciler; traced record()'s call site to confirm the write failure is already honestly logged (not a silent swallow), so this is additive, not a duplicate.

### 60. `models-F4` -- WORK / claims-row
**Section:** new line

```
{"id": "DEBT-WINE-EMBEDDING-UNREAD", "status": "open", "claim": "wine_matcher.py's _vector_search actually queries master_wine_library.embedding via pgvector RPC (Phase 1b is not a stub) -- currently the function body contains no .rpc(/.select( call and unconditionally returns [], so the wine-enrichment embeddings the pipeline populates are never read by any matching query; 0 real restaurants have an enriched wine and only a minority of stocked wines carry a non-placeholder sensory profile (measured 2026-09-18).", "verify": "python3 -c \"import re,sys\ns=open('services/agent-orchestrator/services/wine_matcher.py').read()\nm=re.search(r'async def _vector_search.*?(?=\\n    async def |\\n    def |\\Z)', s, re.S)\nbody=m.group(0) if m else ''\nsys.exit(0 if ('.rpc(' in body or '.select(' in body) else 1)\"", "verified": "2026-09-19"}
```

- **Workstream:** wine-library | **Effort:** L
- **Why:** Founder flip decide->work (one of 11): the fund-vs-descope call stays open for later, but the underlying defect (embeddings computed, never queried) is deterministically checkable in code today.
- **Verified today:** Confirmed _vector_search's body reads 'if not self.supabase: return []' then a try block that also returns [], with no .rpc(/.select( call anywhere in it.
- **Duplicates checked:** No existing row; not a duplicate of OD-102 (a different fork about which table Phase 1 should search). PR #394 adds a matching wine-intelligence section citing the same broken-enrichment finding in prose; this CLAIMS row is the code-level enforcement of the same fact.

### 61. `models-missed-M2` -- WORK / claims-row
**Section:** new line

```
{"id": "ADR-0120-HAIKU-ALIAS-UX-OPTIMIZER", "status": "open", "claim": "ux-optimizer.service.ts's llmProposals defaults to the undated claude-haiku-4-5 alias, matching the founder's 2026-09-04 decision (ADR 0120 / model-routing.ts) already applied to goals.service.ts and ask-ai.service.ts. Currently it still falls back to the dated claude-haiku-4-5-20251001 pin.", "verify": "test \"$(grep -c 'claude-haiku-4-5-20251001' apps/api-gateway/src/ux-optimizer/ux-optimizer.service.ts)\" = 0", "verified": "2026-09-19"}
```

- **Workstream:** analytics-models | **Effort:** S
- **Why:** Single-line, deterministically checkable, ties directly to a locked ADR naming the correct alias.
- **Verified today:** Confirmed the dated pin still present at ux-optimizer.service.ts:272 (grep -c returns 1, so the test fails, exit 1, open).
- **Duplicates checked:** No existing row for this file (ADR-0120's own text names only the two already-fixed files).

### 62. `44.2b` -- WORK / claims-row
**Section:** new line

```
{"id": "DEBT-REPORTINGAGENT-STOCK-EVENTS-INTENTIONAL", "status": "resolved", "claim": "ReportingAgent's non-subscription to stock.events is intentional, tested, current behaviour -- not an open gap. v3.0-TECH-DEBT's 44.2b framed Phase 21 success criterion #2 ('stock.events -> NotificationAgent + ReportingAgent') as unmet, but the criterion's own premise has been false since 2026-07-31 (.planning/archive/ROADMAP-pre-P2-20260825.md:109: 'the code was right; the criterion overstated'); the live ROADMAP.md makes no such claim today. services/agent-orchestrator/tests/test_event_topology.py:76-80 (test_reporting_agent_does_not_listen_to_stock_events) pins the current non-subscription as deliberate: reporting is schedule/on-demand, and subscribing it to stock.events would fire a report on every pour.", "verify": "python3 -c \"import sys; src=open('services/agent-orchestrator/tests/test_event_topology.py').read(); i=src.index('def test_reporting_agent_does_not_listen_to_stock_events'); j=src.index(chr(10)+'    def ', i+10); block=src[i:j]; sys.exit(0 if 'assert not any(exchange == \\\"stock.events\\\" for exchange, _ in keys)' in block else 1)\"", "verified": "2026-09-19"}
```

- **Workstream:** analytics-models | **Effort:** S
- **Why:** MOST SIGNIFICANT DEVIATION IN THIS BATCH, KEPT AND STRENGTHENED: founder mark is WORK (one of the 11 decide->work flips), but re-checking the state it depends on (per the task's explicit re-check instruction) shows the underlying premise has been false since 2026-07-31 -- the live roadmap makes no such claim and a passing test pins the code's current behaviour as CORRECT AND INTENTIONAL. v3.0-TECH-DEBT.md's Track A framing appears to have copied this forward from the historical v2.0-MILESTONE-AUDIT.md without re-verifying against the post-P2 roadmap reset -- exactly the 'prose rots because nothing re-reads it' failure CLAUDE.md §5b exists to prevent. Writing a new open CLAIMS row here would itself be a fixed-but-marked-open row from the moment it is written, which directly violates §5b. NOT overriding the founder's WORK mark -- reporting that there is no longer any live inconsistency for that mark to attach WORK to. Recommend surfacing this back to the founder rather than filing it as a defect; this is the one item in the whole 230 where I recommend a human decision on whether the mark itself needs revisiting. ADDED 2026-09-19 (r4-placement.json issue 6): a bare drop would let the founder's WORK mark and its settled premise vanish with the register with no durable trace. A RESOLVED CLAIMS row (not open -- the underlying question is already answered, by a passing test, not by a fix still owed) pins services/agent-orchestrator/tests/test_event_topology.py:76-80 so a future regression (someone 'fixing' 44.2b by actually wiring the subscription) would be caught by check_decision_claims.sh flagging a resolved claim that no longer holds. Mutation-tested in a fresh git-archive mirror: baseline exit 0 (resolved, holds today); after replacing the assert with a no-op (simulating the subscription being wired back in, i.e. a regression), exit 1 (correctly flags REGRESSED); restored, exit 0, mirror clean.
- **Verified today:** INDEPENDENTLY RE-VERIFIED by this placement pass (not just carried from the source item): the live ROADMAP.md (72 lines total) has zero occurrences of stock.events/ReportingAgent/Phase 21; .planning/archive/ROADMAP-pre-P2-20260825.md:109 shows this exact contradiction was found and corrected on 2026-07-31 ('the code was right; the criterion overstated'); services/agent-orchestrator/tests/test_event_topology.py:76-80 has a live, passing test (test_reporting_agent_does_not_listen_to_stock_events) asserting the current non-subscription IS the intended, tested behaviour. The only places still stating the old contradiction are v3.0-TECH-DEBT.md itself (being deleted) and two frozen historical records (v2.0-MILESTONE-AUDIT.md, the pre-P2 archive), which this vault's convention leaves untouched.
- **Duplicates checked:** No existing CLAIMS/OD row references ReportingAgent's stock.events subscription (the one 'reporting_agent' hit, OD-99, is an unrelated phantom-table-reads question).
- **Citations to rewrite:**
  - .planning/07-reference/v2.0-MILESTONE-AUDIT.md:83,94,190 and .planning/archive/ROADMAP-pre-P2-20260825.md:109,716 both restate the old finding but are correctly frozen historical/archive records -- leave untouched, not rewritten

### 63. `44.1f` -- DECIDE / pointer to an EXISTING claims row
**Section:** existing row id ADR-0162-MEMBERSHIP-ONLY-SESSIONS, created via key 44.1r in this same plan

```
No new entry. 44.1f's underlying code fact (switchRestaurant's organisation-level fallback, auth.service.ts:460-511) is the SAME code this plan's 44.1r CLAIMS row (ADR-0162-MEMBERSHIP-ONLY-SESSIONS) already covers as part of its combined check. Point 44.1f at that row rather than drafting a second, near-duplicate CLAIMS row.
```

- **Workstream:** auth-tenancy | **Effort:** M
- **Why:** STRUCTURE-CRITIC CORRECTION, overriding the literal 'decide' mark: traced this past the register's framing and found ADR 0162's 4th addendum ('Sessions', 2026-09-18) already asked this exact fork and the founder already answered 'Membership only' the same day -- what's missing is the BUILD, not the decision. A fresh OPEN-DECISIONS row re-asking 'which model should govern this' would misrepresent an already-decided question as open. Also merged with the near-duplicate CLAIMS row 44.1r's own batch independently drafted for the same code gap (see 44.1r's placement) -- one open row, not two, for one code fact.
- **Verified today:** Confirmed both anchors (auth.service.ts:399 scopedRestaurantId, :474 'Legacy fallback' comment) are still present, matching 44.1r's own re-verification.
- **Duplicates checked:** Near-duplicate of 44.1r's CLAIMS row: two different register entries (44.1f, 44.1r) describe the same switchRestaurant org-fallback code; two different batch agents drafted overlapping rows (this plan's 44.1r keeps 'ADR-0162-MEMBERSHIP-ONLY-SESSIONS'; a near-duplicate 'ADR-0162-SWITCH-MEMBERSHIP-ONLY' from 44.1f's own batch is dropped).

### 64. `atlas-backbone-F4` -- DECIDE / pointer to an EXISTING claims row
**Section:** existing row id 'ADR-0103' (retroactive-order endpoint retirement)

```
No new row. When the existing CLAIMS row id 'ADR-0103' (verify: ! grep -q 'retroactive-order' apps/api-gateway/src/providers/providers.controller.ts) executes its fix, fold in -- same PR, not a second decision -- two things its verify doesn't check: delete the dangling UI copy at apps/web/src/pages/Notifications.tsx:607 ('...or create a retroactive order.') and the dead import 'RetroactiveOrderDto' at providers.controller.ts:33.
```

- **Workstream:** procurement-orders | **Effort:** S
- **Why:** STRUCTURE-CRITIC CORRECTION, overriding the literal 'decide' mark: read ADR 0103 in full and found the founder already Locked retirement of this exact endpoint before this review ran. The atlas finding's real, non-duplicate contribution -- the frontend copy and dead import surviving backend deletion -- is folded into the existing row's fix scope instead of a new decision.
- **Verified today:** Ran the existing row's own verify: grep -q 'retroactive-order' providers.controller.ts finds it at :33 (import) and :805 (@Post decorator), confirming open/current; confirmed zero static callers anywhere in apps/web/apps/mobile/services; confirmed Notifications.tsx:607 is descriptive copy only.
- **Duplicates checked:** Effectively a duplicate of the existing 'ADR-0103' CLAIMS row once traced to ADR 0103 D5 (Locked 2026-09-02/03, 'Retired: POST /providers/:id/retroactive-order') -- the founder already decided retirement at the backend level; filing a fresh OD asking whether to wire it up would contradict a Locked ADR.

### 65. `adr0141-null-restaurant-id-deferred` -- MOVE / pointer to an EXISTING claims row
**Section:** Line 262 -- existing row id 'ADR-0141' already tracks this precisely

```
No new entry.
```

- **Workstream:** auth-tenancy | **Effort:** S
- **Why:** This checkable code defect is already fully and correctly tracked as an open CLAIMS row -- the WORK rule ('reuse an existing row, never duplicate') applies even though the founder's mark here is MOVE, because the item is already fully placed; dropping the tech-debt copy loses nothing.
- **Verified today:** Ran the existing row's own verify: grep -q p_restaurant_id in database.py -> exit 0 (present, but only as a read, not a refusal); grep -rq 'p_restaurant_id IS NULL' in supabase/migrations/ -> exit 1 (no refusing migration exists yet) -- confirms the open row's own check still correctly fails to hold today.
- **Duplicates checked:** CLAIMS.jsonl:262 (id ADR-0141) is the same gap, same file:line evidence (services/agent-orchestrator/core/database.py:1077), same open status.
- **Citations to rewrite:**
  - Citation sweep (2026-09-19, git grep in wt-retire-debt@9c6bdc0be): .planning/decisions/0141-a-stock-write-names-the-house-it-is-for.md:114; .planning/decisions/0141-a-stock-write-names-the-house-it-is-for.md:182; supabase/migrations/20260912163000_a_stock_write_names_its_house.sql:55 -- rewrite to point at this item's home once the register is deleted.


## `.planning/decisions/OPEN-DECISIONS.md`  (28 items)

### 66. `2335` -- DECIDE / new OPEN-DECISIONS row
**Section:** ## Open (new row)

```
| OD-NEW | **ADR 0137 (legacy e2e waves D/E/G retired) is fully built and unopposed -- it just needs the founder's lock.** All three wave files are confirmed deleted on train/finish-2 (zero wave_d_toast_pipeline.py/wave_e_gmail_pipeline.py/wave_g_calendar.py, no leftover wave-letter entries in conftest_prod.py), and all five tracking claims (ADR-0137-a through -e in CLAIMS.jsonl) read resolved. The ADR's own Status: line still reads "Proposed -- founder review pending", and decisions/README.md:150 repeats the same pending framing a week after the work landed. | Nothing technical hangs on this -- pure paperwork lag. But CLAUDE.md §0.2 treats an un-Locked ADR as not-yet-a-decision, and this has sat Proposed for a week after independent verification, exactly the stale-record gap §5b exists to catch. | Founder reads ADR 0137 (short; every claim in it is already CI-green) and flips Status: to Locked; update decisions/README.md:150's parenthetical to match. No code change required. |
```

- **Workstream:** docs-records | **Effort:** S
- **Why:** Re-verified independently (file deletion, claims status, ADR status line) rather than trusting the register's framing. Technical content is done; this is a founder sign-off ask, and OPEN-DECISIONS has no other queue for 'please lock this ADR'.
- **Verified today:** Confirmed: no wave_d/wave_e/wave_g files anywhere; all 5 ADR-0137-* CLAIMS rows read resolved; ADR file's Status line still 'Proposed'; README.md:150 still says 'founder review pending'.
- **Duplicates checked:** None -- grepped OPEN-DECISIONS.md for '0137'/'wave_d'/'wave_e'/'wave_g': zero hits.
- **Citations to rewrite:**
  - .planning/decisions/0137-legacy-e2e-waves-d-e-g-are-retired-not-repointed.md:3 (Status line, once locked)
  - .planning/decisions/README.md:150 (drop the pending parenthetical once locked)
  - Citation sweep (2026-09-19, git grep in wt-retire-debt@9c6bdc0be): .planning/decisions/0137-legacy-e2e-waves-d-e-g-are-retired-not-repointed.md:11; .planning/decisions/0137-legacy-e2e-waves-d-e-g-are-retired-not-repointed.md:184; .planning/decisions/0137-legacy-e2e-waves-d-e-g-are-retired-not-repointed.md:193; .planning/decisions/0137-legacy-e2e-waves-d-e-g-are-retired-not-repointed.md:205; .planning/decisions/0137-legacy-e2e-waves-d-e-g-are-retired-not-repointed.md:216; .planning/decisions/0137-legacy-e2e-waves-d-e-g-are-retired-not-repointed.md:239; .planning/decisions/0137-legacy-e2e-waves-d-e-g-are-retired-not-repointed.md:240; .planning/decisions/0137-legacy-e2e-waves-d-e-g-are-retired-not-repointed.md:241 -- rewrite to point at this item's home once the register is deleted.

### 67. `44.14` -- DECIDE / new OPEN-DECISIONS row
**Section:** ## Open (new row)

```
| OD-NEW | **Should the 2026-08-04 unbuilt-plan-backlog table (5 large 07-reference plans) be freshly reconciled before anyone plans against it, or left until each area is next touched?** That table already self-corrected once the day it was written and named work outstanding in ANALYTICS_FEATURE_CATALOG.md, INBOUND_EMAIL_INTELLIGENCE_PLAN.md, INVENTORY_SOTA_PLAN.md, PROSPECTS_ATTRIBUTION_ARCHITECTURE.md and SYNTHETIC_DATA_AND_DOCS_PLAN.md -- none re-checked since. One premise is already known stale: INVENTORY_SOTA_PLAN targets /inventory-legacy, which App.tsx:318 now only redirects to /inventory (retired, ADR 0019 §B). This pass did not re-verify the other four -- a dedicated audit, not a placement-batch check. | A six-week-old backlog list either wastes a session rediscovering what already shipped, or gets built against as current and duplicates something live. | **Recommend: defer, do not commission a standalone reconciliation now.** Put the re-check where the work would happen -- whoever next works in inventory/analytics/inbound-email/attribution/synthetic-data re-verifies that ONE plan's status before planning against it. Alternative, more expensive: a dedicated reconciliation pass now, only if one of these five areas is about to become active work. |
```

- **Workstream:** docs-records | **Effort:** S
- **Why:** Did the one cheap, high-value spot check available rather than opening all 5 large plans, consistent with CLAUDE.md §2's grep-and-excerpt discipline.
- **Verified today:** All 5 files confirmed present under 07-reference/; App.tsx:318 confirms the /inventory-legacy redirect, corroborating INVENTORY_SOTA_PLAN's target page is gone.
- **Duplicates checked:** None (grepped OPEN-DECISIONS.md for each of the 5 filenames and 'unbuilt plan backlog').

### 68. `adr0141-fk-no-tenant-tie` -- DECIDE / new OPEN-DECISIONS row
**Section:** ## Open (new row)

```
| OD-NEW | **Should procurement_orders.inventory_id, procurement_document_lines.inventory_id and pos_item_mappings.inventory_id get a composite FK/trigger tying the referenced item's tenant to the referencing row, or is ADR 0141's write-time check sufficient?** ADR 0141 (Locked 2026-09-12) added a runtime tenant check on the stock-write primitive, but its own "What this does NOT settle" section names this exact gap -- these three FKs are still plain references to restaurant_inventory(id). Re-confirmed on train/finish-2 (latest migration 20260918153000): both FKs I could locate are still plain, unconstrained references; no later migration adds a tenant-tie. | ADR 0141 closed the write-time gate that moves stock; these three are read/mapping surfaces where a foreign-tenant id can still be stored and silently misattribute an order, document line or POS mapping, without a stock write ever catching it. | **Founder call between:** (a) a composite FK (inventory_id, restaurant_id) against a composite unique key -- strongest, touches three tables' schemas and every insert path; (b) a BEFORE INSERT/UPDATE trigger per table asserting the tenant match -- cheaper, doesn't change the FK shape; (c) leave it, on the grounds that the write-time check plus scoped reads already narrow the blast radius and no known exploit path reaches it. **Recommend: (b), a per-table trigger.** ADR 0141 already chose runtime-assert-over-schema-reshape for this exact class of problem (the stock-write primitive got an argument + a raised exception, not a new composite key), so a trigger is the consistent, lower-migration-risk continuation of that pattern across these three tables; (a)'s composite FK is the stronger guarantee and worth it only if the founder wants defense-in-depth beyond ADR 0141's own precedent. No existing CLAIMS/ADR row picks between these. |
```

- **Workstream:** auth-tenancy | **Effort:** L
- **Why:** Re-read ADR 0141's Consequences in full and re-confirmed against the current migration tree that the gap it explicitly deferred is still exactly where it left it.
- **Verified today:** Confirmed both FKs (procurement_orders_inventory_id_fkey in baseline:13150, procurement_document_lines_inventory_id_fkey in 20260906233000:115) are plain, unconstrained; no composite/tenant-tie constraint found through the latest migration.
- **Duplicates checked:** None (grepped 'composite'/'tenant_id.*foreign'/'pos_item_mappings' in OPEN-DECISIONS.md and CLAIMS.jsonl).

### 69. `google-signin-open-question` -- DECIDE / new OPEN-DECISIONS row
**Section:** ## Open (new row)

```
| OD-NEW | **Should gated Google self-signup exist at all (invite-only, domain allowlist, or a low-privilege sandbox tenant), or does "no self-signup" stay the permanent answer?** PR #179 (2026-09-01) removed OAuth self-provisioning outright after it let any Google account mint itself a manager of a real tenant; ADR 0139 (2026-09-12) separately closed a related sign-in/resolve gap. Both explicitly leave this one product question open: "Today the answer is simply 'no self-signup'." | Low urgency (today's answer is safe and functioning), but a real product-scope question -- whether onboarding ever gets a self-serve door -- has sat unanswered since 2026-09-01. | Founder call, no urgency implied: (a) keep "no self-signup" permanently, or (b) build one of the three gated forms named above. If (a), this row can move straight to Resolved on the founder's word alone -- no code path to verify either way. **Recommend: (a), keep "no self-signup" permanently until a concrete product need names itself.** PR #179 closed a real incident (any Google account could mint itself a manager of a real tenant); today's answer is safe, simple and already shipped, and none of the three gated forms in (b) has a demand signal behind it yet -- reopening a closed security surface without one is the wrong default. |
```

- **Workstream:** auth-tenancy | **Effort:** S
- **Why:** Read the full v3.0-TECH-DEBT.md section (1500-1561), not just the excerpt, confirming PR #179's scope deliberately left this question out, twice, by name.
- **Verified today:** Confirmed v3.0-TECH-DEBT.md:1521-1524,1561 still frames this as open and a product decision; 0 hits for 'self-signup' in OPEN-DECISIONS.md.
- **Duplicates checked:** None.
- **Citations to rewrite:**
  - .planning/v3.0-TECH-DEBT.md:1521-1524,1561 (the two places stating this as still-open)

### 70. `models-F5` -- DECIDE / new OPEN-DECISIONS row
**Section:** ## Open (new row)

```
| OD-NEW | **services/self-evolution appears fully inert -- fund/build the learning loop, or retire the service?** main.py's own docstring says the learning engine, A/B testing and meta-agent are "Disabled by default"; nothing outside its own directory calls into it -- the 4 repo-wide hits for self_evolution/self-evolution are all code COMMENTS warning that self-evolution shares an EAV table with other subsystems, not call sites. | A service with zero callers and a disabled-by-default learning loop is either aspirational infrastructure worth funding, or dead weight worth deleting -- leaving it running, doing nothing, is the one option nobody actually chose. | Founder call: (a) fund/build it -- name what "learning from mistakes" should concretely do first, or (b) delete services/self-evolution entirely, since nothing depends on it. No middle ground recommended. |
```

- **Workstream:** analytics-models | **Effort:** M
- **Why:** Went a step further than the source evidence by opening all 4 mentioning files and confirming each is a comment, strengthening rather than merely repeating the isolation claim. Companion to the atlas-backbone-F9 CLAIMS row (deployment files missing) -- this OD is the higher-level fund-or-retire fork that row's resolution clause defers to.
- **Verified today:** Confirmed 'Disabled by default' for all three subsystems in main.py:7-9; opened all 4 files mentioning self-evolution outside its own directory and confirmed each is a comment, not a caller.
- **Duplicates checked:** None (grepped 'self-evolution'/'self_evolution'/'agent_evolution_log' in OPEN-DECISIONS.md/CLAIMS.jsonl).

### 71. `orders-wire-item3b-recurring-auto-approve-no-seal` -- DECIDE / new OPEN-DECISIONS row
**Section:** ## Open (new row)

```
| OD-NEW | **recurring_orders.auto_approve does not silently spend money as originally filed -- it fails closed and silently never completes. Which of two paths replaces it?** Traced the full call chain: recurring-orders.service.ts:887-891 calls procurementService.approveOrder with no challenge argument when auto_approve is true; approveOrder unconditionally calls redeemOrderSeal, which unconditionally calls sealChallenges.redeem, whose first check is "if (!challenge) return refuse('absent')" -- a ForbiddenException. The per-order try/catch swallows that exception and logs it; the order is left unapproved. **This contradicts the original tech-debt entry's own stated mechanism** ('a challenge of undefined is what a seal-less call looks like'), which assumed silent success. auto_approve defaults to false, and the newer order-recurrence.service.ts (ADR 0125) was deliberately built as a sibling that never approves anything -- the two subsystems coexist; any live recurring_orders row with auto_approve=true is currently broken (fails daily, logged), not dangerous. | The framing changes materially: not "money moves with no check" (HIGH, urgent) but "a feature silently never completes and litters logs with a caught ForbiddenException" (real, lower urgency, arguably the safer of the two failure modes). Whether any restaurant has auto_approve=true configured was not queried against production this pass. | **Founder call between:** (a) fix executeRecurringOrder to mint a proper system-issued seal -- NOT recommended, re-opens the exact risk ADR 0116/0125 exist to prevent; (b) retire recurring_orders.auto_approve entirely, routing every recurring schedule through order-recurrence.service.ts's PENDING-then-seal path instead -- collapses two parallel subsystems into the one already built to the founder's safer direction; (c) leave it broken-as-is -- cheapest, but a silently-failing daily cron indefinitely. Recommend (b). |
```

- **Workstream:** security-money | **Effort:** M
- **Why:** Single highest-value re-check in this batch: a 3-file call-chain trace overturns the register's own HIGH-severity, money-adjacent framing. Did not query production for whether any restaurant has auto_approve=true configured (would sharpen urgency, doesn't change which option is right).
- **Verified today:** Traced and confirmed the full 3-file chain: recurring-orders.service.ts:885-894 (3-arg call, no challenge), procurement.service.ts:3465-3472 (unconditional redeemOrderSeal), seal-challenge.service.ts:150-167 ('if (!challenge) return refuse("absent")' as the FIRST check), recurring-orders.service.ts:635-675 (catch-and-log, not propagated).
- **Duplicates checked:** None (OD-31's two claims are about the unrelated Python recurring_order_agent.py).
- **Citations to rewrite:**
  - .planning/v3.0-TECH-DEBT.md:3757-3794 (the section whose stated mechanism this corrects)
  - apps/api-gateway/src/procurement/order-recurrence.service.ts:17-21 (header comment asserting the old path 'spends money with no seal' -- worth a follow-up correction once this OD is decided, not urgent)

### 72. `sommelier-history-broken-by-od72` -- DECIDE / new OPEN-DECISIONS row
**Section:** ## Open (new row)

```
| OD-NEW | **Saved sommelier conversations have never worked in production for 25 days, and the fix is already scoped by an existing open CLAIMS row -- this row is to re-weigh urgency, not the approach.** useSommelierQueries.ts queries sommelier_conversations directly on the browser's anon-key Supabase client. That table's RLS policy is USING (user_id = auth.uid()) -- but this app issues its own gateway JWTs and never hands the Supabase client a session, so auth.uid() is permanently NULL and the policy can never match. OD-72 (Resolved, 2026-08-26) deliberately excepted sommelier_conversations from its grant-revocation sweep "by design -- the single live browser consumer", evidently assuming access already worked; it does not. **The fix is already tracked**: the existing open CLAIMS row tagged "OD-72" (claim: "no file in apps/web/src imports the browser anon-key Supabase client any more... useSommelierQueries is the last one"), filed 2026-08-25, the same day this was first found, still open 25 days later. Its own precedent -- route through the gateway as ADR 0012 did for reports -- is confirmed ALREADY IMPLEMENTED: useReportQueries.ts has zero direct Supabase-client calls today. | Every user's saved wine-chat history silently fails to load and silently fails to save -- a real, live, currently-broken feature, not a hygiene item, sitting as a 25-day-old open claim with no visible movement. | **The approach is not what's undecided** -- route sommelier_conversations through the gateway, mirroring the already-proven ADR 0012 pattern, closing the existing claim's own success condition. **What needs the founder's word is priority**: recommend this currently-broken, every-user-affected feature jumps the queue. |
```

- **Workstream:** wine-library | **Effort:** M
- **Why:** Traced the RLS policy, the auth model and ADR 0012's ACTUAL (not just paperwork) implementation status directly; found the mapped existing CLAIMS row, changing this row's real ask from 'what' (already answered) to 'how urgently' (genuinely open).
- **Verified today:** Confirmed useSommelierQueries.ts:22 queries the table directly; confirmed the RLS policy text (baseline:14017) is unsatisfiable under this app's auth model; confirmed useReportQueries.ts has 0 supabase. calls today (ADR 0012 pattern is live, not just proposed).
- **Duplicates checked:** The underlying fix duplicates the existing open CLAIMS row tagged OD-72 (2026-08-25) almost exactly -- not proposing a second row, only surfacing that it deserves a priority call given the newly-understood severity.
- **Citations to rewrite:**
  - .planning/v3.0-TECH-DEBT.md:154-178 (44.1e, whose 'founder call is OD-72' pointer is stale since OD-72 closed without addressing this half)

### 73. `modules-F3` -- DECIDE / new OPEN-DECISIONS row
**Section:** ## Open (new row)

```
| OD-NEW | **Team Command is documented status: live, but its scheduling subsystem (shifts, time-off, certifications) has zero production data -- is "live" overstating it?** team-command.md:6 reads status: live; the scheduling tables (shifts, shift_breaks, time_off_requests) exist in the schema. Whether they hold 0 rows in production specifically was not re-queried this pass -- the qualitative claim ('built but never used') isn't in dispute. | "Live" status is what other planning docs and founders reason from; if it means "core membership is live but scheduling is unused", that is materially different from "the whole page is exercised in production". | Founder call: (a) leave status: live as-is -- scheduling being unused is an adoption fact, not a build-status fact; or (b) split the status line so the note distinguishes core-membership (live) from scheduling (built, unused), matching how communications-hub.md already handles a similar split (§10, 'hollow' scoped to specific tabs). (b) is cheap (a doc edit). **Recommend: (b).** communications-hub.md §10 already establishes the precedent for exactly this split (scoping "hollow" to specific tabs rather than the whole page), so this is applying an existing convention, not inventing one -- and a status line that overstates a subsystem's real adoption is the same kind of "absence reported as health" failure this repo already has a name for. |
```

- **Workstream:** web-quality | **Effort:** S
- **Why:** Confirmed the doc's literal status line and the tables' existence directly; did not query production row counts since the decision doesn't turn on the exact number.
- **Verified today:** Confirmed team-command.md:6 reads 'status: live'; confirmed shifts/shift_breaks/time_off_requests tables all present in the schema.
- **Duplicates checked:** None (grepped OPEN-DECISIONS.md for 'team-command' status).

### 74. `modules-F6` -- DECIDE / new OPEN-DECISIONS row
**Section:** ## Open (new row)

```
| OD-NEW | **Recommendations are shown (75 recorded impressions per the review) but never acted on (one_tap_actions reportedly empty) despite the act path being built and tested -- UX problem or trust problem?** The build side is real: recommendation-actions.service.ts and migration 20260720120000_recommendation_actions.sql both exist. Whether impressions/actions are exactly 75/0 in production was not re-queried this pass. | A built, tested feature nobody uses is either a UX problem (the action isn't discoverable) or a trust problem (users see the suggestion but don't believe it) -- the fix differs completely depending on which. | Founder call, or route to whoever owns UX research: (a) instrument or interview around why impressions don't convert before building anything new, or (b) treat as a known early-adoption gap and revisit after more usage accumulates. Not a code fork -- a research-priority fork. |
```

- **Workstream:** analytics-models | **Effort:** S
- **Why:** Confirmed the build-side claim directly; did not re-query live impression/action counts since the decision is about research priority, not the exact numbers.
- **Verified today:** Confirmed recommendation-actions.service.ts and the 20260720120000 migration both exist, corroborating the feature is genuinely built.
- **Duplicates checked:** None (grepped OPEN-DECISIONS.md for 'recommendation_impressions'/'one_tap_actions').

### 75. `modules-F8` -- DECIDE / new OPEN-DECISIONS row
**Section:** ## Open (new row)

```
| OD-NEW | **The public, unauthenticated vendor-portal endpoint has zero spec files -- worth hardening before it takes real vendor traffic?** apps/api-gateway/src/vendor-portal/ has 3 source files, 0 .spec.ts files, and both controller routes are @Public() -- the one gateway surface anyone on the internet can hit without a token. | Untested code is a risk anywhere; untested code with no auth gate at all is the highest-exposure, lowest-coverage combination this review found in the gateway. | Recommend: yes, prioritize -- add spec coverage before any real vendor is onboarded through it, ahead of most other coverage gaps in this batch given the public-internet exposure. This is a WORK item once agreed; the row's job is the founder's priority sign-off given it competes with other work. |
```

- **Workstream:** procurement-orders | **Effort:** S
- **Why:** Flagged as the most time-sensitive DECIDE item in the whole batch given the public-exposure combination, said explicitly rather than treating all decide items as equally low-stakes.
- **Verified today:** Confirmed exactly 3 files, 0 matching *.spec.ts; both @Public() decorators confirmed at lines 22 and 46.
- **Duplicates checked:** None.

### 76. `postgis-definer-functions-informal` -- DECIDE / new OPEN-DECISIONS row
**Section:** ## Open (new row)

```
| OD-NEW | **Two named residuals from ADR 0159's SECURITY DEFINER hardening sweep need an explicit founder accept/harden call (grouped: they are the same "is this residual acceptable" question asked twice).** (a) PostGIS: production's three st_estimatedextent overloads are anon/authenticated-executable, owned by supabase_admin via the postgis extension (arriving through "create extension if not exists postgis", not any migration ADR 0159's guard can see); ADR 0159 names this residual explicitly and it remains unratified (the ADR itself is still Proposed, not Locked). (b) Trigger/aggregate reach: ADR 0159's own self-test proved a SECURITY DEFINER trigger function fired as postgres on an anon-writable table, and a closed definer used as an aggregate's state function, both slip past today's guard (check_definer_functions_closed.py exits 0 on both scenarios); 0 user-defined aggregates exist today so (b) is not currently exploitable, and SECURITY DEFINER trigger functions do exist but require a client role holding INSERT/UPDATE/DELETE on the trigger-owning table, which is absent today. | (a) is low-risk (extension-owned geometry math) but "probably benign" has never been formally accepted anywhere in this repo's decision trail -- CLAUDE.md §0.1 treats an unwritten choice as open regardless of how safe it looks. (b) is a real guard blind spot with a known-cost fix: extending it will flag some existing functions as risky that are not exploitable today (CI noise for a theoretical hole, not an active one). | **(a) Founder call:** accept as-is (recommended -- revoking PUBLIC's EXECUTE risks breaking a legitimate caller), or explicitly restrict via REVOKE+re-GRANT to service_role. **(b) Founder call:** extend the guard now (accepting review-noise cost) or leave as a documented residual until an aggregate or role-grant change makes it actually reachable. No strong recommendation on (b) -- a posture-vs-noise tradeoff the founder is best placed to weigh. |
```

- **Workstream:** security-money | **Effort:** M
- **Why:** STRUCTURE-CRITIC CONSOLIDATION: merged 2 register items (postgis-definer-functions-informal, security-definer-trigger-aggregate-bypass) into one OD row since both ask the identical shape of question (accept or harden a named ADR-0159 residual) about the same ADR -- avoids two near-identical rows in the register.
- **Verified today:** Confirmed ADR 0159 remains Status: Proposed; confirmed 0 user-defined aggregates in any migration; confirmed 2 SECURITY DEFINER trigger functions exist in migrations; both self-test scenarios (A3, A9) are documented in ADR 0159's own text as un-caught by the current guard.
- **Duplicates checked:** Neither is a duplicate -- ADR 0159 names both but does not itself constitute an OPEN-DECISIONS row for either.
- **Citations to rewrite:**
  - .planning/v3.0-TECH-DEBT.md:4643-4670 (PostGIS section)
  - .planning/v3.0-TECH-DEBT.md:4724+ (trigger/aggregate section)

### 77. `security-definer-trigger-aggregate-bypass` -- DECIDE / new OPEN-DECISIONS row
**Section:** MERGED -- see the postgis-definer-functions-informal OD-NEW row (part (b) of that same row)


- **Workstream:** security-money | **Effort:** M
- **Why:** STRUCTURE-CRITIC CONSOLIDATION per task rule 2: this key's content is fully carried as part (b) of the single OD-NEW row filed under postgis-definer-functions-informal, so it gets no separate row of its own -- listed here so all 230 keys are still individually accounted for.
- **Verified today:** Same verification as its sibling key (ADR 0159's self-test scenarios A3/A9 confirmed un-caught by the guard today; 0 user-defined aggregates exist).
- **Duplicates checked:** Merged into one OD-NEW row with postgis-definer-functions-informal -- both are 'accept or harden a named ADR-0159 residual' questions about the same ADR; a second, near-identical row would overcrowd OPEN-DECISIONS.md for no benefit.

### 78. `atlas-surfaces-F4` -- DECIDE / new OPEN-DECISIONS row
**Section:** MERGED -- see the single 'atlas-surfaces-F2' OD-NEW row (2026-09-18 atlas/codebase-audit follow-ups, 9 sub-items a-h)


- **Workstream:** web-quality | **Effort:** S
- **Why:** STRUCTURE-CRITIC CONSOLIDATION per task rule 2: 9 low-stakes findings from one investigation become one OD row with lettered sub-options, matching the founder's own 'don't overcrowd' instruction.
- **Verified today:** Re-derived every headline number directly on wt-review rather than trusting the source review's figures: (a) confirmed all 8 named routes are real href entries in Sidebar.tsx at lines 90,103,109,117,129,144,150,174; (c) confirmed App.tsx:312 renders <InventoryCommandPage/> on both the legacy and next arms verbatim; (d) reproduced the 689-decorator/75-controller-file counts exactly by direct grep; (e) reconfirmed 0 test files in both studio (18 source files) and simpos (3 source files); (f) reproduced the exact 27/4 mobile screen/layout split and the corrected ~10,785 (excl. tests) / ~12,336 (incl.) LOC count, both materially different from the review's own cited figures; (g) reconfirmed the 689/75 denominators, could not reproduce the specific 27-endpoint list (its generating script was never committed); (h) did not re-run tsc --noEmit this pass (multi-minute cost outside this batch's scope), carrying forward the review's own reported clean result rather than re-asserting it as freshly checked.
- **Duplicates checked:** Merged into the atlas-surfaces-F2 OD-NEW row -- one of 9 small findings from the same 2026-09-18 audit pass; a separate row per finding would overcrowd OPEN-DECISIONS.md.

### 79. `atlas-surfaces-F5` -- DECIDE / new OPEN-DECISIONS row
**Section:** MERGED -- see the single 'atlas-surfaces-F2' OD-NEW row (2026-09-18 atlas/codebase-audit follow-ups, 9 sub-items a-h)


- **Workstream:** web-quality | **Effort:** S
- **Why:** STRUCTURE-CRITIC CONSOLIDATION per task rule 2: 9 low-stakes findings from one investigation become one OD row with lettered sub-options, matching the founder's own 'don't overcrowd' instruction.
- **Verified today:** Re-derived every headline number directly on wt-review rather than trusting the source review's figures: (a) confirmed all 8 named routes are real href entries in Sidebar.tsx at lines 90,103,109,117,129,144,150,174; (c) confirmed App.tsx:312 renders <InventoryCommandPage/> on both the legacy and next arms verbatim; (d) reproduced the 689-decorator/75-controller-file counts exactly by direct grep; (e) reconfirmed 0 test files in both studio (18 source files) and simpos (3 source files); (f) reproduced the exact 27/4 mobile screen/layout split and the corrected ~10,785 (excl. tests) / ~12,336 (incl.) LOC count, both materially different from the review's own cited figures; (g) reconfirmed the 689/75 denominators, could not reproduce the specific 27-endpoint list (its generating script was never committed); (h) did not re-run tsc --noEmit this pass (multi-minute cost outside this batch's scope), carrying forward the review's own reported clean result rather than re-asserting it as freshly checked.
- **Duplicates checked:** Merged into the atlas-surfaces-F2 OD-NEW row -- one of 9 small findings from the same 2026-09-18 audit pass; a separate row per finding would overcrowd OPEN-DECISIONS.md.

### 80. `atlas-surfaces-F6` -- DECIDE / new OPEN-DECISIONS row
**Section:** MERGED -- see the single 'atlas-surfaces-F2' OD-NEW row (2026-09-18 atlas/codebase-audit follow-ups, 9 sub-items a-h)


- **Workstream:** web-quality | **Effort:** S
- **Why:** STRUCTURE-CRITIC CONSOLIDATION per task rule 2: 9 low-stakes findings from one investigation become one OD row with lettered sub-options, matching the founder's own 'don't overcrowd' instruction.
- **Verified today:** Re-derived every headline number directly on wt-review rather than trusting the source review's figures: (a) confirmed all 8 named routes are real href entries in Sidebar.tsx at lines 90,103,109,117,129,144,150,174; (c) confirmed App.tsx:312 renders <InventoryCommandPage/> on both the legacy and next arms verbatim; (d) reproduced the 689-decorator/75-controller-file counts exactly by direct grep; (e) reconfirmed 0 test files in both studio (18 source files) and simpos (3 source files); (f) reproduced the exact 27/4 mobile screen/layout split and the corrected ~10,785 (excl. tests) / ~12,336 (incl.) LOC count, both materially different from the review's own cited figures; (g) reconfirmed the 689/75 denominators, could not reproduce the specific 27-endpoint list (its generating script was never committed); (h) did not re-run tsc --noEmit this pass (multi-minute cost outside this batch's scope), carrying forward the review's own reported clean result rather than re-asserting it as freshly checked.
- **Duplicates checked:** Merged into the atlas-surfaces-F2 OD-NEW row -- one of 9 small findings from the same 2026-09-18 audit pass; a separate row per finding would overcrowd OPEN-DECISIONS.md.

### 81. `atlas-surfaces-F7` -- DECIDE / new OPEN-DECISIONS row
**Section:** MERGED -- see the single 'atlas-surfaces-F2' OD-NEW row (2026-09-18 atlas/codebase-audit follow-ups, 9 sub-items a-h)


- **Workstream:** web-quality | **Effort:** S
- **Why:** STRUCTURE-CRITIC CONSOLIDATION per task rule 2: 9 low-stakes findings from one investigation become one OD row with lettered sub-options, matching the founder's own 'don't overcrowd' instruction.
- **Verified today:** Re-derived every headline number directly on wt-review rather than trusting the source review's figures: (a) confirmed all 8 named routes are real href entries in Sidebar.tsx at lines 90,103,109,117,129,144,150,174; (c) confirmed App.tsx:312 renders <InventoryCommandPage/> on both the legacy and next arms verbatim; (d) reproduced the 689-decorator/75-controller-file counts exactly by direct grep; (e) reconfirmed 0 test files in both studio (18 source files) and simpos (3 source files); (f) reproduced the exact 27/4 mobile screen/layout split and the corrected ~10,785 (excl. tests) / ~12,336 (incl.) LOC count, both materially different from the review's own cited figures; (g) reconfirmed the 689/75 denominators, could not reproduce the specific 27-endpoint list (its generating script was never committed); (h) did not re-run tsc --noEmit this pass (multi-minute cost outside this batch's scope), carrying forward the review's own reported clean result rather than re-asserting it as freshly checked.
- **Duplicates checked:** Merged into the atlas-surfaces-F2 OD-NEW row -- one of 9 small findings from the same 2026-09-18 audit pass; a separate row per finding would overcrowd OPEN-DECISIONS.md.

### 82. `atlas-surfaces-F8` -- DECIDE / new OPEN-DECISIONS row
**Section:** MERGED -- see the single 'atlas-surfaces-F2' OD-NEW row (2026-09-18 atlas/codebase-audit follow-ups, 9 sub-items a-h)


- **Workstream:** web-quality | **Effort:** S
- **Why:** STRUCTURE-CRITIC CONSOLIDATION per task rule 2: 9 low-stakes findings from one investigation become one OD row with lettered sub-options, matching the founder's own 'don't overcrowd' instruction.
- **Verified today:** Re-derived every headline number directly on wt-review rather than trusting the source review's figures: (a) confirmed all 8 named routes are real href entries in Sidebar.tsx at lines 90,103,109,117,129,144,150,174; (c) confirmed App.tsx:312 renders <InventoryCommandPage/> on both the legacy and next arms verbatim; (d) reproduced the 689-decorator/75-controller-file counts exactly by direct grep; (e) reconfirmed 0 test files in both studio (18 source files) and simpos (3 source files); (f) reproduced the exact 27/4 mobile screen/layout split and the corrected ~10,785 (excl. tests) / ~12,336 (incl.) LOC count, both materially different from the review's own cited figures; (g) reconfirmed the 689/75 denominators, could not reproduce the specific 27-endpoint list (its generating script was never committed); (h) did not re-run tsc --noEmit this pass (multi-minute cost outside this batch's scope), carrying forward the review's own reported clean result rather than re-asserting it as freshly checked.
- **Duplicates checked:** Merged into the atlas-surfaces-F2 OD-NEW row -- one of 9 small findings from the same 2026-09-18 audit pass; a separate row per finding would overcrowd OPEN-DECISIONS.md.

### 83. `atlas-surfaces-missed-M2` -- DECIDE / new OPEN-DECISIONS row
**Section:** MERGED -- see the single 'atlas-surfaces-F2' OD-NEW row (2026-09-18 atlas/codebase-audit follow-ups, 9 sub-items a-h)


- **Workstream:** web-quality | **Effort:** S
- **Why:** STRUCTURE-CRITIC CONSOLIDATION per task rule 2: 9 low-stakes findings from one investigation become one OD row with lettered sub-options, matching the founder's own 'don't overcrowd' instruction.
- **Verified today:** Re-derived every headline number directly on wt-review rather than trusting the source review's figures: (a) confirmed all 8 named routes are real href entries in Sidebar.tsx at lines 90,103,109,117,129,144,150,174; (c) confirmed App.tsx:312 renders <InventoryCommandPage/> on both the legacy and next arms verbatim; (d) reproduced the 689-decorator/75-controller-file counts exactly by direct grep; (e) reconfirmed 0 test files in both studio (18 source files) and simpos (3 source files); (f) reproduced the exact 27/4 mobile screen/layout split and the corrected ~10,785 (excl. tests) / ~12,336 (incl.) LOC count, both materially different from the review's own cited figures; (g) reconfirmed the 689/75 denominators, could not reproduce the specific 27-endpoint list (its generating script was never committed); (h) did not re-run tsc --noEmit this pass (multi-minute cost outside this batch's scope), carrying forward the review's own reported clean result rather than re-asserting it as freshly checked.
- **Duplicates checked:** Merged into the atlas-surfaces-F2 OD-NEW row -- one of 9 small findings from the same 2026-09-18 audit pass; a separate row per finding would overcrowd OPEN-DECISIONS.md.

### 84. `atlas-backbone-F7` -- DECIDE / new OPEN-DECISIONS row
**Section:** MERGED -- see the single 'atlas-surfaces-F2' OD-NEW row (2026-09-18 atlas/codebase-audit follow-ups, 9 sub-items a-h)


- **Workstream:** web-quality | **Effort:** S
- **Why:** STRUCTURE-CRITIC CONSOLIDATION per task rule 2: 9 low-stakes findings from one investigation become one OD row with lettered sub-options, matching the founder's own 'don't overcrowd' instruction.
- **Verified today:** Re-derived every headline number directly on wt-review rather than trusting the source review's figures: (a) confirmed all 8 named routes are real href entries in Sidebar.tsx at lines 90,103,109,117,129,144,150,174; (c) confirmed App.tsx:312 renders <InventoryCommandPage/> on both the legacy and next arms verbatim; (d) reproduced the 689-decorator/75-controller-file counts exactly by direct grep; (e) reconfirmed 0 test files in both studio (18 source files) and simpos (3 source files); (f) reproduced the exact 27/4 mobile screen/layout split and the corrected ~10,785 (excl. tests) / ~12,336 (incl.) LOC count, both materially different from the review's own cited figures; (g) reconfirmed the 689/75 denominators, could not reproduce the specific 27-endpoint list (its generating script was never committed); (h) did not re-run tsc --noEmit this pass (multi-minute cost outside this batch's scope), carrying forward the review's own reported clean result rather than re-asserting it as freshly checked.
- **Duplicates checked:** Merged into the atlas-surfaces-F2 OD-NEW row -- one of 9 small findings from the same 2026-09-18 audit pass; a separate row per finding would overcrowd OPEN-DECISIONS.md.

### 85. `atlas-surfaces-F2` -- DECIDE / new OPEN-DECISIONS row
**Section:** ## Open (new row)

```
| OD-NEW | **2026-09-18 atlas/codebase-audit follow-ups -- nine small, mostly-confirm-only findings from the same design-atlas and route-census pass. Pick which (if any) jump the queue; none blocks anything today.** (a) The "39 orphan pages" atlas finding is a TOOLING BLIND SPOT, not 39 dead pages: /orders, /providers, /receiving, /reports, /team, /wines, /communications, /notifications are all live in Sidebar.tsx's real nav (the finding's own citation, "HouseHeader", is the wrong file) -- recommend: confirm as a tooling correction, no code change; extending generate_system_atlas.py to also read Sidebar.tsx would be a future WORK item. (b) 9 of 20 mudavym_design_* feature flags read 0 (off) even on the one restaurant with the new design enabled -- cross-checked against lane-status, this is correct (those pages aren't finished yet), not a wiring bug; no action needed, revisit alongside atlas-surfaces-F3 (already filed as WORK). (c) /inventory's legacy/next PageGate switch does nothing -- App.tsx:312 renders the IDENTICAL InventoryCommandPage on both arms; recommend: founder confirms /inventory has fully migrated (delete the PageGate wrapper) or a real legacy component needs restoring for rollback -- (a)-delete matches memory ('new /inventory, legacy at /inventory-legacy', which itself now just redirects). (d) Endpoint surface grew ~47% (468->689 decorators) since the last published atlas with no re-audit of stub-vs-real -- worth a fresh generate_design_atlas.py run before the next milestone, or let it ride to the next natural boundary (P4 wave close). (e) apps/web/src/pages/studio and .../simpos have zero test files (confirmed: 18 and 3 source files respectively, 0 tests in either) -- fold into the existing P4 UI wave as a coverage requirement, or file standalone; a build-sequencing call, not a design fork. (f) The design atlas has no route-scanning logic for apps/mobile at all, and mobile is ~10,785-12,336 LOC (re-measured this pass -- NOT the review's stale 6,954, and not exactly its stated 27/26 screen split, confirmed 27 .tsx files under app/, 4 of them _layout.tsx wrappers) with no module/production-usage census the way apps/web has -- extend the atlas script to scan it and give it the same census apps/web already got, next audit pass. (g) ~27 of 689 gateway endpoints across 75 controller files have no static caller anywhere in apps/web, apps/mobile or services/ (3 manual false positives already excluded) -- dead code or forward-built for a not-yet-landed client looks identical from a caller count; recommend a follow-up session regenerate the list (the ad-hoc caller_check.py used for this pass was not committed) and tag each dead/planned/external before deciding what to delete. (h) Fold "run npx tsc --noEmit" into whatever checklist governs future codebase-health reviews -- it was skipped this pass (apps/web's compile is reportedly clean, but that result was carried from the review's own note, not independently re-run here) -- a process convention, not a code fork. | Nine small, independent, low-stakes findings from one audit pass; filing nine separate OPEN-DECISIONS rows for them would be exactly the register overcrowding the founder asked this pass to avoid, and several (b, most of e/f/g/h) are FYI-only with an obvious default action. | **Recommend, per sub-item:** (a) confirm/no-op; (b) confirm/no-op; (c) founder's one-line pick, likely delete-the-gate; (d) defer to next milestone boundary; (e) fold into P4 wave; (f) schedule for next audit; (g) commission a fresh, committed caller-check script before deciding what to delete; (h) yes, add to whatever review checklist exists (CLAUDE.md §2/§9 or a review skill, once someone owns writing it -- not this OD/ADR queue). |
```

- **Workstream:** web-quality | **Effort:** M
- **Why:** Primary row for STRUCTURE-CRITIC CLUSTER A: 9 register keys (atlas-surfaces-F2/F4/F5/F6/F7/F8/missed-M2, atlas-backbone-F7, modules-missed-M4) from the same 2026-09-18 audit pass, none individually a real founder-judgment fork worth its own row, folded into one lettered OD-NEW entry.
- **Verified today:** Re-derived every headline number directly on wt-review rather than trusting the source review's figures: (a) confirmed all 8 named routes are real href entries in Sidebar.tsx at lines 90,103,109,117,129,144,150,174; (c) confirmed App.tsx:312 renders <InventoryCommandPage/> on both the legacy and next arms verbatim; (d) reproduced the 689-decorator/75-controller-file counts exactly by direct grep; (e) reconfirmed 0 test files in both studio (18 source files) and simpos (3 source files); (f) reproduced the exact 27/4 mobile screen/layout split and the corrected ~10,785 (excl. tests) / ~12,336 (incl.) LOC count, both materially different from the review's own cited figures; (g) reconfirmed the 689/75 denominators, could not reproduce the specific 27-endpoint list (its generating script was never committed); (h) did not re-run tsc --noEmit this pass (multi-minute cost outside this batch's scope), carrying forward the review's own reported clean result rather than re-asserting it as freshly checked.
- **Duplicates checked:** None in OPEN-DECISIONS.md for any of the 9 underlying facts.

### 86. `modules-missed-M4` -- DECIDE / new OPEN-DECISIONS row
**Section:** MERGED -- see the single 'atlas-surfaces-F2' OD-NEW row, sub-item (f), mobile census


- **Workstream:** web-quality | **Effort:** S
- **Why:** STRUCTURE-CRITIC CONSOLIDATION: this is the clearest case in the whole batch of a number that would have been silently copied forward wrong (6,954 vs ~11-12K) -- re-measured per CLAUDE §5b and folded into Cluster A's sub-item (f) rather than a standalone row, since atlas-surfaces-F8 already asks the same 'give mobile a census' question.
- **Verified today:** Re-measured mobile LOC directly: 10,785 lines excluding tests / 12,336 including, materially higher than the review's own cited 6,954 -- corrected figure is in the merged row's sub-item (f).
- **Duplicates checked:** Same cluster as atlas-surfaces-F8 (both ask for a mobile route/module census) -- merged rather than filing a second near-duplicate row.

### 87. `models-F3` -- DECIDE / new OPEN-DECISIONS row
**Section:** ## Open (new row)

```
| OD-NEW | **Agent-stack audit follow-ups -- three FYI-shaped findings from the same services/agent-orchestrator investigation, none a real fork needing urgent action.** (a) Insight catalogue: insight-catalog.ts (a pure, import-free module) declares 573 candidate insight types; insight-implementations.ts's IMPLEMENTED_INSIGHT_TYPES names 24 as built, and only 5 of those 24 fired for a real restaurant in the last 30 days -- is closing that gap worth prioritizing, or is staged coverage intentional? Recommend: no action, coverage is intentionally staged, unless the founder has a specific insight category customers are expecting that isn't firing. (b) Only 5 of 24 "agent" modules actually call an LLM (grep -rl anthropic on agents/*.py: exactly 5 of 24) -- the other 19 are rule-based logic; worth renaming for clarity, or is "agent" already understood internally as the broader term? Recommend: no code action unless the ratio ever surprises the founder in a customer-facing or investor context. (c) 15 of 24 agent modules have no test file matching their name by a direct substring cross-check (auto_pilot_agent, buffer_manager, calendar_agent, compliance_agent, email_parsing_agent, ghost_inventory_agent, inequality_detector, menu_analyzer_agent, negotiation_playbook_agent, pos_integration_agent, provider_conversation_agent, shrinkage_detective_agent, sommelier_agent, state_invariant_enforcer, visual_verification_agent) -- some may be covered by name-mismatched integration/e2e tests, which this method cannot see. Recommend: a follow-up session confirms which of the 15 are genuinely untested vs covered under a different name; real gaps become a WORK/CLAIMS item. | Three independent, low-stakes findings from the same audit; filing three separate rows for FYI-shaped, mostly-no-action items would overcrowd the register for no benefit. | (a) no action unless flagged; (b) no action unless flagged; (c) route the 15-module list to a follow-up session to separate real gaps from method noise, then file WORK items for the real ones. |
```

- **Workstream:** analytics-models | **Effort:** S
- **Why:** Primary row for STRUCTURE-CRITIC CLUSTER B: 3 low-stakes agent-orchestrator findings folded into one lettered row rather than 3 near-FYI rows.
- **Verified today:** Reproduced (a)'s 573/24/5 figures by cross-referencing OD-33's own independent 2026-08-26 measurement of the same file (not re-transpiled here) plus insight-implementations.ts's export list; reproduced (b)'s 5/24 exactly by direct grep -rl anthropic; independently re-ran (c)'s exact name-substring cross-check method and reproduced the identical 15-module list.
- **Duplicates checked:** Related to but not a duplicate of OD-33 (open) -- OD-33 is about pinning the 573 count in a test assertion, a different question than whether to build more of the 549 unimplemented candidates; not duplicated here.

### 88. `models-F6` -- DECIDE / new OPEN-DECISIONS row
**Section:** MERGED -- see the single 'models-F3' OD-NEW row (agent-stack audit follow-ups, sub-items b/c)


- **Workstream:** analytics-models | **Effort:** S
- **Why:** STRUCTURE-CRITIC CONSOLIDATION per task rule 2: 3 low-stakes findings from one investigation become one OD row.
- **Verified today:** Reproduced (a)'s 573/24/5 figures by cross-referencing OD-33's own independent 2026-08-26 measurement of the same file (not re-transpiled here) plus insight-implementations.ts's export list; reproduced (b)'s 5/24 exactly by direct grep -rl anthropic; independently re-ran (c)'s exact name-substring cross-check method and reproduced the identical 15-module list.
- **Duplicates checked:** Merged into the models-F3 OD-NEW row -- same agent-orchestrator audit, same FYI shape.

### 89. `models-F7` -- DECIDE / new OPEN-DECISIONS row
**Section:** MERGED -- see the single 'models-F3' OD-NEW row (agent-stack audit follow-ups, sub-items b/c)


- **Workstream:** analytics-models | **Effort:** S
- **Why:** STRUCTURE-CRITIC CONSOLIDATION per task rule 2: 3 low-stakes findings from one investigation become one OD row.
- **Verified today:** Reproduced (a)'s 573/24/5 figures by cross-referencing OD-33's own independent 2026-08-26 measurement of the same file (not re-transpiled here) plus insight-implementations.ts's export list; reproduced (b)'s 5/24 exactly by direct grep -rl anthropic; independently re-ran (c)'s exact name-substring cross-check method and reproduced the identical 15-module list.
- **Duplicates checked:** Merged into the models-F3 OD-NEW row -- same agent-orchestrator audit, same FYI shape.

### 90. `modules-F10` -- DECIDE / new OPEN-DECISIONS row
**Section:** ## Open (new row)

```
| OD-NEW | **Two procurement/recurring cron findings, grouped since both concern a cron whose value is currently unclear.** (a) recurring_orders' two daily crons (execute-due-orders at 08:00, the 2-day reminder at 06:00) run every day against a table with no UI to create a row yet -- confirmed harmless: each short-circuits on dueOrders.length===0. Recommend: no action, confirm and note in recurring-orders.md that the crons are expected no-ops until a UI ships. (b) The 09:00 promotion-extractor cron is documented as writing provider_promotions on every match, but the review found the table reportedly empty in production (not re-queried this pass -- the priority call doesn't hinge on the exact count). If the cron genuinely writes nothing despite matches existing, that contradicts SOFTWARE-MAP.md's own claim about the feature. | (a) is confirmed benign, just undocumented as such. (b) is either a real, cheap-to-trace bug (worth knowing before anyone builds on promotions) or a data-availability fact -- worth a founder priority call on when to look, not whether it's real. | (a) confirm, add one line to recurring-orders.md, no priority call needed. (b) founder call on priority: debug now (cheap, the cron and its write path are both already named) vs defer until promotions/inbound-email work is next active. |
```

- **Workstream:** procurement-orders | **Effort:** S
- **Why:** Primary row for a small 2-item cluster: both are procurement/recurring crons whose value proposition is in question, grouped rather than filed as 2 separate low-stakes rows.
- **Verified today:** Confirmed both recurring-orders.service.ts cron schedules (@Cron('0 8 * * *') and @Cron('0 6 * * *')) and the early-return-on-empty behavior directly; confirmed promotion-extractor.service.ts's @Cron(EVERY_DAY_AT_9AM) exists as claimed; did not re-query production provider_promotions/vendor_promotions row counts (placement doesn't depend on the exact count, only on there being a real question worth a priority call).
- **Duplicates checked:** OD-92 covers a different fork (crons ignoring restaurant timezone), not this one; no other existing row for recurring_orders/promotion-extractor crons.

### 91. `modules-F5` -- DECIDE / new OPEN-DECISIONS row
**Section:** MERGED -- see the single 'modules-F10' OD-NEW row, sub-item (b)


- **Workstream:** procurement-orders | **Effort:** S
- **Why:** STRUCTURE-CRITIC CONSOLIDATION per task rule 2: grouped with modules-F10 since both are procurement-cron value-proposition questions.
- **Verified today:** Confirmed both recurring-orders.service.ts cron schedules (@Cron('0 8 * * *') and @Cron('0 6 * * *')) and the early-return-on-empty behavior directly; confirmed promotion-extractor.service.ts's @Cron(EVERY_DAY_AT_9AM) exists as claimed; did not re-query production provider_promotions/vendor_promotions row counts (placement doesn't depend on the exact count, only on there being a real question worth a priority call).
- **Duplicates checked:** Merged into modules-F10's OD-NEW row as sub-item (b).

### 92. `gitignore-duplicate-files` -- DECIDE / addendum to an EXISTING OPEN-DECISIONS row
**Section:** OD-60 (existing open row, line 49)

```
Add one line to OD-60 noting: this pass re-confirmed zero stray " 2.*" files exist today, and .gitignore still only ignores "* 2.py"/"* 2.md" at lines 103-104 (drifted from OD-60's cited :89-91/:71-73 -- a second citation-drift correction for whoever next touches the row).
```

- **Workstream:** ci-tooling | **Effort:** S
- **Why:** Reuse rule for DECIDE: an existing OD already asks this -- link it, do not duplicate.
- **Verified today:** Confirmed .gitignore lines 103-104 are the two globs, unchanged in scope; confirmed zero stray ' 2.*' files in the tree today.
- **Duplicates checked:** OD-60 (line 49) asks the verbatim same question (same file, same two globs, same three founder options) -- read in full before concluding this was a duplicate rather than assuming from title similarity.

### 93. `modules-F4` -- DECIDE / addendum to an EXISTING OPEN-DECISIONS row
**Section:** OD-23 (existing partly-answered row)

```
Add a cross-reference note to OD-23: the review's "communications-hub metering tables are empty in production" finding is the SAME fact OD-23's own resolution already names -- plan_message_allowances/house_message_meter/house_message_credits were deliberately built EMPTY by founder decision (ADR 0121) until real usage sets the allowance number. communications-hub.md:6 already reads "status: hollow"; recommend it note the metering layer specifically as "hollow, by ADR 0121/OD-23 design" rather than leaving it unscoped generically.
```

- **Workstream:** security-money | **Effort:** S
- **Why:** STRUCTURE-CRITIC CORRECTION, overriding the literal 'decide' mark: recognized the table names in the source evidence matched OD-23's already-recorded resolution and traced that connection, rather than filing a disconnected new decision that would read as contradicting an already-answered fork.
- **Verified today:** Confirmed communications-hub.md:6 and :147 read 'status: hollow' with an existing pattern for scoped-hollow language elsewhere in the same doc.
- **Duplicates checked:** Strongly related to OD-23 (Partly Answered 2026-09-05) which already names these exact three tables as deliberately empty-by-design -- not a fresh independent finding; should not be filed as a disconnected new OD row.


## `.planning/ROADMAP.md`  (9 items)

### 94. `44.7` -- MOVE / ROADMAP or FUTURES
**Section:** New grouped bullet under '## Later -- P4 candidates (uncommitted)', anchor item

```
- **Track C verification & eval suite (v2.0 carry-forward, mostly unstarted)** -- SimPOS provider simulator + control panel (44.7, partly delivered per ADR 0093: scripts/simulate scenario -- seeded, 11 named scenarios + random, 4 chaos modes -- and the /simpos/:id/scenarios panel exist; still missing click-to-fire orders from the panel, a missed-webhook detector, and a Railway deploy, dev-only by design per OD-35); breadth-pass scoring of build groups 1-4 (44.8) and 5-7+9 (44.9) to >=T2 with automated suites + manual checklists; an analytics/insights truth suite grading every dashboard KPI against SimPOS's ground-truth ledger, the stated #1 eval priority (44.10); AI eval suites -- golden datasets, weekly CI, cost caps, plannable now without waiting on SimPOS (44.11); E2E Playwright journeys + a final 11-group scorecard (44.12, gated on 44.8-44.11); and autonomous vendor discovery + event-driven procurement signals, unstarted with clean boundaries, independent of the rest (44.13). Relationship to the P3.0 doneability gate elsewhere in this roadmap is unreconciled -- same "grade the platform" goal, a different rubric (T2 tiers here vs. verdict-basis coverage there); flag for the founder before scheduling either.
```

- **Workstream:** ci-tooling | **Effort:** S
- **Why:** Destination given by the founder's triage (ROADMAP.md); confirmed not already covered elsewhere; grouped 7 interdependent sub-items (44.7-44.13) into one bullet per 'one line each, grouped' rather than scattering seven. Anchor item since 44.8-44.10 explicitly depend on it.
- **Verified today:** Confirmed scripts/simulate/ exists (bridge.py, cli.py, detection.py, __main__.py); confirmed no link between Track C's 44.7-44.13 and ADR 0029's P3 plan (grepped 0029's file for 'Track C'/'44.7'-'44.13': zero hits) -- not already covered/superseded elsewhere.
- **Duplicates checked:** None as a whole; ROADMAP's existing P3.0 gate is adjacent but distinct, noted in the entry itself.
- **Citations to rewrite:**
  - .planning/06-pages/simpos-terminal.md:205 (cites 'v3.0 task 44.7' -- repoint to this ROADMAP bullet)
  - Citation sweep (2026-09-19, git grep in wt-retire-debt@9c6bdc0be): .planning/00-index/cards.json:114; .planning/00-index/cards.json:3706; .planning/01-org/intelligence/analytics-bi/analytics-bi-agenda-board.md:117; .planning/01-org/intelligence/analytics-bi/analytics-bi-agenda-full.md:65; .planning/01-org/intelligence/analytics-bi/analytics-bi-agent-stack.md:117; .planning/01-org/intelligence/analytics-bi/analytics-bi-charter.md:79; .planning/01-org/intelligence/analytics-bi/analytics-bi-loops.md:122; .planning/01-org/intelligence/analytics-bi/teams/metric-contract-truth-assurance/metric-contract-truth-assurance-agenda-full.md:154; .planning/01-org/intelligence/analytics-bi/teams/metric-contract-truth-assurance/metric-contract-truth-assurance-agent-stack.md:121; .planning/01-org/intelligence/analytics-bi/teams/metric-contract-truth-assurance/metric-contract-truth-assurance-agent-stack.md:46; .planning/01-org/intelligence/analytics-bi/teams/metric-contract-truth-assurance/metric-contract-truth-assurance-agent-stack.md:67; .planning/01-org/intelligence/analytics-bi/teams/metric-contract-truth-assurance/metric-contract-truth-assurance-loops.md:67; .planning/01-org/intelligence/analytics-bi/teams/metric-contract-truth-assurance/metric-contract-truth-assurance-premortem.md:26; .planning/06-pages/simpos-order-log.md:113; .planning/06-pages/simpos-order-log.md:83; .planning/06-pages/simpos-terminal.md:64; .planning/08-softwares/simpos.md:183; .planning/archive/STATE-pre-P2-20260825.md:29 -- rewrite to point at this item's home once the register is deleted.

### 95. `44.8` -- MOVE / ROADMAP or FUTURES
**Section:** Same grouped bullet as 44.7 (Breadth Pass A clause)

```
(folds into the 44.7 grouped ROADMAP.md bullet's Breadth Pass A clause)
```

- **Workstream:** ci-tooling | **Effort:** S
- **Why:** Same MOVE/move_future/group logic as 44.7; reported as its own item per the batch instructions even though it shares one physical bullet with six siblings.
- **Verified today:** Source content unchanged in v3.0-TECH-DEBT.md; same ADR-0029 non-overlap check as 44.7 applies.
- **Duplicates checked:** None beyond the shared Track C context noted on 44.7.
- **Citations to rewrite:**
  - .planning/decisions/0019-p2-build-scope.md:182 (cites '44.8-44.12 breadth passes' -- repoint to the ROADMAP bullet; only listed once, under 44.8, to avoid a duplicate instruction)

### 96. `44.9` -- MOVE / ROADMAP or FUTURES
**Section:** Same grouped bullet as 44.7 (Breadth Pass B clause)

```
(folds into the 44.7 grouped ROADMAP.md bullet's Breadth Pass B clause)
```

- **Workstream:** ci-tooling | **Effort:** S
- **Why:** Same MOVE/move_future/group logic as 44.7; reported as its own item per the batch instructions even though it shares one physical bullet with six siblings.
- **Verified today:** Source content unchanged in v3.0-TECH-DEBT.md; same ADR-0029 non-overlap check as 44.7 applies.
- **Duplicates checked:** None beyond the shared Track C context noted on 44.7.

### 97. `44.10` -- MOVE / ROADMAP or FUTURES
**Section:** Same grouped bullet as 44.7 (Analytics & Insights Truth Suite clause -- the sub-item most easily confused with the P3.0 NF-A gate, called out explicitly)

```
(folds into the 44.7 grouped ROADMAP.md bullet's Analytics & Insights Truth Suite clause -- the sub-item most easily confused with the P3.0 NF-A gate, called out explicitly)
```

- **Workstream:** analytics-models | **Effort:** S
- **Why:** Same MOVE/move_future/group logic as 44.7; reported as its own item per the batch instructions even though it shares one physical bullet with six siblings.
- **Verified today:** Source content unchanged in v3.0-TECH-DEBT.md; same ADR-0029 non-overlap check as 44.7 applies.
- **Duplicates checked:** None beyond the shared Track C context noted on 44.7.
- **Citations to rewrite:**
  - Citation sweep (2026-09-19, git grep in wt-retire-debt@9c6bdc0be): .planning/01-org/intelligence/analytics-bi/analytics-bi-charter.md:198; .planning/01-org/intelligence/analytics-bi/analytics-bi-loops.md:122; .planning/01-org/intelligence/analytics-bi/teams/metric-contract-truth-assurance/metric-contract-truth-assurance-charter.md:170; .planning/01-org/intelligence/analytics-bi/teams/metric-contract-truth-assurance/metric-contract-truth-assurance-charter.md:45; .planning/01-org/intelligence/analytics-bi/teams/metric-contract-truth-assurance/metric-contract-truth-assurance-loops.md:67; .planning/01-org/research-math/teams/evaluation-doneability/evaluation-doneability-agenda-full.md:70; .planning/foundation/teams/intelligence.md:456 -- rewrite to point at this item's home once the register is deleted.

### 98. `44.11` -- MOVE / ROADMAP or FUTURES
**Section:** Same grouped bullet as 44.7 (AI Eval Suites clause -- explicitly NOT gated on 44.7/SimPOS, plannable in parallel, preserved in the drafted clause)

```
(folds into the 44.7 grouped ROADMAP.md bullet's AI Eval Suites clause -- explicitly NOT gated on 44.7/SimPOS, plannable in parallel, preserved in the drafted clause)
```

- **Workstream:** ci-tooling | **Effort:** S
- **Why:** Same MOVE/move_future/group logic as 44.7; reported as its own item per the batch instructions even though it shares one physical bullet with six siblings.
- **Verified today:** Source content unchanged in v3.0-TECH-DEBT.md; same ADR-0029 non-overlap check as 44.7 applies.
- **Duplicates checked:** None beyond the shared Track C context noted on 44.7.
- **Citations to rewrite:**
  - Citation sweep (2026-09-19, git grep in wt-retire-debt@9c6bdc0be): .planning/01-org/intelligence/analytics-bi/teams/analytics-engine/analytics-engine-agenda-full.md:92; .planning/01-org/research-math/research-math-agenda-board.md:141; .planning/01-org/research-math/research-math-agenda-full.md:381; .planning/01-org/research-math/research-math-schedule.md:48; .planning/01-org/research-math/teams/evaluation-doneability/evaluation-doneability-agenda-full.md:30; .planning/01-org/research-math/teams/evaluation-doneability/evaluation-doneability-agent-stack.md:70; .planning/01-org/research-math/teams/evaluation-doneability/evaluation-doneability-charter.md:127; .planning/01-org/research-math/teams/evaluation-doneability/evaluation-doneability-loops.md:87; .planning/01-org/research-math/teams/evaluation-doneability/evaluation-doneability-premortem.md:53; .planning/01-org/research-math/teams/evaluation-doneability/evaluation-doneability-schedule.md:35; .planning/archive/STATE-pre-P2-20260825.md:29; .planning/foundation/teams/intelligence.md:123 -- rewrite to point at this item's home once the register is deleted.

### 99. `44.12` -- MOVE / ROADMAP or FUTURES
**Section:** Same grouped bullet as 44.7 (E2E Journeys & Final Scorecard clause -- gated on 44.8-44.11, dependency preserved)

```
(folds into the 44.7 grouped ROADMAP.md bullet's E2E Journeys & Final Scorecard clause -- gated on 44.8-44.11, dependency preserved)
```

- **Workstream:** ci-tooling | **Effort:** S
- **Why:** Same MOVE/move_future/group logic as 44.7; reported as its own item per the batch instructions even though it shares one physical bullet with six siblings.
- **Verified today:** Source content unchanged in v3.0-TECH-DEBT.md; same ADR-0029 non-overlap check as 44.7 applies.
- **Duplicates checked:** None beyond the shared Track C context noted on 44.7.

### 100. `44.13` -- MOVE / ROADMAP or FUTURES
**Section:** Same grouped bullet as 44.7 (Autonomous Vendor Discovery clause -- the one Track-C sub-item independent of SimPOS)

```
(folds into the 44.7 grouped ROADMAP.md bullet's Autonomous Vendor Discovery clause -- the one Track-C sub-item independent of SimPOS)
```

- **Workstream:** procurement-orders | **Effort:** S
- **Why:** Same MOVE/move_future/group logic as 44.7; reported as its own item per the batch instructions even though it shares one physical bullet with six siblings.
- **Verified today:** Source content unchanged in v3.0-TECH-DEBT.md; same ADR-0029 non-overlap check as 44.7 applies.
- **Duplicates checked:** None beyond the shared Track C context noted on 44.7.
- **Citations to rewrite:**
  - Citation sweep (2026-09-19, git grep in wt-retire-debt@9c6bdc0be): .planning/06-pages/simpos-terminal.md:108; .planning/06-pages/simpos-terminal.md:239 -- rewrite to point at this item's home once the register is deleted.

### 101. `44.6` -- MOVE / ROADMAP or FUTURES
**Section:** New standalone bullet under '## Later -- P4 candidates (uncommitted)'

```
- **One-tap reorder + price-update workflows (unbuilt)** -- one-tap-actions.service.ts's 'unbuilt' action types (everything except delivery_confirm/custom) now refuse honestly with a stated reason instead of claiming a false success (ADR 0083, shipped 2026-09-05); the reorder and price-update workflows themselves remain unbuilt scope.
```

- **Workstream:** procurement-orders | **Effort:** S
- **Why:** Split per the founder's own destination text: the fixed hollow-success half (confirmed closed in code, needs no CLAIMS row) and the genuinely-unbuilt scope (this ROADMAP bullet) -- not combined into one entry that would misstate the fixed part as still open.
- **Verified today:** Confirmed the disposition-based refusal and its ADR 0083 citation are live in one-tap-actions.service.ts:66-79; confirmed ManualOverrideModal/the old hardcoded-manager path is fully deleted; confirmed no existing ROADMAP/FUTURES mention of reorder/price-update workflows.
- **Duplicates checked:** None found.
- **Citations to rewrite:**
  - Citation sweep (2026-09-19, git grep in wt-retire-debt@9c6bdc0be): .planning/foundation/teams/intelligence.md:245 -- rewrite to point at this item's home once the register is deleted.

### 102. `canonical-vat-category-scope-gap` -- MOVE / ROADMAP or FUTURES
**Section:** New standalone bullet under '## Later -- P4 candidates (uncommitted)'

```
- **Per-line VAT category in the extraction contract** -- BT-151/BT-152 are not extracted, so EN 16931 rule BR-S-08 (canonical-invariants.ts:603) is honestly UNTESTABLE on every canonical document rather than silently passing; closing it needs a contract field (ADR 0104 review trail, 2026-09-05).
```

- **Workstream:** receiving-documents | **Effort:** S
- **Why:** Tagged move_future by the founder's triage; FUTURES.md's register is for large product-vision sections and has no natural slot for a narrow contract-field gap, whereas ROADMAP's 'Later' list is exactly a flat list of small uncommitted items -- the better-fitting, less-overcrowding of the two named options.
- **Verified today:** Confirmed the rule is implemented and still keys on vat_category_taxable_base/BR-S-08 (canonical-invariants.ts ~566-668); confirmed ADR 0104's review trail (line 697) already independently states the identical fact as a dated log entry, not a forward-looking backlog item.
- **Duplicates checked:** ADR 0104's review trail records this as history, not a backlog item -- both can stand without conflict; noted the ADR citation in the entry itself.


## `.planning/YC_WEDGE_PLAN.md`  (3 items)

### 103. `deferred-cost-metrics` -- MOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** Lines 359-362 (also independently echoed in 08-softwares/receipts-invoice-match.md:307 and 06-pages/receipts.md:245,589)


- **Workstream:** docs-records | **Effort:** S
- **Why:** Destination says 'already lives in YC_WEDGE_PLAN.md; drop the pointer row' -- verified true, and found it triple-redundant, plus caught a pre-existing, already-broken line-number citation worth flagging regardless of this cleanup.
- **Verified today:** Confirmed YC_WEDGE_PLAN.md:359-362 states the deferral verbatim; independently found the SAME deferral already restated at receipts-invoice-match.md:307 and receipts.md:245,589 -- triple redundancy even before counting the tech-debt copy.
- **Duplicates checked:** YC_WEDGE_PLAN.md:359-362 (original); receipts-invoice-match.md:307; receipts.md:245 and :589.
- **Citations to rewrite:**
  - .planning/08-softwares/receipts-invoice-match.md:307 -- cites 'v3.0-TECH-DEBT.md:446', which is ALREADY WRONG TODAY (line 446 is now unrelated content, 44.1j) independent of this deletion; should be repointed to YC_WEDGE_PLAN.md directly regardless.

### 104. `deferred-line-match-suggestions` -- MOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** Lines 362-364


- **Workstream:** procurement-orders | **Effort:** S
- **Why:** Destination says 'already lives in YC_WEDGE_PLAN.md' -- verified true and current; also spot-checked the underlying gap (no UI for match suggestions) still holds today, so the duplicate is not stale.
- **Verified today:** Confirmed YC_WEDGE_PLAN.md:362-364 states the gap verbatim; checked apps/web for a renderer of POST /procurement/documents/:id/match's suggestions -- the client call exists, no consuming UI component found, consistent with 'nothing renders them' still holding.
- **Duplicates checked:** YC_WEDGE_PLAN.md:362-364 -- exact same gap, same endpoint, same framing.

### 105. `deferred-pos-adapters-cut` -- MOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** Line 63 (REVISION 2 table, Track C row)


- **Workstream:** docs-records | **Effort:** S
- **Why:** Destination says 'already lives in YC_WEDGE_PLAN.md REVISION 2' -- verified true and exact. NOTE: this 'Track C' (POS adapters) is a different thing from the 'Track C' grouped ROADMAP.md entry (v2.0 unbuilt-scope carry-forward, key 44.7) -- same label, unrelated content, flagged so the two are not conflated during execution.
- **Verified today:** Confirmed YC_WEDGE_PLAN.md:63 states 'Track C | Simulator + POS adapters | Cut | ... Minimum POS surface area to close the first 20 customers is zero' verbatim.
- **Duplicates checked:** YC_WEDGE_PLAN.md:63 (REVISION 2 table) -- verbatim decision, unchanged.


## `.planning/03-scenarios/DELIVERY-AUDIT.md`  (1 items)

### 106. `2842` -- MOVE / owning ADR's own text
**Section:** New final section '## 11. Verification methodology notes, moved from the retired tech-debt register' (file ends at '## 10...', line 315-353)

```
## 11. Verification methodology notes, moved from the retired tech-debt register

Session caveats -- what a verification pass could not check, and why -- kept so the gaps are not silently forgotten once v3.0-TECH-DEBT.md is gone.

### POS -> inventory -> alerts lens on Sim Vanilla Kaleici (Antalya, TRY) -- 2026-09-05

- **/reports could not be audited at all.** Threw a duplicate-React TypeError from WidthProviderWrapper before any tenant data is read -- an environment blocker, not a product defect.
- **The < vs <= below-par split** -- no wine sat exactly at par in this run. Untested, not fixed.
- **The hours guard** -- the run fell inside the venue's published hours, so it had nothing to catch.
- **AUTO_LINK_CONFIDENCE for the HOUSE WHITE match** -- the match itself is proved, but the numeric confidence was not read: reading it means calling the matcher RPC, and this run's database client is read-only by construction.
- **Opening stock, par levels and a 150 ml pour size are simulation inputs, not venue facts.**
- **The clock was not simulated.** SimPOS stamps opened_at/closed_at at real wall time, so all 38 checks landed inside 33 real minutes.

(Re-measured 2026-09-19: the source section's own title names five notes but the live file holds six -- the sixth, above, is carried forward too, per CLAUDE.md §5b: numbers get re-measured, never copied forward.)
```

- **Workstream:** docs-records | **Effort:** S
- **Why:** Convention/methodology notes (not defects), so no CLAIMS row and no ADR fits; DELIVERY-AUDIT.md already exists specifically to absorb retired session-audit prose, matching the no-new-document rule. Re-checking surfaced a real numeric drift the original title missed (5 claimed, 6 actual), carried forward per §5b.
- **Verified today:** Confirmed the source section (v3.0-TECH-DEBT.md:2842-2864) actually holds six bullets, not the five its own title claims; confirmed DELIVERY-AUDIT.md's last heading is section 10 (line ~315-353), so a new section 11 is a clean append; confirmed no other file cites this content.
- **Duplicates checked:** None found elsewhere in the corpus.


## `.planning/08-softwares/SOFTWARE-MAP.md`  (3 items)

### 107. `modules-F1` -- WORK / direct text edit (paperwork, not a CLAIMS row)
**Section:** direct text edit, execution PR (not a CLAIMS row -- paperwork, r4-placement.json issue 9)

```
OLD: row 52: `| **[[mudavym-mcp|Mudavym MCP Server]]** | Platform/Admin | \`planned\` | internal | *backend-only* | — | — | **unowned — gap** |`
NEW: row 52 status cell `planned` -> `partial` (built + shipped via ADR 0132, 2026-09-12; 0 production rows across its 6 tables as of 2026-09-19 means adopted-in-production is still open, matching this file's own 'partial' convention for other shipped-but-unexercised rows e.g. dashboard-home, promotions); row 89's prose 'documented, not built' -> 'shipped 2026-09-12 (ADR 0132, ~6,700 LOC, 23 endpoints, 14 specs, 5 resolved CLAIMS rows); 0 production rows across its 6 tables as of 2026-09-19, so adoption -- not build status -- is the open question.'
```
- **Note:** CONFIDENCE FLAG: the 'partial' pick is this pass's best-fit against the file's own existing vocabulary, not independently re-derived from a status-band definition doc -- confirm the exact band before committing.

- **Workstream:** docs-records | **Effort:** S
- **Why:** Founder flip decide->work (one of 11). The checkable half (roster text disagreeing with the built-and-ADR-verified reality) is a grep away; the genuine rollout-decision question stays visible via the same pending PR's Gaps line, not silently dropped.
- **Verified today:** SOFTWARE-MAP.md:52 still reads planned; :89 still reads documented, not built (exit 1, open).
- **Duplicates checked:** No existing row for the roster text. PR #394 (unmerged, commit 93df1d9b3) already adds a §9 to mudavym-mcp.md naming this exact desync as 'finding F1' but explicitly leaves it for whoever owns the note next -- the pending PR documents the gap but does not close it, so this CLAIMS row is the closure mechanism, not a duplicate.

### 108. `modules-missed-M1` -- WORK / direct text edit (paperwork, not a CLAIMS row)
**Section:** direct text edit, execution PR (not a CLAIMS row -- paperwork, r4-placement.json issue 9)

```
OLD: No '### agent-orchestrator' section exists in SOFTWARE-MAP.md today
NEW: Already satisfied by PR #394 (docs/softwares-capacity-coverage, 93df1d9b3), which adds exactly this section -- NOT a new edit for this execution PR. Action: confirm PR #394 has merged before this retirement PR lands (sequencing dependency, see r4-placement.json issue 10 / this plan's founder-question list); if #394's scope changes before merging, re-verify this claim against its final diff rather than assuming the section still lands unchanged.
```
- **Note:** No independent edit needed here -- this row exists to make sure the dependency on PR #394 isn't silently lost when the CLAIMS-row draft that named it is removed.

- **Workstream:** docs-records | **Effort:** M
- **Why:** Founder flip decide->work (one of 11). PR #394 (unmerged) already adds exactly this section, so the claim auto-resolves the moment that PR lands rather than inventing a parallel task. Retargeted to a real, checkable document instead of an unreadable scratch-file citation.
- **Verified today:** No such heading in this checkout (exit 1, open).
- **Duplicates checked:** The original finding's own evidence cited a scratch working file ('modules.md'), not a repo artifact -- retargeted the checkable claim onto SOFTWARE-MAP.md, the persisted document that actually matters, after confirming no existing CLAIMS row covers it.

### 109. `modules-missed-M3` -- WORK / direct text edit (paperwork, not a CLAIMS row)
**Section:** direct text edit, execution PR (not a CLAIMS row -- paperwork, r4-placement.json issue 9)

```
OLD: line ~105: 'Ownership is genuinely unresolved for 6 of 25 products'
NEW: Already satisfied by PR #394 (docs/softwares-capacity-coverage, 93df1d9b3), which rewrites this exact line to '8 of 26' with identical reasoning -- NOT a new edit for this execution PR. Same PR #394 merge-sequencing dependency as modules-missed-M1.
```
- **Note:** No independent edit needed here -- same PR #394 dependency as modules-missed-M1.

- **Workstream:** docs-records | **Effort:** S
- **Why:** PR #394 (unmerged) already rewrites this exact line to 8 of 26 with identical reasoning -- claim drafted to resolve the moment that PR merges.
- **Verified today:** Confirmed line 105 still reads 'unresolved for 6 of 25 products' (exit 1, open).
- **Duplicates checked:** Same scratch-file-citation situation as modules-missed-M1; retargeted onto SOFTWARE-MAP.md's own finding text, confirmed via grep -c 'unowned -- gap' = 8 today.


## `.planning/08-softwares/global-vendor-search.md`  (1 items)

### 110. `modules-F9` -- WORK / direct text edit (paperwork, not a CLAIMS row)
**Section:** direct text edit, execution PR (not a CLAIMS row -- paperwork, r4-placement.json issue 9)

```
OLD: frontmatter `routes: ["/providers?tab=discover", "/distributors"]` and the body text describing DistributorMapPage.tsx / GET /distributors/* as rendering
NEW: drop `"/distributors"` from the routes array (App.tsx:350-353 now redirects it to /providers?tab=discover) and rewrite the body prose (currently describing DistributorMapPage.tsx and GET /distributors/search|facets/:id as live-rendering) to state plainly that /distributors is a redirect only; the three GET /distributors/* endpoints table stays if the API module is still live server-side, but must not be described as having a page that renders them
```
- **Note:** Verify the three GET /distributors/* endpoints (distributor-discovery.controller.ts:39,64,89) are still actually called from providers.tsx's discover tab before deciding whether the endpoints table itself needs a note, versus just the page-rendering claim.

- **Workstream:** docs-records | **Effort:** S
- **Why:** Deterministic single-fact doc/code drift, confirmed both sides (App.tsx redirect; note still describing the old page as live).
- **Verified today:** Confirmed /distributors still present at global-vendor-search.md:8 (frontmatter routes array); exit 1, open.
- **Duplicates checked:** No existing row for this note's routes list.


## `.planning/08-softwares/wine-library-sommelier.md`  (2 items)

### 111. `3007.5` -- WORK / a software's own §9
**Section:** §9 Capacity and coverage -> Gaps bullet (lands via PR #394, not yet merged)

```
Append to the existing Gaps bullet: "251 of master_wine_library's 4,253 rows (all source='menu_corpus', written 2026-08-14-16) still carry country='Unknown' with no evidence trail showing whether that came from this code, a vendor file, or a human -- datasets/library/REPAIR-2026-09-05.md fixed a different, fingerprinted 77 rows in the same column but explicitly could not reach these; repairing them needs a founder-set evidentiary standard, not a wider WHERE."
```

- **Workstream:** wine-library | **Effort:** M
- **Why:** Founder flip decide->work (one of 11); not checkable by static command (production data-completeness gap with no owning ADR), so lands in the software's §9 Gaps line per the WORK rule. TIMING NOTE: apply after/with merging PR #394, since §9 does not exist in this tree yet.
- **Verified today:** Not a static-command claim (production row counts/provenance); confirmed instead: datasets/library/ holds only the 2026-09-05 repair set (no later one); ADR 0130 explicitly disclaims this ('not this session's to touch'); §9 does not exist yet in this tree -- confirmed PR #394 (origin/docs/softwares-capacity-coverage, commit 93df1d9b3, built from this same commit 804a1bdb5, unmerged) adds it with this exact Gaps-bullet shape.
- **Duplicates checked:** No existing OD/ADR-open-item/CLAIMS row tracks the remaining-251 backfill; ADR 0130 names the write-path fix only.

### 112. `modules-F2` -- WORK / direct text edit (paperwork, not a CLAIMS row)
**Section:** direct text edit, execution PR (not a CLAIMS row -- paperwork, r4-placement.json issue 9)

```
OLD: frontmatter line 7: `routes: ["/wines", "/sommelier"]`
NEW: `routes: ["/wines", "/sommelier", "/cellar", "/beer", "/whiskey", "/cocktails", "/spirits", "/non-alcoholic", "/soft-drinks"]` (App.tsx:322-333 confirms all seven Cellar surfaces are children of this product, gated by the same cellar PageGate flag as /wines, per the founder's 2026-08-29/30 call that Cellar extends this existing product rather than being a new one)
```
- **Note:** Additive only; no other frontmatter field needs to change per this item's own scope.

- **Workstream:** wine-library | **Effort:** M
- **Why:** Founder flip decide->work (one of 11). App.tsx records the founder's own call that /cellar is a scope-extension of the existing wine-library-sommelier product, not a new product -- amending the existing note is the tidy home, matching the founder's own don't-overcrowd instruction; no new 08-softwares/cellar.md needed.
- **Verified today:** Confirmed frontmatter is still routes: ["/wines", "/sommelier"]; App.tsx:318-333 confirms /cellar is the founder-decided parent surface of /wines, /beer, /whiskey, /cocktails, /spirits, /non-alcoholic, /soft-drinks, all under the same cellar PageGate flag.
- **Duplicates checked:** No existing home for the Cellar surfaces anywhere in 08-softwares/ (grepped all 25 notes for cellar/beverage).


## `.planning/decisions/0026-schema-has-one-home.md`  (1 items)

### 113. `44.3d` -- MOVE / owning ADR's own text
**Section:** Context, new paragraph after the intro (ending line 38), before '### Why Fresh database equals remote caught none of them' (line 48)

```
**Not the first time this rule was learned.** The 2026-07-28 v2.0 tech-debt compile records the same lesson independently: three assumptions read off supabase/migrations/ alone were wrong against the live database -- procurement_order_items existed in no migration at all, procurement_orders.wine_name was declared in a migration but never reached the database, and public.users keyed on user_id so a naive REFERENCES users(id) failed outright -- plus a GENERATED ALWAYS column (procurement_order_items.total_bottles) that rejects explicit inserts and is mentioned nowhere in the migration set. npm run db:drift was the check available at the time; check_queried_tables_exist.py and check_schema_parity.sh are this ADR's mechanised descendants of the same rule: read the live schema, not migrations.
```

- **Workstream:** ci-tooling | **Effort:** S
- **Why:** Convention item; the MOVE rule prefers an existing guard named in the owning ADR over CLAUDE.md, and ADR 0026 is exactly that owning ADR (same rule family, same guard script named in both). CLAUDE.md is also already over its own ~200-line budget (254 lines measured), a second independent reason to avoid it here.
- **Verified today:** Confirmed check_schema_parity.sh and schema-parity.yml both exist and are wired (runs on push + nightly); confirmed npm run db:drift is a real script; read ADR 0026 in full (369 lines, Status Proposed) and confirmed no existing paragraph already tells the 2026-07-28 anecdote.
- **Duplicates checked:** None -- ADR 0026 states the general rule and guards it in code, but does not yet cite this specific precedent; additive, not duplicate.


## `.planning/decisions/0099-vendor-email-had-no-caller-identity.md`  (1 items)

### 114. `models-F1` -- WORK / owning ADR's open-items list
**Section:** What this does NOT fix (extend the existing 'Nothing here makes the orchestrator run in production' bullet)

```
- **Nothing here makes the orchestrator run in production.** The measured blast radius of zero is because it does not. Whether it should is a separate decision. [2026-09-19: that separate decision was never filed -- grepped OPEN-DECISIONS.md for agent_activity_logs and orchestrator running, no row exists. Re-confirmed live 2026-09-18 (Supabase MCP, an independent later pass): select count(*) from agent_activity_logs is still 0, all time -- the table is purpose-built for exactly this and has never been written. This is the only production evidence available of whether the platform's 25 AI agents actually run at all. Needs a founder call: either confirm agents genuinely do not run against production and say why, or wire agent_activity_logs writes into the orchestrator's call path so the question stops being unanswerable by query.]
```

- **Workstream:** analytics-models | **Effort:** M
- **Why:** Founder flip decide->work (one of 11). Not CLAIMS-eligible (needs a live production count). Most significant single finding in this cluster: a CRITICAL fact (no evidence the platform's core AI-agent claim holds in production) was surfaced inside an ADR, flagged as needing a separate decision, and never filed anywhere. Placed as an ADR open-item extension since the mark is work not decide; static re-verification (zero writers in the Python agent code) independently corroborates the live-query finding.
- **Verified today:** Not independently re-queried against production for this pass (two measurements 16 days apart already agree the table is empty); confirmed instead, statically: grepped the whole repo for any writer of agent_activity_logs -- only 2 unrelated files reference the table at all (a cleanup script, a comment), nothing in services/agent-orchestrator ever inserts into it.
- **Duplicates checked:** ADR 0099 (lines 81,95,190) and ADR 0084 (line 308) already carry this fact as supporting evidence for their own narrower questions, and ADR 0099 explicitly says 'a separate decision' without ever filing it -- this closes that specific gap rather than duplicating a new finding.


## `.planning/decisions/0104-every-incoming-document-renders-as-one-canonical-mudavym-document.md`  (2 items)

### 115. `3153` -- MOVE / owning ADR's own text
**Section:** Review trail table, new row after the existing 2026-09-04 'Fable, first render' row (line 694, which dangles a v3.0-TECH-DEBT.md pointer)

```
| 2026-09-04 (methodology) | -- | **What slice 2 could not verify, named:** the four-way table, price-base sub-line, provenance hovers and every exception sentence were proven only against synthetic envelopes in component tests, never against a document a model actually read; no delivery row existed yet, so DeliverySpine had never rendered a card outside a test; ?view=door rendered the frame and its money suppression with no door count to show; and web eslint could not run in this environment (eslint-plugin-jsx-a11y missing), so web files were formatted with prettier only and left to CI's lint. Moved from v3.0-TECH-DEBT.md (retired) -- the row above (line 694) pointed there for these four plus five other, substantive findings; this row covers only the methodology four. |
```

- **Workstream:** receiving-documents | **Effort:** S
- **Why:** Owning ADR is exactly ADR 0104 (it already dangles a same-shaped citation into v3.0-TECH-DEBT.md at line 694 for this slice), matching the MOVE rule's preference for the owning ADR's text over a generic scenario doc. Flagged a genuine ambiguity (two 'nine findings' framings, possibly overlapping) rather than silently picking one.
- **Verified today:** Confirmed the source subsection (v3.0-TECH-DEBT.md:3153) has exactly four bullets matching its own title; confirmed ADR 0104:694 currently reads '...Nine findings filed in v3.0-TECH-DEBT.md...', a live but soon-dangling citation.
- **Duplicates checked:** None -- this exact four-item list is not restated anywhere else.
- **Citations to rewrite:**
  - .planning/decisions/0104-every-incoming-document-renders-as-one-canonical-mudavym-document.md:694 -- the phrase 'Nine findings filed in v3.0-TECH-DEBT.md' needs its pointer dropped only once ALL nine slice-2 findings have a home. UNRESOLVED CROSS-CHECK flagged for the executor: this row supplies 4 of those nine (methodology); the register also has a SEPARATE, differently-dated section titled 'the first render against extracted documents: nine findings' (v3.0-TECH-DEBT.md:3239, this batch's key canonical-first-render-9-findings, marked REMOVE/all-fixed-via-PR-#304) which may or may not be describing the SAME nine findings from a different angle. Confirm which is accurate (or that they are two different 'nine findings' on the same day) before rewriting line 694, and do not double-count.

### 116. `canonical-slice3-stop1-deviation-verified-by` -- MOVE / owning ADR's own text
**Section:** Review trail table, existing 2026-09-05 'slice 3 stop 1: the correction door (D5)' row (line 698) -- in-place citation fix

```
Replace the row's phrase "Two deviations, both stated in v3.0-TECH-DEBT.md:" with: "Two deviations from the brief (CLAUDE.md §0.5), recorded here: a correction that CHANGES a value clears that field's verified_by/verified_at rather than carrying the old tick onto a number nobody verified (carrying it would print a fabricated human assertion; the old tick survives in the append-only before -- reversible in one line in document-correction.service.ts plus a test that already names both directions, if the founder wants literal preservation instead); and the builder replays the correction LOG rather than serving the stored layer1 blob whole, so a later re-extraction stays visible instead of freezing the document at correction time."
```

- **Workstream:** receiving-documents | **Effort:** S
- **Why:** Destination given (a note on ADR 0104 D5) was exactly right; re-checking showed the row already carries nearly all the content, so the minimal, no-shortcuts fix is correcting the one dangling clause in place rather than duplicating a second paragraph elsewhere.
- **Verified today:** Confirmed the ADR row (line 698) currently reads the 'both stated in v3.0-TECH-DEBT.md' phrasing verbatim; confirmed the underlying code still matches (document-correction.service.ts:230-231,271, docstring at :33 titled 'WHY A CORRECTION CLEARS verified_by', citing ADR 0104 D5 at :238).
- **Duplicates checked:** Near-total duplication of existing content -- the ADR row already carries almost the full text, only pointing at the file being deleted for the word 'stated'; this is a citation fix plus one folded-in reversibility detail, not a new paragraph.


## `.planning/decisions/0149-mudavym-is-the-only-design-finish-every-page-then-delete-legacy-once.md`  (2 items)

### 117. `atlas-surfaces-F3` -- WORK / owning ADR's open-items list
**Section:** Consequences (new dated bracket bullet, following the file's own convention of appending dated addenda)

```
- **Rollout status re-confirmed (2026-09-18, Supabase MCP; not independently re-queried by this placement pass):** restaurant_feature_flags still holds exactly one row (ALDEMIR) against 14 production restaurants -- unchanged since this ADR's Context was written 2026-09-16. Any of the other 13 houses sees legacy on every page still gated by PageGate; rows 36/40's sixteen locked pages resolve unconditionally in code and are unaffected. This record sets no rollout pace for the rest -- that stays open until asked.
```

- **Workstream:** web-quality | **Effort:** M
- **Why:** Founder flip decide->work (one of 11); not checkable statically, so owning-ADR-open-item path. Marked work despite the item's own destination framing it as a founder call: ADR 0149 rows 36-37 already set the overall strategy, so the remaining rollout gap is execution of a decided plan, not an open fork.
- **Verified today:** Not independently re-queried against production for this pass (qualitative gap holds either way); confirmed ADR 0149's own Context (line 21) already states the identical fact as of 2026-09-16, and row 36 does say the 16 locked pages resolve unconditionally in code.
- **Duplicates checked:** ADR 0149 already documents this almost verbatim; no OPEN-DECISIONS row asks about rollout pace specifically -- this is a small dated status addendum, not new prose.

### 118. `44.15` -- MOVE / owning ADR's own text
**Section:** Consequences, new bullet after 'Gated stops inside this record' (line 146), before 'Revisit when' (line 147)

```
- **UX_PATHS_CATALOG.md's dead-button/partial-mocked audit (16 clusters, 9 partial, dated 2026-07-31) is superseded here, not a separate work list** [2026-09-19]. Every page it audited is rebuilt fresh under this ADR's full-purpose bar, and a 6-entry sample of the catalog was already 4-of-6 stale before this ADR existed (v3.0-TECH-DEBT.md 44.15, retired). Retiring the catalog file itself is a housekeeping call for whoever closes the deletion manifest -- it is a 07-reference/ corpus file, not a blocking gate on this ADR.
```

- **Workstream:** web-quality | **Effort:** S
- **Why:** Destination matched exactly: ADR 0149 already gates legacy deletion on a founder-approved manifest, so a one-bullet supersession note is the tidy home; file's own retirement left as a housekeeping footnote rather than a new OPEN-DECISIONS row, since the founder marked this MOVE not DECIDE. Six external bare-id citations are the largest citation-rewrite footprint of any item in this batch.
- **Verified today:** Confirmed UX_PATHS_CATALOG.md is unchanged at 158,311 bytes; confirmed its 'AUDITED 2026-07-31' banner (line 88) is still present, unresolved; confirmed ADR 0149 has a 'Consequences' section at line 134 and 'Review trail' at 150, so a new bullet fits before line 147.
- **Duplicates checked:** None -- this fold-in sentence is new; the underlying facts exist only in v3.0-TECH-DEBT.md today.
- **Citations to rewrite:**
  - .planning/decisions/0019-p2-build-scope.md:185
  - .planning/06-pages/login.md:109 (drop the bare '44.15' tag, the fact it records is already closed)
  - .planning/06-pages/promotions.md:83
  - .planning/06-pages/promotions.md:183
  - .planning/06-pages/providers.md:546
  - .planning/06-pages/wines.md:1216
  - Citation sweep (2026-09-19, git grep in wt-retire-debt@9c6bdc0be): .planning/06-pages/profile.md:1277; .planning/06-pages/providers.md:402; .planning/07-reference/INDEX.md:23; .planning/decisions/0019-p2-build-scope.md:7 -- rewrite to point at this item's home once the register is deleted.


## `.planning/decisions/0159-a-roles-revoke-leaves-public-grant-standing.md`  (1 items)

### 119. `increment-trust-counter-definer-rpc-live` -- WORK / owning ADR's own text
**Section:** Context, addendum right after the existing 2026-09-18 PR #391 audit passage (~line 19)

```
[2026-09-19, re-confirmed by a later triage pass, no new production query run: production still has not applied 20260917010400 -- see the 2026-09-18 entry immediately above, itself already re-verified live via Supabase MCP that day. A background session (task_7a4892b6, "Re-close OD-72's EXECUTE grant on increment_trust_counter") was started the same day to merge/deploy the PR #391 train migration -- check its outcome before re-querying production again.]
```

- **Workstream:** security-money | **Effort:** S
- **Why:** Not CLAIMS-eligible (verifying production migration-application needs the Supabase MCP, which the CLAIMS runner forbids). Not a fresh OD either -- ADR 0159 already fully investigated this; only a forward pointer to today's re-confirmation and the in-flight background task was missing. Deliberately did not re-query Supabase, since the home is the same regardless of the exact current count.
- **Verified today:** Not independently re-queried against production for this pass (the home does not depend on the exact current count); confirmed statically that the migration file supabase/migrations/20260917010400_a_security_definer_rpc_answers_only_to_the_server.sql exists in this tree, so the repo-side fix is present and only the production-apply lag remains.
- **Duplicates checked:** Near-total duplication of existing content: ADR 0159's Context (lines 14-19) and the resolved OD-72 CLAIMS row both already state this caveat almost verbatim -- only a tiny dated pointer is added, not a new paragraph.


## `.planning/decisions/AGENT_NATIVE_UI_DECISION.md`  (1 items)

### 120. `deferred-agent-native-ui` -- MOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** Whole document (375 lines) -- already the full, current, standalone decision record


- **Workstream:** docs-records | **Effort:** S
- **Why:** Destination says 'already lives in its own decision doc' -- verified true and current; nothing new to write, the tidy action is simply not re-creating a second copy when the register's one-line pointer row is dropped.
- **Verified today:** Confirmed 375 lines, Status line reads the DO-NOT-BUILD recommendation matching the register's gloss exactly; independently corroborated via OPEN-DECISIONS.md's OD-01 (resolved), whose own executed-file list names this exact file as an intentional 2026-08-27 vault-cleanup placement.
- **Duplicates checked:** AGENT_NATIVE_UI_DECISION.md (whole file) -- verbatim, current, and independently confirmed placed there on purpose.


## `apps/api-gateway/README.md`  (1 items)

### 121. `two-typechecks-agreeing` -- MOVE / a software's own §9
**Section:** New section '## Type-checking specs', appended after the existing '## The OpenAPI spec' section (file is 26 lines total)

```
## Type-checking specs

tsconfig.json excludes *.spec.ts, so `tsc --noEmit -p tsconfig.json` -- the command most sessions reach for -- is clean even when a spec is missing an argument. Only `npx tsc --noEmit -p tsconfig.spec.json` reads specs, and CI's "Lint TypeScript" job is the only place that runs it (via pnpm run type-check -> turbo run typecheck -> this package's tsc --noEmit -p tsconfig.spec.json). Jest does not typecheck either -- it transpiles with swc, so a spec passing the wrong number of constructor arguments still runs green if the missing dependency is never touched by the test. After touching a controller or service constructor, run the spec typecheck locally before pushing: `npx tsc --noEmit -p apps/api-gateway/tsconfig.spec.json`.
```

- **Workstream:** ci-tooling | **Effort:** S
- **Why:** Destination given was CLAUDE.md as a local-dev habit note; overridden since CLAUDE.md is already over its ~200-line ceiling and the habit is package-specific, not repo-wide. apps/api-gateway/README.md is a short, near-empty, package-scoped doc -- a better, non-overcrowding home. No guard proposed (the source text itself says none was built), since building one would be WORK, not this MOVE. Home_kind recorded as 'software-note' as the closest available category for a package README; the real target path is apps/api-gateway/README.md, not an 08-softwares/ file.
- **Verified today:** Confirmed apps/api-gateway/README.md is 26 lines with one existing section, room for a short addition; confirmed package.json's typecheck/type-check script chain and ci.yml's 'Lint TypeScript' job wiring end to end exactly as described.
- **Duplicates checked:** None -- the README currently says nothing about type-checking at all.


## `apps/api-gateway/src/communications/email-templates/template-config.ts`  (1 items)

### 122. `toLocaleDateString-convention` -- MOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** Lines 172-186 (formatDate JSDoc) and apps/web/src/__tests__/setup.ts:12 (TZ pin) -- both already fully document the convention


- **Workstream:** web-quality | **Effort:** S
- **Why:** Destination offered was CLAUDE.md or an engineering-conventions doc; overridden -- no such doc exists, and CLAUDE.md is already over its own ~200-line ceiling. Re-checking found the convention already recorded, in more useful detail, directly on the shared helper every future call site should use, plus mechanised as a test-setup TZ pin -- both stronger, more discoverable homes than a new prose rule.
- **Verified today:** Confirmed formatDate's JSDoc (template-config.ts:172-199) already states the UTC-pin convention in full, including the cross-file precedent citation to studio-invite.controller.ts's original fix (confirmed still present at :102); confirmed apps/web/src/__tests__/setup.ts:12 still pins TZ='America/New_York' as the mechanised regression guard.
- **Duplicates checked:** template-config.ts:172-186 (formatDate/formatShortDate JSDoc) and setup.ts:12 (non-UTC TZ pin) -- both already document/guard the convention.


## `scripts/check_web_reads_gateway_dto_keys.py`  (1 items)

### 123. `orders-wire-guard-blindspot-test-fixture-cast` -- MOVE / a script/guard's own docstring
**Section:** Docstring section 'WHAT IT CANNOT READ, AND SAYS SO' (3 bullets, lines ~50-62) -- new 4th bullet, same style

```
* **A test fixture cast defeats it too, permanently.** `{ ... } as Order` in a test file compiles with any keys at all, including ones the wire never sends -- WaitingOnYou.seal.test.tsx passed for months on a fixture carrying six such keys. Nothing short of a separate lint rule banning `as <MirroredType>` in test files closes this; recorded here so the guard's green is not read as covering test fixtures too.
```

- **Workstream:** procurement-orders | **Effort:** S
- **Why:** Destination given (guard's own docstring / CLAUDE.md) matched a strong pre-existing convention: every guard script here documents its own blind spots in its docstring, and one already cross-references the tech-debt file the same way this one should have. More discoverable than CLAUDE.md, which is also already over its ~200-line target.
- **Verified today:** Read the guard script in full (557 lines): its docstring's 'WHAT IT CANNOT READ' section has exactly 3 bullets today and the third already cross-references v3.0-TECH-DEBT.md for a sibling blind spot -- confirming this file's own established convention of documenting known blind spots in-place; confirmed the fixture-cast blind spot is not yet documented in the guard (0 hits for 'fixture cast'/'WaitingOnYou').
- **Duplicates checked:** None -- this is the one of the guard's three known blind spots not yet written into its own docstring; a sibling one already is.
- **Citations to rewrite:**
  - Citation sweep (2026-09-19, git grep in wt-retire-debt@9c6bdc0be): scripts/check_web_reads_gateway_dto_keys.py:62 -- rewrite to point at this item's home once the register is deleted.


## `.planning/v3.0-TECH-DEBT.md`  (107 items)

### 124. `2433` -- WORK / no successor row (removed, or re-verified not-a-defect)
**Section:** line 2433, section header (POS bridge four-defect rollup parent -- see sub-items 2433.1/.2/.4 this plan, .3 remove batch)


- **Workstream:** n/a | **Effort:** n/a
- **Why:** Parent/summary row whose content is captured by its sub-items; a separate entry would duplicate them and overcrowd the docs.
- **Verified today:** Pure rollup row; content fully covered by sub-items 2433.1, 2433.2, 2433.4 (this plan) and 2433.3 (remove/fixed).
- **Duplicates checked:** Fully covered by its own numbered sub-items.
- **Citations to rewrite:**
  - .planning/decisions/0105-a-pos-connection-is-a-row-not-an-env-var.md:139-141
  - Citation sweep (2026-09-19, git grep in wt-retire-debt@9c6bdc0be): .planning/decisions/0105-a-pos-connection-is-a-row-not-an-env-var.md:124 -- rewrite to point at this item's home once the register is deleted.

### 125. `2478` -- WORK / no successor row (removed, or re-verified not-a-defect)
**Section:** line 2478, section header (P2 door-build two-defect rollup parent -- see 2478.1/.2 this plan)


- **Workstream:** n/a | **Effort:** n/a
- **Why:** Same anti-duplication reasoning as other rollup parents.
- **Verified today:** Pure rollup; content covered by 2478.1 and 2478.2 (this plan).
- **Duplicates checked:** Fully covered by its two sub-items.
- **Citations to rewrite:**
  - .planning/decisions/0103-a-delivery-is-agreed-before-it-is-verified.md:196-198

### 126. `2499` -- WORK / no successor row (removed, or re-verified not-a-defect)
**Section:** line 2499, section header (Sim Meyhouse lens rollup parent -- see 2499.D1-12/.D9 remove batch, 2666.A6 this plan)


- **Workstream:** n/a | **Effort:** n/a
- **Why:** Same anti-duplication reasoning as other rollup parents.
- **Verified today:** Rollup; 21 sub-items, all but one (2666.A6, handled separately) are marked remove elsewhere.
- **Duplicates checked:** Fully covered by its sub-items.
- **Citations to rewrite:**
  - .planning/03-scenarios/S04-pos-order-flows-to-inventory.md:156
  - .planning/06-pages/reports.md:999

### 127. `2717` -- WORK / no successor row (removed, or re-verified not-a-defect)
**Section:** line 2717, section header (Antalya-lens rollup parent -- see F1-F5/F9 remove batch, F6/F7/F8/F10 this plan)


- **Workstream:** n/a | **Effort:** n/a
- **Why:** Same anti-duplication reasoning as other rollup parents.
- **Verified today:** Rollup; 1-4,9 fixed (remove batch), F6/F10 here, F7/F8 in this plan too (see below).
- **Duplicates checked:** Fully covered by its ten sub-items.
- **Citations to rewrite:**
  - .planning/03-scenarios/S04-pos-order-flows-to-inventory.md:205

### 128. `2866` -- WORK / no successor row (removed, or re-verified not-a-defect)
**Section:** line 2866, section header


- **Workstream:** docs-records | **Effort:** S
- **Why:** Founder marked 'work' but re-checking shows this is the register's own section header, not a standalone checkable claim -- content fully covered by D1-D5's individual dispositions. Flagged transparently per CLAUDE §0.5 rather than inventing a sixth artifact.
- **Verified today:** This key names a section HEADING grouping 5 already-individually-triaged sub-defects (D1,D2,D4 fixed/remove; D5 fixed/remove; D3 placed separately as its own row below). Confirmed via the export's own evidence and this batch's dispositions.
- **Duplicates checked:** Fully covered by its 5 children's own dispositions.
- **Citations to rewrite:**
  - v3.0-TECH-DEBT.md:2866 itself (retired wholesale); grep -rn 2866 .planning/decisions/ is empty

### 129. `44.1e-collision-meta` -- WORK / no successor row (removed, or re-verified not-a-defect)
**Section:** lines 86 and 154 (the two '44.1e' entries)


- **Workstream:** docs-records | **Effort:** S
- **Why:** Both defects the collision refers to already have distinct, non-colliding homes elsewhere in this triage. Once the register is deleted the id ceases to exist anywhere, so the collision cannot recur -- nothing left to place.
- **Verified today:** grep -n '44\.1e' shows exactly the two named entries and nothing else anywhere in .planning/. Both underlying defects have distinct successor keys in this same export: 44.1e-invoicescanner (remove/fixed) and sommelier-history-broken-by-od72 (decide, this plan).
- **Duplicates checked:** n/a -- names a bookkeeping id collision in the register itself, not a code claim.
- **Citations to rewrite:**
  - v3.0-TECH-DEBT.md:86 and :154 (retired wholesale); no other file cites bare '44.1e'

### 130. `atlas-backbone-missed-M2` -- WORK / no successor row (removed, or re-verified not-a-defect)
**Section:** atlas-backbone missed-M2 finding (no dedicated register line -- a 2026-09-18 atlas-audit miss)


- **Workstream:** ci-tooling | **Effort:** S
- **Why:** Founder mark is WORK, but re-verification (per the task's explicit re-check instruction, same treatment as 44.2b) shows the underlying premise does not hold: the repo is not defective here, and no CLAIMS row phrased against this repo's own files could ever legitimately flip, because the check depends on a machine's local node_modules, not on anything version-controlled. Dropped rather than retargeted: no adjacent, genuinely-open repo-level defect was found to retarget it to (the CI job's own lack of an install step is a CI-tooling design choice already covered by other rows, not itself a defect -- installing before a type-check job is normal and its absence here is deliberate, since this job only greps for banned patterns, per ci.yml:540-547).
- **Verified today:** RE-VERIFIED 2026-09-19 (r4-placement.json issue 3): not a repo defect. pnpm-lock.yaml's apps/mobile importer already lists '@types/jest' (the dependency IS declared and locked correctly). `test -d apps/mobile/node_modules/@types/jest` depends on whether `pnpm install` has been run locally -- the CI claims job (ci.yml:540-547) runs no install step at all, so this check can never flip in CI regardless of repo state. Confirmed a local-machine-state artifact, not a defect this repo's code or config can fix.
- **Duplicates checked:** No existing row.

### 131. `1682` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** ## Analytics -- four defects, added 2026-08-31 (line 1682)


- **Workstream:** analytics-models | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** Banner (line 1685-1689) states defects 1-3 CLOSED; defect 4 (maxDrawdown) independently tracked as this plan's WORK item 1682.4 -- nothing lost by dropping the parent banner.
- **Duplicates checked:** none found
- **Citations to rewrite:**
  - Citation sweep (2026-09-19, git grep in wt-retire-debt@9c6bdc0be): .planning/07-reference/pr-audits/354-b0f0a514.md:35; .planning/07-reference/pr-audits/354-b0f0a514.md:44 -- rewrite to point at this item's home once the register is deleted.

### 132. `1743` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** ## Corpus -- ADR 0032 has 36 conflict-marker lines, added 2026-08-31 (line 1743)


- **Workstream:** ci-tooling | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** grep -c conflict markers in 0032-vault-cleanup-cut-line.md -> 0 today; check_no_conflict_markers.py wired into CI (ci.yml:582,585, incl. --self-test).
- **Duplicates checked:** none found

### 133. `1761` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** ## Analytics -- procurement_orders.provider_name never existed, CLOSED 2026-09-01 (line 1761)


- **Workstream:** analytics-models | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** advanced-analytics.service.ts:141 embeds vendor name via the providers FK relation, not the nonexistent column.
- **Duplicates checked:** none found

### 134. `1796` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** ## Analytics -- deadStockCapital measured depth not movement, CLOSED 2026-09-01 (line 1796)


- **Workstream:** analytics-models | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** dead-stock.spec.ts exists with 5 cases including 'deadStockCapital measures movement, not depth' (line 85, assertions 106/154/164).
- **Duplicates checked:** none found

### 135. `1823` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** ## Analytics -- the forecast backtest was in-sample, CLOSED 2026-09-02 (line 1823)


- **Workstream:** analytics-models | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** forecasting.ts:33-41 -- every model reports its own warmup; forecasting.spec.ts and forecast-accuracy-honesty.spec.ts both exist.
- **Duplicates checked:** none found

### 136. `1889` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** ## Analytics -- delivered filters wrong case, CLOSED 2026-09-02 (line 1889)


- **Workstream:** analytics-models | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** apps/api-gateway/src/procurement/order-status.ts exists (the hasStatus()/case-normalizing helper the fix introduced).
- **Duplicates checked:** none found

### 137. `1946` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** ## Four defects, motion-canvas sweep, added 2026-08-27, ALL CLOSED 2026-09-12 (line 1946)


- **Workstream:** web-quality | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** Banner states all four closed with commit hashes; git history confirms fix/motion-sweep-defects merged.
- **Duplicates checked:** none found

### 138. `1969` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** ### 1. Every stock:updated rewrites the row someone is reading (line 1969)


- **Workstream:** web-quality | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** grep isQueryAffectedByStockUpdate apps/web -> exported (line 115), used as the invalidation predicate (line 570).
- **Duplicates checked:** none found

### 139. `2028` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** ### 3. A docstring asserts a wiring that does not exist (line 2028)


- **Workstream:** web-quality | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** useUxOverrides.ts:12 now reads 'NOT MOUNTED ANYWHERE' -- confirmed live.
- **Duplicates checked:** none found

### 140. `2044` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** ### 4. Notifications.tsx:231 discards foldedById (line 2044)


- **Workstream:** web-quality | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** Notifications.tsx:316 destructures {items: dedupedNotifications, foldedById} and renders it at :1317.
- **Duplicates checked:** none found

### 141. `2064` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** ## Two defects, P2 door build, added 2026-08-30 (line 2064, parent)


- **Workstream:** receiving-documents | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** Both sub-items (2064.1, 2064.2, this batch) independently re-verified fixed; parent is just a wrapper.
- **Duplicates checked:** none found

### 142. `2064.1` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** ## Two defects, P2 door build -> 'SyncManager silently deletes every queued door receipt' (line 2069)


- **Workstream:** receiving-documents | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** sync-manager.ts:209 logs 'Already syncing, skipping'; handler map skips unknown mutation types before the dead-mutation discard path.
- **Duplicates checked:** none found

### 143. `2064.2` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** ## Two defects, P2 door build -> globals.css forces white inputs !important


- **Workstream:** web-quality | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** .dark input/select/textarea rules present (globals.css:245-247,441-453,464-465,471-472), inherited from feat/mudavym-brand.
- **Duplicates checked:** none found

### 144. `2099` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** ## Absence-as-health -- three acting instances, CLOSED 2026-09-01 (line 2099, parent)


- **Workstream:** procurement-orders | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** All three sub-items (2099.1-3, this batch) independently re-verified fixed.
- **Duplicates checked:** none found

### 145. `2099.1` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** ## Absence-as-health -> '1. providers.service.ts dedup guard failed OPEN' (line 2120)


- **Workstream:** procurement-orders | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** providers.service.ts:146 throws ServiceUnavailableException on a failed lookup; providers.fail-open.spec.ts exists.
- **Duplicates checked:** none found

### 146. `2099.2` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** ## Absence-as-health -> '2. pos-hub loadTables wrote a wrong row, reported success' (line 2127)


- **Workstream:** procurement-orders | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** pos-hub.service.ts:1229,1242,1244 returns {tables, error} (error non-null on failure) instead of silent success.
- **Duplicates checked:** none found

### 147. `2099.3` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** ## Absence-as-health -> '3. pos-hub recordConsumption SILENT OMISSION' (line 2137)


- **Workstream:** procurement-orders | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** pos-hub.service.ts calls this.logger.error on failure paths (5 sites); pos-hub.fail-open.spec.ts exists.
- **Duplicates checked:** none found

### 148. `2251` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** ## CI -- nightly prod E2E reports 'not configured' as failure, added 2026-09-02 (line 2251)


- **Workstream:** ci-tooling | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** e2e-prod.yml:130 has a step named 'Required secrets are present'.
- **Duplicates checked:** none found
- **Citations to rewrite:**
  - Citation sweep (2026-09-19, git grep in wt-retire-debt@9c6bdc0be): .github/workflows/e2e-prod.yml:16; .github/workflows/e2e-prod.yml:96 -- rewrite to point at this item's home once the register is deleted.

### 149. `2381` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** ## Dev tooling -- dev bypass minted an unusable session, FIXED 2026-09-03 (line 2381)


- **Workstream:** auth-tenancy | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** dev-bypass.util.ts/jwt.strategy.ts/auth.service.ts/auth.controller.ts all grep-match; dev-bypass-verified.spec.ts exists (25 assertions).
- **Duplicates checked:** none found

### 150. `2433.3` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** ## POS bridge -- four defects, added 2026-09-03 -> 'covers: null stored as 0' (sub-item 3)


- **Workstream:** procurement-orders | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** pos-adapters.ts:32-36 -- num() returns null (not 0) for null/undefined/'' before Number() coercion; used at :64.
- **Duplicates checked:** none found

### 151. `2499.D1-12` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** ## POS->inventory->alerts lens, Sim Meyhouse, added 2026-09-03 -> Defects (line 2515), nine of twelve


- **Workstream:** receiving-documents | **Effort:** S
- **Why:** REMOVE per founder triage; nine of twelve numbered defects carry FIXED closure notes. Spot-checked, not exhaustively re-run item-by-item -- flagged per CLAUDE.md §0.5.
- **Verified today:** Each carries its own FIXED closure note per export evidence, spot-checked, consistent with code at HEAD.
- **Duplicates checked:** none found
- **Citations to rewrite:**
  - Citation sweep (2026-09-19, git grep in wt-retire-debt@9c6bdc0be): apps/web/src/services/api/inventory.lowstock.test.ts:7; apps/web/src/services/api/inventory.ts:29 -- rewrite to point at this item's home once the register is deleted.

### 152. `2499.D9` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** ## POS->inventory->alerts lens, Sim Meyhouse -> Defects, item 9 (Reports blames a missing POS)


- **Workstream:** analytics-models | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** reportsDataGap.ts defines no_pos_connected/pos_sends_no_money/pos_status_unknown as distinct kinds (lines 20-22,60-81), wired into Reports.tsx.
- **Duplicates checked:** none found

### 153. `2666.A1-4` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** ## Customer+intelligence lens, Sim Meyhouse -> Defects (line 2882), items 1-4 (fabricated revenue/comparison/busy-hours/reconciliation)


- **Workstream:** analytics-models | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** PeriodCompareBar.tsx:5, BusyHoursHeatmap.tsx:5, MonthlyReconciliation.tsx:7 each carry a comment describing the removed Math.random() fabrication.
- **Duplicates checked:** none found

### 154. `2666.A5` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** ## Customer+intelligence lens -> Defects, item 5 (loading rendered as empty)


- **Workstream:** web-quality | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** Legacy/obsolete: the page was rebuilt as InventoryCommandPage.tsx, a different component from the one the defect described.
- **Duplicates checked:** Legacy/obsolete -- page rebuilt, finding no longer applies to any live component.

### 155. `2666.A7` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** ## Customer+intelligence lens -> Defects, item 7 (pos-mapping-review stale unit claim)


- **Workstream:** procurement-orders | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** pos-mapping-review.service.spec.ts:330,386 -- effect_if_unanswered/queue_on_next_sale vocabulary is live in an adjacent file to the one originally cited.
- **Duplicates checked:** none found

### 156. `2666.A8` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** ## Customer+intelligence lens -> Defects, item 8 (alert ledger records alerts nobody received)


- **Workstream:** analytics-models | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** low-stock-alerts.service.ts:213,250 -- last_alerted_at/alert_count written only after persistForRestaurant confirms a row.
- **Duplicates checked:** none found

### 157. `2666.A9` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** ## Customer+intelligence lens -> Defects, item 9 (rate limit reported as logout)


- **Workstream:** auth-tenancy | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** AuthContext.tsx:308,322 -- 'Only a 401 means the token is invalid' comment, status===401 gate before clearing tokens.
- **Duplicates checked:** none found

### 158. `2717.F1` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** ## POS->inventory->alerts lens, Sim Vanilla Kaleici -> Findings (line 2746), F1 (notifications scoped to USER not tenant)


- **Workstream:** auth-tenancy | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** notifications.controller.ts:65,68 reads req.user.restaurantId and refuses an unscoped read; :115 refuses a client-supplied mismatched restaurant id.
- **Duplicates checked:** none found

### 159. `2717.F2` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** ## POS->inventory lens -> Findings, F2 (unrecognised wine asserted RED)


- **Workstream:** wine-library | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** wineData.ts and useInventoryPage.ts both exist; 'unknown' is now a type-union member (file presence spot-checked, not a full type-check re-run).
- **Duplicates checked:** none found

### 160. `2717.F3` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** ## POS->inventory lens -> Findings, F3 (fabricated producer/Unknown country)


- **Workstream:** wine-library | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** wine-submissions.service.ts:31-33 types producer?/country? as string|null (nullable, not fabricated-string) throughout.
- **Duplicates checked:** none found

### 161. `2717.F4` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** ## POS->inventory lens -> Findings, F4 (HOUSE WHITE cross-tenant bind)


- **Workstream:** wine-library | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** Fixed by ADR 0130 (provisional_for_restaurant_id, commit fc6b9a77e); ADR is self-contained, does not cite the tech-debt line number.
- **Duplicates checked:** none found

### 162. `2717.F5` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** ## POS->inventory lens -> Findings, F5 (unpriced menu row -> HTTP 500)


- **Workstream:** procurement-orders | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** 20260905174500_simpos_behaves_like_a_pos.sql:35 -- alter column price drop not null, citing ADR 0020 (null renders as 'unpriced').
- **Duplicates checked:** none found

### 163. `2717.F9` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** ## POS->inventory lens -> Findings, F9 (open bottle volume in two places)


- **Workstream:** wine-library | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** grep -rn current_volume_ml apps/api-gateway/src (excl. spec) -> 0 hits; open_bottle_ml is the sole live source per export evidence.
- **Duplicates checked:** none found

### 164. `2825.A2` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** ## POS->inventory lens -> Absence reported as health (line 2825), A2 (Low Stock 'Unknown wine')


- **Workstream:** wine-library | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** Duplicate of register:2866.D1 (same camelCase/snake_case low-stock defect, fixed there via normalizeInventoryItem).
- **Duplicates checked:** Duplicate of 2866.D1 (this batch) -- do not create a second entry.

### 165. `2825.A4` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** ## POS->inventory lens -> Absence reported as health, A4 (zero velocity -> finite runway)


- **Workstream:** analytics-models | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** bits.tsx:16 runwayDays() confirmed to return null when velocity is not >0 (fixed by the inventory page rebuild).
- **Duplicates checked:** none found

### 166. `2866.D1` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** ## Customer+intelligence lens, Sim Meyhouse -> Defects (line 2882), D1 (dashboard camelCase vs snake_case)


- **Workstream:** analytics-models | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** normalizeInventoryItem exported/used in useInventoryQueries.ts, RailPanels.tsx, services/api/inventory.ts; inventory.lowstock.test.ts exists.
- **Duplicates checked:** none found (2825.A2, this batch, is the duplicate of this row -- 2866.D1 is the canonical one kept-as-fixed)

### 167. `2866.D2` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** ## Customer+intelligence lens -> Defects, D2 ('30 orders' is thirty days)


- **Workstream:** analytics-models | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** Reports.tsx:189-190 -- totalOrders now sums a real order count field, not a day count.
- **Duplicates checked:** none found

### 168. `2866.D4` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** ## Customer+intelligence lens -> Defects, D4 (sommelier fallback dead code)


- **Workstream:** wine-library | **Effort:** S
- **Why:** REMOVE per founder triage; file-presence spot-checked, not a full runtime re-test this session -- flagged per CLAUDE.md §0.5.
- **Verified today:** Fallback rewritten to read real inventory; liveStock grep hits exist across RealtimeContext.tsx, wineLibraryExport.ts, inventory components -- file-presence spot-checked, not a full runtime re-test.
- **Duplicates checked:** none found

### 169. `2866.D5` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** ## Customer+intelligence lens -> Defects, D5 (ADR 0020 fabrication still served)


- **Workstream:** analytics-models | **Effort:** S
- **Why:** FIXED per re-verified code comment (line 235, relabeled as an upper bound). One live citation will dangle (recommendations-catalog.md:103) and needs rewriting once the register is deleted.
- **Verified today:** insight-generator.service.ts:235 comment: '// UPPER BOUND, not a count of what this restaurant can receive.' Line 245 still computes candidateTypesAvailable, now honestly labeled.
- **Duplicates checked:** none found
- **Citations to rewrite:**
  - .planning/06-pages/recommendations-catalog.md:103 (still frames this as 'TECH-DEBT defect 5' with the old framing -- needs rewriting to point at the code comment/ADR 0020 directly)

### 170. `3044` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** ## Canonical document slice 1 -- four gaps, added 2026-09-03 (line 3044, parent)


- **Workstream:** receiving-documents | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** All four sub-items (3044.1-4, this batch) independently re-verified fixed.
- **Duplicates checked:** none found

### 171. `3044.1` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** ## Canonical document slice 1 -> gap 1 (coerceDocType filed new doc types as unknown)


- **Workstream:** receiving-documents | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** document-extractor.service.ts:339,491,493-494 -- coerceDocType derives from the imported DOC_TYPES array, not a hardcoded drifted list.
- **Duplicates checked:** none found

### 172. `3044.2` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** ## Canonical document slice 1 -> gap 2 (BT-149 price base qty couldn't round-trip)


- **Workstream:** receiving-documents | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** 20260904120000_document_lines_price_base_and_printed.sql adds price_base_qty/uom; canonical-document.service.ts:172,219,230 reads/writes them, citing BT-149/BT-150.
- **Duplicates checked:** none found

### 173. `3044.3` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** ## Canonical document slice 1 -> gap 3 (no per-field confidence, no as_printed)


- **Workstream:** receiving-documents | **Effort:** S
- **Why:** REMOVE per founder triage; doc's #298 closure note is detailed and consistent with the pattern confirmed in 3044.1/3044.2. Not independently re-tested against a live document upload this session -- flagged per CLAUDE.md §0.5.
- **Verified today:** Trusted from the doc's own detailed #298 closure text per export evidence; not independently re-run beyond that.
- **Duplicates checked:** none found

### 174. `3044.4` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** ## Canonical document slice 1 -> the one verification the build could not do


- **Workstream:** receiving-documents | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** datasets/canonical/CORPUS-RUN-2026-09-05-after-306.md exists (file present); export evidence states it records production data.
- **Duplicates checked:** none found

### 175. `3107` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** ## ADR 0104 slice 2 -- what building the canonical document found (2026-09-04) (line 3107, parent)


- **Workstream:** receiving-documents | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** Doc's own text: 'six findings, five fixed... one left standing' -- the 'one left standing' (3107.6, this batch) is now ALSO confirmed fixed, so all six are closed.
- **Duplicates checked:** none found

### 176. `3107.1-5` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** ## ADR 0104 slice 2 -> findings 1-5 (extractor-throw/clean-verdict/$0.00/filename-42703/corpus-headline)


- **Workstream:** receiving-documents | **Effort:** S
- **Why:** REMOVE per founder triage; all five carry FIXED in the doc's own prose. Not independently re-run item-by-item beyond the adjacent 3107.6 spot check -- flagged per CLAUDE.md §0.5.
- **Verified today:** Each carries FIXED in its own detailed prose per export evidence; spot-checked finding 1's neighbor (document-intake currency handling) separately under 3107.6.
- **Duplicates checked:** none found

### 177. `3107.6` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** ## ADR 0104 slice 2 -> finding 6, labeled STANDING (unreadable() defaults currency to USD)


- **Workstream:** receiving-documents | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** document-intake.service.ts:953 comment confirms the fix landed ('This was the literal USD until 2026-09-06'); :1054 confirms NULL is now used instead of 'USD'. The doc's own STANDING label is itself stale.
- **Duplicates checked:** none found

### 178. `44.1a` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** ## Track A -- 44.1 Auth/data-integrity defects (line 711) + 'Closed since this document was compiled' -- logged twice


- **Workstream:** auth-tenancy | **Effort:** S
- **Why:** FIXED and re-verified live; safe to drop both duplicate rows. Three other docs name '44.1a' by id; none treats it as still-open, so nothing needs reopening, but citations should be repointed.
- **Verified today:** one-tap-actions.controller.ts:64 carries class-level JwtAuthGuard; security-charter.md:288-290 confirms 403 on cross-tenant access; no URL-supplied restaurantId/hardcoded userId remain.
- **Duplicates checked:** Logged twice within the register itself (open-list entry + closed-log entry) -- both dropped together as one item.
- **Citations to rewrite:**
  - .planning/01-org/intelligence/security/security-charter.md:293 (says 'still lists 44.1a as open' -- itself stale, will dangle)
  - .planning/foundation/teams/intelligence.md:241-242 (cites the same line range as an example)
  - .planning/06-pages/notifications.md:1141 (bare '(44.1a closed)' parenthetical, no line cite, will read as orphan)
  - Citation sweep (2026-09-19, git grep in wt-retire-debt@9c6bdc0be): .planning/01-org/intelligence/security/teams/access-control-tenant-isolation/access-control-tenant-isolation-charter.md:131; .planning/archive/STATE-pre-P2-20260825.md:29 -- rewrite to point at this item's home once the register is deleted.

### 179. `44.1c` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** ## Track A -- 44.1 defects (line 713) -- inbound email agents never registered


- **Workstream:** procurement-orders | **Effort:** S
- **Why:** FIXED and fully re-verified live (registration + routing key both fixed). Only citation found is in an already-archived, frozen snapshot, which by convention is not edited after archiving.
- **Verified today:** orchestrator.py:210-211 registers email_intel_agent and email_parsing_agent; email_intel_agent.py:125-137 now subscribes to email.inbound.received (comment notes the old dead .raw key).
- **Duplicates checked:** none found
- **Citations to rewrite:**
  - .planning/archive/ROADMAP-pre-P2-20260825.md:145,711,713,736 (archived, frozen by convention -- left as-is)

### 180. `44.1d` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** ## Track A -- 44.1 defects (line 714) -- notifications status vs is_read mismatch


- **Workstream:** web-quality | **Effort:** S
- **Why:** REMOVE per founder triage; FIXED per the doc's own RESOLVED note and file presence, not independently re-tested this session -- flagged per CLAUDE.md §0.5. Two live citations point at the specific line range 95-131 and need repointing to the fix commit/code instead.
- **Verified today:** Doc states RESOLVED; core/notifications.py exists as described per export evidence. Not independently re-tested with a live insert this session.
- **Duplicates checked:** none found
- **Citations to rewrite:**
  - .planning/06-pages/notifications.md:984-985 (cites the specific line range 95-131)
  - .planning/06-pages/notifications.md:1191 (table row citing the same range)

### 181. `44.1e-invoicescanner` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** ### 44.1 defects -- '44.1e -- InvoiceScannerModal posts to an endpoint that does not exist' (line 86; id collision with a second, unrelated 44.1e at line 154)


- **Workstream:** receiving-documents | **Effort:** S
- **Why:** Fully OBSOLETE per its own evidence; file re-confirmed absent. Two live docs cite the numeric id by name and should have the dangling pointer reworded when the register is deleted.
- **Verified today:** find -iname InvoiceScannerModal* (excl. node_modules) -> no output, confirmed absent from the tree.
- **Duplicates checked:** Sibling of 44.5-correction-note (same fact, a later correction) and of many independent, still-accurate InvoiceScannerModal mentions elsewhere describing it as already gone.
- **Citations to rewrite:**
  - .planning/STATE.md:112 ('44.1e is already closed' -- cites the id by number, will dangle)
  - .planning/decisions/0019-p2-build-scope.md:92 (same)

### 182. `44.1g` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** ### 44.1 defects -- '44.1g -- POST /auth/register let anyone name a house and a role. CLOSED 2026-09-18' (line 152)


- **Workstream:** auth-tenancy | **Effort:** S
- **Why:** Verified live: route answers 410, service writer deleted, closing spec exists; already the subject of a resolved CLAIMS row, so the register row is a pure duplicate.
- **Verified today:** grep confirms register() now throws GoneException; no async register(/restaurant_id: data.restaurantId in auth.service.ts; register-is-closed.spec.ts exists. All 4 checks pass on wt-review today.
- **Duplicates checked:** Already tracked live as the resolved CLAIMS row ADR-0147-REGISTER-NAMES-NO-HOUSE -- reuse, no new row.
- **Citations to rewrite:**
  - .planning/decisions/0147-the-pages-endpoints-answer-only-for-the-callers-house-and-person.md:148,166
  - .planning/decisions/0162-managers-grant-manager-or-staff-on-both-doors.md:332
  - apps/api-gateway/src/auth/auth.controller.ts:112 (comment cites 'v3.0-TECH-DEBT 44.1g')
  - Citation sweep (2026-09-19, git grep in wt-retire-debt@9c6bdc0be): .planning/decisions/0147-the-pages-endpoints-answer-only-for-the-callers-house-and-person.md:130; .planning/decisions/CLAIMS.jsonl:350 -- rewrite to point at this item's home once the register is deleted.

### 183. `44.1h` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** ### 44.1 defects -- '44.1h -- A manager could mint an owner's invite. CLOSED 2026-09-18' (line 198)


- **Workstream:** auth-tenancy | **Effort:** S
- **Why:** grantRefusal + a 19-test spec confirmed live; already the resolved CLAIMS row ADR-0147-INVITE-ROLE-CEILING. Three code/doc comments citing the bare id will dangle.
- **Verified today:** grantRefusal exists in role-grant.ts; invite-role-ceiling.spec.ts exists; CLAIMS row ADR-0147-INVITE-ROLE-CEILING status is resolved.
- **Duplicates checked:** Tracked live by CLAIMS row ADR-0147-INVITE-ROLE-CEILING (resolved) -- reuse, no new row.
- **Citations to rewrite:**
  - .planning/decisions/0147-the-pages-endpoints-answer-only-for-the-callers-house-and-person.md:142,144
  - apps/api-gateway/src/auth/auth.service.ts:1109 (comment cites 44.1h)
  - apps/api-gateway/src/auth/role-grant.ts:13 (comment cites 44.1h)
  - Citation sweep (2026-09-19, git grep in wt-retire-debt@9c6bdc0be): .planning/decisions/0162-managers-grant-manager-or-staff-on-both-doors.md:24; .planning/decisions/0162-managers-grant-manager-or-staff-on-both-doors.md:7; .planning/decisions/CLAIMS.jsonl:351; supabase/migrations/20260918153000_a_setup_era_manager_holds_their_house_by_a_row.sql:5 -- rewrite to point at this item's home once the register is deleted.

### 184. `44.1j` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** ### 44.1 defects -- '44.1j -- Leaving or being removed leaves the users row pointing at the house' (line 376)


- **Workstream:** auth-tenancy | **Effort:** S
- **Why:** Fix confirmed live (scoped clearUsersRowHouse + dedicated spec). No open CLAIMS/OD/ADR-open-item references it as unresolved. 9 code/ADR comments cite the bare id and will dangle -- recommend a CLAIMS row for a durable anchor if the executor wants one, otherwise drop the id references.
- **Verified today:** clearUsersRowHouse exists in auth.service.ts and members.service.ts; removal-only-that-house.spec.ts exists.
- **Duplicates checked:** No dedicated CLAIMS row by this exact id, but the fix is live-verified and cross-cited from ADR 0162 as closed.
- **Citations to rewrite:**
  - .planning/decisions/0162-managers-grant-manager-or-staff-on-both-doors.md:125,294,353
  - apps/api-gateway/src/auth/auth.service.ts:2591
  - apps/api-gateway/src/restaurants/removal-only-that-house.spec.ts:17,189,222
  - apps/api-gateway/src/restaurants/members.service.ts:404
  - apps/api-gateway/src/team/team.service.ts:456,548
  - Citation sweep (2026-09-19, git grep in wt-retire-debt@9c6bdc0be): .planning/decisions/0162-managers-grant-manager-or-staff-on-both-doors.md:363; .planning/decisions/CLAIMS.jsonl:358; apps/api-gateway/src/team/team.service.ts:548 -- rewrite to point at this item's home once the register is deleted.

### 185. `44.1p` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** ### 44.1 defects -- '44.1p -- A role change in one house rewrote the person's role everywhere' (line 547)


- **Workstream:** auth-tenancy | **Effort:** S
- **Why:** Already the resolved CLAIMS row ADR-0162-ROLE-CHANGE-THIS-HOUSE-ONLY; safe drop as duplicate. Numerous comments cite the bare id and need the reference removed or repointed.
- **Verified today:** CLAIMS row ADR-0162-ROLE-CHANGE-THIS-HOUSE-ONLY is resolved; updateMemberRole confirmed house-scoped in members.service.ts.
- **Duplicates checked:** Tracked live by CLAIMS row ADR-0162-ROLE-CHANGE-THIS-HOUSE-ONLY (resolved) -- reuse, no new row.
- **Citations to rewrite:**
  - .planning/decisions/0147-the-pages-endpoints-answer-only-for-the-callers-house-and-person.md:167
  - .planning/decisions/0162-managers-grant-manager-or-staff-on-both-doors.md:137,233,239,251,451,454
  - apps/api-gateway/src/auth/role-in-house.spec.ts:22
  - apps/api-gateway/src/restaurants/members.service.ts:168
  - apps/api-gateway/src/restaurants/members.service.spec.ts:553
  - Citation sweep (2026-09-19, git grep in wt-retire-debt@9c6bdc0be): .planning/decisions/CLAIMS.jsonl:354; .planning/decisions/CLAIMS.jsonl:357 -- rewrite to point at this item's home once the register is deleted.

### 186. `44.1q` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** ### 44.1 defects -- '44.1q -- A role changed in a house the users row does not name never reaches the guard' (line 591)


- **Workstream:** auth-tenancy | **Effort:** S
- **Why:** Already the resolved CLAIMS row ADR-0162-ROLE-IN-TOKEN-HOUSE; safe drop. Many comments across auth/ cite the bare id and will dangle.
- **Verified today:** CLAIMS row ADR-0162-ROLE-IN-TOKEN-HOUSE is resolved; roleInHouse confirmed in house-role.ts.
- **Duplicates checked:** Tracked live by CLAIMS row ADR-0162-ROLE-IN-TOKEN-HOUSE (resolved) -- reuse, no new row.
- **Citations to rewrite:**
  - .planning/decisions/0147-the-pages-endpoints-answer-only-for-the-callers-house-and-person.md:167,168
  - .planning/decisions/0162-managers-grant-manager-or-staff-on-both-doors.md:140,273,349,360,364,456
  - apps/api-gateway/src/auth/auth.controller.ts:114
  - apps/api-gateway/src/auth/role-in-house.spec.ts:25,111
  - apps/api-gateway/src/auth/auth.service.ts:683
  - apps/api-gateway/src/auth/house-role.ts:12
  - apps/api-gateway/src/auth/strategies/jwt.strategy.ts:58
  - Citation sweep (2026-09-19, git grep in wt-retire-debt@9c6bdc0be): .planning/decisions/0162-managers-grant-manager-or-staff-on-both-doors.md:7; .planning/decisions/CLAIMS.jsonl:354; .planning/decisions/CLAIMS.jsonl:356; .planning/decisions/CLAIMS.jsonl:357 -- rewrite to point at this item's home once the register is deleted.

### 187. `44.2a` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** ### 44.2 Hollow features -- 'Five empty agents silently counted as live'


- **Workstream:** ci-tooling | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** grep -rn IS_STUB services/agent-orchestrator/agents/*.py -> all 5 named agents still True; orchestrator.py:258 refuses to start any so marked.
- **Duplicates checked:** none found
- **Citations to rewrite:**
  - .planning/archive/ROADMAP-pre-P2-20260825.md:715 (archived, no live edit needed)
  - Citation sweep (2026-09-19, git grep in wt-retire-debt@9c6bdc0be): .planning/archive/STATE-pre-P2-20260825.md:29 -- rewrite to point at this item's home once the register is deleted.

### 188. `44.2c` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** ### 44.2 Hollow features -- 'Deploy check reported a correct no-op deploy as a failure'


- **Workstream:** ci-tooling | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** scripts/resolve_watched_commit.py exists with the --first-parent fix documented at lines 33,92,103.
- **Duplicates checked:** none found

### 189. `44.2z` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** ### 44.2 Hollow features -- 'Retired Gemini model ids across the orchestrator'


- **Workstream:** ci-tooling | **Effort:** S
- **Why:** OD-57 already records this as swept/closed with the exact figure, re-confirmed live today. Pure duplicate, safe drop.
- **Verified today:** grep -rn gemini-pro services/agent-orchestrator -> 3 hits, all inert (2 retirement comments, 1 historical rate-table entry) -- matches OD-57's closed row exactly.
- **Duplicates checked:** Already closed and recorded under OD-57 in OPEN-DECISIONS.md (resolved/swept) -- this register row is the stale duplicate copy.

### 190. `44.3a` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** ### 44.3 Schema truth -- '13 ghost tables existed in production but no migration'


- **Workstream:** ci-tooling | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** supabase/SCHEMA_DRIFT.md is headed 'RESOLVED 2026-08-05 by a production baseline' with a more precise, already-measured figure (27 ghost tables) superseding the register's guessed 13.
- **Duplicates checked:** supabase/SCHEMA_DRIFT.md already carries the authoritative, more precise resolution -- that file is the durable record, not this register row.
- **Citations to rewrite:**
  - .planning/archive/ROADMAP-pre-P2-20260825.md:719 (archived, no live edit needed)
  - Citation sweep (2026-09-19, git grep in wt-retire-debt@9c6bdc0be): supabase/migrations_archive/20260731164610_capture_ghost_tables.sql:6 -- rewrite to point at this item's home once the register is deleted.

### 191. `44.3c` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** ### 44.3 Schema truth -- 'pos_webhook_logs / scheduled_reminders schema gaps'


- **Workstream:** ci-tooling | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** grep -rln 'CREATE TABLE.*pos_webhook_logs' and '...scheduled_reminders' supabase/migrations/ -> no output for either; neither table exists.
- **Duplicates checked:** none found
- **Citations to rewrite:**
  - .planning/archive/ROADMAP-pre-P2-20260825.md:721 (archived, no live edit needed)

### 192. `44.4` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** ### 44.4 Verification and tracking reconciliation (v2.0 phases 18-36)


- **Workstream:** docs-records | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** PROJECT.md confirms 'current milestone set to P3 (ADR 0029); P2 closed' -- phases 18-36 verification bookkeeping is multiple milestones stale.
- **Duplicates checked:** none found
- **Citations to rewrite:**
  - .planning/archive/ROADMAP-pre-P2-20260825.md:264,722 (archived, no live edit needed)

### 193. `44.5-correction-note` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** '## 44.5 correction -- InvoiceScannerModal was orphaned after all' (line 1338)


- **Workstream:** docs-records | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** find -iname InvoiceScannerModal* (excl. node_modules) -> no output, confirmed deleted, same check as 44.1e-invoicescanner.
- **Duplicates checked:** Same underlying fact as 44.1e-invoicescanner (this batch) -- a correction note about that same defect, now moot since both the defect and the file are gone.

### 194. `44.6b` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** ### 44.6 Auth-context placeholders -- 'Persist the override audit trail'


- **Workstream:** receiving-documents | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** App.tsx:318 -- /inventory-legacy redirects to /inventory (legacy page and its modal fully retired per ADR 0019 §B); the live /inventory page owns manual-adjust audit trail.
- **Duplicates checked:** none found
- **Citations to rewrite:**
  - Citation sweep (2026-09-19, git grep in wt-retire-debt@9c6bdc0be): .planning/06-pages/dashboard.md:376; .planning/06-pages/profile.md:1524 -- rewrite to point at this item's home once the register is deleted.

### 195. `api-spend-restaurant-id` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** '## Data integrity -- api_spend.restaurant_id holds wine UUIDs (historical rows) -- added 2026-08-24' (line 1385)


- **Workstream:** analytics-models | **Effort:** S
- **Why:** Re-ran the live production SELECT myself (Supabase MCP, read-only) rather than trusting the recorded evidence -- confirmed exact match. Safe drop.
- **Verified today:** Live SELECT via Supabase MCP (project exzueerziesmczwlhomd, read-only) today: 0 of 183 rows hold a wine UUID in restaurant_id, 165/183 are NULL -- matches the register's cited figures exactly.
- **Duplicates checked:** No other file discusses this specific historical-corruption defect (other api_spend.restaurant_id mentions are unrelated general pricing-attribution discussion).

### 196. `atlas-backbone-F2` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** n/a -- not a v3.0-TECH-DEBT.md row; underlying fact recorded in .planning/04-specs/ECOSYSTEM-E0-MEASUREMENTS.md:236-238


- **Workstream:** ci-tooling | **Effort:** S
- **Why:** ContactsModule confirmed never imported and referenced nowhere outside its own directory. Not a row in any register/ADR to delete (external finding source); the accurate fact already lives in ECOSYSTEM-E0-MEASUREMENTS.md and needs no edit -- safe drop with no doc mutation required.
- **Verified today:** grep Contacts app.module.ts -> no match; grep -rl ContactsModule apps/api-gateway/src -> only its own file.
- **Duplicates checked:** Same underlying dead-code fact as modules-F7 (this batch) -- two findings filed against one defect.

### 197. `atlas-backbone-F3` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** n/a -- not a v3.0-TECH-DEBT.md row; underlying fact recorded in .planning/04-specs/ECOSYSTEM-E0-MEASUREMENTS.md:237


- **Workstream:** ci-tooling | **Effort:** S
- **Why:** File still exists, still zero references anywhere -- confirmed dead exactly as stated. Not a register row to delete; the accurate fact already lives in ECOSYSTEM-E0-MEASUREMENTS.md. Safe drop with no doc mutation required.
- **Verified today:** find -iname advanced_features.ts -> still present at services/api-gateway/routes/; grep -rn advanced_features (excl. node_modules/.planning) -> no references anywhere.
- **Duplicates checked:** none found

### 198. `canonical-deposit-readback-fixed` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** '## Canonical document -- second render: deposit read-back and mapper drift -- FIXED -- added 2026-09-05' (line 3391)


- **Workstream:** receiving-documents | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** linesNetTotal() defined at from-parsed-document.ts:318, used at :611; from-document-rows.ts (the shared mapping path) exists.
- **Duplicates checked:** Supersedes/resolves canonical-second-render-2-findings (this batch), which self-corrects and points to this same fix.

### 199. `canonical-first-render-9-findings` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** '## Canonical document -- the first render: nine findings -- added 2026-09-04' (line 3239), fixes at 'What each fix was' (line 3306, PR #304)


- **Workstream:** receiving-documents | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** VerdictBlock.tsx: hasComparisonSource defined (line 34, used 68/173); 'Not compared -- no order or door count to compare against.' present at line 211 -- both spot-checked fixes confirmed.
- **Duplicates checked:** none found

### 200. `canonical-second-render-2-findings` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** '## Canonical document -- the second render (after PR #304): two findings -- added 2026-09-05' (line 3354), self-corrected and superseded by the FIXED entry at line 3391


- **Workstream:** receiving-documents | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** Entry self-corrects in its own text ('is WRONG... The read-back was never broken') immediately before the FIXED section -- self-superseding, no separate code check applicable.
- **Duplicates checked:** Fully superseded by canonical-deposit-readback-fixed (this batch), the FIXED entry immediately below it in the same document.

### 201. `canonical-slice3-stop1-finding2-kasa-koli` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** '## Canonical document -- slice 3 stop 1 (corrections): three findings -- added 2026-09-05' (line 3912)


- **Workstream:** receiving-documents | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** 8 canonical/document spec files reference kasa/koli unit-word terms, consistent with the described test fix being in the live suite.
- **Duplicates checked:** none found

### 202. `canonical-slice3-stop1-finding3-revision-number` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** '## Canonical document -- slice 3 stop 1: three findings -- added 2026-09-05' (line 3912)


- **Workstream:** receiving-documents | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** canonical-document.service.ts:663 defines nextRevision(); document-correction.service.ts:355 is the single caller-through-service pattern the fix describes.
- **Duplicates checked:** none found

### 203. `canonical-slice3-stop2-findings-bundle` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** '## Canonical document -- slice 3 stop 2 (deliveries, proposals, the gates): six findings -- added 2026-09-05' (line 3965)


- **Workstream:** receiving-documents | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** Spot-checked 2 of 6 bundled fixes: qtyProposedBottles field (delivery.service.ts:465,516; deliveries.dto.ts:278) and allowlisted proposed_by write (delivery.service.ts:180,524), both confirmed live.
- **Duplicates checked:** none found

### 204. `ci-lint-typescript` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** '## CI -- Lint TypeScript is red for two errors, not one; turbo hides the second -- added 2026-08-24' (line 1398)


- **Workstream:** ci-tooling | **Effort:** S
- **Why:** Both named fixes confirmed present. Register itself flags it did not re-run the full lint suite, but the two specific named errors are independently confirmed fixed. Safe drop.
- **Verified today:** devAuthBypass eslint-disable confirmed removed from no-raw-gateway-fetch.test.ts:37; DIACRITICS regex confirmed relocated to wine-signature.ts (defined :74, used :139).
- **Duplicates checked:** none found

### 205. `ci-migration-version-guard` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** '## CI -- Two parallel PRs took one migration version -- guarded -- added 2026-09-05' (line 3461)


- **Workstream:** ci-tooling | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** scripts/check_migration_versions_unique.py exists; wired into ci.yml at two steps (--self-test and the real run, lines 350/355).
- **Duplicates checked:** This guard is exactly the mechanism CLAUDE.md §5b's own 'never reuse a migration version' rule points at -- no separate ADR/OD needed.

### 206. `codeql-two-highs` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** '## CodeQL -- two highs the extraction door made real -- FIXED 2026-09-04' (line 3187)


- **Workstream:** ci-tooling | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** stripJsonFence confirmed regex-free (startsWith/slice/trim only, lines 151-156); Object.create(null)/PRINTED_KEYS allowlist confirmed at lines 614/553.
- **Duplicates checked:** none found

### 207. `deferred-gmail-oauth2-dropped` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** '## Deferred by design (decided, not forgotten)' table (line 1311) -- row 'Phase 23 Gmail OAuth2 -- DROPPED 2026-07-28'


- **Workstream:** docs-records | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** Row states the decision as final ('DROPPED 2026-07-28', decided in this document) with no further action implied -- a terminal decision record, not a defect.
- **Duplicates checked:** None -- the other rows in the same table (separate items in this batch) are untouched by dropping this one row.

### 208. `dev-tooling-conflict-marker-guard` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** '## Dev tooling -- a conflict-marker guard that only read the planning corpus -- FIXED 2026-09-05' (line 3841)


- **Workstream:** ci-tooling | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** check_no_conflict_markers.py confirmed to scan the whole repo via git ls-files (lines 228,239,242) and a repo-wide scan_tracked function (line 275), not just .planning/.
- **Duplicates checked:** none found

### 209. `google-signin-self-provision` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** '## Security -- Google sign-in self-provisioned a manager of a real tenant -- CLOSED 2026-09-01' (line 1488)


- **Workstream:** auth-tenancy | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** findOrCreateOAuthUser confirmed to have no insert/create branch (refusal-only); identity-first-signin.spec.ts exists.
- **Duplicates checked:** The fix is now the current implementation cited approvingly by ADR 0139 and auth-onboarding.md -- live, still-accurate references, not dangling citations of this row.

### 210. `item-activity-blind-to-deliveries` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** '## Vendor lens finding 6 (V6) -- the item activity door was blind to delivery bookings -- CLOSED -- 2026-09-06' (line 4366), restated at line 4419


- **Workstream:** receiving-documents | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** CLAIMS row 'V6' is resolved; totalIn28d field confirmed live at inventory.service.ts:778.
- **Duplicates checked:** Duplicate of vendor-lens-v6-item-activity-note (this batch) -- the register states this same V6 fix under two ids.

### 211. `library-identity-item1-repair` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** '## Library identity -- a generic name bound one venue's stock to another's wine -- FIXED' §'Still open, filed here rather than fixed', item 1 (line ~3529-3557)


- **Workstream:** wine-library | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** Text re-read: 'CLOSED 2026-09-05 -- founder-authorised, measured, dry-run... 77 rows repaired, 0 deleted, 0 rows of any other tenant altered' with named artifacts and post-repair counts all 0/0/0.
- **Duplicates checked:** none found
- **Citations to rewrite:**
  - Citation sweep (2026-09-19, git grep in wt-retire-debt@9c6bdc0be): supabase/migrations/20260906023000_the_library_may_say_it_does_not_know.sql:77 -- rewrite to point at this item's home once the register is deleted.

### 212. `library-identity-item2-shared-path-error` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** '## Library identity -- FIXED' §'Still open', item 2 (line ~3559-3562)


- **Workstream:** wine-library | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** wines.service.ts:256,304 confirmed using wineSignatureHashOrNull; wine-signature.ts:157 documents the NULL-writing convention matching the #318 fix.
- **Duplicates checked:** none found
- **Citations to rewrite:**
  - Citation sweep (2026-09-19, git grep in wt-retire-debt@9c6bdc0be): apps/api-gateway/src/wines/a-generic-name-stays-the-venues-own-wine.spec.ts:273 -- rewrite to point at this item's home once the register is deleted.

### 213. `library-identity-item4-widened-hole` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** '## Library identity -- FIXED' §'Still open', item 4 (line ~3563-3591)


- **Workstream:** wine-library | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** Text re-read: 'Closed by 20260906010000_a_generic_name_stays_the_venues_own_wine.sql; re-measured on the merged tree: 0 candidates.' Migration confirmed present.
- **Duplicates checked:** Same closing migration as library-identity-main-fix (this batch).

### 214. `library-identity-main-fix` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** '## Library identity -- a generic name bound one venue's stock to another's wine -- FIXED -- added 2026-09-05' (line 3496)


- **Workstream:** wine-library | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** supabase/migrations/20260906010000_a_generic_name_stays_the_venues_own_wine.sql confirmed present, naming wine_identity_is_specific as claimed.
- **Duplicates checked:** Parent fix for library-identity-item1-repair, -item2-shared-path-error and -item4-widened-hole (all this batch).

### 215. `modules-F7` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** n/a -- not a v3.0-TECH-DEBT.md row; underlying fact recorded in .planning/04-specs/ECOSYSTEM-E0-MEASUREMENTS.md:236


- **Workstream:** ci-tooling | **Effort:** S
- **Why:** Re-confirmed live: ContactsModule absent from app.module.ts entirely. Not a register/ADR row to delete (external finding source); the accurate fact is already in ECOSYSTEM-E0-MEASUREMENTS.md. Safe drop with no doc mutation required.
- **Verified today:** grep Contacts app.module.ts -> no match, 0 hits -- confirms the verifier correction that ContactsModule is unregistered, not merely uncalled.
- **Duplicates checked:** Same underlying defect as atlas-backbone-F2 (this batch) -- both findings describe the same unreachable, unregistered ContactsModule.

### 216. `orders-wire-guard-blindspot-status-type` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** 'The orders wire...' §'What the guard cannot see' (line 3810)


- **Workstream:** procurement-orders | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** OrderWireStatus type confirmed defined at types.ts:259, used as Order.status's type at :310.
- **Duplicates checked:** none found

### 217. `orders-wire-guard-blindspot-widening-cast` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** 'The orders wire...' §'What the guard cannot see' (line 3810)


- **Workstream:** procurement-orders | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** grep -c 'as Order' useOrdersNextData.ts -> 0 -- the specific widening cast this item cited is confirmed gone.
- **Duplicates checked:** none found

### 218. `orders-wire-item1-vendor-name` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** '## The orders wire -- four things...' §'1. No vendor name on any order route -- CLOSED 2026-09-05' (line 3608)


- **Workstream:** procurement-orders | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** providerName confirmed wired across 5 gateway files; apps/web/src/lib/mudavym/vendor.ts (central mapping) confirmed present.
- **Duplicates checked:** none found

### 219. `orders-wire-item2-recurrence` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** '## The orders wire...' §'2. No recurrence -- CLOSED 2026-09-05' (line 3660)


- **Workstream:** procurement-orders | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** 20260905235800_an_order_that_repeats_says_so_on_itself.sql confirmed present (the recurrence migration) for the rebuilt page's side.
- **Duplicates checked:** The legacy-page half of this item is separately tracked as orders-wire-item2b-legacy-not-migrated (this batch).
- **Citations to rewrite:**
  - Citation sweep (2026-09-19, git grep in wt-retire-debt@9c6bdc0be): .planning/decisions/0125-an-order-changes-state-through-a-sealed-transition.md:568; apps/api-gateway/src/procurement/dto/procurement.dto.ts:1077; apps/api-gateway/src/procurement/order-recurrence.service.spec.ts:19; apps/api-gateway/src/procurement/order-recurrence.ts:12; apps/web/src/pages/orders/next/Recurrence.test.tsx:18; apps/web/src/pages/orders/next/recurrence.ts:11; apps/web/src/services/api/types.ts:367 -- rewrite to point at this item's home once the register is deleted.

### 220. `orders-wire-item2b-legacy-not-migrated` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** '## The orders wire...' §'2....CLOSED 2026-09-05', paragraph 'The legacy desk half of this item is NOT closed' (~line 3705-3710)


- **Workstream:** procurement-orders | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** mapApiOrderToUi (Orders.tsx:93) confirmed to still never set recurrence; ADR 0149 (locked) confirms legacy pages are deleted wholesale at cutover, not individually patched.
- **Duplicates checked:** Legacy-desk remainder of orders-wire-item2-recurrence (this batch).

### 221. `orders-wire-item3-quantity-received` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** '## The orders wire...' §'3. quantity_received is a column the DTO does not map -- CLOSED 2026-09-05' (line 3711)


- **Workstream:** procurement-orders | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** apps/api-gateway/src/procurement/quantity-received-unit.ts confirmed present (the pure reader named in the fix).
- **Duplicates checked:** none found

### 222. `slice4-live-redrive-closed` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** '## Slice 4 live re-drive: three small read-shape defects -- CLOSED by fix/slice-4-read-shapes -- 2026-09-11' (line 4461)


- **Workstream:** receiving-documents | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** Doc's own follow-up correction confirms the 'someone here' fix with remembered-shelf-names.spec.ts (4 tests) as the named fix, still described as closed after PR #350 merged.
- **Duplicates checked:** none found

### 223. `suggested-ordering-meta` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** '## Suggested ordering' (line 1325)


- **Workstream:** docs-records | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** Section confirmed to be pure meta-advice about the reading order of the register itself, not a defect or decision -- has no independent existence once the register is gone.
- **Duplicates checked:** none found

### 224. `vendor-lens-accept-as-billed-cluster` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** '## Vendor lens finding 5 (V5)...CLOSED -- 2026-09-06' (line 4077) and '## Vendor lens findings 1,3,4 -- CLOSED' (line 4128), plus duplicate restatements at slice3 stop3 (line 4186)


- **Workstream:** receiving-documents | **Effort:** S
- **Why:** All 3 underlying CLAIMS rows verified resolved. The register merely repeats these under 5 different ids -- safe drop for the whole cluster.
- **Verified today:** 3 underlying CLAIMS rows (ADR-0103-A11-ACCEPTANCE-ANSWERS-A-REAL-DIFFERENCE, TD-2026-09-06-DOOR-COUNT-RENDERS-AS-BILLED, TD-2026-09-06-DOOR-COUNT-DUPLICATE-CONSTRAINT) all confirmed resolved today.
- **Duplicates checked:** Collapses 5 register ids (vendor-lens-v5-accept-as-billed, vendor-lens-1-3-4-closed, vendor-lens-slice3stop3-finding1/3/4-dup) -- all restatements of the same 3 already-resolved CLAIMS rows.

### 225. `vendor-lens-d15-vendor-resolution` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** Cross-referenced from ADR 0104's D15 rule (not a dedicated v3.0-TECH-DEBT.md heading)


- **Workstream:** receiving-documents | **Effort:** S
- **Why:** D15 rule confirmed present; re-ran the production SELECT myself (Supabase MCP, read-only) and confirmed 0 rows today, exactly as the register states -- closed but unexercised, not a defect.
- **Verified today:** D15 rule confirmed defined at ADR 0104:197 (exact tax-identity match); live SELECT via Supabase MCP today: document_vendor_resolutions still 0 rows, matching 'migrated but never yet matched a real document'.
- **Duplicates checked:** Overlaps in naming only with vendor-lens-d15-vendor-resolution-dup-note (this batch, itself a duplicate of the door-count-billed fix) -- no actual duplication between the two.

### 226. `vendor-lens-d15-vendor-resolution-dup-note` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** '## Vendor lens through the delivery doors -- slice 3 stop 3' §'3. renders OUR door count under Billed' (line 4331), duplicate of finding 3 in the CLOSED section (line 4164)


- **Workstream:** receiving-documents | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** CLAIMS row TD-2026-09-06-DOOR-COUNT-RENDERS-AS-BILLED confirmed resolved (same check as vendor-lens-accept-as-billed-cluster).
- **Duplicates checked:** Explicit duplicate of the door-count-renders-as-Billed fix, part of vendor-lens-accept-as-billed-cluster (this batch) -- its own title says so.

### 227. `vendor-lens-linkitem-door` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** '## Vendor lens findings 1,3,4 -- CLOSED' §'2. inventory_lots.cost_state...' closing paragraph ('Named, not fixed... CLOSED 2026-09-11 by ADR 0104 slice 4')


- **Workstream:** receiving-documents | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** @Post(':id/lines/:lineId/link-item') route confirmed present and live at documents.controller.ts:1372.
- **Duplicates checked:** none found

### 228. `vendor-lens-slice3stop3-finding2-cost-state` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** '## Vendor lens through the delivery doors -- slice 3 stop 3' §'2. CLOSED 2026-09-06 -- inventory_lots.cost_state was DEFAULT final NOT NULL with no writer' (line 4215)


- **Workstream:** receiving-documents | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** 20260906233000_stock_at_the_door_cost_at_verified.sql confirmed to set default 'provisional' with the two named writers (apply_stock_movement, finalise_delivery_cost).
- **Duplicates checked:** Same underlying fix as the 'STILL OPEN' mention earlier in the same document (later superseded/closed by this entry).
- **Citations to rewrite:**
  - Citation sweep (2026-09-19, git grep in wt-retire-debt@9c6bdc0be): supabase/migrations/20260906233000_stock_at_the_door_cost_at_verified.sql:5 -- rewrite to point at this item's home once the register is deleted.

### 229. `vendor-lens-slice3stop3-finding4-dup-note` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** '## Vendor lens through the delivery doors -- slice 3 stop 3' §'4. A repeated door count fails with a raw Postgres constraint name' (line 4345), duplicate of finding 4 in the CLOSED section (line 4175)


- **Workstream:** receiving-documents | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** Duplicate-note item by its own title; underlying fix confirmed resolved as part of vendor-lens-accept-as-billed-cluster's check (TD-2026-09-06-DOOR-COUNT-DUPLICATE-CONSTRAINT).
- **Duplicates checked:** Explicit duplicate of the raw-constraint-name-leaked fix inside vendor-lens-accept-as-billed-cluster (this batch) -- its own title says so.

### 230. `vendor-lens-v6-item-activity-note` -- REMOVE / no successor row (removed, or re-verified not-a-defect)
**Section:** '## The item activity door is blind to delivery bookings -- CLOSED by PR #336 (see the closed section below) -- 2026-09-06' (line 4419)


- **Workstream:** receiving-documents | **Effort:** S
- **Why:** Recommendation REMOVE, state FIXED/OBSOLETE in export; re-verified live on wt-review; no CLAIMS/OD/ADR open item depends on it.
- **Verified today:** Same live check as item-activity-blind-to-deliveries (this batch): totalIn28d confirmed present at inventory.service.ts:778.
- **Duplicates checked:** Explicit duplicate of item-activity-blind-to-deliveries (this batch) -- its own title points at the surviving entry.


---
## Retirement record

- **ADR:** 0166-the-defect-register-retires-and-its-items-live-by-kind (Locked (the split-by-kind decision) -- Execution against the checklist is pending, per the ADR's own Status line)
- **Location:** docs/retire-tech-debt @ 9c6bdc0be6a70154314202ff5b82da9cb64b6bef, in /Users/aldemirkonuk/Projects/wt-retire-debt (not yet merged to main)
- r4-placement.json issue 5 ('the plan has no retirement record'): NO NEW ADR is created by this plan or its execution -- ADR 0166 already exists, is already Locked on the split-by-kind decision, and IS this plan's retirement record. This plan's 230-item placement is exactly the 'placement pass' ADR 0166's own Consequences section names as still owed ('Where each item finally lives is set by the placement pass that the executing PR carries, not by this dry run's keyword routing').
- **Tombstone:** CLAUDE.md §4 / ADR 0032 require a retirement to list the file in the retiring ADR with its recovery commit. ADR 0166 cannot carry that commit hash yet because v3.0-TECH-DEBT.md has not been deleted (this plan is not executed). At actual execution time, the tombstone (filename + the deletion commit's sha) must be appended to ADR 0166 as a dated bracket addendum, matching ADR 0166's own existing convention of dated `[CORRECTED ...]` brackets rather than a silent rewrite (CLAUDE.md §5b).
- **CLAUDE.md edits required:** CLAUDE.md:124 and :130 (see citation_rewrites.md for exact before/after text) -- both gate-owned (ADR 0090 _GATE_OWNED_PATHS, confirmed live at scripts/pr_audit_gate.py:485,493,499,506), so the executing PR force-escalates to BLOCK under touches_own_gate and needs the founder's direct authorization in chat before merge, exactly as ADR 0166 itself already states.

---
## Workstreams (item membership unchanged from the r4 pass; a few first_steps below now reference the corrected verify/id)

### auth-tenancy
- **Items:** 44.1r, 44.1s, 44.1t, 44.1n, 44.1i, 44.1k, 44.1l, 44.1m, 44.1o, provider-intelligence-12-cross-tenant, 2717.F10
- **Effort:** M (11 items: 8 S, 3 M; two of them are decisions ADR 0162 has already made that just need building)
- **First step:** Build ADR 0162's Membership-only answer. In apps/api-gateway/src/auth/auth.service.ts, make refreshAccessToken re-check user_restaurant_access before re-minting scopedRestaurantId (line 399), and delete switchRestaurant's org-level fallback (line 474). The ADR-0162-MEMBERSHIP-ONLY-SESSIONS verify should then flip.

### security-money
- **Items:** 2666.A6, 2717.F6, 2717.F7, 2717.F8, 2825.A3, arm-b-grant-option-credit-bug, increment-trust-counter-definer-rpc-live, models-F2
- **Effort:** M (8 items: 6 S, 2 M)
- **First step:** Change InventoryCommandPage.tsx's six (wac ?? price ?? 0) * stock aggregates so an unknown cost stays unknown instead of counting as $0, together with the FIXED DEBT-2825.A3 verify (now reads the latest inventory_analytics definition across ALL migrations, not just the baseline).

### procurement-orders
- **Items:** 2159, 2478.1, 2478.2, 44.3b, orders-wire-item4-createorderrequest-mismatch, slice4-uuid-guard-gap, vendor-lens-memory-no-reconciler
- **Effort:** M (7 items: 3 S, 4 M; 2159 needs your unit choice when the fix starts)
- **First step:** Add requireUuid(id) to documents.controller.ts's detail, match and verify handlers (the ADR-0104-ID-ONLY-ROUTES-UUID-GUARD verify flips, mutation-tested). Then ask the founder the 2159 unit question (bottles vs the order's unit) before touching quantity_received.

### receiving-documents
- **Items:** expired-session-drops-door-receipts, 1994, offline-storage-swallow, 3144, 3165, canonical-amount-due-tautology, canonical-slice3-stop1-finding1-mock-drift, canonical-slice3-stop2-d9-deputy-not-wired, canonical-slice3-stop2-tr-vendor-terms-unseeded, retire-doorreceipt-markdelivered
- **Effort:** M (10 items: 8 S, 2 M)
- **First step:** In apps/web/src/lib/doorOutbox.ts:415 (and the retry sweep), stop treating 401/403 as a permanent 4xx, so a receipt logged while the session was expired is kept and retried after sign-in. Then apply the same fix to spotCountOutbox's drop witness.

### analytics-models
- **Items:** models-F1, no-eval-harness-9-llm-call-sites, 1682.4, seasonality-zero-fill, models-missed-M2, 44.2b
- **Effort:** L (6 items; the eval harness alone is L)
- **First step:** Swap ux-optimizer.service.ts's dated claude-haiku-4-5-20251001 fallback for the claude-haiku-4-5 alias, as ADR 0120 already requires. 44.2b is now a RESOLVED CLAIMS row (DEBT-REPORTINGAGENT-STOCK-EVENTS-INTENTIONAL) pinning test_event_topology.py:76-80 -- nothing to build, just keep it from regressing.

### wine-library
- **Items:** library-identity-item3-check-constraint-missing, orders-wire-item5-menu-import-unclassified, inventory-add-remove-item7, models-F4, modules-F2, 3007.5
- **Effort:** L (6 items; models-F4's pgvector search is L; 3007.5 waits for PR #394 -- FOUNDER QUESTION if #394's scope shifts, see report)
- **First step:** Make wine-submissions.service.ts processPendingSubmissions write provisional_for_restaurant_id, then add ADR 0130's wine_identity_is_specific CHECK in a new migration numbered past everything on main. modules-F2 is now a doc-correction (direct edit to wine-library-sommelier.md's routes array), not a CLAIMS row.

### ci-tooling
- **Items:** 44.2d, atlas-backbone-F1, deferred-ci-tooling-debt, seal-migrations-character-class, 1672, 2433.1, 2433.2, 2433.4, atlas-backbone-F9, atlas-backbone-missed-M2
- **Effort:** M (9 items now, not 10: atlas-backbone-missed-M2 DROPPED, not built -- see FIXLOG)
- **First step:** deferred-ci-tooling-debt is REWRITTEN: it is now DEBT-CI-PYTHON-LINT-SCOPE-GAP (lint-python's scope, not a nonexistent missing-eslint gap). Then add the is-ancestor check to scripts/check_deployed_sha.py (flips DEBT-44.2d).

### web-quality
- **Items:** 2866.D3, 1642, 1662, 1653, 1602, atlas-backbone-F8, atlas-surfaces-F1, atlas-surfaces-F3, atlas-surfaces-F9
- **Effort:** L (9 items; 1602, bringing Prettier into apps/web, is L)
- **First step:** Fix Notifications.tsx's stats useMemo to count dedupedNotifications so Unread matches the visible rows -- DEBT-2866.D3's verify is REWRITTEN (bracket-matches the useMemo call instead of indexing a literal deps-array string) and will now correctly flip.

### docs-records
- **Items:** 44.5, modules-F1, modules-F9, modules-missed-M1, modules-missed-M3, 2866, 44.1e-collision-meta, 2433, 2478, 2499, 2717
- **Effort:** M (all 5 doc-correction items are now direct edits, not CLAIMS rows -- see FIXLOG; the register-retirement pass points at EXISTING ADR 0166, no new ADR)
- **First step:** The retiring ADR is 0166 (already Locked, docs/retire-tech-debt@9c6bdc0be) -- do not write a new one. Rewrite CLAUDE.md:124,130, PROJECT.md:47 and every citation in citation_rewrites.md; make the 5 doc-correction edits directly (modules-F1/F2/F9/missed-M1/missed-M3, two of which -- missed-M1/M3 -- are already satisfied by PR #394 and need only a merge-order check).
