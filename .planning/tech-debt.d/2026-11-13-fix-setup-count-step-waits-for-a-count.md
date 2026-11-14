# fix/setup-count-step-waits-for-a-count (r36 onboarding gap 1, 2026-11-13)

Making the first menu current puts every drink on the house's list at
stock 0 with no count (`restaurant_inventory.last_counted_at` null). The
"Count the first goods" step ticked on `goods_listed` (an active good), so
it ticked itself the moment the menu became current, and Learn & Help
dropped the steps over a cellar nobody had counted.

The setup read now also returns `next_steps.goods_counted`: an active,
undeleted good of this house with `last_counted_at` set. Only a count
stamps that column (a_count_is_a_record). The step ticks on it. When the
menu filled the list and nothing is counted, it says "Count the goods on
your list" and why. A web build on an older gateway (no `goods_counted`)
names the one fact it read, "Put your first goods on the list".

The session's call (2026-11-07 /goal): a new fact beside `goods_listed`,
not a changed meaning for `goods_listed`. Rejected: tightening
`goods_listed` itself (its name would then lie, and the web could not tell
an old gateway from a new one); ticking on stock above 0 (an invoice
received is its own step, and a count of 0 is a real count).

Left open:

- The desk (#1360 "no goods yet", KpiRow "In the cellar 0 · across N
  items", RailPanels "The cellar holds") still reads a listed good as
  known stock. The alert half is #781 with #814/#842.
- A kitchen-only house lands on a bottles-first /inventory (gap 9).
- Not seen in a browser.
