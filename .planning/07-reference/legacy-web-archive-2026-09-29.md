# Legacy web archive, 2026-09-29 — the pages the cutover deleted, in one compressed file

- **What:** `legacy-web-archive-2026-09-29.tar.gz`, next to this file. Every file the cutover PR (#494, branch `feat/cutover-manifest-trial`) deletes from `apps/web/src`, with its original repo path, as it stood on `origin/main` `71ae5449b` just before the deletion merged.
- **Why it exists:** the founder, 2026-09-29, verbatim: *"Change 494 to deleting but archiving those uh, legacy web pages so we can have access to what we were doing back in the day when we were trying to get some inspiration in a compressed folder so that it doesn't take up any much more space than what it needs. And I, I approve that change to happen right now."* Recorded as a scoped exception to ADR 0032's delete-plus-tombstone rule in [ADR 0032 §Scoped exception — the legacy web archive](../decisions/0032-vault-cleanup-cut-line.md).
- **Manifest:** [`deploy/CUTOVER-MANIFEST-2026-09-28.md`](deploy/CUTOVER-MANIFEST-2026-09-28.md) §4 names each group; the "Group" column below is that section's heading (`shared (a, b)` = the §4 shared set, going with groups a and b).
- **Archive:** 236 regular files (plus their directory entries), 79,370 lines (`git diff --numstat`), **734,018 bytes** gzip -9 (the tar is 3,461,120 bytes; `xz -9e` would be 518,004 bytes — `.tar.gz` kept for universal readability). sha256 `d33be0983cdae0f37e061a259e02e01761d2ba8ae47bf0b010b423e27f347fb6`. Built with `git archive --format=tar 71ae5449b -- <paths> | gzip -9 -n`; the tar's pax header carries that commit id (`git get-tar-commit-id`).
- **Verified:** extracted to a temp dir, all 236 files byte-identical to `git show 71ae5449b:<path>` (`cmp`), 236 of 236.
- **Nothing builds from it.** It lives under `.planning/`, which the web and gateway builds never read; the exclusion proofs are in the ADR 0032 section above. Claim: `claims.d/feat-cutover-manifest-trial.jsonl` (the `LEGACY-WEB-ARCHIVE-2026-09-29` row).

## How to read it

```bash
tar -tzf .planning/07-reference/legacy-web-archive-2026-09-29.tar.gz            # list
tar -xzf .planning/07-reference/legacy-web-archive-2026-09-29.tar.gz -C /tmp/legacy \
    apps/web/src/pages/Dashboard.tsx                                            # one file
tar -xOzf .planning/07-reference/legacy-web-archive-2026-09-29.tar.gz apps/web/src/pages/Dashboard.tsx | less
```

Git history holds the same bytes: `git show <commit>:<path>` with the commit in the last column (the last commit on `main` that touched the file).

## Files (236)

| Path | Lines (`wc -l`) | Group | Last commit |
|---|---:|---|---|
| `apps/web/src/__tests__/settings/OperatingHoursSection.test.tsx` | 269 | settings | `671c647df` |
| `apps/web/src/components/auth/GoogleLinkButton.tsx` | 97 | shared (settings, profile) | `873b46307` |
| `apps/web/src/components/communications/ClassifiedConversationList.tsx` | 834 | shared (communications, documents) | `018aca6a6` |
| `apps/web/src/components/communications/ConversationFilterBar.test.tsx` | 149 | shared (communications, documents) | `bd6b6d0cb` |
| `apps/web/src/components/communications/ConversationFilterBar.tsx` | 246 | shared (communications, documents) | `bd6b6d0cb` |
| `apps/web/src/components/communications/ConversationTimeFilter.tsx` | 224 | shared (communications, documents) | `bd6b6d0cb` |
| `apps/web/src/components/communications/ReportScheduler.tsx` | 759 | communications | `e17bde5fb` |
| `apps/web/src/components/communications/ReportTypeModal.tsx` | 366 | communications | `27ea23d64` |
| `apps/web/src/components/communications/__tests__/ReportScheduler.honesty.test.tsx` | 112 | communications | `e17bde5fb` |
| `apps/web/src/components/dashboard/AIDateExtractionAlert.tsx` | 202 | dashboard | `27ea23d64` |
| `apps/web/src/components/dashboard/AddImportantDateModal.tsx` | 297 | dashboard | `470d1fd49` |
| `apps/web/src/components/dashboard/QuickActionsPanel.tsx` | 485 | dashboard | `80dea1005` |
| `apps/web/src/components/documents/SMSTemplateBuilder.tsx` | 982 | communications | `0082cf827` |
| `apps/web/src/components/documents/SavedSMSTemplates.tsx` | 719 | communications | `f17cbff1e` |
| `apps/web/src/components/documents/SavedTemplates.tsx` | 682 | communications | `f17cbff1e` |
| `apps/web/src/components/documents/TemplateLibrary.tsx` | 1018 | communications | `6e08f481f` |
| `apps/web/src/components/layout/Breadcrumbs.tsx` | 42 | recommendations | `4c1bf0ab3` |
| `apps/web/src/components/onboarding/OptionalTail.tsx` | 199 | shared (settings, profile) | `4b2a8e389` |
| `apps/web/src/components/onboarding/__tests__/OptionalTail.calendar.test.tsx` | 148 | shared (settings, profile) | `4b2a8e389` |
| `apps/web/src/components/orders/ActiveConversationsPanel.tsx` | 219 | orders | `fd73d0920` |
| `apps/web/src/components/orders/CommercialTermsPanel.tsx` | 280 | orders | `cc400442c` |
| `apps/web/src/components/orders/CommsThreadDrawer.tsx` | 1520 | orders | `fd73d0920` |
| `apps/web/src/components/orders/DealApprovalModal.tsx` | 305 | orders | `fd73d0920` |
| `apps/web/src/components/orders/DraftEmailApprovalPanel.tsx` | 615 | orders | `fd73d0920` |
| `apps/web/src/components/orders/OrderGuardModal.tsx` | 83 | orders | `f717617bc` |
| `apps/web/src/components/orders/__tests__/CommsThreadDrawer.test.tsx` | 364 | orders | `fd73d0920` |
| `apps/web/src/components/orders/__tests__/DealApprovalModal.test.tsx` | 103 | orders | `fd73d0920` |
| `apps/web/src/components/orders/__tests__/DraftEmailApprovalPanel.test.tsx` | 296 | orders | `fd73d0920` |
| `apps/web/src/components/providers/AddProviderModal.tsx` | 974 | vendors | `fd73d0920` |
| `apps/web/src/components/providers/EditProviderModal.tsx` | 1780 | vendors | `fd73d0920` |
| `apps/web/src/components/providers/SendMessageSlideOver.tsx` | 904 | vendors | `71f131511` |
| `apps/web/src/components/providers/VendorCatalogueCard.tsx` | 192 | vendors | `b2806e456` |
| `apps/web/src/components/providers/VendorMatchModal.tsx` | 222 | vendors | `b2806e456` |
| `apps/web/src/components/providers/VendorSearchModal.tsx` | 324 | vendors | `b2806e456` |
| `apps/web/src/components/providers/__tests__/EditProviderModal.businessType.test.tsx` | 127 | vendors | `fd73d0920` |
| `apps/web/src/components/providers/__tests__/EditProviderModal.deliveryDays.test.tsx` | 161 | vendors | `941d9cb40` |
| `apps/web/src/components/providers/index.ts` | 7 | vendors | `ef8ecdf30` |
| `apps/web/src/components/reports/DashboardBlock.tsx` | 503 | reports | `39abb348a` |
| `apps/web/src/components/reports/DashboardCanvas.tsx` | 234 | reports | `39abb348a` |
| `apps/web/src/components/reports/EditToolbar.tsx` | 218 | reports | `6d310068b` |
| `apps/web/src/components/reports/InlineBlockConfig.tsx` | 277 | reports | `1e434974a` |
| `apps/web/src/components/reports/ReportGenerator.tsx` | 457 | reports | `58113e261` |
| `apps/web/src/components/reports/__tests__/ReportGenerator.test.tsx` | 41 | reports | `58113e261` |
| `apps/web/src/components/reports/__tests__/atoms/MetricDisplay.test.tsx` | 38 | reports | `6d310068b` |
| `apps/web/src/components/reports/__tests__/atoms/TrendIndicator.test.tsx` | 39 | reports | `6d310068b` |
| `apps/web/src/components/reports/__tests__/atoms/WineTypeBar.test.tsx` | 53 | reports | `6d310068b` |
| `apps/web/src/components/reports/__tests__/integration/LayoutDiffer.test.tsx` | 113 | reports | `27ea23d64` |
| `apps/web/src/components/reports/__tests__/integration/LayoutPersistence.test.tsx` | 84 | reports | `3b88da128` |
| `apps/web/src/components/reports/__tests__/molecules/KPICard.test.tsx` | 76 | reports | `1e434974a` |
| `apps/web/src/components/reports/__tests__/organisms/AICommandPalette.test.tsx` | 109 | reports | `58113e261` |
| `apps/web/src/components/reports/__tests__/organisms/insightSearch.test.ts` | 109 | reports | `58113e261` |
| `apps/web/src/components/reports/__tests__/posRevenue.test.tsx` | 157 | reports | `39abb348a` |
| `apps/web/src/components/reports/atoms/ChartHeader.tsx` | 42 | reports | `27ea23d64` |
| `apps/web/src/components/reports/atoms/CollapsibleSection.stories.tsx` | 87 | reports | `6d310068b` |
| `apps/web/src/components/reports/atoms/CollapsibleSection.tsx` | 69 | reports | `6d310068b` |
| `apps/web/src/components/reports/atoms/DragHandle.tsx` | 22 | reports | `6d310068b` |
| `apps/web/src/components/reports/atoms/InsightCard.stories.tsx` | 82 | reports | `6d310068b` |
| `apps/web/src/components/reports/atoms/InsightCard.tsx` | 61 | reports | `6d310068b` |
| `apps/web/src/components/reports/atoms/MetricDisplay.stories.tsx` | 59 | reports | `6d310068b` |
| `apps/web/src/components/reports/atoms/MetricDisplay.tsx` | 36 | reports | `3b88da128` |
| `apps/web/src/components/reports/atoms/TrendIndicator.stories.tsx` | 60 | reports | `6d310068b` |
| `apps/web/src/components/reports/atoms/TrendIndicator.tsx` | 33 | reports | `27ea23d64` |
| `apps/web/src/components/reports/atoms/WineTypeBar.stories.tsx` | 106 | reports | `6d310068b` |
| `apps/web/src/components/reports/atoms/WineTypeBar.tsx` | 66 | reports | `6d310068b` |
| `apps/web/src/components/reports/atoms/index.ts` | 14 | reports | `6d310068b` |
| `apps/web/src/components/reports/dashboardMeta.ts` | 177 | reports | `58113e261` |
| `apps/web/src/components/reports/dashboardTypes.ts` | 101 | reports | `58113e261` |
| `apps/web/src/components/reports/fabricated-figures.test.tsx` | 149 | reports | `ba1168b6e` |
| `apps/web/src/components/reports/molecules/BusyHoursHeatmap.tsx` | 139 | reports | `ba1168b6e` |
| `apps/web/src/components/reports/molecules/ChannelDonutChart.tsx` | 130 | reports | `17edc56a5` |
| `apps/web/src/components/reports/molecules/CheckScannerSection.tsx` | 101 | reports | `c306c7d86` |
| `apps/web/src/components/reports/molecules/DailyBreakdownTable.tsx` | 92 | reports | `58113e261` |
| `apps/web/src/components/reports/molecules/DataTableBlock.tsx` | 182 | reports | `6d310068b` |
| `apps/web/src/components/reports/molecules/KPICard.stories.tsx` | 113 | reports | `27ea23d64` |
| `apps/web/src/components/reports/molecules/KPICard.tsx` | 120 | reports | `1e434974a` |
| `apps/web/src/components/reports/molecules/KPIChartBlock.tsx` | 122 | reports | `6d310068b` |
| `apps/web/src/components/reports/molecules/KPISpotlightView.tsx` | 573 | reports | `58113e261` |
| `apps/web/src/components/reports/molecules/LaborSpendOverlay.tsx` | 113 | reports | `39abb348a` |
| `apps/web/src/components/reports/molecules/OrderFunnelChart.tsx` | 61 | reports | `17edc56a5` |
| `apps/web/src/components/reports/molecules/OrdersByTypeChart.tsx` | 135 | reports | `6d310068b` |
| `apps/web/src/components/reports/molecules/PeriodCompareBar.tsx` | 148 | reports | `ba1168b6e` |
| `apps/web/src/components/reports/molecules/PurchasedWinesTable.tsx` | 142 | reports | `58113e261` |
| `apps/web/src/components/reports/molecules/RevenueChart.stories.tsx` | 66 | reports | `6d310068b` |
| `apps/web/src/components/reports/molecules/RevenueChart.tsx` | 75 | reports | `6d310068b` |
| `apps/web/src/components/reports/molecules/TopWinesChart.stories.tsx` | 53 | reports | `6d310068b` |
| `apps/web/src/components/reports/molecules/TopWinesChart.tsx` | 78 | reports | `58113e261` |
| `apps/web/src/components/reports/molecules/WineDistributionChart.stories.tsx` | 57 | reports | `6d310068b` |
| `apps/web/src/components/reports/molecules/WineDistributionChart.tsx` | 66 | reports | `6d310068b` |
| `apps/web/src/components/reports/molecules/index.ts` | 24 | reports | `6d310068b` |
| `apps/web/src/components/reports/organisms/AICommandPalette.tsx` | 276 | reports | `58113e261` |
| `apps/web/src/components/reports/organisms/AIInsightsSection.tsx` | 75 | reports | `6d310068b` |
| `apps/web/src/components/reports/organisms/ChartsGrid.tsx` | 110 | reports | `6d310068b` |
| `apps/web/src/components/reports/organisms/DataTablesSection.tsx` | 66 | reports | `58113e261` |
| `apps/web/src/components/reports/organisms/EngineInsightsPanel.test.tsx` | 162 | reports | `922150404` |
| `apps/web/src/components/reports/organisms/EngineInsightsPanel.tsx` | 707 | reports | `922150404` |
| `apps/web/src/components/reports/organisms/HeadlineInsightsBar.tsx` | 166 | reports | `58113e261` |
| `apps/web/src/components/reports/organisms/KPISection.tsx` | 300 | reports | `27ea23d64` |
| `apps/web/src/components/reports/organisms/MonthlyReconciliation.tsx` | 211 | reports | `ba1168b6e` |
| `apps/web/src/components/reports/organisms/SeatingDensityPanel.tsx` | 659 | reports | `58113e261` |
| `apps/web/src/components/reports/organisms/TopBar.stories.tsx` | 60 | reports | `6d310068b` |
| `apps/web/src/components/reports/organisms/TopBar.tsx` | 176 | reports | `e181ff367` |
| `apps/web/src/components/reports/organisms/index.ts` | 13 | reports | `e181ff367` |
| `apps/web/src/components/reports/organisms/insightSearch.ts` | 78 | reports | `58113e261` |
| `apps/web/src/components/settings/AiAutonomySection.test.tsx` | 159 | settings | `941d9cb40` |
| `apps/web/src/components/settings/AiAutonomySection.tsx` | 327 | settings | `941d9cb40` |
| `apps/web/src/components/settings/ConsentDialog.tsx` | 178 | settings | `971d08071` |
| `apps/web/src/components/settings/EmailSenderSettings.tsx` | 121 | settings | `e9948a8e5` |
| `apps/web/src/components/settings/IntegrationsAuth.tsx` | 190 | settings | `941d9cb40` |
| `apps/web/src/components/settings/NotificationsSection.tsx` | 304 | settings | `fc2d40f96` |
| `apps/web/src/components/settings/OperatingHoursSection.tsx` | 396 | settings | `671c647df` |
| `apps/web/src/components/settings/PosSettingsSection.tsx` | 400 | settings | `dfcc295b9` |
| `apps/web/src/components/settings/ServicesPermissions.stories.tsx` | 20 | settings | `1c1546a66` |
| `apps/web/src/components/settings/ServicesPermissions.tsx` | 311 | settings | `17edc56a5` |
| `apps/web/src/components/team/ShiftImportModal.test.tsx` | 81 | team | `941d9cb40` |
| `apps/web/src/components/team/ShiftImportModal.tsx` | 268 | team | `941d9cb40` |
| `apps/web/src/components/ui/RangeSlider.test.tsx` | 57 | vendors | `536c27a7c` |
| `apps/web/src/components/ui/RangeSlider.tsx` | 116 | vendors | `17edc56a5` |
| `apps/web/src/components/wines/AddToInventoryFromLibraryModal.tsx` | 1102 | cellar | `2800fda57` |
| `apps/web/src/components/wines/DevManualWineEntry.tsx` | 939 | cellar | `1b87dabbf` |
| `apps/web/src/components/wines/DevWinePhotoUpload.tsx` | 329 | cellar | `c306c7d86` |
| `apps/web/src/data/customEventTypes.ts` | 72 | calendar | `83b042e1e` |
| `apps/web/src/data/manualImportantDates.ts` | 32 | dashboard | `470d1fd49` |
| `apps/web/src/data/quickActions.ts` | 208 | dashboard | `27dce076e` |
| `apps/web/src/data/reportDefaults.ts` | 152 | communications | `6d310068b` |
| `apps/web/src/hooks/index.ts` | 30 | dashboard | `4ce7e26af` |
| `apps/web/src/hooks/useDashboardData.ts` | 302 | dashboard | `ba1168b6e` |
| `apps/web/src/hooks/useEngineInsights.ts` | 205 | reports | `0ca4414fb` |
| `apps/web/src/hooks/useOrdersMetrics.ts` | 370 | shared (dashboard, reports) | `941d9cb40` |
| `apps/web/src/hooks/useQuickActions.ts` | 216 | dashboard | `470d1fd49` |
| `apps/web/src/hooks/useTemplates.ts` | 171 | shared (vendors, communications) | `6d310068b` |
| `apps/web/src/lib/assistantMarkdown.ts` | 57 | ask | `0082cf827` |
| `apps/web/src/lib/calendar-dates.ts` | 16 | shared (dashboard, calendar) | `466f33e9b` |
| `apps/web/src/lib/conversationFilters.test.ts` | 306 | shared (communications, documents) | `018aca6a6` |
| `apps/web/src/lib/conversationFilters.ts` | 398 | shared (communications, documents) | `018aca6a6` |
| `apps/web/src/lib/conversationGrouping.test.ts` | 241 | shared (communications, documents) | `018aca6a6` |
| `apps/web/src/lib/conversationGrouping.ts` | 243 | shared (communications, documents) | `fd73d0920` |
| `apps/web/src/lib/reports-drag.ts` | 25 | reports | `1e434974a` |
| `apps/web/src/lib/reports/index.ts` | 8 | reports | `6d310068b` |
| `apps/web/src/lib/reports/layoutDiffer.ts` | 147 | reports | `27ea23d64` |
| `apps/web/src/lib/reports/layoutEngine.ts` | 109 | reports | `9f973be8e` |
| `apps/web/src/lib/reports/types.ts` | 52 | reports | `6d310068b` |
| `apps/web/src/lib/reportsDataGap.test.ts` | 53 | reports | `ba1168b6e` |
| `apps/web/src/lib/reportsDataGap.ts` | 86 | reports | `ba1168b6e` |
| `apps/web/src/pages/AdminHealth.test.tsx` | 84 | admin | `cc73f9f66` |
| `apps/web/src/pages/AdminHealth.tsx` | 278 | admin | `cc73f9f66` |
| `apps/web/src/pages/AdminPanel.test.tsx` | 74 | admin | `cc73f9f66` |
| `apps/web/src/pages/AdminPanel.tsx` | 882 | admin | `cc73f9f66` |
| `apps/web/src/pages/AuthorizeIntegration.retention.test.tsx` | 286 | authorize | `e2abd7844` |
| `apps/web/src/pages/AuthorizeIntegration.test.tsx` | 212 | authorize | `e2abd7844` |
| `apps/web/src/pages/AuthorizeIntegration.tsx` | 474 | authorize | `e2abd7844` |
| `apps/web/src/pages/CalendarModular.tsx` | 26 | calendar | `3d6e4f52d` |
| `apps/web/src/pages/Communications.test.tsx` | 130 | communications | `4c4110f4d` |
| `apps/web/src/pages/Communications.tsx` | 620 | communications | `4c4110f4d` |
| `apps/web/src/pages/Dashboard.tsx` | 1856 | dashboard | `4b2a8e389` |
| `apps/web/src/pages/DocumentsPage.tsx` | 1107 | documents | `11c501d26` |
| `apps/web/src/pages/Help.tsx` | 198 | help | `410534a21` |
| `apps/web/src/pages/InsightCatalog.tsx` | 665 | recommendations | `82d42eea2` |
| `apps/web/src/pages/LogsTimelinePage.test.tsx` | 255 | logs | `4d0f6c50b` |
| `apps/web/src/pages/LogsTimelinePage.tsx` | 390 | logs | `4d0f6c50b` |
| `apps/web/src/pages/Notifications.tsx` | 2478 | notifications | `f717617bc` |
| `apps/web/src/pages/Orders.tsx` | 3490 | orders | `fd73d0920` |
| `apps/web/src/pages/Profile.test.tsx` | 123 | profile | `a27790d8e` |
| `apps/web/src/pages/Profile.tsx` | 909 | profile | `f84db4147` |
| `apps/web/src/pages/Promotions.tsx` | 795 | promotions | `7455aed40` |
| `apps/web/src/pages/Providers.tsx` | 1611 | vendors | `fd73d0920` |
| `apps/web/src/pages/ReceiptsPage.roles.test.tsx` | 112 | receipts | `57b051940` |
| `apps/web/src/pages/ReceiptsPage.tsx` | 532 | receipts | `57b051940` |
| `apps/web/src/pages/Recommendations.test.tsx` | 407 | recommendations | `f717617bc` |
| `apps/web/src/pages/Recommendations.tsx` | 1268 | recommendations | `f717617bc` |
| `apps/web/src/pages/Reports.tsx` | 1530 | reports | `941d9cb40` |
| `apps/web/src/pages/Settings.tsx` | 1631 | settings | `4b2a8e389` |
| `apps/web/src/pages/SommelierAI.tsx` | 924 | ask | `f59addc38` |
| `apps/web/src/pages/VendorPriceCompare.tsx` | 605 | vendor_prices | `941d9cb40` |
| `apps/web/src/pages/WineLibrary.tsx` | 1911 | cellar | `982b45cb8` |
| `apps/web/src/pages/__tests__/DocumentsPage.honesty.test.ts` | 57 | documents | `11c501d26` |
| `apps/web/src/pages/__tests__/OrdersLegacyReject.test.ts` | 93 | orders | `941d9cb40` |
| `apps/web/src/pages/__tests__/Settings.calendar.test.tsx` | 124 | settings | `4b2a8e389` |
| `apps/web/src/pages/__tests__/Settings.currency.test.tsx` | 136 | settings | `941d9cb40` |
| `apps/web/src/pages/arrival/Arrival.test.tsx` | 747 | arrival_book | `f717617bc` |
| `apps/web/src/pages/arrival/Arrival.tsx` | 1413 | arrival_book | `f717617bc` |
| `apps/web/src/pages/arrival/ArrivalField.tsx` | 282 | arrival_book | `8ec925aa7` |
| `apps/web/src/pages/arrival/arrival-api.ts` | 235 | arrival_book | `8ec925aa7` |
| `apps/web/src/pages/arrival/arrival-reading.ts` | 263 | arrival_book | `8ec925aa7` |
| `apps/web/src/pages/arrival/arrival.css` | 698 | arrival_book | `a7a803fe3` |
| `apps/web/src/pages/arrival/local-speech.test.ts` | 80 | arrival_book | `8ec925aa7` |
| `apps/web/src/pages/arrival/local-speech.ts` | 170 | arrival_book | `8ec925aa7` |
| `apps/web/src/pages/calendar/CalendarAgenda.tsx` | 235 | calendar | `fdd8285fb` |
| `apps/web/src/pages/calendar/CalendarDay.tsx` | 437 | calendar | `6d310068b` |
| `apps/web/src/pages/calendar/CalendarMonth.tsx` | 308 | calendar | `22284c1c9` |
| `apps/web/src/pages/calendar/CalendarPage.realtime.test.tsx` | 79 | calendar | `fd73d0920` |
| `apps/web/src/pages/calendar/CalendarPage.reminders.test.tsx` | 277 | calendar | `fd73d0920` |
| `apps/web/src/pages/calendar/CalendarPage.tsx` | 753 | calendar | `fd73d0920` |
| `apps/web/src/pages/calendar/CalendarSidebar.tsx` | 242 | calendar | `6d310068b` |
| `apps/web/src/pages/calendar/CalendarWeek.tsx` | 537 | calendar | `27ea23d64` |
| `apps/web/src/pages/calendar/DragDropProvider.tsx` | 276 | calendar | `53c09aadd` |
| `apps/web/src/pages/calendar/EventCard.tsx` | 155 | calendar | `f7ca44e3f` |
| `apps/web/src/pages/calendar/EventModal.tsx` | 1592 | calendar | `17edc56a5` |
| `apps/web/src/pages/calendar/MeetingMemoPrompt.tsx` | 284 | calendar | `fd73d0920` |
| `apps/web/src/pages/calendar/index.tsx` | 29 | calendar | `6d310068b` |
| `apps/web/src/pages/calendar/useCalendarPage.ts` | 253 | calendar | `1b87dabbf` |
| `apps/web/src/pages/dashboard/index.tsx` | 4 | dashboard | `6d310068b` |
| `apps/web/src/pages/dashboard/useDashboardPage.ts` | 297 | dashboard | `941d9cb40` |
| `apps/web/src/pages/distributors/command/DistributorDrawer.tsx` | 339 | vendors | `17edc56a5` |
| `apps/web/src/pages/distributors/command/DistributorMap.stories.tsx` | 116 | vendors | `27dce076e` |
| `apps/web/src/pages/distributors/command/DistributorMap.test.tsx` | 84 | vendors | `124b1e833` |
| `apps/web/src/pages/distributors/command/DistributorMap.tsx` | 519 | vendors | `17edc56a5` |
| `apps/web/src/pages/distributors/command/DistributorMapPage.tsx` | 373 | vendors | `eda20f0b6` |
| `apps/web/src/pages/distributors/command/bits.test.tsx` | 152 | vendors | `eda20f0b6` |
| `apps/web/src/pages/distributors/command/bits.tsx` | 260 | vendors | `eda20f0b6` |
| `apps/web/src/pages/distributors/command/customProvider.ts` | 208 | vendors | `eda20f0b6` |
| `apps/web/src/pages/distributors/command/mapCamera.test.ts` | 109 | vendors | `eda20f0b6` |
| `apps/web/src/pages/distributors/command/mapCamera.ts` | 340 | vendors | `eda20f0b6` |
| `apps/web/src/pages/distributors/index.tsx` | 3 | vendors | `536c27a7c` |
| `apps/web/src/pages/distributors/useDistributorsPage.ts` | 191 | vendors | `eda20f0b6` |
| `apps/web/src/pages/orders/CreateOrderModal.tsx` | 485 | orders | `cd3311586` |
| `apps/web/src/pages/orders/OrderFilters.tsx` | 158 | orders | `6d310068b` |
| `apps/web/src/pages/orders/OrderSummary.tsx` | 202 | orders | `1c037ac0e` |
| `apps/web/src/pages/orders/index.tsx` | 6 | orders | `6d310068b` |
| `apps/web/src/pages/orders/useOrdersPage.ts` | 203 | orders | `941d9cb40` |
| `apps/web/src/pages/receiving/DoorReceipt.test.tsx` | 230 | receiving_door | `34c33a76a` |
| `apps/web/src/pages/receiving/DoorReceipt.tsx` | 543 | receiving_door | `b2471b6ca` |
| `apps/web/src/pages/receiving/ReceivingHome.test.tsx` | 223 | receiving_desk | `7022434f7` |
| `apps/web/src/pages/receiving/ReceivingHome.tsx` | 469 | receiving_desk | `fd73d0920` |
| `apps/web/src/pages/team/command/ManagerShiftDesk.tsx` | 1178 | team | `0c16f8434` |
| `apps/web/src/pages/team/command/MyShifts.tsx` | 206 | team | `641d5cdc2` |
| `apps/web/src/pages/team/command/OpsRulesPanel.tsx` | 308 | team | `641d5cdc2` |
| `apps/web/src/pages/team/command/PerformancePanel.tsx` | 278 | team | `fd73d0920` |
| `apps/web/src/pages/team/command/TeamCommand.honesty.test.tsx` | 452 | team | `0c16f8434` |
| `apps/web/src/pages/team/command/TeamCommandPage.tsx` | 40 | team | `1ae93d6b9` |
| `apps/web/src/pages/team/command/bits.tsx` | 154 | team | `c0d909240` |
| `apps/web/src/pages/team/command/editors.tsx` | 304 | team | `0c16f8434` |
| `apps/web/src/pages/wine-library/index.tsx` | 3 | cellar | `6d310068b` |
| `apps/web/src/pages/wine-library/useWineLibraryPage.ts` | 353 | cellar | `21d46e448` |
| `apps/web/src/services/api/analytics.ts` | 88 | reports | `39abb348a` |
| `apps/web/src/utils/aiDateContext.ts` | 312 | dashboard | `6d310068b` |
| `apps/web/src/utils/deliveryDateUtils.ts` | 137 | orders | `74b86273e` |
