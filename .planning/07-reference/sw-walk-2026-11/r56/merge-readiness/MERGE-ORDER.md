# Merge order for the open PR trains from #1679 up (r56 merge-order, 2026-11-18)

Extends r37's `MERGE-ORDER.md` (which holds the meet branches and the older trains) and r32's. Nothing here was merged, retargeted, closed or marked ready. Raw data in this folder: `prs.json` (open PRs, CI), `files.txt`, `trains.json`, `trains-table.md`, `tipconf2.json` and `tipconf3.json` (pairwise `git merge-tree` of every chain tip).

## Founder summary

- **Measured:** GitHub `main` is still `c459b0a12` (the #921 merge of 2026-11-07). 130 open PRs sit at #1679 and up (#1679-#1808), all DRAFT and all MERGEABLE. They form 39 trains. Most stack on older open PRs (below #1679), so those older trains in r37's order still have to land first.
- **The first thing to land is #1797, not any of these.** `ubuntu-latest` became Ubuntu 26.04 and Playwright cannot install Chromium there, so `Test E2E` fails on every PR based on main and `CI Complete`, the required check, fails with it. Nothing based on main can go green until #1797 is on main. The 11 main-based PRs showing red (#1683 #1746 #1747 #1759 #1760 #1766 #1781 #1782 #1783 #1785 #1786) are red for this reason (plus #1760's typecheck, #1781's baseline guard, below). Stacked PRs show no CI because CI runs only for PRs aimed at main.
- **Two more reds had real causes, now with fix PRs:** #1760 (Lint TypeScript: its spec fixture lacks the two new status fields) fixed by #1805; #1781 ("A failed read is never reported as an empty one": the baseline row for the read it fixed was not lowered) fixed by #1807. Each fix PR is stacked on the PR it repairs and must land with it.
- **PR Audit Gate is red on every PR:** the gate key is out of credit (known), so it is excluded from the CI column below.

## 1. Decisions (every fork was my call, per the standing /goal)

1. **#1731's stack lands before #1725's stack.** The two share no PR and no file at PR level; the conflict is between whole stacks (#1731 sits on #1718-#1710-#1705-#1586-#1541-#1496-#1488-#1471-#1382, #1770/#1725 on #1715-#1698-#1670-#1616-#1605-#1595-#1567-#1558-#1464-#1439-#1438). Merging the tips gives conflicts in 16 files (3 hunks in `ReportsNext.tsx`, 2 in `rp-format.ts`, plus `analytics.service.ts`, `advanced-analytics.service.ts`, `order-schema-drift.spec.ts`, `report-export-cuttings.ts`, `rp-registers-{bench,goals,house,trade}.tsx`, `rp-spec.ts`, `useReportsNextData.ts` and their tests). Why #1731 first: it carries money and privacy correctness (a failed goal read is refused, not summed to zero; staff are sent a goal, never its money or till figure; percent goals kept as a share), and r37's order already puts #1382-#1498 (step 51) and #1541 (step 52) ahead of #1567's train (step 107). Rejected: #1725's stack first, because its changes are loading, outline and layout polish that read the data shape the goals stack changes, so re-basing the goals stack on them would redo correctness work around cosmetics.
   - **What the second stack (#1770, with #1725, #1715, #1698, #1713) must change after #1731's stack is on main:** merge main into its branch (a merge commit, never a rebase) and resolve as follows. In the four gateway files (`analytics.service.ts`, `advanced-analytics.service.ts`, `order-schema-drift.spec.ts`, `report-export-cuttings.ts`) take main's side whole, then re-apply only that stack's own hunks (till-window parameters). In `ReportsNext.tsx`, `rp-format.ts`, `rp-spec.ts`, `rp-registers-*.tsx`, `useReportsNextData.ts` keep both sides: the goals stack's unit and refusal wording stays, the loading-not-refused role state and the cold-load outline slots are re-applied on top. Re-run `rp-*.test.tsx`, `ReportsNext.test.tsx`, `useReportsNextData.test.tsx` and the gateway reports and analytics suites. Browser check owed after: `/reports` cold load at 375px and desktop, a goal with a failed read, a staff login.
   - The brief called this "#1731 vs #1725 reports". #1731 is a goals PR (gateway `goals.service.ts` only) and shares no file with #1725; the conflict above is the stacks'. Recorded so nobody looks for a file overlap between the two PR numbers.
2. **#1559 is superseded by #1760 + #1755 and is not closed.** #1559 and #1760 change the same two gateway files (`house-inbox.service.ts` and its spec); #1755 is the web half (`mail-format.ts`). Land #1760 (with #1805) then #1755; #1559 should then be closed by a person. Rejected: landing #1559, which still names the first mailbox only.
3. **#1697 is a duplicate of #1708** (same title, same base #1672, same fix; #1708 names the helper `door-age.ts`, which #1716 and #1724 also use, #1697 names it `doorAge.ts`). Exclude #1697, land #1708. Not closed here.
4. **Main-based small PRs go right after #1797, in this order:** #1759 (docs), #1683 (CI guard), #1760 then #1805 then #1755's train, #1781 then #1807, #1783, #1782, #1766 then #1778 then #1790, #1786, #1746, #1785, #1747 then #1748 then #1749. Each is two to four files, independent, and merges clean against the others (the only overlaps are the shared list files in decision 5).
5. **Shared list files resolve by union.** `scripts/sql_outside_migrations.txt` (842 of the 934 pairwise tip conflicts), `.planning/03-scenarios/DELIVERY-AUDIT.md` and `scripts/read_error_baseline.json` are appended to by many stacks. Resolution: keep both sides' lines, sort `sql_outside_migrations.txt`, rerun `scripts/check_migrations_single_home.py --update` and the swallowed-read guard; for the baseline, the lower count wins and `total_sites` is recomputed, never added.
6. **Landing priority across trains (after the main-based group):** correctness and money first, then wording, then perf. Reason: the founder goal is purpose served first, smooth second, fast third, and a perf PR rebased on a wording PR is cheaper than the reverse.

## 2. Landing sequence (trains in order)

Every step assumes the older open PRs under each train (column 2 of the table in section 4) have landed per r37's order. "Up-merge" means merge main into the child branch and push, never rebase, as r37 decided.

| step | what lands | how | gate before the next step |
|---|---|---|---|
| 0 | **#1797** (pin the Playwright job) | alone, first | `CI Complete` green on #1797; after it lands every main-based PR needs one up-merge of main to pick up the pin |
| 1 | main-based singles: #1759, #1683, then #1760 with #1805, then #1781 with #1807, #1783, #1782, #1766 > #1778 > #1790, #1786, #1746, #1785, #1747 > #1748 > #1749 | one at a time, up-merge main between each | each green on its own CI |
| 2 | **Money and cost correctness:** train #1549 (#1684 > #1804 > #1808), then goals stack #1382 (#1705 > #1710 > #1718 > #1731), then reports cost #1383 (#1679), #1513 (#1690), #1688 | #1679 and #1690 meet in `analytics.service.ts` and `Cutting.tsx`: land #1690 first (rooted at main), up-merge #1679 | gateway analytics, reports and recommendations suites |
| 3 | **Reports page stack #1438 (#1698 > #1713 > #1715 > #1725 > #1770)** | after step 2, resolved per decision 1 | web reports suites; browser check |
| 4 | **Menu money:** train #1418 (#1736 > #1771 > #1772 > #1773 > #1774 > #1799 > #1802, then #1801) | #1799 then #1802 up-merged on each other, #1801 last (typed-line price refusal reads the same functions) | menus gateway and web suites |
| 5 | **Receipts and invoices:** train #1672 (#1708 > #1707 > #1723 > #1732 > #1756 > #1789; **#1697 excluded**), #1687, #1742 (canonical reads), #1677 train (#1709 > #1716 > #1757) | #1687 up-merges after #1708 (`ReceiptsNext.tsx`); #1757 after #1687 (`DocumentsReportsNext.test.tsx`) | receipts and receiving suites |
| 6 | **Inventory (goods words and honesty):** train #1312 (#1704 > #1717 > #1726 > #1728 > #1738 > #1743 > #1744 > #1745 > #1754 > #1761 > #1764 > #1765 > #1767 > #1775 > #1780 > #1784 > #1792 > #1793 > #1794) then #1685, #1693 | `InventorySheets.tsx` (#1775 vs #1761/#1764) and `CocktailRegister.tsx` meet inside it | inventory suites |
| 7 | **Mail:** #1696, then #1711 > #1729 > #1733 > #1739, then #1701 > #1755 > #1762 > #1776 > #1777 > #1791 > #1803, plus #1682 #1686 #1692 #1714 > #1724 > #1750 #1719 #1758 | the late-cold-load group up-merges after the dates and sender-read group | mail web and gateway suites |
| 8 | **Dishes and cocktails:** train #1393 (#1695 > #1727 > #1730 > #1735 > #1751 > #1752 > #1753 > #1768 > #1769 > #1779 > #1787 > #1788 > #1800 > #1806), #1691 | `dishes-list.spec.ts`, `dishes-recipe.spec.ts`, `CocktailRegister.tsx`, `DishesPage.tsx`: keep both sides | dishes and cellar suites |
| 9 | **Menu plan and kept list:** train #1340 (#1680 > #1681 > #1694 > #1700 > #1703 > #1712 > #1720 > #1722 > #1740), then #1737, #1702 | after step 4; `menus.service.ts`, `MenuPlan.tsx`, `MenuVersions.tsx`, `MenuReviewScreen.tsx`, `HouseMenu.tsx`, `services/api/menus.ts` keep both sides | menus suites; browser check on `/menu` |
| 10 | **Onboarding setup ticks and warm loads:** #1699, #1734, #1741, #1763, #1706 > #1795 > #1798, #1796 | #1706 and #1737 meet in `MenuCsvUpload.tsx` and `MenuScanUpload.tsx` (keep both), #1702 and #1786 in `SetupNudgeBanner.tsx` (keep #1786's menu wording, #1702's single read) | onboarding suites |
| 11 | **Perf-only last:** #1678 > #1721, #1697 stays out | any order | web build size unchanged |

## 3. Conflicts and exact resolutions (pairwise `git merge-tree` of all chain tips, 934 + 268 pairs; 105 + 36 touch a real file)

| cluster | PRs | files | resolution |
|---|---|---|---|
| reports (decision 1) | #1679 #1688 #1690 #1713 #1731 #1770 | 16 gateway and web files listed in decision 1; `Cutting.tsx` and `rp-registers-{house,trade}.tsx` for #1679 vs #1690 | #1731's stack first; #1770's stack takes main in the gateway files, keeps both in the web files; #1690 before #1679 |
| menu money vs plan | #1680 #1694 #1712 #1722 #1737 #1740 vs #1771 #1774 #1799 #1801 #1802 | `menus.service.ts` and spec, `HouseMenu.tsx`, `MenuVersions.tsx`, `MenuPlan.tsx`, `MenuReviewScreen.tsx`, `services/api/menus.ts`, `menu-import-discard-source-roles.spec.ts` | money train (step 4) lands first; the plan train up-merges and keeps both sides in every file; re-run the menus suites. #1799, #1802 and #1801 also meet each other in the same five files: #1799, then #1802, then #1801, each up-merging the one before |
| menu find vs plan | #1694 vs #1700 #1712 #1720 #1722 | `MenuNext.test.tsx` | test-only; keep both blocks of tests |
| receipts | #1687 vs #1697 #1708 #1789 #1756; #1687 vs #1757 | `ReceiptsNext.tsx`, `ReceiptsNext.test.tsx`, `DocumentsReportsNext.test.tsx` | #1697 excluded (duplicate of #1708); #1687 up-merges after #1708; #1757 after #1687 |
| mail | #1696 #1729 #1733 #1739 vs #1755 #1776 #1777 #1803 | `MailTab.tsx`, `MailThread.tsx`, `useMailData.ts` | house-day dates and shared sender read first; cold-load and read-ahead group up-merges, keeps both |
| inventory sheets | #1743 #1754 vs #1775 #1784 | `InventorySheets.tsx` (+test) | #1743, #1754 first, #1775 and #1784 up-merge, keep both (count sheet words vs held-goods words) |
| cocktail register | #1691 #1704 #1761 #1764 #1775 #1780 #1784 #1794 #1806 vs #1769 #1779 #1787 #1788 | `CocktailRegister.tsx` | inventory goods words (step 6) first; dishes/cocktails (step 8) up-merge and keep both |
| dishes | #1691 vs #1769 #1779 #1787 #1788 #1806; #1779 vs #1806 | `dishes-list.spec.ts`, `dishes-recipe.spec.ts`, `DishesPage.tsx` | keep both sides (cost-unread wording vs sections offered vs added-dish stays visible) |
| onboarding | #1702 vs #1786; #1706 #1795 #1798 vs #1737 | `SetupNudgeBanner.tsx`, `MenuCsvUpload.tsx`, `MenuScanUpload.tsx` | keep both sides |
| auth and door | #1693 vs #1704 #1717; #1699 vs #1766 #1778; #1708 vs #1724; #1716 vs #1724 | `scripts/sql_outside_migrations.txt` only | union (decision 5) |
| menu dates vs kept list | #1703 vs #1737; #1694 vs #1737 | `MenuVersions.tsx`, `menu-import-discard-source-roles.spec.ts` | keep both; #1737's slower poll stays |

One migration appears in the 130 PRs: #1689 adds `20271123100000_a_reply_joins_its_letters_thread.sql` on top of its parent's `20270913100000_one_conversation_is_one_thread.sql`. Its version is unique among these PRs and past main's newest (`20270302100000`); renumber at landing if an older train lands a later one (migrations are numbered at merge).

## 4. All trains from #1679 up

`trains-table.md` is inlined here. Column 2 is how many open PRs below #1679 the train stacks on; those land first by r37's order.

| train root | open PRs below #1679 it needs first | PRs >= #1679 in landing order | base | CI (ignoring the audit gate, out of credit) |
|---|---|---|---|---|
| #1383 | 3 | #1679 | stacked | green |
| #1340 | 22 | #1680 > #1681 > #1694 > #1700 > #1703 > #1712 > #1720 > #1722 > #1740 > #1801 | stacked | green |
| #1394 | 2 | #1682 > #1686 > #1692 > #1696 > #1701 > #1711 > #1714 > #1719 > #1724 > #1729 > #1733 > #1739 > #1750 > #1755 > #1758 > #1762 > #1776 > #1777 > #1791 > #1803 | stacked | green |
| #1683 | 0 | #1683 | main | RED CI Complete, Test E2E |
| #1549 | 2 | #1684 > #1804 > #1808 | stacked | green |
| #1312 | 6 | #1685 > #1704 > #1717 > #1726 > #1728 > #1738 > #1743 > #1744 > #1745 > #1754 > #1761 > #1764 > #1765 > #1767 > #1775 > #1780 > #1784 > #1792 > #1793 > #1794 | stacked | green |
| #1416 | 2 | #1687 | stacked | green |
| #1688 | 0 | #1688 | branch base | green |
| #1365 | 1 | #1689 | stacked | green |
| #1513 | 3 | #1690 | stacked | green |
| #1385 | 13 | #1691 | stacked | green |
| #1363 | 2 | #1693 | stacked | green |
| #1393 | 10 | #1695 > #1727 > #1730 > #1735 > #1751 > #1752 > #1753 > #1768 > #1769 > #1779 > #1787 > #1788 > #1800 > #1806 | stacked | green |
| #1672 | 1 | #1697 > #1707 > #1708 > #1723 > #1732 > #1756 > #1789 | stacked | green |
| #1438 | 9 | #1698 > #1713 > #1715 > #1725 > #1770 | stacked | green |
| #1699 | 0 | #1699 | branch base | green |
| #1413 | 7 | #1702 | stacked | green |
| #1382 | 6 | #1705 > #1710 > #1718 > #1731 | stacked | green |
| #1372 | 10 | #1706 > #1795 > #1798 | stacked | green |
| #1677 | 1 | #1709 > #1716 > #1757 | stacked | green |
| #1678 | 1 | #1721 | stacked | green |
| #1336 | 1 | #1734 | stacked | green |
| #1418 | 2 | #1736 > #1771 > #1772 > #1773 > #1774 > #1799 > #1802 | stacked | green |
| #1737 | 0 | #1737 | branch base | green |
| #1443 | 1 | #1741 | stacked | green |
| #1309 | 5 | #1742 | stacked | green |
| #1746 | 0 | #1746 | main | RED CI Complete, Test E2E |
| #1747 | 0 | #1747 > #1748 > #1749 | main | RED CI Complete, Test E2E; green |
| #1759 | 0 | #1759 | main | RED CI Complete, Test E2E |
| #1760 | 0 | #1760 > #1805 | main | RED CI Complete, Lint TypeScript; green |
| #1352 | 5 | #1763 | stacked | green |
| #1766 | 0 | #1766 > #1778 > #1790 | main | RED CI Complete, Test E2E; green |
| #1781 | 0 | #1781 > #1807 | main | RED A failed read is never reported as an empty one, CI Complete, Test E2E; green |
| #1782 | 0 | #1782 | main | RED CI Complete, Test E2E |
| #1783 | 0 | #1783 | main | RED CI Complete, Test E2E |
| #1785 | 0 | #1785 | main | RED CI Complete, Test E2E |
| #1786 | 0 | #1786 | main | RED CI Complete, Lint TypeScript |
| #1396 | 6 | #1796 | stacked | green |
| #1797 | 0 | #1797 | main | green |

## 5. Not caused by these PRs, and not fixed here

- `PR Audit Gate` is red on every PR: the gate key is out of credit.
- r37's section 5 failures (web `mudavym-ground` first-proof-plan, OD-112 ink-3, invoiceMatch parity, the ADR-0164 claim pin) were not re-measured here; they sit on the older trains.
- The GitHub listing caps at 500 open PRs, so ancestors of a few trains (#1688's base, #1699's base, #1737's base) are older PRs outside it. Their position comes from r37's order.
- Stacked PRs show no CI because the workflow runs only for PRs aimed at main. Real CI for a stacked PR first runs when its parent lands and it is retargeted by a person.

## 6. r56 PRs

- #1797 pin the Playwright job (main). Land first.
- #1805 grant-absent spec fixture, stacked on #1760. Land with it.
- #1807 read-error baseline row, stacked on #1781. Land with it.
