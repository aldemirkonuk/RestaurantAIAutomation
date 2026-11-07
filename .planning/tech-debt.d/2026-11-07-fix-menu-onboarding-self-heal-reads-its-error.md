## The onboarding threshold read still takes a failed read for "not configured" — OPEN — 2026-11-07

Filed by `fix/menu-onboarding-self-heal-reads-its-error` (menu upload Phase 1A, step 1g, gap M20).

**What is true.** This branch makes the menu self-heal in `getOnboardingProgress` (`apps/api-gateway/src/menus/menus.service.ts`) throw when its read of `restaurant_menus` fails. The read of `restaurants.threshold_configured` a few lines below still destructures only `data`, so a failed read returns `threshold_configured: false` and `activated: false`. Left out because step 1g covers the menu read only.

**What closes it.** That read checks `error` and throws, with a spec beside the self-heal specs in `menus.service.spec.ts`.

## Until step 1c lands, an owner's 0-line read marks the house uploaded but a later invitee reads "not uploaded" — OPEN — 2026-11-07

Filed with the entry above.

**What is true.** The self-heal now counts a version only when it is not archived and `lines_extracted > 0`. `markMenuUploaded` is still called after every read, including one that read no line (`importMenu`, step 7 comment). So after a 0-line read, everyone already on the house has `menu_uploaded = true`, while someone invited afterwards reads false.

**What closes it.** Step 1c of the same plan, which stops calling `markMenuUploaded` when no line was read.

## Active versions from before lines were counted still count without a line count — OPEN — 2026-11-07

Filed with the entries above.

**What is true.** `lines_extracted` was added by migration `20260922230700_a_house_keeps_every_menu_it_reads` with no backfill ("Writes no row"), so a version written before it has `lines_extracted` NULL. To avoid reading such a house as "not uploaded", the self-heal counts a NULL-count version while it is `active`, as before this branch. A NULL-count draft does not count. How many NULL-count versions production holds was not measured (this lane has no production read).

**What closes it.** A count of NULL-count versions on production. If it is zero, drop the second query in `houseHasAReadMenu`. If not, a backfill from `jsonb_array_length(extraction)` or from `menu_items`, in its own migration.
