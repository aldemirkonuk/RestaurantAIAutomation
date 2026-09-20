# 0180 — House mail is a typed composition grammar (amends 0173 D2)

- **Status:** Locked (founder, 2026-09-20). It amends the Locked [[0173-communications-is-a-catalogue-with-slot-editing]] decision 2 in the open (CLAUDE.md §5); 0173's own text is not rewritten. Catalogue-first (0173 D1), owner/manager editors (D4), destination-only buttons (D5), and escaping (D6) stand. Nothing is built.
- **Date:** 2026-09-20
- **Decider:** Aldemir (founder). Decisions are locked by the founder, never by an agent.
- **Keywords:** email, templates, composition grammar, atoms, combinators, charts, analytics, recommendations, goals, paper sheet, 0173 D2, drag-and-drop, palette
- **Links:** **Amends** [[0173-communications-is-a-catalogue-with-slot-editing]] decision 2 (slot-only words). [[0170-a-vendor-email-body-is-text-never-markup]] (vendor letters stay text). [[0174-email-is-a-paper-sheet-and-the-house-signs-it]]. [[0020-no-fabricated-answers]]. Brief: [`../07-reference/ENDPOINT-UNIVERSE-PLAN.md`](../07-reference/ENDPOINT-UNIVERSE-PLAN.md).

## Context

ADR 0173 D2 locked editing as **slots**: every word a reader reads is editable; numbers, tables, layout, footer stay Mudavym's. The house never edits HTML. That was the reading of "fully editable" the 2026-09-19 research could defend.

On 2026-09-20 the founder rejected both a 20-block palette and a drag-and-drop page builder, and named the end state: full freedom and flexibility; analytics, buttons, dropdowns; a mail that documents, presents, and shows analytics with depth — technical figures to charts to graphs to recommendations to goals; **not** drag-and-drop; more free than a palette — add everything, and combinations (a dynamic puzzle) shape more complex charts and emails.

0173 D2 cannot deliver that. Slot text cannot make a chart. A palette of 20 blocks cannot make a new combination. Raw HTML reopens the injection path 0170 closed.

## Options considered

1. **Keep 0173 D2 (slots only).** Safe. **Rejected by the founder:** it cannot carry graphics, analysis, or recommendations as first-class pieces.
2. **A closed palette of ~20 blocks** (KPI, table, rec card, week recap, …). What the first draft of the brief proposed. **Rejected by the founder:** a palette is a ceiling.
3. **Drag-and-drop page builder (Shopify / Bee / Stripo).** Maximum apparent freedom. **Rejected by the founder:** "not drag and drop". Also: a free canvas is how a house breaks dark mode, Outlook, and the paper sheet (0174), and how a URL becomes a button.
4. **Raw HTML / a template language per house.** **Rejected** in 0173 option 2; still rejected. Free markup is not the same as free composition.
5. **Typed composition grammar.** Atoms with data contracts; combinators that make charts and cards from combinations. Chosen.

## Decision

**House mail (PAR, recaps, reminders, reports, the briefing) is edited as a typed composition grammar. Vendor letters stay text (0170).**

1. **Atoms**, each with a data contract, a freshness line, and empty behaviour *hide, never invent* (0020): a figure (named metric), a series, a set (vendors, items, weeks), a goal, a recommendation, a destination (Mudavym page only), a slot of house words, the house mark.
2. **Combinators**: overlay, stack, compare, filter, window, group. Two series + compare → a chart. A figure + a goal → a meter. A recommendation + a destination → a Review card. The puzzle is the combinators, not the pixels.
3. **The editor** is a sentence the house assembles (slash or picker), with a live preview of the house's real data. Dropdowns bind to house data (this vendor, this week, this goal), never to a free URL.
4. **Buttons stay 0173 D5:** Mudavym destinations, the label says "review" never "approve", never a GET-mutation.
5. **v1 still HTML/CSS** on the paper sheet (0174; Outlook; Gmail 102KB). A combinator that needs a PNG waits on a Gmail/Outlook spike. Depth of understanding is the grammar and the data, not a raster.
6. **Unchanged from 0173:** catalogue first (D1). Owner and manager edit (D4). Data is escaped (D6). Account mail is view-only (0174). Staff never receive money/sales/staff figures; vendors receive text only; the house cannot override that.

This is not "full HTML". Raw markup and free URLs stay refused.

## Consequences

- **Easier.** Combinations can grow a briefing without adding a new block type for every chart.
- **Harder.** The registry must type atoms and combinators, refuse an unbound series, and hide empty data. Slot-only 0173 mock 1d is no longer the editing destination.
- **Revisit when** a combinator cannot render in HTML/CSS (the PNG spike), or a house asks to paste markup.

## Open

Not decided here, and not added to `OPEN-DECISIONS.md`.

- 0173's remaining forks (drift policy, TR/EN keys, SMS daily summary, a second primary button, renderer).
- The atom/combinator catalogue itself (which figures exist on day one). Named at build time, not invented here.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-20 | Aldemir (founder) | Not a palette, not drag-and-drop; compositional, combinations shape charts and mail |
| 2026-09-20 | Cursor Grok 4.6 | Recorded as an amendment of 0173 D2; 0173 body not rewritten |
