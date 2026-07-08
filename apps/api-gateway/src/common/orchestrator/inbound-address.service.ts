import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { DatabaseService } from '../../database/database.service';

/**
 * InboundAddressService — Phase 1 dedicated-domain inbound addressing.
 *
 * Each restaurant gets a unique, opaque inbound address `r-<token>@INBOUND_EMAIL_DOMAIN`.
 * The inbound webhook resolves the recipient address to a restaurant_id, so cold-email
 * attribution is DERIVED from transport (the address the vendor emailed) instead of guessed
 * (see .planning/PROSPECTS_ATTRIBUTION_ARCHITECTURE.md).
 *
 * Entirely config-gated: with no INBOUND_EMAIL_DOMAIN set, every method is a safe no-op
 * (returns null) and the legacy single-mailbox (Gmail) path is completely unaffected.
 * Best-effort throughout — tolerates the table not existing yet.
 */
@Injectable()
export class InboundAddressService {
  private readonly logger = new Logger(InboundAddressService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly configService: ConfigService,
  ) {}

  /** Configured inbound domain (e.g. "in.wineops.ai"), or null when the feature is off. */
  domain(): string | null {
    const d = (this.configService.get<string>('INBOUND_EMAIL_DOMAIN') || '').trim().toLowerCase();
    return d || null;
  }

  /** Bare, lowercased email address from a raw value or `Name <a@b.com>`. */
  normalize(raw: string | null | undefined): string {
    const s = (raw ?? '').toString().trim().toLowerCase();
    if (!s) return '';
    const angled = s.match(/<([^>]+)>/);
    const addr = (angled ? angled[1] : s).trim();
    return addr.includes('@') ? addr : '';
  }

  /** The active inbound address for a restaurant, provisioning one on first use. */
  async addressFor(restaurantId: string): Promise<string | null> {
    if (!this.domain() || !restaurantId) return null;
    try {
      const { data } = await this.databaseService.supabase
        .from('restaurant_inbound_addresses')
        .select('address')
        .eq('restaurant_id', restaurantId)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();
      if ((data as any)?.address) return (data as any).address;
    } catch {
      return null; // table missing / mid-migration — stay a no-op
    }
    return this.provision(restaurantId);
  }

  /** Provision a new opaque inbound address for a restaurant. Safe under races/duplicates. */
  async provision(restaurantId: string): Promise<string | null> {
    const domain = this.domain();
    if (!domain || !restaurantId) return null;
    const token = `r-${randomBytes(4).toString('hex')}`;
    const address = `${token}@${domain}`;
    try {
      const { error } = await this.databaseService.supabase
        .from('restaurant_inbound_addresses')
        .insert({
          restaurant_id: restaurantId,
          address,
          token,
          provider: this.configService.get<string>('INBOUND_EMAIL_PROVIDER') || null,
          is_active: true,
        });
      if (error) {
        // Already provisioned (unique index) or raced — return the existing active address.
        const { data } = await this.databaseService.supabase
          .from('restaurant_inbound_addresses')
          .select('address')
          .eq('restaurant_id', restaurantId)
          .eq('is_active', true)
          .limit(1)
          .maybeSingle();
        return (data as any)?.address ?? null;
      }
      this.logger.log(`Provisioned inbound address ${address} for restaurant ${restaurantId}.`);
      return address;
    } catch (e: any) {
      this.logger.warn(`provision failed for ${restaurantId}: ${e?.message}`);
      return null;
    }
  }

  /**
   * Resolve one or more recipient addresses to a restaurant_id (first active match wins).
   * Returns null when the feature is off or no address matches (caller routes to triage).
   */
  async resolveRestaurantId(
    recipients: Array<string | null | undefined> | string | null | undefined,
  ): Promise<string | null> {
    if (!this.domain()) return null;
    const list = Array.isArray(recipients) ? recipients : [recipients];
    const addrs = Array.from(new Set(list.map((r) => this.normalize(r)).filter(Boolean)));
    if (!addrs.length) return null;
    try {
      const { data } = await this.databaseService.supabase
        .from('restaurant_inbound_addresses')
        .select('restaurant_id, address')
        .in('address', addrs)
        .eq('is_active', true)
        .limit(1);
      const row = (data as any[])?.[0];
      return row?.restaurant_id ?? null;
    } catch {
      return null;
    }
  }
}
