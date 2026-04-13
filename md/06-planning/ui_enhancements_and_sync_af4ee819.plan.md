---
name: UI Enhancements and Sync
overview: Add provider type customization, create unified edit layout component, implement cross-page syncing, add gmail template button, and analyze information architecture.
todos:
  - id: provider-type
    content: Add 'Add Provider Type' button with custom type modal in AddProviderModal.tsx
    status: pending
  - id: edit-layout
    content: Create unified EditLayoutPanel component combining edit mode + chart arrangement
    status: pending
  - id: sync-orders-inventory
    content: Verify and fix Orders -> Inventory sync when order delivered
    status: pending
  - id: sync-winelibrary-inventory
    content: Verify and fix Wine Library -> Inventory sync when adding wine
    status: pending
  - id: gmail-button
    content: Add secondary action buttons to Gmail templates section
    status: pending
  - id: sync-audit
    content: Add missing sync events (provider_change, dashboard updates)
    status: pending
  - id: info-architecture-doc
    content: Create Information Architecture documentation in md_files
    status: pending
isProject: false
---

# UI Enhancements, Syncing & Information Architecture

## Summary

This plan addresses 6 areas:

1. Add custom provider type functionality
2. Create unified edit layout component (combining edit mode + chart arrangement)
3. Verify and fix cross-page syncing (Orders -> Inventory, Wine Library -> Inventory)
4. Add button in Gmail templates section
5. Audit all syncing mechanisms
6. Analyze Information Architecture

---

## 1. Add Provider Type Button in Modal

**Current State**: `primaryBusinessType` is limited to 3 hardcoded options (Distributor, Importer, Wholesaler)

**Location**: [`apps/web/src/components/providers/AddProviderModal.tsx`](apps/web/src/components/providers/AddProviderModal.tsx)

**Changes Required**:

- Add "Add Type" button next to the 3 business type cards
- Create modal/popover for adding custom type
- Store custom types in localStorage and persist to API when available
- Add icons dropdown for custom types
```mermaid
flowchart LR
    A[Business Type Section] --> B[Distributor Card]
    A --> C[Importer Card]
    A --> D[Wholesaler Card]
    A --> E[+ Add Type Button]
    E --> F[Custom Type Modal]
    F --> G[Name Input]
    F --> H[Icon Selector]
    F --> I[Save to localStorage]
```


---

## 2. Unified Edit Layout Component

**Current State**: Reports.tsx has separate:

- `isEditMode` toggle (line 328)
- `ChartArrangementModal` (line 334)
- TopBar with both buttons

**Location**: [`apps/web/src/components/reports/`](apps/web/src/components/reports/)

**Create New Component**: `EditLayoutPanel.tsx`

Features to combine:

- Toggle edit mode (iOS-style wobble animation already exists)
- Drag-and-drop KPI cards (dnd-kit)
- Chart arrangement in a side panel (not separate modal)
- Add/remove KPIs
- Resize widgets
- Save/reset layout to localStorage
```mermaid
flowchart TB
    subgraph EditLayoutPanel["EditLayoutPanel Component"]
        Toggle["Edit Mode Toggle"]
        Panel["Slide-out Panel"]
        subgraph PanelContent["Panel Content"]
            KPIList["Available KPIs"]
            ChartList["Available Charts"]
            LayoutPresets["Layout Presets"]
            Reset["Reset to Default"]
        end
    end
    Toggle --> Panel
    Panel --> PanelContent
```


**Key Files to Create/Modify**:

- Create: `apps/web/src/components/reports/EditLayoutPanel.tsx`
- Modify: `apps/web/src/pages/Reports.tsx` - replace separate controls
- Modify: `apps/web/src/components/reports/organisms/TopBar.tsx` - simplify

---

## 3. Cross-Page Syncing Audit

### 3.1 Orders -> Inventory Sync

**Current Flow** (already implemented in RealtimeContext.tsx lines 481-492):

```mermaid
sequenceDiagram
    participant Orders
    participant RealtimeContext
    participant Backend
    participant Inventory
    
    Orders->>RealtimeContext: dispatchOrderUpdate(delivered)
    RealtimeContext->>Backend: POST /events (order_change)
    RealtimeContext->>RealtimeContext: Auto-trigger inventory update
    RealtimeContext->>Backend: POST /events (inventory_change)
    Backend->>Inventory: Supabase Realtime broadcast
    Inventory->>Inventory: Update stock display
```

**Status**: Implemented but needs verification

- Check: When order marked "delivered", does inventory update?
- Check: Is `quantity` being passed correctly?

### 3.2 Wine Library -> Inventory Sync

**Current Flow**:

- `AddToInventoryFromLibraryModal` component exists
- Uses `dispatchInventoryUpdate` and `dispatchWineUpdate`

**Location**: [`apps/web/src/components/wines/AddToInventoryFromLibraryModal.tsx`](apps/web/src/components/wines/AddToInventoryFromLibraryModal.tsx)

**Status**: Verify the modal properly dispatches events

### 3.3 Missing Syncs to Add

| Source | Target | Event Type | Status |

|--------|--------|------------|--------|

| Orders (delivered) | Inventory | inventory_change | Exists |

| Wine Library (add) | Inventory | inventory_change | Exists |

| Inventory (update) | Dashboard | dashboard_update | Missing |

| Calendar (delivery) | Orders | order_change | Missing |

| Providers (new) | Orders dropdown | provider_change | Missing |

---

## 4. Gmail Templates Button

**Current State**: Communications.tsx has "Create Email Template" button

**Location**: [`apps/web/src/pages/Communications.tsx`](apps/web/src/pages/Communications.tsx) (lines 210-218)

**Add**: Secondary action button options:

- "Import Template" - load from file/preset
- "Quick Templates" - dropdown with common templates
- "AI Generate" - generate template with AI

---

## 5. Syncing Implementation Details

### RealtimeContext Enhancement

Add new event types:

- `provider_change` - when provider added/updated
- `template_change` - when template saved

**Location**: [`apps/web/src/contexts/RealtimeContext.tsx`](apps/web/src/contexts/RealtimeContext.tsx)

Add new dispatch functions:

```typescript
dispatchProviderUpdate: (payload: ProviderUpdatePayload) => Promise<void>
dispatchTemplateUpdate: (payload: TemplateUpdatePayload) => Promise<void>
```

### Inventory Subscription Enhancement

Ensure Inventory.tsx properly subscribes to updates from:

- Orders page (delivery confirmation)
- Wine Library (add to inventory)
- Manual adjustments

---

## 6. Information Architecture Analysis

### Current Page Structure (16 pages)

```mermaid
flowchart TB
    subgraph Core["Core Operations"]
        Dashboard["Dashboard"]
        Inventory["Inventory"]
        WineLibrary["Wine Library"]
        Orders["Orders"]
    end
    
    subgraph Management["Management"]
        Providers["Providers"]
        Calendar["Calendar"]
        Reports["Reports"]
        RecurringOrders["Recurring Orders"]
    end
    
    subgraph Communication["Communication"]
        Communications["Communications/Templates"]
        Notifications["Notifications"]
        Documents["Documents"]
    end
    
    subgraph AI["AI Features"]
        SommelierAI["Sommelier AI"]
    end
    
    subgraph Admin["Administration"]
        AdminPanel["Admin Panel"]
        Onboarding["Onboarding"]
        Login["Login"]
        Register["Register"]
    end
```

### Data Flow Architecture

```mermaid
flowchart LR
    subgraph Frontend["Frontend State"]
        Local["localStorage"]
        Context["React Contexts"]
        Hooks["Custom Hooks"]
    end
    
    subgraph Sync["Sync Layer"]
        Realtime["RealtimeContext"]
        Events["Event System"]
    end
    
    subgraph Backend["Backend"]
        API["NestJS API"]
        Supabase["Supabase"]
        Agents["AI Agents"]
    end
    
    Local <--> Context
    Context <--> Hooks
    Hooks <--> Realtime
    Realtime <--> Events
    Events <--> API
    API <--> Supabase
    API <--> Agents
```

### Key Information Flows

| Data | Source | Destinations | Sync Method |

|------|--------|--------------|-------------|

| Wine Stock | Inventory | Dashboard, Wine Library, Orders | RealtimeContext |

| Orders | Orders | Inventory, Calendar, Dashboard | RealtimeContext |

| Providers | Providers | Orders, Wine Library | localStorage + API |

| Calendar Events | Calendar | Dashboard, Notifications | RealtimeContext |

| Templates | Communications | Reports, Notifications | localStorage |

---

## Implementation Priority

1. **High Priority** - Syncing fixes (Orders -> Inventory, Wine Library -> Inventory)
2. **Medium Priority** - Provider type button, Gmail template button
3. **Lower Priority** - Unified Edit Layout Component (larger refactor)

---

## Files to Create/Modify

| File | Action | Purpose |

|------|--------|---------|

| `AddProviderModal.tsx` | Modify | Add custom type functionality |

| `EditLayoutPanel.tsx` | Create | Unified edit component |

| `Reports.tsx` | Modify | Use EditLayoutPanel |

| `RealtimeContext.tsx` | Modify | Add new event types |

| `Communications.tsx` | Modify | Add template buttons |

| `Inventory.tsx` | Verify | Ensure subscriptions work |

| `Orders.tsx` | Verify | Ensure delivery sync works |
