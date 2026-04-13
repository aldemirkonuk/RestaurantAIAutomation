import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createClient, RedisClientType } from 'redis'

@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name)
  private client: RedisClientType | null = null

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    let redisUrl = this.configService.get<string>('REDIS_URL', '')
    if (!redisUrl) {
      this.logger.warn('⚠️ REDIS_URL not set, caching disabled')
      return
    }
    // Upstash requires TLS — normalise redis:// → rediss://
    if (redisUrl.startsWith('redis://') && redisUrl.includes('upstash.io')) {
      redisUrl = 'rediss://' + redisUrl.slice('redis://'.length)
    }
    try {
      this.client = createClient({
        url: redisUrl,
        socket: {
          connectTimeout: 3000,
          reconnectStrategy: (retries) => (retries > 3 ? false : Math.min(retries * 200, 2000)),
        },
      })
      this.client.on('error', (error) => {
        this.logger.warn(`Redis error: ${error.message || error}`)
      })
      await this.client.connect()
      this.logger.log('✅ Redis cache connected')
    } catch (error) {
      this.logger.warn(`⚠️ Redis unavailable, caching disabled: ${error}`)
      this.client = null
    }
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit()
      this.client = null
      this.logger.log('✅ Redis cache disconnected')
    }
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.client) return null
    const value = await this.client.get(key)
    return value ? (JSON.parse(value) as T) : null
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    if (!this.client) return
    await this.client.set(key, JSON.stringify(value), { EX: ttlSeconds })
  }

  async del(keys: string | string[]): Promise<void> {
    if (!this.client) return
    const targetKeys = Array.isArray(keys) ? keys : [keys]
    if (targetKeys.length > 0) {
      await this.client.del(targetKeys)
    }
  }

  async invalidateByPattern(pattern: string): Promise<number> {
    if (!this.client) return 0
    const keys = await this.client.keys(pattern)
    if (keys.length === 0) return 0
    await this.client.del(keys)
    return keys.length
  }
}
