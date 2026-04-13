# Order Grouping & Categorization Feature

**Date:** January 10, 2026  
**Status:** ✅ Complete  
**Files Modified:** `apps/web/src/pages/Orders.tsx`

---

## Overview

Implemented a sophisticated **multi-functional categorization system** for the Orders page that allows managers to view orders grouped by either **Wine** or **Provider**, with expandable/collapsible sections showing detailed order tickets.

---

## Features Implemented

### 1. **Group By Toggle**

**Location:** Below the filter tabs, above the orders list

**Options:**
- **Group by Wine** 🍷
  - Main header shows wine name (e.g., "2019 Cabernet Sauvignon Napa Valley Reserve")
  - Expandable section shows all orders/tickets for that wine
  - Each ticket displays the provider, quantity, price, and status
  
- **Group by Provider** 🏢
  - Main header shows provider name (e.g., "Breakthru Beverage Group")
  - Expandable section shows all orders/tickets from that provider
  - Each ticket displays the wine name, quantity, price, and status

### 2. **Group Header Design**

Each group header displays:
- **Expand/Collapse Arrow:** Animated chevron that rotates 90° when expanded
- **Icon:** Wine glass icon for wine groups, building icon for provider groups
- **Group Name:** Large, bold title (wine name or provider name)
- **Summary Stats:**
  - Total number of orders
  - Total bottles across all orders
  - Total value of all orders (sum of quantity × price)
- **Status Badges:** Quick visual indicators
  - Yellow badge for pending approvals
  - Green badge for approved orders

**Visual Design:**
- Glassmorphism card style (consistent with app theme)
- Hover effect on header (subtle gray background)
- Wine-themed colors (wine-red accents)
- Smooth animations using Framer Motion

### 3. **Expandable Order List**

When a group is clicked:
- **Smooth Animation:** Height and opacity transition (300ms)
- **Nested Order Cards:** Each order displayed as a compact card with:
  - **Status icon** (colored wine glass icon)
  - **Complementary information:**
    - If grouped by wine → shows provider name
    - If grouped by provider → shows wine name
  - **Order ID** (truncated to 8 characters)
  - **Status badge** (colored pill with label)
  - **Order Details Grid:**
    - Quantity (bottles)
    - Price per bottle
    - Total value (wine-red color)
    - Created date
  - **Action Buttons:**
    - For pending orders: "Approve" (green) & "Reject" (red)
    - For delivered orders: "Confirm Delivery" (emerald)

### 4. **State Management**

**New State Variables:**
```typescript
const [groupBy, setGroupBy] = useState<'wine' | 'provider'>('wine')
const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
```

**Functions:**
- `groupedOrders()`: Groups filtered orders by wine name or provider name
- `toggleGroup(groupName)`: Adds/removes group from expanded set

**Behavior:**
- Switching between "Group by Wine" and "Group by Provider" automatically collapses all groups
- Groups remain expanded when filtering by status
- Each group can be independently expanded/collapsed

---

## UI/UX Enhancements

### Visual Hierarchy
1. **Top Level:** Filter tabs + Create Order button
2. **Second Level:** Group By toggle (Wine/Provider)
3. **Third Level:** Group headers (clickable, summary stats)
4. **Fourth Level:** Individual order tickets (detailed info, actions)

### Animations
- **Group expand/collapse:** Smooth height/opacity transition
- **Chevron rotation:** 0° → 90° when expanded
- **Card entrance:** Fade-in with slight upward motion
- **Layout shifts:** Smooth with `layout` prop from Framer Motion

### Color Coding
- **Wine-themed:** Primary wine-red (#991B1B) for accents
- **Status colors:**
  - Pending: Yellow (#FEF3C7 background, #92400E text)
  - Approved: Green (#D1FAE5 background, #065F46 text)
  - Delivered: Emerald (#10B981)
- **Hover states:** Gray-50 background for interactivity

---

## Technical Implementation

### Grouping Logic

```typescript
const groupedOrders = () => {
  if (groupBy === 'wine') {
    // Group by wine_name
    const groups: { [key: string]: Order[] } = {}
    filteredOrders.forEach(order => {
      const wineName = order.wine_name || 'Unknown Wine'
      if (!groups[wineName]) groups[wineName] = []
      groups[wineName].push(order)
    })
    return groups
  } else {
    // Group by provider_name
    const groups: { [key: string]: Order[] } = {}
    filteredOrders.forEach(order => {
      const providerName = order.provider_name || 'Unknown Provider'
      if (!groups[providerName]) groups[providerName] = []
      groups[providerName].push(order)
    })
    return groups
  }
}
```

### Stats Calculation

For each group:
- **Total orders:** `groupOrders.length`
- **Total bottles:** `groupOrders.reduce((sum, order) => sum + order.quantity, 0)`
- **Total value:** `groupOrders.reduce((sum, order) => sum + (order.quantity * order.final_price), 0)`
- **Pending count:** `groupOrders.filter(o => o.status === 'pending_approval').length`
- **Approved count:** `groupOrders.filter(o => o.status === 'approved').length`

### Empty State

Updated to check for grouped orders:
```typescript
{Object.keys(groupedOrders()).length === 0 && (
  <Card variant="glass" padding="lg">
    <div className="text-center py-12">
      {/* Empty state UI */}
    </div>
  </Card>
)}
```

---

## User Workflow

### Scenario 1: Manager reviewing orders by wine
1. Manager selects **"Group by Wine"** (default)
2. Sees list of wine names with summary stats
3. Clicks on "2019 Cabernet Sauvignon" to expand
4. Reviews all orders for that wine from different providers:
   - Order from Breakthru: 12 bottles @ $45.00
   - Order from Wine.com: 6 bottles @ $47.50
   - Order from K&L Wines: 24 bottles @ $43.00
5. Approves the best-priced order from K&L Wines
6. Collapses the group and moves to next wine

### Scenario 2: Manager reviewing orders by provider
1. Manager switches to **"Group by Provider"**
2. Sees list of provider names with summary stats
3. Clicks on "Breakthru Beverage Group" to expand
4. Reviews all orders from Breakthru across different wines:
   - 2019 Cabernet Sauvignon: 12 bottles @ $45.00
   - 2020 Pinot Noir: 18 bottles @ $32.00
   - 2018 Chardonnay: 6 bottles @ $28.50
5. Bulk approves multiple orders from trusted provider
6. Collapses and reviews next provider

---

## Benefits

✅ **Organized View:** No more scrolling through long, unstructured lists  
✅ **Quick Comparison:** Easy to compare prices/quantities for same wine across providers  
✅ **Provider Analysis:** See all dealings with a specific provider at once  
✅ **Better Decision Making:** Summary stats help managers prioritize reviews  
✅ **Reduced Cognitive Load:** Collapsible groups minimize visual clutter  
✅ **Flexibility:** Toggle between two perspectives based on task at hand  

---

## Future Enhancements (Optional)

1. **Sort Options within Groups:**
   - By date (newest/oldest first)
   - By price (lowest/highest first)
   - By quantity (largest/smallest first)

2. **Bulk Actions:**
   - "Approve All" button at group level
   - "Reject All" with reason

3. **Filtering within Groups:**
   - Show only pending orders within a group
   - Hide delivered orders

4. **Advanced Stats:**
   - Average price per bottle across group
   - Price variance/range
   - Delivery time comparison

5. **Export Grouped Data:**
   - Export specific group as CSV/PDF
   - Generate provider performance report

---

## Testing Checklist

- [x] Toggle between Wine and Provider grouping
- [x] Expand/collapse groups individually
- [x] All groups auto-collapse when switching grouping mode
- [x] Summary stats calculate correctly
- [x] Status badges reflect accurate counts
- [x] Action buttons work within nested cards
- [x] Animations are smooth and responsive
- [x] Empty state displays when no orders match filter
- [x] Layout remains stable during expand/collapse
- [x] Mobile responsive (cards stack properly)

---

## Code Quality

- ✅ No linter errors
- ✅ TypeScript strict mode compliant
- ✅ Proper state management
- ✅ Reusable grouping logic
- ✅ Consistent with app design system
- ✅ Accessible (ARIA labels, keyboard navigation)

---

## Related Files

- **Component:** `apps/web/src/pages/Orders.tsx`
- **Types:** Order interface includes `wine_name` and `provider_name`
- **Icons:** `Wine`, `Building2`, `ChevronRight` from lucide-react
- **Animation:** Framer Motion for smooth transitions

---

**Implementation Complete!** 🎉

The Orders page now provides managers with powerful categorization tools to efficiently review, compare, and manage wine procurement orders.

