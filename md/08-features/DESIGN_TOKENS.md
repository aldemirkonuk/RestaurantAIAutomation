# WineOps AI Design System Tokens

A comprehensive guide to the design tokens used in the WineOps AI application.

---

## Color Palette

### Brand Colors (Wine)

The primary brand color represents elegance and wine culture.

```css
--wine-50: #fdf2f4
--wine-100: #fce7eb
--wine-200: #f9d0d9
--wine-300: #f4a9ba
--wine-400: #ed7896
--wine-500: #e14d75
--wine-600: #cd2d5b  /* Primary brand color */
--wine-700: #ac204a
--wine-800: #901d42
--wine-900: #7c1d3c
--wine-950: #450a1e
```

**Usage:**
- Primary actions: `bg-wine-600 hover:bg-wine-700`
- Accents: `text-wine-600`
- Subtle backgrounds: `bg-wine-50`

### Semantic Colors

#### Success (Emerald)
```css
--success-50: #ecfdf5
--success-500: #10b981
--success-600: #059669
```

**Usage:** Positive actions, success states, healthy inventory

#### Warning (Amber)
```css
--warning-50: #fffbeb
--warning-500: #f59e0b
--warning-600: #d97706
```

**Usage:** Caution states, low stock warnings, pending approvals

#### Error/Danger (Rose)
```css
--danger-50: #fef2f2
--danger-500: #ef4444
--danger-600: #dc2626
```

**Usage:** Errors, critical alerts, destructive actions

#### Info (Blue)
```css
--info-50: #eff6ff
--info-500: #3b82f6
--info-600: #2563eb
```

**Usage:** Informational messages, help text

### Neutral Colors (Slate)

```css
--slate-50: #f9fafb
--slate-100: #f3f4f6
--slate-200: #e5e7eb
--slate-300: #d1d5db
--slate-400: #9ca3af
--slate-500: #6b7280
--slate-600: #4b5563
--slate-700: #374151
--slate-800: #1f2937
--slate-900: #111827
```

**Usage:**
- Text: `text-slate-900` (dark), `text-slate-500` (muted)
- Backgrounds: `bg-slate-50` (light), `bg-slate-900` (dark)
- Borders: `border-slate-200`

### CSS Variable System

For theme-aware colors:

```css
/* Light mode */
--background: 0 0% 98.5%
--foreground: 222 47% 11%
--card: 0 0% 100%
--card-foreground: 222 47% 11%
--border: 220 13% 91%
--muted: 220 14% 96%
--muted-foreground: 220 9% 46%

/* Dark mode */
--background: 224 71% 4%
--foreground: 213 31% 91%
--card: 224 71% 6%
--card-foreground: 213 31% 91%
--border: 215 28% 17%
--muted: 215 28% 17%
--muted-foreground: 215 20% 65%
```

**Usage:**
- Always use semantic tokens for theme support
- `bg-card` instead of `bg-white`
- `text-foreground` instead of `text-gray-900`
- `border-border` instead of `border-gray-200`

---

## Typography

### Font Families

```css
font-sans: "Plus Jakarta Sans", "DM Sans", system-ui, sans-serif
font-display: "Plus Jakarta Sans", system-ui, sans-serif
font-body: "DM Sans", system-ui, sans-serif
font-mono: "JetBrains Mono", Menlo, Monaco, Consolas, monospace
```

**Usage:**
- Headings: `font-display`
- Body text: `font-sans` (default)
- Code/numbers: `font-mono`

### Font Sizes

| Class | Size | Line Height | Usage |
|-------|------|-------------|-------|
| `text-xs` | 0.75rem (12px) | 1rem | Helper text, labels |
| `text-sm` | 0.875rem (14px) | 1.25rem | Body text, descriptions |
| `text-base` | 1rem (16px) | 1.5rem | Default body text |
| `text-lg` | 1.125rem (18px) | 1.75rem | Large body, subheadings |
| `text-xl` | 1.25rem (20px) | 1.75rem | Section headings |
| `text-2xl` | 1.5rem (24px) | 2rem | Page headings |
| `text-3xl` | 1.875rem (30px) | 2.25rem | Hero headings |
| `text-4xl` | 2.25rem (36px) | 2.5rem | Large headings |

### Font Weights

```css
font-normal: 400
font-medium: 500
font-semibold: 600
font-bold: 700
```

**Usage:**
- Body text: `font-normal`
- Labels: `font-medium`
- Headings: `font-semibold` or `font-bold`

---

## Spacing Scale

Based on Tailwind's 4px base unit:

| Token | Value | Usage |
|-------|-------|-------|
| `spacing-1` | 0.25rem (4px) | Tight spacing |
| `spacing-2` | 0.5rem (8px) | Small gaps |
| `spacing-3` | 0.75rem (12px) | Default gap |
| `spacing-4` | 1rem (16px) | Standard spacing |
| `spacing-5` | 1.25rem (20px) | Medium spacing |
| `spacing-6` | 1.5rem (24px) | Large spacing |
| `spacing-8` | 2rem (32px) | Section spacing |
| `spacing-12` | 3rem (48px) | Major sections |

**Common Patterns:**
- Card padding: `p-6` (24px)
- Modal padding: `p-8` (32px)
- Section gaps: `space-y-6` or `gap-6`
- Button padding: `px-4 py-2` or `px-6 py-3`

---

## Border Radius

Generous curves for modern, friendly feel:

| Token | Value | Usage |
|-------|-------|-------|
| `rounded-sm` | 0.375rem (6px) | Small elements |
| `rounded` | 0.5rem (8px) | Default |
| `rounded-md` | 0.625rem (10px) | Medium |
| `rounded-lg` | 0.75rem (12px) | Buttons, inputs |
| `rounded-xl` | 1rem (16px) | Cards, containers |
| `rounded-2xl` | 1.25rem (20px) | Large cards, modals |
| `rounded-3xl` | 1.5rem (24px) | Hero sections |
| `rounded-full` | 9999px | Circular elements |

**Common Patterns:**
- Buttons: `rounded-lg` or `rounded-xl`
- Cards: `rounded-xl` or `rounded-2xl`
- Modals: `rounded-2xl` or `rounded-3xl`
- Pills/badges: `rounded-full`

---

## Shadows

Refined elevation system inspired by Stripe:

| Token | Usage |
|-------|-------|
| `shadow-sm` | Subtle cards |
| `shadow` | Default cards |
| `shadow-md` | Hover states |
| `shadow-lg` | Important cards |
| `shadow-xl` | Modals, popovers |
| `shadow-2xl` | High elevation modals |
| `shadow-card` | Card default: `0 1px 3px rgb(0 0 0 / 0.04)` |
| `shadow-card-hover` | Card hover: `0 4px 12px rgb(0 0 0 / 0.08)` |

**Usage:**
- Default cards: `shadow-sm`
- Interactive cards: `hover:shadow-lg`
- Modals: `shadow-2xl`
- Dropdowns: `shadow-xl`

---

## Animations

### Keyframes

```css
/* Shimmer (loading effect) */
@keyframes shimmer {
  0% { background-position: -200% 0 }
  100% { background-position: 200% 0 }
}

/* Slide In */
@keyframes slide-in-right {
  0% { transform: translateX(100%); opacity: 0 }
  100% { transform: translateX(0); opacity: 1 }
}

/* Fade In */
@keyframes fade-in {
  0% { opacity: 0 }
  100% { opacity: 1 }
}

/* Scale In */
@keyframes scale-in {
  0% { transform: scale(0.95); opacity: 0 }
  100% { transform: scale(1); opacity: 1 }
}
```

### Animation Classes

| Class | Duration | Easing | Usage |
|-------|----------|--------|-------|
| `animate-pulse` | 2s | ease-in-out | Loading states |
| `animate-shimmer` | 2s | linear | Loading shimmer effect |
| `animate-fade-in` | 0.2s | ease-out | Gentle appearance |
| `animate-slide-in-up` | 0.3s | ease-out | Modal entry |
| `animate-scale-in` | 0.2s | ease-out | Popover entry |

**Usage:**
- Loading skeletons: `animate-pulse` + `animate-shimmer`
- Modal entry: `animate-scale-in`
- Toast notifications: `animate-slide-in-right`
- Page transitions: `animate-fade-in`

### Transition Timing

```css
transition-smooth: cubic-bezier(0.4, 0, 0.2, 1)
transition-bounce-in: cubic-bezier(0.68, -0.55, 0.265, 1.55)
```

**Usage:**
- Standard transitions: `transition-colors` (default smooth)
- Playful elements: `transition-bounce-in`

---

## Component Patterns

### Buttons

**Primary:**
```tsx
<button className="px-6 py-3 bg-wine-600 text-white font-semibold rounded-xl hover:bg-wine-700 shadow-lg shadow-wine-600/30 transition-colors">
  Action
</button>
```

**Secondary:**
```tsx
<button className="px-6 py-3 bg-gray-200 text-gray-700 font-medium rounded-xl hover:bg-gray-300 transition-colors">
  Cancel
</button>
```

**Ghost:**
```tsx
<button className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
  View More
</button>
```

### Cards

**Default:**
```tsx
<div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
  Content
</div>
```

**Elevated:**
```tsx
<div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8">
  Content
</div>
```

**Interactive:**
```tsx
<div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 hover:shadow-lg hover:border-wine-200 transition-all cursor-pointer">
  Content
</div>
```

### Inputs

**Default:**
```tsx
<input className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-wine-500 focus:border-transparent" />
```

**With Error:**
```tsx
<input className="w-full px-4 py-2.5 border border-rose-300 bg-rose-50 rounded-lg focus:ring-2 focus:ring-rose-500" />
```

### Badges

**Status:**
```tsx
<span className="px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
  Active
</span>
```

**Priority:**
```tsx
<span className="px-2.5 py-1 rounded-full text-xs font-medium bg-rose-100 text-rose-700">
  Critical
</span>
```

---

## Responsive Breakpoints

```css
sm: 640px   /* Mobile landscape */
md: 768px   /* Tablet */
lg: 1024px  /* Desktop */
xl: 1280px  /* Large desktop */
2xl: 1536px /* Extra large */
```

**Usage:**
```tsx
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
  {/* Responsive grid */}
</div>
```

---

## Z-Index Scale

Consistent layering:

| Layer | Value | Usage |
|-------|-------|-------|
| Base | 0 | Default content |
| Dropdown | 10 | Dropdown menus |
| Sticky | 20 | Sticky headers |
| Fixed | 30 | Fixed navigation |
| Modal Backdrop | 40 | Modal overlays |
| Modal | 50 | Modal content |
| Popover | 60 | Popovers, tooltips |
| Toast | 100 | Toast notifications |

---

## Accessibility

### Focus Ring

```css
/* Default focus ring */
focus:outline-none focus:ring-2 focus:ring-wine-500 focus:ring-offset-2

/* Dark mode compatible */
dark:focus:ring-wine-400
```

### Color Contrast

All color combinations meet WCAG AA standards:
- Text on backgrounds: 4.5:1 minimum
- Large text (18px+): 3:1 minimum
- Interactive elements: 3:1 minimum

### ARIA Patterns

- All icon-only buttons have `aria-label`
- Form errors have `role="alert"` and `aria-live="polite"`
- Loading states have `role="status"` and `aria-label="Loading..."`
- Modals have `aria-modal="true"`

---

## Usage Guidelines

### Do's

- Use CSS variables for theme-aware colors
- Use semantic color names (success, warning, danger)
- Follow spacing scale consistently
- Apply proper focus states to all interactive elements
- Use transitions for smooth UX

### Don'ts

- Don't use arbitrary color values
- Don't hardcode sizes outside the scale
- Don't skip focus indicators
- Don't use colors alone to convey meaning
- Don't use tiny text (< 12px) for important content

---

## Code Examples

### Theme-Aware Component

```tsx
function MyComponent() {
  return (
    <div className="bg-card text-foreground border-border rounded-xl p-6">
      <h2 className="text-xl font-semibold mb-4">Title</h2>
      <p className="text-muted-foreground">Description</p>
      <button className="mt-4 px-4 py-2 bg-wine-600 text-white rounded-lg hover:bg-wine-700">
        Action
      </button>
    </div>
  )
}
```

### Responsive Layout

```tsx
function ResponsiveGrid() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {items.map(item => (
        <Card key={item.id} className="p-6">
          {item.content}
        </Card>
      ))}
    </div>
  )
}
```

### Accessible Form

```tsx
function AccessibleForm() {
  return (
    <form className="space-y-4">
      <FormInput
        label="Wine Name"
        required
        error={errors.name}
        aria-describedby="name-error"
      />
      <FormSelect
        label="Type"
        required
        options={wineTypes}
        aria-label="Select wine type"
      />
    </form>
  )
}
```

---

## Version History

- v1.0 (Jan 2026): Initial design system documentation
- Maintained by: Frontend Team
- Last updated: January 18, 2026
