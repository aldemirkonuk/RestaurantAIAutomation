import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DatabaseService } from "../../database/database.service";
import {
  likeExactly,
  senderDomain,
} from "../../communications/inbound-headers";
import {
  findSenderVendor,
  type SenderVendor,
} from "../../communications/sender-vendor";

/** A persisted attachment reference stored on a prospect (bytes live in Storage). */
export interface ProspectAttachmentRef {
  filename: string;
  mime_type: string | null;
  size_bytes: number;
  storage_path: string;
  sha256: string;
}

/**
 * Attribution outcome for a cold email.
 * - `attributed`: we know the restaurant (DEFAULT_RESTAURANT_ID or the sole restaurant).
 * - `ambiguous`: >1 restaurant and no default — cannot attribute; route to triage (never leak).
 * - `none`: no restaurants exist at all — nothing to attribute to.
 */
type Attribution =
  | { kind: "attributed"; id: string }
  | { kind: "ambiguous" }
  | { kind: "none" };

export interface CaptureResult {
  captured: boolean;
  isNew?: boolean;
  isTriage?: boolean;
  duplicate?: boolean;
  restaurantId?: string | null;
  domain?: string;
  senderName?: string | null;
}

/**
 * ProspectsService — the D1 cold-email "Prospects" lane.
 *
 * A genuine unknown-sender vendor outreach (an intro, a catalogue, a wine offer — usually
 * with product content or an attachment) used to be dropped at the provider lookup. Here it
 * is captured as a low-priority, digest-only Prospect: deduped by domain, never auto-replied,
 * one-tap "Add as vendor" to start a real relationship. Pure marketing-list blasts are gated
 * out upstream (bulk/list transport) so this never becomes a spam magnet.
 *
 * Attribution (Phase 0): the inbound mailbox is a single shared account, so a truly cold email
 * carries no tenant signal. We attribute to DEFAULT_RESTAURANT_ID or the sole restaurant; when
 * genuinely ambiguous (multi-restaurant, no default) we route to an UNATTRIBUTED triage bucket
 * (restaurant_id IS NULL) rather than leaking into one tenant or silently dropping. The real
 * fix (transport-derived attribution via a dedicated inbound domain) is Phases 1–2 in
 * .planning/PROSPECTS_ATTRIBUTION_ARCHITECTURE.md.
 *
 * Best-effort on the capture and read paths: those methods swallow their own errors (and
 * tolerate the table not yet existing) so inbound processing is never blocked. `promote` is the
 * exception: it creates a vendor, so a read or write it cannot complete is a 503, not a guess.
 */
@Injectable()
export class ProspectsService {
  private readonly logger = new Logger(ProspectsService.name);
  private static readonly ATTACHMENT_BUCKET = "vendor-attachments";

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * The sender's domain, or "" when there is no single unambiguous one.
   * Delegates to `inbound-headers.ts senderDomain` (QA round 22, N-1): this
   * used to take the first `<...>`, so `"x <a@trusted.com>" <b@evil.example>`
   * read as trusted.com. A bare domain is still accepted as given.
   */
  domainOf(emailOrDomain: string | null | undefined): string {
    return senderDomain(emailOrDomain);
  }

  /**
   * Attribute a cold email to a restaurant. See the Attribution type. Never guesses across
   * multiple tenants: ambiguity resolves to triage, not an arbitrary tenant.
   */
  private async resolveAttribution(): Promise<Attribution> {
    const configured = this.configService.get<string>("DEFAULT_RESTAURANT_ID");
    if (configured) return { kind: "attributed", id: configured };
    try {
      const { data } = await this.databaseService.supabase
        .from("restaurants")
        .select("id")
        .limit(2);
      if (Array.isArray(data)) {
        if (data.length === 1)
          return { kind: "attributed", id: (data[0] as any).id };
        if (data.length > 1) return { kind: "ambiguous" };
      }
    } catch {
      /* ignore */
    }
    return { kind: "none" };
  }

  /**
   * Capture (or bump) a Prospect from a provider-unmatched inbound. Deduped by domain (per
   * restaurant, or globally for the triage bucket). A repeat outreach increments the count and
   * refreshes last_seen without resurrecting a dismissed row. Idempotent on gmail_message_id so
   * a Pub/Sub redelivery or force-fetch overlap does not inflate the count.
   */
  async captureFromColdEmail(params: {
    senderEmail: string;
    senderName?: string | null;
    subject?: string | null;
    body?: string | null;
    hasAttachments?: boolean;
    captureReason?: string | null;
    attachments?: ProspectAttachmentRef[];
    gmailMessageId?: string | null;
    gmailThreadId?: string | null;
    bodyPreview?: string | null;
    /**
     * Phase 2 — deterministic attribution. When the dedicated-domain inbound webhook resolved
     * the recipient address to a restaurant, it is passed here and used directly (no guessing).
     * When null/absent we fall back to resolveAttribution() (DEFAULT/sole restaurant, else triage).
     */
    restaurantId?: string | null;
    /**
     * Hold in the unattributed bucket whatever resolveAttribution would say
     * (`holdUnattributed`): the publisher already found no receiving house.
     */
    unattributed?: boolean;
  }): Promise<CaptureResult> {
    const domain = this.domainOf(params.senderEmail);
    if (!domain) return { captured: false };

    const attribution: Attribution = params.unattributed
      ? { kind: "ambiguous" }
      : params.restaurantId
        ? { kind: "attributed", id: params.restaurantId }
        : await this.resolveAttribution();
    if (attribution.kind === "none") {
      // No restaurant exists at all — nothing to attribute to. Loud, not silent.
      this.logger.warn(
        `PROSPECT_DROP_NO_RESTAURANT domain=${domain} — no restaurant exists to attribute a cold email to.`,
      );
      return { captured: false };
    }
    const restaurantId =
      attribution.kind === "attributed" ? attribution.id : null;
    const isTriage = restaurantId === null;

    // Idempotency: same physical email already captured → do nothing (don't re-bump).
    if (params.gmailMessageId) {
      try {
        const { data: dup } = await this.databaseService.supabase
          .from("email_prospects")
          .select("id")
          .eq("gmail_message_id", params.gmailMessageId)
          .limit(1);
        if (dup && dup.length)
          return {
            captured: false,
            duplicate: true,
            restaurantId,
            domain,
            isTriage,
          };
      } catch {
        /* ignore — index/table may be mid-migration */
      }
    }

    const snippet =
      (params.body ?? "").replace(/\s+/g, " ").trim().slice(0, 280) || null;
    const bodyPreview =
      (params.bodyPreview ?? params.body ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 4000) || null;
    const attachments = Array.isArray(params.attachments)
      ? params.attachments
      : [];
    const now = new Date().toISOString();

    try {
      // Dedup match: per-restaurant for attributed rows, global for the triage bucket
      // (which has restaurant_id IS NULL, where the composite index does not dedup).
      let existingQuery = this.databaseService.supabase
        .from("email_prospects")
        .select("id, message_count, status")
        .eq("domain", domain)
        // A held letter is its own row (`holdLetter`), never the domain's.
        .is("held_reason", null);
      existingQuery = isTriage
        ? existingQuery.is("restaurant_id", null)
        : existingQuery.eq("restaurant_id", restaurantId as string);
      const { data: existing } = await existingQuery.maybeSingle();

      if (existing) {
        await this.databaseService.supabase
          .from("email_prospects")
          .update({
            message_count: ((existing as any).message_count ?? 1) + 1,
            last_seen_at: now,
            updated_at: now,
            sender_email: params.senderEmail,
            ...(params.senderName ? { sender_name: params.senderName } : {}),
            ...(params.subject ? { subject: params.subject } : {}),
            ...(snippet ? { snippet } : {}),
            ...(bodyPreview ? { body_preview: bodyPreview } : {}),
            ...(params.captureReason
              ? { capture_reason: params.captureReason }
              : {}),
            ...(params.gmailMessageId
              ? { gmail_message_id: params.gmailMessageId }
              : {}),
            ...(params.gmailThreadId
              ? { gmail_thread_id: params.gmailThreadId }
              : {}),
            ...(attachments.length
              ? { attachments, has_attachments: true }
              : params.hasAttachments
                ? { has_attachments: true }
                : {}),
          })
          .eq("id", (existing as any).id);
        return {
          captured: true,
          isNew: false,
          isTriage,
          restaurantId,
          domain,
          senderName: params.senderName ?? null,
        };
      }

      await this.databaseService.supabase.from("email_prospects").insert({
        restaurant_id: restaurantId,
        domain,
        sender_email: params.senderEmail,
        sender_name: params.senderName ?? null,
        subject: params.subject ?? null,
        snippet,
        body_preview: bodyPreview,
        capture_reason: params.captureReason ?? null,
        attachments,
        gmail_message_id: params.gmailMessageId ?? null,
        gmail_thread_id: params.gmailThreadId ?? null,
        has_attachments:
          params.hasAttachments === true || attachments.length > 0,
        message_count: 1,
        status: "new",
        first_seen_at: now,
        last_seen_at: now,
      });
      if (isTriage) {
        this.logger.warn(
          `PROSPECT_TRIAGE_CAPTURE domain=${domain} — cold email unattributable (multi-restaurant, no DEFAULT_RESTAURANT_ID); held in triage, not leaked.`,
        );
      } else {
        this.logger.log(
          `PROSPECT_CAPTURE domain=${domain} restaurant=${restaurantId}.`,
        );
      }
      return {
        captured: true,
        isNew: true,
        isTriage,
        restaurantId,
        domain,
        senderName: params.senderName ?? null,
      };
    } catch (e: any) {
      this.logger.warn(
        `captureFromColdEmail failed for ${domain}: ${e?.message}`,
      );
      return { captured: false };
    }
  }

  /**
   * Keep a letter whose event names no receiving house (QA round 25) in the
   * unattributed bucket: restaurant_id null, operator-only
   * (`listUnattributed`), deduped by domain like any triage row, with the
   * Gmail ids kept so the full letter can be found in the mailbox. The
   * capture reason says why no house was found ("no_house:<why>").
   */
  async holdUnattributed(params: {
    senderEmail: string;
    senderName?: string | null;
    subject?: string | null;
    body?: string | null;
    hasAttachments?: boolean;
    attachments?: ProspectAttachmentRef[];
    gmailMessageId?: string | null;
    gmailThreadId?: string | null;
    why: string;
  }): Promise<CaptureResult> {
    const { why, ...letter } = params;
    return this.captureFromColdEmail({
      ...letter,
      bodyPreview: letter.body ?? null,
      captureReason: `no_house:${why}`,
      restaurantId: null,
      unattributed: true,
    });
  }

  /**
   * Keep one letter for a person, filed under no vendor (QA round 24): its
   * From names nobody (`sender_unreadable`), or the receiving server could
   * not confirm it came from the address it names (`sender_unconfirmed`).
   * One row per letter (`held_reason` set), never folded into a domain's
   * prospect row: folding keeps only the newest letter's words, and a held
   * letter must not vanish under the next one. Shown in the house's "Who is
   * writing" list, or the operator's when `restaurantId` is null. Idempotent
   * on gmail_message_id. Never promoted to a vendor (`promote`).
   */
  async holdLetter(params: {
    restaurantId: string | null;
    heldReason: "sender_unreadable" | "sender_unconfirmed";
    senderEmail: string | null;
    senderName?: string | null;
    subject?: string | null;
    body?: string | null;
    attachments?: ProspectAttachmentRef[];
    gmailMessageId?: string | null;
    gmailThreadId?: string | null;
  }): Promise<CaptureResult> {
    const restaurantId = params.restaurantId ?? null;
    const domain = params.senderEmail ? this.domainOf(params.senderEmail) : "";
    if (params.gmailMessageId) {
      const { data: dup, error } = await this.databaseService.supabase
        .from("email_prospects")
        .select("id")
        .eq("gmail_message_id", params.gmailMessageId)
        .limit(1);
      if (!error && dup && dup.length)
        return { captured: false, duplicate: true, restaurantId, domain };
    }
    const attachments = Array.isArray(params.attachments)
      ? params.attachments
      : [];
    const body = (params.body ?? "").replace(/\s+/g, " ").trim();
    const now = new Date().toISOString();
    const { error } = await this.databaseService.supabase
      .from("email_prospects")
      .insert({
        restaurant_id: restaurantId,
        domain,
        sender_email: params.senderEmail ?? null,
        sender_name: params.senderName ?? null,
        subject: params.subject ?? null,
        snippet: body.slice(0, 280) || null,
        body_preview: body.slice(0, 4000) || null,
        capture_reason: params.heldReason,
        held_reason: params.heldReason,
        attachments,
        gmail_message_id: params.gmailMessageId ?? null,
        gmail_thread_id: params.gmailThreadId ?? null,
        has_attachments: attachments.length > 0,
        message_count: 1,
        status: "new",
        first_seen_at: now,
        last_seen_at: now,
      });
    if (error) {
      this.logger.error(
        `HELD_LETTER_NOT_KEPT reason=${params.heldReason} restaurant=${restaurantId ?? "none"} — ${error.message}`,
      );
      return { captured: false, restaurantId, domain };
    }
    this.logger.warn(
      `HELD_LETTER reason=${params.heldReason} restaurant=${restaurantId ?? "none (operator)"} domain=${domain || "-"}`,
    );
    return {
      captured: true,
      isNew: true,
      isTriage: restaurantId === null,
      restaurantId,
      domain,
      senderName: params.senderName ?? null,
    };
  }

  /** Open prospects (status='new') for the surface, newest outreach first. */
  async list(restaurantId: string): Promise<any[]> {
    try {
      const { data } = await this.databaseService.supabase
        .from("email_prospects")
        .select(
          "id, domain, sender_email, sender_name, subject, snippet, body_preview, capture_reason, held_reason, attachments, has_attachments, message_count, status, first_seen_at, last_seen_at",
        )
        .eq("restaurant_id", restaurantId)
        .eq("status", "new")
        .order("last_seen_at", { ascending: false })
        .limit(100);
      return await this.withHeldVendors(
        ((data as any[]) || []).map((r) => this.toDto(r)),
        restaurantId,
      );
    } catch {
      return [];
    }
  }

  /**
   * Operator-only: unattributed cold emails (triage bucket, restaurant_id IS NULL). These are
   * NEVER shown in a tenant surface. Gated at the controller by PLATFORM_ADMIN_USER_IDS.
   */
  async listUnattributed(): Promise<any[]> {
    try {
      const { data } = await this.databaseService.supabase
        .from("email_prospects")
        .select(
          "id, domain, sender_email, sender_name, subject, snippet, body_preview, capture_reason, held_reason, attachments, has_attachments, message_count, status, first_seen_at, last_seen_at",
        )
        .is("restaurant_id", null)
        .eq("status", "new")
        .order("last_seen_at", { ascending: false })
        .limit(200);
      return ((data as any[]) || []).map((r) => this.toDto(r));
    } catch {
      return [];
    }
  }

  /** Restaurant ids the user may see prospects for (their active + any other memberships). */
  async accessibleRestaurantIds(
    userId: string,
    activeRestaurantId: string,
  ): Promise<string[]> {
    try {
      const { data } = await this.databaseService.supabase
        .from("user_restaurant_access")
        .select("restaurant_id")
        .eq("user_id", userId)
        .eq("is_active", true);
      const ids = ((data as any[]) || [])
        .map((r) => r.restaurant_id)
        .filter(Boolean);
      const set = new Set<string>(ids);
      if (activeRestaurantId) set.add(activeRestaurantId);
      return set.size
        ? Array.from(set)
        : activeRestaurantId
          ? [activeRestaurantId]
          : [];
    } catch {
      return activeRestaurantId ? [activeRestaurantId] : [];
    }
  }

  /**
   * Open prospects across several restaurants the caller has access to (Phase 5 multi-location
   * view). Each row carries restaurant_id so the surface can label + filter with chips. Never
   * spans beyond the caller's memberships — the controller passes only accessible ids.
   */
  async listAcross(restaurantIds: string[]): Promise<any[]> {
    if (!restaurantIds.length) return [];
    try {
      const { data } = await this.databaseService.supabase
        .from("email_prospects")
        .select(
          "id, restaurant_id, domain, sender_email, sender_name, subject, snippet, body_preview, capture_reason, held_reason, attachments, has_attachments, message_count, status, first_seen_at, last_seen_at",
        )
        .in("restaurant_id", restaurantIds)
        .eq("status", "new")
        .order("last_seen_at", { ascending: false })
        .limit(300);
      return await this.withHeldVendors(
        ((data as any[]) || []).map((r) => this.toDto(r)),
        null,
      );
    } catch {
      return [];
    }
  }

  /**
   * Each held letter whose sender could not be confirmed names the vendor
   * its address belongs to in its house's book, the vendor "File it under"
   * would use (r35 mail, gap 9): `held_vendor` is `{ id, name }`, or null
   * when no single live vendor lists the address. `held_vendor_unread` is
   * true when the book could not be read, which is not "no vendor".
   * Read once per (house, address); held letters are few. `house` names
   * the house for rows read without their `restaurant_id` (`list`).
   */
  private async withHeldVendors(
    rows: any[],
    house: string | null,
  ): Promise<any[]> {
    const memo = new Map<string, Promise<SenderVendor | null>>();
    return Promise.all(
      rows.map(async (r) => {
        const rowHouse: string | null = r.restaurant_id ?? house;
        if (r.held_reason !== "sender_unconfirmed" || !r.sender_email || !rowHouse) {
          return r;
        }
        const key = `${rowHouse} ${String(r.sender_email).toLowerCase()}`;
        if (!memo.has(key)) {
          memo.set(
            key,
            findSenderVendor(this.databaseService.supabase, rowHouse, r.sender_email),
          );
        }
        try {
          const v = await memo.get(key)!;
          return { ...r, held_vendor: v ? { id: v.id, name: v.name } : null, held_vendor_unread: false };
        } catch (err: any) {
          this.logger.warn(`list: the vendor of a held letter could not be read — ${err?.message}`);
          return { ...r, held_vendor: null, held_vendor_unread: true };
        }
      }),
    );
  }

  /** Normalize a row into the DTO the surface expects (attachment metadata only, no URLs). */
  private toDto(r: any): any {
    const attachments = Array.isArray(r?.attachments) ? r.attachments : [];
    return {
      id: r.id,
      restaurant_id: r.restaurant_id ?? null,
      domain: r.domain,
      sender_email: r.sender_email,
      sender_name: r.sender_name,
      subject: r.subject,
      snippet: r.snippet,
      body_preview: r.body_preview ?? null,
      capture_reason: r.capture_reason ?? null,
      held_reason: r.held_reason ?? null,
      has_attachments: r.has_attachments === true || attachments.length > 0,
      attachments: attachments.map((a: any) => ({
        filename: a.filename,
        mime_type: a.mime_type ?? null,
        size_bytes: a.size_bytes ?? null,
      })),
      message_count: r.message_count,
      status: r.status,
      first_seen_at: r.first_seen_at,
      last_seen_at: r.last_seen_at,
    };
  }

  /** Short-lived signed URLs for a prospect's persisted attachments. Tenant-scoped. */
  async attachmentsFor(
    restaurantId: string,
    prospectId: string,
  ): Promise<any[]> {
    try {
      const { data: prospect } = await this.databaseService.supabase
        .from("email_prospects")
        .select("id, attachments")
        .eq("restaurant_id", restaurantId)
        .eq("id", prospectId)
        .maybeSingle();
      const refs: ProspectAttachmentRef[] = Array.isArray(
        (prospect as any)?.attachments,
      )
        ? (prospect as any).attachments
        : [];
      const out: any[] = [];
      for (const a of refs) {
        let url: string | null = null;
        try {
          const { data: signed } = await this.databaseService.supabase.storage
            .from(ProspectsService.ATTACHMENT_BUCKET)
            .createSignedUrl(a.storage_path, 3600);
          url = signed?.signedUrl ?? null;
        } catch {
          /* best-effort — a missing object just yields no url */
        }
        out.push({
          filename: a.filename,
          mime_type: a.mime_type ?? null,
          size_bytes: a.size_bytes ?? null,
          url,
        });
      }
      return out;
    } catch {
      return [];
    }
  }

  /**
   * Promote a prospect to a real (custom) provider and mark it promoted. Deduped: if a provider
   * with the same email already exists for this restaurant, reuse it instead of manufacturing a
   * duplicate (which would destabilize the inbound provider match).
   *
   * Not best-effort, unlike the capture path: this creates a vendor. supabase-js resolves
   * { data, error } rather than throwing, so every read here binds `error`. Unbound, a failed
   * dedupe read looked exactly like "no vendor with this email yet" and a second vendor was
   * inserted, a failed prospect read looked like "no such prospect", and a failed status update
   * still answered { promoted: true }. Each of those is now a 503. { promoted: false } is kept
   * for the two answers that were actually read: no such prospect in this house, and an insert
   * the database refused with no winning row to link.
   */
  async promote(
    restaurantId: string,
    prospectId: string,
  ): Promise<{ promoted: boolean; providerId?: string; reused?: boolean }> {
    const { data: prospect, error: prospectError } =
      await this.databaseService.supabase
        .from("email_prospects")
        .select("id, domain, sender_email, sender_name, status, held_reason")
        .eq("restaurant_id", restaurantId)
        .eq("id", prospectId)
        .maybeSingle();
    if (prospectError) {
      this.logger.error(
        `promote: prospect read failed for ${prospectId} — ${prospectError.message}`,
      );
      throw new ServiceUnavailableException(
        "Could not read this prospect; no vendor was added",
      );
    }
    if (!prospect) return { promoted: false };
    const p = prospect as any;
    // A held letter (QA round 24) is not an introduction: its sender could
    // not be read, or could not be confirmed. Adding it as a vendor would
    // make a forged or unreadable From a vendor's address.
    if (p.held_reason) return { promoted: false };

    // Dedupe: an existing (non-deleted) provider with this email on this restaurant wins.
    let providerId: string | null = null;
    let reused = false;
    if (p.sender_email) {
      const { data: existing, error: existingError } =
        await this.databaseService.supabase
          .from("providers")
          .select("id")
          .eq("restaurant_id", restaurantId)
          .ilike("contact_email", likeExactly(p.sender_email))
          .is("deleted_at", null)
          .limit(1);
      if (existingError) {
        this.logger.error(
          `promote: vendor dedupe read failed for ${prospectId} — ${existingError.message}`,
        );
        throw new ServiceUnavailableException(
          "Could not check for an existing vendor with this email; no vendor was added",
        );
      }
      if (existing?.[0]) {
        providerId = (existing[0] as any).id;
        reused = true;
      }
    }

    if (!providerId) {
      const { data: provider, error } = await this.databaseService.supabase
        .from("providers")
        .insert({
          restaurant_id: restaurantId,
          name: p.sender_name || p.domain,
          contact_email: p.sender_email ?? null,
          is_custom: true,
          is_active: true,
        })
        .select("id")
        .single();
      if (error) {
        // Lost a race against the unique index — re-select the winner.
        const { data: raced, error: racedError } =
          await this.databaseService.supabase
            .from("providers")
            .select("id")
            .eq("restaurant_id", restaurantId)
            .ilike("contact_email", likeExactly(p.sender_email ?? ""))
            .is("deleted_at", null)
            .limit(1);
        if (racedError) {
          this.logger.error(
            `promote: provider insert refused (${error.message}) and the re-read failed — ${racedError.message}`,
          );
          throw new ServiceUnavailableException(
            "Adding the vendor was refused and the re-check could not be read; retry",
          );
        }
        if (raced?.[0]) {
          providerId = (raced[0] as any).id;
          reused = true;
        } else {
          this.logger.error(
            `promote: provider insert failed — ${error.message}`,
          );
          return { promoted: false };
        }
      } else {
        providerId = (provider as any).id;
      }
    }

    const { error: markError } = await this.databaseService.supabase
      .from("email_prospects")
      .update({
        status: "promoted",
        promoted_provider_id: providerId,
        updated_at: new Date().toISOString(),
      })
      .eq("restaurant_id", restaurantId)
      .eq("id", prospectId);
    if (markError) {
      this.logger.error(
        `promote: marking ${prospectId} promoted failed — ${markError.message}`,
      );
      throw new ServiceUnavailableException(
        `The vendor was ${reused ? "linked" : "added"}, but the prospect could not be marked promoted; retrying links the same vendor`,
      );
    }

    return { promoted: true, providerId: providerId ?? undefined, reused };
  }

  /** Dismiss a prospect (won't be resurrected by a repeat outreach). */
  async dismiss(
    restaurantId: string,
    prospectId: string,
  ): Promise<{ dismissed: boolean }> {
    try {
      await this.databaseService.supabase
        .from("email_prospects")
        .update({ status: "dismissed", updated_at: new Date().toISOString() })
        .eq("restaurant_id", restaurantId)
        .eq("id", prospectId);
      return { dismissed: true };
    } catch {
      return { dismissed: false };
    }
  }

  /** Restore a dismissed prospect back to the open list (undo a dismiss). */
  async restore(
    restaurantId: string,
    prospectId: string,
  ): Promise<{ restored: boolean }> {
    try {
      await this.databaseService.supabase
        .from("email_prospects")
        .update({ status: "new", updated_at: new Date().toISOString() })
        .eq("restaurant_id", restaurantId)
        .eq("id", prospectId)
        .eq("status", "dismissed");
      return { restored: true };
    } catch {
      return { restored: false };
    }
  }
}
