---
type: agenda-full
division: commercial
department: media-brand
status: provisional
metrics: []
updated: 2026-08-24
links:
  - "[[media-brand-charter]]"
  - "[[media-brand-premortem]]"
  - "[[media-brand-agenda-board]]"
  - "[[brand-identity-agenda-full]]"
  - "[[narrative-collateral-agenda-full]]"
  - "[[social-community-agenda-full]]"
  - "[[customer-relationship-research-agenda-full]]"
---

# Media & Brand — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

## What

Three live mandates and one dormant one.

1. **Finish the rename.** The company has two names in front of its users, its vendors, the
   sites it crawls, and the operating systems it is installed on. This is the only
   department metric that is measurable today, and it is a defect rather than an ambition.
2. **Produce the argument.** The narrative is written ([YC_WEDGE_PLAN.md:312](../../YC_WEDGE_PLAN.md))
   and has never been made into anything a person can be handed. Two artifacts are asked
   for: the company story as a narrative, and a simple internal reference slide deck.
3. **Build the consent gate before the research.** M4's first practice needs an approval
   register that does not exist. Building the practice first and the register afterwards is
   the failure mode, not the sequence.
4. **Hold M3 dormant** until an article clears G3.

## How

**The rename is a burndown, not a project.** Two patterns, two counts, one CI guard:

```
scan(name)   → literal "WineOps"      → 351 lines / 193 files   (verified 2026-08-24)
scan(domain) → "wineops.ai"           →  33 lines /  25 files   (verified 2026-08-24)
                     │
                     ├─ tier 1: third-party- and customer-visible → rename now
                     ├─ tier 2: internal comments and fixtures    → rename in bulk, low risk
                     └─ tier 3: identifiers (slug, scopes, hosts) → NOT ours — CM-F5 / Engineering
                     │
                     └─→ CI check → count must be 0 for tier 1, and must not grow for tier 2
```

The tiering is what makes this safe. Tier 3 contains at least one live hazard:
`apps/mobile/app.json:4` is `"slug": "wineops-ai"`, and an Expo slug is an install identity,
not a display string. Editing it in the same commit as the display name is how a rename
orphans installed apps and push tokens.

**The argument is built structure-first.** The order of the claims is reference-independent
and can be written now. The visual treatment waits on an input we do not have (below).
Everything carrying a number routes through G3's fact-check before it leaves.

**The research is gated at the register.** No question is asked of any customer until the
approval mechanism exists and Compliance & Privacy has reviewed it.

## Why now

Because the identity defect is the one piece of work in this division where the evidence is
complete, the fix is bounded, and the cost of waiting is paid by third parties rather than
by us. Every week it stands, some vendor's mail server, some crawled site's access log, and
some operator's home screen record a company name that no longer exists. [[commercial]] §4
called this M1's founding assignment; this session's audit found it is roughly ten times
larger than the audit that named it, which strengthens the case for doing it first rather
than weakening it.

The second reason is sequencing. M1 produces the voice guide that G3 needs in order to be a
gate at all, and G3 gates everything M2 and M3 will eventually publish. Media & Brand is
upstream of Growth's only mandatory human step. If M1 stalls, G3 enforces an opinion.

## Next steps

Ordered. Nothing below is done.

1. **Confirm the rename scope with the founder.** Specifically: is the tier-3 boundary
   (CM-F5) accepted, and is the mobile app's install identity in or out?
2. **Write the scan.** One skill, two patterns, tiered output, committed before any string
   is edited — otherwise the count is a claim rather than a measurement.
3. **Land the tier-1 rename** across the surfaces listed in [[brand-identity-charter]].
4. **Land the CI guard** in `.github/workflows/ci.yml`. A cleanup without a guard is a
   cleanup that gets undone; this is the same shape as Security's first assignment
   ([README §2.3](../../../foundation/README.md)).
5. **Write the voice guide**, and state its scope explicitly — the banned-construction list
   (em dashes, "streamlined" and family) governs *published outward content*, not internal
   planning documents. This corpus is full of em dashes; a guide that appears to ban them
   here will be ignored everywhere.
6. **Draft the company story**, structure before styling.
7. **Draft the approval-register proposal** and send it to Compliance & Privacy. Do not
   implement it here.
8. **Verify the reference shortlist** (below) before a single item enters the stack.

## The reference shortlist — evaluation only, nothing adopted

The founder named these. **Spellings are unverified and no site was fetched during this
session.** They are recorded so they are not lost, and explicitly not as tooling decisions.

| Named | Kind | Status |
|---|---|---|
| `matthewyu.dev` | Personal site, visual reference | Spelling unverified |
| `sirio.online` | Personal site, visual reference | Spelling unverified |
| A Framer "anti-portfolio" site | Visual reference | Name and URL not captured |
| A "Jackie Zhang" site | Visual reference | Spelling unverified, no URL |
| A repeated-letter stylization of "Thalia" | Wordmark reference | Exact stylization not captured |
| Pomelli | Google ad-creative tool | Unevaluated |
| Haikei | Generator | Unevaluated |
| Motion Primitives | Motion library | Unevaluated |
| Stitch | Tool | Unevaluated |
| 21st.dev | Component source | Unevaluated |
| Animista | CSS animation generator | Unevaluated |
| Phosphor Icons | Icon set | Unevaluated |

**Rule:** nothing on this list enters the stack until (a) the founder or a verified fetch
confirms the identity, and (b) it is evaluated against a named need this department already
has. A shortlist is not a stack.

## Questions for the founder

1. **The ElevenLabs pitch deck reference is unreachable.** It is saved in your personal
   Instagram saves. Claude cannot fetch it — it sits behind a personal authenticated
   account, and nothing in this org has or should have access to it. **Please export it or
   screenshot it into the repo.** Until then M2 builds structure and defers visual
   treatment; it will not guess.
2. **CM-F5:** does the rename stop at surfaces a human or third-party machine can see, or
   does it include `@wineops/*` workspace scopes, container names, and Railway/Vercel
   service identifiers? The second set is an Engineering change touching every import and
   deploy target.
3. **Mobile install identity:** `apps/mobile/app.json:4` is `"slug": "wineops-ai"`. Changing
   it is not a string edit. In scope or deferred?
4. **The approval register for customer research:** where should approval live, who captures
   it, and what exactly is the customer approving? The existing consent schema is for guests
   and for a different purpose; it should not be reused.
5. **The five visual references above** — please confirm the spellings and URLs. Two of the
   five have no URL at all.
6. **M3's entry trigger** — is "first article clears G3" the right one, or should handles be
   reserved earlier as a defensive registration? Reserving is a decision, not a launch.
