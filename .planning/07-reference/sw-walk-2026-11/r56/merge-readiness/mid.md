
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

No migration files appear in any of the 130 PRs, so the migration-version rule is not in play for these trains (checked: no `supabase/migrations/` path in `files.txt`).

## 4. All trains from #1679 up

`trains-table.md` is inlined here. Column 2 is how many open PRs below #1679 the train stacks on; those land first by r37's order.

