---
type: schedule
division: commercial
department: media-brand
team: brand-identity
status: provisional
metrics: []
updated: 2026-08-24
links:
  - "[[brand-identity-charter]]"
  - "[[brand-identity-loops]]"
  - "[[media-brand-schedule]]"
---

# Brand Identity (M1) — Schedule & Skills

## Recurring work

| Cadence | Job | Emits |
|---|---|---|
| Per PR | `brand-guard` — tier-1 count must be 0; tier-2 count must not grow; runs over generated output | `brand-guard-regression` |
| Weekly | Two-pattern surface scan; report both counts and tier-1 rows **by class** | `legacy-name-burndown`, `legacy-domain-burndown` |
| Weekly | Blocked-input check — do the replacement mailboxes exist yet? | `legacy-domain-burndown` |
| Per release | Re-scan generated artifacts after rebuild (`openapi.json`, `dist/`) | `brand-guard-regression` |
| Monthly | Read G3's rejections; amend the voice guide where a rejection could not cite a clause | `voice-guide-conformance` |
| Quarterly | Reference shortlist: verify or drop | `reference-shortlist-verification` |

**Retirement plan, written now so it is not forgotten.** The weekly scans exist to burn a
number down. When tier 1 reaches zero, both weekly rows are deleted and the per-PR guard is
the whole mechanism. A weekly job reporting "still zero" would hit the three-runs-no-action
rule ([README §6](../../../../../foundation/README.md)) anyway; deleting it deliberately is
better than having the rule delete it.

## Skills owned

Skills live in `.claude/skills/`. **None of the below exist yet.** The repo's only project
skill is `.agents/skills/railway-config/SKILL.md`.

Each carries the four things [README §3.3](../../../../../foundation/README.md) requires:
trigger, doneability, a real past instance, owner.

---

### `brand-surface-scan` — T2 department

- **Trigger.** Weekly during burndown; before any release; and immediately whenever someone
  states that the rename is complete.
- **Doneability.** Emits `name` and `domain` counts separately, tiers every hit into
  1 / 2 / 3, gives `path:line` for every tier-1 row, and groups tier 1 by surface class.
  A run that produces a single aggregate number is a failed run.
- **Real past instance.** Twice, in this repo, on this exact problem. The host-scoped scan
  behind [EXTERNAL_CONNECTIONS.md:15](../../../../../foundation/EXTERNAL_CONNECTIONS.md)
  reported 10. The domain-scoped correction in [[commercial]] §4.1 reported 33. Neither
  could see `apps/web/index.html:7`, `apps/web/public/manifest.json:2`, or
  `apps/mobile/app.json:3` — and the name surface is 351 lines across 193 files.
  `scripts/render_system_atlas.py:109` still carries only the domain pattern.
- **Owner.** M1.

### `brand-guard-ci` — T3 operational, owned by M1

- **Trigger.** Every pull request, and every release build.
- **Doneability.** Non-zero exit when a tier-1 legacy reference exists or is introduced.
  Includes generated output. Reports which class regressed, so the failure message is
  actionable without opening the scan.
- **Real past instance.** The rename was completed in the planning corpus and not in the
  product; 384 lines survived across the two patterns. This is the recurrence-guard shape
  [README §2.3](../../../../../foundation/README.md) prescribes.
- **Owner.** M1, implemented with Engineering in `.github/workflows/ci.yml`.
- **Note.** Must also cover a second failure path: new code copied from old code. A guard
  that only checks changed lines will miss a new email template cloned from
  `email-templates-legacy.ts`.

### `voice-guide-check` — T2 department

- **Trigger.** Fired by G3 during the mandatory editorial pass; fired by M2 before any
  artifact leaves.
- **Doneability.** Returns the violated clause, quoted, with the offending span. Never a
  bare verdict.
- **Real past instance.** **None — and it is not built until there is one.** The guide does
  not exist, so this skill would be speculative, which
  [README §3.3](../../../../../foundation/README.md) forbids. Listed here so its owner is
  unambiguous when the trigger arrives.
- **Owner.** M1 authors; G3 fires.

### `reference-shortlist-verify` — T2 department

- **Trigger.** Quarterly, and before any shortlist item is adopted into the stack.
- **Doneability.** Each entry ends as *verified + named need*, or *dropped*. There is no
  "probably fine" state.
- **Real past instance.** Twelve references named in one conversation:
  `matthewyu.dev`, `sirio.online`, a Framer "anti-portfolio" site, a "Jackie Zhang" site, a
  repeated-letter stylization of "Thalia", Pomelli, Haikei, Motion Primitives, Stitch,
  21st.dev, Animista, Phosphor Icons. Five spellings unconfirmed, two with no URL. **No site
  was fetched during this session** and nothing is adopted.
- **Owner.** M1.

---

## Explicitly not owned here

| Work | Owner | Why |
|---|---|---|
| Renaming `@wineops/*` scopes, containers, Railway/Vercel identifiers | Engineering | CM-F5. Identifiers, not display strings |
| Applying the voice guide to drafts | Growth G3 | A guide enforced by its author is an opinion |
| Design tokens, components, layout | Product → Design | Outward creative is not product interaction |
| The `SKILLS.md` decision | OD-14 owner | M1 supplies wording only |
