import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

import { prisma } from '@/config/database';
import { logger } from '@/config/logger';

async function migrate(): Promise<void> {
  const schemaPath = path.join(__dirname, 'schema.sql');

  console.log('🚀 Naforo Database Migration (Prisma Wrapper)');
  console.log('================================');

  if (!fs.existsSync(schemaPath)) {
    console.error(`❌ Schema file not found at: ${schemaPath}`);
    process.exit(1);
  }

  const sql = fs.readFileSync(schemaPath, 'utf-8');

  try {
    console.log('📡 Connected to database via Prisma');
    console.log('⚙️  Running schema migration...\n');

    // Run schema.sql queries
    await prisma.$executeRawUnsafe(sql);

    console.log('✅ Migration completed successfully!');
    console.log('\nTables created/updated:');

    const tablesResult: any[] = await prisma.$queryRawUnsafe(`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename;
    `);

    tablesResult.forEach((row: { tablename: string }) => {
      console.log(`   📋 ${row.tablename}`);
    });

    const indexesResult: any[] = await prisma.$queryRawUnsafe(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
      AND indexname LIKE 'idx_%'
      ORDER BY indexname;
    `);

    console.log('\nIndexes created/updated:');
    indexesResult.forEach((row: { indexname: string }) => {
      console.log(`   🔍 ${row.indexname}`);
    });

    console.log('\n🎉 Database is ready!');
  } catch (error) {
    console.error('\n❌ Migration failed!');
    console.error('Error:', error instanceof Error ? error.message : error);
    logger.error('Migration failed', { error });
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

migrate();

