---
type: agenda-full
division: commercial
department: media-brand
team: brand-identity
status: provisional
metrics: []
updated: 2026-08-24
links:
  - "[[brand-identity-charter]]"
  - "[[brand-identity-premortem]]"
  - "[[brand-identity-agenda-board]]"
  - "[[media-brand-agenda-full]]"
---

# Brand Identity (M1) — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

## What

Two deliverables and one guard.

1. **The rename, finished.** Tier 1 to zero, tier 2 in bulk, tier 3 handed to Engineering.
2. **The CI guard**, shipped in the same pull request as the cleanup.
3. **The voice guide**, with its scope stated on the first page.

Plus one standing hygiene item: the reference shortlist, verified or dropped.

## How

### The rename, in the order it should actually happen

```
step 0   write the scan          ← before editing anything, or the baseline is a claim
step 1   confirm scope           ← CM-F5 boundary, mobile install identity
step 2   tier 1, by class:
           2a  transmitted mail   From:, Message-ID, template links, support address
           2b  transmitted docs   iCal PRODID + feed name
           2c  third-party logs   crawler User-Agent
           2d  published metadata OpenAPI contact / license / production server
           2e  rendered UI        web shell, manifest, sidebar, auth pages, privacy copy
           2f  OS-level           mobile app name, Face ID prompt, notification channels,
                                  web push title
step 3   CI guard                ← same PR as step 2, not a follow-up
step 4   tier 2 bulk sweep       ← comments, fixtures, demo scripts, seed SQL
step 5   regenerate artifacts    ← openapi.json, dist/ — rebuilt, never hand-edited
step 6   hand tier 3 to Engineering with the hazard note attached
```

**Why classes 2a–2d come before 2e.** The rendered UI is seen by people who already know who
we are. The transmitted surfaces are seen by people who do not, and we do not control their
copies. A vendor's inbox keeps a `From:` header forever; a sidebar can be fixed on Tuesday.
This ordering is the direct counter-pressure to failure mechanism 1 in
[[brand-identity-premortem]], which predicts exactly the opposite order happening by default.

**Class 2f is the one nobody has recorded before.** The mobile app's home-screen label, the
Face ID system prompt, and the Android notification channel name are rendered by the
operating system, not by us. They are the most persistent brand impressions the product
makes and they are invisible to every scan run so far.

### The scan

Two patterns, three tiers, `path:line` for every tier-1 hit. It reports:

```
name:   <lines> across <files>     baseline 351 / 193
domain: <lines> across <files>     baseline  33 /  25
tier1:  <open rows> of <total>     per surface class, never as a total
tier3:  <count>                    reported, explicitly not actionable here
```

It must be committed **before** the first string is edited. A baseline measured after the
easy half is already fixed is not a baseline.

### The voice guide

Short, enforceable, scoped. Three sections: what we are called and how it is written; the
banned-construction list with its scope stated (**published outward content only** — em
dashes, "streamlined" and family); and the claim rules, which point at G3's fact-check rather
than restating it.

It is written *for G3 to use*, so every rule has to be citable as a clause. "Feels off-brand"
is the failure state, and it is a design failure of the guide, not of the reviewer.

## Why now

Because it is the only work in this division where the evidence is complete, the scope is
bounded, and the cost of delay is paid by people outside the company. It is also upstream:
G3 cannot be a gate until the guide exists, and G3 gates everything Growth and M2 will
publish.

And because the number keeps getting worse the more carefully anyone looks. Ten, then 33,
now 351. The next look will not make it smaller.

## Next steps

1. Founder confirms scope: CM-F5 boundary, mobile install identity in or out.
2. Write and commit `brand-surface-scan`. Record the baseline.
3. Tier 1 by class, 2a → 2f.
4. `brand-guard-ci` in the same PR.
5. Tier 2 sweep.
6. Regenerate `openapi.json` and `dist/`; verify the guard catches a deliberate regression.
7. Hand tier 3 to Engineering with the Expo slug hazard written down.
8. Voice guide, scoped, dated.
9. Reference shortlist: verify or drop. Nothing adopted before then.

## Questions for the founder

1. **CM-F5:** shipped surfaces only, or also `@wineops/*` scopes, container names, and
   Railway/Vercel service identifiers?
2. **`apps/mobile/app.json:4` (`"slug": "wineops-ai"`)** — this one can orphan installed apps
   and push tokens. Deferred, or done deliberately with Engineering?
3. **What replaces `support@wineops.ai`, `notifications@wineops.ai`, and `admin@wineops.ai`?**
   These need mailboxes that exist before the strings change, or the rename breaks support.
   `apps/web/src/pages/Help.tsx:18` already reads `VITE_SUPPORT_EMAIL` with the legacy value
   as a fallback, so part of this is configuration rather than code.
4. **The crawler User-Agent** (`vendor-page-extractor.service.ts:17`) advertises
   `+https://wineops.ai/bot`. Does that URL need to resolve to a real page under the new
   name? A bot UA pointing at a dead page is worse than one pointing at nothing.
5. **`WineOpsBot` as a name** — is the crawler renamed with the company, or does it keep a
   separate identity?
6. **The reference shortlist:** five spellings unverified, two with no URL at all. Please
   confirm before anything is evaluated.
7. **`SKILLS.md`** still says "WineOps AI" and is tracked as
   [OD-14](../../../../../decisions/OPEN-DECISIONS.md) — retire the file or rewrite it? M1
   will supply wording either way but the decision is not ours.
