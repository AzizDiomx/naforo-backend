import { PrismaClient } from '@prisma/client';
import { logger } from '@/config/logger';

const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: [
      { emit: 'event', level: 'query' },
      { emit: 'event', level: 'error' },
      { emit: 'event', level: 'info' },
      { emit: 'event', level: 'warn' },
    ],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

// Setup event listeners for logging
if (!globalForPrisma.prisma) {
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
}

export async function testConnection(): Promise<void> {
  try {
    await prisma.$connect();
    logger.info('Database connection established via Prisma Client');

    // Auto-synchronisation idempotente des colonnes et tables critiques en production
    try {
      await prisma.$executeRawUnsafe(`
        ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS "maxLots" INTEGER NOT NULL DEFAULT 1;
      `);
      await prisma.$executeRawUnsafe(`
        ALTER TABLE tenant_profiles ADD COLUMN IF NOT EXISTS "nationalIdType" TEXT DEFAULT 'cni';
      `);
      await prisma.$executeRawUnsafe(`
        ALTER TABLE tenant_profiles ADD COLUMN IF NOT EXISTS "nationalIdDocUrl" TEXT;
      `);
      await prisma.$executeRawUnsafe(`
        UPDATE subscription_plans SET "maxLots" = 5, "maxProperties" = 25, "maxTenants" = 25 WHERE code = 'pro' AND "maxLots" <= 1;
      `);
      await prisma.$executeRawUnsafe(`
        UPDATE subscription_plans SET "maxLots" = 9999, "maxProperties" = 9999, "maxTenants" = 9999 WHERE code = 'expert' AND "maxLots" <= 1;
      `);
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS uploaded_files (
          filename TEXT PRIMARY KEY,
          "mimeType" TEXT NOT NULL,
          "originalName" TEXT,
          "size" INTEGER,
          "data" BYTEA NOT NULL,
          "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
    } catch (syncErr) {
      logger.warn('Auto-sync SQL schema warning (non-blocking):', syncErr);
    }
  } catch (error) {
    logger.error('Failed to connect to database via Prisma Client', {
      error: error instanceof Error ? error.message : error,
    });
    throw error;
  }
}

