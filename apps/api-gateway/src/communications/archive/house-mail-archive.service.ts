import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { DatabaseService } from "../../database/database.service";
import { IntegrationsOauthService } from "../../integrations/integrations-oauth.service";
import {
  JURISDICTION_RULES,
  resolveJurisdiction,
  type JurisdictionCode,
} from "../retention/retention-rules";
import { DriveArchiveWriter } from "./drive-archive.writer";
import type { HouseMailArchivePort } from "./house-mail-archive.port";
import {
  ARCHIVE_DISCLOSURE_COPY,
  ARCHIVE_DRIVE_INTEGRATION_ID,
  ARCHIVE_FORMAT_VERSION,
  ARCHIVE_LAYOUT_DESCRIPTION,
  ARCHIVE_PAID_TIER_REFUSAL,
  ARCHIVE_ROOT_FOLDER_NAME,
  archiveMonth,
  archiveSegment,
  type HouseMailArchiveMode,
  type HouseMailExportDestination,
} from "./house-mail-archive.constants";

/**
 * The house's own archive of its mail (ADR 0118 D16, founder 2026-09-05).
 *
 * WHAT THIS IS FOR
 * ----------------
 * ADR 0118 D12-D15 gave a mirrored vendor reply a WINDOW and a TOMBSTONE and
 * gave the house nothing to keep. Asked what a Turkish house does about TTK 6102
 * Art. 82's ten-year duty on RECEIVED commercial letters, the founder's answer
 * was to offer the house two ways to keep its own copy, and to keep offering
 * neither by default:
 *
 *   own_cloud        export to the house's own Drive through the grant it
 *                    already holds, then Mudavym keeps only the facts.
 *   mudavym_archive  Mudavym keeps it past the window, and bills. GATED on
 *                    OD-23 - see `arm` and `runExport`, which REFUSE in words.
 *   none             the window applies as today, stated rather than defaulted.
 *
 * HOW IT WAS DONE BEFORE THIS FILE, MEASURED
 * ------------------------------------------
 * The raw mail sits in `procurement_conversations.message_text`, `.content` and
 * `.email_headers` (written by `rabbitmq-bridge.service.ts:740-768`) and the
 * attachment bytes in the private `vendor-attachments` bucket on Mudavym's own
 * Supabase (`:855-898`). NOTHING exported it. `grep -rn "drive/v3"` over
 * `apps/api-gateway/src` and `services/` returned no matches on 2026-09-05: the
 * `google_drive` grant existed and no code had ever called Drive. The house's
 * only copy outside Mudavym was the message still sitting in the mailbox it was
 * read from.
 *
 * THE ONE RULE THAT MAKES THE DELETION SURVIVABLE
 * ----------------------------------------------
 * `exportedAmong` is read BY THE RETENTION SWEEP. With an armed archive, a
 * conversation with no `status = 'exported'` row is NOT tombstoned - it is held
 * back, counted, and said in words. An export the sweep does not read would be a
 * promise; an export row the sweep must find is a mechanism.
 *
 * AND THE ONE PLACE THAT RULE DOES NOT HOLD, STATED RATHER THAN HIDDEN
 * -------------------------------------------------------------------
 * A REVOCATION still deletes. D15 is the founder's own answer - "stop reads and
 * delete the raw mail" - and it is about a person withdrawing consent to a copy
 * of their mailbox. Blocking that deletion on a failed export would leave a
 * person's mail inside Mudavym after they revoked, which is the exact thing D15
 * forbids. So a revocation runs one last export first, records every failure per
 * conversation, and deletes anyway. That tension is real and it is written into
 * ADR 0118 D16 as a founder question rather than resolved quietly here.
 */

const EXPORT_BATCH_CEILING = 200;

/** The one destination this build writes to. B has a row shape and no writer. */
const OWN_CLOUD_DESTINATION: HouseMailExportDestination =
  "own_cloud_google_drive";

export interface ArchiveSettings {
  restaurantId: string;
  mode: HouseMailArchiveMode;
  /**
   * FALSE means no row exists: nobody has been asked. `mode` reads `none` for
   * such a house because that is what happens to its mail, and `chosen`
   * separates "we asked and they said no" from "we never asked", which are
   * different facts about the same restaurant.
   */
  chosen: boolean;
  armed: boolean;
  armedAt: string | null;
  refusedBecause: string | null;
  chosenBy: string | null;
  chosenAt: string | null;
  connectionId: string | null;
  driveFolderId: string | null;
  driveFolderPath: string | null;
  price: {
    minorUnits: number | null;
    currency: string | null;
    unit: string | null;
    decision: string | null;
  };
  /** What is true of this house's archive right now, in words. */
  says: string;
}

export interface ArchiveExportOutcome {
  conversationId: string;
  status: "exported" | "failed";
  driveFileId: string | null;
  filePath: string | null;
  contentSha256: string | null;
  bytes: number | null;
  attachmentsConsidered: number;
  attachmentsExported: number;
  failureReason: string | null;
}

export interface ArchiveExportRun {
  restaurantId: string;
  trigger: "scheduled" | "requested" | "revocation";
  mode: HouseMailArchiveMode;
  armed: boolean;
  considered: number;
  exported: number;
  failed: number;
  outcomes: ArchiveExportOutcome[];
  error: string | null;
  /** What happened, in words. Never a bare boolean, never a silent skip. */
  says: string;
}

interface ConversationRow {
  id: string;
  order_id: string | null;
  provider_id: string | null;
  direction: string | null;
  channel: string | null;
  message_text: string | null;
  content: string | null;
  email_headers: unknown;
  received_at: string | null;
  created_at: string | null;
  gmail_message_id: string | null;
  gmail_thread_id: string | null;
  message_id: string | null;
  mirrored_by_grant_id: string | null;
}

@Injectable()
export class HouseMailArchiveService implements HouseMailArchivePort {
  private readonly logger = new Logger(HouseMailArchiveService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly oauth: IntegrationsOauthService,
    private readonly drive: DriveArchiveWriter,
  ) {}

  // =========================================================================
  // THE CHOICE
  // =========================================================================

  /**
   * What this house chose, or the honest answer that nobody asked it.
   *
   * A FAILED READ IS NEVER "NO ARCHIVE". supabase-js resolves `{ data, error }`
   * and never throws, so a swallowed error here would turn a database outage
   * into "this house keeps nothing" and let the sweep delete mail the house had
   * asked to keep. This throws instead.
   */
  async settingsFor(restaurantId: string): Promise<ArchiveSettings> {
    const { data, error } = await this.db.supabase
      .from("house_mail_archive_settings")
      .select(
        "restaurant_id, mode, chosen_by, chosen_at, armed_at, refused_because, connection_id, drive_folder_id, drive_folder_path, price_minor_units, price_currency, price_unit, price_decision",
      )
      .eq("restaurant_id", restaurantId)
      .limit(1);
    if (error) {
      throw new ServiceUnavailableException(
        `This restaurant's mail-archive setting could not be read, and the sweep must not delete mail on the strength of a failed read: ${error.message}`,
      );
    }

    const row = data?.[0] ?? null;
    if (!row) {
      return {
        restaurantId,
        mode: "none",
        chosen: false,
        armed: false,
        armedAt: null,
        refusedBecause: null,
        chosenBy: null,
        chosenAt: null,
        connectionId: null,
        driveFolderId: null,
        driveFolderPath: null,
        price: {
          minorUnits: null,
          currency: null,
          unit: null,
          decision: null,
        },
        says: ARCHIVE_DISCLOSURE_COPY.neverAsked,
      };
    }

    const mode = String(row.mode) as HouseMailArchiveMode;
    const armedAt = (row.armed_at as string | null) ?? null;
    const armed = armedAt !== null;
    const refusedBecause = (row.refused_because as string | null) ?? null;

    return {
      restaurantId,
      mode,
      chosen: true,
      armed,
      armedAt,
      refusedBecause,
      chosenBy: (row.chosen_by as string | null) ?? null,
      chosenAt: (row.chosen_at as string | null) ?? null,
      connectionId: (row.connection_id as string | null) ?? null,
      driveFolderId: (row.drive_folder_id as string | null) ?? null,
      driveFolderPath: (row.drive_folder_path as string | null) ?? null,
      price: {
        minorUnits: (row.price_minor_units as number | null) ?? null,
        currency: (row.price_currency as string | null) ?? null,
        unit: (row.price_unit as string | null) ?? null,
        decision: (row.price_decision as string | null) ?? null,
      },
      says: this.saysFor(mode, armed, refusedBecause, {
        connectionId: (row.connection_id as string | null) ?? null,
        driveFolderPath: (row.drive_folder_path as string | null) ?? null,
      }),
    };
  }

  private saysFor(
    mode: HouseMailArchiveMode,
    armed: boolean,
    refusedBecause: string | null,
    where: { connectionId: string | null; driveFolderPath: string | null },
  ): string {
    if (mode === "none") {
      return "This restaurant chose to keep no copy of the mail itself. The window applies: a mirrored reply's body, headers and attachments are deleted when it runs out, and the order's own facts stay on this restaurant's record.";
    }
    if (mode === "mudavym_archive") {
      return armed
        ? "Mudavym keeps this restaurant's mirrored mail past the window, on the billed tier."
        : (refusedBecause ?? ARCHIVE_PAID_TIER_REFUSAL);
    }
    if (!armed) {
      return (
        refusedBecause ??
        "This restaurant chose to export its mail to its own cloud and the export is NOT running. Nothing is being written out, and the window still applies."
      );
    }
    if (!where.connectionId) {
      return `The export to this restaurant's own cloud is armed and the Drive grant it was armed with no longer exists, so nothing can be written. Every reply due for export is recorded as a failure naming this, and the retention sweep is holding those replies rather than deleting them. Reconnect Google Drive and choose the archive again. Files already written to ${where.driveFolderPath ?? "the archive folder"} are the restaurant's own and are untouched.`;
    }
    return `Every mirrored reply is exported to this restaurant's own Google Drive, into ${where.driveFolderPath ?? ARCHIVE_ROOT_FOLDER_NAME}, and read back and checked before Mudavym deletes its copy. ${ARCHIVE_LAYOUT_DESCRIPTION}`;
  }

  /**
   * Record a house's choice, and arm it when arming is possible.
   *
   * THE THREE PATHS, AND WHY ONLY ONE OF THEM ARMS TODAY.
   *
   *   none             armed immediately: doing nothing IS what it means, and
   *                    it is already in force.
   *   own_cloud        armed after the folder is actually resolved in the
   *                    house's Drive. NOT before: arming on the strength of an
   *                    intention would make the sweep hold mail for an export
   *                    that has nowhere to go.
   *   mudavym_archive  RECORDED, NEVER ARMED. OD-23 (who pays, and how much) is
   *                    open, and `house_mail_archive_settings_paid_tier_arms_
   *                    only_with_a_price` refuses the row in the database as
   *                    well, so this is not one `if` standing between a house
   *                    and a free tier.
   */
  async choose(params: {
    restaurantId: string;
    actorUserId: string;
    mode: HouseMailArchiveMode;
    sealId: string;
    /** own_cloud only: whose Drive grant carries it. */
    connectionId?: string | null;
  }): Promise<ArchiveSettings> {
    const now = new Date().toISOString();

    if (params.mode === "mudavym_archive") {
      // The refusal is a WRITE, not an exception: the house asked for the paid
      // archive and that ask is recorded, so the founder can see who wants it
      // when OD-23 is answered. What is refused is the ARMING.
      await this.upsertSettings({
        restaurantId: params.restaurantId,
        mode: "mudavym_archive",
        chosenBy: params.actorUserId,
        chosenAt: now,
        chosenSealId: params.sealId,
        armedAt: null,
        refusedBecause: ARCHIVE_PAID_TIER_REFUSAL,
        connectionId: null,
        driveFolderId: null,
        driveFolderPath: null,
      });
      return this.settingsFor(params.restaurantId);
    }

    if (params.mode === "none") {
      await this.upsertSettings({
        restaurantId: params.restaurantId,
        mode: "none",
        chosenBy: params.actorUserId,
        chosenAt: now,
        chosenSealId: params.sealId,
        armedAt: now,
        refusedBecause: null,
        connectionId: null,
        driveFolderId: null,
        driveFolderPath: null,
      });
      return this.settingsFor(params.restaurantId);
    }

    // own_cloud.
    const connectionId = params.connectionId ?? null;
    if (!connectionId) {
      throw new BadRequestException(
        "Exporting to this restaurant's own cloud needs the Google Drive connection it writes through, and none was named. Connect Google Drive on /connections first.",
      );
    }

    const grant = await this.driveGrant(params.restaurantId, connectionId);
    const house = await this.houseName(params.restaurantId);

    let folderId: string;
    let folderPath: string;
    try {
      const token = await this.oauth.getAccessToken(
        grant.userId,
        params.restaurantId,
        ARCHIVE_DRIVE_INTEGRATION_ID,
      );
      const segments = [
        ARCHIVE_ROOT_FOLDER_NAME,
        `${archiveSegment(house)} (${params.restaurantId})`,
      ];
      const folder = await this.drive.ensureFolderPath(token, segments);
      folderId = folder.id;
      folderPath = segments.join("/");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Recorded, unarmed, with the reason. NOT thrown away and NOT armed: an
      // armed archive whose folder was never created would make the sweep hold
      // mail forever waiting for an export that cannot run.
      await this.upsertSettings({
        restaurantId: params.restaurantId,
        mode: "own_cloud",
        chosenBy: params.actorUserId,
        chosenAt: now,
        chosenSealId: params.sealId,
        armedAt: null,
        refusedBecause: `The archive folder could not be created in this restaurant's Google Drive, so the export is recorded and NOT armed - nothing is being written out and the window still applies. ${message}`,
        connectionId,
        driveFolderId: null,
        driveFolderPath: null,
      });
      return this.settingsFor(params.restaurantId);
    }

    await this.upsertSettings({
      restaurantId: params.restaurantId,
      mode: "own_cloud",
      chosenBy: params.actorUserId,
      chosenAt: now,
      chosenSealId: params.sealId,
      armedAt: now,
      refusedBecause: null,
      connectionId,
      driveFolderId: folderId,
      driveFolderPath: folderPath,
    });
    return this.settingsFor(params.restaurantId);
  }

  /** Explicit keys on every write; no conditional spread (the capture rule). */
  private async upsertSettings(row: {
    restaurantId: string;
    mode: HouseMailArchiveMode;
    chosenBy: string;
    chosenAt: string;
    chosenSealId: string;
    armedAt: string | null;
    refusedBecause: string | null;
    connectionId: string | null;
    driveFolderId: string | null;
    driveFolderPath: string | null;
  }): Promise<void> {
    const { error } = await this.db.supabase
      .from("house_mail_archive_settings")
      .upsert(
        {
          restaurant_id: row.restaurantId,
          mode: row.mode,
          chosen_by: row.chosenBy,
          chosen_at: row.chosenAt,
          chosen_seal_id: row.chosenSealId,
          armed_at: row.armedAt,
          refused_because: row.refusedBecause,
          connection_id: row.connectionId,
          drive_folder_id: row.driveFolderId,
          drive_folder_path: row.driveFolderPath,
          price_minor_units: null,
          price_currency: null,
          price_unit: null,
          price_decision: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "restaurant_id" },
      );
    if (error) {
      throw new ServiceUnavailableException(
        `This restaurant's archive choice was NOT recorded, so nothing changed: ${error.message}`,
      );
    }
  }

  // =========================================================================
  // THE EXPORT
  // =========================================================================

  /**
   * Export this house's mirrored mail to its archive.
   *
   * A COUNT IS RECORDED ON EVERY PATH OUT, including the paths that exported
   * nothing and the paths that could not run at all (ADR 0078). A table holding
   * only the runs that exported something would make every success rate over it
   * 1.0 by construction.
   */
  async runExport(params: {
    restaurantId: string;
    trigger: "scheduled" | "requested" | "revocation";
    sealId?: string | null;
    /** Narrow the run to these conversations. Empty/absent means everything. */
    conversationIds?: string[];
  }): Promise<ArchiveExportRun> {
    const settings = await this.settingsFor(params.restaurantId);

    if (settings.mode === "mudavym_archive") {
      return this.recordRun({
        restaurantId: params.restaurantId,
        trigger: params.trigger,
        mode: settings.mode,
        armed: settings.armed,
        connectionId: null,
        sealId: params.sealId ?? null,
        considered: 0,
        exported: 0,
        failed: 0,
        outcomes: [],
        error: ARCHIVE_PAID_TIER_REFUSAL,
        says: `Nothing was exported: ${ARCHIVE_PAID_TIER_REFUSAL}`,
      });
    }

    if (settings.mode === "none" || !settings.armed) {
      return this.recordRun({
        restaurantId: params.restaurantId,
        trigger: params.trigger,
        mode: settings.mode,
        armed: settings.armed,
        connectionId: settings.connectionId,
        sealId: params.sealId ?? null,
        considered: 0,
        exported: 0,
        failed: 0,
        outcomes: [],
        error: null,
        says: `Nothing was exported, and that is the correct outcome rather than a skipped run: ${settings.says}`,
      });
    }

    // own_cloud, armed.
    if (!settings.connectionId || !settings.driveFolderId) {
      const reason = settings.says;
      return this.recordRun({
        restaurantId: params.restaurantId,
        trigger: params.trigger,
        mode: settings.mode,
        armed: true,
        connectionId: settings.connectionId,
        sealId: params.sealId ?? null,
        considered: 0,
        exported: 0,
        failed: 0,
        outcomes: [],
        error: reason,
        says: `The export could not run: ${reason}`,
      });
    }

    const grant = await this.driveGrant(
      params.restaurantId,
      settings.connectionId,
    );
    const conversations = await this.conversationsDue(
      params.restaurantId,
      params.conversationIds ?? null,
    );

    if (!conversations.length) {
      return this.recordRun({
        restaurantId: params.restaurantId,
        trigger: params.trigger,
        mode: settings.mode,
        armed: true,
        connectionId: settings.connectionId,
        sealId: params.sealId ?? null,
        considered: 0,
        exported: 0,
        failed: 0,
        outcomes: [],
        error: null,
        says: "No mirrored reply is waiting to be exported: every one this restaurant holds already has a verified copy in its own Drive. The run happened and found nothing, which is not the same as the run not happening.",
      });
    }

    let token: string;
    try {
      token = await this.oauth.getAccessToken(
        grant.userId,
        params.restaurantId,
        ARCHIVE_DRIVE_INTEGRATION_ID,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Every conversation gets its own failure row: a person asking "why is
      // this reply still here" gets the answer on the reply, not only on a run.
      const outcomes = await this.recordFailures(
        params.restaurantId,
        conversations,
        `The Google Drive grant could not be used, so nothing was written: ${message}`,
        settings,
      );
      return this.recordRun({
        restaurantId: params.restaurantId,
        trigger: params.trigger,
        mode: settings.mode,
        armed: true,
        connectionId: settings.connectionId,
        sealId: params.sealId ?? null,
        considered: conversations.length,
        exported: 0,
        failed: outcomes.length,
        outcomes,
        error: message,
        says: `${conversations.length} mirrored repl${conversations.length === 1 ? "y" : "ies"} could NOT be exported because the Google Drive grant could not be used: ${message} Each one is recorded as a failed export, and the retention sweep will hold them rather than delete them.`,
      });
    }

    const jurisdiction = await this.jurisdictionFor(params.restaurantId);
    const windowDays = await this.windowDaysFor(params.restaurantId);
    const outcomes: ArchiveExportOutcome[] = [];

    for (const conversation of conversations) {
      outcomes.push(
        await this.exportOne({
          token,
          restaurantId: params.restaurantId,
          conversation,
          rootFolderId: settings.driveFolderId,
          folderPath: settings.driveFolderPath ?? ARCHIVE_ROOT_FOLDER_NAME,
          connectionId: settings.connectionId,
          jurisdiction,
          windowDays,
        }),
      );
    }

    const exported = outcomes.filter((o) => o.status === "exported").length;
    const failed = outcomes.length - exported;

    return this.recordRun({
      restaurantId: params.restaurantId,
      trigger: params.trigger,
      mode: settings.mode,
      armed: true,
      connectionId: settings.connectionId,
      sealId: params.sealId ?? null,
      considered: conversations.length,
      exported,
      failed,
      outcomes,
      error: null,
      says: `${conversations.length} mirrored repl${conversations.length === 1 ? "y" : "ies"} were looked at; ${exported} were written into this restaurant's own Drive and read back with a matching hash, and ${failed} failed with a reason recorded against ${failed === 1 ? "it" : "each of them"}. Only the ${exported} verified ${exported === 1 ? "copy is" : "copies are"} eligible for the retention sweep to delete.`,
    });
  }

  /**
   * One conversation, one file, one hash, one read-back.
   *
   * NEVER THROWS. A failure here is a recorded row with a reason, because the
   * run must reach the next conversation and because a conversation that could
   * not be exported must be visible as a FAILURE rather than as absence.
   */
  private async exportOne(params: {
    token: string;
    restaurantId: string;
    conversation: ConversationRow;
    rootFolderId: string;
    folderPath: string;
    connectionId: string;
    jurisdiction: JurisdictionCode;
    windowDays: number | null;
  }): Promise<ArchiveExportOutcome> {
    const c = params.conversation;
    const base: ArchiveExportOutcome = {
      conversationId: c.id,
      status: "failed",
      driveFileId: null,
      filePath: null,
      contentSha256: null,
      bytes: null,
      attachmentsConsidered: 0,
      attachmentsExported: 0,
      failureReason: null,
    };

    try {
      const vendor = await this.vendorName(c.provider_id);
      const month = archiveMonth(c.received_at ?? c.created_at);
      const folder = await this.drive.ensureFolderPath(
        params.token,
        [archiveSegment(vendor), month],
        params.rootFolderId,
      );

      const attachments = await this.attachmentsFor(c.id);
      base.attachmentsConsidered = attachments.considered;
      base.attachmentsExported = attachments.exported.length;

      const document = JSON.stringify(
        {
          mudavymArchiveFormat: ARCHIVE_FORMAT_VERSION,
          layout: ARCHIVE_LAYOUT_DESCRIPTION,
          conversationId: c.id,
          restaurantId: params.restaurantId,
          orderId: c.order_id,
          providerId: c.provider_id,
          vendor,
          direction: c.direction,
          channel: c.channel,
          receivedAt: c.received_at,
          createdAt: c.created_at,
          gmailMessageId: c.gmail_message_id,
          gmailThreadId: c.gmail_thread_id,
          messageId: c.message_id,
          mirroredByGrantId: c.mirrored_by_grant_id,
          // The raw mail, verbatim. This document IS the house's copy, so
          // nothing here is normalised, trimmed or re-encoded.
          messageText: c.message_text,
          content: c.content,
          emailHeaders: c.email_headers,
          attachments: attachments.exported,
          attachmentsMissing: attachments.missing,
          retention: {
            jurisdiction: params.jurisdiction,
            factsFloorYears:
              JURISDICTION_RULES[params.jurisdiction].factsFloorYears,
            rawMailWindowDays: params.windowDays,
            note: "This file is the restaurant's own copy of a vendor's reply, written before Mudavym deleted its mirror. Mudavym cannot read, change or delete it.",
          },
          exportedAt: new Date().toISOString(),
        },
        null,
        2,
      );

      const expected = createHash("sha256").update(document, "utf8").digest("hex");
      const name = `${c.id}.json`;
      const uploaded = await this.drive.uploadJson(params.token, {
        name,
        parentId: folder.id,
        body: document,
      });

      const readBack = await this.drive.readBack(params.token, uploaded.id);
      const actual = createHash("sha256").update(readBack, "utf8").digest("hex");
      if (actual !== expected) {
        return this.recordExport(params.restaurantId, params.connectionId, {
          ...base,
          status: "failed",
          failureReason: `The file was uploaded and what came back does not match what was sent (expected sha256 ${expected}, read back ${actual}), so this reply has NOT been archived and Mudavym's copy will not be deleted. A 200 from the provider is its claim; the hash is the evidence.`,
        }, params.jurisdiction, params.windowDays);
      }

      const filePath = `${params.folderPath}/${archiveSegment(vendor)}/${month}/${name}`;
      return this.recordExport(params.restaurantId, params.connectionId, {
        ...base,
        status: "exported",
        driveFileId: uploaded.id,
        filePath,
        contentSha256: expected,
        bytes: uploaded.size ?? Buffer.byteLength(document, "utf8"),
        failureReason: null,
      }, params.jurisdiction, params.windowDays);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.recordExport(params.restaurantId, params.connectionId, {
        ...base,
        status: "failed",
        failureReason: message,
      }, params.jurisdiction, params.windowDays);
    }
  }

  private async recordExport(
    restaurantId: string,
    connectionId: string | null,
    outcome: ArchiveExportOutcome,
    jurisdiction: JurisdictionCode,
    windowDays: number | null,
  ): Promise<ArchiveExportOutcome> {
    const { error } = await this.db.supabase.from("house_mail_exports").insert({
      restaurant_id: restaurantId,
      conversation_id: outcome.conversationId,
      destination: OWN_CLOUD_DESTINATION,
      status: outcome.status,
      connection_id: connectionId,
      drive_file_id: outcome.driveFileId,
      file_path: outcome.filePath,
      content_sha256: outcome.contentSha256,
      bytes: outcome.bytes,
      attachments_considered: outcome.attachmentsConsidered,
      attachments_exported: outcome.attachmentsExported,
      jurisdiction,
      window_days: windowDays,
      failure_reason: outcome.failureReason,
    });

    if (error) {
      // The file may well be in the house's Drive. What did not happen is the
      // RECORD of it, and the sweep reads the record — so this run must report
      // the conversation as NOT exported, or the sweep would delete Mudavym's
      // copy on the strength of a row nobody can find.
      this.logger.error(
        `The export of ${outcome.conversationId} was not recorded: ${error.message}`,
      );
      return {
        ...outcome,
        status: "failed",
        failureReason: `The file may have reached this restaurant's Drive, but the record of it was NOT written (${error.message}). This reply counts as not exported, and Mudavym's copy will not be deleted, because the retention sweep reads the record and not the Drive.`,
      };
    }
    return outcome;
  }

  private async recordFailures(
    restaurantId: string,
    conversations: ConversationRow[],
    reason: string,
    settings: ArchiveSettings,
  ): Promise<ArchiveExportOutcome[]> {
    const jurisdiction = await this.jurisdictionFor(restaurantId);
    const windowDays = await this.windowDaysFor(restaurantId);
    const out: ArchiveExportOutcome[] = [];
    for (const c of conversations) {
      out.push(
        await this.recordExport(
          restaurantId,
          settings.connectionId,
          {
            conversationId: c.id,
            status: "failed",
            driveFileId: null,
            filePath: null,
            contentSha256: null,
            bytes: null,
            attachmentsConsidered: 0,
            attachmentsExported: 0,
            failureReason: reason,
          },
          jurisdiction,
          windowDays,
        ),
      );
    }
    return out;
  }

  // =========================================================================
  // WHAT THE SWEEP READS
  // =========================================================================

  /**
   * Which of these conversations have a VERIFIED copy in the house's archive.
   *
   * THE RETENTION SWEEP'S PRECONDITION. It throws rather than returning an
   * empty set on a read failure, because an empty set here means "none of them
   * are exported", which would make the sweep hold everything — safe — while a
   * FULL set read from a failed query would make it delete everything. The
   * direction of the lie matters, so the read is not allowed to lie at all.
   */
  async exportedAmong(
    conversationIds: string[],
    destination: HouseMailExportDestination = "own_cloud_google_drive",
  ): Promise<Set<string>> {
    if (!conversationIds.length) return new Set<string>();

    const { data, error } = await this.db.supabase
      .from("house_mail_exports")
      .select("conversation_id")
      .eq("destination", destination)
      .eq("status", "exported")
      .in("conversation_id", conversationIds);
    if (error) {
      throw new ServiceUnavailableException(
        `The archive's export records could not be read, so no mail can be deleted: a sweep that cannot tell which replies were exported must not guess. ${error.message}`,
      );
    }
    return new Set(
      (data ?? [])
        .map((r) => (r.conversation_id as string | null) ?? null)
        .filter((id): id is string => Boolean(id)),
    );
  }

  // =========================================================================
  // THE DISCLOSURE THE CONSENT SCREEN READS
  // =========================================================================

  /**
   * What a person is told about the archive BEFORE they grant a mailbox.
   *
   * Composed here and printed verbatim on the page, for the reason
   * `retention.controller.ts` already gives: a page that writes its own privacy
   * sentence is right on the day it is written and silently wrong afterwards.
   */
  async disclosureFor(
    restaurantId: string,
    jurisdiction: JurisdictionCode,
  ): Promise<{
    mode: HouseMailArchiveMode;
    chosen: boolean;
    armed: boolean;
    says: string;
    intro: string;
    options: { ownCloud: string; mudavym: string; none: string };
    paidTierRefusal: string | null;
    jurisdictionNote: string | null;
    layout: string;
  }> {
    const settings = await this.settingsFor(restaurantId);
    const bindsCorrespondence =
      JURISDICTION_RULES[jurisdiction].bindsCorrespondence;

    return {
      mode: settings.mode,
      chosen: settings.chosen,
      armed: settings.armed,
      says: settings.says,
      intro: ARCHIVE_DISCLOSURE_COPY.intro,
      options: {
        ownCloud: ARCHIVE_DISCLOSURE_COPY.ownCloudOffer,
        mudavym: ARCHIVE_DISCLOSURE_COPY.mudavymOffer,
        none: ARCHIVE_DISCLOSURE_COPY.noneOffer,
      },
      // Non-null on every deployment until OD-23 is answered. The consent
      // screen prints it under the Mudavym option so nobody chooses a tier
      // believing it is running.
      paidTierRefusal: ARCHIVE_PAID_TIER_REFUSAL,
      // Only where the statute reaches the correspondence itself — TR and the
      // UNKNOWN row that inherits it (ADR 0118 D14). A GB or US house is not
      // told a Turkish sentence, and a TR house is never told that Mudavym
      // satisfies a duty it does not satisfy.
      jurisdictionNote: bindsCorrespondence
        ? settings.armed
          ? ARCHIVE_DISCLOSURE_COPY.turkiyeWithArchive
          : ARCHIVE_DISCLOSURE_COPY.turkiyeWithoutArchive
        : null,
      layout: ARCHIVE_LAYOUT_DESCRIPTION,
    };
  }

  // =========================================================================
  // SHARED READS
  // =========================================================================

  /** Houses with a recorded archive setting. The scheduled export's population. */
  async housesWithAnArchive(): Promise<string[]> {
    const { data, error } = await this.db.supabase
      .from("house_mail_archive_settings")
      .select("restaurant_id")
      .not("armed_at", "is", null)
      .eq("mode", "own_cloud");
    if (error) {
      throw new ServiceUnavailableException(
        `The houses with an armed archive could not be enumerated, so no export can run: ${error.message}`,
      );
    }
    return (data ?? [])
      .map((r) => (r.restaurant_id as string | null) ?? null)
      .filter((id): id is string => Boolean(id));
  }

  /**
   * The mirrored replies still holding raw mail with no verified export.
   *
   * Bounded at `EXPORT_BATCH_CEILING` per run, and the bound is REPORTED rather
   * than hidden: the caller's `considered` is what this returned, so a run that
   * hit the ceiling says it looked at 200 and the next run picks up the rest.
   */
  private async conversationsDue(
    restaurantId: string,
    only: string[] | null,
  ): Promise<ConversationRow[]> {
    let query = this.db.supabase
      .from("procurement_conversations")
      .select(
        "id, order_id, provider_id, direction, channel, message_text, content, email_headers, received_at, created_at, gmail_message_id, gmail_thread_id, message_id, mirrored_by_grant_id",
      )
      .eq("restaurant_id", restaurantId)
      .not("mirrored_by_grant_id", "is", null)
      .is("raw_deleted_at", null)
      .order("received_at", { ascending: true })
      .limit(EXPORT_BATCH_CEILING);
    if (only?.length) query = query.in("id", only);

    const { data, error } = await query;
    if (error) {
      throw new ServiceUnavailableException(
        `This restaurant's mirrored replies could not be read, so nothing can be exported: ${error.message}`,
      );
    }

    const rows = (data ?? []) as unknown as ConversationRow[];
    const already = await this.exportedAmong(rows.map((r) => String(r.id)));
    return rows.filter((r) => !already.has(String(r.id)));
  }

  /**
   * The attachment bytes, out of the private `vendor-attachments` bucket.
   *
   * A MISSING OBJECT IS NAMED, NOT DROPPED. `missing` travels into the exported
   * document and `attachments_exported < attachments_considered` on the row, so
   * a short copy is legible as a short copy. Silently exporting three of four
   * attachments and calling it done is the fault this repo names.
   */
  private async attachmentsFor(conversationId: string): Promise<{
    considered: number;
    exported: Array<{
      filename: string;
      mimeType: string | null;
      sizeBytes: number | null;
      sha256: string | null;
      base64: string;
    }>;
    missing: Array<{ filename: string; storagePath: string; why: string }>;
  }> {
    const { data, error } = await this.db.supabase
      .from("conversation_attachments")
      .select("id, filename, mime_type, size_bytes, storage_path, sha256")
      .eq("conversation_id", conversationId)
      .is("bytes_deleted_at", null);
    if (error) {
      throw new Error(
        `The attachments of this reply could not be read, so the export would have been short without saying so: ${error.message}`,
      );
    }

    const rows = data ?? [];
    const exported: Array<{
      filename: string;
      mimeType: string | null;
      sizeBytes: number | null;
      sha256: string | null;
      base64: string;
    }> = [];
    const missing: Array<{
      filename: string;
      storagePath: string;
      why: string;
    }> = [];

    for (const row of rows) {
      const path = (row.storage_path as string | null) ?? "";
      const filename = (row.filename as string | null) ?? "attachment";
      if (!path) {
        missing.push({
          filename,
          storagePath: "",
          why: "The row names no object path, so there are no bytes to export.",
        });
        continue;
      }
      const { data: blob, error: downloadError } =
        await this.db.supabase.storage.from("vendor-attachments").download(path);
      if (downloadError || !blob) {
        missing.push({
          filename,
          storagePath: path,
          why: `The object could not be read out of the vendor-attachments bucket: ${downloadError?.message ?? "no bytes were returned"}`,
        });
        continue;
      }
      const buffer = Buffer.from(await blob.arrayBuffer());
      exported.push({
        filename,
        mimeType: (row.mime_type as string | null) ?? null,
        sizeBytes: (row.size_bytes as number | null) ?? buffer.length,
        sha256: (row.sha256 as string | null) ?? null,
        base64: buffer.toString("base64"),
      });
    }

    return { considered: rows.length, exported, missing };
  }

  private async driveGrant(
    restaurantId: string,
    connectionId: string,
  ): Promise<{ id: string; userId: string }> {
    const { data, error } = await this.db.supabase
      .from("integration_oauth_connections")
      .select("id, user_id, restaurant_id, integration_id, revoked_at")
      .eq("id", connectionId)
      .limit(1);
    if (error) {
      throw new ServiceUnavailableException(
        `The Google Drive grant could not be read, so nothing can be exported: ${error.message}`,
      );
    }
    const row = data?.[0] ?? null;
    if (!row) {
      throw new NotFoundException(
        "That Google Drive connection does not exist, so there is nowhere to export to.",
      );
    }
    if (String(row.integration_id) !== ARCHIVE_DRIVE_INTEGRATION_ID) {
      throw new BadRequestException(
        `That connection is a ${String(row.integration_id)} grant, not Google Drive. The archive writes through the Drive grant and nothing else.`,
      );
    }
    if (row.revoked_at) {
      throw new BadRequestException(
        "That Google Drive connection has been disconnected, so nothing can be written to it. Connect Drive again on /connections.",
      );
    }
    if (
      row.restaurant_id &&
      String(row.restaurant_id) !== String(restaurantId)
    ) {
      throw new BadRequestException(
        "That Google Drive connection belongs to another restaurant. A house exports through its own grant.",
      );
    }
    return { id: String(row.id), userId: String(row.user_id) };
  }

  private async houseName(restaurantId: string): Promise<string> {
    const { data, error } = await this.db.supabase
      .from("restaurants")
      .select("id, name")
      .eq("id", restaurantId)
      .limit(1);
    if (error) {
      throw new ServiceUnavailableException(
        `The restaurant could not be read, so its archive folder cannot be named: ${error.message}`,
      );
    }
    const row = data?.[0] ?? null;
    if (!row) {
      throw new NotFoundException(
        `No restaurant with id ${restaurantId}, so there is no house to archive for.`,
      );
    }
    return String(row.name ?? restaurantId);
  }

  private async vendorName(providerId: string | null): Promise<string> {
    if (!providerId) return "unattributed";
    const { data, error } = await this.db.supabase
      .from("providers")
      .select("id, name")
      .eq("id", providerId)
      .limit(1);
    if (error) {
      throw new Error(
        `The vendor could not be read, so this reply's archive folder cannot be named: ${error.message}`,
      );
    }
    const row = data?.[0] ?? null;
    return String(row?.name ?? providerId);
  }

  private async jurisdictionFor(
    restaurantId: string,
  ): Promise<JurisdictionCode> {
    const { data, error } = await this.db.supabase
      .from("restaurants")
      .select("id, country, state_province")
      .eq("id", restaurantId)
      .limit(1);
    if (error) {
      throw new ServiceUnavailableException(
        `The restaurant's country could not be read, so the archived copy cannot name the rule it was made under: ${error.message}`,
      );
    }
    const row = data?.[0] ?? null;
    return resolveJurisdiction(
      (row?.country as string | null) ?? null,
      (row?.state_province as string | null) ?? null,
    );
  }

  private async windowDaysFor(restaurantId: string): Promise<number | null> {
    const { data, error } = await this.db.supabase
      .from("house_mail_retention_windows")
      .select("figure_days")
      .eq("restaurant_id", restaurantId)
      .limit(1);
    if (error) {
      throw new ServiceUnavailableException(
        `The retention window could not be read, so the archived copy cannot state the window it outlived: ${error.message}`,
      );
    }
    return (data?.[0]?.figure_days as number | undefined) ?? null;
  }

  /**
   * Write the count. Called on EVERY path out of an export, including the ones
   * that exported nothing and the ones that refused to run.
   */
  private async recordRun(
    run: ArchiveExportRun & {
      connectionId: string | null;
      sealId: string | null;
    },
  ): Promise<ArchiveExportRun> {
    const { error } = await this.db.supabase
      .from("house_mail_export_runs")
      .insert({
        restaurant_id: run.restaurantId,
        trigger: run.trigger,
        mode: run.mode,
        armed: run.armed,
        connection_id: run.connectionId,
        seal_id: run.sealId,
        considered: run.considered,
        exported: run.exported,
        failed: run.failed,
        says: run.says,
        error: run.error,
      });

    if (error) {
      // The export itself may well have written files. Losing the count does
      // not undo that, so this is carried back in `says` rather than thrown: a
      // throw here would make a successful export look like a failed one.
      this.logger.error(
        `The archive export run for ${run.restaurantId} could not be recorded: ${error.message}`,
      );
      return {
        restaurantId: run.restaurantId,
        trigger: run.trigger,
        mode: run.mode,
        armed: run.armed,
        considered: run.considered,
        exported: run.exported,
        failed: run.failed,
        outcomes: run.outcomes,
        error: run.error,
        says: `${run.says} The count itself could not be written (${error.message}), so this run is missing from house_mail_export_runs.`,
      };
    }

    return {
      restaurantId: run.restaurantId,
      trigger: run.trigger,
      mode: run.mode,
      armed: run.armed,
      considered: run.considered,
      exported: run.exported,
      failed: run.failed,
      outcomes: run.outcomes,
      error: run.error,
      says: run.says,
    };
  }
}
