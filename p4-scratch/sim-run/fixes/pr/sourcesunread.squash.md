/recommendations now names a refused insight read in sourcesUnread instead of reading as "nothing to recommend" (ADR 0292 fork 3).

**What was wrong.** ADR 0292 made analytics reads whole-or-refuse. Inside the insight bundle, a refused or failed read left its slice empty, but `generate()` still resolved. So the feed listed nothing in `sourcesUnread`, and the quiet tier said every source answered.

**What changed**
- **Gateway `insight-generator.service.ts`**
  - `loadBundle` names each of the seven bundle reads that rejected or answered with an error, the over-ceiling `WholeReadError` included. Each takes a house word from `BUNDLE_READ_WORDS`: pour history, order history, inventory list, till checks, table list, venue profile, goals.
  - `generate()` returns those names as `sourcesUnread`. A read that answered with no rows is not named.
  - Two insights are now gated on a second read through `readWasRefused`. Per-table insights do not fire without the table list. The wine mover does not fire without the inventory list.
  - `INSIGHT_GENERATOR_VERSION` goes from 6 to 10.
- **Gateway `recommendations.service.ts`** merges the generator's names into its own `sourcesUnread`, each name once. "insights" is still named when `generate()` itself rejects.
- **Web `RecommendationsNext.tsx`**
  - With a source unread, the voice says the book is not proven clear.
  - With `sourcesUnread` null, it makes no claim that the book is clear.
  - With `sourcesUnread` empty, the old words stand.
- **Records**
  - ADR 0292 gets "built" brackets and a review-trail row.
  - The 12:02:43Z answer stamp is corrected in place.
  - The tech-debt.d note is updated, and three static claims rows are added.

**Decided by.** The founder's answer was "Say it couldn't be read (Recommended)" (2026-10-07T12:02:43Z). Using the read's own word, not "insights", is the build's reading, recorded in the ADR row.

**Audit.** ADR 0090: PASS at 787eed9f9, then a delta PASS at f581912c4. The merge rule binds the next merge that touches `INSIGHT_GENERATOR_VERSION`: it must set the constant to 11 or more. Whichever of this PR and #626 merges second needs a semantic re-audit.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
