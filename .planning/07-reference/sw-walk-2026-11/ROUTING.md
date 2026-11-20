# Model routing for sw-walk workflows (ADR 0361, 2026-11-07)

Test: route to the cheapest model whose output a command (or the next tier up) can still check.
Escalate up only: Haiku `UNEXPECTED:` → Sonnet/Opus; Sonnet `FORK:`/`ESCALATE:`/second failure → Opus.

## Paste into every wave script

```js
const TIER = {
  plan:      { model: 'opus',   effort: 'high'   },   // planners, research head, kill pass, final say, ADRs
  buildHard: { model: 'opus',   effort: 'high'   },   // money/stock math, migrations, auth/tenancy, ledger writes
  buildUI:   { model: 'sonnet', effort: 'medium' },   // bounded UI/read lanes with a complete brief, ≤15 files / 30K
  audit:     { model: 'sonnet', effort: 'high'   },   // verifiers, finders, gate reviewers
  fix1:      { model: 'sonnet', effort: 'medium' },   // QA gave repro + direction
  fix2:      { model: 'opus',   effort: 'high'   },   // round 2+, or audit DEFECT on math/auth
  collect:   { model: 'haiku',  effort: 'low'    },   // gh/journal/guards/size/revert-proof runner
}
// a lane object carries `kind: 'hard' | 'ui'` set by the Opus planner
const buildTier = lane => (lane.kind === 'hard' ? TIER.buildHard : TIER.buildUI)
const fixTier   = (round, defect) => (round >= 2 || /math|money|auth|tenan|migrat/i.test(defect || '') ? TIER.fix2 : TIER.fix1)
// usage: agent(prompt, { ...buildTier(lane), label, phase, schema })
```

The planner's schema must add `kind` per lane, with the rule in its prompt: *hard* if the lane writes a migration, touches money/stock/quantity math, auth, tenancy or the ledger; otherwise *ui*.

## Prompt shapes (full text in `~/.claude/agents/{haiku-runner,sonnet-builder,opus-head}.md`)

- **Haiku**: numbered exact commands → expected result → output schema. "On anything different write `UNEXPECTED: <verbatim>` and stop." No goals, no background.
- **Sonnet**: outcome · files at file:line · binding ADRs · edge cases · specs that prove it · worktree/branch/base · return shape. "Read first, spec first, smallest change, revert once to prove, `FORK:` instead of guessing."
- **Opus**: founder's words · evidence paths · invariants · known forks · "branch the question, try to kill your leading answer, decide and record the call with rejected alternatives, brief the mechanical half for Sonnet."

## Lessons
- 2026-11-07: a Haiku count is only evidence alongside its exit code — briefs must say `cmd > f 2>&1; echo rc=$?`, never pipe the real command into grep -c.
- 2026-11-07: run the project tsc by path (`apps/web/node_modules/.bin/tsc`), never `npx tsc` — with no root node_modules link npx resolves a placeholder "tsc" that exits 1 with no TS errors.
- 2026-11-07: gateway tsc in a symlinked worktree fails with TS2307 '@simplewebauthn/server' (passkeys.service.ts) because the shared main-checkout node_modules lacks it. Briefs should say: that exact error is environmental; report it, filter it, and treat any other error as real.
