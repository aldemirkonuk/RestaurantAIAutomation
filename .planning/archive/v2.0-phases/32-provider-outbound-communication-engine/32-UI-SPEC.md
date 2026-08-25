# Phase 32: Provider Outbound Communication Engine — UI Design Contract

**Gathered:** 2026-05-14
**Status:** Ready for planning
**Source:** Orchestrator inline (API limit fallback — research + patterns used directly)

---

## Overview

Phase 32 adds **three net-new UI surfaces** and **two small extensions** to existing pages. All are light extensions — no new routes, no new pages. The existing design system (Tailwind, Framer Motion, Lucide icons) applies throughout.

| Surface | Type | Analog | Status |
|---------|------|--------|--------|
| `DraftEmailApprovalPanel` | Modal overlay | `OrderApprovalModal.tsx` | NEW |
| `ProviderProfileForm` | Form section | `OrderApprovalModal.tsx` (layout only) | NEW |
| `IntelBadge` pill | Micro-component | `TypeBadge` in `Providers.tsx` | NEW |
| Provider card extension | Modify existing | `Providers.tsx` card | MODIFY |
| Order creation wiring | Behavior only | `Orders.tsx`/`CreateOrderModal` | MODIFY (no visual) |

---

## Component Contracts

### 1. DraftEmailApprovalPanel

**Purpose:** Manager reviews AI-drafted outbound email before it is sent to a provider. Approve / Edit inline / Discard.

**Trigger:** Notification of type `draft_ready` arrives → panel opens with draft data.

**Props interface:**
```typescript
interface DraftEmailData {
  conversationId: string
  orderId: string
  wineName: string
  providerName: string
  providerEmail: string
  emailType: 'PRICE_INQUIRY' | 'DEMAND_OFFER' | 'PROMO_INQUIRY' | 'WINE_INQUIRY'
  draftContent: string        // editable AI body
  disclaimer: string          // WineOps AI disclaimer — read-only, always shown
  constraintWarnings: Array<{ code: string; message: string; severity: 'annotating' | 'soft' }>
  roundCount: number
  timestamp: string
}
```

**Layout (top → bottom):**

| Zone | Content | Tailwind classes |
|------|---------|-----------------|
| Header | "✦ AI DRAFT READY" + email type badge + close × | `bg-indigo-900 px-6 py-5` |
| Metadata row | Provider name · email address · round count | `px-6 pt-4 text-sm text-gray-600` |
| Subject preview | Static subject line (wine name + email type) | `px-6 text-sm font-semibold text-gray-800` |
| Body area | AI-drafted text — `<textarea>` when editing, `<pre>` when previewing | `mx-6 rounded-lg border` |
| Edit toggle | "Edit Draft" / "Preview" button | `w-full h-11 bg-gray-700 text-white rounded-xl` |
| Constraint warnings | Yellow badge row (annotating) — only shown when present | `mx-6 bg-amber-50 border border-amber-200 rounded-lg p-3` |
| Disclaimer | Non-removable disclaimer block (read-only) | `mx-6 bg-gray-100 border border-gray-300 rounded-lg p-3` |
| Actions | 2-column grid: Send Draft (green) / Discard (red) | `mx-6 mb-6 grid grid-cols-2 gap-3` |

**Color tokens:**
- Header: `bg-indigo-900` — distinguishes from ORDER APPROVAL (`bg-black`)
- Send Draft: `bg-green-500 hover:bg-green-600`
- Discard: `bg-red-500 hover:bg-red-600`
- Edit toggle: `bg-gray-700 hover:bg-gray-800`
- Constraint warning: `bg-amber-50` / `text-amber-700`
- Disclaimer: `bg-gray-100` / `text-gray-500`

**Animation (copy from `OrderApprovalModal.tsx`):**
```typescript
// Backdrop
<motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
  className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">

// Panel
<motion.div initial={{ scale: 0.95, opacity: 0, y: 20 }}
  animate={{ scale: 1, opacity: 1, y: 0 }}
  exit={{ scale: 0.95, opacity: 0, y: 20 }}
  className="bg-white rounded-2xl shadow-2xl w-full max-w-lg border-2 border-indigo-900 overflow-hidden max-h-[90vh] overflow-y-auto">
```

**State machine:**
```
idle → draft_loaded → (editing | previewing) → (approved | discarded)
                                    ↑__________↓
```

**Email type badge mapping:**
```
PRICE_INQUIRY  → bg-blue-100   text-blue-700   "Price Inquiry"
DEMAND_OFFER   → bg-orange-100 text-orange-700 "Demand Offer"
PROMO_INQUIRY  → bg-purple-100 text-purple-700 "Promo Inquiry"
WINE_INQUIRY   → bg-teal-100   text-teal-700   "Wine Inquiry"
```

**Disclaimer section (non-removable D-32-08):**
```tsx
<div className="bg-gray-100 rounded-lg border border-gray-300 p-3 mt-3">
  <p className="text-[10px] text-gray-500 font-medium uppercase tracking-wide mb-1">
    Auto-appended disclaimer (required)
  </p>
  <p className="text-xs text-gray-600 italic whitespace-pre-line">
    {draftData.disclaimer}
  </p>
</div>
```

**Accessibility:**
- `role="dialog"` + `aria-labelledby="draft-panel-title"` on panel div
- Focus trap inside panel when open
- `Escape` key → `onClose()`

---

### 2. IntelBadge (micro-component)

**Purpose:** Show top 3 provider intelligence dimensions as pill badges on provider cards.

**Pattern:** Direct copy of `TypeBadge` in `Providers.tsx` (lines 47–59).

**Component:**
```typescript
function IntelBadge({ dimension }: { dimension: { key: string; label: string; value: string } }) {
  const cfg =
    dimension.key === 'response_speed'  ? { dot: 'bg-green-500',  bg: 'bg-green-50',  text: 'text-green-700'  } :
    dimension.key === 'negotiation'     ? { dot: 'bg-amber-500',  bg: 'bg-amber-50',  text: 'text-amber-700'  } :
    dimension.key === 'relationship'    ? { dot: 'bg-rose-500',   bg: 'bg-rose-50',   text: 'text-rose-700'   } :
                                          { dot: 'bg-gray-400',   bg: 'bg-gray-50',   text: 'text-gray-600'   }
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium ${cfg.bg} ${cfg.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot}`} />
      {dimension.label}: {dimension.value}
    </span>
  )
}
```

**Helper — top 3 from profile_dynamic:**
```typescript
function getTopIntelDimensions(profileDynamic: Record<string, any>) {
  // Priority order: response_speed, negotiation_style, relationship_tier
  const priority = ['response_speed', 'negotiation_style', 'relationship_tier']
  return priority
    .filter(k => profileDynamic[k])
    .map(k => ({
      key: k,
      label: k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      value: String(profileDynamic[k]).slice(0, 20),
    }))
    .slice(0, 3)
}
```

**Placement in provider card:**
```tsx
{/* Below existing TypeBadge — only shown if profile_dynamic has data */}
{provider.profile_dynamic && Object.keys(provider.profile_dynamic).length > 0 && (
  <div className="flex flex-wrap gap-1.5 mt-1.5">
    {getTopIntelDimensions(provider.profile_dynamic).map((dim) => (
      <IntelBadge key={dim.key} dimension={dim} />
    ))}
  </div>
)}
```

**Empty state CTA (when profile_foundational is empty `{}`):**
```tsx
{(!provider.profile_foundational || Object.keys(provider.profile_foundational).length === 0) && (
  <button
    onClick={() => openProfileForm(provider.id)}
    className="text-[11px] text-indigo-600 hover:text-indigo-800 underline mt-1"
  >
    + Fill intelligence profile
  </button>
)}
```

---

### 3. ProviderProfileForm

**Purpose:** Manager fills 5 foundational intelligence dimensions for a provider. Opens as a tab or section within the existing provider detail modal.

**Fields (D-32-09 foundational dimensions):**

| Field | Label | Input type | Tailwind |
|-------|-------|-----------|---------|
| `specialty_categories` | Specialty Categories | Multi-select pills or text tags | standard input |
| `primary_region` | Primary Region | Text input | standard input |
| `distribution_channel` | Distribution Channel | Select: Distributor / Direct Importer / Broker / Producer | `select` |
| `business_type` | Business Type | Select: Large Distributor / Small Portfolio / Boutique Importer / Winery Direct | `select` |
| `decision_maker_name` | Key Decision Maker | Text input (pre-filled from `provider_contacts` if `is_primary=true`) | standard input |
| `preferred_communication_style` | Communication Style | Select: Formal / Casual / Terse / Detailed | `select` |
| `typical_response_days` | Typical Response (days) | Number input 1–14 | `input[type=number]` |
| `net_payment_terms` | Net Payment Terms | Select: Net-7 / Net-14 / Net-30 / Net-45 / COD | `select` |
| `ships_on_days` | Ships On | Multi-checkbox: Mon Tue Wed Thu Fri | checkbox group |
| `notes` | Additional Notes | Textarea (max 500 chars) | `textarea` |

**Layout:**
- 2-column grid for short fields (distribution_channel, business_type, etc.)
- Full-width for specialty_categories and notes
- Save / Cancel buttons at bottom right
- Validation: all fields optional (partial profile is fine)

**Save behavior:**
- `PATCH /api/v1/providers/:id/intelligence` with `{ profile_foundational: formValues }`
- On success: invalidate React Query `providers` cache, show toast "Intelligence profile saved"

**Design tokens:**
- Container: `bg-white rounded-xl p-6`
- Section title: `text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3`
- Labels: `text-sm font-medium text-gray-700`
- Inputs: `w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500`
- Save button: `bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-4 py-2 rounded-lg`
- Cancel: `text-gray-600 hover:text-gray-800 font-medium px-4 py-2 rounded-lg`

---

## Design Tokens

All tokens from the existing design system — no new tokens needed.

| Token | Value | Usage |
|-------|-------|-------|
| `bg-indigo-900` | Deep indigo | DraftEmailApprovalPanel header (NEW — distinct from ORDER APPROVAL black) |
| `bg-green-500` | Green | Send Draft button |
| `bg-red-500` | Red | Discard button |
| `bg-amber-50` / `text-amber-700` | Amber | Constraint warning blocks |
| `bg-gray-100` / `text-gray-500` | Gray | Disclaimer section (read-only) |
| `z-[100]` | z-index 100 | Panel overlay (matches OrderApprovalModal z-index) |
| `rounded-2xl` | 16px | Panel border-radius (matches OrderApprovalModal) |
| `shadow-2xl` | Extra shadow | Panel elevation (matches OrderApprovalModal) |

---

## Interaction States

### DraftEmailApprovalPanel

| State | Visual | Notes |
|-------|--------|-------|
| Loading | Spinner in body area | Panel opens while draft is fetched |
| Previewing | `<pre>` with draft content | Default state |
| Editing | `<textarea>` with draft content (pre-filled) | Toggle via "Edit Draft" button |
| Submitting | Buttons disabled, spinner | After Approve/Discard click |
| Error | Toast: "Failed to send draft — please retry" | API call fails |
| Constraint warning | Amber block visible | When `constraintWarnings.length > 0` |

### Provider Card (Providers.tsx)

| State | Visual |
|-------|--------|
| Profile filled | IntelBadge pills shown (top 3 dimensions) |
| Profile empty | "+ Fill intelligence profile" text link |
| Profile partial | Show only populated badges |

---

## Accessibility

- All modals: `role="dialog"`, `aria-modal="true"`, focus trap, `Escape` to close
- Form fields: `<label htmlFor>` for all inputs
- Buttons: `aria-disabled` when `isSubmitting`
- Constraint warnings: `role="alert"` on warning block
- Disclaimer: `aria-label="Non-removable WineOps AI disclaimer"`

---

## Out of Scope

- New routes or pages
- Redesign of existing Orders or Providers pages
- SMS interface (D-32-13 — future wave)
- Analytics dashboard for email performance
- Paid-tier gate UI (planned note in Phase 31 — out of scope here)

---

## ## UI-SPEC VERIFIED

**Dimensions:**
- ✓ Component structure (3 new components, 2 extensions)
- ✓ Design token consistency (existing system)
- ✓ Animation contracts (AnimatePresence / motion.div from OrderApprovalModal)
- ✓ State machines (DraftEmailApprovalPanel 5-state)
- ✓ Accessibility (role, aria, focus trap, Escape)
- ✓ Scope boundaries (no new routes, light extensions only)

*Phase: 32-provider-outbound-communication-engine*
*UI-SPEC gathered: 2026-05-14 via Orchestrator inline*
