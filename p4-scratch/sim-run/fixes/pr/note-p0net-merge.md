> **[2026-10-07 14:45Z, coordinator, at merge] Merging head `7fb476a37`.** The ADR 0090 delta re-audit PASSED at this head: plan READY, both reviews APPROVE WITH NOTES, final HOLDS (comment 6039775830). The branch adds nothing since the PASS at `f18ade8c3`; the head only merges main `b270a45b8` (#609), clean. Required CI is green and the branch is up to date with main.
>
> **Carried from the audit (none blocks this merge):**
> - The 32-case mutation table below was run before #609. At this head only 3 of the 32 cases were re-run.
> - The spec's check stub ignores the selected columns. So this spec could pass even if #615 never selects `subtotal`. A projection assertion is owed to #615's audit.
> - Under the system Python 3.9 the claims guard falsely reports 920/921. Under Python 3.11 it holds 921/921.
