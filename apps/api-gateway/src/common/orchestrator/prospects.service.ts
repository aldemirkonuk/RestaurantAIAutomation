import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../../database/database.service';

/**
 * ProspectsService — the D1 cold-email "Prospects" lane.
 *
 * A genuine unknown-sender vendor outreach (an intro, a catalogue, a wine offer — usually
 * with product content or an attachment) used to be dropped at the provider lookup. Here it
 * is captured as a low-priority, digest-only Prospect: deduped by domain, never auto-replied,
 * one-tap "Promote to vendor" to start a real relationship. Pure marketing-list blasts are
 * gated out upstream (bulk/list transport) so this never becomes a spam magnet.
 *
 * Best-effort throughout: every method swallows its own errors (and tolerates the table not
 * yet existing) so inbound processing is never blocked.
 */
@Injectable()
export class ProspectsService {
  private readonly logger = new Logger(ProspectsService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly configService: ConfigService,
  ) {}

  /** Bare domain from an email address or `Name <a@b.com>`. */
  domainOf(emailOrDomain: string | null | undefined): string {
    const s = (emailOrDomain ?? '').toString().trim().toLowerCase();
    if (!s) return '';
    const angled = s.match(/<([^>]+)>/);
    const addr = angled ? angled[1] : s;
    return addr.includes('@') ? (addr.split('@')[1] ?? '').trim() : addr;
  }

  /**
   * The inbound Gmail mailbox is a single shared account, so a truly cold email can't be
   * attributed to a restaurant from its headers. Attribute to DEFAULT_RESTAURANT_ID, or to
   * the sole restaurant when exactly one exists. Returns null when it's genuinely ambiguous
   * (multi-restaurant, no default) — in which case we simply don't lead the email.
   */
  private async resolveRestaurantId(): Promise<string | null> {
    const configured = this.configService.get<string>('DEFAULT_RESTAURANT_ID');
    if (configured) return configured;
    try {
      const { data } = await this.databaseService.supabase.from('restaurants').select('id').limit(2);
      if (Array.isArray(data) && data.length === 1) return (data[0] as any).id;
    } catch {
      /* ignore */
    }
    return null;
  }

  /**
   * Capture (or bump) a Prospect from a provider-unmatched inbound. Deduped by domain: a
   * repeat outreach increments the count and refreshes last_seen without resurrecting a
   * dismissed row.
   */
  async captureFromColdEmail(params: {
    senderEmail: string;
    senderName?: string | null;
    subject?: string | null;
    body?: string | null;
    hasAttachments?: boolean;
  }): Promise<{ captured: boolean }> {
    const domain = this.domainOf(params.senderEmail);
    if (!domain) return { captured: false };
    const restaurantId = await this.resolveRestaurantId();
    if (!restaurantId) return { captured: false };

    const snippet = (params.body ?? '').replace(/\s+/g, ' ').trim().slice(0, 280) || null;
    const now = new Date().toISOString();

    try {
      const { data: existing } = await this.databaseService.supabase
        .from('email_prospects')
        .select('id, message_count, status')
        .eq('restaurant_id', restaurantId)
        .eq('domain', domain)
        .maybeSingle();

      if (existing) {
        // Keep a dismissed prospect dismissed; just record that they reached out again.
        await this.databaseService.supabase
          .from('email_prospects')
          .update({
            message_count: ((existing as any).message_count ?? 1) + 1,
            last_seen_at: now,
            updated_at: now,
            sender_email: params.senderEmail,
            ...(params.senderName ? { sender_name: params.senderName } : {}),
            ...(params.subject ? { subject: params.subject } : {}),
            ...(snippet ? { snippet } : {}),
            ...(params.hasAttachments ? { has_attachments: true } : {}),
          })
          .eq('id', (existing as any).id);
        return { captured: true };
      }

      await this.databaseService.supabase.from('email_prospects').insert({
        restaurant_id: restaurantId,
        domain,
        sender_email: params.senderEmail,
        sender_name: params.senderName ?? null,
        subject: params.subject ?? null,
        snippet,
        has_attachments: params.hasAttachments === true,
        message_count: 1,
        status: 'new',
        first_seen_at: now,
        last_seen_at: now,
      });
      this.logger.log(`Prospect captured: ${domain} (restaurant ${restaurantId}).`);
      return { captured: true };
    } catch (e: any) {
      this.logger.warn(`captureFromColdEmail failed for ${domain}: ${e?.message}`);
      return { captured: false };
    }
  }

  /** Open prospects (status='new') for the surface, newest outreach first. */
  async list(restaurantId: string): Promise<any[]> {
    try {
      const { data } = await this.databaseService.supabase
        .from('email_prospects')
        .select('id, domain, sender_email, sender_name, subject, snippet, has_attachments, message_count, status, first_seen_at, last_seen_at')
        .eq('restaurant_id', restaurantId)
        .eq('status', 'new')
        .order('last_seen_at', { ascending: false })
        .limit(100);
      return (data as any[]) || [];
    } catch {
      return [];
    }
  }

  /** Promote a prospect to a real (custom) provider and mark it promoted. */
  async promote(restaurantId: string, prospectId: string): Promise<{ promoted: boolean; providerId?: string }> {
    try {
      const { data: prospect } = await this.databaseService.supabase
        .from('email_prospects')
        .select('id, domain, sender_email, sender_name, status')
        .eq('restaurant_id', restaurantId)
        .eq('id', prospectId)
        .maybeSingle();
      if (!prospect) return { promoted: false };
      const p = prospect as any;

      const { data: provider, error } = await this.databaseService.supabase
        .from('providers')
        .insert({
          restaurant_id: restaurantId,
          name: p.sender_name || p.domain,
          contact_email: p.sender_email ?? null,
          is_custom: true,
          is_active: true,
        })
        .select('id')
        .single();
      if (error) {
        this.logger.error(`promote: provider insert failed — ${error.message}`);
        return { promoted: false };
      }

      await this.databaseService.supabase
        .from('email_prospects')
        .update({ status: 'promoted', promoted_provider_id: (provider as any).id, updated_at: new Date().toISOString() })
        .eq('id', prospectId);

      return { promoted: true, providerId: (provider as any).id };
    } catch (e: any) {
      this.logger.warn(`promote failed for ${prospectId}: ${e?.message}`);
      return { promoted: false };
    }
  }

  /** Dismiss a prospect (won't be resurrected by a repeat outreach). */
  async dismiss(restaurantId: string, prospectId: string): Promise<{ dismissed: boolean }> {
    try {
      await this.databaseService.supabase
        .from('email_prospects')
        .update({ status: 'dismissed', updated_at: new Date().toISOString() })
        .eq('restaurant_id', restaurantId)
        .eq('id', prospectId);
      return { dismissed: true };
    } catch {
      return { dismissed: false };
    }
  }
}
