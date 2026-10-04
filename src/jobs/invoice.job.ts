import { Job } from 'bull';
import { logger } from '@/config/logger';

// Dynamic import to prevent circular dependencies
let invoicesService: any;
import('@/modules/invoices/invoices.service').then((m) => {
  invoicesService = m.invoicesService;
});

export async function processInvoiceJob(job: Job): Promise<void> {
  const start = Date.now();
  logger.info(`Starting invoice generation job: ${job.id} (${job.name})`);

  try {
    if (job.name === 'generate-monthly-invoices') {
      if (!invoicesService) {
        // Wait briefly for dependencies to load if dynamic import is slow
        await new Promise((r) => setTimeout(r, 1000));
      }
      await invoicesService.generateMonthlyInvoices();
    } else if (job.name === 'generate-single-invoice') {
      const { contractId, month, year } = job.data;
      await invoicesService.generateInvoice(contractId, month, year);
    }
    
    const duration = Date.now() - start;
    logger.info(`Invoice job completed in ${duration}ms: ${job.id}`);
  } catch (error) {
    logger.error(`Invoice job failed: ${job.id}`, error);
    throw error;
  }
}
