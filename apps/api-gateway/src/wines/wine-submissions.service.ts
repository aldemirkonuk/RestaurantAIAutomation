import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { DatabaseService } from '../database/database.service';
import { CreateWineSubmissionDto } from './dto/wine-submissions.dto';

type SubmissionRow = {
  id: string;
  payload: Record<string, any>;
  normalized_fields?: Record<string, any> | null;
  signature_hash?: string | null;
  status: string;
  matched_master_id?: string | null;
};

@Injectable()
export class WineSubmissionsService {
  private readonly logger = new Logger(WineSubmissionsService.name);

  constructor(private readonly dbService: DatabaseService) {}

  private normalizeText(value?: string | null): string {
    if (!value) return '';
    return value
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/[^a-zA-Z0-9]+/g, ' ')
      .trim()
      .toLowerCase();
  }

  private buildSignature(payload: CreateWineSubmissionDto): string {
    const producer = this.normalizeText(payload.producer);
    const name = this.normalizeText(payload.name);
    const vintage = payload.vintage ?? 'NV';
    const country = this.normalizeText(payload.country);
    const region = this.normalizeText(payload.region);
    const primaryType = this.normalizeText(payload.primaryType);
    const grapeVariety = this.normalizeText(payload.grapeVariety);
    return [producer, name, vintage, country, region, primaryType, grapeVariety].join('|');
  }

  private hashSignature(signature: string): string {
    return createHash('sha256').update(signature).digest('hex');
  }

  private generateWineId(): string {
    const suffix = Math.random().toString(36).slice(2, 8);
    const timestamp = Date.now().toString(36).slice(-8);
    return `WINE_${timestamp}${suffix}`.slice(0, 20);
  }

  async submitWine(
    restaurantId: string,
    userId: string,
    payload: CreateWineSubmissionDto,
  ) {
    const signature = this.buildSignature(payload);
    const signatureHash = this.hashSignature(signature);
    const normalizedFields = {
      normalized_name: this.normalizeText(payload.name),
      normalized_producer: this.normalizeText(payload.producer),
      vintage: payload.vintage ?? null,
      country: this.normalizeText(payload.country),
      region: this.normalizeText(payload.region),
      primary_type: this.normalizeText(payload.primaryType),
      grape_variety: this.normalizeText(payload.grapeVariety),
    };

    const { data, error } = await this.dbService.supabase
      .from('master_wine_library_submissions')
      .insert({
        restaurant_id: restaurantId,
        submitted_by: userId,
        payload,
        normalized_fields: normalizedFields,
        signature_hash: signatureHash,
        status: 'pending',
      })
      .select('*')
      .single();

    if (error) {
      this.logger.error('Failed to submit wine', { error: error.message });
      throw error;
    }

    return data;
  }

  async listSubmissions(status?: string, limit = 50) {
    let query = this.dbService.supabase
      .from('master_wine_library_submissions')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  async processPendingSubmissions(limit = 50) {
    const { data, error } = await this.dbService.supabase
      .from('master_wine_library_submissions')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(limit);

    if (error) throw error;
    const submissions = (data || []) as SubmissionRow[];

    const results: Array<{ id: string; status: string; matchedMasterId?: string | null }> = [];

    for (const submission of submissions) {
      const payload = submission.payload as CreateWineSubmissionDto;
      const signature = this.buildSignature(payload);
      const signatureHash = submission.signature_hash || this.hashSignature(signature);

      // Exact signature match
      const { data: existingMaster } = await this.dbService.supabase
        .from('master_wine_library')
        .select('id')
        .eq('signature_hash', signatureHash)
        .maybeSingle();

      if (existingMaster?.id) {
        await this.dbService.supabase
          .from('master_wine_library_submissions')
          .update({
            status: 'merged',
            matched_master_id: existingMaster.id,
            decision_reason: 'signature_match',
            signature_hash: signatureHash,
          })
          .eq('id', submission.id);
        results.push({ id: submission.id, status: 'merged', matchedMasterId: existingMaster.id });
        continue;
      }

      // Conservative review: same name+producer, different vintage
      const normalizedName = this.normalizeText(payload.name);
      const normalizedProducer = this.normalizeText(payload.producer);
      const { data: nameProducerMatch } = await this.dbService.supabase
        .from('master_wine_library')
        .select('id, vintage')
        .eq('normalized_name', normalizedName)
        .eq('normalized_producer', normalizedProducer)
        .limit(1);

      if (nameProducerMatch && nameProducerMatch.length > 0) {
        await this.dbService.supabase
          .from('master_wine_library_submissions')
          .update({
            status: 'pending_review',
            decision_reason: 'name_producer_match',
            signature_hash: signatureHash,
          })
          .eq('id', submission.id);
        results.push({ id: submission.id, status: 'pending_review' });
        continue;
      }

      const wineId = payload['wineId'] || this.generateWineId();
      const insertPayload = {
        wine_id: wineId,
        name: payload.name,
        producer: payload.producer,
        vintage: payload.vintage ?? null,
        price_reference: payload.priceReference ?? null,
        primary_type: payload.primaryType ?? 'unknown',
        grape_variety: payload.grapeVariety ?? null,
        country: payload.country ?? 'Unknown',
        region: payload.region ?? 'Unknown',
        appellation: payload.appellation ?? null,
        sub_region: payload.subRegion ?? null,
        wine_structure: payload.wineStructure ?? null,
        sensory_profile: payload.sensoryProfile ?? null,
        signature_hash: signatureHash,
        normalized_name: normalizedName,
        normalized_producer: normalizedProducer,
        signature_source: 'submission',
      };

      const { data: upserted, error: upsertError } = await this.dbService.supabase
        .from('master_wine_library')
        .upsert(insertPayload, { onConflict: 'signature_hash' })
        .select('id')
        .single();

      if (upsertError) {
        this.logger.error('Failed to upsert master wine', { error: upsertError.message });
        await this.dbService.supabase
          .from('master_wine_library_submissions')
          .update({
            status: 'pending',
            decision_reason: upsertError.message,
            signature_hash: signatureHash,
          })
          .eq('id', submission.id);
        results.push({ id: submission.id, status: 'pending' });
        continue;
      }

      await this.dbService.supabase
        .from('master_wine_library_submissions')
        .update({
          status: 'accepted',
          matched_master_id: upserted?.id ?? null,
          decision_reason: 'upserted',
          signature_hash: signatureHash,
        })
        .eq('id', submission.id);

      results.push({ id: submission.id, status: 'accepted', matchedMasterId: upserted?.id ?? null });
    }

    return { processed: results.length, results };
  }
}
