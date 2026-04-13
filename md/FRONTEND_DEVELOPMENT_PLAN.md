# Frontend Development Plan - WineOps AI

**Created:** January 18, 2026  
**Status:** Active  
**Focus:** React/TypeScript Frontend Development

---

## 📊 Current State

- **Framework:** React 18 + TypeScript + Vite
- **Styling:** Tailwind CSS + Custom Design System
- **Animation:** Framer Motion
- **State:** React Context + Supabase Realtime
- **Pages:** 16 (Dashboard, Inventory, Orders, WineLibrary, Calendar, Reports, etc.)

---

## Phase 1: Foundation & Critical Fixes

### 1.1 Testing Infrastructure
- [ ] Set up Vitest with React Testing Library
- [ ] Configure test coverage (target: 80%)
- [ ] Create mock utilities for Supabase/API calls
- [ ] Write tests for `OneTapActionCenter.tsx`
- [ ] Write tests for `Dashboard.tsx`
- [ ] Write tests for `Inventory.tsx`
- [ ] Add CI/CD test pipeline configuration

### 1.2 One-Tap Action Backend Integration
- [ ] Create `useOneTapActions` hook in `hooks/useOneTapActions.ts`
- [ ] Define TypeScript interfaces for action types
- [ ] Connect to backend API for CRUD operations
- [ ] Add WebSocket subscription for real-time sync
- [ ] Persist custom actions to database
- [ ] Link actions to actual backend workflow execution
- [ ] Add action history/audit trail view

### 1.3 API Integration Layer
- [ ] Create base API client (`services/api/client.ts`)
- [ ] Create inventory API service (`services/api/inventory.ts`)
- [ ] Create orders API service (`services/api/orders.ts`)
- [ ] Create wines API service (`services/api/wines.ts`)
- [ ] Create dashboard API service (`services/api/dashboard.ts`)
- [ ] Replace mock data in Dashboard with real API
- [ ] Replace mock data in Inventory with real API
- [ ] Replace mock data in Orders with real API
- [ ] Add request/response interceptors for auth

### 1.4 Error Handling & Tracking
- [ ] Integrate Sentry for error tracking
- [ ] Enhance `ErrorBoundary.tsx` with recovery UI
- [ ] Create `error-state.tsx` component
- [ ] Add error boundaries to all page components
- [ ] Create global error notification system
- [ ] Add user-friendly error messages (not generic)

---

## Phase 2: UX Improvements

### 2.1 Loading & Empty States
- [ ] Create skeleton loaders for Dashboard stat cards
- [ ] Create skeleton loaders for Inventory table rows
- [ ] Create skeleton loaders for Orders list
- [ ] Create skeleton loaders for Calendar events
- [ ] Design empty state for Inventory (no wines)
- [ ] Design empty state for Orders (no orders)
- [ ] Design empty state for Notifications (all clear)
- [ ] Add React Suspense boundaries with fallbacks

### 2.2 Toast Notification System
- [ ] Create `ToastContext.tsx` provider
- [ ] Create `useToast.ts` hook
- [ ] Create `toast.tsx` UI component
- [ ] Support variants: success, error, warning, info
- [ ] Add auto-dismiss with configurable duration
- [ ] Support action buttons in toasts
- [ ] Replace all `alert()` calls with toast notifications
- [ ] Add toast queue management

### 2.3 Form Validation & UX
- [ ] Install and configure Zod for schema validation
- [ ] Install and configure react-hook-form
- [ ] Add inline error messages to all form fields
- [ ] Add validation to `AddWineModal.tsx`
- [ ] Add validation to `OrderApprovalModal.tsx`
- [ ] Add validation to `ManualOverrideModal.tsx`
- [ ] Add validation to `AddProviderModal.tsx`
- [ ] Ensure proper keyboard navigation in all modals

### 2.4 Dark Mode Implementation
- [ ] Complete dark mode CSS variables in `globals.css`
- [ ] Update `ThemeContext.tsx` with toggle logic
- [ ] Update `ThemeToggle.tsx` component
- [ ] Test Dashboard in dark mode
- [ ] Test Inventory in dark mode
- [ ] Test Orders in dark mode
- [ ] Test all modals in dark mode
- [ ] Persist theme preference in localStorage
- [ ] Add system preference detection

---

## Phase 3: Component Library & Documentation

### 3.1 Storybook Expansion
- [ ] Complete Storybook configuration in `.storybook/`
- [ ] Create story for `Button` component (enhance existing)
- [ ] Create story for `Card` component (enhance existing)
- [ ] Create story for `Badge` component (enhance existing)
- [ ] Create story for `Input` component (enhance existing)
- [ ] Create story for `EmptyState` component
- [ ] Create story for `LoadingSkeleton` component
- [ ] Create story for `Toast` component
- [ ] Add interaction tests in stories
- [ ] Document component props with TSDoc

### 3.2 Design System Consolidation
- [ ] Audit UI components for consistency
- [ ] Move duplicates to shared `packages/ui`
- [ ] Standardize prop interfaces across components
- [ ] Document color tokens
- [ ] Document spacing tokens
- [ ] Document typography tokens
- [ ] Create component usage guidelines

### 3.3 Accessibility Audit
- [ ] Run Lighthouse accessibility audit
- [ ] Add missing ARIA labels to buttons
- [ ] Add missing ARIA labels to form fields
- [ ] Ensure proper heading hierarchy (h1 > h2 > h3)
- [ ] Test keyboard navigation on Dashboard
- [ ] Test keyboard navigation on Inventory
- [ ] Test keyboard navigation on Orders
- [ ] Add visible focus indicators
- [ ] Test with VoiceOver (macOS)

---

## Phase 4: Feature Enhancements

### 4.1 Dashboard Improvements
- [ ] Create aggregated dashboard API endpoint call
- [ ] Implement parallel data fetching with Promise.all
- [ ] Add widget customization (show/hide)
- [ ] Add drag-and-drop widget reordering
- [ ] Add widget collapse/expand functionality
- [ ] Improve calendar mini-view performance
- [ ] Add quick action shortcuts

### 4.2 Inventory Page Enhancements
- [ ] Implement virtual scrolling for large lists
- [ ] Add bulk edit functionality
- [ ] Add inventory history/changelog view
- [ ] Add column customization (show/hide)
- [ ] Add export preview before download
- [ ] Improve search with fuzzy matching
- [ ] Add saved filter presets

### 4.3 Orders Page (Blueprint 12/01/2026 Requirements)
- [ ] Provider selection in Create Order flow
- [ ] Volume-based pricing tiers UI (10 cases = $X, 20 cases = $Y)
- [ ] Case quantity display (visible in order list)
- [ ] Vendor cutoff time display
- [ ] Cutoff time notifications
- [ ] App-only purchase flag indicator
- [ ] Invoice scanning comparison UI
- [ ] Family plan / portfolio discount indicator

### 4.4 Calendar Integration
- [ ] Full calendar view (month/week/day toggle)
- [ ] Vendor deadline visual indicators
- [ ] Recurring order scheduling display
- [ ] Report schedule display
- [ ] Event creation from calendar
- [ ] Drag to reschedule events

### 4.5 Reports Page (Blueprint Requirements)
- [ ] Monthly inventory export flow
- [ ] INVENTORY column in export
- [ ] PURCHASED column in export
- [ ] SOLD column in export
- [ ] PROFIT MARGIN (DIFF) column in export
- [ ] Total cost calculation display
- [ ] Digital check requirement support

---

## Phase 5: Advanced Features (Future)

### 5.1 Voice Command UI (Hands-Free Agent)
- [ ] Create `VoiceTrigger.tsx` Push-to-Talk button
- [ ] Create `VoiceWaveform.tsx` visual feedback
- [ ] Create `useVoiceRecording.ts` hook
- [ ] Handle mobile touch events (onTouchStart/End)
- [ ] Display real-time transcription
- [ ] Show clarification prompts
- [ ] Connect to backend Whisper API

### 5.2 Wine AI Agent Widget
- [ ] Create floating chatbot widget component
- [ ] Implement quick task shortcuts
- [ ] Add onboarding guide integration
- [ ] Connect to AI backend for responses
- [ ] Add conversation history

### 5.3 First-Timer Onboarding
- [ ] Step-by-step wine import wizard
- [ ] POS connection flow (Toast integration)
- [ ] Provider setup guide
- [ ] Interactive tutorial overlay
- [ ] Progress indicator

---

## Priority Matrix

| Priority | Task | Impact | Effort |
|----------|------|--------|--------|
| P0 | API Integration Layer | High | Medium |
| P0 | One-Tap Backend Integration | High | Medium |
| P0 | Testing Infrastructure | High | Medium |
| P1 | Toast Notification System | Medium | Low |
| P1 | Loading/Empty States | Medium | Low |
| P1 | Error Handling | High | Low |
| P1 | Orders Provider Selection | High | Medium |
| P1 | Dashboard Aggregation | High | Medium |
| P2 | Dark Mode | Low | Medium |
| P2 | Storybook Expansion | Medium | Medium |
| P2 | Accessibility Audit | Medium | Medium |
| P3 | Voice Command UI | Medium | High |
| P3 | Wine AI Widget | Medium | High |

---

## Dependencies

### Blocked by Backend
- One-Tap Actions API endpoints
- Dashboard aggregation endpoint
- Toast POS API integration
- Voice command transcription endpoint

### Can Start Immediately (Frontend Only)
- Testing infrastructure
- Error handling & boundaries
- Loading/empty states
- Toast notification system
- Dark mode
- Storybook documentation
- Accessibility improvements

---

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Dashboard Load Time | ~5s (mock) | < 2s |
| Test Coverage | 0% | 80% |
| Lighthouse Accessibility | Unknown | > 90 |
| Unhandled Error Rate | Unknown | < 0.1% |
| Storybook Coverage | ~25% | 100% |

---

## Notes

- Blueprint reference: `/md_files/Blueprint` (lines 1098-1128 for 12/01/2026 requirements)
- Analysis document: `/md_files/PROJECT_ANALYSIS_AND_CHAT_CONTEXT.md`
- Design inspiration: Toast/Stripe UI patterns