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

/** Caps on the candidate set put in the prompt. Big enough to be useful, small
 *  enough that the prompt stays cheap and the model is not asked to scan a
 *  thousand rows for the one the operator meant. */
const MAX_INVENTORY_CANDIDATES = 60;
const MAX_PROVIDER_CANDIDATES = 30;
const MAX_ORDER_CANDIDATES = 20;

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

  private model(): string {
    return this.configService.get<string>("ASK_AI_MODEL") || "claude-haiku-4-5";
  }

  /**
   * The ids the model is allowed to choose from, and the labels it needs to
   * choose sensibly.
   *
   * Errors are THROWN, not swallowed into an empty set. An empty candidate list
   * looks exactly like "this restaurant has no inventory", and the model would
   * then decline politely while the real problem was a failed query — the
   * `catch { return [] }` shape this repo has spent the week deleting.
   */
  private async loadCandidates(restaurantId: string): Promise<{
    candidates: ProposalCandidates;
    prompt: string;
  }> {
    const client = this.databaseService.getClient();

    const [inv, prov, ord] = await Promise.all([
      client
        .from("restaurant_inventory")
        .select("id, wine_name")
        .eq("restaurant_id", restaurantId)
        .limit(MAX_INVENTORY_CANDIDATES),
      client
        .from("providers")
        .select("id, name")
        .eq("restaurant_id", restaurantId)
        .eq("is_active", true)
        .limit(MAX_PROVIDER_CANDIDATES),
      client
        .from("procurement_orders")
        .select("id, provider_id, status")
        .eq("restaurant_id", restaurantId)
        .not("status", "in", '("delivered","cancelled")')
        .order("created_at", { ascending: false })
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
    const providerName = new Map(
      providers.map((p: any) => [p.id, p.name as string]),
    );

    const prompt = [
      "CANDIDATES — every id you use must be copied from here.",
      "",
      "inventory:",
      ...inventory.map((i: any) => `  ${i.id}  ${i.wine_name ?? "(unnamed)"}`),
      "",
      "providers:",
      ...providers.map((p: any) => `  ${p.id}  ${p.name ?? "(unnamed)"}`),
      "",
      "orders (open):",
      ...orders.map(
        (o: any) =>
          `  ${o.id}  vendor=${providerName.get(o.provider_id) ?? "unknown"} status=${o.status}`,
      ),
    ].join("\n");

    return {
      candidates: {
        inventoryIds: new Set(inventory.map((i: any) => i.id as string)),
        providerIds: new Set(providers.map((p: any) => p.id as string)),
        orderIds: new Set(orders.map((o: any) => o.id as string)),
      },
      prompt,
    };
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
    let payload: any;
    try {
      payload = await this.modelClient.call({
        body: {
          model: this.model(),
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
          context: { utterance_chars: ask.length },
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
    let executedPayload: Record<string, unknown> | null = null;
    if (editedPayload) {
      const check = await this.validateEdit(
        restaurantId,
        claimed,
        editedPayload,
      );
      if (!check.ok) {
        await client
          .from("ai_proposed_actions")
          .update({
            status: "proposed",
            confirmed_by: null,
            confirmed_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", actionId);
        throw new BadRequestException(check.reason);
      }
      executedPayload = check.payload;
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
      const order = await this.procurement.createOrder(restaurantId, userId, {
        inventoryId: row.payload.inventoryId,
        providerId: row.payload.providerId,
        quantity: row.payload.quantity,
        ...(row.payload.unitType ? { unitType: row.payload.unitType } : {}),
      } as any);
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
