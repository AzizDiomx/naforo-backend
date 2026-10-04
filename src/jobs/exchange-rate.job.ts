import { Job } from 'bull';
import { logger } from '@/config/logger';
import { refreshExchangeRates } from '@/modules/accounting/accounting.repository';

export async function processExchangeRateJob(job: Job): Promise<void> {
  logger.info(`Starting exchange rates update job: ${job.id}`);
  const start = Date.now();

  try {
    await refreshExchangeRates();
    const duration = Date.now() - start;
    logger.info(`Exchange rates update job completed in ${duration}ms: ${job.id}`);
  } catch (error) {
    logger.error(`Exchange rates update job failed: ${job.id}`, error);
    throw error;
  }
}
