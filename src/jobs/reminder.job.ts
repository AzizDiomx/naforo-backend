import { Job } from 'bull';
import { logger } from '@/config/logger';
import { prisma } from '@/config/database';
import { notificationsService } from '@/modules/notifications/notifications.service';

export async function processReminderJob(job: Job): Promise<void> {
  logger.info(`Starting payment reminders job: ${job.id}`);
  const start = Date.now();

  try {
    // 1. Fetch all active contracts that have reminder enabled
    const contracts = await prisma.contract.findMany({
      where: {
        status: 'active',
        paymentReminderEnabled: true,
      },
      include: {
        tenantProfile: true,
        property: true,
        organization: true,
      },
    });

    logger.debug(`Processing reminders for ${contracts.length} active contracts`);

    const today = new Date();
    const currentMonth = today.getMonth() + 1;
    const currentYear = today.getFullYear();
    const currentDay = today.getDate();

    for (const contract of contracts) {
      // Find current month's invoice
      const invoice = await prisma.invoice.findFirst({
        where: {
          contractId: contract.id,
          periodMonth: currentMonth,
          periodYear: currentYear,
          status: { in: ['pending', 'partial', 'overdue'] },
        },
      });

      if (!invoice) {
        continue;
      }

      // Calculate days difference
      const paymentDay = contract.paymentDay;
      const daysOffset = currentDay - paymentDay;

      // Fetch organization admin preferences if available
      let targetOffsets = [-15, -7, -3, 0, 3, 7, 15];

      const adminUser = await prisma.user.findFirst({
        where: { organizationId: contract.organizationId, role: { in: ['admin', 'manager'] } },
        include: { notificationPreferences: true }
      });

      if (adminUser?.notificationPreferences) {
        const prefs = adminUser.notificationPreferences;

        if (prefs.reminderEnabled === false) {
          // Reminders disabled by landlord
          continue;
        }

        const beforeArr = Array.isArray(prefs.reminderDaysBefore) 
          ? (prefs.reminderDaysBefore as number[]).map(d => -Math.abs(d))
          : [-15, -7, -3, -1];

        const afterArr = Array.isArray(prefs.reminderDaysAfter)
          ? (prefs.reminderDaysAfter as number[]).map(d => Math.abs(d))
          : [3, 7, 15];

        targetOffsets = [...beforeArr, 0, ...afterArr];
      }

      if (targetOffsets.includes(daysOffset)) {
        await notificationsService.sendPaymentReminder(contract, invoice, daysOffset);
      }
    }

    const duration = Date.now() - start;
    logger.info(`Payment reminders job completed in ${duration}ms: ${job.id}`);
  } catch (error) {
    logger.error(`Payment reminders job failed: ${job.id}`, error);
    throw error;
  }
}
