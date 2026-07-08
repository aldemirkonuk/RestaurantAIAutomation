import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DatabaseService } from '../../database/database.service';
import { WebsocketGateway } from '../../websocket/websocket.gateway';
import { looksPromotional, TransportSignals } from './email-triage';
import { extractPromotion } from './promo-extract';
import { computePriority } from './priority';
import { InboundResponderService } from './inbound-responder.service';

interface PromoContext {
  conversationId: string;
  restaurantId: string;
  providerId: string;
  providerName?: string | null;
  subject?: string | null;
  body?: string | null;
  transport?: TransportSignals | null;
}

/**
 * PromotionExtractorService — the deterministic promotions lane (D3). Called for every
 * PROVIDER-matched inbound (with or without an order). A cheap pre-filter gates it so we
 * never do work on ordinary vendor mail; likely-promos are extracted deterministically
 * (no LLM), deduped, written to the (previously dormant) provider_promotions table, and
 * surfaced to the manager. Notify-only — it never replies or commits anything. Best-effort:
 * never throws, never blocks inbound processing.
 */
@Injectable()
export class PromotionExtractorService {
  private readonly logger = new Logger(PromotionExtractorService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly websocketGateway: WebsocketGateway,
    @Optional() private readonly inboundResponder?: InboundResponderService,
  ) {}

  async extractAndStore(ctx: PromoContext): Promise<{ stored: boolean; reason?: string }> {
    try {
      // Cheap deterministic pre-filter — only proceed when it looks promotional.
      const t = ctx.transport;
      const likelyPromo =
        (t != null && (t.bulk || t.listMail || t.esp != null)) || looksPromotional(ctx.subject, ctx.body);
      if (!likelyPromo) return { stored: false, reason: 'not promotional' };

      const promo = extractPromotion(ctx.subject, ctx.body);
      if (!promo) return { stored: false, reason: 'no promo terms extracted' };

      // Dedup: same provider already has an active promo with this signature?
      const { data: dupes } = await this.databaseService.supabase
        .from('provider_promotions')
        .select('id')
        .eq('provider_id', ctx.providerId)
        .eq('is_active', true)
        .contains('conditions', { signature: promo.signature })
        .limit(1);
      if (dupes?.length) return { stored: false, reason: 'duplicate promo' };

      const discount_value: Record<string, any> = {};
      if (promo.discount_pct != null) discount_value.percent = promo.discount_pct;
      if (promo.discount_amount != null) discount_value.amount = promo.discount_amount;
      if (promo.free_shipping) discount_value.free_shipping = true;
      if (promo.currency) discount_value.currency = promo.currency;

      const applicableWines = await this.matchApplicableWines(ctx.restaurantId, `${ctx.subject ?? ''}\n${ctx.body ?? ''}`);

      // D4 — priority (relevance × savings × urgency × trust) → interrupt / surface / digest.
      const daysToExpiry = promo.valid_until != null ? (new Date(promo.valid_until).getTime() - Date.now()) / 86_400_000 : null;
      const urgency =
        daysToExpiry != null && daysToExpiry <= 3 ? 0.9 :
        daysToExpiry != null && daysToExpiry <= 7 ? 0.6 :
        promo.promo_type === 'closeout' ? 0.7 : 0.2;
      const savings =
        promo.discount_pct != null ? Math.min(1, promo.discount_pct / 30) :
        promo.discount_amount != null ? 0.6 : promo.free_shipping ? 0.4 : 0.2;
      const relevance = applicableWines.length > 0 ? Math.min(1, 0.5 + applicableWines.length * 0.2) : 0.1;
      const trust = ctx.transport?.senderVerified === true ? 0.7 : ctx.transport?.senderVerified === false ? 0.3 : 0.5;
      const { bucket } = computePriority({ relevance, savings, urgency, trust });

      const conditions: Record<string, any> = { signature: promo.signature, priority: bucket };
      if (promo.threshold_qty != null) conditions.min_qty = promo.threshold_qty;
      if (promo.threshold_amount != null) conditions.min_amount = promo.threshold_amount;
      if (promo.promo_code) conditions.code = promo.promo_code;
      if (promo.valid_text) conditions.valid_text = promo.valid_text;

      const { data: inserted, error } = await this.databaseService.supabase
        .from('provider_promotions')
        .insert({
          provider_id: ctx.providerId,
          restaurant_id: ctx.restaurantId,
          name: (ctx.subject || promo.summary).slice(0, 200),
          promo_type: promo.promo_type,
          description: promo.summary,
          conditions,
          discount_value,
          applicable_wines: applicableWines,
          start_date: new Date().toISOString().slice(0, 10),
          end_date: promo.valid_until,
          is_active: true,
          source_conversation_id: ctx.conversationId,
          confidence: promo.confidence,
        })
        .select('id')
        .single();
      if (error) {
        this.logger.warn(`PromotionExtractor: insert failed — ${error.message}`);
        return { stored: false, reason: 'insert failed' };
      }

      // Notify by D4 bucket: interrupt (loud) / surface (info) / digest (filed, no toast → no fatigue).
      const relevant = applicableWines.length > 0;
      const provider = ctx.providerName || 'A supplier';
      if (bucket !== 'digest') {
        this.websocketGateway.emitRestaurantNotification(ctx.restaurantId, {
          id: inserted.id,
          title: relevant ? `${provider} promo on wines you buy` : `${provider} promotion`,
          message: `${promo.summary}${relevant ? ` — matches ${applicableWines.length} of your wines` : ''}.`,
          type: bucket === 'interrupt' ? 'warning' : 'info',
          action_url: `/providers?promotions=1`,
        });
      }

      this.logger.log(
        `PromotionExtractor: stored ${promo.promo_type} promo ${inserted.id} for provider ${ctx.providerId} ` +
          `(conf=${promo.confidence}, priority=${bucket}, relevant=${relevant}).`,
      );
      return { stored: true };
    } catch (e: any) {
      this.logger.warn(`PromotionExtractor failed: ${e?.message}`);
      return { stored: false, reason: 'error' };
    }
  }

  /**
   * Daily digest — one quiet summary per restaurant of the digest-bucket promos filed in the
   * last 24h, so low-priority offers reach the manager without interrupting during the day.
   */
  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async sendDailyDigests(): Promise<void> {
    try {
      const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const { data } = await this.databaseService.supabase
        .from('provider_promotions')
        .select('restaurant_id, promo_type, discount_value, providers!left(name)')
        .gte('created_at', since)
        .eq('is_active', true)
        .contains('conditions', { priority: 'digest' });

      // Group the last 24h of digest-bucket promos per restaurant, keeping a few concrete
      // offer lines so the rollup is useful at a glance (not just a count).
      const byRestaurant = new Map<string, { count: number; lines: string[] }>();
      for (const r of (data as any[]) || []) {
        const id = (r as any).restaurant_id;
        if (!id) continue;
        const entry = byRestaurant.get(id) ?? { count: 0, lines: [] };
        entry.count += 1;
        if (entry.lines.length < 3) {
          const line = this.digestLine(r);
          if (line) entry.lines.push(line);
        }
        byRestaurant.set(id, entry);
      }

      for (const [restaurantId, { count, lines }] of byRestaurant) {
        const title = `${count} new promotion${count !== 1 ? 's' : ''} today`;
        const detail = lines.length
          ? `${lines.join(' · ')}${count > lines.length ? ` · +${count - lines.length} more` : ''}. Review them in Promotions.`
          : `${count} vendor offer${count !== 1 ? 's were' : ' was'} filed since yesterday. Review them in Promotions.`;

        // Live toast for connected clients …
        this.websocketGateway.emitRestaurantNotification(restaurantId, {
          id: `promo-digest-${restaurantId}-${Date.now()}`,
          title,
          message: detail,
          type: 'info',
          action_url: '/promotions',
        });
        // … and a durable inbox notification so an offline manager still gets the digest (A8).
        void this.inboundResponder?.persistManagerNotification(restaurantId, {
          type: 'promo_digest',
          title,
          message: detail,
          priority: 'low',
          actionUrl: '/promotions',
          metadata: { kind: 'promo_digest', count, date: new Date().toISOString().slice(0, 10) },
        });
      }
      if (byRestaurant.size) this.logger.log(`Promo digest sent to ${byRestaurant.size} restaurant(s).`);
    } catch (e: any) {
      this.logger.warn(`sendDailyDigests failed: ${e?.message}`);
    }
  }

  /** One human line for a digest promo row, e.g. "Acme — 15% off" or "A supplier — free shipping". */
  private digestLine(row: any): string | null {
    const provider = row?.providers?.name || 'A supplier';
    const dv = (row?.discount_value ?? {}) as Record<string, any>;
    let offer = '';
    if (dv.percent != null) offer = `${dv.percent}% off`;
    else if (dv.amount != null) offer = `${dv.currency === 'EUR' ? '€' : dv.currency === 'GBP' ? '£' : '$'}${dv.amount} off`;
    else if (dv.free_shipping) offer = 'free shipping';
    else if (row?.promo_type) offer = String(row.promo_type).replace(/_/g, ' ');
    return offer ? `${provider} — ${offer}` : provider;
  }

  /** Names of our inventory wines mentioned in the promo text (simple contains match). */
  private async matchApplicableWines(restaurantId: string, text: string): Promise<string[]> {
    try {
      const { data } = await this.databaseService.supabase
        .from('restaurant_inventory')
        .select('wine_name')
        .eq('restaurant_id', restaurantId)
        .limit(500);
      const lower = text.toLowerCase();
      const hits: string[] = [];
      for (const r of (data as any[]) || []) {
        const name = ((r as any).wine_name || '').toString().trim();
        if (name.length >= 4 && lower.includes(name.toLowerCase())) hits.push(name);
      }
      return Array.from(new Set(hits)).slice(0, 20);
    } catch {
      return [];
    }
  }
}
