### The unlinked-invoice fork: the coordinator decided it (2026-10-07)

The coordinator decided this under the founder's 2026-10-07T20:04:10Z delegation. It is not the founder's pick. The decision is (a): when an invoice is filed but not linked to its order (and not paired with the order's line), the door row keeps counting beside it, and the ledger gets no matching heuristic. No SQL changed. ADR 0301 (Consequences, *Harder / given up*, *An invoice filed but not linked*) records the delegation verbatim, the five amendments, the rejected options (b), (c) and (d), and what was not verified.

New commits on top of `a78a2adfb` (not pushed):

- `9ed923f43` fix(cellar): say "door-checked + invoiced" on a Paid that adds both books. This is amendment 1. When a row's Paid adds invoice lines and a door check (`bought.lines > 0` and `bought.doorChecked > 0`), the Paid cell (`cellFor`) now reads 'door-checked + invoiced'. Its note says that if one of those invoices is for the same delivery as a door-checked order, that delivery is counted twice until the invoice is linked to the order or its line is paired with the order's line. A door-only Paid keeps 'door-checked', and so do First bought and the record's stand. The Paid column's meaning gets one sentence about the new mark. A new vitest case covers both rows. It fails when the cell passes nothing and when it always passes true. Web vitest for `cellar/next`: 304 passed.
- `38b103966` docs(adr-0301): record the coordinator's decision on the unlinked-invoice fork. The decision record replaces the open-fork line, which was never pushed. The ADR's existing bracket style is used to bracket three things in place:
  - §2's "No filed invoice speaks for it" (only a linked or paired invoice does)
  - the web register's marks
  - the ways an invoice gets linked (a third way: an invoice that arrives by email is linked as `'manual'` to the order its conversation names)
  
  The change also adds a Review trail row. The README index is not touched.

Not in this PR: amendments 2-5. W42 (a person picks the delivery) is to be built later. Lanes `mailguess` (the email fallback that guesses an order) and `linepair` (the pairing route does not check that the order line is the house's) belong on their own branches (I did not check whether those branches exist yet). W43 is cited only.
