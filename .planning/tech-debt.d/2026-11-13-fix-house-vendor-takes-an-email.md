# fix/house-vendor-takes-an-email (r36 onboarding gaps 2 and 8, /house half, 2026-11-13)

/house asked for the first vendor by name ("A name is enough"). A vendor
with no address cannot be sent an order by mail, and the house's mailbox
reader bounds itself by the addresses in the vendor book, so no reply of
theirs is matched either. /house also called the first invoice "Later · not
required" while the setup checklist calls it the way to the house's costs.

- The vendor row takes an optional email beside the name and sends it with
  the vendor (`POST /providers` `email` → `providers.contact_email`, the
  column the book reads). An address that is not whole is said and nothing
  is sent. A vendor saved by name alone is told what an address would do,
  with the way to Vendors.
- The invoice row reads "Next · for your costs: Costs come from the
  invoices you check. Read your last one on Receipts."

The session's call (2026-11-07 /goal): ask for the address where the
vendor is first named, optional, so the name-only path stays one box.
Rejected: making the email required (a first vendor is often a phone
call, and setup must not stall on it); asking only on /vendors (the owner
leaves /house with a vendor that can receive nothing).

Left open: not seen in a browser.
