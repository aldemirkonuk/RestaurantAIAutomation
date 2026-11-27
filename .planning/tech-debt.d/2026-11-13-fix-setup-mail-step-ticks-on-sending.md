# fix/setup-mail-step-ticks-on-sending (r36 onboarding gap 2, setup half, 2026-11-13)

The "Connect the house's Gmail" step says "Orders to vendors leave from the
house's own address." It ticked on any live Gmail grant for the house,
`gmail_read` included, and a reading grant sends nothing.

The setup read now also returns `next_steps.mailbox_sends`: a live
`gmail_send` grant held for this house, from the same grants read
(`mailbox_connected` is kept as it was). The step ticks on it. A web build
on an older gateway reads `mailbox_connected`, the one fact it has.

The session's call (2026-11-07 /goal): make the step tick on what it says,
and make the checklist promise no invoice by mail. Rejected: a step for
"invoices arrive by mail" (it needs a reading grant, the
`enable_house_inbox_read` switch that is off by default as a dark launch,
and a vendor address in the book; the switch is not the owner's to turn
from the checklist, so the step could never be finished there); reading
the flag and the book here only to grey the step (a larger read for a
sentence nobody can act on yet).

Left open:

- A vendor added on /house by name alone has no address, so no order can
  be mailed to it and no reply matched to it (the /house half of gap 2).
- Not seen in a browser.
