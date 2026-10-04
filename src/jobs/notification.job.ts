import { Job } from 'bull';
import { logger } from '@/config/logger';
import { sendMail } from '@/config/mailer';
import { sendPushNotification } from '@/config/firebase';
import twilio from 'twilio';
import { env } from '@/config/env';

// Initialize Twilio client optionally
let twilioClient: any;
if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN) {
  twilioClient = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
}

/**
 * Job processor for sending push notifications via Firebase
 */
export async function processNotificationJob(job: Job): Promise<void> {
  const { token, title, body, data } = job.data;
  logger.debug(`Processing push notification job: ${job.id}`);

  try {
    await sendPushNotification(token, title, body, data);
  } catch (error) {
    logger.error(`Failed to send push notification in job ${job.id}`, error);
    throw error;
  }
}

/**
 * Job processor for sending emails via Nodemailer
 */
export async function processEmailJob(job: Job): Promise<void> {
  const { to, subject, html, text, attachments, service } = job.data;
  logger.debug(`Processing email job: ${job.id} to ${to}`);

  try {
    await sendMail(to, subject, html, text, attachments, service);
  } catch (error) {
    logger.error(`Failed to send email in job ${job.id} to ${to}`, error);
    throw error;
  }
}

/**
 * Job processor for sending SMS via Twilio
 */
export async function processSmsJob(job: Job): Promise<void> {
  const { to, body } = job.data;
  logger.debug(`Processing SMS job: ${job.id} to ${to}`);

  try {
    if (twilioClient) {
      await twilioClient.messages.create({
        to,
        from: env.TWILIO_PHONE_NUMBER,
        body,
      });
      logger.info(`SMS sent successfully to ${to}`);
    } else {
      logger.warn(`Twilio credentials not configured. SMS not sent to ${to}. Content: "${body}"`);
    }
  } catch (error) {
    logger.error(`Failed to send SMS in job ${job.id} to ${to}`, error);
    throw error;
  }
}
