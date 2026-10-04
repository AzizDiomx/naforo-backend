import Redis, { RedisOptions } from 'ioredis';
import { env } from '@/config/env';
import { logger } from '@/config/logger';

// ---------------------------------------------------------------------------
// Environment detection
// ---------------------------------------------------------------------------
const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

// ---------------------------------------------------------------------------
// Redis client factory with TLS SNI support
// ---------------------------------------------------------------------------
function buildRedisClient(): Redis {
  const retryStrategy = (times: number) => {
    if (isServerless && times > 3) {
      logger.warn(`Redis max reconnection attempts reached (${times}), stopping retries.`);
      return null;
    }
    const delay = Math.min(times * 100, 3000);
    logger.warn(`Redis reconnect attempt #${times}, retrying in ${delay}ms`);
    return delay;
  };

  const commonOptions: RedisOptions = {
    maxRetriesPerRequest: 3,
    connectTimeout: 10000,
    retryStrategy,
    lazyConnect: false,
  };

  if (env.REDIS_URL) {
    try {
      const parsedUrl = new URL(env.REDIS_URL);
      const isRemoteHost = parsedUrl.hostname !== 'localhost' && parsedUrl.hostname !== '127.0.0.1';
      const isTls =
        parsedUrl.protocol === 'rediss:' ||
        parsedUrl.hostname.includes('layerbase') ||
        parsedUrl.hostname.includes('upstash') ||
        parsedUrl.port === '6380' ||
        process.env.REDIS_TLS === 'true';

      const options: RedisOptions = {
        ...commonOptions,
      };

      // Set TLS with SNI servername as required by Layerbase, Upstash, and cloud Redis providers
      if (isTls || isRemoteHost) {
        options.tls = {
          servername: parsedUrl.hostname,
        };
      }

      logger.info('Initializing Redis client with REDIS_URL', {
        host: parsedUrl.hostname,
        tls: Boolean(options.tls),
        servername: options.tls ? (options.tls as any).servername : undefined,
      });

      return new Redis(env.REDIS_URL, options);
    } catch (err) {
      logger.error('Failed to parse REDIS_URL, falling back to direct connection string', { err });
      return new Redis(env.REDIS_URL, commonOptions);
    }
  }

  // Host / Port based configuration
  const isRemote = env.REDIS_HOST !== 'localhost' && env.REDIS_HOST !== '127.0.0.1';
  const isTls =
    isRemote &&
    (env.REDIS_HOST.includes('layerbase') ||
      env.REDIS_HOST.includes('upstash') ||
      env.REDIS_PORT === 6380 ||
      process.env.REDIS_TLS === 'true');

  const options: RedisOptions = {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD || undefined,
    ...commonOptions,
  };

  if (isTls) {
    options.tls = {
      servername: env.REDIS_HOST,
    };
  }

  return new Redis(options);
}

export const redis = buildRedisClient();

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
