import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DatabaseService } from "../../database/database.service";

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
 * Best-effort throughout: every method swallows its own errors (and tolerates the table not
 * yet existing) so inbound processing is never blocked.
 */
@Injectable()
export class ProspectsService {
  private readonly logger = new Logger(ProspectsService.name);
  private static readonly ATTACHMENT_BUCKET = "vendor-attachments";

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly configService: ConfigService,
  ) {}

  /** Bare domain from an email address or `Name <a@b.com>`. */
  domainOf(emailOrDomain: string | null | undefined): string {
    const s = (emailOrDomain ?? "").toString().trim().toLowerCase();
    if (!s) return "";
    const angled = s.match(/<([^>]+)>/);
    const addr = angled ? angled[1] : s;
    return addr.includes("@") ? (addr.split("@")[1] ?? "").trim() : addr;
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
  }): Promise<CaptureResult> {
    const domain = this.domainOf(params.senderEmail);
    if (!domain) return { captured: false };

    const attribution: Attribution = params.restaurantId
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
        .eq("domain", domain);
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

  /** Open prospects (status='new') for the surface, newest outreach first. */
  async list(restaurantId: string): Promise<any[]> {
    try {
      const { data } = await this.databaseService.supabase
        .from("email_prospects")
        .select(
          "id, domain, sender_email, sender_name, subject, snippet, body_preview, capture_reason, attachments, has_attachments, message_count, status, first_seen_at, last_seen_at",
        )
        .eq("restaurant_id", restaurantId)
        .eq("status", "new")
        .order("last_seen_at", { ascending: false })
        .limit(100);
      return ((data as any[]) || []).map((r) => this.toDto(r));
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
          "id, domain, sender_email, sender_name, subject, snippet, body_preview, capture_reason, attachments, has_attachments, message_count, status, first_seen_at, last_seen_at",
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
          "id, restaurant_id, domain, sender_email, sender_name, subject, snippet, body_preview, capture_reason, attachments, has_attachments, message_count, status, first_seen_at, last_seen_at",
        )
        .in("restaurant_id", restaurantIds)
        .eq("status", "new")
        .order("last_seen_at", { ascending: false })
        .limit(300);
      return ((data as any[]) || []).map((r) => this.toDto(r));
    } catch {
      return [];
    }
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
   */
  async promote(
    restaurantId: string,
    prospectId: string,
  ): Promise<{ promoted: boolean; providerId?: string; reused?: boolean }> {
    try {
      const { data: prospect } = await this.databaseService.supabase
        .from("email_prospects")
        .select("id, domain, sender_email, sender_name, status")
        .eq("restaurant_id", restaurantId)
        .eq("id", prospectId)
        .maybeSingle();
      if (!prospect) return { promoted: false };
      const p = prospect as any;

      // Dedupe: an existing (non-deleted) provider with this email on this restaurant wins.
      let providerId: string | null = null;
      let reused = false;
      if (p.sender_email) {
        const { data: existing } = await this.databaseService.supabase
          .from("providers")
          .select("id")
          .eq("restaurant_id", restaurantId)
          .ilike("contact_email", p.sender_email)
          .is("deleted_at", null)
          .limit(1);
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
          const { data: raced } = await this.databaseService.supabase
            .from("providers")
            .select("id")
            .eq("restaurant_id", restaurantId)
            .ilike("contact_email", p.sender_email ?? "")
            .is("deleted_at", null)
            .limit(1);
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

      await this.databaseService.supabase
        .from("email_prospects")
        .update({
          status: "promoted",
          promoted_provider_id: providerId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", prospectId);

      return { promoted: true, providerId: providerId ?? undefined, reused };
    } catch (e: any) {
      this.logger.warn(`promote failed for ${prospectId}: ${e?.message}`);
      return { promoted: false };
    }
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
