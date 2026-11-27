## The Food-up brief's caller owes these, and one fork is open — OPEN — 2026-11-07

Found by the ADR 0090 session audit of PR #769 (`packages/floor-core/src/meal-alert.ts`). `buildMealBrief` has no caller yet; these fall to the floor gateway and the screen that renders it.

1. **Open fork: may a waiter's `/floor/me` show the brief's figures?**
   - The brief's lines are minutes and counts: "Seated 38m ago", "Last visit 22m ago · overdue", "2 check-ins this party", "Party of 3 · 4-top".
   - ADR 0345 `:176` ("The waiter phone shows no figure") and `:204` (`/floor/me`: "No figure of any kind") rule against showing them.
   - ADR 0351 `:62` counts minutes as figures.
   - ADR 0352 `:33` keeps "the checker's brief lines" on signed-in screens without saying whose.
   - ADR 0345 `:62` narrows "figures" to scores, rankings and CSV, but only as a session gloss.
   - Nothing decides this. The PR that first renders the brief to a waiter must:
     - get an OD number from the guard and register the fork in `OPEN-DECISIONS.md`, or record a reading under OD-242 that survives an adversary pass;
     - until then, show a waiter only what the ADRs allow ("Food up", the table, the pass's note).
2. **Never wire `title`, `body` or `priority` into a push.** The Food-up push carries only the house, the table label and "Food up" (ADR 0352 `:33`), and the gateway composes it.
3. **Cap and validate the note before it is stored.** The package cleans and cuts what it is given; it does not refuse.
4. **Render `note` apart from the summary line.** A typed `”` in a note can fake an insight line inside `body`.
