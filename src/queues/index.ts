import Bull from 'bull';
import { env } from '@/config/env';

function getBullRedisConfig(): any {
  if (env.REDIS_URL) {
    try {
      const parsed = new URL(env.REDIS_URL);
      const isRemoteHost = parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1';
      const isTls =
        parsed.protocol === 'rediss:' ||
        parsed.hostname.includes('layerbase') ||
        parsed.hostname.includes('upstash') ||
        parsed.port === '6380' ||
        process.env.REDIS_TLS === 'true';

      const config: any = {
        host: parsed.hostname,
        port: Number(parsed.port) || (isTls ? 6380 : 6379),
        password: parsed.password || undefined,
        username: parsed.username || undefined,
      };

      if (isTls || isRemoteHost) {
        config.tls = { servername: parsed.hostname };
      }
      return config;
    } catch (_) {
      return env.REDIS_URL;
    }
  }

  const isRemote = env.REDIS_HOST !== 'localhost' && env.REDIS_HOST !== '127.0.0.1';
  const isTls =
    isRemote &&
    (env.REDIS_HOST.includes('layerbase') ||
      env.REDIS_HOST.includes('upstash') ||
      env.REDIS_PORT === 6380 ||
      process.env.REDIS_TLS === 'true');

  const config: any = {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: process.env.REDIS_PASSWORD || undefined,
  };

  if (isTls) {
    config.tls = { servername: env.REDIS_HOST };
  }

  return config;
}

const redisConfig = getBullRedisConfig();

export const pdfQueue = new Bull('pdf-generation', { redis: redisConfig });
export const notificationQueue = new Bull('notifications', { redis: redisConfig });
export const emailQueue = new Bull('email', { redis: redisConfig });
export const smsQueue = new Bull('sms', { redis: redisConfig });
export const reminderQueue = new Bull('reminders', { redis: redisConfig });
export const invoiceQueue = new Bull('invoices', { redis: redisConfig });
export const scoreQueue = new Bull('score-recalculation', { redis: redisConfig });
export const exchangeRateQueue = new Bull('exchange-rates', { redis: redisConfig });
export const subscriptionAlertQueue = new Bull('subscription-alerts', { redis: redisConfig });
