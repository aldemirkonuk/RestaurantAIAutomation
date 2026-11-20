# BUILD vocab r80 (2026-11-19): drink words + first-screen taste line

Walk t1 findings 2 and 3. All PRs DRAFT; plain commits and plain merges only (no rebase, no force-push).

## PRs
| PR | Branch | Base | Diff chars | What |
|---|---|---|---|---|
| #1938 | feat/taste-split-1920-c | #1928 branch | 11536 | gateway: per-kind flavour word lists, validated on write by the item's kind |
| #1939 | feat/taste-c-card-s5-kind-words | #1926 branch | 18114 | web: form offers the kind's words; card takes kind from house kind else library kind |
| #1940 | feat/taste-c-card-s6-summary | #1939 branch | 23679 | web: one-line taste summary on the drawer's first screen, opens the card |
Existing slices unchanged in net: #1924 22362, #1925 28829, #1926 6829 (all <= 30K).
My first attempt put the web words on #1924 (7cf5e30fa) and the kind pass-through on #1925 (248373b5f); #1924 went to 31567, so both were reverted by plain revert commits (8a94ec361 on #1924, 696b6f942 on #1925), merged up through #1926 (9297cce87, net-zero merge), and the change re-applied as the stacked slice #1939. The gateway change would also have taken #1928 to ~30K+, hence #1938.

## Decisions (rationale, rejected)
V1. Word lists per kind, own taxonomy mapped to published ones, no wheel artwork (SCA wheel is CC BY-NC-ND). wine/sake/cider: WSET SAT fruit families (citrus, green, stone, tropical, red, black, dried), floral, herbal, spice, oak, earthy, mineral, finish short/medium/long. spirit/whiskey/liqueur: orchard fruit, juniper, vanilla, caramel, oak, smoky, nutty + finish. beer: BJCP-style malt (bready, biscuity, caramel, toasty, roasty, chocolate), hops (citrus, piney, floral, herbal), yeast/finish (fruity, spicy, clean, tart, funky, dry finish). coffee/soft drink: SCA-family words (berry, citrus, stone fruit, floral, honey, caramel, nutty, cocoa, spice, roasted, smoky, vegetal, winey, clean). cocktail: WSET balance words (spirit-forward, boozy, balanced, sour/sweet/bitter-led, refreshing, strong, long-and-light) + aromas. Rejected: one big union list (a gin offered "creamy"; no signal); per-restaurant custom lists (a product call, later).
V2. Bitterness, body, alcohol warmth, astringency, carbonation, aroma strength and the 13 aroma families are ALREADY numeric axes in #1928, so no axis change; chips only carry what axes cannot (fruit family, finish length, malt/hop/yeast character, balance). Rejected: new axes for finish length (ordinal word, not an intensity) and IBU (a fact, stays out of sensory scores, D8).
V3. Gateway chooses the list from the subject: ledger kind via assertSubject (now returns the family), cocktail subject -> cocktail, dish -> food. An unknown or missing kind falls back to food words, never to none. A word outside the item's own list is refused with the existing sentence. Rejected: validating against the union (a food word on a wine would pass).
V4. The ledger has no coffee kind. non_alcoholic and soft_drink get the coffee/tea/soft list; "other" and food keep the twelve. Rejected: adding a ledger kind (migration, product call).
V5. Texture words stay one list on the gateway (any of the ten); drinks offer a short subset on the web (crisp, creamy, silky). Rejected: per-kind texture validation on the gateway (diff budget, no wrong answer to refuse).
V6. Web lists mirror the gateway's by hand (the web stack cannot import the gateway); a test on each side pins the exact ids, so drift shows as a failing diff on either side. Hyphenated stored ids show as words ("red fruit").
V7. Summary line: the sentence is the card's own (summaryLine; refactored into summaryParts, behavior unchanged). Marks = sources of the axes the sentence used; fallbacks "Described as ..." then "Sources disagree on ..." use the layers' sources; an unknown source has no mark. Nothing when no profile, while loading, when taste notes are off (the card says so), and for a supply. Failed read: "How it tastes could not be read just now." and the line still opens the card (Try again lives there) per ADR 0020. Band-only profile with no sentence shows nothing (a guess never leads, same rule as the card). No digits, no confidence figure (ADR 0104). Rejected: showing a skeleton while loading (would reserve a gap for goods that have no profile); a separate query key (two requests, two answers).
V8. Placement: directly above the "All the evidence" button, so what can shift when it appears is only the evidence bar and Used in. Tap opens the evidence (all) and scrolls the taste slot into view; aria-expanded/controls truthful. Rejected: under the head (shifts the eight cards); making it part of the TasteCard slot (the slot lives inside the evidence).
V9. Changed an existing test: "custom TasteCard slot: taste is never read" now asserts the card is not mounted, because the summary reads taste on its own.

## Tests
- gateway: `jest src/taste` 5 suites 62 pass; full `jest` 652 suites passed, 12042 tests passed (2 suites skipped); `tsc --noEmit -p tsconfig.json` clean (no TS2307 output).
- web: `vitest run src/pages/inventory` 37 files 782 pass before the last scroll test; next/ touched files 99 pass after; `tsc --noEmit` clean.
## Mutants (all killed)
gateway: family ignored (1 fail), good kind dropped (1), always wine list (3), beer->wine (2), unknown->wine (4), cocktail subject unmapped (1). web words: beer->wine, unknown->wine, drink texture=food, food word in beer list, label left as id, form ignores kind, house/library kind precedence swapped, kind not passed, kind dropped. summary: failed shown as nothing, thrown read as nothing, sentence-null shown, aria-expanded fixed, tap not opening evidence, line for supply, marks from all axes, scroll removed.
## Browser checks owed (no browser/stack run this lane)
1. Wine, beer, gin, coffee-ish good: Describe the taste shows its own chips; save succeeds; re-open reads as words. 2. Food still shows the twelve. 3. First-screen line: appears above "All the evidence", CLS on opening drawer for a good with and without a profile, 375 px wrap and 44 px tap, tap opens evidence and scrolls to the card. 4. #1938 deployed with #1939 (a wine saved with a food word is refused in a sentence on an older gateway: the 400 sentence shows, nothing saved).
## Not done
Dish and cocktail sheets (S5), export taste columns (S4), gateway per-kind texture validation, a real coffee ledger kind.
