import {
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { ProcurementService } from "../procurement/procurement.service";
import { ReceivingService } from "../procurement/receiving.service";
import { ConversationsService } from "../conversations/conversations.service";
import { IdentityService } from "../vendor-intel/identity.service";
import { MembersService } from "../restaurants/members.service";
import { AskAiService } from "../ask-ai/ask-ai.service";
import {
  COUNTER_REGISTERS,
  CounterAct,
  CounterRegister,
  CounterRegisterKey,
  CounterRow,
  CounterVerb,
  HouseCounterResponse,
} from "./house-counter.types";

/** How many rows of each register travel with the answer. */
export const COUNTER_ROWS = 5;

/**
 * A register that has not answered in this long is not read. Eight seconds is
 * well past any healthy read of these seven queries and well inside the
 * gateway's own request timeout, so the aggregate answers with the six that
 * landed rather than failing whole because one hung.
 */
export const REGISTER_TIMEOUT_MS = 8_000;

/** Page sizes the sources themselves use; a full page is a floor, not a total. */
const IDENTITY_PAGE = 50;
const PROPOSAL_PAGE = 20;
const CREDIT_PAGE = 200;

/**
 * Every column the credits register reads, as a module-level literal for
 * `scripts/check_read_columns_exist.py`.
 */
const CREDIT_COLUMNS =
  "id, reason, summary, currency, claimed_amount, promised_at, opened_at, provider:provider_id(name)";
const CURRENCY_COLUMNS = "currency";

class RegisterTimeout extends Error {
  constructor() {
    super("register timed out");
  }
}

/**
 * The role IN THIS HOUSE (ADR 0162) that may act for the house.
 *
 * Mirrors `RolesGuard`: a route that requires owner or manager also admits
 * `admin`. `null` — the token names a house the person holds no row in — never
 * satisfies a manager's gate (order-approval-gate.ts's rule: a null role must
 * never open a door). The controller refuses such a session before this is
 * ever asked (`@Roles("owner","manager","staff")`); this stays strict on its
 * own so a second caller cannot inherit a looser rule.
 */
export function mayManage(role: string | null | undefined): boolean {
  const r = role ? String(role).toLowerCase() : "";
  return r === "owner" || r === "manager" || r === "admin";
}

/**
 * What a failed read is, in the counter's three words.
 *
 * A 403 from a source is a refusal and is printed as one — the source wrote
 * that sentence for a person. Everything else is `unreadable`, with the status
 * kept and the sentence generic: a 503's body can carry the database's own
 * text (identity.service.ts puts `error.message` into its refusal), and that
 * is logged, not handed to the page.
 */
export function outcomeOfFailure(
  err: unknown,
  label: string,
):
  | { state: "refused"; sentence: string }
  | { state: "unreadable"; status: number | null; sentence: string } {
  if (err instanceof RegisterTimeout) {
    return {
      state: "unreadable",
      status: null,
      sentence: `${label} did not answer within ${REGISTER_TIMEOUT_MS / 1000} s.`,
    };
  }
  if (err instanceof HttpException) {
    const status = err.getStatus();
    if (status === 403) {
      const body = err.getResponse();
      const said =
        typeof body === "string"
          ? body
          : typeof (body as { message?: unknown })?.message === "string"
            ? String((body as { message: string }).message)
            : err.message;
      return { state: "refused", sentence: said };
    }
    return {
      state: "unreadable",
      status,
      sentence: `${label} could not be read (${status}).`,
    };
  }
  return {
    state: "unreadable",
    status: 500,
    sentence: `${label} could not be read.`,
  };
}

const LABELS: Record<CounterRegisterKey, string> = {
  orders: "Orders awaiting the seal",
  deliveries: "Deliveries counted by case",
  credits: "Credits promised",
  threads: "Vendor replies waiting",
  identities: "Identities to decide",
  invitations: "Invitations",
  proposals: "Mudavym's proposals",
};

interface Answer {
  rows: CounterRow[];
  count: number;
  complete: boolean;
}

@Injectable()
export class HouseCounterService {
  private readonly logger = new Logger(HouseCounterService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly procurement: ProcurementService,
    private readonly receiving: ReceivingService,
    private readonly conversations: ConversationsService,
    private readonly identity: IdentityService,
    private readonly members: MembersService,
    private readonly askAi: AskAiService,
  ) {}

  /**
   * Read every register for `house` as `userId` holding `role`.
   *
   * `house` and `role` come from the token, never from a parameter: the
   * controller passes `user.restaurantId` and `user.role` and nothing else.
   */
  async read(
    house: string,
    userId: string,
    role: string | null,
  ): Promise<HouseCounterResponse> {
    if (!house) {
      throw new ForbiddenException("This session names no restaurant.");
    }
    const manager = mayManage(role);

    const plans: Record<
      CounterRegisterKey,
      { refuse?: string; act: CounterAct; load: () => Promise<Answer> }
    > = {
      // Any member of the house reads the queue (the route admits owner,
      // manager and staff — house-counter.controller.ts);
      // only an owner or a manager may seal — `ApproverRole` is owner|manager
      // and staff rank 0 (order-approval-gate.ts). A manager over a ceiling is
      // refused at the MINT, in the house's words, not guessed here.
      orders: {
        act: manager ? "yours" : "not_yours",
        load: async () => {
          const all = await this.procurement.listPendingOrders(house);
          return {
            count: all.length,
            complete: true,
            rows: all.slice(0, COUNTER_ROWS).map((o) => ({
              id: o.id,
              orderNumber: o.orderNumber ?? null,
              vendor: o.providerName ?? null,
              wine: o.wineName ?? null,
              quantity: typeof o.quantity === "number" ? o.quantity : null,
              unitType: o.unitType ?? null,
              total: typeof o.totalCost === "number" ? o.totalCost : null,
              status: String(o.status),
              requestedAt: o.requestedAt ?? null,
            })),
          };
        },
      },
      // A bottle count carries no money, and the person at the door is the one
      // who does it — the receiving routes carry no role gate.
      deliveries: {
        act: "yours",
        load: async () => {
          const all = await this.receiving.listUnverified(house);
          return {
            count: all.length,
            complete: true,
            rows: all.slice(0, COUNTER_ROWS).map((d) => ({ ...d })),
          };
        },
      },
      // Credit claims are the house's money (claimed amounts, what a vendor
      // promised back). The counter refuses them to staff — the staff gate the
      // sketch costed, applied where the counter would otherwise show it.
      credits: {
        refuse: manager
          ? undefined
          : "Credit claims carry the house's money, so they are for an owner or a manager.",
        act: "yours",
        load: () => this.readPromisedCredits(house),
      },
      // Reading is open to every member (the list route carries no @Roles);
      // approving, editing or rejecting what a vendor is told is owner/manager
      // (conversations.controller.ts). Rows carry no message text and no price.
      threads: {
        act: manager ? "yours" : "not_yours",
        load: async () => {
          const all = await this.conversations.getPendingConversations(house);
          return {
            count: all.length,
            complete: true,
            rows: all.slice(0, COUNTER_ROWS).map((c: any) => ({
              id: String(c.id),
              vendor: c.providers?.name ?? null,
              orderNumber:
                c.procurement_orders?.order_number ??
                c.order_number_snapshot ??
                null,
              channel: c.channel ?? null,
              intent: c.detected_intent ?? null,
              aiGenerated: Boolean(c.ai_generated),
              createdAt: c.created_at ?? null,
            })),
          };
        },
      },
      // Staff may decide (vendor-intel.controller.ts: the queue and its decide
      // route carry @Roles("owner","manager","staff")).
      identities: {
        act: "yours",
        load: async () => {
          const all = await this.identity.pending(house, IDENTITY_PAGE);
          return {
            count: all.length,
            complete: all.length < IDENTITY_PAGE,
            rows: all.slice(0, COUNTER_ROWS).map((r: any) => ({
              id: String(r.id),
              subject: r.subject_table ?? null,
              method: r.method ?? null,
              confidence:
                r.confidence === null || r.confidence === undefined
                  ? null
                  : Number(r.confidence),
              createdAt: r.created_at ?? null,
            })),
          };
        },
      },
      // `getInvites` asserts owner|manager itself (members.service.ts); the
      // refusal is decided here from the token first so staff are told in
      // words rather than by a 403 the service would throw.
      invitations: {
        refuse: manager
          ? undefined
          : "Invitations are for an owner or a manager to send and withdraw.",
        act: "yours",
        load: async () => {
          const all = await this.members.getInvites(userId, house);
          return {
            count: all.length,
            complete: true,
            // The invite CODE is the door itself; it never travels here.
            rows: all.slice(0, COUNTER_ROWS).map((i: any) => ({
              id: String(i.id),
              role: i.role ?? null,
              expiresAt: i.expires_at ?? null,
              createdAt: i.created_at ?? null,
            })),
          };
        },
      },
      // Every member reads the proposals; applying one is owner/manager
      // (ask-ai.controller.ts confirm carries @Roles("owner","manager")).
      proposals: {
        act: manager ? "yours" : "not_yours",
        load: async () => {
          const all = (await this.askAi.listOpen(house)) as any[];
          return {
            count: all.length,
            complete: all.length < PROPOSAL_PAGE,
            rows: all.slice(0, COUNTER_ROWS).map((p) => ({
              id: String(p.id),
              summary: p.summary ?? null,
              family: p.family ?? null,
              actionType: p.action_type ?? null,
              utterance: p.utterance ?? null,
              createdAt: p.created_at ?? null,
            })),
          };
        },
      },
    };

    const [registers, currency] = await Promise.all([
      Promise.all(
        COUNTER_REGISTERS.map(({ key, verb }) =>
          this.readOne(house, key, verb, plans[key]),
        ),
      ),
      this.readCurrency(house),
    ]);

    return {
      readAt: new Date().toISOString(),
      house: { id: house, currency },
      role: role ?? null,
      registers,
    };
  }

  private async readOne(
    house: string,
    key: CounterRegisterKey,
    verb: CounterVerb,
    plan: { refuse?: string; act: CounterAct; load: () => Promise<Answer> },
  ): Promise<CounterRegister> {
    if (plan.refuse) {
      return {
        key,
        verb,
        state: "refused",
        readAt: new Date().toISOString(),
        ms: 0,
        sentence: plan.refuse,
      };
    }
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const answer = await Promise.race([
        plan.load(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new RegisterTimeout()),
            REGISTER_TIMEOUT_MS,
          );
        }),
      ]);
      return {
        key,
        verb,
        state: "answered",
        readAt: new Date().toISOString(),
        ms: Date.now() - started,
        count: answer.count,
        complete: answer.complete,
        rows: answer.rows,
        act: plan.act,
      };
    } catch (err) {
      const outcome = outcomeOfFailure(err, LABELS[key]);
      this.logger.warn(
        `counter register ${key} for house ${house}: ${outcome.state} — ${
          (err as Error)?.message ?? String(err)
        }`,
      );
      return {
        key,
        verb,
        readAt: new Date().toISOString(),
        ms: Date.now() - started,
        ...outcome,
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Credits a vendor PROMISED and has not yet settled with a memo — the ones
   * waiting on somebody to verify the memo arrived. Promised is not recovered
   * (credits.controller.ts's rule), which is why the row names it `promised`.
   */
  private async readPromisedCredits(house: string): Promise<Answer> {
    const { data, error } = await this.db
      .getClient()
      .from("procurement_credits")
      .select(CREDIT_COLUMNS)
      .eq("restaurant_id", house)
      .eq("state", "promised")
      .order("promised_at", { ascending: true })
      .limit(CREDIT_PAGE);
    if (error) {
      this.logger.error(`promised credits for ${house}: ${error.message}`);
      throw new ServiceUnavailableException("Could not read promised credits");
    }
    const all = (data ?? []) as any[];
    return {
      count: all.length,
      complete: all.length < CREDIT_PAGE,
      rows: all.slice(0, COUNTER_ROWS).map((c) => ({
        id: String(c.id),
        vendor: c.provider?.name ?? null,
        reason: String(c.reason),
        summary: c.summary ?? null,
        promisedAmount: Number(c.claimed_amount ?? 0),
        currency: c.currency ?? null,
        promisedAt: c.promised_at ?? null,
      })),
    };
  }

  /** The house's own currency, for order totals. A failed read says so. */
  private async readCurrency(
    house: string,
  ): Promise<HouseCounterResponse["house"]["currency"]> {
    try {
      const { data, error } = await this.db
        .getClient()
        .from("restaurants")
        .select(CURRENCY_COLUMNS)
        .eq("id", house)
        .maybeSingle();
      if (error) {
        this.logger.warn(`house currency for ${house}: ${error.message}`);
        return { state: "unreadable", code: null };
      }
      const code = (data as { currency?: string | null } | null)?.currency;
      return typeof code === "string" && /^[A-Z]{3}$/.test(code)
        ? { state: "recorded", code }
        : { state: "not_recorded", code: null };
    } catch (err) {
      this.logger.warn(
        `house currency for ${house}: ${(err as Error)?.message ?? err}`,
      );
      return { state: "unreadable", code: null };
    }
  }
}
