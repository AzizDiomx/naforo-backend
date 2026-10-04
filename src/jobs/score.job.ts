import { Job } from 'bull';
import { logger } from '@/config/logger';
import { prisma } from '@/config/database';

let tenantProfilesService: any;
import('@/modules/tenant-profiles/tenant-profiles.service').then((m) => {
  tenantProfilesService = m.tenantProfilesService;
});

export async function processScoreJob(job: Job): Promise<void> {
  logger.info(`Starting reliability scores recalculation job: ${job.id}`);
  const start = Date.now();

  try {
    if (!tenantProfilesService) {
      await new Promise((r) => setTimeout(r, 1000));
    }

    const profiles = await prisma.tenantProfile.findMany({
      where: { isActive: true },
      select: { id: true },
    });

    logger.debug(`Recalculating scores for ${profiles.length} tenants`);

    for (const profile of profiles) {
      await tenantProfilesService.calculateReliabilityScore(profile.id);
    }

    const duration = Date.now() - start;
    logger.info(`Reliability scores job completed in ${duration}ms: ${job.id}`);
  } catch (error) {
    logger.error(`Reliability scores job failed: ${job.id}`, error);
    throw error;
  }
}
