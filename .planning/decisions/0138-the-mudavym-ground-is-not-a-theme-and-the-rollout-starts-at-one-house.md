# 0138 — The Mudavym ground is not a theme, and the rollout starts at one house

- **Status:** Locked 2026-09-12 — both answers given by the founder directly in session, asked one at a time
- **Date:** 2026-09-12
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** mudavym, warm charcoal, 15130F, ground, theme, ThemeContext, dark mode, prefers-color-scheme, feature flags, restaurant_feature_flags, mudavym_design, rollout, one house, ALDEMIR, go-live
- **Links:** [[0042-brand-color-system]] (the ground this makes real) · [[0044-mudavym-implementation-kickoff]] (the per-page flag mechanics) · [[0104-every-incoming-document-renders-as-one-canonical-mudavym-document]] (D9, the `[data-ground="paper"]` escape) · [[0131-the-new-house-goes-live-dark-then-one-house-at-a-time]] (**narrowed by D2 below — and not yet on `main`**) · `.planning/06-pages/DESIGN-FOUNDATION.md` ("Decided — the dark ground") · `CLAIMS.jsonl` id `ADR-0138`

## Context

Two things were true at once on 2026-09-12, and together they meant the Mudavym
redesign existed for nobody. The audit's verdict was *"pushed and deployed, but
invisible."*

**The flags were never written.** `public.restaurant_feature_flags` carries
**eleven** `mudavym_design_*` columns, every one `NOT NULL DEFAULT false` — ten
added by `supabase/migrations/20260831090000_mudavym_design_flags.sql:22-31`, the
eleventh (`mudavym_design_document`) by
`supabase/migrations/20260904121000_mudavym_design_document_flag.sql:16`. The gate
registry on `origin/main` lists the same eleven page keys
(`apps/web/src/lib/mudavym/useMudavymDesign.ts`, `MUDAVYM_PAGES`). The rebuilt
pages — nine by the session audit's count — were merged and deployed. And the
table held **zero rows against fourteen restaurants**, so every house fell through
to the `DEFAULT false` and rendered legacy. The redesign was in production and
reachable by no one.

**The ground had never rendered either.** Warm Charcoal `#15130F` is the decided
dark ground (ADR 0042). On `origin/main` it was declared only under
`.dark .mudavym` (`apps/web/src/styles/mudavym.css:48`) and a
`:root:not(.light) .mudavym:not([data-ground="paper"])` block inside
`@media (prefers-color-scheme: dark)` (same file, `:70`). But
`getStoredTheme()` force-migrates every first-time browser to **light** —
`apps/web/src/contexts/ThemeContext.tsx:40-44` writes `'light'` into
`localStorage` the moment the migration key is unset. So `.dark` was never on
`<html>` for a new user, and the media block was guarded by `:not(.light)`. Even
a house with its flag ON would have seen the redesigned page on a light ground.
**The brand decision existed in the stylesheet and in no browser.**

The go-live plan (ADR 0131) names `scripts/flip_mudavym_design_flags.py` as the
tool for the rollout. **That script does not exist on `origin/main`** — verified
here: `git ls-tree -r --name-only origin/main` matches nothing for
`flip_mudavym_design_flags`, and the only commit that ever added it is `21e89857`
on the unmerged branch `feat/mudavym-go-live`. The named instrument was not
reachable from the trunk, so the rollout had no mechanism either.

## Options considered

**D1 — how a Mudavym page gets the decided ground.**

1. **The `.mudavym` scope paints charcoal regardless of the app's light/dark
   toggle.** The pages designed for the ground hold it; everything outside the
   scope still respects the user's theme. Costs: two grounds coexist in one app,
   and a user in light mode meets a dark page when they cross into a rebuilt one.
2. **Flipping a design flag also flips the user to dark.** Appealing because the
   app then has one ground at a time. **Rejected by the founder:** it overrides a
   preference the user may have set deliberately — a page-level design decision
   would be reaching out and rewriting a person's account setting.
3. **Leave it, so charcoal renders only in dark mode.** Zero work. **Rejected:**
   given the forced light migration at `ThemeContext.tsx:40-44`, the ground
   decision would not govern what most users see — which is the same as not
   having decided it.
4. **Mock both first, then choose.** Offered. **Not taken** — he decided directly.

**D2 — how far the flag rollout goes now.**

1. **Write flag rows for the founder's restaurant only; the other thirteen stay
   on legacy.** *Chosen.*
2. **He flips them himself.** **Rejected — he delegated the write.**
3. **His house plus the sim houses.** **Rejected.** Worth naming because this is
   exactly what ADR 0131 locked on 2026-09-06 ("ALDEMIR plus the simulator
   houses first"); today's answer is narrower.
4. **All fourteen at once.** **Rejected** — that is the real go-live, and it was
   not what was being chosen here.

## Decision

**D1. The `.mudavym` scope paints Warm Charcoal `#15130F` regardless of the app's
light/dark toggle; the rest of the app still respects the user's theme.**

The charcoal column moves onto the bare `.mudavym` selector
(`apps/web/src/styles/mudavym.css:42-43`, `--paper-0: #15130F` at `:51`) and the
theme-qualified rules are deleted. The **base** selector is the right home rather
than an ancestor-qualified override, because a custom property declared directly
on an element always beats one inherited from an ancestor whatever the
specificity — on the base selector every element that opts in carries the column
itself and has no race to lose.

The ground moves as a **set**, not alone: `paper-0/1/2`, `ink-1..4` and the İznik
seal flip together, because charcoal behind light-mode ink is unreadable. `ink-1`
`#EFE7D9` on `paper-0` `#15130F` is **15.11:1**; the light ink on that ground
would have been **1.05:1**. One escape remains and stays explicit —
`[data-ground="paper"]`, the canonical document sheet (ADR 0104 D9) — and it now
wins on specificity, (0,2,0) over the base (0,1,0), rather than on source order
against `.dark .mudavym`, which Vite's injection order made a coin flip.

**D2. Feature-flag rows are written for the founder's restaurant only.**

Measured in production while writing this record (project `exzueerziesmczwlhomd`):
exactly **one** row in `restaurant_feature_flags` —
`restaurant_id 05b8c4a5-2adf-4f0e-9bf3-6a6d13ceaa18` (**ALDEMIR**), created
`2026-09-12T08:16:46Z`, all eleven `mudavym_design_*` columns `true`, carrying
`metadata.scope = "ALDEMIR only"` and
`metadata.set_by = "design session, founder-authorised 2026-09-12"`. The AI
columns were left untouched (behaviour-preserving). The remaining **thirteen**
restaurants have no row at all and therefore take the `NOT NULL DEFAULT false`
path into the legacy pages — absence of a row is the off switch, which is why no
back-out write is needed to undo this.

*The audit's figure is corrected on the record rather than copied forward:* zero
rows was true when the audit measured it; the count is **1** as of this writing,
and that row is this decision. The restaurant count also moved — ADR 0131
measured **15** houses on 2026-09-06, the count today is **14**. Neither ADR
0131's figure nor the audit's was re-derived from the other; both were measured.

**This narrows ADR 0131, openly.** That record locked "ALDEMIR plus the simulator
houses first"; today the founder chose ALDEMIR alone, and the sim houses were put
to him and declined. ADR 0131 is not on `origin/main` — it exists only on
`feat/mudavym-go-live` — so this is not a superseding edit to a trunk record but a
narrowing that its branch must pick up when it lands.

## Consequences

- **What becomes easier.** The brand ground is now true for any user who reaches a
  Mudavym page, with no dependency on a theme toggle, an OS setting, or the
  forced-light migration. One house is live, so the redesign gets real use before
  thirteen more houses can be hurt by a defect. Rolling back is deleting one row.
- **What becomes harder.** Two grounds now coexist in one app, and a user in light
  mode crosses a hard visual seam entering a rebuilt page — accepted by D1, not
  overlooked. Every future token added to the `.mudavym` scope must be added as
  part of the ground *set*, or it will be a light-mode value on charcoal.
  `ThemeContext.tsx:40-44` still force-migrates browsers to light; D1 routes
  around that rather than fixing it, and the non-Mudavym app is still affected.
- **What is NOT fixed here.** `scripts/flip_mudavym_design_flags.py` still does
  not exist on `origin/main`; today's row was written directly, and the rollout
  that ADR 0131 describes still has no instrument on the trunk. The twelve other
  live houses and the sim houses remain un-flipped by deliberate choice.
- **What would trigger revisiting.** D1: the founder reporting the light→charcoal
  seam as jarring in real use, or a Mudavym page needing to render on paper for a
  reason `[data-ground="paper"]` cannot express. D2: the ALDEMIR house running
  clean for long enough that the founder calls the next houses — which is the
  ADR 0131 rollout resuming, and that call is his, not a session's.
- **Guard.** `CLAIMS.jsonl` id `ADR-0138` asserts D1 mechanically: the ground
  tokens are declared on the bare `.mudavym` selector at the decided values, under
  no `.dark`/`.light`/`[data-theme]` selector, and in no `prefers-color-scheme`
  block. It strips CSS comments before matching — without that, this file's own
  header comment (which names `.dark .mudavym` and `prefers-color-scheme` while
  explaining their removal) makes the **corrected** tree report FAIL, the ADR 0096
  trap reproduced exactly. Proven against the pre-fix tree and three mutations;
  a missing stylesheet is `CANNOT CHECK`, never a quiet pass.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-12 | Aldemir (founder) | D1 and D2 asked directly in session and answered; both Locked |
| 2026-09-12 | — | Created; D1 shipped in `fix/motion-sweep-defects`, D2 live in production as one row |
