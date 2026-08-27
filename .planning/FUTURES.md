# Mudavym — Futures Vision

> **Status:** Living product vision (not a scheduled milestone)
> **Date locked:** 2026-07-26
> **Brand:** Mudavym (evolving from WineOps AI)
> **North star (unchanged):** A full autonomous backend system for restaurants — inventory, procurement, communications, POS, agents, and ops intelligence that run the house with kitchen-grade reliability.

This document is the canonical futures contract. Other plans (`INVENTORY_SOTA_PLAN`, `FEATURE_ROADMAP`, `PROJECT.md`, `ROADMAP` backlog) defer to it for product expansion scope.

---

## 1. Ultimate goal (do not dilute)

Mudavym is **not** a wine app that grew side features. It is an autonomous restaurant operations platform whose first vertical was wine because wine has deep structured identity (producer, vintage, region, critic scores, cellar placement).

Every expansion must still serve:

- Autonomous agents + trustworthy inventory truth
- Procurement + provider communications
- POS sell-through and real cost (WAC / recipe roll-up)
- Observability, idempotency, and kitchen-grade reliability
- Multi-tenant restaurant hierarchy already in flight

Wine remains the **reference quality bar** for extraction depth. Other categories must reach the same bar — not a thinner “SKU name + qty” model.

---

## 2. Sequencing (locked)

| Stage | Scope | Notes |
|---|---|---|
| **0 — Current** | Wine (deep extraction, cellar, procurement) | Quality bar / ontology template for everything else |
| **1 — Full beverages** | All beverage types under one beverage program | Spirits, beer, cocktails, NA, wine subsections |
| **2 — Bakery (first food vertical)** | Food → Bakery | Easiest recipe + inventory loop; proves food model |
| **3 — Rest of kitchen** | Broader food categories | Only after bakery trust + recipe costing work |

Do not jump to full kitchen before bakery earns the model.

---

## 3. Taxonomy (locked)

Hierarchical product model. Top domain → subsection → fine subtypes. Every leaf item gets **fine-grained extraction + photos**, same depth standard as wine.

```
beverage
├── wine
│   ├── red
│   ├── white
│   ├── rosé
│   ├── sparkling
│   ├── fortified
│   └── other (orange, dessert, etc.)
├── beer
│   └── (style subtypes as extracted: lager, IPA, stout, …)
├── cocktail
│   └── composed SKUs with recipes / build sheets
├── hard_alcohol (spirits)
│   ├── whiskey / whisky
│   ├── vodka
│   ├── gin
│   ├── rum
│   ├── tequila / mezcal
│   ├── brandy / cognac
│   ├── liqueur
│   └── other
└── na (non-alcoholic)
    └── (soft drinks, NA wine/beer, mocktails, …)

food
└── bakery          ← first food subsection (Stage 2)
    ├── ingredients (flour, butter, yeast, …)
    ├── intermediates (dough, batter, …)
    └── finished goods (croissant, loaf, pastry, …)

# Later (Stage 3+): food → produce, protein, dairy, dry goods, …
# Always available: supply (packaging, disposables, chemicals, …)
```

**Schema intent (early, so UI does not rewrite later):**

- `domain ∈ {beverage, food, supply}`
- `subsection` (e.g. `wine`, `beer`, `cocktail`, `hard_alcohol`, `na`, `bakery`)
- `subtype` / ontology path (e.g. `wine/red`, `hard_alcohol/gin`)
- Type-specific attributes in structured fields or JSONB (wine fields already exist; spirits/beer/bakery get their own attribute packs)
- Photos / labels / packaging images attached per catalog item, same enrichment pipeline pattern as wine

---

## 4. Extraction standard (parity with wine)

For every domain/subsection, Mudavym extracts items to their **finest useful features**, not generic product rows:

| Domain | Extraction depth (examples) |
|---|---|
| **Wine** (existing bar) | Producer, vintage, region, appellation, grape, color/type, ABV, critic scores, tasting notes, barcode, images |
| **Beer** | Brand, brewery, style, ABV, IBU, pack size, format (draft keg / bottle / can), images |
| **Hard alcohol** | Brand, producer, category/subtype, age statement, ABV, proof, origin, bottle size, images |
| **Cocktail** | Name, build sheet, linked ingredient SKUs, pour specs (ml/oz), method, glassware, garnish, menu price, recipe cost |
| **NA** | Brand, category, format, allergens where relevant, images |
| **Bakery ingredients** | Brand, ingredient type, pack size, unit, allergens, storage, shelf life, supplier SKU, images |
| **Bakery finished** | Name, recipe link, yield, allergens, sell unit, shelf life / waste window, images |

Photos and brand identity are first-class — same enrichment + library matching spirit as `master_wine_library`, generalized toward a **master product catalog** with type-specific attribute packs.

---

## 5. Bakery — north star vs MVP

### North star (all of the below)

1. **Ingredients + pars / low-stock** — trusted on-hand, par, alerts
2. **Recipes / build sheets** — flour → dough → finished SKU; linked ingredient depletion
3. **Finished goods + waste / spoilage** — bake yield, day-part waste, spoilage events on the ledger
4. **POS sell-through depletion** — sold pastry decrements recipe ingredients (or finished-good lot) via pour/recipe engine

### Smaller MVP cut (ship first)

| Slice | In MVP | Deferred |
|---|---|---|
| Catalog + photos for bakery ingredients & finished SKUs | ✓ | — |
| Pars + low-stock alerts | ✓ | Computed reorder science |
| Manual recipe / build sheet (ingredient lines + yield) | ✓ | Auto recipe-from-POS / AI recipe OCR |
| Manual waste log | ✓ | Predictive spoilage ML |
| POS link for finished-good sales (simple decrement) | ✓ if Toast category mapping exists | Full multi-level BOM explosion on every ticket |
| Recipe cost roll-up from lot WAC | After inventory lots/ledger trust (see `INVENTORY_SOTA_PLAN`) | — |

Bakery is chosen first because recipes and inventory loops are clearer than full hot-line kitchen complexity.

---

## 6. Beverage Stage 1 — capability targets

After wine remains strong:

| Capability | Notes |
|---|---|
| Beverage taxonomy in catalog + inventory filters | Domain → subsection → subtype navigation |
| Spirits / beer / NA as first-class inventory rows | Same storage, par, order, receive flows |
| Cocktail recipes in inventory row detail | Build sheet in `RowExpansion` / detail panel |
| Pour-through / recipe costing | Gated on Phase 2 lots + ledger trust |
| Menu import for full beverage lists | Extends current beverage menu import |

---

## 7. Guest profiles & points economy *(demand side)*

A second profile type alongside restaurant staff: **guests** — the people who come to see and eat at these restaurants. Beli-style social layer, already captured as ROADMAP backlog **999.1** and UX paths **NEW-652…NEW-666**; this section locks the points/recommendation economy on top of it.

This is not a detour from the autonomous backend — guest signal is **demand-side input** the backend consumes: which dishes and bottles attract which segments, what to par, what to promote, what to 86.

### 7.1 Profile types

| Profile | Belongs to | Notes |
|---|---|---|
| **Restaurant member** (owner / manager / staff) | A restaurant org, per-restaurant roles | Existing multi-restaurant membership model |
| **Guest** (consumer) | Nobody — profile exists independent of any restaurant org | New. Social handles, food/beverage preferences, ratings, follows |

One human may hold both; identities stay separate and linkable only with explicit consent.

### 7.2 Earning points

Points are earned for contribution and advocacy, not for merely existing:

| Action | Credit rule |
|---|---|
| Verified visit (reservation / POS / QR check-in) | Base points; unverified check-in earns provisional points only |
| Rate a dish or restaurant | Points per rating, quality-gated (no empty spam ratings) |
| Photo of a dish / bottle | Bonus points; usable for catalog enrichment with consent |
| Share / recommend a restaurant or dish | Points on share; **bonus on conversion** (recipient signs up or logs a verified visit) |
| First useful review of an unlisted item | Discovery bonus — feeds the catalog |
| Streaks / milestones | Tier badges (Beli-style progression) |

### 7.3 Integrity rules (non-negotiable)

- **Append-only points ledger; balance is derived.** Same discipline as inventory: one source of truth, no free-editing of balances, every credit idempotent.
- **Verification gates value.** Provisional → confirmed points on verified visit or verified conversion; unconfirmed points expire.
- **No self-referral / duplicate-device farming.** Rate limits + attribution checks on shares.
- **Review quality gate** before points confirm.
- **Consent-first.** Restaurants see aggregated, k-anonymized segments (per 999.1), never raw guest identity without consent.

### 7.4 Redemption (deliberately conservative)

- Launch with **status/badges + tiers** only.
- Restaurant-funded perks are **opt-in per restaurant**, configured by the restaurant, funded by the restaurant.
- No platform-wide cash-value promises until abuse controls and restaurant demand are proven.

### 7.5 Guest MVP vs north star

| Slice | MVP | Deferred |
|---|---|---|
| Guest profile (handles, preferences) | ✓ | Rich taste graph / ML preference modeling |
| Rate dish + restaurant | ✓ | Ranked lists, algorithmic feed |
| Share link with attribution | ✓ | Full referral tree analytics |
| Points ledger + tiers/badges | ✓ | Redemption marketplace, cash-value rewards |
| Verified visit (one channel) | ✓ | Multi-channel verification, geofence |
| Restaurant-side aggregated insights | Read-only digest | Segment experiments, targeted campaigns |

**Trigger:** promote ROADMAP **999.1** when restaurant-side operations are stable enough that demand-side signal has somewhere useful to land.

---

## 8. Ask AI — action creation *(ease complexity)*

Mudavym’s surface area will grow (beverages, bakery, guest ops, dense inventory). The **Ask AI** button (today: Reports `AICommandPill` / `AICommandPalette`, plus Wine Agent FAB as a related entry) must stop being Q&A-only and become an **action composer**: the user states intent in natural language; AI proposes a **typed, allowlisted action**; the human confirms; the system executes through existing backend paths (orders, inventory, communications, calendar, one-tap action center).

This directly serves the ultimate goal — a full autonomous restaurant backend — by putting power behind one entry point so operators do not have to memorize every page, modal, and workflow.

### 8.1 Principle

> **Ask → propose → confirm → execute.** AI never silently mutates stock, money, or outbound vendor email. Confirmation is the gate; existing services are the executors.

### 8.2 Allowlisted action families (MVP → expand)

| Family | Example prompts | Creates / opens |
|---|---|---|
| **Procurement** | “Reorder low Barolo from our usual provider” | Draft PO / one-tap draft in Orders (approve before send) |
| **Inventory** | “Move 6 bottles of X to fridge B” / “Log waste on yesterday’s croissants” | Transfer, waste, or count-sheet draft |
| **Communications** | “Draft a follow-up to Acme about the late delivery” | Provider draft (existing outbound engine; manager approve) |
| **Calendar / ops** | “Block Friday 4–6 for private tasting” | Calendar event draft |
| **Catalog / menu** | “Add this wine from the photo” / “Start bakery recipe for sourdough” | Scan/import or recipe draft flow |
| **Insights → act** | “What’s stocked out risk this weekend?” | Answer + optional one-tap Act (same as recommendation actions) |
| **Navigation assist** | “Where do I set par levels?” | Deep-link + short coach; no mutation |

Out of MVP / gated harder: mass deletes, changing billing, granting permissions, sending email without draft review, guest PII exports.

### 8.3 Complexity-easing contract

- **Global + contextual.** Ask AI works from anywhere; page context (current wine, order, provider) is injected so “reorder this” resolves without hunting IDs.
- **One button, many surfaces.** Unify Reports Ask AI pill, Wine Agent, and contextual “Ask about this page” (`NEW-688`) behind one action schema — not three incompatible chatbots.
- **Action cards, not walls of text.** Prefer a structured card: intent summary, fields to edit, Confirm / Edit / Discard — reusing `recommendation_actions` / OneTap patterns where possible.
- **Role-aware.** Staff see a smaller allowlist than owners/managers.
- **Auditable.** Every proposed and confirmed action logs like other agent decisions (idempotency + decision log).

### 8.4 MVP vs north star

| Slice | MVP | Deferred |
|---|---|---|
| Global Ask AI entry (not Reports-only) | ✓ | Full multimodal voice |
| Allowlist: draft PO, draft vendor email, calendar event, deep-link nav | ✓ | Full inventory transfers, bakery recipes, guest ops |
| Confirm card before execute | ✓ | Auto-execute for low-risk read-only |
| Wire through existing APIs (no shadow writes) | ✓ | Multi-step sagas composed in one prompt |
| Mock answers replaced with real retrieval + tools | ✓ | Unconstrained free-form tool use |

**Trigger:** promote ROADMAP **999.5** once command palette + recommendation/one-tap action plumbing are trusted; overlaps Wine Agent placeholder work (`NEW-644…646`).

---

## 9. Doc map (what defers here)

| Doc | Role |
|---|---|
| **This file** | Canonical futures vision + taxonomy + sequencing |
| `.planning/PROJECT.md` | Product identity + current milestone; points here for expansion |
| `.planning/07-reference/INVENTORY_SOTA_PLAN.md` §13 | Inventory UX/schema implications of Mudavym expansion |
| `md/06-planning/FEATURE_ROADMAP.md` | Feature backlog entries aligned to stages |
| `.planning/ROADMAP.md` Backlog | Promoteable 999.x phases when ready to schedule |
| `md/PROJECT_ANALYSIS_AND_CHAT_CONTEXT.md` | Catalog extensibility notes aligned to taxonomy |
| `.planning/07-reference/UX_PATHS_CATALOG.md` §W + §AB + §AC | Guest paths + Ask AI action-creation paths |
| `SCANNING_PIPELINE_SETUP.md` | Live camera + OCR stack target (RF-DETR → PaddleOCR → Gemini) |

### Live camera / OCR stack (wine quality bar — technical)

Locked target for menu/camera capture (product docs + implementation should converge here):

1. **Live preview:** RF-DETR — boxes only (~2–5 fps)
2. **On capture:** PaddleOCR (or DeepSeek-OCR on GPU)
3. **Field parse:** Gemini for now; evaluate Qwen2.5-VL / RolmOCR later
4. **Hard rule:** never run full OCR every live frame — boxes live; OCR on shutter

Details: [SCANNING_PIPELINE_SETUP.md](../SCANNING_PIPELINE_SETUP.md#live-camera-capture-stack-target--2026-07-27), [PROJECT.md](./PROJECT.md) Key Decisions.

---

## 10. Non-goals (for now)

- Replacing the wine extraction quality bar with a generic “product” UX
- Scheduling Stage 2/3 before beverage taxonomy + inventory trust foundations
- Expanding food beyond bakery before bakery MVP proves recipe + depletion
- Renaming every code path / package overnight — brand `Mudavym` is product identity; codebase may migrate gradually
- Turning the guest side into a standalone social network — it exists to feed restaurant operations
- Cash-value or platform-funded rewards before points integrity is proven
- Ask AI with unconstrained tool use or silent side effects — allowlist + confirm only

---

*Last updated: 2026-07-27 — live camera/OCR stack target linked (RF-DETR → PaddleOCR → Gemini)*
