---
type: agenda-full
division: platform
department: engineering
team: inventory-ledger
status: provisional
metrics: [inventory.projection_divergence_rows, inventory.direct_write_paths, inventory.ledger_v1_callers]
updated: 2026-08-24
links: ["[[inventory-ledger-charter]]", "[[inventory-ledger-premortem]]", "[[inventory-ledger-agenda-board]]", "[[inventory-ledger-loops]]", "[[engineering-agenda-full]]", "[[INVENTORY_SOTA_PLAN]]", "[[integration-engineering-charter]]", "[[messaging-delivery-charter]]"]
---

# Inventory & Ledger — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

## What

Make the invariant **measurable** before making it stronger. Four deliverables, in order:

1. **The daily divergence sampler.** One query: rows where `stock_live` ≠ sum of lots.
   The charter specifies "sampled daily"; nothing in evidence does it.
2. **Guard coverage extended past TypeScript.** `scripts/check_no_direct_stock_writes.sh`
   cannot see Postgres function bodies or dynamically-constructed table names, and says so
   at `:10`.
3. **Ledger v1 caller census with a removal date.**
   `apps/api-gateway/src/inventory-ledger/LEDGER_V1_DEPRECATED.md` is a document; the
   deliverable is a falling number.
4. **End-to-end idempotency keyed on the originating event**, not minted per hop.

`.planning/07-reference/INVENTORY_SOTA_PLAN.md` already carries the architecture — three gated phases
and thirteen locked decisions. This agenda is not a competing plan; it is the measurement
scaffolding that plan needs in order to be verifiable.

## How

**Cheapest possible sampler first.** Premortem M2 says the sophisticated reconciliation
tool that ships in six weeks is worse than the crude query that ships tomorrow, because
the metric has never been read. One number, one row, on the board. Enrich it later.

**Outcome beside syntax, always.** The grep guard stays and is never the only thing
([[engineering-loops]] L-ENG-3). The alarm state this team watches for is not a red guard
— it is **green guard plus non-zero divergence**, which is the exact shape of the original
receiving-service bug.

**Any non-zero is P1.** Not "investigate when convenient". The charter's justification is
that divergence is undetectable from the UI, so severity cannot be inferred from user
reports — there will not be any.

**Seams named up front.** Idempotency crosses to [[integration-engineering-charter]] (POS
webhooks) and [[messaging-delivery-charter]] (the RabbitMQ bridge). This team is left of
the seam for stock and therefore accountable for the decision; they are accountable for
the objection ([[engineering-directive]]).

## Why now

- The root cause is **already diagnosed and written down** — dual bookkeeping,
  lots-as-source-of-truth, three gated phases. The unusual position here is that the
  design is ahead of the instrumentation, which is the reverse of the normal risk.
- `apply_stock_movement` has already been extended and hardened for races and pour
  idempotency (`supabase/migrations/20260805130000_*`, `…20260805131000_*`). The
  foundation is laid; what is missing is the ability to prove it holds.
- Ledger v1 is deprecated *now*. Every week it stays callable, the caller census gets
  harder to drive to zero and premortem M3 gets more likely.

## Next steps

- [ ] Ship the daily divergence sampler — one query, one number (premortem M2)
- [ ] Publish the first `inventory.projection_divergence_rows` reading, whatever it says
- [ ] Extend the direct-write guard to `supabase/migrations/**` function bodies (M1)
- [ ] Count distinct ledger v1 callers; set a removal date (M3)
- [ ] Add originating-event id to movement records so cross-hop duplicates are visible (M4)
- [ ] Assert every count adjustment has a corresponding movement row (M5)
- [ ] Agree idempotency-key derivation with [[integration-engineering-charter]] and
      [[messaging-delivery-charter]] — one seam decision, one close-time
- [ ] Cross-check `.planning/07-reference/INVENTORY_ADD_REMOVE_SCENARIOS.md` against the sampler's
      definition of divergence, so the scenarios and the metric agree

## Questions for the founder

1. **Is any non-zero divergence really P1?** The charter says yes. At current data volumes
   that could mean a P1 on day one of sampling. Is the first reading exempt as a baseline,
   or does the team treat the existing state as an incident?
2. **Removal date for ledger v1.** A deprecation without one produces premortem M3. What
   is an acceptable date, and who owns the callers that must migrate?
3. **Idempotency ownership.** Deriving keys from the originating external event id is the
   only design that closes M4, but it makes stock correctness depend on a third party's
   event id being stable. Accept that coupling, or accept M4?
4. **Count adjustments as movements — no carve-out?** Reconciliation is the most tempting
   place to permit a direct write. Confirm there is no exception, including for bulk
   opening counts.
5. **Does this team or [[schema-migrations-charter]] own `apply_stock_movement`'s DDL?**
   The charter says we specify and they author. Confirm — the function is the invariant,
   and split authorship of an invariant is worth checking explicitly.
