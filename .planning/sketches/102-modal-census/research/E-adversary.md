# E — Adversary verdicts on the overlay-behaviour research (sketch 102), 2026-09-05

Reviewed against the eight house rules in `adversary-brief.md`. Every pattern in A, B, C and D
gets a verdict below — **KEEP** (ship close to as-described), **ADAPT** (real signal, but it
needs a scoping change, an explicit non-modal label, an OPEN-DECISIONS entry, or a piece the
source product itself doesn't have before it fits Mudavym), or **REJECT** (evidence too thin to
act on, or it collides with a rule with no adaptation that saves it). Rows from B's "receiving
and counting" and "approvals" mini-tables and D's "hospitality unicorns" table are included and
labelled `B-R#` / `B-App#` / `D-H#`. Evidence URLs were re-fetched independently wherever a
verdict leaned on them (§2 lists what broke).

**Tally: 51 KEEP · 40 ADAPT · 5 REJECT** (96 patterns judged).

---

## 1. Verdict table

### File A — Command-first

| # | Pattern | Verdict | Reason | Rule |
|---|---|---|---|---|
| A1 | Peek preview beside list (Linear) | ADAPT | Real value, but per rule 1's own carve-out it must be named an explicit **non-modal** in-place preview — not a lightweight SHEET, which would smuggle in a fourth modal shape | 1 |
| A2 | j/k stepping inside an open record | KEEP | Pure keybinding inside the existing SHEET; no shape change | 1 |
| A3 | Nested, non-firing command sub-menus | KEEP | Fits the POPOVER-as-menu shape; needs its own stated Esc contract (step-back vs. full close) | 1 |
| A4 | Typed arguments inside the command | ADAPT | Cap hard at one genuine one-shot pick — a 3-argument command is a disguised form, which belongs in PANEL/SHEET | 1 |
| A5 | g-chord navigation grammar | KEEP | Orthogonal nav layer, no overlay involved | — |
| A6 | Undo toast replaces a confirm dialog | ADAPT | Verified (Linear's own changelog: "undo almost every operation… including batch operations"), but must be scoped to genuinely reversible, non-money, non-send actions only — never a stand-in for the seal | 2 |
| A7 | Undo send (delayed-commit window) | ADAPT | Duplicate of C14 (Gmail/Superhuman). The queued state during the window must visibly read "about to send," never "sent" | 3 |
| A8 | NL input resolved inline, no date picker | ADAPT | Resolved value must render as a visible, editable chip — a silent misparse is the risk | 3, 4 |
| A9 | Fuzzy command-name matching | KEEP | No conflict; ranking-quality is the only real cost | — |
| A10 | Full keyboard-only triage with auto-advance | ADAPT | Auto-advance must never silently apply a sealed action; needs the same undo safety net as A6, scoped the same way | 2 |
| A11 | OS-level quick-capture overlay | REJECT | Evidence is a tweet; and a web SPA cannot register a true OS-wide hotkey outside its own tab — the "anywhere" claim in the pattern name is the exact thing rule 8 says not to oversell | 8 |
| A12 | Deep-linkable commands (URL triggers an action) | ADAPT | Good idea, real routing cost — but must never let a deep link reproduce an unfinished/AI-proposed state as if it were final | 3 |
| A13 | Scope sigils in one search box (GitHub) | KEEP | Verified directly against GitHub's own Command Palette changelog | 1 |
| A14 | `t`-style single-key fuzzy finder | KEEP | Needs a "not while a text field has focus" guard, same class of bug GitHub itself has fixed | — |
| A15 | Hovercards for a referenced record | KEEP | Explicit non-modal exception under rule 1 (no scrim, no focus trap, dismissed by moving the mouse) — name it as such, don't force it into a 320px POPOVER | 1 |
| A16 | Hover-to-peek page content (Notion) | KEEP | Same as A15; cap the card's own inner mini-menu to open/copy-link, never a form | 1, 2 |
| A17 | Multi-select + bulk action bar | KEEP | Direct match for "bulk gets a plain button." Literal duplicate of B21 — see §3 | 2 |
| A18 | Hover-reveal vs. always-visible bulk checkbox | ADAPT | Genuine open design fork (Linear vs. GitHub convention) — belongs in OPEN-DECISIONS, not defaulted | — |
| A19 | Split button + chevron for template choice | KEEP | Fits POPOVER as a control's own menu | 1 |
| A20 | Resizable file tree beside a diff | KEEP | Page-level split view, not a fourth overlay shape — safe only if built that way | 1 |
| A21 | Permalink-on-demand (freeze state to URL) | KEEP | Real backend cost (needs point-in-time reads) but aligns with ledger-rows-expand-in-place | 6 |
| A22 | Every state gets a shareable URL by default (Vercel) | ADAPT | Verified against Vercel's own docs (branch links vs. commit links, no publish step). Must not make an unapplied AI-proposed state trivially forwardable as if decided | 3 |
| A23 | Command palette scoped to current context | ADAPT | Needs explicit context-ranking rules — a real design decision, not an engineering default | — |
| A24 | Selection-driven side-panel content (Figma) | KEEP | Matches the "panel's content, not its container, does the work" idea already implied by SHEET | 1 |
| A25 | Recent + all commands in one ranked list | KEEP | No conflict; needs per-user, per-page-type state | — |
| A26 | `prefers-reduced-motion` contract on every transition | KEEP | This *is* rule 5, restated as a pattern — a precondition for shipping any of the other 25, not one more option | 5 |

### File B — Ops & finance (main table)

| # | Pattern | Verdict | Reason | Rule |
|---|---|---|---|---|
| B1 | Space-to-expand record modal (Airtable) | KEEP | Already SHEET-shaped; only the keyboard trigger is new | 1 |
| B2 | Sidesheet vs. full-screen, builder's choice | KEEP | Validates the existing two-width SHEET design rather than adding a shape | 1 |
| B3 | Linked-record drill-down capped at 3 levels | ADAPT | Genuine open fork: a SHEET stack needs its own breadcrumb/collapse language ADR 0112 doesn't have. Converges with D2 — see §3 | 1 |
| B4 | In-place revision history tabs (Airtable) | ADAPT | Airtable's own history is record-level, not field-level — Mudavym's provenance bar is stricter; don't scope this as "the same but finer" | 4 |
| B5 | Record-review split-pane triage | ADAPT | The decision affordance is "a button you configured," which bypasses the seal entirely — Mudavym must wire its own wax control into the pane | 2 |
| B6 | Peek → pin → full-page progression (Notion) | ADAPT | Real gap ADR 0112 doesn't cover (promoting an open SHEET to full page in place) but the trigger mechanism is undecided | 1 |
| B7 | Side peek opens a nested side peek (Notion) | REJECT | The file's own flag: no Notion primary-source doc, third-party guides only. Don't cite as settled | 4 |
| B8 | Auto "last edited by" provenance stamp (Notion) | ADAPT | Cheap win, but it's a single rollup, not field-level — don't let it stand in for the real provenance bar | 4 |
| B9 | Payment-detail overlay as a headless component (Stripe) | KEEP | The transferable idea is one explicit `onClose` callback per object, not the component itself | 1 |
| B10 | Refund ceremony: default full, reason required, confirm | ADAPT | Re-fetched live: Stripe's actual flow is "select a reason, click Refund" — a plain click, no hold. Keep "reason required," reject porting the ceremony weight for a real money movement | 2 |
| B11 | Record preview side panel, inline edit, close via X (HubSpot) | ADAPT | Copy the header/quick-actions/timeline layout; reject the X outright | 5 |
| B12 | Highlights-panel quick actions (Salesforce) | KEEP | Good top-of-record convenience; explicitly reject Salesforce's own inline/modal inconsistency, don't import it | 1 |
| B13 | Chevron stage-path visualizer (Salesforce) | KEEP | In-place status strip, compatible with ledger-expand; watch for scope creep into a wizard | 6 |
| B14 | "Why this was flagged" written on the row (Ramp) | KEEP | Direct, strong fit — extends "every figure names its rows" to "every flag names the rule it tripped." Duplicated at B-App3 | 4 |
| B15 | AI accounting-code suggestion, accept/reject (Ramp) | KEEP | Textbook match for "AI proposes, a person applies." Flag the acceptance-rate figure as third-party (LangChain case study), not Ramp's own | 3 |
| B16 | Two-checkpoint approve-then-release, AND/OR chains (Ramp) | KEEP | Verified directly against Ramp's own Bill Pay docs — confirms both the AND/OR logic and the separate release gate. Duplicated at B-App1/B-App2 | 2 |
| B17 | In-place two-column invoice-vs-order compare (Ramp/R365) | KEEP | Closest real match to the founder's ask, and both cited products do it in-place, not in a popup | 6 |
| B18 | Weekly digest + inline flag (Brex) | KEEP | Good complement to `/notifications`; batches interrupt without losing the inline flag. Duplicated at B-App6 | 4 |
| B19 | Any-channel receipt capture, auto-matched (Brex) | ADAPT | Scope to app-only first; multi-channel intake raises the tenant/recipient-routing risk already on file (production tenant memory) | — |
| B20 | Strict two-person separation of duties (Mercury) | ADAPT | Primary source 403'd on independent re-fetch — can't confirm past the file's own snippet. Also a business-policy fork, not a UI one; needs a founder decision, not a default | 2 |
| B21 | Bulk-select bar, full keyboard parity, Esc clears (Linear) | KEEP | Literal duplicate of A17 — same Linear doc. Adopt this version's fuller keyboard spec | 2 |
| B22 | System-wide Cmd+Z + 30-day cold storage (Linear) | KEEP | Verified across both cited Linear docs (undo-actions page confirms the batch-undo claim; delete-archive-issues page independently confirms "30 days"). Overlaps A6 — see §3 | 2 |

### File B — Receiving and counting on a phone/tablet

| # | Pattern | Verdict | Reason | Rule |
|---|---|---|---|---|
| B-R1 | Camera-first capture, review deferred to desktop (Toast) | KEEP | Sound device-capability split | — |
| B-R2 | Split-view: extracted line items left, source image right (Toast) | KEEP | Direct rule-6 exemplar — the working stays visible in place | 6 |
| B-R3 | Draft→Received state machine tied to inventory effect (Toast) | KEEP | "Receive" as one sealed action with a real, visible effect — matches rule 2's spirit | 2 |
| B-R4 | Shelf-to-sheet counting order (MarketMan) | KEEP | Cheap UX win, no overlay-shape question | — |
| B-R5 | Concurrent multi-user counting, no lock (MarketMan) | ADAPT | "No lock" needs Mudavym's own collision-*visibility* answer — see §4, this is exactly the gap presence indicators solve | 4 |
| B-R6 | Draft/Placed/Delivered/Received sequential states (Lightspeed) | KEEP | Reinforces B-R3's "delivered ≠ received" distinction | 2 |
| B-R7 | Snap-photo tablet-web receiving (Square) | KEEP | Confirms tablet-web is viable, lowers the device bar for `receiving-door.md` | — |
| B-R8 | Mobile PO creation "from anywhere" (R365) | REJECT | The file's own flag: docs confirm general mobile PO/AP tasks, not a dedicated door-side receiving screen — don't cite as a purpose-built feature | 4 |

### File B — Approvals recap (mostly restates the main table, within the same file)

| # | Pattern | Verdict | Reason | Rule |
|---|---|---|---|---|
| B-App1 | Two distinct checkpoints (approved/released) | KEEP | Verbatim duplicate of B16 | 2 |
| B-App2 | AND/OR logic per approval step | KEEP | Verbatim duplicate of B16 | 2 |
| B-App3 | Flag reason written on the object | KEEP | Verbatim duplicate of B14 | 4 |
| B-App4 | Segregation of duties as hard exclusion | ADAPT | Verbatim duplicate of B20 — same 403 caveat applies | 2 |
| B-App5 | Escalating dual-admin scaled to requester's authority | ADAPT | New nuance not in B20's main-table row (the bar rises with the requester's own standing) — worth keeping as its own line item, same evidence caveat | 2 |
| B-App6 | Weekly digest instead of real-time interrupt | KEEP | Verbatim duplicate of B18 | 4 |
| B-App7 | Denial changes status, does not claw back money | KEEP | Distinct, important standalone point not fully spelled out in B18: "reject" and "undo the money" must be two different seals | 2, 3 |
| B-App8 | Refund reason required before confirm | ADAPT | Verbatim duplicate of B10 — same re-fetch caveat | 2 |

### File C — AI-native and mobile

| # | Pattern | Verdict | Reason | Rule |
|---|---|---|---|---|
| C1 | Per-hunk diff, 3 granularities, "Accept all" (Copilot Edits) | ADAPT | If the underlying apply is a real commitment, a bare "Accept all" plain button violates the seal rule — the batch must resolve to one wax seal, not a checkbox-and-button | 2 |
| C2 | Diff/apply mode persists until resolved (Cursor) | ADAPT | Cursor's own users report the mode trapping them or silently auto-applying — real negative evidence that the *exit* from a proposal state needs an equally explicit label as the entry | 3 |
| C3 | Terminal diff review by turn (Claude Code `/diff`) | KEEP | Sound "one proposal = one reviewable unit" concept; the exact keybindings are third-party-sourced and unverified — don't quote them as Claude Code's own spec | — |
| C4 | Queue a follow-up vs. interrupt while streaming | ADAPT | Needs a visible "proposing…" label so a queued follow-up can't be mistaken for confirming what's on screen | 3 |
| C5 | Agent queues follow-ups, resolves/unresolves its own threads (Linear Agent) | REJECT | **Re-fetched both cited Linear changelog URLs independently — neither confirms the agent autonomously resolving comment threads.** The underlying principle (an agent must never mark its own proposal done) is correct and is ADR 0113 itself, not evidence this citation actually supports; don't quote Linear as having shipped the violation | 3, 4 |
| C6 | Scoped inline rewrite + diff + version restore (ChatGPT Canvas) | ADAPT | Excellent for draft editing in Communications, but Canvas has no "this now leaves the building" ceremony — the final send still needs a PANEL + wax seal layered on top | 2, 3 |
| C7 | Object-scoped panel; editing an earlier turn branches a new version (Claude Artifacts) | ADAPT | An invisible fork is exactly the "absence reported as health" fault already on file — every branch needs a visible marker | 4 |
| C8 | Inline AI edit: accept/discard/retry (Notion AI) | ADAPT | "Try again" silently discards the prior attempt with no trace — risky if the discard drops a real fact (e.g. a named shortage) | 4 |
| C9 | Suggested-edits layer, hover ✔/✗ (Notion) | KEEP | Verified directly against Notion's own help page. Best structural precedent in the whole scan for "a draft never looks sent" | 3 |
| C10 | Grounded Q&A with citations, scoped to one object | KEEP | Matches "never invent to fill a gap" exactly — every answer must cite a row or say "no data" | 4 |
| C11 | NL query over your own data, anywhere (Superhuman Ask AI) | ADAPT | The entry point can be a POPOVER, but the *answer* is a QUESTION by the house's own taxonomy and belongs in a PANEL, not squeezed into 320px | 1 |
| C12 | One-line expandable summary under a thread | KEEP | Low-risk, in-place enhancement, not a commitment surface | 6 |
| C13 | Voice compose → polished draft, not a transcript (Superhuman) | ADAPT | Must stay visibly "AI-composed" until accepted and must never silently overwrite what a person already typed | 3 |
| C14 | Configurable delay before an email actually leaves | ADAPT | Duplicate of A7. An undo window sitting *after* a wax seal cheapens the seal unless scoped strictly to mechanical transmission delay | 2 |
| C15 | Numbered citations streamed progressively (Perplexity) | KEEP | Good default for the proposal panel; discipline needed against turning every micro-claim into a footnote | 4 |
| C16 | AI-added text visually distinct, black/gray (Granola) | KEEP | **Verified — but only against the row's second URL** (the granola.ai blog post); the first-listed URL (docs.granola.ai) does not contain the color claim at all. Pattern survives, citation quality doesn't | 3, 4 |
| C17 | Live transcript + auto action items beside a call (Otter) | ADAPT | Auto-generated action items must be proposed, never auto-added to a task list | 3 |
| C18 | Sheets with detents (Apple HIG) | ADAPT | Genuinely a new mode beyond ADR 0112's fixed 440/640 widths — belongs in OPEN-DECISIONS, converges with D1 — see §3 | 1 |
| C19 | Standard (non-blocking) vs. modal bottom sheet (Material) | KEEP | This is precisely rule 1's own non-modal carve-out — name it explicitly as a fourth, non-modal surface rather than treating it as a rejected fourth shape. Converges with D5 — see §3 | 1 |
| C20 | Review-then-swipe-up + haptic feedback (Robinhood) | ADAPT | Re-fetched Robinhood's own selling- and buying-a-stock pages: swipe-up-to-submit is confirmed for stocks generally; **haptic/vibration feedback appears on neither page** — cite the swipe mechanic, drop or re-verify the haptic detail before quoting it to the founder | 2 |
| C21 | Persistent sheet-over-map carries a whole flow (Uber/Lyft) | ADAPT | Directionally useful for the mobile receiving-door flow, but the source is a reconstructed system-design write-up, not Uber's or Lyft's own docs — treat as a direction, not a settled reference | 6 |
| C22 | Double-click + biometric + transaction-bound signing (Apple Pay) | KEEP | Verified in full against Apple's own security guide. The clearest model for what the wax seal should *mean*, not just look like | 2 |
| C23 | Bare notification "Approve" action, capped/styled, re-auth-capable (iOS) | REJECT | A bare approve-from-notification is a plain-button apply with zero ceremony for what may be a real commitment — it must open the scoped overlay to complete the wax ceremony, never apply silently. Apple's own `UNNotificationAction` reference page could not be independently confirmed in this pass (returned no body) — same secondary-sourcing caveat the file itself already raised | 2, 3 |
| C24 | Swipe-to-reply + status ticks + offline queue (WhatsApp/iMessage) | KEEP | Right vocabulary for "queued must never be visually confusable with confirmed" | 4 |

### File D — Implementation references

| # | Pattern | Verdict | Reason | Rule |
|---|---|---|---|---|
| D1 | Vaul snap points (bottom-sheet detents) | ADAPT | Same open-fork territory as C18 — resolve as ONE decision, not two separate half-approvals | 1 |
| D2 | Vaul nested drawers, one focus owner | ADAPT | Same stacking-depth fork as B3 — needs one shared answer, not a per-library default | 1 |
| D3 | Vaul scaled background on open | ADAPT | The file's own note is correct and must be enforced literally: this must be gated behind the shell store or it silently changes legacy pages | 7 |
| D4 | cmdk pages stack, Esc/Backspace pops a level | KEEP | Solid implementation detail for the command palette; overlaps A3/A4 | 1 |
| D5 | Sonner undo-toast (non-modal surface) | KEEP | The cleanest of the four "non-modal exception" candidates (no focus, no scrim) — name it once in ADR 0112 rather than have four files each half-propose a version of it | 1 |
| D-H1 (Choco) | Voice agent takes a supplier order as a live conversation | ADAPT | Relevant to ADR 0113 Q1 (voice + typing), but a "voice agent" risks reading as flashy rather than the founder's "quiet, not flashy" ceremony bar | 8 |
| D-H2 (Rekki) | Compare prices across suppliers while browsing | KEEP | Directional business-feature signal for the vendor catalogue/price register; not an overlay-shape question | — |
| D-H3 (Choco) | Separate sales-rep app for distributors | KEEP | Validates a vendor-portal counterpart to `/v/:slug`; not an overlay-shape question | — |

---

## 2. Evidence flags — claims that did not hold up on independent re-fetch

Re-fetched every URL that was load-bearing for a KEEP in the Top 10, a REJECT in the Fight 5, or
flagged by a researcher as thin. Results:

- **C5 (Linear Agent self-resolving threads) — does not hold.** Both cited URLs
  ([2026-03-24 changelog](https://linear.app/changelog/2026-03-24-introducing-linear-agent),
  [2026-06-11 coding-sessions changelog](https://linear.app/changelog/2026-06-11-coding-sessions))
  were re-fetched directly. Neither confirms the agent autonomously resolving or unresolving
  comment threads — the coding-sessions page describes the agent returning "a new diff for
  review" with human review required. This was framed in file C as "the sharpest conflict in
  the whole scan" against ADR 0113; the *conflict itself is a real thing to guard against*, but
  it should be attributed to the house's own rule, not to a documented Linear behaviour that the
  primary sources don't actually show.
- **C16 (Granola black/gray provenance) — survives, but on the wrong citation.** The row's
  first-listed URL (`docs.granola.ai/help-center/getting-started/granola-101`) contains no
  color-distinction text at all. The claim is fully confirmed instead on the row's *second* URL
  (`granola.ai/blog/how-to-use-ai-to-take-meeting-notes…`: "Your notes stay in black text, and AI
  additions appear in gray"). The pattern is good evidence; the citation order overstates the
  primary doc's support.
- **C20 (Robinhood haptic feedback) — the swipe-up mechanic holds, the haptic detail doesn't.**
  Both `selling-a-stock` and `buying-a-stock` support pages were fetched directly; swipe-up-to-
  submit is confirmed on both, but neither mentions vibration/haptic feedback. Cite the swipe
  gesture, not the haptic detail, until a better source turns up.
- **B10 / B-App8 (Stripe refund ceremony) — directionally right, mechanically overstated.** The
  live `docs.stripe.com/refunds` page describes "select a reason for the refund; if you select
  Other, you must add a note" and a plain **Refund** button — a required reason field, but not
  the file's framing of "confirm button disabled/meaningless without both [amount and reason]."
  The core criticism this research uses it for (a real money movement, ceremonially, is one
  click) is confirmed regardless.
- **B20 / B-App4 / B-App5 (Mercury separation of duties) — cannot independently confirm.**
  `support.mercury.com/hc/en-us/articles/45985054591508-…` returned HTTP 403 on a direct,
  independent re-fetch — the same block the researcher already flagged. Treat the whole row as
  resting on a search-engine snippet, not a page read, until someone with a live account confirms
  it.
- **C23 (iOS `UNNotificationAction`) — cannot independently confirm.** Apple's own
  `developer.apple.com/documentation/usernotifications/unnotificationaction` returned only a page
  title on fetch (JS-rendered), matching the file's own caveat that this is sourced from
  tutorial mirrors, not Apple's page.
- **Confirmed clean on independent re-fetch:** A6/B22 (Linear undo — the batch-undo claim on the
  undo-actions page, and the 30-day window independently on `linear.app/docs/delete-archive-
  issues`, a *different* URL than the one first quoted for the 30-day claim — both check out);
  B16/B-App1/B-App2 (Ramp Bill Pay AND/OR + release gate, confirmed verbatim); C9 (Notion
  Suggested Edits, confirmed); C22 (Apple Pay, confirmed in full, including the Authorization-
  Random transaction-binding detail); A22 (Vercel automatic per-push URLs, confirmed).

---

## 3. Duplicates across the four files

1. **"Undo replaces confirm" cluster — A6, A7, B22, C14.** Four rows, one underlying pattern
   (Linear/Gmail/Superhuman-style delayed or reversible commit). A7 and C14 cite the *identical*
   Gmail/Superhuman sources. Should collapse to one OPEN-DECISIONS entry: a tiered undo policy
   (instant Cmd+Z for reversible edits / delayed-send window for outbound messages / cold storage
   for deletes), not four separate asks.
2. **Bulk-select action bar — A17 = B21.** Same Linear "Select issues" doc, cited independently
   by two researchers. B21 carries the fuller keyboard spec (Esc clears, Cmd/Ctrl+A, right-click
   menu) — adopt that version.
3. **Peek-preview family — A1, B6, B7.** Three flavors of "preview a record without navigating
   away" (Linear peek, Notion side-peek, Notion's own unverified nested-peek). Converges with the
   founder's "ledger rows expand in place" instinct (rule 6) but is currently three separate,
   uncoordinated proposals.
4. **The scattered "fourth, non-modal shape" fork — C18, C19, D1, D5 (and adjacent, B3/D2 on
   stacking depth).** This is the single most important open decision buried across the whole
   96-pattern set, and no file states it as one decision. Four rows independently flag "ADR 0112
   doesn't have an answer for this" for four different mechanisms (Apple detents, Android's
   standard sheet, Vaul's snap points, Sonner's toast) without cross-referencing each other. They
   should be resolved together, in one ADR-0112 amendment, not approved piecemeal as each comes
   up in a different context.
5. **Internal duplication inside File B** — B14/B-App3, B16/B-App1/B-App2, B18/B-App6,
   B10/B-App8, B20/B-App4 are the same evidence restated in two tables of the same document.
   Padding, not new signal — B-App5 and B-App7 are the only rows in the "approvals" recap that
   add anything the main table didn't already say.
6. **Hover-preview pair — A15, A16 (same file).** GitHub hovercards and Notion's hover-to-peek
   are the same underlying behaviour (hover, don't navigate, no state change) and could have been
   one row.

---

## 4. The 10 to put in front of the founder first

1. **C9 — Notion's Suggested-Edits layer.** Verified directly. The cleanest existing product
   proof that "a draft never looks sent" is buildable, not aspirational.
2. **C16 — Granola's black/gray provenance.** Verified. Operationalizes "nothing is invented to
   fill a gap" as a permanent visual rule, not a pre-accept state that disappears on acceptance.
3. **B17 — Ramp/R365's in-place invoice-vs-order compare.** The closest real match to the
   founder's own "side-by-side inside an overlay" ask, and neither cited product uses a modal for
   it — direct rule-6 evidence.
4. **B16 — Ramp's two-checkpoint approve-then-release.** Verified directly against Ramp's docs.
   The cleanest primary-source validation that "approve an order" and "approve a payment" are
   two separate wax seals, exactly as ADR 0112 already lists them.
5. **C22 — Apple Pay's double-click + biometric + transaction-bound signing.** Verified in full.
   Defines what the wax seal should *mean* — a gesture cryptographically tied to this one
   commitment — better evidence than anything else in the scan for the seal's semantics.
6. **B14 — "Why this was flagged," written on the row (Ramp).** A one-line extension of a rule
   Mudavym already has ("every figure names its rows") to "every flag names the rule it tripped."
7. **A17 / B21 — Multi-select + plain-button bulk bar (Linear).** Directly matches an existing
   house rule almost exactly; near-zero new policy, just the mechanic.
8. **A26 — The `prefers-reduced-motion` contract.** Not optional, not a competing pattern — a
   precondition for every other overlay motion Mudavym ships.
9. **C10 — Grounded Q&A with citations, scoped to one object.** Matches "an absence is never
   reported as health" almost word for word: cite a row or say "no data," never synthesize.
10. **B-R2 — Split-view review, line items left / source image right (Toast).** Cheap to build,
    directly reusable for `receiving.md`'s invoice-vs-delivery check, and it's in-place already.

## 5. The 5 to fight hardest

1. **C5 — "The agent resolves its own threads" (Linear Agent).** The evidence for this specific
   claim did not survive re-fetch (see §2) — don't let a misattributed citation be the reason
   Mudavym relaxes ADR 0113. The principle (never let the assistant mark its own proposal done)
   should stand on the ADR itself, not on Linear.
2. **C23 — Bare "Approve" from a push notification.** The single most tempting anti-pattern in
   the whole scan — one tap from a lock screen feels like a gift to a busy manager — and the
   single clearest violation of "AI proposes, a person applies" if what's being approved is a
   real commitment. Every approve-from-notification must open the scoped overlay and complete the
   seal; it must never apply on the tap itself.
3. **B10 / B-App8 — Stripe's refund ceremony, ported whole.** "Stripe does it with one click" is
   exactly the kind of prestige-by-association argument that erodes the seal rule. A refund is a
   money movement; keep the "reason is required" detail, reject the plain-click confirm.
4. **A6 / A10 — Undo-toast-replaces-confirm, generalized past its scope.** Real and well-
   evidenced for reversible status/label edits. The fight is against letting it quietly expand to
   cover anything "fireable immediately" — bulk deletes of ledger-affecting rows, vendor-facing
   sends — which is precisely where rule 2 draws the line.
5. **C18/C19/D1/D5 cluster — four separate, uncoordinated asks for a fourth surface.** None of
   them individually breaks the house's three-shape rule if built as a genuinely non-modal
   exception (rule 1's own carve-out allows exactly this) — but approved one at a time, across
   four different feature requests over the next two quarters, this is how "three shapes" quietly
   becomes six. Force one consolidated ADR-0112 amendment before any of the four ships.

---

## 6. What the four files missed

All four researched command-first tools, ops/finance SaaS, AI-native products, and mobile/UI
libraries — but none of them opened an actual **restaurant POS's** own approval or kitchen-floor
ceremony, despite Mudavym being a restaurant platform and File B citing Toast, Square, and
Lightspeed twice each for receiving and counting alone.

1. **Manager-passcode override for a restricted action (Toast POS).** Confirmed directly against
   Toast's own docs
   ([Get Started With Discounts](https://support.toasttab.com/en/article/Basic-Discount-Configuration)):
   a discount set to "Manager" permission level cannot be applied by non-manager staff — "If a
   non-manager enters a code for a discount that requires manager approval, they are prompted for
   a manager passcode." This is a *different* shape of "second authority" than Mercury's peer
   admin-approval (B20): it's a superior-authority override completed in seconds, at the point of
   action, not a multi-step chain. It is the direct real-world analog for any "staff proposes, a
   manager applies" moment in Mudavym's own owner/manager/staff hierarchy (price overrides,
   comp/void, an order line correction) — and none of the 96 patterns above name it.
2. **The kitchen's own "bump / recall" ceremony (Toast KDS).** Confirmed against Toast's official
   platform guide
   ([Using the bump bar](https://doc.toasttab.com/doc/platformguide/platformKitchenUsingBumpBars.html)):
   a double-press bumps (fulfills) a ticket; a dedicated **RECALL LAST** action reverses an
   accidental bump, and the recalled ticket is marked "RECALLED" in red at the top. This is the
   restaurant industry's own, already-battle-tested version of "undo replaces confirm" (§5, item
   4) for a specific, bounded class of action — mark-as-done, then a one-tap, clearly-labelled
   reversal — and it was invisible to a research pass that spent two files studying Toast for
   receiving and counting without ever opening Toast's kitchen-facing docs.
3. **Presence — who else is looking at this right now (Figma).** Confirmed against Figma's own
   Help Center: "Every user in the document gets an avatar in the top right corner… see who is
   currently viewing or editing the file," with live multiplayer cursors on top of that. File A
   already cites Figma (A24) for a different feature and completely misses Figma's single most
   famous behaviour. This directly answers a gap File B raises against itself and never resolves:
   B-R5's "concurrent multi-user counting… no lock, no 'someone else is counting this' block" is
   exactly the scenario presence indicators exist to make safe — two staff counting the same
   cellar without either seeing the other is present is the failure mode, not the concurrency
   itself.
