import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DatabaseService } from "../database/database.service";
import {
  ModelClientService,
  NfEventRef,
} from "../common/model-client/model-client.service";
import { NfVerdictService } from "../common/model-client/nf-verdict.service";
import {
  resolveModel,
  routingContext,
} from "../common/model-client/model-routing";
import { ProcurementService } from "../procurement/procurement.service";
import { AskAiAction, validateAction } from "./ask-ai-actions";
import { ProposalCandidates, checkActionGrounded } from "./ask-ai-grounding";
import {
  CONFIRMATION_BASIS,
  EDIT_BASIS,
  PROPOSAL_BASIS,
  confirmationVerdict,
  editVerdict,
  proposalVerdict,
} from "./ask-ai-verdict";
import {
  ORDER_CLOSED_STATUSES,
  toPostgrestInList,
} from "../procurement/order-status";

/** Caps on the candidate set put in the prompt. Big enough to be useful, small
 *  enough that the prompt stays cheap and the model is not asked to scan a
 *  thousand rows for the one the operator meant. */
const MAX_INVENTORY_CANDIDATES = 60;
const MAX_PROVIDER_CANDIDATES = 30;
const MAX_ORDER_CANDIDATES = 20;

/** Labels a picker has to render even when the row has no name. */
const UNNAMED = "(unnamed)";
const UNKNOWN_VENDOR = "Unknown vendor";

const SYSTEM_PROMPT = `You turn a restaurant operator's request into ONE typed action, or you decline.

You may ONLY propose these actions:

1. Reorder stock
   {"family":"procurement","actionType":"reorder","payload":{"inventoryId":"<uuid from CANDIDATES.inventory>","providerId":"<uuid from CANDIDATES.providers>","quantity":<integer>,"unitType":"<optional>"}}

2. Draft a vendor reply on an existing order
   {"family":"communications","actionType":"vendor_draft","payload":{"orderId":"<uuid from CANDIDATES.orders>","instruction":"<what the reply should say>"}}

HARD RULES
- Every id MUST be copied exactly from the CANDIDATES block. Never invent a uuid. Never guess an id you were not given.
- If the request does not map cleanly onto one of the two actions above, DECLINE. Do not stretch it.
- If you cannot tell WHICH item, vendor or order is meant, DECLINE rather than picking the closest.
- One action. Never a list.
- Do not perform the action, do not claim it is done. You are proposing; a human confirms.

OUTPUT — respond with ONLY valid JSON, no markdown fences:
  to propose:  {"action":{...},"summary":"<one plain sentence the operator will confirm>"}
  to decline:  {"decline":"<one sentence saying what you would need>"}

The summary is what a busy person reads before saying yes. Name the item, the vendor and the number in plain words.`;

export interface ProposalResult {
  proposed: boolean;
  /** Present when proposed. */
  actionId?: string;
  summary?: string;
  action?: AskAiAction;
  /** Present when declined or rejected — always says why. */
  reason?: string;
}

/**
 * One selectable candidate: the id the grounding check will accept, and the
 * words a person can actually choose by. The label exists because a picker
 * rendering uuids is not a picker.
 */
export interface CandidateOption {
  id: string;
  label: string;
}

/** An open order also carries who it is with, which is how operators name it. */
export interface OrderCandidateOption extends CandidateOption {
  providerId: string | null;
  providerName: string | null;
  status: string | null;
}

/**
 * The candidate set, in the shape a UI can render.
 *
 * This is the SAME set — same query, same caps, same order — that the propose
 * prompt is handed and that `checkActionGrounded` accepts at confirm time.
 * That identity is the whole point: a picker built from a wider or
 * differently-ordered query would offer ids the confirm then rejects as
 * ungrounded, which is a worse control than no control at all.
 */
export interface CandidateSets {
  inventory: CandidateOption[];
  providers: CandidateOption[];
  orders: OrderCandidateOption[];
  /** The caps applied — echoed so a client does not have to hardcode them. */
  limits: { inventory: number; providers: number; orders: number };
  /**
   * True when a list came back exactly AT its cap, so rows beyond it exist that
   * neither the picker nor the grounding check can see. Reported rather than
   * hidden: "your item is not in this list" and "Ask AI cannot reach your item"
   * are different sentences, and only the second one is true here.
   */
  capped: { inventory: boolean; providers: boolean; orders: boolean };
}

/**
 * Ask AI — ask → propose → confirm → execute (FUTURES §8).
 *
 * This service NEVER mutates a domain table. It writes proposals to
 * `ai_proposed_actions` and, on confirmation, hands a validated payload to
 * `ProcurementService`. Every guard those executors already carry still runs,
 * unchanged and unbypassed, and both of them produce a DRAFT — so nothing
 * reaches a vendor without a person acting twice.
 */
@Injectable()
export class AskAiService {
  private readonly logger = new Logger(AskAiService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly configService: ConfigService,
    private readonly modelClient: ModelClientService,
    private readonly nfVerdicts: NfVerdictService,
    private readonly procurement: ProcurementService,
  ) {}

  /**
   * A proposal is a CONFIGURATION the operator will confirm and a service will
   * execute — a purchase order, a vendor email. That is the `compose` class
   * (ADR 0120), so the founder's routing sends it to Sonnet 5 rather than the
   * Haiku this defaulted to. `ASK_AI_MODEL` still outranks the class.
   *
   * Returned as the whole `Routing` rather than a bare string because the row
   * this call writes records WHICH rule chose the model, not only which model.
   */
  private routing() {
    return resolveModel({
      config: this.configService,
      taskClass: "compose",
      siteEnvVar: "ASK_AI_MODEL",
    });
  }

  /**
   * The ids the model is allowed to choose from, and the labels it needs to
   * choose sensibly.
   *
   * Errors are THROWN, not swallowed into an empty set. An empty candidate list
   * looks exactly like "this restaurant has no inventory", and the model would
   * then decline politely while the real problem was a failed query — the
   * `catch { return [] }` shape this repo has spent the week deleting.
   *
   * ONE LIST, THREE CONSUMERS
   * -------------------------
   * The prompt block, the grounding sets and the picker payload are all built
   * from the SAME rows below, in one pass. They used to be two derivations of
   * one query; a third consumer with its own query would be the drift bug
   * waiting to happen, because "the ids the model was offered" and "the ids the
   * confirm accepts" have to be the same sentence or the feature lies.
   */
  private async loadCandidates(restaurantId: string): Promise<{
    candidates: ProposalCandidates;
    lists: CandidateSets;
    prompt: string;
  }> {
    const client = this.databaseService.getClient();

    const [inv, prov, ord] = await Promise.all([
      client
        .from("restaurant_inventory")
        .select("id, wine_name")
        .eq("restaurant_id", restaurantId)
        // ORDERED, not merely capped. An unordered `.limit()` lets Postgres
        // return any 60 rows it likes, and this query runs at least twice per
        // action — once to fill the picker, once to ground the confirm. Two
        // different subsets would reject an id the operator was just offered.
        // `id` breaks name ties so the window is stable across calls; the
        // alphabetical order is also the one a picker wants anyway.
        .order("wine_name", { ascending: true })
        .order("id", { ascending: true })
        .limit(MAX_INVENTORY_CANDIDATES),
      client
        .from("providers")
        .select("id, name")
        .eq("restaurant_id", restaurantId)
        .eq("is_active", true)
        .order("name", { ascending: true })
        .order("id", { ascending: true })
        .limit(MAX_PROVIDER_CANDIDATES),
      client
        .from("procurement_orders")
        .select("id, provider_id, status")
        .eq("restaurant_id", restaurantId)
        .not("status", "in", toPostgrestInList(ORDER_CLOSED_STATUSES))
        .order("created_at", { ascending: false })
        .order("id", { ascending: true })
        .limit(MAX_ORDER_CANDIDATES),
    ]);

    for (const [label, res] of [
      ["inventory", inv],
      ["providers", prov],
      ["orders", ord],
    ] as const) {
      if (res.error) {
        this.logger.error(
          `Ask AI could not load ${label} candidates: ${res.error.message}`,
        );
        throw new ServiceUnavailableException(
          "Ask AI is temporarily unavailable.",
        );
      }
    }

    const inventory = inv.data ?? [];
    const providers = prov.data ?? [];
    const orders = ord.data ?? [];
    const providerName = new Map<string, string>(
      providers.map((p: any) => [
        p.id as string,
        (p.name as string) || UNNAMED,
      ]),
    );

    const lists: CandidateSets = {
      inventory: inventory.map((i: any) => ({
        id: i.id as string,
        label: (i.wine_name as string) || UNNAMED,
      })),
      providers: providers.map((p: any) => ({
        id: p.id as string,
        label: (p.name as string) || UNNAMED,
      })),
      orders: orders.map((o: any) => ({
        id: o.id as string,
        providerId: (o.provider_id as string) ?? null,
        providerName: providerName.get(o.provider_id) ?? null,
        status: (o.status as string) ?? null,
        // How an operator names an order out loud: who it is with, and where
        // it has got to. The uuid is the value; this is the handle.
        label: `${providerName.get(o.provider_id) ?? UNKNOWN_VENDOR} · ${
          (o.status as string) || "open"
        }`,
      })),
      limits: {
        inventory: MAX_INVENTORY_CANDIDATES,
        providers: MAX_PROVIDER_CANDIDATES,
        orders: MAX_ORDER_CANDIDATES,
      },
      capped: {
        inventory: inventory.length >= MAX_INVENTORY_CANDIDATES,
        providers: providers.length >= MAX_PROVIDER_CANDIDATES,
        orders: orders.length >= MAX_ORDER_CANDIDATES,
      },
    };

    const prompt = [
      "CANDIDATES — every id you use must be copied from here.",
      "",
      "inventory:",
      ...lists.inventory.map((i) => `  ${i.id}  ${i.label}`),
      "",
      "providers:",
      ...lists.providers.map((p) => `  ${p.id}  ${p.label}`),
      "",
      "orders (open):",
      ...lists.orders.map(
        (o) =>
          `  ${o.id}  vendor=${o.providerName ?? "unknown"} status=${o.status}`,
      ),
    ].join("\n");

    return {
      candidates: {
        inventoryIds: new Set(lists.inventory.map((i) => i.id)),
        providerIds: new Set(lists.providers.map((p) => p.id)),
        orderIds: new Set(lists.orders.map((o) => o.id)),
      },
      lists,
      prompt,
    };
  }

  /**
   * The candidate set, labelled, for a client that needs to render a picker.
   *
   * `GET /ask-ai/candidates` is this and nothing else: a read that creates no
   * row, calls no model, and costs nothing but three selects. It exists because
   * `confirm()` accepts an edited `inventoryId` / `providerId` / `orderId` and
   * re-grounds it — an ability the web app could not use, having no way to name
   * the alternatives. A uuid text box is not a control.
   *
   * Deliberately NOT paginated. Page two would hand out ids that
   * `checkActionGrounded` rejects, because the grounding set is the first page
   * — so a picker that scrolled past the cap would be offering choices the
   * confirm refuses. The cap is reported instead (`capped`), which is the
   * honest version of the same limitation.
   *
   * Errors propagate, for the reason `loadCandidates` documents: an empty list
   * reads as "this restaurant has no inventory", and a picker that renders
   * "no items" over a failed query is worse than one that says it is broken.
   */
  async listCandidates(restaurantId: string): Promise<CandidateSets> {
    const { lists } = await this.loadCandidates(restaurantId);
    return lists;
  }

  async propose(
    restaurantId: string,
    userId: string,
    utterance: string,
  ): Promise<ProposalResult> {
    const ask = (utterance ?? "").trim();
    if (!ask) throw new BadRequestException("Say what you would like to do.");

    const { candidates, prompt } = await this.loadCandidates(restaurantId);

    const eventRef = new NfEventRef();
    const routing = this.routing();
    const meter = routingContext(routing, userId);
    let payload: any;
    try {
      payload = await this.modelClient.call({
        body: {
          model: routing.model,
          max_tokens: 1024,
          system: SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content: `${prompt}\n\nOperator says: ${ask}`,
            },
          ],
        },
        timeoutMs: 30_000,
        nf: {
          subjectId: "AskAi",
          taskType: "ask_ai_proposal",
          stimulus: "operator_utterance",
          choice: "proposed_action",
          restaurantId,
          // Literal keys, for the same reason `goals.service.ts` writes them
          // literally: the ledger's shape must be readable from the call site.
          context: {
            utterance_chars: ask.length,
            task_class: meter.task_class,
            model_routed_by: meter.model_routed_by,
            asked_by: meter.asked_by,
          },
          eventRef,
        },
      });
    } catch (err: any) {
      this.logger.error(`Ask AI model call failed: ${err?.message}`);
      throw new ServiceUnavailableException(
        "Ask AI is temporarily unavailable.",
      );
    }

    const text: string =
      (payload?.content || []).find((b: any) => b.type === "text")?.text ?? "";

    let parsedBody: any = null;
    try {
      parsedBody = JSON.parse(text.replace(/^```json\s*|\s*```$/g, "").trim());
    } catch {
      this.logger.warn("Ask AI returned non-JSON output");
    }

    const grade = (opts: Parameters<typeof proposalVerdict>[0]): void => {
      this.nfVerdicts.record(eventRef, PROPOSAL_BASIS, proposalVerdict(opts));
    };

    if (!parsedBody) {
      grade({
        parsed: false,
        declined: false,
        validated: false,
        grounded: false,
      });
      return {
        proposed: false,
        reason:
          "I could not turn that into an action. Try naming the item, the vendor and the quantity.",
      };
    }

    if (typeof parsedBody.decline === "string" && parsedBody.decline.trim()) {
      // A correct refusal. Graded `null`, not `failure` — see ask-ai-verdict.ts.
      grade({
        parsed: true,
        declined: true,
        validated: false,
        grounded: false,
      });
      return { proposed: false, reason: parsedBody.decline.trim() };
    }

    const validation = validateAction(parsedBody.action);
    if (!validation.ok) {
      grade({
        parsed: true,
        declined: false,
        validated: false,
        grounded: false,
        rejectionReason: validation.reason,
      });
      return { proposed: false, reason: validation.reason };
    }

    const grounding = checkActionGrounded(validation.action, candidates);
    if (!grounding.grounded) {
      // An id the model invented. Logged precisely, reported vaguely — echoing
      // a uuid that may belong to another tenant is worse than unhelpful.
      this.logger.warn(
        `Ask AI proposed ungrounded ids [${(grounding.ungrounded ?? []).join(", ")}] for restaurant ${restaurantId}`,
      );
      grade({
        parsed: true,
        declined: false,
        validated: true,
        grounded: false,
        rejectionReason: "ungrounded_ids",
      });
      return { proposed: false, reason: grounding.reason };
    }

    const summary =
      typeof parsedBody.summary === "string" && parsedBody.summary.trim()
        ? parsedBody.summary.trim().slice(0, 400)
        : this.fallbackSummary(validation.action);

    const eventId = await eventRef.id;
    const { data, error } = await this.databaseService
      .getClient()
      .from("ai_proposed_actions")
      .insert({
        restaurant_id: restaurantId,
        created_by: userId,
        utterance: ask,
        family: validation.action.family,
        action_type: validation.action.actionType,
        payload: validation.action.payload,
        summary,
        status: "proposed",
        idempotency_key: `askai:${restaurantId}:${Date.now()}:${Math.random()
          .toString(36)
          .slice(2, 10)}`,
        nf_event_id: eventId,
      })
      .select("id")
      .single();

    if (error || !data) {
      // A proposal that cannot be stored must not be shown: the confirm gate
      // works by flipping a row's status, so a card with no row behind it would
      // be a button that silently does nothing.
      this.logger.error(`Ask AI could not store a proposal: ${error?.message}`);
      grade({
        parsed: true,
        declined: false,
        validated: true,
        grounded: true,
        rejectionReason: "not_persisted",
      });
      throw new ServiceUnavailableException(
        "Ask AI is temporarily unavailable.",
      );
    }

    grade({ parsed: true, declined: false, validated: true, grounded: true });

    return {
      proposed: true,
      actionId: data.id,
      summary,
      action: validation.action,
    };
  }

  /** Used when the model proposes a valid action but no readable summary. */
  private fallbackSummary(action: AskAiAction): string {
    if (action.family === "procurement") {
      return `Order ${action.payload.quantity} of the selected item from the selected vendor.`;
    }
    return "Draft a reply to the vendor on the selected order.";
  }

  async listOpen(restaurantId: string) {
    const { data, error } = await this.databaseService
      .getClient()
      .from("ai_proposed_actions")
      .select(
        "id, utterance, family, action_type, payload, summary, status, created_at",
      )
      .eq("restaurant_id", restaurantId)
      .eq("status", "proposed")
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) {
      this.logger.error(`Ask AI could not list proposals: ${error.message}`);
      throw new ServiceUnavailableException(
        "Ask AI is temporarily unavailable.",
      );
    }
    return data ?? [];
  }

  /**
   * Confirm and execute.
   *
   * The `proposed → confirmed` transition is a **compare-and-swap**: the update
   * is conditioned on the row still being `proposed`, so two concurrent
   * confirms — a double tap, a retry over flaky signal — produce exactly one
   * winner and the loser gets "already handled" rather than a second purchase
   * order. That is the idempotency mechanism; the row itself is the key.
   */
  /**
   * Confirm and execute, optionally with the operator's edits.
   *
   * `editedPayload` is a NEW INPUT PATH and is treated as one. It is run
   * through the SAME allowlist (`validateAction`) and the SAME grounding check
   * (`checkActionGrounded`) as a model proposal — because an editable field is
   * an id-injection hole the moment it is trusted, and the fact that a human
   * typed it is not a security property. A human can paste a uuid.
   *
   * Grounding is re-derived from the CURRENT candidate set rather than the one
   * captured at propose time: stock and vendors change, and the question is
   * whether this action is valid to run NOW.
   *
   * An UNTOUCHED confirm is checked too — a proposal can sit in the open list
   * for days, so "nobody edited it" is no reason to trust that what it points
   * at still exists — but by direct lookup rather than candidate-set
   * membership. See the comment in `confirm` for why those are different
   * questions and why answering both with the capped set was wrong.
   */
  async confirm(
    restaurantId: string,
    userId: string,
    actionId: string,
    editedPayload?: Record<string, unknown>,
  ) {
    const client = this.databaseService.getClient();

    const { data: claimed, error: claimErr } = await client
      .from("ai_proposed_actions")
      .update({
        status: "confirmed",
        confirmed_by: userId,
        confirmed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", actionId)
      .eq("restaurant_id", restaurantId)
      .eq("status", "proposed")
      .select("*")
      .maybeSingle();

    if (claimErr) {
      this.logger.error(`Ask AI confirm failed: ${claimErr.message}`);
      throw new ServiceUnavailableException("Could not confirm that action.");
    }
    if (!claimed) {
      // Either it does not exist for this restaurant, or someone already acted.
      // Both are "nothing more to do here", and neither should create a second
      // order, so they collapse to one answer rather than a retry-inviting error.
      throw new NotFoundException(
        "That action is no longer waiting for confirmation.",
      );
    }

    // Validate the edit BEFORE executing, and roll the claim back if it fails —
    // otherwise a rejected edit would leave the row stuck at `confirmed` with
    // nothing executed and no way to retry.
    // EVERY payload is re-checked before it executes, edited or not — but the
    // two cases are asking DIFFERENT questions, and conflating them was a bug.
    //
    //   EDITED    -> must be in the CANDIDATE SET. An editable id is an
    //                id-injection hole the moment it is trusted, and the fact
    //                that a human typed it is not a security property: a human
    //                can paste a uuid. "Only ids we offered you" is the rule.
    //
    //   UNTOUCHED -> was already grounded against the candidate set at propose
    //                time. The open question is not "did you pick this from a
    //                list" but "does it still EXIST and is it still usable" —
    //                so the ids are looked up directly.
    //
    // Grounding an untouched confirm against the candidate set as well looked
    // tidier and was wrong: that set is capped (60/30/20) and is deliberately
    // the only page, so a perfectly live order simply aged past position 20 as
    // newer ones arrived and its confirm started failing with "I could not find
    // that", which was false. The cap exists to keep the PROMPT small. Nothing
    // about it belongs in a question about one known id.
    // ORDER MATTERS, AND SO DOES THE SHAPE.
    //
    // An earlier version chose BETWEEN the two checks with a ternary on
    // `editedPayload`. CodeQL flagged it `js/user-controlled-bypass` — "this
    // condition guards a sensitive action, but a user-provided value controls
    // it" — and it was right about the shape even though the code was not
    // exploitable: omitting the payload selects the STORED one, which the
    // caller never supplied and which was grounded at propose time, so nothing
    // could be injected through the weaker branch.
    //
    // "Not exploitable today" is a poor thing to rest on when the fix is free.
    // A request field deciding WHICH guard runs is one refactor away from
    // deciding WHETHER one runs. So the request can now only ADD a check:
    //
    //   supplied a payload -> ALSO pass `validateEdit` (candidate-set
    //                         grounding, the anti-injection rule for operator
    //                         input)
    //   always             -> pass `verifyStoredAction` (the ids still exist,
    //                         the vendor is still active, the order still open)
    //
    // The second is unconditional, so no request shape can skip it. And an
    // edited payload now gets the existence check too, which the ternary
    // version never gave it.
    let executedPayload: Record<string, unknown> | null = null;
    try {
      if (editedPayload) {
        const edit = await this.validateEdit(
          restaurantId,
          claimed,
          editedPayload,
        );
        if (!edit.ok) {
          await this.releaseClaim(actionId);
          throw new BadRequestException(edit.reason);
        }
        executedPayload = edit.payload;
      }

      const live = await this.verifyStoredAction(restaurantId, {
        ...claimed,
        payload: executedPayload ?? claimed.payload,
      });
      if (!live.ok) {
        await this.releaseClaim(actionId);
        throw new BadRequestException(live.reason);
      }
    } catch (err) {
      // The checks THROW on a failed query (loadCandidates does, by design).
      // Without this the throw escaped past the rollback and left the row at
      // `confirmed` — where `confirm` cannot claim it again (it requires
      // `proposed`) and `discard` cannot either. A transient database blip
      // would have permanently stranded a proposal: not executable, not
      // dismissable, gone.
      //
      // A BadRequestException raised above has ALREADY released the claim, so
      // it is rethrown untouched rather than rolled back twice.
      if (err instanceof BadRequestException) throw err;
      await this.releaseClaim(actionId);
      throw err;
    }

    const effective = executedPayload
      ? { ...claimed, payload: executedPayload }
      : claimed;
    const edited = executedPayload !== null;

    try {
      const executionRef = await this.execute(restaurantId, userId, effective);
      await client
        .from("ai_proposed_actions")
        .update({
          status: "executed",
          executed_at: new Date().toISOString(),
          execution_ref: executionRef,
          ...(executedPayload ? { executed_payload: executedPayload } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq("id", actionId);
      this.gradeResolution(claimed.nf_event_id, {
        outcome: "executed",
        executionRef,
        edited,
      });
      if (executedPayload && claimed.nf_event_id) {
        // The shape of the miss, recorded beside the confirmation rather than
        // folded into it.
        this.nfVerdicts.recordForEvent(
          claimed.nf_event_id,
          EDIT_BASIS,
          editVerdict(claimed.payload ?? {}, executedPayload),
        );
      }
      return { executed: true, actionId, executionRef, edited };
    } catch (err: any) {
      const reason = String(err?.message ?? err).slice(0, 300);
      await client
        .from("ai_proposed_actions")
        .update({
          status: "failed",
          failure_reason: reason,
          updated_at: new Date().toISOString(),
        })
        .eq("id", actionId);
      this.gradeResolution(claimed.nf_event_id, {
        outcome: "failed",
        failureReason: reason,
        edited,
      });
      this.logger.error(`Ask AI execution failed for ${actionId}: ${reason}`);
      throw err;
    }
  }

  async discard(restaurantId: string, userId: string, actionId: string) {
    const { data, error } = await this.databaseService
      .getClient()
      .from("ai_proposed_actions")
      .update({
        status: "discarded",
        updated_at: new Date().toISOString(),
      })
      .eq("id", actionId)
      .eq("restaurant_id", restaurantId)
      .eq("status", "proposed")
      .select("id, nf_event_id")
      .maybeSingle();

    if (error) {
      this.logger.error(`Ask AI discard failed: ${error.message}`);
      throw new ServiceUnavailableException("Could not discard that action.");
    }
    if (!data) {
      throw new NotFoundException(
        "That action is no longer waiting for confirmation.",
      );
    }
    // A discard is the operator saying no to what was offered. That is the
    // signal worth having, uncomfortable as it is to record.
    this.gradeResolution(data.nf_event_id, { outcome: "discarded" });
    return { discarded: true, actionId };
  }

  private gradeResolution(
    nfEventId: string | null,
    input: Parameters<typeof confirmationVerdict>[0],
  ): void {
    if (!nfEventId) return;
    this.nfVerdicts.recordForEvent(
      nfEventId,
      CONFIRMATION_BASIS,
      confirmationVerdict(input),
    );
  }

  /**
   * Put a claimed row back to `proposed`.
   *
   * The claim is a compare-and-swap, so anything that stops the execution after
   * it has been won MUST undo it. A row left at `confirmed` is unreachable by
   * both `confirm` (which requires `proposed`) and `discard` (same), so it is
   * not a retry away from working — it is gone.
   */
  private async releaseClaim(actionId: string): Promise<void> {
    await this.databaseService
      .getClient()
      .from("ai_proposed_actions")
      .update({
        status: "proposed",
        confirmed_by: null,
        confirmed_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", actionId);
  }

  /**
   * Does what this proposal points at still exist, and is it still usable?
   *
   * For a payload nobody edited. It was grounded against the candidate set when
   * it was written, so the injection question is already answered and asking it
   * again only re-imposes the prompt's cap on a question that has nothing to do
   * with prompt size. What is genuinely open is whether the world moved: the
   * vendor deactivated, the order delivered, the item deleted.
   *
   * Every lookup is scoped by `restaurant_id`. The client is service-role and
   * bypasses RLS, so that filter is the tenant boundary, not a hint.
   *
   * Errors THROW rather than reading as "not found" — a failed lookup and a
   * deleted row must not produce the same answer on a path that creates
   * purchase orders. The caller rolls the claim back.
   */
  private async verifyStoredAction(
    restaurantId: string,
    row: any,
  ): Promise<
    | { ok: true; payload: Record<string, unknown> }
    | { ok: false; reason: string }
  > {
    const client = this.databaseService.getClient();
    const payload = (row.payload ?? {}) as Record<string, unknown>;

    const gone = (what: string) => ({
      ok: false as const,
      reason: `The ${what} this refers to is no longer available. Ask again to pick a current one.`,
    });

    // Every `.from()` below takes a STRING LITERAL, and the helper receives a
    // built query rather than a table name. The obvious shape — `lookup(table,
    // id)` doing `client.from(table)` — cost nothing to write and broke
    // `check_queried_tables_exist.py`, which resolves table names statically and
    // fails when its unresolvable-call-site count grows. That guard is right:
    // a table name it cannot read is a table it cannot verify exists, and this
    // file would have been the 25th blind spot against a ceiling of 24.
    const exists = async (table: string, query: any): Promise<boolean> => {
      const { data, error } = await query.limit(1);
      if (error) {
        this.logger.error(
          `Ask AI could not re-check ${table} before executing: ${error.message}`,
        );
        throw new ServiceUnavailableException("Could not confirm that action.");
      }
      return (data ?? []).length > 0;
    };

    if (row.family === "procurement" && row.action_type === "reorder") {
      const itemLive = await exists(
        "restaurant_inventory",
        client
          .from("restaurant_inventory")
          .select("id")
          .eq("id", payload.inventoryId)
          .eq("restaurant_id", restaurantId),
      );
      if (!itemLive) return gone("item");

      const vendorLive = await exists(
        "providers",
        client
          .from("providers")
          .select("id")
          .eq("id", payload.providerId)
          .eq("restaurant_id", restaurantId)
          .eq("is_active", true),
      );
      if (!vendorLive) return gone("vendor");

      return { ok: true, payload };
    }

    if (row.family === "communications" && row.action_type === "vendor_draft") {
      const orderLive = await exists(
        "procurement_orders",
        client
          .from("procurement_orders")
          .select("id")
          .eq("id", payload.orderId)
          .eq("restaurant_id", restaurantId)
          .not("status", "in", toPostgrestInList(ORDER_CLOSED_STATUSES)),
      );
      if (!orderLive) return gone("order");

      return { ok: true, payload };
    }

    // Same reasoning as `execute`'s fallthrough: reached only if the allowlist
    // widened and this did not, so it refuses rather than waving it through.
    return {
      ok: false,
      reason: "That kind of action can no longer be confirmed here.",
    };
  }

  /**
   * Re-validate an operator's edit through the same gates a model proposal
   * passes. Returns the normalised payload, or the reason it was refused.
   */
  private async validateEdit(
    restaurantId: string,
    row: any,
    editedPayload: Record<string, unknown>,
    // A discriminated union, restored when OD-107 turned `strictNullChecks` on.
    // This was the third of three flattenings the flag forced in this feature.
  ): Promise<
    | { ok: true; payload: Record<string, unknown> }
    | { ok: false; reason: string }
  > {
    const candidate = {
      family: row.family,
      actionType: row.action_type,
      payload: editedPayload,
    };

    const validation = validateAction(candidate);
    if (!validation.ok) {
      return { ok: false, reason: validation.reason };
    }

    // The family and action type are NOT editable. Allowing them to change
    // would turn "edit the quantity" into "swap this for a different action
    // that a human already confirmed", which is the confirm gate defeated by
    // its own convenience feature.
    if (
      validation.action.family !== row.family ||
      validation.action.actionType !== row.action_type
    ) {
      return {
        ok: false,
        reason: "An edit cannot change what kind of action this is.",
      };
    }

    const { candidates } = await this.loadCandidates(restaurantId);
    const grounding = checkActionGrounded(validation.action, candidates);
    if (!grounding.grounded) {
      this.logger.warn(
        `Ask AI edit referenced ungrounded ids [${(grounding.ungrounded ?? []).join(", ")}] for restaurant ${restaurantId}`,
      );
      return {
        ok: false,
        reason: grounding.reason ?? "Unknown item, vendor or order.",
      };
    }

    return {
      ok: true,
      payload: validation.action.payload as Record<string, unknown>,
    };
  }

  /**
   * Hand the validated payload to the service that owns the domain.
   *
   * Nothing here writes to a domain table. Both executors produce a DRAFT, so
   * the confirm gate above is the FIRST of two human gates, not the only one.
   */
  private async execute(
    restaurantId: string,
    userId: string,
    row: any,
  ): Promise<string> {
    if (row.family === "procurement" && row.action_type === "reorder") {
      const order = await this.procurement.createOrder(
        restaurantId,
        userId,
        {
          inventoryId: row.payload.inventoryId,
          providerId: row.payload.providerId,
          quantity: row.payload.quantity,
          ...(row.payload.unitType ? { unitType: row.payload.unitType } : {}),
        } as any,
        // Provenance, not decoration: without it an Ask-AI order and a manual
        // one were byte-identical rows, so "did the AI place this?" — the first
        // question anyone asks of autonomous ordering — had no answer.
        { source: "ask_ai" },
      );
      return String((order as any)?.id ?? "");
    }

    if (row.family === "communications" && row.action_type === "vendor_draft") {
      const res = await this.procurement.generateAiReply(
        restaurantId,
        row.payload.orderId,
        { instruction: row.payload.instruction },
      );
      if (!res?.triggered) {
        throw new Error(
          res?.reason || "The responder declined to draft a reply.",
        );
      }
      return String(res.draftId ?? "");
    }

    // Unreachable through `propose`, which validates before storing. Reached
    // only if the allowlist widened and this switch did not — so it fails loudly
    // rather than silently doing nothing, which would leave a row stuck at
    // `confirmed` with no execution and no explanation.
    throw new Error(
      `No executor for ${row.family}.${row.action_type} — the allowlist and the dispatcher disagree.`,
    );
  }
}
