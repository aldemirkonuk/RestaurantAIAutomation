# 0362 — A good nobody has counted reads "not counted yet", not low

- **Status:** Locked (session call under the founder's 2026-11-07 /goal delegation; the founder may supersede)
- **Date:** 2026-11-11
- **Decider:** Session call under the founder's 2026-11-07 /goal, which delegated every call. Resolves OD-161.
- **Keywords:** low stock, never counted, last_counted_at, v_low_stock_items, unknown not zero, not counted yet
- **Links:** OD-161, PR #929 (view widened to every good), PR #1003 (readers), ADR 0129 (strict `<` par), ADR 0020 (a failed read says so)

## Context

`restaurant_inventory.stock_live` defaults to 0 and `threshold_min` to 3, so a good the house has never counted sits below its par by default and read as low, `critical` at 0. After #929 the view holds every good, so the noise grows with the catalogue. `last_counted_at` exists and is null until a count; #929's view already returns it.

## Options considered

1. **Readers treat a null `last_counted_at` as "not counted yet".** No migration; each reader says what it knows. Costs: every reader must remember the rule (a CLAIMS grep guards the four known ones).
2. **View predicate `AND last_counted_at IS NOT NULL`.** One place. Rejected: it also hides the row from `inventory.service`'s view-vs-`classifyStock` agreement check and from the Below par chip that PR #1000 (on #894) reworks, and it makes the row vanish instead of saying it is unknown.
3. Do nothing: a critical alert per uncounted good.

## Decision

Option 1. A row whose `last_counted_at` is null is unknown, not zero:

- the alert engine does not alert on it (`mapRow` drops it);
- the dashboard alert feed shows an info line "not counted yet", and the summary low-stock count skips it;
- the rail's Running low says "not counted yet" and ranks it after counted goods;
- **par-0 case:** an uncounted good at stock 0 that is not in the low list (par 0) raises no "Out of stock" alert; it is silent, not "not counted yet". Saying "not counted yet" for every uncounted par-0 good would list the whole catalogue.

An absent column (an older view) is not null, so older reads keep their behaviour.

## Consequences

- A house that uploads a menu gets no critical alert per uncounted good.
- A good sold down without ever being counted never alerts until someone counts it. Revisit if houses report missed stock-outs on never-counted goods.
- The inventory page's own count and chip still follow `classifyStock`; aligning them is PR #1000's lane.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-11-11 | session | Created with PR #1003's follow-up |
