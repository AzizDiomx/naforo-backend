import { PrismaClient } from '@prisma/client';
import { logger } from '@/config/logger';

export const prisma = new PrismaClient({
  log: [
    { emit: 'event', level: 'query' },
    { emit: 'event', level: 'error' },
    { emit: 'event', level: 'info' },
    { emit: 'event', level: 'warn' },
  ],
});

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

// Setup event listeners for logging
(prisma as any).$on('query', (e: any) => {
  logger.debug(`Prisma Query: ${e.query} | Params: ${e.params} | Duration: ${e.duration}ms`);
});

(prisma as any).$on('error', (e: any) => {
  logger.error(`Prisma Error: ${e.message}`);
});

(prisma as any).$on('info', (e: any) => {
  logger.info(`Prisma Info: ${e.message}`);
});

(prisma as any).$on('warn', (e: any) => {
  logger.warn(`Prisma Warning: ${e.message}`);
});

export async function testConnection(): Promise<void> {
  try {
    await prisma.$connect();
    logger.info('Database connection established via Prisma Client');
  } catch (error) {
    logger.error('Failed to connect to database via Prisma Client', {
      error: error instanceof Error ? error.message : error,
    });
    throw error;
  }
}

