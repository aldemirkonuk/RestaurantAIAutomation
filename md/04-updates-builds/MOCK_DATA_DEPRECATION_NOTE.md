# Mock Data Deprecation Note

**Date:** January 18, 2026  
**Status:** ⚠️ DEPRECATED — DO NOT USE

---

## Summary

Mock data files in `apps/web/src/data/` are **deprecated**. Use **React Query hooks** and **API services** instead.

---

## What Was Deprecated

| File | Use Instead |
|------|-------------|
| `providerData.ts` | `useProviders()` from `hooks/queries/useProviderQueries.ts` |
| `notificationsData.ts` | `useNotifications()`, `useMarkNotificationAsRead()` from `hooks/queries/useNotificationQueries.ts` |
| `SAMPLE_EVENTS` in Calendar | `useCalendarEvents()` from `hooks/queries/useCalendarQueries.ts` |
| `inventoryData.ts` (partial) | `useInventoryData()` hook |
| `wineData.ts` | **TODO:** Create `useWineLibraryQueries.ts` |
| `reportDefaults.ts` | **TODO:** Create `useReportQueries.ts` |
| `emailTemplateCategories.ts` | **TODO:** Create `useDocumentQueries.ts` |

---

## Migration Pattern

```typescript
// OLD (deprecated)
import { providers } from '../data/providerData'

// NEW (use this)
import { useProviders } from '../hooks/queries'
import { useAuthStore } from '../stores'

const restaurantId = useAuthStore(state => state.activeRestaurantId)
const { data: providers, isLoading } = useProviders(restaurantId)
```

- **DO NOT** import from `src/data/` mock files.
- **USE** React Query hooks from `src/hooks/queries/` and Zustand from `src/stores/`.
- For tests or Storybook, use **MSW** or local mocks in test/story files, not `src/data/`.

---

## More Details

- **Full migration status & patterns:** See `md_files/02-architecture/FRONTEND_ARCHITECTURE_SUMMARY.md`
- **Hooks:** `apps/web/src/hooks/queries/`
- **Stores:** `apps/web/src/stores/`
- **API layer:** `apps/web/src/services/api/`

---

**Remember:** Use React Query hooks in production code; mock data is for development/testing only.

