# @wineops/ui

Shared UI component library for WineOps AI with glassmorphism design system.

## Features

- 🎨 **Glassmorphism Design** - Beautiful frosted glass effects
- 🎭 **shadcn/ui Components** - Accessible, customizable primitives
- 📊 **Tremor Charts** - Beautiful data visualization
- 🌈 **Wine Theme** - Custom color palette (wine red/green)
- ⚡ **Framer Motion** - Smooth animations
- 🎯 **TypeScript** - Full type safety
- 📦 **Tree-shakeable** - Only import what you need

## Installation

This is a workspace package. Install dependencies from the root:

```bash
pnpm install
```

## Usage

### Import Components

```typescript
import { Button, Card, Badge, StatCard } from "@wineops/ui"
import { AreaChart, BarChart } from "@wineops/ui"
import { GlassContainer } from "@wineops/ui"
```

### Import Styles

In your app's entry point:

```typescript
import "@wineops/ui/styles"
```

## Components

### Primitives

- **Button** - Primary action buttons with multiple variants
- **Card** - Container with glassmorphism effect
- **Badge** - Status indicators and labels
- **Input** - Text input with error handling
- **Label** - Form labels
- **Toast** - Notification system

### Charts

- **StatCard** - KPI cards with icons and trends
- **AreaChart** - Time series visualization (Tremor)
- **BarChart** - Comparison charts (Tremor)
- **DonutChart** - Proportional data (Tremor)
- **LineChart** - Trend analysis (Tremor)

### Layout

- **GlassContainer** - Glassmorphism wrapper

## Examples

### Button

```tsx
<Button variant="default">Click me</Button>
<Button variant="glass">Glass Button</Button>
<Button variant="success">Success</Button>
<Button variant="outline" size="lg">Large Outline</Button>
```

### Card

```tsx
<Card variant="glass" hover="lift">
  <CardHeader>
    <CardTitle>Wine Inventory</CardTitle>
    <CardDescription>Current stock levels</CardDescription>
  </CardHeader>
  <CardContent>
    {/* Your content */}
  </CardContent>
</Card>
```

### StatCard

```tsx
<StatCard
  title="Total Revenue"
  value={125000}
  format="currency"
  change={12.5}
  changeType="increase"
  icon={DollarSign}
/>
```

### Badge

```tsx
<Badge variant="success">Healthy Stock</Badge>
<Badge variant="warning">Low Stock</Badge>
<Badge variant="destructive">Critical</Badge>
<Badge variant="glass">Connected</Badge>
```

### GlassContainer

```tsx
<GlassContainer variant="light" className="p-6">
  <h2>Beautiful glassmorphism container</h2>
</GlassContainer>
```

## Utilities

### cn() - Class name utility

Merge Tailwind classes safely:

```typescript
import { cn } from "@wineops/ui"

<div className={cn("base-class", condition && "conditional-class")} />
```

### Formatting utilities

```typescript
import { 
  formatCurrency,
  formatNumber,
  formatPercentage,
  formatDate 
} from "@wineops/ui"

formatCurrency(1250.50) // "$1,250.50"
formatNumber(1234567, 2) // "1,234,567.00"
formatPercentage(12.5) // "12.5%"
formatDate(new Date(), "long") // "January 8, 2026"
```

### Stock status utilities

```typescript
import { getStockStatusColor, getStockStatusLabel } from "@wineops/ui"

getStockStatusColor(5, 10) // "danger"
getStockStatusLabel(5, 10) // "Critical"
```

## Theme

### Colors

**Wine Red** (Primary)
- 50-900 scale for alerts, warnings, low stock

**Wine Green** (Success)
- 50-900 scale for success states, healthy stock

**Powder White** (Background)
- Base: `#FDFCFB`
- Secondary: `#FAFAFA`

### Glassmorphism

Apply glassmorphism with utility classes:

```tsx
<div className="glass">
  {/* Light glass effect */}
</div>

<div className="glass-dark">
  {/* Dark glass effect */}
</div>
```

Or use components with `variant="glass"`:

```tsx
<Card variant="glass">...</Card>
<Button variant="glass">...</Button>
```

## Development

### Build

```bash
cd packages/ui
pnpm run build
```

### Watch mode

```bash
pnpm run dev
```

### Lint

```bash
pnpm run lint
```

## Adding New Components

1. Create component in `src/components/{category}/`
2. Export from category index: `src/components/{category}/index.tsx`
3. Export from main index: `src/index.tsx`
4. Document usage in this README

## Design System

This package implements the WineOps AI design system:

- **Typography**: Inter font family (system default)
- **Spacing**: 4px base unit (Tailwind default)
- **Border Radius**: 8-16px for cards, 4-8px for buttons
- **Shadows**: Layered shadows for depth
- **Animations**: 200-300ms duration, ease-out easing

## Browser Support

- Chrome/Edge (latest 2 versions)
- Firefox (latest 2 versions)
- Safari (latest 2 versions)

## License

Proprietary - WineOps AI

