---
phase: 22-observability-deployment
plan: "05"
subsystem: frontend-deployment
tags: [health-dashboard, vercel, deployment, admin]
dependency_graph:
  requires: [22-04]
  provides: [admin-health-ui, vercel-config]
  affects: [apps/web, vercel-deployment]
tech_stack:
  added: []
  patterns: [react-lazy, framer-motion-cards, axios-polling, vercel-monorepo-rewrite]
key_files:
  created:
    - apps/web/src/pages/AdminHealth.tsx
    - vercel.json
  modified:
    - apps/web/src/App.tsx
decisions:
  - "vercel.json rootDirectory=apps/web — Vercel runs build inside apps/web, not repo root"
  - "No outputDirectory in vercel.json — Vite auto-detects dist/ (setting it breaks deployment)"
  - "REPLACE_WITH_RAILWAY_API_GATEWAY_URL placeholder in vercel.json — must be replaced after Railway deploy (Vercel does not support env var interpolation in rewrites.destination)"
  - "/admin/health route added as child of existing ProtectedRoute+DashboardLayout parent — no extra ProtectedRoute wrapper needed"
metrics:
  duration: "~8 minutes"
  completed: "2026-04-13T15:03:05Z"
  tasks_completed: 2
  tasks_total: 3
  files_changed: 3
---

# Phase 22 Plan 05: Admin Health Dashboard + Vercel Config Summary

Admin health dashboard page with 30s agent polling and vercel.json monorepo config for Vercel deployment.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create AdminHealth.tsx + /admin/health route | 10fff25 | apps/web/src/pages/AdminHealth.tsx, apps/web/src/App.tsx |
| 2 | Create vercel.json at repo root | 39e64bf | vercel.json |
| 3 | Railway + Supabase + Toast deployment checkpoint | — | Human action pending |

## AdminHealth.tsx

- **Polling interval:** 30 seconds (`setInterval(fetchHealth, 30_000)`)
- **API endpoint:** `GET ${VITE_API_GATEWAY_URL}/api/health/agents` with `Authorization: Bearer <token>` (token from `localStorage.getItem('accessToken')`)
- **Components:** framer-motion (containerVariants/itemVariants matching AdminPanel.tsx), lucide-react (Activity, Server, AlertCircle, CheckCircle2, RefreshCw, Clock), sonner toasts, axios
- **Status badges:** active (emerald), idle (blue), degraded (amber), error (rose), stopped (slate)
- **States:** loading spinner, empty state (no agents running), populated grid (1-4 col responsive)
- **Auth:** unauthenticated users are redirected to /login by the parent ProtectedRoute in App.tsx

## App.tsx Changes

- **Lazy import line added (line 30):** `const AdminHealth = lazy(() => import('./pages/AdminHealth'))`
- **Route line added (line 131):** `<Route path="/admin/health" element={<AdminHealth />} />`
- Route lives inside the `<Route element={<ProtectedRoute><DashboardLayout /></ProtectedRoute>}>` parent — auth protection inherited from parent

## vercel.json

```json
{
  "framework": "vite",
  "rootDirectory": "apps/web",
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "https://REPLACE_WITH_RAILWAY_API_GATEWAY_URL/api/:path*"
    }
  ]
}
```

**After Railway deployment:** Replace `REPLACE_WITH_RAILWAY_API_GATEWAY_URL` with the actual Railway api-gateway URL (e.g., `wineops-api-gateway.up.railway.app`).

## Deployment Status

- **Railway:** Pending human action (Task 3 checkpoint)
- **Supabase Cloud migrations:** Pending human action (Task 3 checkpoint)
- **Toast connectivity test:** Pending human action (Task 3 checkpoint)
- **Vercel frontend:** Pending (requires Railway URL first to update vercel.json)

## Vercel Environment Variables Required

Set in Vercel project dashboard after deployment:
- `VITE_API_GATEWAY_URL=https://<railway-api-gateway-url>`
- `VITE_SUPABASE_URL=<supabase-url>`
- `VITE_SUPABASE_ANON_KEY=<supabase-anon-key>`

## Infrastructure

| Service | Status |
|---------|--------|
| Supabase Cloud migrations | Pending — run `supabase db push` |
| CloudAMQP (RabbitMQ) | Set up in 22-03 checkpoint |
| Upstash (Redis) | Set up in 22-03 checkpoint |
| Railway agent-orchestrator | Pending deployment |
| Railway api-gateway | Pending deployment |
| Vercel frontend | Pending Railway URL |

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

- `vercel.json` contains `REPLACE_WITH_RAILWAY_API_GATEWAY_URL` placeholder — must be replaced with actual Railway api-gateway URL after deployment (see Task 3 checkpoint instructions)

## Threat Flags

None — no new security surface beyond what is documented in the plan's STRIDE register.

## Self-Check: PASSED

- `apps/web/src/pages/AdminHealth.tsx` — FOUND
- `vercel.json` — FOUND  
- `apps/web/src/App.tsx` — modified, AdminHealth lazy import + route confirmed
- Commit 10fff25 — FOUND (feat(22-05))
- Commit 39e64bf — FOUND (chore(22-05))
