## The onboarding threshold read still takes a failed read for "not configured" — CLOSED 2026-11-11 by `fix/onboarding-progress-reads-the-house` (OB-1: every read in `getOnboardingProgress` throws on error) — 2026-11-07

Filed by `fix/menu-onboarding-self-heal-reads-its-error` (menu upload Phase 1A, step 1g, gap M20).

**What is true.** This branch makes the menu self-heal in `getOnboardingProgress` (`apps/api-gateway/src/menus/menus.service.ts`) throw when its read fails. The read of `restaurants.threshold_configured` a few lines below still destructures only `data`, so a failed read returns `threshold_configured: false` and `activated: false`. Left out because step 1g covers the menu read only.

**What closes it.** That read checks `error` and throws, with a spec beside the self-heal specs in `menus.service.spec.ts`.

## An owner and a later invitee can still disagree on "menu uploaded" — CLOSED 2026-11-11 by `fix/onboarding-progress-reads-the-house` (OB-1: the stored flag is no longer read; every person reads the house's lines at read time) — 2026-11-07

Filed with the entry above; rewritten in wave 3 (2026-11-07), when the self-heal moved from `lines_extracted` to the live lines in `menu_items`.

**What is true.** The self-heal now counts a version that is not archived and holds at least one `menu_items` row that is not discarded, whatever put it there (a read, a CSV, lines typed in review). The owner's own flag comes from a different place: `markMenuUploaded` runs once, at the end of `importMenu`, and is never undone. So:

- Until PR #793 (`fix/menu-empty-read-is-refused`) lands, a read with no line still marks everyone already on the house uploaded, while a later invitee reads "not uploaded" until a line exists. #793 refuses such a read before anything is written, which closes this route.
- A read whose every line is later discarded, or whose only version is archived, leaves the owner (and anyone healed earlier) at "uploaded" and a later invitee at "not uploaded".
- The healing write itself is permanent: an invitee healed while a draft held lines stays "uploaded" if that draft is later archived.

**What closes it.** Either derive `menu_uploaded` for everyone at read time from the same rule (stop storing it), or re-run the rule when a version is archived or its last line discarded. Either is a change to the onboarding model, not to this read.
