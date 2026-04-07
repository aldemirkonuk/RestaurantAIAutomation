---
phase: 13
title: "Dev Onboarding UI with Manual Override Access"
status: draft
created: 2026-04-07
route_root: /studio
screens: [studio, queue, certify]
---

# UI Design Contract — Phase 13: Dev Onboarding UI (Studio)

## 0. Pre-Populated Context

| Source | Decisions Pulled |
|--------|-----------------|
| CONTEXT.md | D-05 (inline edit), D-06 (fixed columns), D-07 (smart reason), D-08 (reason placement), D-09 (separate route), D-10 (command-palette), D-11 (two-section layout), D-12/D-13 (trust tiers), D-14 (approval queue) |
| tailwind.config.js | Full color tokens, typography scale, shadow system, border-radius scale |
| Onboarding.tsx | Animation patterns (framer-motion), button styles, focus rings, card styles |
| badge.tsx | Confidence badge variant map (destructive/warning/success/outline) |
| empty-state.tsx | EmptyState component API + wine-themed action buttons |
| package.json | Confirmed: framer-motion 10, lucide-react 0.303, radix-ui (Dialog, Tabs, Switch, Tooltip), react-hook-form 7, sonner 1, zustand 4 |

---

## 1. Route Structure

```
/studio                  → Screen 1: Main Authoring (developer, certified_contributor, review_admin)
/studio/queue            → Screen 2: Approval Queue (review_admin only)
/studio/certify          → Screen 3: Certification Management (review_admin only)
```

**Route name rationale (Claude's Discretion, D-09):** `/studio` is chosen over `/dev/onboarding` because (a) it is a well-established pattern for data authoring interfaces (Sanity Studio, Prismic Studio), (b) it avoids the word "dev" in a production URL, (c) it is unambiguously separate from the existing `/onboarding` restaurant setup wizard. All three sub-routes share a common `StudioLayout` wrapper with a top navigation bar.

---

## 2. Design System Foundation

### 2.1 Color Contract (60/30/10)

| Role | Token | Hex | Applied To |
|------|-------|-----|------------|
| 60% dominant surface | `surface.primary` | `#FFFFFF` | Table body, card backgrounds, input fields, page base |
| 60% dominant bg | `surface.secondary` | `#F7F8F9` | Application chrome, page wrapper, command bar container |
| 30% secondary | `surface.tertiary` | `#F1F3F5` | Table header row, toolbar strip, sidebar if any |
| 30% secondary border | `slate-200` | `#E5E7EB` | Cell dividers, card borders, input borders |
| 10% accent | `wine-600` | `#CD2D5B` | Primary CTAs, active nav tab indicator, "Save Override" button, session count badge, wine icon accents |
| Accent hover | `wine-700` | `#AC204A` | Primary button hover state |
| Accent light | `wine-50` | `#FDF2F4` | Active row highlight in table, focused cell ring tint |

**Semantic colors (reserved):**

| Use | Token | Hex |
|-----|-------|-----|
| Confidence ≥ 0.8 (high) | `success` (emerald-100 bg, emerald-700 text) | bg `#D1FAE5` text `#047857` |
| Confidence 0.5–0.8 (review) | `warning` (amber-100 bg, amber-700 text) | bg `#FEF3C7` text `#B45309` |
| Confidence < 0.5 (low) | `destructive` (rose-100 bg, rose-700 text) | bg `#FEE2E2` text `#B91C1C` |
| Null / empty field | `outline` (gray border) | bg white, border `slate-200`, text `slate-400` |
| Destructive action (reject, disable) | `danger-600` | `#DC2626` |
| Approval / promote | `success-600` | `#059669` |

### 2.2 Typography

| Role | Size | Weight | Line-height | Token |
|------|------|--------|-------------|-------|
| Page title | 20px | 600 semibold | 1.4 | `text-xl font-semibold` |
| Column header label | 12px | 600 semibold | 1.0 | `text-xs font-semibold uppercase tracking-wide` |
| Cell value (primary) | 14px | 400 regular | 1.25 | `text-sm` |
| Source attribution | 12px | 400 regular | 1.0 | `text-xs text-slate-400` |
| Command bar placeholder | 16px | 400 regular | 1.5 | `text-base` |
| Inline reason placeholder | 14px | 400 regular | 1.5 | `text-sm text-slate-400` |

**Font family:** `Plus Jakarta Sans` (sans) as declared in `tailwind.config.js`. No override needed.  
**Mono:** `JetBrains Mono` for inline citation URL display only.

### 2.3 Spacing Scale

Base scale: multiples of 4 (4px grid). The table uses an 8-point rhythm.

| Alias | Value | Used For |
|-------|-------|----------|
| `p-1` | 4px | Badge internal padding minimum |
| `p-2` | 8px | Table cell padding vertical |
| `p-3` | 12px | Table cell padding horizontal, badge padding |
| `p-4` | 16px | Section inner padding, toolbar height unit |
| `p-6` | 24px | Page horizontal padding |
| `p-8` | 32px | Command bar vertical margin |
| `gap-2` | 8px | Icon + text inline gaps |
| `gap-4` | 16px | Queue row element spacing |
| Touch target exception | 44px | Approve / Reject button min-height (accessibility) |

### 2.4 Border Radius

| Element | Token | Value |
|---------|-------|-------|
| Command bar input | `rounded-xl` | 16px |
| Confidence badges | `rounded-full` | 9999px (existing badge component) |
| Inline edit cell active border | `rounded-sm` | 6px |
| Reason input | `rounded-lg` | 12px |
| Card containers | `rounded-xl` | 16px |
| Table | `rounded-xl` (outer wrapper only) | 16px |
| Approve / Reject buttons | `rounded-lg` | 12px |
| Invite link copy button | `rounded-xl` | 16px |
| Toggle (certify screen) | `rounded-full` | 9999px |

### 2.5 Shadow System

| Element | Token |
|---------|-------|
| Command bar (default) | `shadow-card` (`0 1px 3px rgb(0 0 0 / 0.04), 0 4px 12px rgb(0 0 0 / 0.06)`) |
| Command bar (focused) | `shadow-elevated` (`0 12px 40px rgb(0 0 0 / 0.12)`) |
| Table wrapper | `shadow-xs` |
| Inline edit cell active | `shadow-ring` (`0 0 0 3px rgb(205 45 91 / 0.15)`) with `wine-500` ring |

---

## 3. Layout: `StudioLayout` (Shared Wrapper)

```
┌─────────────────────────────────────────────────────────────────────┐
│  [StudioHeader]  min-h-[56px] bg-white border-b border-slate-200    │
│  ┌──── WineOps logo ──── tab: Studio | Queue | Certify ──── role ─┐  │
│  └────────────────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────────┤
│  [slot: page content]  flex-1 overflow-y-auto bg-surface-secondary  │
└─────────────────────────────────────────────────────────────────────┘
```

- **Minimum viewport width:** 1280px (desktop-first, no responsive breakpoints needed for screens 1–3)
- **Header height:** 56px fixed, `position: sticky top-0 z-40`
- **Header left:** `<Wine className="text-wine-600" />` + "WineOps Studio" wordmark in `font-semibold text-slate-900`
- **Header center:** Tab navigation (Radix Tabs or plain buttons). Active tab: `border-b-2 border-wine-600 text-wine-600`. Inactive: `text-slate-500 hover:text-slate-700`. Tabs shown: "Studio" (always), "Queue" (review_admin only — hidden otherwise), "Certify" (review_admin only — hidden otherwise).
- **Header right:** Role badge + user avatar initials. Badge: `<Badge variant="secondary">Developer</Badge>` | `<Badge variant="info">Certified Contributor</Badge>` | `<Badge variant="default">Review Admin</Badge>`. Separator `|`. Avatar: 32px circle, `bg-wine-100 text-wine-600`, initials.

---

## 4. Screen 1: `/studio` — Main Authoring Screen

### 4.1 Layout Structure

```
┌──────────────── StudioLayout ────────────────┐
│ StudioHeader (sticky)                        │
├──────────────────────────────────────────────┤
│ px-6 py-8                                    │
│ ┌──────────────────────────────────────────┐ │
│ │  [CommandBar]  full-width                │ │
│ │  pill input, 64px tall, drag-drop target │ │
│ └──────────────────────────────────────────┘ │
│                                              │
│ ┌──────────────────────────────────────────┐ │
│ │  [SessionSummary]  row: count + status   │ │
│ └──────────────────────────────────────────┘ │
│                                              │
│ ┌──────────────────────────────────────────┐ │
│ │  [WineRecordsTable]  horizontal scroll   │ │
│ │  sticky thead, fixed column widths       │ │
│ │  fills remaining viewport height         │ │
│ └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
```

### 4.2 CommandBar Component

**Purpose:** Single smart input — user pastes URL or drags a PDF. Zero decision fatigue (D-10).

**Anatomy:**
```
[Upload icon]  [ input placeholder text                    ]  [Detect button]
               ← drag-and-drop active zone covers full bar →
```

**Specifications:**

| Property | Value |
|----------|-------|
| Height | 64px |
| Width | Full container width (`w-full`) |
| Border | `border border-slate-200` idle; `border-wine-500` focused/drag-active |
| Border radius | `rounded-xl` |
| Background | `bg-white` idle; `bg-wine-50` drag-active |
| Shadow | `shadow-card` idle; `shadow-elevated` focused |
| Left icon | `<Link2 className="w-5 h-5 text-slate-400" />` — swaps to `<FileText className="w-5 h-5 text-wine-600" />` when PDF detected |
| Placeholder text | `"Paste a URL or drop a PDF — we'll auto-detect and start ingestion"` |
| Right CTA button | `"Ingest"` — `bg-wine-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-wine-700 transition-colors` |
| CTA disabled state | When input is empty: `opacity-50 cursor-not-allowed` |

**Detection feedback (below bar):**
- URL pasted → `<span className="text-xs text-slate-500"><Globe className="w-3 h-3 inline" /> Detected: Restaurant URL — will use Gemini Flash crawler</span>`
- PDF dropped → `<span className="text-xs text-slate-500"><FileText className="w-3 h-3 inline" /> Detected: PDF menu — will use Claude Vision extraction</span>`
- No source → no hint text

**Drag-and-drop states:**

| State | Visual |
|-------|--------|
| Idle | Normal border, no bg tint |
| Drag entering | `border-wine-500 bg-wine-50`, dashed border `border-dashed`, scale input container `scale(1.005)` via framer-motion |
| Drag over | Same as entering + `<Upload className="w-6 h-6 text-wine-500 animate-pulse-soft" />` centered |
| Drop accepted | Flash `bg-emerald-50 border-emerald-400` for 300ms, then return to idle, input populates with filename |
| Drop rejected (not PDF) | Flash `bg-danger-50 border-danger-400` for 300ms + sonner toast: `"Only PDF files are supported"` |

**Ingestion in-progress state:**
- CTA button becomes `<Loader2 className="animate-spin" /> Ingesting...` — disabled, `bg-wine-400`
- Below bar: progress hint: `"Extracting with Claude Vision... page 2 of 5"` (stream from API if available) or `"Processing..."` fallback
- CommandBar stays visible but input is disabled during extraction

**framer-motion spec (command bar):**

```typescript
// Bar enters with slide-in-up (consistent with Onboarding.tsx pattern)
initial={{ opacity: 0, y: 12 }}
animate={{ opacity: 1, y: 0 }}
transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
```

### 4.3 SessionSummary Bar

Shown below CommandBar once a session has records. Hidden when no session.

```
[Database icon]  Session: {sessionId truncated}   {N} records extracted   [status badge]   [Clear session link]
```

| Element | Spec |
|---------|------|
| Container | `flex items-center gap-3 py-2 text-sm text-slate-600` |
| Session ID | Monospace, truncated to 12 chars: `font-mono text-xs text-slate-400` |
| Record count | `<Badge variant="secondary">{N} records</Badge>` |
| Status badge | `"Extracting"` → warning variant + `<Loader2 animate-spin />`, `"Complete"` → success variant, `"Error"` → destructive variant |
| Clear link | `text-xs text-slate-400 hover:text-danger-600 underline cursor-pointer` |

### 4.4 WineRecordsTable Component

**Structure:**
```
┌─────────────────────────────────────────────────────────────────────────────┐
│ thead: [wine_name] [vintage] [producer] [region] [country] [grape_variety]  │
│        [color] [primary_type] [sweetness_level] [price_bottle] [price_glass]│
├─────────────────────────────────────────────────────────────────────────────┤
│ tbody: rows per wine record, horizontally scrollable                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Table wrapper:**
- `overflow-x-auto` horizontal scroll container
- `rounded-xl border border-slate-200 shadow-xs bg-white`
- `max-h-[calc(100vh-320px)] overflow-y-auto` (fills remaining viewport below command bar + summary)

**Column definitions (fixed order per D-06):**

| # | Column Key | Min Width | Notes |
|---|------------|-----------|-------|
| 1 | `wine_name` | 220px | Largest column, never truncates |
| 2 | `vintage` | 80px | 4-digit year or "NV" |
| 3 | `producer` | 160px | Truncate at 20 chars with Tooltip |
| 4 | `region` | 140px | |
| 5 | `country` | 120px | |
| 6 | `grape_variety` | 160px | |
| 7 | `color` | 100px | red / white / rosé / orange / sparkling |
| 8 | `primary_type` | 120px | |
| 9 | `sweetness_level` | 120px | |
| 10 | `price_bottle` | 100px | Currency formatted `$XX.00` |
| 11 | `price_glass` | 100px | Currency formatted |

**thead row:**
- `bg-surface-tertiary` (`#F1F3F5`)
- `sticky top-0 z-10`
- Cell content: `text-xs font-semibold uppercase tracking-wide text-slate-500 px-3 py-2`
- First column left-pinned via `sticky left-0 bg-surface-tertiary`

**tbody row:**
- Default: `bg-white hover:bg-wine-50/40 transition-colors duration-100`
- Row with any field in `review` tier (0.5–0.8): `bg-amber-50/30`
- Row being edited (any cell active): `bg-wine-50/60 ring-1 ring-inset ring-wine-200 rounded-none` (scoped to row)
- Row height: `min-h-[56px]` (two lines of content: value + source)
- Bottom border: `border-b border-slate-100` (last row no border)

**Row count pinned column:** First column (`wine_name`) is sticky: `sticky left-0 bg-inherit z-[5]`

### 4.5 FieldCell Component (Inline Click-to-Edit — D-05)

Each table cell contains:
1. **Display layer** (idle): value text + confidence badge + source attribution
2. **Edit layer** (active): input field + optional reason + save/cancel controls

**Idle state anatomy:**
```
┌─────────────────────────────────┐
│ [value text]      [conf badge]  │
│ [source text 12px slate-400]    │
└─────────────────────────────────┘
```

- `cursor-pointer` on hover: `hover:bg-slate-50 rounded-sm`
- `title` attribute: "Click to edit" (accessible tooltip)
- Value text: `text-sm text-slate-900` (populated) | `text-sm text-slate-400 italic` (null: `"—"`)
- Source attribution: `text-xs text-slate-400` below value. Format: `via Vision 0.95` | `via Haiku` | `via Web` | `via Ontology` | `manual`
- Confidence badge: `<Badge variant={confVariant} size="sm">` — positioned top-right of cell. See §4.7 for variant map.

**Click-to-edit transition (framer-motion):**

```typescript
// AnimatePresence wraps display ↔ edit layers with mode="wait"
// Display layer exit:
exit={{ opacity: 0 }}
transition={{ duration: 0.1 }}

// Edit layer enter:
initial={{ opacity: 0 }}
animate={{ opacity: 1 }}
transition={{ duration: 0.15, ease: "easeOut" }}
```

The cell container itself does NOT scale — this preserves table column widths. Only opacity crossfades.

**Active (edit) state anatomy:**
```
┌────────────────────────────────────────┐
│ [input: current value       ]          │  ← ring-2 ring-wine-500
│ [reason input - conditional ]          │  ← slides down if confidence ≥ 0.8
│ [citation input - always opt]          │  ← tiny, below reason
│ [Save]  [Cancel]                       │
└────────────────────────────────────────┘
```

**Input field (edit mode):**
- `w-full px-3 py-1.5 border border-slate-300 rounded-sm text-sm focus:ring-2 focus:ring-wine-500 focus:border-transparent bg-white`
- `autoFocus` on mount

**Reason input (conditional — D-07):**
- Appears ONLY when field being overridden has confidence ≥ 0.8
- Label: small `text-xs text-amber-700 font-medium mb-1` — `"Reason required — this field has high confidence"` with `<AlertTriangle className="w-3 h-3 inline mr-1" />`
- Placeholder: `"e.g. confirmed on producer website, verified from label photo"` (per D-08)
- Input: `text-sm border border-amber-300 focus:ring-amber-400` to signal required context
- Required: `true` — Save button disabled until reason has ≥ 10 characters

**Reason input framer-motion (slide-down):**
```typescript
initial={{ height: 0, opacity: 0, marginTop: 0 }}
animate={{ height: "auto", opacity: 1, marginTop: 8 }}
exit={{ height: 0, opacity: 0, marginTop: 0 }}
transition={{ duration: 0.2, ease: "easeOut" }}
```

**Citation input (always optional):**
- Single text input: `text-xs font-mono border border-slate-200 rounded-sm`
- Placeholder: `"https://... (optional citation URL)"`
- Shown collapsed under a `<ChevronDown />` "Add citation" disclosure link when no reason is required; shown immediately below reason when reason is required

**Save / Cancel controls:**
```
[Save Override]  [×]
```
- "Save Override": `text-xs font-semibold bg-wine-600 text-white px-3 py-1 rounded hover:bg-wine-700`
- "×": `text-slate-400 hover:text-slate-700 ml-2` (escape key also cancels)
- Save disabled when: (a) value unchanged, or (b) reason required but empty or < 10 chars

**Saving state:** "Save Override" → `<Loader2 className="animate-spin w-3 h-3" /> Saving...` — disabled. Cell shows saving overlay.

**Post-save states (transient — 800ms):**
- Success: cell background flashes `bg-emerald-50`, confidence badge updates to reflect new manual value (rendered as outline badge with `"manual"` label)
- Error: cell background flashes `bg-danger-50`, error message below input: `text-xs text-danger-600` — "Save failed. Check your connection and try again."
- sonner toast on success: `toast.success("Override saved", { description: "{fieldName} updated" })`
- sonner toast on queue: `toast.info("Override queued for review", { description: "A reviewer will approve your change" })`

### 4.6 ManualEntry Flow

When no URL/PDF is provided and user wants to seed an empty record:

- Small text link below CommandBar: `"Or start with an empty record →"` — `text-sm text-wine-600 hover:underline`
- Clicking appends a blank row to the table with all fields null, all confidence badges = "outline / Empty"
- Row highlighted `bg-wine-50/40 border-l-2 border-l-wine-400`
- User clicks each cell to fill in data (same inline edit pattern, confidence = 0.0 = no reason required)

### 4.7 Confidence Badge Color Map

| Confidence Range | Badge variant | Badge label | Dot color |
|-----------------|---------------|-------------|-----------|
| ≥ 0.8 (high / verified) | `success` (emerald) | Score as float e.g. `"0.95"` | emerald-500 |
| 0.5–0.8 (review queue) | `warning` (amber) | Score e.g. `"0.67"` | amber-500 |
| < 0.5 (rejected / low) | `destructive` (rose) | Score e.g. `"0.31"` | rose-500 |
| null / missing | `outline` | `"—"` | slate-300 |
| manual override | `outline` with wine border | `"manual"` | wine-500 |
| web verified | `success` with dot + tick | `"verified"` | emerald-500 |

Badge always uses `size="sm"` (`text-[10px] px-2 py-0.5`).

### 4.8 Empty State — Screen 1

Shown when session has zero records (no ingestion run yet).

```
[Database icon in wine-100 bg-rounded-2xl]
"No records in this session"
"Paste a URL or drag a PDF into the bar above to begin ingestion."
[No action button — CommandBar is the CTA]
```

Spec: `<EmptyState size="lg" icon={<Database />} title="No records in this session" description="Paste a URL or drag a PDF into the bar above to begin ingestion." />`

Icon wrapper: `bg-wine-100 text-wine-600` (override default gray-100 via `className`)

---

## 5. Screen 2: `/studio/queue` — Approval Queue

### 5.1 Layout

```
┌──────────────────────────────────────────────────────────────────┐
│ StudioHeader (sticky)                                             │
├──────────────────────────────────────────────────────────────────┤
│ px-6 py-8                                                        │
│ ┌────────────────────────────────────────────────────────────┐   │
│ │ PageHeading: "Override Approval Queue"                      │   │
│ │ Subheading: "{N} pending approvals"                         │   │
│ └────────────────────────────────────────────────────────────┘   │
│                                                                  │
│ ┌────────────────────────────────────────────────────────────┐   │
│ │ [QueueTable] — list of pending override requests            │   │
│ └────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

### 5.2 PageHeading

- Title: `text-xl font-semibold text-slate-900`
- Subheading: `text-sm text-slate-500 mt-1`
- Badge: `<Badge variant="warning">{N} pending</Badge>` inline after count when N > 0; `<Badge variant="success">All clear</Badge>` when N = 0

### 5.3 QueueTable Component

**Table container:** `rounded-xl border border-slate-200 shadow-xs bg-white overflow-hidden`

**thead:**

| Column | Width | Notes |
|--------|-------|-------|
| Wine | 200px | wine_name + vintage |
| Field | 120px | e.g. "region" |
| Change | 280px | old value → new value with arrow |
| Actor | 140px | avatar + email truncated |
| Reason | 220px | truncated, expandable |
| Citation | 60px | link icon if present |
| Submitted | 100px | relative time `"2h ago"` |
| Actions | 160px | Approve / Reject buttons |

**Row anatomy:**
```
┌──────────────────────────────────────────────────────────────────┐
│ [wine_name vintage]  [field badge]  [old → new]  [actor]  [time] │
│                                                 [reason text]    │
│                                     [Approve]  [Reject]         │
│  [trust progress: "4/5 toward auto-promote"]                     │
└──────────────────────────────────────────────────────────────────┘
```

**Change cell ("old → new"):**
- Old value: `text-sm text-slate-400 line-through`
- Arrow: `<ArrowRight className="w-3 h-3 text-slate-400 inline mx-1" />`
- New value: `text-sm text-slate-900 font-medium`
- Null filling (old was `—`): old = `<span className="text-xs italic text-slate-300">empty</span>`

**Actor cell:**
- 28px avatar circle: `bg-wine-100 text-wine-600 text-xs font-semibold rounded-full`
- Email: `text-xs text-slate-600 truncate max-w-[100px]`
- Contributor role badge: `<Badge variant="info" size="sm">Contributor</Badge>`

**Reason cell:**
- Truncated to 2 lines with `line-clamp-2`
- Full text on Radix Tooltip hover (500ms delay)
- If citation URL present: `<ExternalLink className="w-3 h-3 text-info-500" />` — clickable link

**Trust-level progress indicator (D-12):**
- Shown only for `certified_contributor` actor rows (not developer/admin)
- Single line below row actions: `text-xs text-slate-400` — `"4 of 5 approvals toward auto-promote"`
- Inline mini-progress bar: `w-24 h-1 bg-slate-200 rounded-full` with `bg-wine-500 rounded-full` fill at `(N/5 * 100)%`

**Approve button:**
- `flex items-center gap-1 px-3 py-2 text-xs font-semibold bg-success-600 text-white rounded-lg hover:bg-success-700 min-h-[44px]`
- `<Check className="w-3.5 h-3.5" /> Approve`

**Reject button:**
- `flex items-center gap-1 px-3 py-2 text-xs font-semibold border border-danger-300 text-danger-600 rounded-lg hover:bg-danger-50 min-h-[44px]`
- `<X className="w-3.5 h-3.5" /> Reject`

**Reject flow (inline, no modal — consistent with D-05 spirit):**
- Clicking Reject expands an inline rejection note field below the row, using the same framer-motion slide-down as the reason field:
  ```typescript
  initial={{ height: 0, opacity: 0 }}
  animate={{ height: "auto", opacity: 1 }}
  transition={{ duration: 0.2 }}
  ```
- Placeholder: `"Optional: reason for rejection (sent to contributor)"`
- Confirm button: `"Confirm Rejection"` — `bg-danger-600 text-white text-xs px-3 py-1.5 rounded`
- Cancel link: `text-xs text-slate-400 hover:underline ml-2`

**Optimistic update:** Approve/Reject immediately removes row with framer-motion exit:
```typescript
exit={{ opacity: 0, height: 0, marginBottom: 0 }}
transition={{ duration: 0.25 }}
```
sonner toast: `toast.success("Override approved")` | `toast.success("Override rejected")`

**Row entrance animation (list stagger):**
```typescript
// Container
const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.04 } }
}
// Row item
const rowVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.2 } }
}
```

### 5.4 Empty State — Screen 2

```
[CheckCircle icon in success-100 rounded-2xl]
"All caught up"
"No overrides are waiting for approval. The queue is clear."
[No action button]
```

Spec: `<EmptyState size="md" icon={<CheckCircle />} title="All caught up" description="No overrides are waiting for approval. The queue is clear." />`

Icon wrapper override: `bg-success-100 text-success-600`

---

## 6. Screen 3: `/studio/certify` — Certification Management

### 6.1 Layout

```
┌──────────────────────────────────────────────────────────────────┐
│ StudioHeader (sticky)                                             │
├──────────────────────────────────────────────────────────────────┤
│ px-6 py-8                                                        │
│ ┌─────────────────────────────────────────── ┐                   │
│ │ [PageHeading]  [Invite button — top right] │                   │
│ └────────────────────────────────────────────┘                   │
│                                                                  │
│ ┌────────────────────────────────────────────┐                   │
│ │ [ContributorTable]                         │                   │
│ └────────────────────────────────────────────┘                   │
└──────────────────────────────────────────────────────────────────┘
```

### 6.2 PageHeading + Invite Button

- Heading: `text-xl font-semibold text-slate-900` — "Certified Contributors"
- Subheading: `text-sm text-slate-500 mt-1` — "{N} active contributors"
- Invite button (top-right of heading row): `<UserPlus className="w-4 h-4" /> Invite Contributor` — `bg-wine-600 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-wine-700 transition-colors shadow-sm`

### 6.3 ContributorTable Component

**Container:** `rounded-xl border border-slate-200 shadow-xs bg-white overflow-hidden`

**thead columns:**

| Column | Width | Notes |
|--------|-------|-------|
| Contributor | 240px | avatar + name + email |
| Trust Level | 100px | auto / pending + progress |
| Dataset Scopes | 200px | tags for allowed scopes |
| Status | 80px | enabled / disabled toggle |
| Joined | 100px | date `"Apr 5, 2026"` |
| Actions | 80px | kebab menu |

**Contributor cell:**
- 36px avatar circle: `bg-wine-100 text-wine-600 font-semibold text-sm rounded-full`
- Name: `text-sm font-medium text-slate-900`
- Email: `text-xs text-slate-400`

**Trust Level cell:**
- Auto-promote earned: `<Badge variant="success" size="sm">Auto-promote</Badge>`
- In progress: `text-xs text-slate-600` + mini progress bar `"4/5"` (same style as queue screen trust indicator)
- No approvals yet: `<Badge variant="secondary" size="sm">New</Badge>`

**Dataset Scopes cell:**
- Tags: `<Badge variant="outline" size="sm">wine_library</Badge>` `<Badge variant="outline" size="sm">chicago</Badge>` etc.
- Overflow: `+2 more` link with Tooltip listing all scopes

**Status toggle (enable/disable — D-04):**
- Radix Switch: enabled → `bg-success-600`; disabled → `bg-slate-200`
- Toggle is the only control on this column — no label, accessible via `aria-label="Enable {name}"`
- Toggling disabled shows inline confirmation: `"Disable {name}'s access? They will lose contributor permissions immediately."` using sonner confirm pattern (not a modal): `toast("Disable contributor?", { action: { label: "Confirm", onClick: () => disable() }, cancel: { label: "Cancel" } })`

**Actions kebab menu (Radix DropdownMenu):**
- `<MoreHorizontal className="w-4 h-4 text-slate-400" />`
- Menu items: `"View override history"`, `"Edit scopes"`, `"Revoke access"` (destructive — danger-600 text)

**Row animation:** Same stagger as queue screen.

### 6.4 Invite Flow

**Trigger:** Clicking "Invite Contributor" button.

**Presentation:** Radix Dialog (NOT slide-over — consistent with existing Dialog usage in project). Width `max-w-md`. Centered.

**Dialog structure:**
```
[DialogHeader]
"Invite a Certified Contributor"
[DialogDescription]
"A single-use invite link will be generated. It expires in 7 days."

[Form]
  Email address input (required)
  Dataset Scope checkboxes: wine_library / chicago / regional / global
  Expiry: read-only "7 days" (Claude's Discretion — standard, per D-03 context)

[DialogFooter]
  [Cancel]  [Generate Invite Link]
```

**Post-generation state (dialog stays open):**
```
[Check icon]
"Invite link generated"
┌─────────────────────────────────────────────┐
│ https://app.wineops.com/invite/abc123xyz    │  [Copy]
└─────────────────────────────────────────────┘
"Share this link with the contributor. It expires Apr 14, 2026."
[Done]
```

- Invite URL input: `font-mono text-sm bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 w-full`
- Copy button: `<Copy className="w-4 h-4" /> Copy` — `border border-slate-200 rounded-lg px-3 py-2 text-sm hover:bg-slate-50`
- On copy: button changes to `<Check className="w-4 h-4 text-success-600" /> Copied` for 2000ms, then reverts

**Dialog animations (framer-motion):**
```typescript
// Dialog overlay
initial={{ opacity: 0 }}
animate={{ opacity: 1 }}
transition={{ duration: 0.15 }}

// Dialog content
initial={{ opacity: 0, scale: 0.97, y: 8 }}
animate={{ opacity: 1, scale: 1, y: 0 }}
transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
```

### 6.5 Empty State — Screen 3

```
[Users icon in slate-100 rounded-2xl]
"No certified contributors"
"Invite trusted contributors using the button above. They will receive a single-use link."
[action: Invite Contributor]
```

---

## 7. Interaction States — Global Reference

| State | Behavior |
|-------|----------|
| Loading (page initial) | `<LoadingSkeleton />` for table rows (3 rows of skeleton) — existing component |
| API error (fetch) | `<ErrorState />` with retry button — existing component |
| Save success | Cell background flashes emerald-50 for 800ms + sonner `toast.success()` |
| Save error | Cell border turns danger-400 + inline `text-xs text-danger-600` below input + sonner `toast.error()` |
| Queued (contributor) | Cell returns to display mode with `"manual (pending)"` badge variant — outline with wine border |
| Session error (extraction failed) | CommandBar area shows `<ErrorState />` inline, CommandBar re-enabled |
| Session loading (extraction running) | Skeleton rows in table body, CommandBar disabled with spinner |
| Keyboard: Escape | Cancels active inline edit, no save |
| Keyboard: Enter | In reason-present edit: focuses next field. In reason-absent edit: submits save. |
| Keyboard: Tab | Moves focus to next editable cell in same row |

---

## 8. Copywriting Contract

### 8.1 Primary CTAs

| Screen | CTA | Label |
|--------|-----|-------|
| Studio | Trigger ingestion | `"Ingest"` |
| Studio | Save field override | `"Save Override"` |
| Studio | Add empty record | `"Or start with an empty record →"` |
| Queue | Approve override | `"Approve"` |
| Queue | Reject override | `"Reject"` |
| Certify | Invite new contributor | `"Invite Contributor"` |
| Certify | Generate invite link | `"Generate Invite Link"` |
| Certify | Copy invite URL | `"Copy"` → `"Copied"` |

### 8.2 Empty State Copy

| Screen | Title | Description |
|--------|-------|-------------|
| Studio (no session) | `"No records in this session"` | `"Paste a URL or drag a PDF into the bar above to begin ingestion."` |
| Studio (extraction running) | `"Extracting wine records..."` | `"This may take a few moments depending on menu length."` |
| Queue (no pending) | `"All caught up"` | `"No overrides are waiting for approval. The queue is clear."` |
| Certify (no contributors) | `"No certified contributors"` | `"Invite trusted contributors using the button above. They will receive a single-use link."` |

### 8.3 Error State Copy

| Trigger | Error Copy | Recovery Action |
|---------|-----------|-----------------|
| Ingestion API failure | `"Ingestion failed. Check your connection and try again."` | `"Retry"` button re-submits |
| Field save failure | `"Save failed. Your change was not recorded."` | Inline `"Try again"` link |
| Override fetch error | `"Could not load the approval queue."` | `"Refresh"` button |
| Invite generation failure | `"Invite link generation failed. Please try again."` | Dismiss + retry |
| PDF type rejection | `"Only PDF files are supported for drag-and-drop."` | sonner toast, no action needed |

### 8.4 Destructive Action Confirmations

| Action | Confirmation Pattern |
|--------|---------------------|
| Disable contributor | sonner toast with `action` + `cancel` buttons — no modal |
| Revoke contributor access | Inline dropdown confirmation: `"Revoke {name}? This cannot be undone."` with `"Revoke"` (danger) + `"Cancel"` |
| Clear session | `"Clear session? {N} unsaved records will be lost."` — sonner toast confirm pattern |

---

## 9. Component Inventory

### 9.1 New Components to Build (Phase 13)

| Component | Path | Reuses |
|-----------|------|--------|
| `StudioLayout` | `src/pages/studio/StudioLayout.tsx` | ProtectedRoute, Link, motion |
| `CommandBar` | `src/pages/studio/CommandBar.tsx` | Input, Button, motion |
| `WineRecordsTable` | `src/pages/studio/WineRecordsTable.tsx` | FieldCell, Badge, LoadingSkeleton |
| `FieldCell` | `src/pages/studio/FieldCell.tsx` | Input, Badge, AnimatePresence, motion |
| `ReasonInput` | `src/pages/studio/ReasonInput.tsx` | Input, motion |
| `SessionSummary` | `src/pages/studio/SessionSummary.tsx` | Badge |
| `QueueTable` | `src/pages/studio/queue/QueueTable.tsx` | Badge, Button, motion |
| `QueueRow` | `src/pages/studio/queue/QueueRow.tsx` | Avatar, Badge, Button, RejectNote |
| `TrustProgress` | `src/pages/studio/queue/TrustProgress.tsx` | — |
| `ContributorTable` | `src/pages/studio/certify/ContributorTable.tsx` | Badge, Switch, DropdownMenu |
| `InviteDialog` | `src/pages/studio/certify/InviteDialog.tsx` | Dialog, Input, Button, motion |

### 9.2 Existing Primitives Reused (No Modification)

| Component | Usage |
|-----------|-------|
| `Badge` | Confidence levels, role labels, status indicators |
| `EmptyState` | All three screens' zero-data states |
| `LoadingSkeleton` | Table rows during extraction / fetch |
| `ErrorState` | API failure states |
| `Input` (ui/input.tsx) | Inline edit fields, reason field, invite form |
| `Button` (ui/button.tsx) | All action buttons |
| `Card` (ui/card.tsx) | Session summary container |
| `ProtectedRoute` | Route gating for new roles |

### 9.3 Radix UI Components Used (Already Installed)

| Primitive | Usage |
|-----------|-------|
| `@radix-ui/react-dialog` | Invite contributor dialog |
| `@radix-ui/react-tooltip` | Column tooltips, truncated text reveal |
| `@radix-ui/react-switch` | Enable/disable contributor toggle |
| `@radix-ui/react-dropdown-menu` | Contributor row action kebab menu |
| `@radix-ui/react-tabs` | Studio / Queue / Certify navigation |

---

## 10. State Management

**Store:** Create `useStudioSessionStore` (Zustand) following the `useRestaurantSettingsStore` pattern (per D context code insights).

```typescript
// Minimal store shape
interface StudioSessionState {
  sessionId: string | null
  records: WineRecord[]       // current session extraction results
  editingCell: { recordId: string; field: string } | null
  setEditingCell: (cell: ...) => void
  clearSession: () => void
}
```

**Server state:** `@tanstack/react-query` for:
- Queue list: `useQuery(['queue'])` — poll every 30s or on focus
- Certify list: `useQuery(['contributors'])`
- Override submit: `useMutation`
- Approve/Reject: `useMutation` with optimistic update

---

## 11. Accessibility

| Requirement | Implementation |
|-------------|----------------|
| Table keyboard navigation | `tabIndex={0}` on each cell, `onKeyDown` for Enter/Escape/Tab |
| Approve/Reject min size | `min-h-[44px] min-w-[44px]` on both buttons |
| Confidence badge | `aria-label="Confidence: {value} — {tier}"` |
| Role badge in header | `aria-label="Your role: {role}"` |
| Inline edit announcement | `aria-live="polite"` region for save success/error |
| Dialog | Radix Dialog manages focus trap and `aria-modal` automatically |
| Toggle | `role="switch" aria-checked={enabled} aria-label="Enable {name}"` |
| Drag-and-drop | Keyboard-accessible fallback: file input inside CommandBar hidden behind drag zone |

---

## 12. Responsive Considerations

**Desktop-first minimum: 1280px.** No mobile breakpoints.

| Width | Behavior |
|-------|----------|
| ≥ 1280px | Full layout as specified above |
| 1024–1280px | Table: horizontal scroll engages earlier, some columns may be partially visible |
| < 1024px | Not supported — show `"WineOps Studio is optimized for desktop screens (1280px+)."` message |

Horizontal scroll visual cue: right-edge gradient `bg-gradient-to-r from-transparent to-white/60 pointer-events-none` fixed overlay on table wrapper right side when overflowing.

---

## 13. Registry

**Design system:** Radix UI + Tailwind (no shadcn CLI involved — project uses manual Radix primitives with custom Tailwind classes directly).

**Third-party registries:** None declared. All components are built from project-native primitives.

**Registry Safety Gate:** Not applicable (no third-party block installation required).

---

## 14. Source Attribution Summary

| Design Decision | Source |
|-----------------|--------|
| Route name `/studio` | Claude's Discretion (D-09) |
| wine-600 as 10% accent | tailwind.config.js + Onboarding.tsx pattern |
| Plus Jakarta Sans font | tailwind.config.js |
| framer-motion animation durations (0.15–0.25s) | Onboarding.tsx + AdminPanel.tsx patterns |
| `staggerChildren: 0.04` | AdminPanel.tsx `containerVariants` pattern |
| Confidence badge variants (destructive/warning/success/outline) | badge.tsx existing variants |
| EmptyState component API | empty-state.tsx existing component |
| sonner for toasts | package.json (sonner 1.3.1 installed) |
| Radix Dialog for invite (not slide-over) | D-05 spirit (no modals for field edits) + existing `@radix-ui/react-dialog` |
| Reject flow inline (not modal) | D-05 (inline editing philosophy extended to approval actions) |
| Trust N=5 threshold default | D-12 (configurable, default N=5) |
| Invite expiry 7 days | Claude's Discretion (D-03 context, industry standard) |
| Column order | D-06 (wine_name, vintage, producer, region, country, grape_variety, color, primary_type, sweetness_level, price_bottle, price_glass) |
| Reason required at confidence ≥ 0.8 | D-07 |
| Reason appears inline below field | D-08 |
| useStudioSessionStore (Zustand) | Code context: `useRestaurantSettingsStore` pattern |
| @tanstack/react-query for server state | package.json installed |
