import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google, gmail_v1 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { CacheService } from '../common/cache/cache.service';

/**
 * GmailWatchService manages Gmail API push notifications via Google Pub/Sub.
 *
 * Flow:
 *  1. On init, calls gmail.users.watch() to subscribe to INBOX changes.
 *  2. Gmail sends push notifications to the Pub/Sub topic when new emails arrive.
 *  3. The webhook endpoint (in communications.controller.ts) receives the push,
 *     fetches new messages via history.list(), and publishes to RabbitMQ.
 *  4. Watch expires after 7 days — we auto-renew every 6 days.
 */
@Injectable()
export class GmailWatchService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GmailWatchService.name);
  private oauth2Client: OAuth2Client;
  private gmail: gmail_v1.Gmail;
  private isConfigured = false;
  private renewalTimer: NodeJS.Timeout | null = null;
  private readonly HISTORY_ID_KEY = 'gmail:watch:historyId';
  private readonly WATCH_EXPIRY_KEY = 'gmail:watch:expiration';

  constructor(
    private readonly configService: ConfigService,
    private readonly cacheService: CacheService,
  ) {}

  async onModuleInit() {
    const clientId = this.configService.get<string>('GMAIL_CLIENT_ID');
    const clientSecret = this.configService.get<string>('GMAIL_CLIENT_SECRET');
    const refreshToken = this.configService.get<string>('GMAIL_REFRESH_TOKEN');
    const pubsubTopic = this.configService.get<string>('GMAIL_PUBSUB_TOPIC');

    if (!clientId || !clientSecret || !refreshToken) {
      this.logger.warn(
        'Gmail API credentials not configured — Gmail Watch disabled.',
      );
      return;
    }

    if (!pubsubTopic) {
      this.logger.warn(
        'GMAIL_PUBSUB_TOPIC not set — Gmail Watch disabled. Set it to enable inbound email processing.',
      );
      return;
    }

    try {
      this.oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
      this.oauth2Client.setCredentials({ refresh_token: refreshToken });

      const tokenTimeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('getAccessToken timed out after 8s')), 8000),
      );
      const { token } = await Promise.race([
        this.oauth2Client.getAccessToken(),
        tokenTimeout,
      ]);
      if (!token) {
        throw new Error('Failed to obtain Gmail access token');
      }

      this.gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });
      this.isConfigured = true;
      this.logger.log('Gmail API initialized for Watch service');

      // Start watching
      await this.startWatch();

      // Schedule renewal every 6 days (watch expires after 7)
      const SIX_DAYS_MS = 6 * 24 * 60 * 60 * 1000;
      this.renewalTimer = setInterval(async () => {
        try {
          await this.startWatch();
        } catch (error) {
          this.logger.error(`Failed to renew Gmail watch: ${error}`);
        }
      }, SIX_DAYS_MS);

      this.logger.log('Gmail Watch renewal scheduled (every 6 days)');
    } catch (error) {
      this.logger.error(`Failed to initialize Gmail Watch: ${error}`);
    }
  }

  onModuleDestroy() {
    if (this.renewalTimer) {
      clearInterval(this.renewalTimer);
      this.renewalTimer = null;
    }
  }

  /**
   * Start or renew the Gmail watch subscription
   */
  async startWatch(): Promise<void> {
    if (!this.isConfigured) return;

    const topicName = this.configService.get<string>('GMAIL_PUBSUB_TOPIC');
    const labelIds =
      this.configService.get<string>('GMAIL_WATCH_LABEL_IDS')?.split(',') || [
        'INBOX',
      ];

    try {
      const response = await this.gmail.users.watch({
        userId: 'me',
        requestBody: {
          topicName,
          labelIds,
          labelFilterBehavior: 'INCLUDE',
        },
      });

      const historyId = response.data.historyId;
      const expiration = response.data.expiration;

      // Store historyId in Redis for incremental fetches
      if (historyId) {
        await this.cacheService.set(this.HISTORY_ID_KEY, historyId.toString(), 604800); // 7 days TTL
      }
      if (expiration) {
        await this.cacheService.set(this.WATCH_EXPIRY_KEY, expiration.toString(), 604800);
      }

      this.logger.log(
        `Gmail Watch started — historyId: ${historyId}, expires: ${expiration ? new Date(Number(expiration)).toISOString() : 'unknown'}`,
      );
    } catch (error) {
      this.logger.error(`Failed to start Gmail watch: ${error}`);
      throw error;
    }
  }

  /**
   * Stop the Gmail watch subscription
   */
  async stopWatch(): Promise<void> {
    if (!this.isConfigured) return;

    try {
      await this.gmail.users.stop({ userId: 'me' });
      this.logger.log('Gmail Watch stopped');
    } catch (error) {
      this.logger.error(`Failed to stop Gmail watch: ${error}`);
    }
  }

  /**
   * Get the stored historyId for incremental message fetches
   */
  async getLastHistoryId(): Promise<string | null> {
    return this.cacheService.get(this.HISTORY_ID_KEY);
  }

  /**
   * Update the stored historyId after processing messages
   */
  async updateHistoryId(historyId: string): Promise<void> {
    await this.cacheService.set(this.HISTORY_ID_KEY, historyId, 604800);
  }

  /**
   * Fetch new messages since the last historyId using gmail.users.history.list()
   */
  async fetchNewMessages(sinceHistoryId: string): Promise<gmail_v1.Schema$Message[]> {
    if (!this.isConfigured) return [];

    try {
      const historyResponse = await this.gmail.users.history.list({
        userId: 'me',
        startHistoryId: sinceHistoryId,
        historyTypes: ['messageAdded'],
        labelId: 'INBOX',
      });

      const history = historyResponse.data.history || [];
      const messages: gmail_v1.Schema$Message[] = [];

      for (const entry of history) {
        for (const added of entry.messagesAdded || []) {
          if (added.message?.id) {
            // Fetch full message
            const fullMessage = await this.gmail.users.messages.get({
              userId: 'me',
              id: added.message.id,
              format: 'full',
            });
            messages.push(fullMessage.data);
          }
        }
      }

      // Update historyId to latest
      if (historyResponse.data.historyId) {
        await this.updateHistoryId(historyResponse.data.historyId.toString());
      }

      return messages;
    } catch (error: any) {
      // 404 means historyId is too old — need a full sync
      if (error?.code === 404) {
        this.logger.warn('History ID expired — performing full re-watch');
        await this.startWatch();
        return [];
      }
      this.logger.error(`Failed to fetch new messages: ${error}`);
      return [];
    }
  }

  /**
   * Fetch a single attachment's bytes (base64url) by messageId + attachmentId.
   * Returns null if the service isn't configured or the fetch fails.
   */
  async getAttachment(
    messageId: string,
    attachmentId: string,
  ): Promise<string | null> {
    if (!this.isConfigured) return null;
    try {
      const res = await this.gmail.users.messages.attachments.get({
        userId: 'me',
        messageId,
        id: attachmentId,
      });
      return res.data.data || null; // base64url-encoded bytes
    } catch (error) {
      this.logger.error(
        `Failed to fetch attachment ${attachmentId} on message ${messageId}: ${error}`,
      );
      return null;
    }
  }

  /**
   * Get a specific message by ID with full content
   */
  async getMessage(messageId: string): Promise<gmail_v1.Schema$Message | null> {
    if (!this.isConfigured) return null;

    try {
      const response = await this.gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'full',
      });
      return response.data;
    } catch (error) {
      this.logger.error(`Failed to get message ${messageId}: ${error}`);
      return null;
    }
  }

  /**
   * Check if the service is configured and ready
   */
  isReady(): boolean {
    return this.isConfigured;
  }
}
