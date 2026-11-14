# fix/setup-goes-on-past-the-menu (r30 onboarding, 2026-11-13)

The Get started panel now goes on past the menu to three next steps read
from the house (`next_steps` on GET /onboarding/progress): goods on the list,
the house's Gmail, the first invoice checked. They are not part of setup:
`completed_at` and `activated` are unchanged, so a house past setup is not
sent back into it. A read that fails, throws or rejects is `null` for that
step only.

Left open:

- **No till step.** /connections#till shows the point-of-sale bridge but has
  no way to connect one ("Ask Mudavym to stop the feed"). A step that leads
  there would be a dead end. It waits for a self-serve till connect (Floor
  Checker port, feat/floor-gw2-*).
- **The steps show only while setup is open.** Once the menu is current and
  a vendor and an invite exist, "Get started" gives way to Learn & Help and
  the next steps are not shown there (Learn & Help is also what staff see,
  and staff cannot check invoices). The desk's empty-house panel (#1360)
  still leads to the first count.
- **Gmail only.** Outlook, iCloud and an @mudavym.com address are "Not yet"
  on /communications, so the mailbox step names Gmail.
- Not seen in a browser.
