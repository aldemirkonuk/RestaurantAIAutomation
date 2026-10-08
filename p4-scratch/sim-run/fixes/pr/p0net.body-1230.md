> **[2026-10-07 12:30Z, coordinator, push]** Pushed head **`f18ade8c3`**: the audited PASS head `e1d985b98` (comment 6037805143) plus one clean merge of origin/main `5e6c0684e` (#620). At this head the branch is 2 files, the fast guards all exit 0, gate ownership is `[]`, and decision claims hold 918/918 (Python 3.11). A delta re-audit is owed before merge. Owed later, not blocking: the row's named gaps should also list bracketed writes to `obs`, alias writes to `c`, `++`/`--` and decoy literals.

> **[2026-10-07 04:30Z, coordinator, after the BLOCK at `c7f7faa6f`]** Pushed head **`e1d985b98`**. The audit at `c7f7faa6f` blocked on prose, not on the verify, and every fix it named is now in:
> - `c8fa7c559` rewords the claim row. "no c.<field> = assignment" becomes "no **plain** c.<field> = assignment", because the regex matches only a plain `=`. The row now closes by saying the check is a text check, not a proof, and that its list of gaps is not exhaustive. It names the gaps the audit found: bracketed, cast or `Object.assign` writes to `c`, compound assignments (`*=`, `&&=`), and length changes or method calls on `obs.*` or `checks`. The verify is byte-for-byte unchanged.
> - This body now says the claim prose "names what the verify checks and the gaps found so far", not that it "says exactly what it checks and what it does not". The squash sentence now reads: the merge must pass the PR body with `--body`, because the default squash body would include that title.
> - `e1d985b98` merges origin/main `42fe1252b` (#622, #651). The merge was clean (`git merge-tree` exit 0).
>
> At this head:
> - The branch is 2 files against origin/main.
> - The fast guards all exit 0, and gate ownership is `[]`.
> - Decision claims PASS, 912 of 912 holding, run with Python 3.11.
> - `tables-learned-from-the-pos.spec.ts` passes 28 of 28.
>
> The BLOCK at `c7f7faa6f` stands until a fresh audit of this head.

> **[2026-10-06 ~05:15Z, coordinator, after the BLOCK at `69d0cf1fe`]** The audit blocked this PR on the sentence "accepts the gross push or the net push and nothing else": a push wrapped in `if (!c.voided_at)` (M1) and an `if (c.retired_at) continue;` before the push (M2) both passed that verify. The verify is now tightened so both fail, the claim prose now names what the verify checks and the gaps found so far, and the 2026-10-05 sentence that made the same broad claim is corrected in place. Evidence is the 32-case table below; the six-row table further down was the old verify's and is kept as it was. The fix is commit `c7f7faa6f`. Its title says "fail on any added guard", which is broader than the check: the check fails on the 30 mutations listed, and a guard added inside a helper it does not read would pass. The merge must pass the PR body with `--body`; the default squash body would include that title.

**What this is.** A two-file precursor to #615 (ADR 0295, owner sales read net sales). It changes no product code and is inert on main.

**Why it exists.** #621 (ADR 0303) merged while #615 was in rework. Re-heading #615 onto it breaks two things #621 added:
- Three tests in `tables-learned-from-the-pos.spec.ts`. Their check fixture carries no `subtotal`, so on the net basis every check reads "not stated".
- The claim `ADR-0303-THE-WAITER-CONTROL-KEEPS-HIDDEN-TABLES`. Its verify pins the gross push line (`obs.y.push(c.total || 0)`) verbatim.

Fixing both inside #615 makes it 17 files, over the 15-file cap. So they land first, here.

**What changed**
1. `tables-learned-from-the-pos.spec.ts`: the `check()` fixture now states `subtotal`, which follows the test's `total` unless a test sets it. Every reading on main is unchanged: this spec and the table-analytics specs pass 35/35.
2. `claims.d/feat-tables-learned-from-the-pos.jsonl`, that one row:
   - ~~The verify accepts either the gross push (main) or the net push (#615: `const net = tallySale(a, c);` and `if (c.table_id && net !== null) { … }`), and nothing else.~~ [2026-10-06 ~05:15Z: wrong, M1 and M2 passed it. What the verify now requires is listed under **The tightened verify**.]
   - The claim prose is bracketed in place (dated 2026-10-06), saying what each basis keeps. On the net basis, a check with no stated subtotal leaves the whole fit, not only the table control. Hidden tables stay in the control on either basis, which is the founder's 2026-10-05 pick "Keep them in the control (Recommended)".

**Evidence at `69d0cf1fe`** (the first verify, run against a scratch copy of `table-analytics.service.ts`, restored after; superseded by the table below)

| Source | Exit |
|---|---|
| main (gross) | 0 |
| #615 head `ebfccc6e1` (net) | 0 |
| gross push with an extra guard (`&& c.covers`) | 1 |
| gross push of `c.subtotal` | 1 |
| a `hidden_at` mention in `getWaiterPerformance` | 1 |
| net push with an extra guard | 1 |

**The tightened verify** (second commit). It reads `getWaiterPerformance`'s body with `//` comments stripped and requires all of these:
- no `hidden` in it;
- `checks` taken from `loadChecks(restaurantId, sinceDays)` and not named again before the loop, other than as a `checks:` type field;
- a loop whose only skip is `if (!server) continue;`, with no `return`, `break`, `throw` or `delete` in it and no plain `c.<field> =` assignment;
- the loop ending in `byWaiter.set(server, a);` followed straight by the table push, in the gross form (`if (c.table_id)`, pushing `c.total || 0`) or the net form (`if (c.table_id && net !== null)`, pushing `net` from a single `const net = tallySale(a, c)` and no other `net =` in the loop);
- exactly one push each to `obs.y`, `obs.waiter` and `obs.table`, no `obs.<field> =` assignment, and the fit given `y: obs.y, target: obs.waiter, controls: [obs.table]`;
- the spec test `fits the table control over the checks at a hidden table too` still present.

It does not read `loadChecks`, `tallySale`, `netSalesOf` or `newSalesTally`, so a guard added inside one of those helpers would pass it. It does not treat `/* */` comments as comments. It is a text check, not a proof, and this list of what it misses is not exhaustive: it also passes a bracketed, cast or `Object.assign` write to `c`, a compound assignment to a field of `c` (such as `*=` or `&&=`), and a length change or method call on `obs.*` or `checks`.

**Evidence for the tightened verify.** Each case was run in a temp tree holding only the mutated service file and the spec. The mutations are applied inside `getWaiterPerformance` only.

| Case | Want | Got |
|---|---|---|
| gross (main) as written | 0 | 0 |
| net (#615 head `ebfccc6e1`) as written | 0 | 0 |
| M1: push wrapped in `if (!c.voided_at)`, gross / net | 1 / 1 | 1 / 1 |
| M2: `if (c.retired_at) continue;` before the push, gross / net | 1 / 1 | 1 / 1 |
| `continue` added at the loop head, gross / net | 1 / 1 | 1 / 1 |
| waiter guard widened to `!server \|\| c.retired_at`, gross / net | 1 / 1 | 1 / 1 |
| extra condition in the push guard, gross / net | 1 / 1 | 1 / 1 |
| `hidden_at` filter on the loop, gross / net | 1 / 1 | 1 / 1 |
| `checks` filtered at load, gross / net | 1 / 1 | 1 / 1 |
| `checks.splice` before the loop, gross / net | 1 / 1 | 1 / 1 |
| `c.table_id = null` in the loop, gross / net | 1 / 1 | 1 / 1 |
| a second `obs.y.push`, gross / net | 1 / 1 | 1 / 1 |
| `obs.y` reassigned after the loop, gross / net | 1 / 1 | 1 / 1 |
| the push and `byWaiter.set` both wrapped in a guard, gross / net | 1 / 1 | 1 / 1 |
| `return` inside the loop, gross / net | 1 / 1 | 1 / 1 |
| gross push of `c.subtotal` | 1 | 1 |
| net forced to `null` for some checks | 1 | 1 |
| `net` reassigned in the loop | 1 | 1 |
| spec test renamed | 1 | 1 |

32 cases, none wrong. The same harness run on main's 2026-10-05 verify lets M1, M2 and ten other mutations through on the gross form (counting the spec rename). Run on the `69d0cf1fe` verify, it lets 23 through across both forms (counting the spec rename). That is the basis for the in-place correction of the 2026-10-05 sentence.

Also (at both commits): `check_decision_claims.sh` PASS. Migration order, OD ids, conflict markers and citation pairing all 0. Ownership `[]`.

**Not covered**
- This PR does not run #615's code. Lane netsales ran the trial re-head with this fixture applied: specs 108/108 and web 95/95. #615 re-heads onto this, and its own audit covers the combination.
- #609 (cap) is due to merge before #615, so #615 will re-head once more.
- No SQL, so no local Postgres run.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

