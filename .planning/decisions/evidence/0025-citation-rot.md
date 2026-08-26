# Evidence for [ADR 0025](../0025-citations-must-disagree-loudly.md)

Every number in the ADR, with the command that produced it. Measured 2026-08-26 in a
worktree at `origin/main` = `5ca9ce70`. Per `CLAUDE.md` §5b these are **re-measured,
never copied forward** — three figures from earlier passes did not reproduce and were
replaced (noted in §6).

---

## 1. The guard is blind in one direction

`scripts/check_decision_claims.sh:149`, verbatim:

```bash
if bash -c "$verify" >/dev/null 2>&1; then holds="yes"; else holds="no"; fi
```

With the semantics documented at `:152-153` — `open` → the claim must **not** hold —
any non-zero exit counts as passing.

**`.env.example` has never existed in this repo:**

```
$ git rev-list --all --objects -- .env.example | wc -l
0
$ ls env.example
env.example
```

`CLAIMS.jsonl:25` (OD-78, `status: open`) is
`grep -qE '^[[:space:]]*GMAIL_PUBSUB_(AUDIENCE|REQUIRE_AUTH)=' .env.example 2>/dev/null`
→ exit 2, counted as holding.

**The negation trap, on a security claim.** `CLAIMS.jsonl:38` asserts invite
redemption is not studio-role gated:

```
$ bash -c "! grep -A 3 'def redeem_invite' services/agent-orchestrator/api/DELETED_FILE.py | grep -q 'require_studio_role'"
grep: services/agent-orchestrator/api/DELETED_FILE.py: No such file or directory
$ echo $?
0
```

Exit 0 — "the claim still holds" — against a file that is not there.

## 2. What strict mode would cost

Two passes. Classifying by stderr finds nothing, because the broken claim muzzles
itself; stripping `2>/dev/null` first finds it:

```python
for r in claims:                                    # 68 claims, comments excluded
    v = r['verify'].replace('2>/dev/null', '')      # strip the claim's own muzzle
    p = subprocess.run(['bash','-c',v], capture_output=True, text=True)
    if re.search(r'No such file|command not found|cannot open', p.stderr, re.I):
        print(r['id'], p.returncode, p.stderr.splitlines()[0])
```

```
without stripping : COULD NOT RUN 0 of 68
with stripping    : COULD NOT RUN 1 of 68
   OD-78  open  exit=2  grep: .env.example: No such file or directory
self-silencing claims: 2 of 68  (OD-78 open, OD-93 resolved)
```

**So strict mode costs exactly one build failure** — and it must strip or forbid
claim-level stderr suppression, or it certifies the very claim it exists to catch.

## 3. The pairing check — 0 of 23

This is the whole checker. It produced the ADR's headline figure:

```python
reg = open('.planning/decisions/OPEN-DECISIONS.md').read().splitlines()
def id_at(n):
    m = re.match(r'\|\s*(OD-\d+)\s*\|', reg[n-1]) if 1 <= n <= len(reg) else None
    return m.group(1) if m else None
# for each "OD-NN ... OPEN-DECISIONS.md:L1,L2" citation, does any Lk name OD-NN?
```

```
OPEN-DECISIONS.md:N citations: 74   id-paired: 23   agreeing: 0
register length: 128 lines
```

**Zero.** Not one line anchor into the register agrees with the id beside it. The
register is 128 lines, so this is not a locating problem — the anchors are simply
never re-read. This same command is the proposed CI check.

## 4. Blast radius of a single commit

`39abb348` inserted the OD-83 `/receiving` command into
`apps/web/src/components/command/commands.ts`, shifting the "375" strings:

```
$ grep -n "375" apps/web/src/components/command/commands.ts
84:  { id: "nav-catalog", ...
105:  { id: "insight-browse", title: "Browse all 375 insight types", ...
$ grep -rhoE 'commands\.ts:[0-9]+(,[0-9]+)*' .planning/ | sort | uniq -c | sort -rn
  11 commands.ts:99
   9 commands.ts:78,99
   ...
```

20 of 27 point at `:78,99` or `:99`; both are now wrong. One decision's fix silently
broke another decision's citations, and they are still broken at HEAD.

## 5. Churn — the most-cited file is the most-rewritten

```
$ grep -rhoE 'OPEN-DECISIONS\.md:[0-9]+' .planning/ | wc -l          → 74
$ git log --oneline --since="2026-08-01" -- .planning/decisions/OPEN-DECISIONS.md | wc -l   → 57
$ git log --oneline --since="2026-08-01" | wc -l                     → 255
```

22% of all repo commits touch it. Any line anchor into it is doomed by construction.

## 6. Archive duplication (ADR §7)

```
469 of 522 files in .planning/archive/ are byte-identical to a live file  (89.8%)
6.4 MB of the 6.9 MB archive
```

md5 of every file under `.planning/` excluding `archive/`, compared against every file
under `archive/`. Retire-to-write has been satisfied by copying, not retiring.

## 7. Numbers that did NOT reproduce

Recorded because §5b says a number nobody re-checks is the failure mode itself:

- **"0 of 34 `ENDPOINTS.md` row citations land"** — not reproducible.
  `.planning/foundation/ENDPOINTS.md` has 8 unique source locators and `main.ts:77`
  resolves exactly to `app.setGlobalPrefix("api/v1")`. **Discarded.**
- **Doc→doc drift "73.2%"** vs a later pass's 21.8% — the two passes measured
  different populations. Neither is cited in the ADR; the 0-of-23 pairing figure is
  used instead because it is exact rather than sampled.
- **"20 of 27" vs "42 of 42" `commands.ts` anchors** — extraction differs (ranges and
  bare forms). The ADR states the direction, not the disputed count.
- My own first quantification of unrunnable claims said **2 of 9 open claims**. Wrong:
  OD-72's `src/lib/supabase.ts` sits inside a `grep -v` filter, not as a file operand,
  and `apps/web/src/lib/supabase.ts` exists. The true figure is **1**. The regex that
  produced the error is the same technique the ADR rejects for enforcement.
