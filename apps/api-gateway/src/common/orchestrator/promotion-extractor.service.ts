import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { WebsocketGateway } from '../../websocket/websocket.gateway';
import { looksPromotional, TransportSignals } from './email-triage';
import { extractPromotion } from './promo-extract';

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

      const conditions: Record<string, any> = { signature: promo.signature };
      if (promo.threshold_qty != null) conditions.min_qty = promo.threshold_qty;
      if (promo.threshold_amount != null) conditions.min_amount = promo.threshold_amount;
      if (promo.promo_code) conditions.code = promo.promo_code;
      if (promo.valid_text) conditions.valid_text = promo.valid_text;

      const applicableWines = await this.matchApplicableWines(ctx.restaurantId, `${ctx.subject ?? ''}\n${ctx.body ?? ''}`);

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

      // Notify (notify-only). Priority: relevant to wines we buy, or expiring within a week.
      const relevant = applicableWines.length > 0;
      const expiringSoon =
        promo.valid_until != null && new Date(promo.valid_until).getTime() - Date.now() < 7 * 86_400_000;
      const provider = ctx.providerName || 'A supplier';
      this.websocketGateway.emitRestaurantNotification(ctx.restaurantId, {
        id: inserted.id,
        title: relevant ? `${provider} promo on wines you buy` : `${provider} promotion`,
        message: `${promo.summary}${relevant ? ` — matches ${applicableWines.length} of your wines` : ''}.`,
        type: relevant || expiringSoon ? 'warning' : 'info',
        action_url: `/providers?promotions=1`,
      });

      this.logger.log(
        `PromotionExtractor: stored ${promo.promo_type} promo ${inserted.id} for provider ${ctx.providerId} ` +
          `(conf=${promo.confidence}, relevant=${relevant}).`,
      );
      return { stored: true };
    } catch (e: any) {
      this.logger.warn(`PromotionExtractor failed: ${e?.message}`);
      return { stored: false, reason: 'error' };
    }
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
