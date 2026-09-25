# Forks for founder — get-started after sketch 122

**Date:** 2026-09-22 · **Source:** [`00-OPUS-VERDICT.md`](00-OPUS-VERDICT.md) §8 F1–F7.

**Locked 2026-09-22:** founder approved every Opus rec as **A**. Record: [ADR 0213](../../../decisions/0213-get-started-is-account-then-house-then-first-proof.md). Build is `feat/arrival-first-proof`. #414 / #454 stay unmerged; `mudavym_design_arrival` is not flipped.

---

## 1. When is the restaurant created?

**Question:** Move restaurant creation out of `/register` (account-only signup)?

| Option | Notes |
|---|---|
| **A — Account-only `/register`** | Name, email, password or Google; house created on screen 2. Backend tenant-creation change. |
| **B — Keep `/register` as today** | Restaurant + address at signup; screens 1–2 become prefilled confirms. Cheaper, asks twice. |

**Opus rec:** A

---

## 2. What does *Skip for now* skip?

**Question:** Menu only, or address too?

| Option | Notes |
|---|---|
| **A — Menu only** | Address stays required (vendor matching, currency, timezone). |
| **B — Address skippable too** | Silent degradation of vendor matching and derived fields. |

**Opus rec:** A

---

## 3. What does "location advice" mean?

**Question:** What should the personal-info / restaurant screen offer?

| Option | Notes |
|---|---|
| **A — Places search + *Use my location*** | Find the restaurant via Google Places, biased by device location. |
| **B — Multi-location guidance** | Advice for operators with more than one site. |
| **C — Explanatory copy** | Text on why the address matters, without Places. |

**Opus rec:** A

---

## 4. Google sign-in at signup?

**Question:** Add *Continue with Google* to `/register`?

| Option | Notes |
|---|---|
| **A — Yes** | Honest meaning of "Gmail" today (auth, not inbox reading). |
| **B — No** | Email/password only for now. |

**Opus rec:** A

---

## 5. Menu reveal pattern

**Question:** Adopt **"The first proof"** — typeset categorized menu at `/house/menu`, pencil marks for lines worth a second look, inline expansion (no modal/sheet)?

| Option | Notes |
|---|---|
| **A — First proof** | Full §4 pattern: 42 read · 25 set · 17 pencilled; persists as living menu page. |
| **B — Keep sketch patterns** | Modal, register readout, or separate frame-04 page. |

**Opus rec:** A

---

## 6. Soft-confidence copy

**Question:** Adopt **ink / pencil** visual system (replacing customer-facing `certain` / `likely`)?

| Option | Notes |
|---|---|
| **A — Ink / pencil** | Ink = set (no label); pencil = *"Worth a second look"* + reason on expand. |
| **B — Keep current vocabulary** | Or another verbal system. |

**Opus rec:** A

---

## 7. Empty registers (`none`)

**Question:** One footer line on the proof (*"Not on this menu: sake, cider. Pour any of these? Add it."*) instead of empty section tabs or a three-way switch?

| Option | Notes |
|---|---|
| **A — One footer line** | Supersedes PAGE-WAVE-BLOCKERS §5 Q2. |
| **B — PAGE-WAVE-BLOCKERS Q2 options** | See that doc for the three alternatives. |

**Opus rec:** A

---

## OD cross-reference

| Fork | OD | Lock |
|---|---|---|
| F1 | OD-134 | A — [ADR 0213](../../../decisions/0213-get-started-is-account-then-house-then-first-proof.md) |
| F2 | OD-135 | A |
| F3 | OD-136 | A |
| F4 | OD-137 | A |
| F5 | OD-138 | A |
| F6 | OD-139 | A |
| F7 | OD-141 | A |

The squad's first draft mapped F1–F7 onto OD-123–129. Those ids already mean
other forks on `main` (Sheet scrim, privacy facts, …). They were not reused.
