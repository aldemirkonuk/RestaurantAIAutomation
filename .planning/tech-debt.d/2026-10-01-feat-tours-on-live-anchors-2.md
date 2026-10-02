## Connections says everything in Register I belongs to the house, and its own rows name other owners — OPEN — 2026-10-01

Filed by `feat/tours-on-live-anchors-2` (PR #572), from PR #571's gate (comment 5944613717). Line numbers are at this branch's head.

**What.** Register I's description (`apps/web/src/pages/connections/next/ConnectionsNext.tsx:430-433`) says the attachments "belong to the house and survive the person who connected them". The rows under it say whose each one is, and several are not the house's:
- "Sender identity" reads "Mudavym's" (`ConnectionsNext.tsx:566`);
- "My calendar link" reads "yours alone — anyone holding the address can read it" (`ConnectionsNext.tsx:641`);
- "Public page for this house" reads "nobody's" (`ConnectionsNext.tsx:737`);
- a text sender row reads "nobody's" when the house has no sender (`ConnectionsNext.tsx:1505`, drawn at `:614` and `:619`);
- each model-context server reads "declared by" a person, or "declared by an account since deleted" (`ConnectionsNext.tsx:828-832`).

The rows that do read "the house's" are the till (`:454`), the payment provider (`:503`), the model-context servers' summary (`:771`) and a text sender the house has (`:1505`). The settings-services tour step on `section#attached` (`apps/web/src/guidance/content/settings-services.ts`) already says "each saying whose it is" and does not repeat the claim.

**Fix.** Say in the description that each row names whose it is, and keep "belongs to the house and survives the person" for the rows that read "the house's".
