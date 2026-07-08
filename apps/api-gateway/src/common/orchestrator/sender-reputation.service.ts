import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

export type ReputationSignal = 'injection' | 'spam' | 'bounce';

/**
 * SenderReputationService — per-domain trust + abuse signals (D5). A manager can trust a
 * sender domain to bypass the SPF/DKIM quarantine; abuse signals are recorded and trust is
 * AUTO-SUSPENDED on an injection attempt (a trusted domain sending injection is almost
 * certainly spoofed/compromised) or sustained spam. Exposes a 0..1 score for D4 priority.
 *
 * Trust never overrides the other guardrails — it only lifts the "sender unverified" gate.
 * Best-effort: never throws.
 */
@Injectable()
export class SenderReputationService {
  private readonly logger = new Logger(SenderReputationService.name);
  private static readonly SPAM_SUSPEND_THRESHOLD = 10;

  constructor(private readonly databaseService: DatabaseService) {}

  /** Bare domain from an email address, `Name <a@b.com>`, or an already-bare domain. */
  domainOf(emailOrDomain: string | null | undefined): string {
    const s = (emailOrDomain ?? '').toString().trim().toLowerCase();
    if (!s) return '';
    const angled = s.match(/<([^>]+)>/);
    const addr = angled ? angled[1] : s;
    return addr.includes('@') ? (addr.split('@')[1] ?? '').trim() : addr;
  }

  /** True only when the domain is explicitly trusted AND not suspended. */
  async isTrusted(restaurantId: string, emailOrDomain: string | null | undefined): Promise<boolean> {
    const domain = this.domainOf(emailOrDomain);
    if (!restaurantId || !domain) return false;
    try {
      const { data } = await this.databaseService.supabase
        .from('sender_reputation')
        .select('trusted, suspended')
        .eq('restaurant_id', restaurantId)
        .eq('domain', domain)
        .maybeSingle();
      return !!data && (data as any).trusted === true && (data as any).suspended !== true;
    } catch {
      return false;
    }
  }

  /** Manager trusts/untrusts a sender domain. Re-trusting clears any auto-suspension. */
  async setTrust(restaurantId: string, emailOrDomain: string, trusted: boolean, providerId?: string | null): Promise<string> {
    const domain = this.domainOf(emailOrDomain);
    if (!restaurantId || !domain) return '';
    try {
      await this.databaseService.supabase.from('sender_reputation').upsert(
        {
          restaurant_id: restaurantId,
          domain,
          provider_id: providerId ?? null,
          trusted,
          trusted_at: trusted ? new Date().toISOString() : null,
          suspended: false,
          suspended_reason: null,
          suspended_at: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'restaurant_id,domain' },
      );
    } catch (e: any) {
      this.logger.warn(`setTrust failed for ${domain}: ${e?.message}`);
    }
    return domain;
  }

  /**
   * Record an abuse signal and auto-suspend trust when warranted. Injection from a trusted
   * domain suspends immediately; spam suspends past the threshold.
   */
  async recordSignal(restaurantId: string, emailOrDomain: string | null | undefined, kind: ReputationSignal): Promise<void> {
    const domain = this.domainOf(emailOrDomain);
    if (!restaurantId || !domain) return;
    try {
      const { data: existing } = await this.databaseService.supabase
        .from('sender_reputation')
        .select('trusted, suspended, injection_signals, spam_signals, bounce_signals, completed_orders')
        .eq('restaurant_id', restaurantId)
        .eq('domain', domain)
        .maybeSingle();

      const row: any = existing || {
        trusted: false, suspended: false, injection_signals: 0, spam_signals: 0, bounce_signals: 0, completed_orders: 0,
      };
      const injection = row.injection_signals + (kind === 'injection' ? 1 : 0);
      const spam = row.spam_signals + (kind === 'spam' ? 1 : 0);
      const bounce = row.bounce_signals + (kind === 'bounce' ? 1 : 0);

      let suspended = row.suspended === true;
      let suspendedReason: string | null = null;
      if (row.trusted === true && !suspended) {
        if (kind === 'injection') {
          suspended = true;
          suspendedReason = 'auto-suspended: injection attempt from a trusted domain';
        } else if (spam >= SenderReputationService.SPAM_SUSPEND_THRESHOLD) {
          suspended = true;
          suspendedReason = 'auto-suspended: sustained spam';
        }
      }

      const score = Math.max(0, Math.min(1, 0.5 + row.completed_orders * 0.02 - injection * 0.3 - spam * 0.03 - bounce * 0.02));

      await this.databaseService.supabase.from('sender_reputation').upsert(
        {
          restaurant_id: restaurantId,
          domain,
          injection_signals: injection,
          spam_signals: spam,
          bounce_signals: bounce,
          last_signal_at: new Date().toISOString(),
          score,
          ...(suspended ? { suspended: true, suspended_reason: suspendedReason, suspended_at: new Date().toISOString(), trusted: false } : {}),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'restaurant_id,domain' },
      );

      if (suspended && suspendedReason) {
        this.logger.warn(`SenderReputation: ${suspendedReason} (${domain}, restaurant ${restaurantId}).`);
      }
    } catch (e: any) {
      this.logger.warn(`recordSignal failed for ${domain}: ${e?.message}`);
    }
  }

  /** List the restaurant's sender-reputation rows (for the settings/providers UI). */
  async list(restaurantId: string): Promise<any[]> {
    try {
      const { data } = await this.databaseService.supabase
        .from('sender_reputation')
        .select('id, domain, provider_id, trusted, suspended, suspended_reason, injection_signals, spam_signals, completed_orders, score, updated_at')
        .eq('restaurant_id', restaurantId)
        .order('updated_at', { ascending: false });
      return (data as any[]) || [];
    } catch {
      return [];
    }
  }
}
