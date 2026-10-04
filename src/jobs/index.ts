import { logger } from '@/config/logger';
import { invoiceQueue, reminderQueue, scoreQueue, emailQueue, smsQueue, notificationQueue, exchangeRateQueue, subscriptionAlertQueue } from '@/queues';

// Processors imports (will be created in subsequent files)
import { processInvoiceJob } from './invoice.job';
import { processReminderJob } from './reminder.job';
import { processScoreJob } from './score.job';
import { processNotificationJob, processEmailJob, processSmsJob } from './notification.job';
import { processExchangeRateJob } from './exchange-rate.job';
import { processSubscriptionAlertJob } from './subscription-alert.job';

export function initializeJobs(): void {
  logger.info('Initializing Bull Queue processors...');

  // 1. Register Processors
  invoiceQueue.process('generate-monthly-invoices', processInvoiceJob);
  invoiceQueue.process('generate-single-invoice', processInvoiceJob);
  
  reminderQueue.process('send-payment-reminders', processReminderJob);
  
  scoreQueue.process('recalculate-scores', processScoreJob);
  
  notificationQueue.process('send-notification', processNotificationJob);
  emailQueue.process('send-email', processEmailJob);
  smsQueue.process('send-sms', processSmsJob);
  
  exchangeRateQueue.process('update-exchange-rates', processExchangeRateJob);
  subscriptionAlertQueue.process('scan-subscription-alerts', processSubscriptionAlertJob);

  // 2. Schedule Cron Jobs (Recurring tasks)
  scheduleCronJobs();
}

async function scheduleCronJobs() {
  try {
    // Clear existing repeatable jobs to avoid duplicates on reload
    const repeatableInvoices = await invoiceQueue.getRepeatableJobs();
    for (const job of repeatableInvoices) {
      await invoiceQueue.removeRepeatableByKey(job.key);
    }
    const repeatableReminders = await reminderQueue.getRepeatableJobs();
    for (const job of repeatableReminders) {
      await reminderQueue.removeRepeatableByKey(job.key);
    }
    const repeatableScores = await scoreQueue.getRepeatableJobs();
    for (const job of repeatableScores) {
      await scoreQueue.removeRepeatableByKey(job.key);
    }
    const repeatableRates = await exchangeRateQueue.getRepeatableJobs();
    for (const job of repeatableRates) {
      await exchangeRateQueue.removeRepeatableByKey(job.key);
    }
    const repeatableAlerts = await subscriptionAlertQueue.getRepeatableJobs();
    for (const job of repeatableAlerts) {
      await subscriptionAlertQueue.removeRepeatableByKey(job.key);
    }

    // Schedule: Monthly invoices on the 1st of each month at 6:00 AM Africa/Abidjan
    await invoiceQueue.add(
      'generate-monthly-invoices',
      {},
      { repeat: { cron: '0 6 1 * *', tz: 'Africa/Abidjan' } }
    );
    logger.info('Cron job scheduled: Generate monthly invoices (0 6 1 * *)');

    // Schedule: Daily reminders at 9:00 AM Africa/Abidjan
    await reminderQueue.add(
      'send-payment-reminders',
      {},
      { repeat: { cron: '0 9 * * *', tz: 'Africa/Abidjan' } }
    );
    logger.info('Cron job scheduled: Send payment reminders daily (0 9 * * *)');

    // Schedule: Weekly score recalculation every Sunday at midnight
    await scoreQueue.add(
      'recalculate-scores',
      {},
      { repeat: { cron: '0 0 * * 0', tz: 'Africa/Abidjan' } }
    );
    logger.info('Cron job scheduled: Recalculate reliability scores weekly (0 0 * * 0)');

    // Schedule: Daily exchange rates update at midnight Africa/Abidjan
    await exchangeRateQueue.add(
      'update-exchange-rates',
      {},
      { repeat: { cron: '0 0 * * *', tz: 'Africa/Abidjan' } }
    );
    logger.info('Cron job scheduled: Update exchange rates daily (0 0 * * *)');

    // Schedule: Daily subscription alerts scanner at 8:00 AM Africa/Abidjan
    await subscriptionAlertQueue.add(
      'scan-subscription-alerts',
      {},
      { repeat: { cron: '0 8 * * *', tz: 'Africa/Abidjan' } }
    );
    logger.info('Cron job scheduled: Scan subscription alerts daily (0 8 * * *)');

  } catch (error) {
    logger.error('Failed to schedule recurring cron jobs', error);
  }
}
