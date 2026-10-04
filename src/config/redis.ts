import Redis, { RedisOptions } from 'ioredis';
import { env } from '@/config/env';
import { logger } from '@/config/logger';

// ---------------------------------------------------------------------------
// Redis client
// ---------------------------------------------------------------------------
const redisOptions: RedisOptions | string = env.REDIS_URL
  ? env.REDIS_URL
  : {
      host: env.REDIS_HOST,
      port: env.REDIS_PORT,
      password: env.REDIS_PASSWORD || undefined,
      lazyConnect: false,
      retryStrategy(times: number) {
        const delay = Math.min(times * 50, 2000);
        logger.warn(`Redis reconnect attempt #${times}, retrying in ${delay}ms`);
        return delay;
      },
      maxRetriesPerRequest: 3,
    };

export const redis = typeof redisOptions === 'string' ? new Redis(redisOptions) : new Redis(redisOptions);

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------
redis.on('connect', () => {
  logger.info('Redis client connected', {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
  });
});

redis.on('ready', () => {
  logger.info('Redis client ready to receive commands');
});

redis.on('error', (err: Error) => {
  logger.error('Redis client error', {
    error: err.message,
  });
});

redis.on('close', () => {
  logger.warn('Redis connection closed');
});

redis.on('reconnecting', () => {
  logger.warn('Redis client reconnecting...');
});

redis.on('end', () => {
  logger.warn('Redis connection ended');
});

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/**
 * Get and parse a JSON value from Redis
 */
export async function getJson<T = unknown>(key: string): Promise<T | null> {
  try {
    const value = await redis.get(key);
    if (value === null) return null;
    return JSON.parse(value) as T;
  } catch (error) {
    logger.error('Redis getJson failed', { key, error });
    return null;
  }
}

/**
 * Serialize and store a JSON value in Redis with optional TTL (seconds)
 */
export async function setJson<T = unknown>(
  key: string,
  value: T,
  ttlSeconds?: number
): Promise<void> {
  try {
    const serialized = JSON.stringify(value);
    if (ttlSeconds) {
      await redis.setex(key, ttlSeconds, serialized);
    } else {
      await redis.set(key, serialized);
    }
  } catch (error) {
    logger.error('Redis setJson failed', { key, error });
    throw error;
  }
}

/**
 * Delete one or more keys from Redis
 */
export async function del(...keys: string[]): Promise<number> {
  try {
    return await redis.del(...keys);
  } catch (error) {
    logger.error('Redis del failed', { keys, error });
    throw error;
  }
}

/**
 * Check if a key exists in Redis
 */
export async function exists(key: string): Promise<boolean> {
  try {
    const result = await redis.exists(key);
    return result === 1;
  } catch (error) {
    logger.error('Redis exists failed', { key, error });
    return false;
  }
}

/**
 * Set a string value with TTL
 */
export async function setWithTTL(
  key: string,
  value: string,
  ttlSeconds: number
): Promise<void> {
  await redis.setex(key, ttlSeconds, value);
}

/**
 * Get a string value
 */
export async function getString(key: string): Promise<string | null> {
  return redis.get(key);
}
