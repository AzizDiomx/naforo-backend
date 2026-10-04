import Bull from 'bull';
import { env } from '@/config/env';

const redisConfig = {
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: process.env.REDIS_PASSWORD || undefined,
};

export const pdfQueue = new Bull('pdf-generation', { redis: redisConfig });
export const notificationQueue = new Bull('notifications', { redis: redisConfig });
export const emailQueue = new Bull('email', { redis: redisConfig });
export const smsQueue = new Bull('sms', { redis: redisConfig });
export const reminderQueue = new Bull('reminders', { redis: redisConfig });
export const invoiceQueue = new Bull('invoices', { redis: redisConfig });
export const scoreQueue = new Bull('score-recalculation', { redis: redisConfig });
export const exchangeRateQueue = new Bull('exchange-rates', { redis: redisConfig });
export const subscriptionAlertQueue = new Bull('subscription-alerts', { redis: redisConfig });
