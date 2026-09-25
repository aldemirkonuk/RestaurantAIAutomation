import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { DatabaseService } from "../database/database.service";
import { OrganizationsService } from "../organizations/organizations.service";
import { HouseCurrencyService } from "../settings/house-currency.service";
import { CellarRegistersService } from "../cellar/cellar-registers.service";
import { VendorTermsService } from "../vendor-terms/vendor-terms.service";
import { ProvidersService } from "../providers/providers.service";
import { NotificationsService } from "../notifications/notifications.service";
import { MenusService } from "../menus/menus.service";
import { isIso4217 } from "../common/iso-4217";
import { SealChallengeService } from "../common/seal/seal-challenge.service";
import { ARRIVAL_APPLY_ACT, arrivalSealArgs } from "./arrival-seal";
import {
  ConfigurationBatch,
  ConfigurationInput,
  ConfigurationRow,
  Folio,
  folioFor,
  rowKey,
  sameValue,
  validateConfiguration,
} from "./arrival-contract";
import { ProposeBatchDto, MenuEvidenceDto } from "./arrival.dto";

export interface ArrivalActor {
  userId: string;
  restaurantId: string;
}
const HOUSE_SCOPE = "00000000-0000-0000-0000-000000000000";
const SAFE_FAILURE =
  "The book could not be read or recorded. Try again; an unavailable book is not an empty one.";
const UNCONFIRMED_REASON =
  "The writer did not return a confirmed receipt. Read the setting before another attempt.";

@Injectable()
export class ArrivalService {
  constructor(
    private readonly db: DatabaseService,
    private readonly organizations: OrganizationsService,
    private readonly currency: HouseCurrencyService,
    private readonly cellar: CellarRegistersService,
    private readonly terms: VendorTermsService,
    private readonly providers: ProvidersService,
    private readonly notifications: NotificationsService,
    private readonly menus: MenusService,
    // Declared LAST, same reasoning as `procurement.service.ts`'s own seal
    // dependency: the two specs that build this service positionally must
    // keep compiling. NOT optional in the DI graph once `MenusModule` imports
    // `SealModule` — `apply()` REFUSES rather than seals when it is missing,
    // because a seal check that disappears with its own dependency is not a
    // seal check (codex-audit/C2-adopt.md #2).
    @Optional()
    private readonly sealChallenges?: SealChallengeService,
  ) {}

  private requireActor(actor: ArrivalActor) {
    if (!actor?.userId || !actor?.restaurantId)
      throw new UnauthorizedException("Open a house before opening its book.");
  }
  private async manage(actor: ArrivalActor) {
    this.requireActor(actor);
    await this.organizations.assertCanManageRestaurant(
      actor.userId,
      actor.restaurantId,
      "record this house's opening configuration",
    );
  }
  private async checked<T>(
    query: PromiseLike<{ data: T; error: unknown }>,
  ): Promise<T> {
    const { data, error } = await query;
    if (error) throw new ServiceUnavailableException(SAFE_FAILURE);
    return data;
  }
  private async source<T>(read: () => Promise<T>) {
    try {
      return { readable: true as const, data: await read(), reason: null };
    } catch {
      return { readable: false as const, data: null, reason: SAFE_FAILURE };
    }
  }

  async read(actor: ArrivalActor) {
    this.requireActor(actor);
    // Confidential vendor terms are offered to this house's managers only.
    // Personal notification preferences still have their own scope and writer.
    let canManage = true;
    try {
      await this.manage(actor);
    } catch (error) {
      if ((error as { getStatus?: () => number }).getStatus?.() === 403)
        canManage = false;
      else throw error;
    }
    const [
      house,
      currency,
      cellar,
      vendors,
      preferences,
      folios,
      batches,
      openingMenu,
    ] = await Promise.all([
      this.source(() =>
        this.checked(
          this.db.client
            .from("restaurants")
            .select("name, default_threshold_min, threshold_configured")
            .eq("id", actor.restaurantId)
            .single(),
        ),
      ),
      this.source(() => this.currency.read(actor.restaurantId)),
      this.source(() => this.cellar.read(actor.restaurantId)),
      canManage
        ? this.source(async () => ({
            terms: await this.terms.read(actor.restaurantId),
            currencies: await this.checked(
              this.db.client
                .from("providers")
                .select("id, name, usual_currency, usual_currency_set_at")
                .eq("restaurant_id", actor.restaurantId)
                .is("deleted_at", null)
                .order("name")
                .limit(500),
            ),
          }))
        : Promise.resolve({
            readable: false as const,
            data: null,
            reason:
              "Vendor terms are available to this house's owner or manager.",
          }),
      this.source(() => this.notifications.getPreferences(actor.userId)),
      this.source(() =>
        this.checked(
          this.db.client
            .from("arrival_folios")
            .select("folio, state, actor_id, updated_at")
            .eq("restaurant_id", actor.restaurantId)
            .in("scope_id", [HOUSE_SCOPE, actor.userId]),
        ),
      ),
      this.source(() =>
        this.checked(
          this.db.client
            .from("configuration_batches")
            .select("*")
            .eq("restaurant_id", actor.restaurantId)
            .eq("user_id", actor.userId)
            .order("created_at", { ascending: false })
            .limit(10),
        ),
      ),
      this.source(() => this.menus.getMenu(actor.restaurantId)),
    ]);
    return {
      restaurantId: actor.restaurantId,
      canManage,
      house,
      currency,
      cellar,
      vendors,
      preferences,
      folios,
      batches,
      openingMenu,
    };
  }

  async recordFolio(
    actor: ArrivalActor,
    folio: Folio,
    state: "open" | "posted" | "skipped",
    changes: object,
    correlationId: string | null = null,
  ) {
    this.requireActor(actor);
    await this.checked(
      this.db.client.rpc("arrival_record_folio", {
        p_restaurant_id: actor.restaurantId,
        p_actor_id: actor.userId,
        p_folio: folio,
        p_state: state,
        p_changes: changes,
        p_correlation_id: correlationId,
      }),
    );
  }
  async skip(actor: ArrivalActor, folio: Folio) {
    if (!["notifications", "assistant"].includes(folio))
      await this.manage(actor);
    await this.recordFolio(actor, folio, "skipped", {
      offered: [folio],
      answered: [],
      provenance: "skipped",
    });
    return { recorded: true };
  }

  /** Read only the exact setting being considered, including statedness.
   * A failed read is never turned into a default the assistant may replace. */
  private async current(
    actor: ArrivalActor,
    input: ConfigurationInput,
  ): Promise<{ value: unknown; stated: boolean; snapshot: unknown }> {
    const { target, field, subjectId } = input;
    if (target === "menu_item") {
      const value = input.value as { name: string; producer?: string };
      let query = this.db.client
        .from("menu_items")
        .select("id, name, producer")
        .eq("restaurant_id", actor.restaurantId)
        .eq("name", value.name);
      query = value.producer
        ? query.eq("producer", value.producer)
        : query.is("producer", null);
      const rows = await this.checked(query.limit(1));
      return {
        value: rows?.[0] ?? null,
        stated: !!rows?.length,
        snapshot: rows?.[0] ?? null,
      };
    }
    if (target === "currency") {
      const read = await this.currency.read(actor.restaurantId);
      if (!read.readable) throw new ServiceUnavailableException(SAFE_FAILURE);
      return {
        value: read.code,
        stated: read.code !== null,
        snapshot: await this.checked(
          this.db.client
            .from("restaurants")
            .select("currency, updated_at")
            .eq("id", actor.restaurantId)
            .single(),
        ),
      };
    }
    if (target === "cellar") {
      const row = await this.checked(
        this.db.client
          .from("restaurant_cellar_registers")
          .select("*")
          .eq("restaurant_id", actor.restaurantId)
          .eq("register", field)
          .maybeSingle(),
      );
      return {
        value: row?.carried ?? null,
        stated: !!row && row.source !== "inferred",
        snapshot: row,
      };
    }
    if (target === "threshold") {
      const row = await this.checked(
        this.db.client
          .from("restaurants")
          .select("default_threshold_min, threshold_configured, updated_at")
          .eq("id", actor.restaurantId)
          .single(),
      );
      if (!row) throw new NotFoundException("The house could not be found.");
      return {
        value: row.default_threshold_min,
        stated: row.threshold_configured === true,
        snapshot: row,
      };
    }
    if (target === "vendor_currency") {
      const row = await this.providers.getUsualCurrency(
        subjectId!,
        actor.restaurantId,
      );
      return {
        value: row.code,
        stated: row.code !== null,
        snapshot: await this.checked(
          this.db.client
            .from("providers")
            .select(
              "usual_currency, usual_currency_set_by, usual_currency_set_at, updated_at",
            )
            .eq("restaurant_id", actor.restaurantId)
            .eq("id", subjectId!)
            .single(),
        ),
      };
    }
    if (target === "vendor_terms") {
      const read = await this.terms.read(actor.restaurantId);
      if (
        !read.sources.providers.readable ||
        !read.sources.statedTerms.readable
      )
        throw new ServiceUnavailableException(SAFE_FAILURE);
      const vendor = read.vendors.find((v) => v.providerId === subjectId);
      if (!vendor)
        throw new NotFoundException("That vendor is not in this house's book.");
      const cells: Record<string, unknown> = {
        deliveryWeekdays: vendor.deliveryWeekdays.value,
        orderCutoffTime: vendor.orderCutoff.value?.time ?? null,
        orderCutoffOffsetDays: vendor.orderCutoff.value?.offsetDays ?? null,
        minimumOrderAmount: vendor.minimumOrder.value,
        leadTimeDays: vendor.leadTimeDays.value,
        paymentTerms: vendor.paymentTerms.value,
        notes: vendor.notes,
      };
      const source =
        field === "notes"
          ? vendor.notes === null
            ? "unknown"
            : "stated"
          : field.startsWith("orderCutoff")
            ? vendor.orderCutoff.source
            : field === "minimumOrderAmount"
              ? vendor.minimumOrder.source
              : (vendor as any)[field]?.source;
      const value = cells[field] ?? null;
      return {
        value,
        stated: source === "stated" || source === "vendor_record",
        snapshot: await this.checked(
          this.db.client
            .from("restaurant_vendor_terms")
            .select("*")
            .eq("restaurant_id", actor.restaurantId)
            .eq("provider_id", subjectId!)
            .maybeSingle(),
        ),
      };
    }
    const raw = await this.checked(
      this.db.client
        .from("notification_preferences")
        .select("*")
        .eq("user_id", actor.userId)
        .maybeSingle(),
    );
    const read = await this.notifications.getPreferences(actor.userId);
    const [group, key] = field.split(".");
    const value = key ? (read as any)[group]?.[key] : (read as any)[group];
    // A persisted preferences row is treated conservatively as stated; an
    // untouched system fallback remains defaulted and may be proposed.
    return {
      value,
      stated: !!raw,
      snapshot: raw,
    };
  }

  private async write(
    actor: ArrivalActor,
    input: ConfigurationInput,
    proposed: boolean,
  ) {
    const { target, field, value, subjectId } = input;
    if (target !== "notifications") await this.manage(actor);
    if (target === "menu_item")
      return this.menus.importParsedItems(
        [value as { name: string }],
        actor.restaurantId,
        actor.userId,
        proposed ? "scan" : "manual",
      );
    if (target === "currency")
      return this.currency.write(actor.restaurantId, value, actor.userId);
    if (target === "cellar")
      return this.cellar.write(
        actor.restaurantId,
        {
          registers: [{ id: field, carried: value as boolean }],
          source: proposed ? "confirmed" : "manual",
        },
        actor.userId,
      );
    if (target === "threshold")
      return this.menus.setDefaultThreshold(
        actor.restaurantId,
        value as number,
      );
    if (target === "vendor_currency")
      return this.providers.setUsualCurrency({
        providerId: subjectId!,
        restaurantId: actor.restaurantId,
        code: value as string,
        userId: actor.userId,
      });
    if (target === "vendor_terms")
      return this.terms.write(
        actor.restaurantId,
        subjectId!,
        { [field]: value },
        actor.userId,
      );
    const [group, key] = field.split(".");
    // The owning writer replaces its categories JSON as one column. Merge the
    // existing categories so a one-field answer cannot reset sibling choices.
    const siblings =
      group === "categories"
        ? (await this.notifications.getPreferences(actor.userId)).categories
        : {};
    return this.notifications.updatePreferences({
      userId: actor.userId,
      ...(key
        ? { [group]: { ...siblings, [key]: value } }
        : { [field]: value }),
    });
  }

  async typed(actor: ArrivalActor, raw: ConfigurationInput) {
    this.requireActor(actor);
    const input = validateConfiguration(raw);
    const before = await this.current(actor, input);
    const result = await this.write(actor, input, false);
    let recorded = true;
    try {
      await this.recordFolio(actor, folioFor(input.target), "posted", {
        provenance: "typed",
        subject: rowKey(input),
        fields: { [input.field]: { from: before.value, to: input.value } },
      });
    } catch {
      recorded = false;
    }
    return {
      written: true,
      recorded,
      reason: recorded
        ? null
        : "The value was written, but its Arrival receipt was not recorded. Read the setting before trying again.",
      result,
    };
  }

  private async batch(
    actor: ArrivalActor,
    id: string,
  ): Promise<ConfigurationBatch> {
    this.requireActor(actor);
    const row = await this.checked(
      this.db.client
        .from("configuration_batches")
        .select("*")
        .eq("id", id)
        .eq("restaurant_id", actor.restaurantId)
        .eq("user_id", actor.userId)
        .maybeSingle(),
    );
    if (!row)
      throw new NotFoundException("This proposal is not in your house book.");
    return row as ConfigurationBatch;
  }
  /** Explicit keys only (never a spread): check_order_capture_contract.py's
   * payload census cannot see what a spread writes, and counts it as an
   * unreadable site. `patch` is one of four known shapes; naming them keeps
   * the write auditable without touching behaviour. */
  private async saveBatch(
    actor: ArrivalActor,
    batch: ConfigurationBatch,
    patch: Partial<{
      rows: ConfigurationRow[];
      status: ConfigurationBatch["status"];
      sealed_at: string;
      undo_until: string;
    }>,
  ) {
    const update: Record<string, unknown> = { revision: batch.revision + 1 };
    if (patch.rows !== undefined) update.rows = patch.rows;
    if (patch.status !== undefined) update.status = patch.status;
    if (patch.sealed_at !== undefined) update.sealed_at = patch.sealed_at;
    if (patch.undo_until !== undefined) update.undo_until = patch.undo_until;
    const rows = await this.checked(
      this.db.client
        .from("configuration_batches")
        .update(update)
        .eq("id", batch.id)
        .eq("restaurant_id", actor.restaurantId)
        .eq("user_id", actor.userId)
        .eq("revision", batch.revision)
        .select("*"),
    );
    if (!rows?.length)
      throw new ConflictException(
        "The proposal changed in another sitting. Read it again before continuing.",
      );
    return rows[0] as ConfigurationBatch;
  }

  async propose(actor: ArrivalActor, dto: ProposeBatchDto) {
    await this.manage(actor);
    const inputs = dto.rows.map(validateConfiguration);
    if (inputs.some((row) => row.target === "menu_item"))
      throw new BadRequestException(
        "Menu proposals must come from the menu evidence reader.",
      );
    if (new Set(inputs.map(rowKey)).size !== inputs.length)
      throw new BadRequestException(
        "A batch can propose each field only once.",
      );
    if (dto.provenance === "invoice")
      throw new BadRequestException(
        "Invoice proposals must be read from the evidence route, not supplied by a client.",
      );
    if (dto.provenance === "inferred") {
      const read = await this.cellar.read(actor.restaurantId);
      for (const input of inputs) {
        const register = read.registers.find((r) => r.id === input.field);
        if (
          input.target !== "cellar" ||
          !register ||
          register.decidedBy !== "inferred" ||
          register.carried !== input.value ||
          !(register.evidence.inventoryRows || register.evidence.menuRows)
        )
          throw new BadRequestException(
            "That proposal is not supported by this house's items or menu.",
          );
      }
    }
    return this.append(actor, inputs, dto.provenance);
  }

  private async append(
    actor: ArrivalActor,
    inputs: ConfigurationInput[],
    provenance: ConfigurationRow["provenance"],
    evidenceId?: string,
  ) {
    const batch = (await this.checked(
      this.db.client
        .from("configuration_batches")
        .select("*")
        .eq("restaurant_id", actor.restaurantId)
        .eq("user_id", actor.userId)
        .in("status", ["draft", "applying", "undoing"])
        .maybeSingle(),
    )) as ConfigurationBatch | null;
    if (batch && batch.status !== "draft")
      throw new ConflictException(
        "The previous batch is still being recorded. Its receipt must be resolved first.",
      );
    const rows: ConfigurationRow[] = [];
    for (const input of inputs) {
      const current = await this.current(actor, input);
      rows.push({
        ...input,
        id: randomUUID(),
        before: current.snapshot,
        beforeValue: current.value,
        provenance,
        ...(evidenceId ? { evidenceId } : {}),
        status: current.stated ? "refused" : "pending",
        reason: current.stated
          ? "Already stated. Change this field directly; a batch cannot replace a person's answer."
          : null,
      });
    }
    if (!batch) {
      const created = await this.checked(
        this.db.client
          .from("configuration_batches")
          .insert({
            restaurant_id: actor.restaurantId,
            user_id: actor.userId,
            rows,
          })
          .select("*")
          .single(),
      );
      return created as ConfigurationBatch;
    }
    const keys = new Set(rows.map(rowKey));
    const combined = [
      ...batch.rows.filter((row) => !keys.has(rowKey(row))),
      ...rows,
    ];
    if (combined.length > 500)
      throw new BadRequestException(
        "Read this batch before adding more than five hundred entries.",
      );
    return this.saveBatch(actor, batch, { rows: combined });
  }

  async menuEvidence(actor: ArrivalActor, dto: MenuEvidenceDto) {
    await this.manage(actor);
    const items = await this.menus.previewArrivalMenu(
      dto.method,
      dto.content,
      actor.restaurantId,
      dto.binary,
    );
    return this.append(
      actor,
      items.map((value) =>
        validateConfiguration({
          target: "menu_item",
          field: randomUUID(),
          value,
        }),
      ),
      "menu",
    );
  }

  async evidence(actor: ArrivalActor, documentId: string, providerId?: string) {
    await this.manage(actor);
    const document = await this.checked(
      this.db.client
        .from("procurement_documents")
        .select("id, doc_type, status, extracted, currency")
        .eq("restaurant_id", actor.restaurantId)
        .eq("id", documentId)
        .maybeSingle(),
    );
    if (!document)
      throw new NotFoundException("That document is not in this house's book.");
    if (document.doc_type !== "invoice")
      throw new BadRequestException(
        "Folio zero reads an invoice. Other papers remain available in Documents.",
      );
    if (
      ["received", "extracting", "rejected", "superseded"].includes(
        document.status,
      )
    )
      throw new BadRequestException(
        "The invoice has no current extraction to propose from yet.",
      );
    const extracted = document.extracted as Record<string, any> | null;
    // The filed currency can be inherited from the house/order; only the
    // extractor's actual printed-currency evidence may propose a new value.
    const printed = extracted?.currencySeen?.code;
    const rows: ConfigurationInput[] = [];
    if (typeof printed === "string" && isIso4217(printed)) {
      rows.push({
        target: "currency",
        field: "code",
        value: printed.toUpperCase(),
      });
      if (providerId) {
        await this.providers.getUsualCurrency(providerId, actor.restaurantId);
        rows.push({
          target: "vendor_currency",
          subjectId: providerId,
          field: "code",
          value: printed.toUpperCase(),
        });
      }
    }
    await this.recordFolio(actor, "evidence", "posted", {
      documentId,
      providerId: providerId ?? null,
      provenance: "invoice",
      answered: [],
      offered: ["currency", "vendor_currency"],
    });
    return {
      batch: rows.length
        ? await this.append(actor, rows, "invoice", documentId)
        : null,
      reason: rows.length
        ? null
        : "No printed currency was extracted, so no currency was proposed. Payment terms need your words. Registers can be inferred after items are in the house's menu or cellar.",
    };
  }

  async discard(
    actor: ArrivalActor,
    id: string,
    rowId: string,
    revision: number,
  ) {
    await this.manage(actor);
    const batch = await this.batch(actor, id);
    if (batch.status !== "draft" || batch.revision !== revision)
      throw new ConflictException(
        "Read the current draft before removing a row.",
      );
    if (!batch.rows.some((row) => row.id === rowId))
      throw new NotFoundException("This entry is no longer in the draft.");
    return this.saveBatch(actor, batch, {
      rows: batch.rows.filter((row) => row.id !== rowId),
    });
  }

  async apply(
    actor: ArrivalActor,
    id: string,
    revision: number,
    challenge?: string | null,
  ) {
    await this.manage(actor);
    let batch = await this.batch(actor, id);
    // A crash partway through the loop below used to lock the batch at
    // 'applying' for good (codex-audit/C2-adopt.md #3): `append()` refuses
    // every new proposal while status isn't 'draft', and nothing existed that
    // could move it off 'applying'. The per-row loop is already idempotent —
    // `if (row.status !== "pending") continue` — so the same actor resuming
    // their own stuck batch just finishes what the loop already tolerates
    // re-entering. A resume does not re-seal (the hold already spent its
    // challenge before the crash) and does not re-check the caller's
    // necessarily-stale revision.
    const resuming = batch.status === "applying";
    if (!resuming) {
      if (batch.status !== "draft" || batch.revision !== revision)
        throw new ConflictException(
          "This draft changed or has already been sealed. Read its receipt.",
        );
      if (!batch.rows.some((row) => row.status === "pending"))
        throw new BadRequestException("There are no pending entries to seal.");
      // ADR 0113: the assistant proposes, the seal applies. Fails closed —
      // codex-audit/C2-adopt.md #2 found the endpoint took only a revision
      // number and redeemed nothing, so the "hold to seal" gesture was
      // client-side ceremony over a plain write.
      if (!this.sealChallenges)
        throw new ServiceUnavailableException(
          "The seal could not be checked (the seal service is not wired in), so nothing was recorded.",
        );
      await this.sealChallenges.redeem({
        restaurantId: actor.restaurantId,
        actorUserId: actor.userId,
        subjectKind: "configuration_batch",
        subjectId: batch.id,
        action: ARRIVAL_APPLY_ACT,
        args: arrivalSealArgs(batch),
        challenge,
      });
      const now = new Date();
      batch = await this.saveBatch(actor, batch, {
        status: "applying",
        sealed_at: now.toISOString(),
        undo_until: new Date(now.getTime() + 7 * 86400000).toISOString(),
      });
    } else {
      // A resume can also find a row still at 'applying' itself — the crash
      // landed while THIS row's writer was in flight, not merely between
      // rows. The loop below is idempotent only for 'pending' rows
      // (`row.status !== "pending"` skips anything else), so a stranded
      // 'applying' row would otherwise never be revisited and the finished
      // receipt would show it as still applying forever. Its writer may or
      // may not have run; both are exactly the uncertainty 'unconfirmed'
      // already means elsewhere in this method, so it is relabelled with the
      // same reason before the loop runs, then left alone by that same guard.
      const stranded = batch.rows.map((row) =>
        row.status === "applying"
          ? { ...row, status: "unconfirmed" as const, reason: UNCONFIRMED_REASON }
          : row,
      );
      if (stranded.some((row, n) => row !== batch.rows[n]))
        batch = await this.saveBatch(actor, batch, { rows: stranded });
    }
    for (let i = 0; i < batch.rows.length; i++) {
      let row = batch.rows[i];
      if (row.status !== "pending") continue;
      try {
        validateConfiguration(row);
        const current = await this.current(actor, row);
        const sibling = [...batch.rows.slice(0, i)]
          .reverse()
          .find(
            (previous) =>
              previous.status === "written" &&
              previous.target === row.target &&
              previous.subjectId === row.subjectId,
          );
        const siblingWrite =
          ["vendor_terms", "notifications"].includes(row.target) &&
          sibling &&
          sameValue(current.snapshot, sibling.after) &&
          sameValue(current.value, row.beforeValue);
        if (
          !siblingWrite &&
          (current.stated || !sameValue(current.snapshot, row.before))
        )
          throw new ConflictException(
            "This field changed after the proposal. It was left as it stands.",
          );
        if (siblingWrite) row = { ...row, before: current.snapshot };
        row = { ...row, status: "applying" };
        batch = await this.saveBatch(actor, batch, {
          rows: batch.rows.map((r, n) => (n === i ? row : r)),
        });
        const result = await this.write(actor, row, true);
        const after =
          row.target === "menu_item"
            ? await this.menuSnapshot(actor, result)
            : (await this.current(actor, row)).snapshot;
        row = {
          ...row,
          status: "written",
          reason:
            row.target === "menu_item" &&
            !(result as any)?.items?.[0]?.inventoryItemId
              ? "Menu item recorded; no inventory row was confirmed. Review its identity before relying on stock."
              : null,
          result,
          after,
        };
        try {
          await this.recordFolio(
            actor,
            folioFor(row.target),
            "posted",
            {
              provenance: "proposed_sealed",
              inputProvenance: row.provenance,
              subject: rowKey(row),
              fields: { [row.field]: { from: row.beforeValue, to: row.value } },
              rowId: row.id,
            },
            batch.id,
          );
        } catch {
          row.reason =
            "The setting was written, but its audit receipt could not be recorded.";
        }
      } catch (error) {
        // If the process dies after a writer, the persisted applying row is
        // deliberately not replayed. A reread reports uncertainty, not success.
        row = {
          ...row,
          status: row.status === "applying" ? "unconfirmed" : "refused",
          reason:
            row.status === "applying"
              ? UNCONFIRMED_REASON
              : error instanceof Error
                ? error.message
                : "The setting was refused.",
        };
      }
      batch = await this.saveBatch(actor, batch, {
        rows: batch.rows.map((r, n) => (n === i ? row : r)),
      });
    }
    // Honest header (codex-audit/C2-adopt.md #4): this used to always land on
    // 'applied', even when every row was refused or unconfirmed. The rows
    // already carried that truth; the batch's own status now agrees with them.
    const allWritten = batch.rows.every((row) => row.status === "written");
    return this.saveBatch(actor, batch, {
      status: allWritten ? "applied" : "applied_with_issues",
    });
  }
  private async menuSnapshot(actor: ArrivalActor, result: any) {
    const item = result?.items?.[0];
    if (!item?.menuItemId)
      throw new ServiceUnavailableException(
        "The menu writer returned no item receipt.",
      );
    const menu = await this.checked(
      this.db.client
        .from("menu_items")
        .select("*")
        .eq("restaurant_id", actor.restaurantId)
        .eq("id", item.menuItemId)
        .single(),
    );
    const inventory =
      item.inventoryCreated && item.inventoryItemId
        ? await this.checked(
            this.db.client
              .from("restaurant_inventory")
              .select("*")
              .eq("restaurant_id", actor.restaurantId)
              .eq("id", item.inventoryItemId)
              .single(),
          )
        : null;
    return { menu, inventory };
  }

  async undo(actor: ArrivalActor, id: string, revision: number) {
    await this.manage(actor);
    let batch = await this.batch(actor, id);
    // Same resume as apply() above, and for the same reason: a crash mid-loop
    // used to strand the batch at 'undoing' with no way back. The loop below
    // only ever retries a row still at 'written' (its restore did not
    // succeed), so resuming is exactly retrying what did not finish.
    const resuming = batch.status === "undoing";
    if (!resuming) {
      if (
        // A batch that ended 'applied_with_issues' still has written rows
        // sitting in the house's live settings, and its window is the same
        // seven days — only a clean 'applied' used to qualify, so the one
        // row that DID write could never be undone once any sibling in the
        // same batch was refused or unconfirmed.
        (batch.status !== "applied" && batch.status !== "applied_with_issues") ||
        batch.revision !== revision ||
        !batch.undo_until ||
        Date.parse(batch.undo_until) < Date.now()
      )
        throw new ConflictException(
          "This batch is outside its undo window, changed, or already reversed.",
        );
      batch = await this.saveBatch(actor, batch, { status: "undoing" });
    }
    // Reverse dependent field writes in reverse order. Whole-row comparisons
    // reject newer decisions, including changes to a sibling preference field.
    for (let i = batch.rows.length - 1; i >= 0; i--) {
      let row = batch.rows[i];
      if (row.status !== "written") continue;
      try {
        const args: [string, string, string, string] = [
          actor.restaurantId,
          actor.userId,
          batch.id,
          row.id,
        ];
        const restored =
          row.target === "currency"
            ? await this.currency.restoreArrival(...args)
            : row.target === "cellar"
              ? await this.cellar.restoreArrival(...args)
              : row.target === "vendor_terms"
                ? await this.terms.restoreArrival(...args)
                : row.target === "vendor_currency"
                  ? await this.providers.restoreArrival(...args)
                  : row.target === "notifications"
                    ? await this.notifications.restoreArrival(...args)
                    : row.target === "threshold"
                      ? await this.menus.restoreArrivalThreshold(...args)
                      : await this.menus.restoreArrival(...args);
        row = {
          ...row,
          status: "undone",
          reason: restored.sharedCatalogueRetained
            ? "House menu and unused stock additions reversed. Shared catalogue identities and submission evidence were retained."
            : null,
        };
      } catch (error) {
        row = {
          ...row,
          reason:
            error instanceof Error
              ? error.message
              : "Undo was refused. This entry was left intact.",
        };
      }
      batch = await this.saveBatch(actor, batch, {
        rows: batch.rows.map((r, n) => (n === i ? row : r)),
      });
    }
    // Honest header, same reasoning as apply(): a restore that throws leaves
    // its row at 'written' (reason set, status untouched) rather than
    // 'undone', so checking for a leftover 'written' row is checking for
    // exactly the rows that did not come back.
    const allUndone = batch.rows.every((row) => row.status !== "written");
    return this.saveBatch(actor, batch, {
      status: allUndone ? "undone" : "undone_with_issues",
    });
  }

  /**
   * Mint the proof, at the moment the hold on APPLY begins (ADR 0113).
   *
   * Mirrors `procurement/procurement.service.ts`'s `issueOrderCancelSealChallenge`
   * — the caller checks role and state first, so a seal issued for an act that
   * would be refused anyway never teaches a manager that the seal is decoration.
   */
  async issueApplySeal(actor: ArrivalActor, id: string) {
    await this.manage(actor);
    const batch = await this.batch(actor, id);
    if (batch.status !== "draft" || !batch.rows.some((row) => row.status === "pending"))
      throw new ConflictException(
        "This draft changed or has already been sealed. Read its receipt.",
      );
    if (!this.sealChallenges)
      throw new ServiceUnavailableException(
        "The seal could not be issued (the seal service is not wired in), so nothing can be approved with it.",
      );
    return this.sealChallenges.issue({
      restaurantId: actor.restaurantId,
      actorUserId: actor.userId,
      subjectKind: "configuration_batch",
      subjectId: batch.id,
      action: ARRIVAL_APPLY_ACT,
      args: arrivalSealArgs(batch),
    });
  }
}
