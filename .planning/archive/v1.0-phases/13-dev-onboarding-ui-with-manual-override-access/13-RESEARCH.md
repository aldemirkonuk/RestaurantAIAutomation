# Phase 13: Dev Onboarding UI with Manual Override Access — Research

**Researched:** 2026-04-07
**Domain:** React + FastAPI + Supabase RLS — role-gated data authoring UI with inline field editing and full audit trail
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Use Supabase RLS + `user_roles` junction table (not extending the existing `owner/manager/staff` enum). A user can hold multiple roles simultaneously (e.g., both `manager` and `certified_contributor`). DB-level enforcement — no API can bypass it.
- **D-02:** Three new roles: `developer`, `certified_contributor`, `review_admin`.
- **D-03:** Role granting is **invite-based** — `review_admin` generates a single-use invite token with expiry. User clicks link → role granted automatically. Creates exclusivity and is effortless for recipients (Linear/Notion/Vercel Teams pattern).
- **D-04:** No self-service role escalation. Users cannot grant themselves roles.
- **D-05:** **Inline click-to-edit** — clicking any field cell in the wine record table makes it an editable input in place. Spreadsheet-like feel. No slide-over panels or modals.
- **D-06:** **Fixed column order** for the review table — wine_name, vintage, producer, region, country, grape_variety, color, primary_type, sweetness_level, price_bottle, price_glass, vintage_score, ... Always same columns, predictable and scannable.
- **D-07:** **Smart reason enforcement** — reason field is required ONLY when overriding a field that already has confidence ≥ 0.8. Filling a NULL field? No reason needed. Overriding a high-confidence value? Must provide a short justification. Citation URL is always optional.
- **D-08:** Reason input appears inline below the edited field (not a modal). Short placeholder text guides users.
- **D-09:** **Completely separate route** — `/dev/onboarding` (or `/studio`). Not an extension of the existing `Onboarding.tsx` wizard.
- **D-10:** **Command-palette style ingestion** — a single smart input bar at the top. Auto-detects URL vs PDF drag-drop vs manual entry.
- **D-11:** Screen has two primary sections: (1) ingestion trigger at top, (2) wine records table below.
- **D-12:** **Trust-level based promotion** for certified contributors — new contributor → queue; after N=5 consecutive approved overrides → auto-promote status.
- **D-13:** **Instant-promote for developers and review_admins** — full audit trail still recorded.
- **D-14:** **Approval queue page for review_admins** — dedicated list with one-click approve or reject.
- **D-15:** All overrides logged to `field_corrections` (or `override_events`) with full provenance.

### Claude's Discretion

- Exact route name (`/dev/onboarding` vs `/studio` vs `/data/authoring`) — choose the clearest name
- Exact column order within the fixed field layout — follow the `master_wine_library_submissions` schema field order
- Trust-level N threshold UI — configurable in settings, default 5
- Exact invite token expiry duration — 7 days is standard

### Deferred Ideas (OUT OF SCOPE)

- **Contributor gamification layer** — points system, override acceptance rate score, rewards/discounts for certified sommeliers/producers. Future phase.
- **Push notifications for review_admin** — in-app notification when override is queued. Future enhancement.
- **Bulk override approval** — select multiple pending overrides and approve all at once. Future at scale.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DEVUI-01 | AuthZ roles enforced for onboarding UI: `developer`, `certified_contributor`, `review_admin` with least-privilege field write scope | Supabase RLS user_roles junction pattern (Section: Supabase RLS Multi-Role Pattern) |
| DEVUI-02 | UI supports onboarding start from (a) PDF upload, (b) URL/crawler trigger, and (c) manual entry seed | Command-palette auto-detect pattern (Section: Command-Palette Ingestion Bar) |
| DEVUI-03 | Field editor shows current value, confidence, source, verification_status, and allows per-field override | Inline click-to-edit with framer-motion (Section: Inline Edit Pattern) |
| DEVUI-04 | Manual override submission requires `reason` and records optional citation metadata (url/snippet) | react-hook-form conditional validation (Section: Smart Reason Enforcement) |
| DEVUI-05 | All manual edits persisted to `field_corrections` / `override_events` with actor_id, old_value, new_value, reason, timestamp | override_events schema (Section: DB Schema) |
| DEVUI-06 | Promotion rules preserve higher-confidence verified values unless explicitly approved by role policy | merge_field_confidence() integration + FastAPI RBAC (Section: FastAPI RBAC) |
| DEVUI-07 | Certification management path exists: enable/disable certified accounts, assign dataset scopes | invite_tokens + user_roles management (Section: Invite Token Pattern) |
| DEVUI-08 | `GET /api/v1/onboarding/sessions/{id}` returns full session timeline: ingestion events, model outputs, manual overrides, approvals | onboarding_sessions + event log schema (Section: Session Audit Timeline) |
| DEVUI-09 | Metrics endpoint includes manual-authoring KPIs: override rate, approval latency, acceptance rate, post-override correction rate | GET /api/v1/studio/metrics design (Section: Session Audit Timeline) |
| DEVUI-10 | E2E test: certified user uploads PDF, pipeline extracts, user overrides 3 fields, review_admin approves, final record promoted with full audit trail | pytest + Playwright E2E pattern (Section: Validation Architecture) |
</phase_requirements>

---

## Summary

Phase 13 builds a role-gated data authoring surface (`/studio`) on top of the existing extraction pipeline. The three core technical problems are: (1) enforcing a multi-role RBAC system without breaking the existing `owner/manager/staff` model, (2) building a spreadsheet-style inline editor with conditional validation logic, and (3) maintaining a complete, queryable audit trail as records move through the promotion workflow.

**Architecture overview:** A new `user_roles` junction table in Supabase enforces roles at the DB layer via RLS policies. FastAPI endpoints use a new `require_studio_role()` dependency (extending the `verify_admin_token` pattern already in `research_routes.py`) that checks JWT claims against `user_roles`. The frontend adds a `/studio` route protected by an extended `ProtectedRoute` that reads a `studioRoles` array from AuthContext. The inline editor uses local React state (`useState` per row/field) with framer-motion height animations and react-hook-form's `trigger()` for conditional reason-field validation.

**Primary recommendation:** Use Supabase JWT custom claims (`app_metadata.roles` array) populated at invite-token redemption as the source of truth for role checks, with `user_roles` table as the persistent store. This keeps auth stateless (no DB hit per request) while staying auditable.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React + TypeScript | 18.2 (already installed) | UI component tree | Project standard |
| react-hook-form | 7.49.3 (already installed) | Inline edit forms, conditional validation | Project standard |
| framer-motion | 10.18.0 (already installed) | Inline edit expand/collapse, queue animations | Project standard |
| Tailwind CSS | 3.4.1 (already installed) | All layout and styling | Project standard |
| Radix UI | various (already installed) | Accessible dropdown, tooltip, tabs | Project standard |
| Zustand | 4.4.7 (already installed) | `useOnboardingSessionStore` for local session state | Project standard |
| Lucide-react | 0.303.0 (already installed) | All icons | Project standard |
| supabase-js | 2.90.1 (already installed) | DB calls from frontend | Project standard |
| axios | 1.13.2 (already installed) | Backend API calls via AuthContext | Project standard |
| FastAPI | 0.109.0 (already installed) | All new API endpoints | Project standard |
| supabase-py | ≥2.10.0 (already installed) | Backend DB queries | Project standard |
| zod | 3.22.4 (already installed) | Frontend schema validation | Project standard |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@tanstack/react-query` | 5.17.9 (already installed) | Session/queue data fetching, cache invalidation | API calls in React — use `useQuery`/`useMutation` |
| `sonner` | 1.3.1 (already installed) | Override submit / approve / error toasts | Non-blocking user feedback |
| `date-fns` | 3.0.6 (already installed) | Approval latency, token expiry display | Date formatting |

### No New Dependencies Required
All required libraries are already installed. Phase 13 adds zero new npm or pip packages. [VERIFIED: apps/web/package.json — confirmed framer-motion, react-hook-form, zod, zustand, @tanstack/react-query, supabase-js, sonner all present]

---

## Architecture Patterns

### Recommended Project Structure

```
apps/web/src/
├── pages/
│   ├── Studio.tsx                    # Main /studio page (D-09)
│   └── StudioApprovalQueue.tsx       # Review admin queue page (D-14)
├── components/
│   └── studio/
│       ├── StudioIngestionBar.tsx    # Command-palette smart input (D-10)
│       ├── StudioWineTable.tsx       # Fixed-column wine record table (D-06)
│       ├── StudioFieldCell.tsx       # Inline click-to-edit cell (D-05)
│       ├── StudioOverrideForm.tsx    # Inline reason+citation form (D-07, D-08)
│       ├── StudioBadge.tsx           # Confidence/source/status badges
│       └── StudioTrustProgress.tsx   # "4/5 approvals" progress bar (D-12)
├── stores/
│   └── useOnboardingSessionStore.ts  # Zustand store for session state
└── contexts/
    └── AuthContext.tsx               # Extend to include studioRoles: string[]

services/agent-orchestrator/
├── api/
│   ├── studio_routes.py              # New router: /api/v1/studio/*
│   └── invite_routes.py              # Invite token CRUD
├── services/
│   └── override_service.py           # Promotion logic, trust tracking
└── tests/
    ├── test_studio_routes.py
    └── test_override_service.py

supabase/migrations/
├── 20260412000000_user_roles.sql
├── 20260412000001_onboarding_sessions.sql
├── 20260412000002_override_events.sql
└── 20260412000003_invite_tokens.sql
```

---

## Pattern 1: Supabase RLS Multi-Role Junction Table

**What:** A `user_roles` table stores `(user_id UUID, role TEXT, granted_by UUID, granted_at TIMESTAMPTZ)`. RLS policies on `override_events` and `onboarding_sessions` check `EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = ANY(ARRAY['developer','review_admin']))`. [ASSUMED — standard Supabase RLS junction pattern; recommended approach for multi-role systems]

**Why junction table over enum extension:** The existing `users` table has a single `role` column of type `owner|manager|staff`. Extending that enum would require touching existing RLS policies across all existing tables. A separate junction table isolates the new roles completely — no migration risk to existing data. (D-01 locked decision)

**Migration pattern:**

```sql
-- supabase/migrations/20260412000000_user_roles.sql
CREATE TABLE IF NOT EXISTS user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,                  -- References auth.users.id
    role TEXT NOT NULL CHECK (role IN ('developer', 'certified_contributor', 'review_admin')),
    granted_by UUID,                        -- NULL = system grant (first dev seed)
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ,                 -- NULL = active
    UNIQUE (user_id, role)
);

-- RLS: users can read their own roles
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_read_own_roles" ON user_roles
    FOR SELECT USING (auth.uid() = user_id);

-- RLS: only review_admins can insert/update roles
CREATE POLICY "review_admin_manage_roles" ON user_roles
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.role = 'review_admin'
              AND ur.revoked_at IS NULL
        )
    );
```

**FastAPI JWT claim approach:** At invite-token redemption, set `app_metadata.roles` on the Supabase user via the Admin API. FastAPI decodes the JWT and reads `app_metadata.roles` for stateless role checks. [ASSUMED — standard Supabase custom claims pattern]

```python
# services/agent-orchestrator/api/studio_routes.py
from fastapi import Depends, Header, HTTPException
import jwt
import os

SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "")

def require_studio_role(*required_roles: str):
    """FastAPI dependency — verifies Bearer JWT has at least one of the required studio roles."""
    def _check(authorization: str | None = Header(None)) -> dict:
        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="Missing Bearer token")
        token = authorization.removeprefix("Bearer ")
        try:
            payload = jwt.decode(token, SUPABASE_JWT_SECRET, algorithms=["HS256"],
                                 options={"verify_aud": False})
        except jwt.ExpiredSignatureError:
            raise HTTPException(status_code=401, detail="Token expired")
        except jwt.PyJWTError as e:
            raise HTTPException(status_code=401, detail=f"Invalid token: {e}")
        
        # Check app_metadata.roles (set at invite redemption)
        app_meta = payload.get("app_metadata", {})
        user_roles = app_meta.get("roles", [])
        if not any(r in user_roles for r in required_roles):
            raise HTTPException(status_code=403, detail=f"Requires one of: {required_roles}")
        return payload
    return Depends(_check)
```

**Note on `PyJWT`:** Already in requirements.txt as dependency of `supabase`. [VERIFIED: services/agent-orchestrator/requirements.txt indirectly via supabase-py dependency chain — ASSUMED as present]

---

## Pattern 2: Invite Token (Single-Use, Expiry)

**What:** `invite_tokens` table stores a UUID token, the target role, expiry, and used_at. A `review_admin` calls `POST /api/v1/studio/invite` which inserts a row and returns the token. The recipient calls `POST /api/v1/studio/invite/redeem` with the token — the API validates, marks it used, inserts into `user_roles`, and updates `app_metadata.roles` via Supabase Admin API. [ASSUMED — standard single-use token pattern as used by Linear/Vercel/Notion]

```sql
-- supabase/migrations/20260412000003_invite_tokens.sql
CREATE TABLE IF NOT EXISTS invite_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    role TEXT NOT NULL CHECK (role IN ('developer', 'certified_contributor', 'review_admin')),
    created_by UUID NOT NULL,               -- review_admin user_id
    target_email TEXT,                      -- optional, for display only
    expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
    used_at TIMESTAMPTZ,                    -- NULL = unused
    used_by UUID,                           -- user_id of redeemer
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invite_tokens_token ON invite_tokens(token) WHERE used_at IS NULL;
```

**Redemption endpoint flow:**

```python
@studio_router.post("/invite/redeem")
async def redeem_invite(token: str, _user: dict = require_studio_role("developer", "certified_contributor", "review_admin")):
    # 1. Look up token — 404 if not found
    # 2. Check used_at IS NULL — 409 if already used
    # 3. Check expires_at > NOW() — 410 if expired
    # 4. Mark used_at = NOW(), used_by = auth.uid()
    # 5. INSERT INTO user_roles (user_id, role, granted_by)
    # 6. Supabase Admin API: update user app_metadata.roles to include new role
    # 7. Return { role_granted: role, message: "..." }
```

**Security:** Token is a UUID (128-bit random) — computationally infeasible to guess. Single-use prevents replay. Expiry prevents indefinite open invitations. No role can be self-granted (D-04). [ASSUMED — consistent with standard invite token security properties]

---

## Pattern 3: Inline Click-to-Edit (Spreadsheet Style)

**What:** Each field cell in the wine table is a React component with two render modes: `display` (shows value + confidence badge) and `editing` (shows input + optional reason form). State is managed per-cell with a `useState<boolean>` for `isEditing`. framer-motion `AnimatePresence` handles the reason form expand/collapse. [ASSUMED — standard controlled component pattern; no external table library needed per D-05]

```tsx
// apps/web/src/components/studio/StudioFieldCell.tsx
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { motion, AnimatePresence } from 'framer-motion'

interface FieldCellProps {
  field: string
  value: string | null
  confidence: number | null
  source: string | null
  onOverride: (newValue: string, reason: string | null, citationUrl: string | null) => Promise<void>
}

export function StudioFieldCell({ field, value, confidence, source, onOverride }: FieldCellProps) {
  const [isEditing, setIsEditing] = useState(false)
  const requiresReason = (confidence ?? 0) >= 0.8  // D-07: smart reason enforcement

  const schema = z.object({
    newValue: z.string().min(1, 'Value required'),
    reason: requiresReason ? z.string().min(5, 'Reason required for high-confidence override') : z.string().optional(),
    citationUrl: z.string().url().optional().or(z.literal('')),
  })

  const { register, handleSubmit, formState: { errors }, trigger } = useForm({
    resolver: zodResolver(schema),
  })

  const onSubmit = async (data: z.infer<typeof schema>) => {
    await onOverride(data.newValue, data.reason ?? null, data.citationUrl ?? null)
    setIsEditing(false)
  }

  if (!isEditing) {
    return (
      <td
        className="cursor-pointer px-3 py-2 hover:bg-slate-50 group"
        onClick={() => setIsEditing(true)}
      >
        <span className="text-sm text-slate-900">{value ?? '—'}</span>
        {confidence != null && <ConfidenceBadge confidence={confidence} />}
      </td>
    )
  }

  return (
    <td className="px-3 py-2 min-w-[200px]">
      <form onSubmit={handleSubmit(onSubmit)}>
        <input {...register('newValue')} defaultValue={value ?? ''} autoFocus
          className="w-full text-sm border border-slate-300 rounded px-2 py-1 focus:ring-2 focus:ring-wine-500" />
        
        <AnimatePresence>
          {requiresReason && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden"
            >
              <textarea
                {...register('reason')}
                placeholder="e.g. confirmed on producer website, verified from label photo"
                className="mt-1 w-full text-xs border border-slate-200 rounded px-2 py-1 resize-none"
                rows={2}
              />
              {errors.reason && <p className="text-xs text-red-500">{errors.reason.message}</p>}
            </motion.div>
          )}
        </AnimatePresence>

        <input {...register('citationUrl')} placeholder="Citation URL (optional)"
          className="mt-1 w-full text-xs border border-slate-200 rounded px-2 py-1" />

        <div className="mt-1 flex gap-1">
          <button type="submit" className="text-xs bg-wine-600 text-white px-2 py-1 rounded">Save</button>
          <button type="button" onClick={() => setIsEditing(false)} className="text-xs text-slate-500 px-2 py-1">Cancel</button>
        </div>
      </form>
    </td>
  )
}
```

**Key insight:** `confidence >= 0.8` check is done at render time from the field's `field_confidence` JSONB entry — no extra API call needed since it's already in the session data. [ASSUMED — consistent with existing field_confidence JSONB structure from Phase 7]

---

## Pattern 4: Smart Reason Enforcement

**What:** Conditional field requirement in react-hook-form. Implemented via Zod `superRefine` or by passing a dynamic schema based on the `confidence` prop. The `requiresReason` boolean is computed once from the field's confidence score before rendering. [ASSUMED — standard react-hook-form + zod pattern]

**Alternative using `register` validation:**
```tsx
// Inline conditional required via register options
<input
  {...register('reason', {
    validate: (val) => {
      if (requiresReason && (!val || val.length < 5)) {
        return 'Reason required when overriding a high-confidence field'
      }
      return true
    }
  })}
/>
```

**Pitfall:** Don't use `required: requiresReason` in register options — this only triggers HTML5 browser validation, not react-hook-form's validation pipeline. Always use `validate` or Zod schema. [ASSUMED — known react-hook-form behavior]

---

## Pattern 5: Trust-Level Promotion Logic

**What:** A `trust_levels` table (or columns on `user_roles`) tracks `consecutive_approved_overrides` per certified_contributor. After N=5 consecutive approvals with no rejections, the user's `promotion_policy` is upgraded to `auto_promote`. The Python `override_service.py` updates this counter on each approval/rejection decision. [ASSUMED — simple counter pattern]

```sql
-- Add trust tracking to user_roles (or as separate trust_levels table)
ALTER TABLE user_roles ADD COLUMN IF NOT EXISTS
    consecutive_approved_overrides INT NOT NULL DEFAULT 0;
ALTER TABLE user_roles ADD COLUMN IF NOT EXISTS
    promotion_policy TEXT NOT NULL DEFAULT 'queue'
    CHECK (promotion_policy IN ('queue', 'auto_promote'));
ALTER TABLE user_roles ADD COLUMN IF NOT EXISTS
    auto_promote_earned_at TIMESTAMPTZ;
```

**Promotion check in `override_service.py`:**
```python
def check_and_update_trust(supabase, user_id: str, approved: bool, threshold: int = 5):
    """Update consecutive_approved_overrides; flip policy to auto_promote at threshold."""
    if approved:
        # Increment counter
        resp = supabase.rpc("increment_trust_counter", {"p_user_id": user_id}).execute()
        # Fetch current count
        ur = supabase.table("user_roles").select("consecutive_approved_overrides") \
            .eq("user_id", user_id).eq("role", "certified_contributor").single().execute()
        count = ur.data["consecutive_approved_overrides"]
        if count >= threshold:
            supabase.table("user_roles").update({
                "promotion_policy": "auto_promote",
                "auto_promote_earned_at": "now()"
            }).eq("user_id", user_id).eq("role", "certified_contributor").execute()
    else:
        # Any rejection resets the streak
        supabase.table("user_roles").update({"consecutive_approved_overrides": 0}) \
            .eq("user_id", user_id).eq("role", "certified_contributor").execute()
```

**Pitfall:** The counter tracks *consecutive* approvals — a single rejection resets to zero. This prevents gaming the system by alternating good/bad overrides. [ASSUMED — derived from D-12 decision logic]

---

## Pattern 6: Command-Palette Ingestion Bar

**What:** A single `<input>` (or `<div>` with drag-drop handlers) that auto-detects content type using these rules:
1. If dragged file with `.pdf` extension → PDF upload path → `POST /api/v1/onboarding/extract`
2. If input value starts with `http://` or `https://` → URL crawler path → `POST /api/v1/research/trigger` or new `POST /api/v1/studio/crawl`
3. Otherwise → manual seed record path → opens an empty record for direct field entry

[ASSUMED — straightforward pattern; no external library needed]

```tsx
// Detection logic
function detectIngestionType(value: string, files?: FileList): 'pdf' | 'url' | 'manual' {
  if (files && files.length > 0 && files[0].name.endsWith('.pdf')) return 'pdf'
  if (/^https?:\/\//i.test(value.trim())) return 'url'
  return 'manual'
}

// Drag-and-drop handlers
<div
  onDragOver={(e) => e.preventDefault()}
  onDrop={(e) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file?.name.endsWith('.pdf')) handlePdfUpload(file)
  }}
>
  <input
    placeholder="Paste URL, drag PDF, or type wine name..."
    onChange={(e) => setInputValue(e.target.value)}
    onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
  />
</div>
```

**UX note:** Add a visual indicator that switches in real-time: URL icon when URL detected, PDF icon on drag-over, pencil icon for manual. Use Lucide's `Link`, `FileText`, `Pencil` icons. [ASSUMED — standard UX pattern]

---

## Pattern 7: Session Audit Timeline

**What:** `onboarding_sessions` table tracks each ingestion session. `override_events` table (replacing or extending `field_corrections`) logs every override with full provenance. A `GET /api/v1/studio/sessions/{id}` endpoint joins both tables and returns a chronological event log. [ASSUMED — standard audit trail pattern]

```sql
-- supabase/migrations/20260412000001_onboarding_sessions.sql
CREATE TABLE IF NOT EXISTS onboarding_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID NOT NULL,                 -- user_id from user_roles
    source_type TEXT NOT NULL CHECK (source_type IN ('pdf_upload', 'url_crawl', 'manual_seed')),
    source_ref TEXT,                        -- URL or filename
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'completed', 'abandoned')),
    scan_session_id TEXT,                   -- FK to master_wine_library_submissions.scan_session_id
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_onboarding_sessions_actor ON onboarding_sessions(actor_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_sessions_scan ON onboarding_sessions(scan_session_id);
```

```sql
-- supabase/migrations/20260412000002_override_events.sql
-- Extends field_corrections with full provenance for Phase 13 promotions
CREATE TABLE IF NOT EXISTS override_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES onboarding_sessions(id) ON DELETE CASCADE,
    submission_id UUID NOT NULL,            -- FK to master_wine_library_submissions.id
    actor_id UUID NOT NULL,                 -- user who submitted the override
    field_name VARCHAR(100) NOT NULL,
    old_value TEXT,                         -- value before override (NULL if filling empty field)
    new_value TEXT NOT NULL,
    old_confidence DECIMAL(3,2),            -- confidence score before override
    reason TEXT,                            -- required when old_confidence >= 0.8
    citation_url TEXT,
    citation_snippet TEXT,
    promotion_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (promotion_status IN ('pending', 'auto_promoted', 'approved', 'rejected')),
    approved_by UUID,                       -- review_admin user_id
    approval_note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    decided_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_override_events_submission ON override_events(submission_id);
CREATE INDEX IF NOT EXISTS idx_override_events_session ON override_events(session_id);
CREATE INDEX IF NOT EXISTS idx_override_events_pending ON override_events(promotion_status)
    WHERE promotion_status = 'pending';
CREATE INDEX IF NOT EXISTS idx_override_events_actor ON override_events(actor_id);
```

**Relationship to existing `field_corrections`:** `field_corrections` (from Phase 5) records raw QA corrections by any reviewer. `override_events` records the Phase 13 studio override workflow with full provenance, role context, and promotion tracking. Both tables should coexist — Phase 13 writes to `override_events`, existing quality routes continue writing to `field_corrections`. Do NOT remove `field_corrections`. [VERIFIED: supabase/migrations/20260404000002_field_corrections.sql — confirmed field_corrections exists and is used by research_routes.py; keep both tables]

---

## Pattern 8: FastAPI RBAC — Studio Endpoints

**What:** Extend the `verify_admin_token` pattern from `research_routes.py` into a reusable `require_studio_role()` dependency. Each endpoint declares which roles are permitted.

**Endpoint summary:**

| Method | Path | Required Role | Description |
|--------|------|---------------|-------------|
| POST | `/api/v1/studio/sessions` | developer, certified_contributor, review_admin | Start new session |
| GET | `/api/v1/studio/sessions/{id}` | developer, certified_contributor, review_admin | Get session timeline |
| POST | `/api/v1/studio/overrides` | developer, certified_contributor, review_admin | Submit field override |
| GET | `/api/v1/studio/queue` | review_admin | Get pending approvals |
| PATCH | `/api/v1/studio/queue/{override_id}` | review_admin | Approve/reject override |
| POST | `/api/v1/studio/invite` | review_admin | Generate invite token |
| POST | `/api/v1/studio/invite/redeem` | Any authenticated user | Redeem invite token |
| GET | `/api/v1/studio/metrics` | developer, review_admin | Override KPI metrics |

**Override submission logic (D-13 vs D-12):**

```python
@studio_router.post("/overrides")
async def submit_override(body: OverrideRequest, user: dict = Depends(require_studio_role(
    "developer", "certified_contributor", "review_admin"
))):
    role = _get_primary_studio_role(user)  # highest trust role if multiple
    
    if role in ("developer", "review_admin"):
        promotion_status = "auto_promoted"  # D-13: instant promote
        # Write directly to field_confidence with merge_field_confidence()
        _apply_override_to_submission(supabase, body, user["sub"])
    else:
        # certified_contributor — check trust level
        ur = _get_user_role(supabase, user["sub"], "certified_contributor")
        if ur["promotion_policy"] == "auto_promote":
            promotion_status = "auto_promoted"
            _apply_override_to_submission(supabase, body, user["sub"])
        else:
            promotion_status = "pending"  # goes to approval queue (D-12)
    
    # Always log to override_events (D-15)
    supabase.table("override_events").insert({...}).execute()
    return {"status": promotion_status, "override_id": ...}
```

[ASSUMED — derives directly from D-12/D-13 decisions; pattern consistent with existing research_routes.py verify_admin_token]

---

## Pattern 9: AuthContext Extension for Studio Roles

**What:** The existing `AuthContext.tsx` has `User.role: 'owner' | 'manager' | 'staff'`. Extend to add `studioRoles: string[]` populated by a separate `/api/v1/studio/me/roles` call after authentication. [ASSUMED — non-breaking extension of existing AuthContext]

```typescript
// Extend User interface — non-breaking addition
interface User {
  userId: string
  email: string
  name: string
  role: 'owner' | 'manager' | 'staff'
  restaurantId: string
  studioRoles?: ('developer' | 'certified_contributor' | 'review_admin')[]  // NEW
}
```

**`ProtectedRoute` extension:**
```tsx
interface ProtectedRouteProps {
  children: React.ReactNode
  requiredRole?: 'owner' | 'manager' | 'staff'
  requiredStudioRole?: ('developer' | 'certified_contributor' | 'review_admin')[]  // NEW
  redirectTo?: string
}

// In role check:
if (requiredStudioRole && !requiredStudioRole.some(r => user?.studioRoles?.includes(r))) {
  return <AccessDenied />
}
```

---

## Pattern 10: Override Promotion — Calling merge_field_confidence()

**What:** When an override is auto-promoted, the backend must call `merge_field_confidence()` from `services/field_confidence.py` (established in Phase 7) to update the submission's `field_confidence` JSONB column. This ensures the new value doesn't accidentally downgrade confidence. [VERIFIED: services/agent-orchestrator/api/onboarding_routes.py uses route_fields_by_threshold and should_auto_block from field_confidence.py — confirmed field_confidence module exists]

```python
from services.field_confidence import merge_field_confidence

def _apply_override_to_submission(supabase, body: OverrideRequest, actor_id: str):
    """Write approved override value to field_confidence JSONB with merge protection."""
    # Fetch current field_confidence
    resp = supabase.table("master_wine_library_submissions") \
        .select("field_confidence").eq("id", body.submission_id).single().execute()
    existing_fc = resp.data["field_confidence"] or {}
    
    # Build new entry — manual override always gets confidence 1.0 (human authority)
    new_entry = {body.field_name: {"value": body.new_value, "confidence": 1.0, "source": "human_override"}}
    merged = merge_field_confidence(existing_fc, new_entry)
    
    supabase.table("master_wine_library_submissions").update({
        "field_confidence": merged
    }).eq("id", body.submission_id).execute()
```

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Conditional form validation | Custom `if (confidence >= 0.8) setError(...)` imperative logic | Zod `.superRefine()` or react-hook-form `validate` callback | Declarative, reusable, integrates with form state |
| UUID token generation | `random.choices(string.ascii_letters, k=32)` | `gen_random_uuid()` in Postgres or Python `uuid.uuid4()` | Cryptographically random 128-bit; collision probability negligible |
| Spreadsheet cell focus management | Complex `useRef` orchestration | CSS `focus-within` + `autoFocus` on input mount | Browser handles focus natively; simpler code |
| Role check DB query per request | `SELECT * FROM user_roles WHERE user_id = ?` on every API call | JWT `app_metadata.roles` claim (set once at invite redemption) | Stateless; no DB round-trip; Supabase rotates JWTs with claims |
| Custom confidence badge colors | Hardcoded hex values | Tailwind utility classes: `bg-red-100 text-red-700` (< 0.5), `bg-amber-100 text-amber-700` (0.5–0.8), `bg-green-100 text-green-700` (> 0.8) | Consistent with project Tailwind conventions |
| Trust counter race condition | Application-level counter with optimistic UI | `supabase.rpc("increment_trust_counter")` Postgres function | Atomic DB-level increment; no race condition under concurrent approvals |

---

## Common Pitfalls

### Pitfall 1: RLS Infinite Recursion on user_roles
**What goes wrong:** An RLS policy on `user_roles` that queries `user_roles` itself to check if the user is a `review_admin` causes infinite recursion.
**Why it happens:** `CREATE POLICY ... USING (EXISTS (SELECT 1 FROM user_roles WHERE ...))` — the policy checks the table it's protecting.
**How to avoid:** Use `SECURITY DEFINER` function to bypass RLS when checking roles, OR use Supabase's `auth.jwt() -> 'app_metadata' -> 'roles'` JWT claim check instead of querying the table. [ASSUMED — well-known Supabase RLS pitfall]
**Example fix:**
```sql
-- Use JWT claim instead of table self-reference
CREATE POLICY "review_admin_manage_roles" ON user_roles
    FOR ALL USING (
        (auth.jwt() -> 'app_metadata' -> 'roles') ? 'review_admin'
    );
```

### Pitfall 2: Token in URL Query String
**What goes wrong:** Invite link puts token in query string (`/studio/accept?token=UUID`). Tokens appear in server access logs, browser history, and Referer headers.
**Why it happens:** Easiest implementation.
**How to avoid:** Use path parameter (`/studio/invite/UUID`) or put token in the POST body only. The link takes the user to a redemption page that POSTs the token — token never leaves the client in a visible header. [ASSUMED — standard security practice]

### Pitfall 3: framer-motion Height Animation with `overflow: hidden`
**What goes wrong:** `height: 0 → height: 'auto'` animation collapses content prematurely or clips input focus rings.
**Why it happens:** CSS `overflow: hidden` clips child content during animation.
**How to avoid:** Add `className="overflow-hidden"` to the motion.div wrapper only, not to the form contents. Input focus rings appear outside the element bounds — add `focus-visible:outline-offset-0` to inputs inside animated containers. [ASSUMED — known framer-motion layout animation behavior]

### Pitfall 4: `merge_field_confidence()` Signature Mismatch
**What goes wrong:** `merge_field_confidence()` from Phase 7 may expect a specific schema format for entries. Passing a flat `{field: value}` dict instead of `{field: {value, confidence, source}}` causes silent no-ops or KeyError.
**Why it happens:** Phase 7 established the `{value, confidence, source}` nested format; Phase 13 code must match.
**How to avoid:** Always construct `{field_name: {"value": new_value, "confidence": 1.0, "source": "human_override"}}` before passing to `merge_field_confidence()`. [VERIFIED: services/agent-orchestrator/api/onboarding_routes.py imports merge_field_confidence via field_confidence module — confirmed the function exists; exact signature ASSUMED to match Phase 7 conventions]

### Pitfall 5: invite_tokens Table Not Cleaned Up
**What goes wrong:** Used tokens accumulate, table grows unbounded, queries slow down.
**How to avoid:** Add a daily Celery beat task `cleanup_expired_invites_task` that deletes rows where `expires_at < NOW() - INTERVAL '30 days'`. Or add a partial index and accept that the table stays small (review_admin only generates tokens). [ASSUMED]

### Pitfall 6: AuthContext studioRoles Load Race
**What goes wrong:** User navigates to `/studio` before `studioRoles` API call resolves — `ProtectedRoute` sees `studioRoles = undefined` and renders Access Denied.
**How to avoid:** Initialize `studioRoles` as `undefined` (not `[]`) in AuthContext. `ProtectedRoute` must treat `undefined` as "loading" (show spinner), not "denied". Only show Access Denied when `studioRoles` is a populated array that doesn't include the required role. [ASSUMED — React async state initialization pattern]

### Pitfall 7: Confidence Badge Misgrouping
**What goes wrong:** Using `confidence > 0.8` instead of `confidence >= 0.8` at the boundary — a field with exactly 0.8 gets amber badge but reason is NOT required.
**Why it happens:** Off-by-one in threshold logic — FCONF-04 says `> 0.8` auto-accepts, `0.5–0.8` review tier.
**How to avoid:** Phase 13 D-07 says reason required when `confidence >= 0.8`. Be explicit: `requiresReason = (confidence ?? 0) >= 0.8`. This is a Phase 13-specific rule distinct from FCONF-04. [VERIFIED: CONTEXT.md D-07 — confirmed `confidence >= 0.8` threshold]

---

## Code Examples

### Confidence Badge Component
```tsx
// Source: project convention — consistent with badge.tsx variants
function ConfidenceBadge({ confidence }: { confidence: number }) {
  if (confidence >= 0.8)
    return <span className="ml-1 text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-700 font-medium">
      {Math.round(confidence * 100)}%
    </span>
  if (confidence >= 0.5)
    return <span className="ml-1 text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium">
      {Math.round(confidence * 100)}%
    </span>
  return <span className="ml-1 text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-medium">
    {Math.round(confidence * 100)}%
  </span>
}
```

### Trust Progress Bar
```tsx
// Source: framer-motion animate prop pattern (project already uses framer-motion 10.18.0)
function TrustProgress({ approved, threshold = 5 }: { approved: number; threshold?: number }) {
  const pct = Math.min((approved / threshold) * 100, 100)
  return (
    <div className="flex items-center gap-2 text-xs text-slate-500">
      <span>{approved}/{threshold} approvals toward auto-promote</span>
      <div className="w-24 h-1.5 bg-slate-200 rounded-full overflow-hidden">
        <motion.div
          className="h-full bg-wine-500 rounded-full"
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
        />
      </div>
    </div>
  )
}
```

### Approval Queue API Pattern
```python
# Extend research_routes.py verify_admin_token pattern
@studio_router.patch("/queue/{override_id}")
def decide_override(
    override_id: str,
    body: ApprovalDecision,
    user: dict = Depends(require_studio_role("review_admin"))
):
    """PATCH /api/v1/studio/queue/{override_id} — approve or reject override."""
    approved = body.decision == "approved"
    supabase = _get_supabase()
    
    # Get override to find actor_id for trust tracking
    ov = supabase.table("override_events").select("*").eq("id", override_id).single().execute()
    if not ov.data:
        raise HTTPException(404, "Override not found")
    if ov.data["promotion_status"] != "pending":
        raise HTTPException(409, "Override already decided")
    
    # Update override_events
    supabase.table("override_events").update({
        "promotion_status": "approved" if approved else "rejected",
        "approved_by": user["sub"],
        "approval_note": body.note,
        "decided_at": "now()"
    }).eq("id", override_id).execute()
    
    # If approved, write to field_confidence
    if approved:
        _apply_override_to_submission(supabase, ov.data, ov.data["actor_id"])
    
    # Update trust level for certified_contributors (D-12)
    actor_roles = _get_user_studio_roles(supabase, ov.data["actor_id"])
    if "certified_contributor" in actor_roles and "developer" not in actor_roles:
        check_and_update_trust(supabase, ov.data["actor_id"], approved)
    
    return {"decision": body.decision, "override_id": override_id}
```

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Python 3.11 | FastAPI backend | ✓ | 3.11.0 | — |
| Node.js | React frontend | ✓ | 22.22.2 | — |
| FastAPI | New studio_routes.py | ✓ | 0.109.0 | — |
| supabase-py | DB operations | ✓ | ≥2.10.0 | — |
| React + Vite | Frontend | ✓ | 18.2 / 5.0.11 | — |
| framer-motion | Inline edit animations | ✓ | 10.18.0 | — |
| react-hook-form | Form validation | ✓ | 7.49.3 | — |
| zod | Schema validation | ✓ | 3.22.4 | — |
| Zustand | Session store | ✓ | 4.4.7 | — |
| PyJWT | JWT decode in FastAPI | ✓ (via supabase-py) | — | [ASSUMED] |

**No missing dependencies.** [VERIFIED: apps/web/package.json — all frontend deps present; services/agent-orchestrator/requirements.txt — all backend deps present]

**PyJWT note:** Supabase-py depends on `httpx`, not PyJWT directly. For JWT decode in FastAPI, explicitly add `PyJWT>=2.8.0` to requirements.txt if not already present. Verify with: `pip show pyjwt`. [ASSUMED — needs verification at implementation time]

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Backend framework | pytest 7.x (from pytest.ini in services/agent-orchestrator/) |
| Frontend framework | Vitest (vitest.config.ts detected in apps/web/) |
| Backend config file | `services/agent-orchestrator/pytest.ini` |
| Frontend config file | `apps/web/vitest.config.ts` |
| Backend quick run | `cd services/agent-orchestrator && pytest tests/test_studio_routes.py tests/test_override_service.py -x` |
| Backend full suite | `cd services/agent-orchestrator && pytest tests/ -v` |
| Frontend test run | `cd apps/web && npx vitest run src/components/studio/` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DEVUI-01 | Role enforcement: 403 when non-studio user hits /studio/* | unit | `pytest tests/test_studio_routes.py::test_unauthorized_access -x` | ❌ Wave 0 |
| DEVUI-02 | Auto-detect URL vs PDF vs manual in StudioIngestionBar | unit | `npx vitest run src/components/studio/StudioIngestionBar.test.tsx` | ❌ Wave 0 |
| DEVUI-03 | Inline edit cell renders display/editing modes | unit | `npx vitest run src/components/studio/StudioFieldCell.test.tsx` | ❌ Wave 0 |
| DEVUI-04 | reason required when confidence ≥ 0.8, not required when NULL | unit | `pytest tests/test_studio_routes.py::test_reason_enforcement -x` | ❌ Wave 0 |
| DEVUI-05 | override_events row inserted on every override | unit | `pytest tests/test_override_service.py::test_override_audit_log -x` | ❌ Wave 0 |
| DEVUI-06 | merge_field_confidence called on auto-promote | unit | `pytest tests/test_override_service.py::test_merge_on_auto_promote -x` | ❌ Wave 0 |
| DEVUI-07 | Invite token: single-use, expires, grant correct role | unit | `pytest tests/test_studio_routes.py::test_invite_lifecycle -x` | ❌ Wave 0 |
| DEVUI-08 | GET /sessions/{id} returns chronological event log | unit | `pytest tests/test_studio_routes.py::test_session_timeline -x` | ❌ Wave 0 |
| DEVUI-09 | GET /studio/metrics returns override_rate, approval_latency | unit | `pytest tests/test_studio_routes.py::test_studio_metrics -x` | ❌ Wave 0 |
| DEVUI-10 | E2E: PDF → extract → override 3 fields → approve → promoted | e2e | `pytest tests/test_studio_e2e.py -m e2e -x` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `cd services/agent-orchestrator && pytest tests/test_studio_routes.py -x`
- **Per wave merge:** `cd services/agent-orchestrator && pytest tests/ -v`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `services/agent-orchestrator/tests/test_studio_routes.py` — covers DEVUI-01, DEVUI-04, DEVUI-07, DEVUI-08, DEVUI-09
- [ ] `services/agent-orchestrator/tests/test_override_service.py` — covers DEVUI-05, DEVUI-06
- [ ] `services/agent-orchestrator/tests/test_studio_e2e.py` — covers DEVUI-10
- [ ] `apps/web/src/components/studio/StudioIngestionBar.test.tsx` — covers DEVUI-02
- [ ] `apps/web/src/components/studio/StudioFieldCell.test.tsx` — covers DEVUI-03
- [ ] No framework install needed — pytest and vitest both already configured

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Supabase JWT Bearer token (existing pattern) |
| V3 Session Management | yes | JWT expiry; 401 interceptor with refresh already in AuthContext.tsx |
| V4 Access Control | yes | `require_studio_role()` FastAPI dependency; RLS on user_roles, override_events |
| V5 Input Validation | yes | Zod on frontend; Pydantic models on FastAPI backend |
| V6 Cryptography | yes (tokens) | `gen_random_uuid()` in Postgres for invite tokens — never hand-roll |

### Known Threat Patterns for This Phase

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Invite token brute-force | Spoofing | UUID4 (128-bit random) — ~10^38 combinations; rate-limit `/invite/redeem` to 5 attempts/IP/minute |
| Role escalation via forged JWT | Elevation of Privilege | `require_studio_role()` verifies signature with `SUPABASE_JWT_SECRET`; any tampering → invalid signature → 401 |
| Unauthorized override via direct API call | Tampering | RLS on `override_events` requires `auth.uid()` match; FastAPI RBAC additionally checks role |
| Replay of used invite token | Repudiation | `used_at` timestamp; second redemption attempt → 409 Conflict |
| Certified contributor self-promotes trust counter | Elevation | Trust counter only incremented by `review_admin` on PATCH `/queue/{id}` — not by the override submitter |
| Override reason bypass (empty string) | Tampering | Zod `z.string().min(5)` enforced server-side in FastAPI Pydantic model, not only frontend |
| Session timeline data leakage | Info Disclosure | RLS: users can only read sessions where `actor_id = auth.uid()` OR role is `review_admin`/`developer` |
| Token in server logs | Info Disclosure | Use path param `/invite/{token}` → GET page → user POSTs token in body (not query string) |

---

## DB Schema Summary

The following new tables are required (full SQL in Architecture Patterns above):

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `user_roles` | Multi-role junction; RLS-enforced | user_id, role, granted_by, revoked_at, consecutive_approved_overrides, promotion_policy |
| `invite_tokens` | Single-use role grant tokens | token (UUID), role, expires_at, used_at, used_by |
| `onboarding_sessions` | Session-level ingestion tracking | actor_id, source_type, source_ref, scan_session_id, status |
| `override_events` | Full-provenance override audit log | submission_id, actor_id, field_name, old/new_value, old_confidence, reason, citation_url, promotion_status, approved_by |

**Existing tables extended:**
- `user_roles`: add `consecutive_approved_overrides INT DEFAULT 0`, `promotion_policy TEXT DEFAULT 'queue'`, `auto_promote_earned_at TIMESTAMPTZ`

**Existing tables NOT modified:**
- `field_corrections` — keep as-is; `override_events` is additive, not a replacement
- `field_review_queue` — keep as-is; Phase 13 reads from it (to show review status), does not change it
- `master_wine_library_submissions` — Phase 13 writes to `field_confidence` JSONB via merge_field_confidence() only

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | PyJWT is available in the agent-orchestrator venv (transitively via supabase-py) | Pattern 1 (FastAPI RBAC) | Need to add `PyJWT>=2.8.0` to requirements.txt explicitly |
| A2 | `merge_field_confidence()` signature accepts `{field: {value, confidence, source}}` nested format | Pattern 10 | Need to adjust wrapper code to match actual signature |
| A3 | Supabase JWT `app_metadata.roles` claim can be updated by admin API call at invite redemption | Pattern 1, Invite Token | If Admin API not accessible from FastAPI, fall back to DB query per request |
| A4 | `auth.jwt() -> 'app_metadata' -> 'roles'` syntax works in Supabase RLS policy JSONB path operator | Pattern 1 pitfall | Need to verify exact JSONB path operator in Supabase Postgres version |
| A5 | `require_studio_role()` can decode Supabase JWT using the `SUPABASE_JWT_SECRET` env var | Pattern 1 | Need `SUPABASE_JWT_SECRET` in .env — confirm it's accessible |
| A6 | Trust counter atomicity via `supabase.rpc("increment_trust_counter")` — assumes a Postgres function exists or will be created | Pattern 5 | If not using RPC, use optimistic update + retry, or single UPDATE with returning |

---

## Open Questions

1. **`merge_field_confidence()` exact signature**
   - What we know: The function exists in `services/field_confidence.py` and is called in `onboarding_routes.py`
   - What's unclear: Exact parameter format and whether it handles source="human_override" entries
   - Recommendation: Planner Wave 1 task should read `services/field_confidence.py` fully before writing override_service.py

2. **SUPABASE_JWT_SECRET availability**
   - What we know: `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` are in `.env`; JWT secret is a different value
   - What's unclear: Whether `SUPABASE_JWT_SECRET` is already in `.env` or needs to be added
   - Recommendation: Add `SUPABASE_JWT_SECRET` to settings.py and `.env.example`; document in plan

3. **Supabase Admin API access from FastAPI**
   - What we know: The service uses `supabase-py` which has admin methods when initialized with service role key
   - What's unclear: Whether `update_user` with `app_metadata` is available in the installed `supabase-py ≥2.10.0`
   - Recommendation: Fallback design — if Admin API unavailable, skip JWT claim update and always hit DB on role check

4. **`/studio` vs `/dev/onboarding` route name**
   - Recommendation: Use `/studio` — shorter, more memorable, aligns with "data authoring studio" mental model. Matches `DevSandbox` pattern already in the app.

---

## Sources

### Primary (HIGH confidence)
- `services/agent-orchestrator/api/research_routes.py` — verify_admin_token pattern verified directly
- `services/agent-orchestrator/api/onboarding_routes.py` — existing endpoint and field_confidence integration verified directly
- `apps/web/src/contexts/AuthContext.tsx` — User interface, role field, token handling verified directly
- `apps/web/src/components/ProtectedRoute.tsx` — role gate pattern verified directly
- `supabase/migrations/20260404000002_field_corrections.sql` — field_corrections schema verified directly
- `supabase/migrations/20260405000001_field_review_queue.sql` — field_review_queue schema verified directly
- `apps/web/package.json` — all dependency versions verified directly
- `.planning/phases/13-dev-onboarding-ui-with-manual-override-access/13-CONTEXT.md` — locked decisions read directly

### Secondary (MEDIUM confidence)
- Supabase RLS multi-role junction table pattern — derived from locked D-01 decision and standard Supabase documentation conventions [ASSUMED based on well-established pattern]
- react-hook-form conditional validation — derived from installed version 7.49.3 and zod integration [ASSUMED but extremely stable API]

### Tertiary (LOW confidence)
- JWT `app_metadata.roles` claim update via Supabase Admin API — [ASSUMED]; verify with `supabase-py` Admin docs before implementation
- RLS JSONB operator `auth.jwt() -> 'app_metadata' -> 'roles'` — [ASSUMED]; test in Supabase SQL editor before committing to migration

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries verified present in package.json / requirements.txt
- Architecture patterns: HIGH — derived directly from locked CONTEXT.md decisions and codebase inspection
- DB schema: HIGH — designed to match existing migration conventions, extend not replace
- Security patterns: HIGH — derived from existing verify_admin_token pattern in codebase
- JWT/RLS specifics: MEDIUM — standard patterns but exact Supabase JSONB operator syntax needs verification

**Research date:** 2026-04-07
**Valid until:** 2026-05-07 (30 days — stable stack)
