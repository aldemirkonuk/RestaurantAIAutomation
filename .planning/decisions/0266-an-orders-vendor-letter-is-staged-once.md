# 0266 — An order's vendor letter is staged once, and a replaced draft stays closed

- **Status:** Locked on the founder's rulings of 2026-10-02 (F0, F2, F4, F5, F6, F7) and 2026-10-03 (the sent-letter block), and 2026-10-04 (any newer draft replaces a waiting order letter; an old pair that cycles settles newest-wins; the 16-file PR), below. The mechanism is built in PR-1 and reviewed at that PR's gate. F3, F8 and F9 are open.
- **Date:** 2026-10-02
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** F-106, COMMS-W25, COMMS-W24, one letter per order, stage_order_letter, discard_reason, DISCARDED, pending draft, order_inquiry, approval-time letter, create-time letter, order request, owner-quarter sim
- **Links:** [[0260-communications-walk-through-r2-rulings]] (the order a-b-c and the F-106 ruling; its F-106 line is corrected by this ADR), [[0175-one-tap-from-the-notification-is-staged]], [[0173-communications-is-a-catalogue-with-slot-editing]] (D1, D2), [[0174-email-is-a-paper-sheet-and-the-house-signs-it]] (D4), [`06-pages/communications.md`](../06-pages/communications.md) COMMS-W24 and COMMS-W25, migration `an_order_letter_is_staged_once` (cited by slug; numbered at merge), `supabase/tests/*_an_order_letter_is_staged_once_test.sql`, `services/agent-orchestrator/tests/test_one_letter_per_order.py`, `claims.d/fix-f106-one-letter-per-order.jsonl`. Design and both attack passes: `p4-scratch/review-snap-2/research/w25-f106-design-2026-10-02.md` (outside the repo).

## Context

The owner-quarter sim (F-106, ledger :141) approved an order and could not send its letter. `approveDraft` answered 404 "No pending draft found for this order", although the rail showed one. Two agents each stage a waiting outbound letter for one order, and nothing stops the second. Cites are at e25ebf537.

- **Create time.** `_handle_order_created` (`provider_communication_agent.py:672-707`) inserts with no check for an existing row. Its Redis lock and durable key fence only itself.
- **Approval time.** `approveOrder` always publishes `order_inquiry` (`procurement.service.ts:4223-4240`). `_handle_procurement_intent` then spends a session, memories and a model call, and inserts with no check (`provider_conversation_agent.py:806-873`, `:2824`). Its own docstring names "two drafts and two notifications for one order".
- **Nothing in the database.** The only unique guards are one `SENDING` row per order and one sent Message-ID (`20260901120000_…:31-33`, `:46-52`).
- **The readers that break.** `approveDraft` uses `.single()` (`:7763-7770`), so a second row turns into a 404. The seal and request lookups use `.maybeSingle()` (`:7423-7429`, `:7569-7576`), so they answer 500. `getPendingDraft` shows the newest (`:9998-10000`).

A draft seal is issued only while exactly one row waits (`:7429`), so the row an owner held is always the older one. ADR 0260:100 ruled "the newest (the one the rail shows and the owner held)". Those are two different rows, so the ruling was re-asked as F0.

## Options considered

1. **A check-then-insert in each agent.** Rejected. The create-time agent has no check. Two approval-time runs overlap (`max_concurrent_tasks=10`, `base_agent.py:250`). The create-time letter can also land after the approval-time read. A read and a write in Python cannot be one decision.
2. **A unique partial index alone** (one `PENDING_APPROVAL` per order). Rejected for PR-1. Every writer would meet 23505, and the gateway's release and revert paths never read their error (`:8180-8196`, `:8729-8756`). The pairs already in production must also be reconciled first. It is kept as PR-3's backstop.
3. **The approval-time agent waits for the create-time one** (the first draft of the design: a 20 s wait). Rejected. All of `process_message` runs under a 30 s `wait_for` (`base_agent.py:720-728`). A timeout counts as a circuit-breaker failure (`message_bus.py:371-377`), and an open breaker drops every message for the agent (`base_agent.py:713-718`).
4. **One door in the database, plus one waiting draft per order for every writer.** Chosen; see Decision.
5. **Do nothing.** Orders keep doubling. Whichever reader meets the pair fails: 404, 500, or the wrong letter shown.

**Founder forks (AskUserQuestion, 2026-10-02):**
- **F0, which row survives where two already wait (PR-3):** "First-written (Recommended)", the create-time letter. Rejected:
  - (a) newest, as 0260:100 ruled; its premise about the held row was false;
  - (c) newest unless a seal shows the older was held.
  - For new orders, PR-1's door already keeps the first.
- **F6, what the one-waiting-draft rule covers:** "Waiting approval only (Recommended)". Rejected: also `AUTO_SEND_SCHEDULED`, which would make the reconcile cancel scheduled sends.
- **F7, where the discard reason lives:** "Its own column (Recommended)", `discard_reason`, CHECK-scoped to `DISCARDED`. Rejected: a key in `constraint_flags`.
- **F2, how much of the order letter the AI writes (PR-4b):** "One courtesy line (Recommended)", with no figures; the line is dropped if it holds a digit, currency sign, date or bracket. Rejected: the AI writes the whole body and a validator checks every fact.
- **F4, the Mudavym line on order letters:** "Keep today's line (Recommended)", "drafted by Mudavym on behalf of {house}", until W20c lands. Letters still leave from the shared mailbox (F-046). Rejected: dropping it now (0174 D4); adopting W20c's words now.
- **F5, may the house edit the order-request template:** **"Editable now"**, against the recommendation (read-only until 0173 D2's slot editor). The order request becomes a sixth `LETTER_CATEGORIES` purpose (`house-letters.service.ts:157-163`). Template writes get an owner/manager guard and 0173 D2's guardrails. This widens PR-4a.
- **Whether a letter already SENT blocks the approval-time letter (PR-1, until PR-4b):** "Keep: one letter (Recommended)". Any live outbound letter, sent or waiting, blocks it. Asked 2026-10-02; that ask was cut off by the 01:37 restart and answered on 2026-10-03. Rejected: only a waiting letter blocks. That would keep drafting today's post-approval `order_inquiry` after a sent price inquiry, the letter F-099 calls a price inquiry written after the order is sealed.

**Founder forks (AskUserQuestion, 2026-10-04, raised by the #591 gate at 0c363b4a2):**
- **A vendor-reply or manual draft and an order letter waiting on one order:** "Newest stays (Recommended)". Any newer waiting draft closes the older one, whatever its kind, and saves the reason on it. The trigger reads neither `direction` nor `outbound_email_type`. Both agents call the door without a kind, so a live outbound row of any type blocks the order letter. In today's writers this is reachable only by a race, or after a send is released or reverted to waiting. Rejected:
  - the order letter always stays (the reply is closed instead);
  - one waiting draft of each kind per order. `approveDraft` looks the waiting row up by order alone with `.single()` (`procurement.service.ts:7642-7645`), so that would bring back F-106's 404.
- **A pair already in production that cycles (a claim, then a release or revert):** "Accept, as disclosed (Recommended)". The trigger settles it newest-wins, not F0's first-written. PR-3's dry-run counts these pairs, and the reconcile settles every other pair first-written. Rejected: first-written everywhere (the trigger would have to tell old pairs from new ones); landing PR-3 before PR-1.
- **PR-1 at 16 files, over the 15-file cap:** "Allow 16 (Recommended)". The sixteenth file is this ADR, which belongs with the code it describes. Rejected: this ADR in its own PR first.

## Decision

The order's letter is decided in the database. Both agents stage it through `public.stage_order_letter`, which writes nothing when the order already has a live outbound letter. A trigger keeps one waiting draft per order for every other writer. A draft closed as `DISCARDED` or `CANCELLED` can never be sent.

- **The door.** `stage_order_letter(p_row jsonb, p_kind text)`:
  - It takes `pg_advisory_xact_lock` on `(restaurant_id, order_id)`, following the precedent `a_vendor_has_one_primary_branch`.
  - It looks for an outbound row in a live status: `PENDING_APPROVAL`, `AUTO_SEND_SCHEDULED`, `AUTO_SENDING`, `SENDING`, `SENT`, `AUTO_SENT` or `SEND_UNCONFIRMED`. When `p_kind` is given, the row must also be of that `outbound_email_type`.
  - If one exists, it returns that id with `staged=false`. Otherwise it inserts an explicit column list.
  - It refuses unknown keys, a missing order or house, an inbound row, and any status other than `PENDING_APPROVAL` or `AUTO_SENT`.
  - EXECUTE is granted to `service_role` only. The orchestrator writes as `service_role` (`core/orchestrator.py:155`). OD-72 revoked client table grants, so the agents' existing inserts already need that role. `increment_trust_counter` is the precedent for a server-only RPC called from the orchestrator.
- **The create-time agent** stages through the door. On `staged=false` it returns before any notice, auto-send publish or decision log.
- **The approval-time agent** reads `live_order_letter_id` for an `order_inquiry` before it takes its session semaphore, so no model call is spent. It then stages through the door. A refused stage returns `None` and publishes nothing. The door stays the authority, because the create-time letter can land between the read and the write.
- **The trigger.** `trg_proc_conv_one_pending_draft` is `BEFORE INSERT OR UPDATE OF status`. It shares the door's lock and acts when a row with an order becomes `PENDING_APPROVAL`. The newest waiting row stands (COMMS-W24's server half, "a new draft closes the older as replaced"), whatever its kind (founder, 2026-10-04). The other row becomes `DISCARDED`, with one of two reasons:
  - "Replaced by a newer draft for this order (<id>)."
  - "A newer draft for this order was already waiting (<id>)." This is the release and revert path.
  - Either reason gains "The send request on it no longer applies." when a staff request was on it.
  - No writer meets an error. An edit to a row that is already waiting is not a new draft. Pairs that already exist are left for PR-3, unless a member cycles. If a row leaves `PENDING_APPROVAL` and comes back to it (a claim, then a release or revert), the trigger settles that pair newest-wins by `created_at`, not F0's first-written. PR-3's dry-run counts the pairs settled this way; the founder accepted this on 2026-10-04. (Corrected at the #591 gate: the first text said the trigger never touches an existing pair.)
- **Closed drafts.** `DISCARDED` and `CANCELLED` join the agent's `_CLAIM_REFUSED_STATUSES`, which covers the send claim and the hold-return. `POST /conversations/:id/approve` refuses both before any dispatch.

**Choices made while building, recorded for the gate:**
- **`approveConversation` uses a deny-list, not the design's allow-list.** The design said "refuse any row that is not `PENDING_APPROVAL` or `AUTO_SEND_SCHEDULED`". A conversation with no status is that route's ordinary case: the spec test "still approves and dispatches a conversation with no status" pins it. An allow-list would have refused every such send. The agent's claim and the route now name the same two words, and a spec test pins that.
- **An insert wins a `created_at` tie.** Two inserts in one transaction share `now()`. Breaking the tie by id could discard the row being written. Proof P15 pins this.
- **Before the migration applies, a letter is not lost.** If the function is missing (PGRST202), both agents log an error and insert directly, as before. Any other failure behaves as it did before: the create-time agent re-raises to the dead-letter queue, and the approval-time agent returns `None`.
- **No lock prologue in this migration.** Its first statement (`ADD COLUMN`) already takes `ACCESS EXCLUSIVE`, so there is no lock upgrade. No migration in the tree sets `lock_timeout`. The prologue stays in the design for PR-3's migration.

## Consequences

- One letter per order from the agents, and one waiting draft per order from any writer. The pair that broke `approveDraft` cannot form again.
- A replaced or cancelled draft cannot be sent by the route or the agent, even with a stale approval.
- **The trigger is a write its callers do not see.** A release or revert can end in `DISCARDED`. The gateway still says "It is back in your queue for one-tap approval" (`procurement.service.ts:8702`, `:8712`) until PR-5a.
- **Until PR-4b narrows the door with `p_kind = 'ORDER_REQUEST'`, any live outbound letter blocks the approval-time letter.** That includes an earlier price inquiry that was sent. A negotiated order therefore gets no post-approval inquiry, which F-099 calls wrong anyway. Founder ruling of 2026-10-03, above.
- **Pairs already in production stay until PR-3.** R4's `OrderLetter` must skip `DISCARDED` rows before PR-3 lands.
- Evidence:
  - PostgreSQL 17, built from all 283 migrations at e25ebf537 plus this one (applied twice): 20/20 checks pass. A two-session race stages once.
  - Eight migration mutations were each caught; the eighth (the door without its lock) staged twice in the race.
  - The control without the migration errors on the missing door, and two direct inserts leave 2 waiting rows.
  - Python: 10 mutations each caught. Two of them add a key the door does not write: the door would refuse it, and the approval-time agent would swallow the refusal, so a test pins both agents' keys to the migration's list. The orchestrator suite is 1684 passed and 55 skipped, against 1658/55 at e25ebf537, with no failures.
  - Gateway: the spec passes 18/18 and `tsc` is clean.
  - Claims: 6 rows. Each resolved row fails against origin/main, and 11 in-branch mutations were each caught.
- **Not verified:**
  - Production was not read. The duplicate count, which rows were held, and any staff requests on duplicates all wait for the dry-run.
  - The proofs ran as a superuser, without RLS or the Supabase platform roles.
- **Revisit when:**
  - the dry-run shows a staff request on a row to be discarded (F8);
  - houses' F-084/F-089 change lands (F1, the cap);
  - any `DISCARDED` or `CANCELLED` row is reported sent;
  - any writer meets a 23505 from this table.

**The PR split** (W25 counts as done for the 0260 order at PR-4b):

| PR | Branch | What |
|---|---|---|
| PR-1 | `fix/f106-one-letter-per-order` | this ADR's mechanism |
| PR-2 | `fix/f126-cap-notice-once-a-day` | the cap notice once a day; the cap is unchanged |
| PR-3 | `data/f106-reconcile-pending-drafts` | first-written survives (F0); unique index; after the dry-run and R4's confirmation |
| PR-4a | `feat/w25-order-request-renderer` | renderer, internal route, `ORDER_REQUEST` type, F5's editable purpose |
| PR-4b | `feat/w25-order-request-draft` | both agents draft from it, behind `ORDER_REQUEST_LETTER` (off; the flip is the founder's) |
| PR-5a / 5b | `fix/w25-approve-draft-lookup`, `fix/w25-order-subject-fallbacks` | `procurement.service.ts`, in the O4 queue |

**Still open:**
- **F3, the template's words.** To be asked after one rendered sample; to be filed as an OD-TBD row with PR-4a. PR-4b's flag stays off until then.
- **F8, a duplicate that carries a staff send request.** Asked only if the dry-run counts one.
- **F9, a waiting letter whose order is later merged.** To be filed as an OD-TBD row with PR-4a. Asked once, by whichever of W25 or R4 builds first.
- **F1, where an over-cap order's letter comes from.** Relayed to the coordinator; it waits for F-084/F-089.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-02 | — | Created, session R2, branch fix/f106-one-letter-per-order (PR-1); founder rulings F0, F2, F4–F7 recorded |
| 2026-10-02 | — | Numbered 0266 at push: 0265 was already taken by an uncommitted ADR in wt-review-9 (place id), found by sweeping remote refs and every worktree |
| 2026-10-04 | PR #591 gate at 0c363b4a2 (correctness and security reviews) | Three points nobody had ruled on were asked; founder ruled all three as recommended (Founder forks, 2026-10-04). Recorded at a new head, so a full re-gate follows |
