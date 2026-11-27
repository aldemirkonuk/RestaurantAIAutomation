# fix/house-says-a-vendor-refusal-in-words (r32 onboarding, 2026-11-13)

/house printed the gateway's own `message` when a vendor was not added. A
validation refusal is an array of field notes, and a database refusal names a
constraint. It now says why from the status alone, with a link to Vendors:

- 400/422: the name could not be saved as it is.
- 409: already on your vendors.
- 401/403: an owner or a manager can.
- 5xx or a dropped connection: we could not tell whether it was saved, so
  look on Vendors first. A 5xx may have committed (`isUnconfirmedWrite`).
- Anything else: try again.

The block now says "vendor", as the sidebar, the setup checklist and /vendors
do. It used to say "supplier" ("Who supplies you?", "Add this supplier").

Left open:

- Not seen in a browser.
- The words "supplier" remain in variable names, which no one reads.
