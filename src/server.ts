import * as dotenv from 'dotenv';
// Load environment variables early
dotenv.config();

import http from 'http';
import app from './app';
import { env } from '@/config/env';
import { logger } from '@/config/logger';
import { testConnection, prisma } from '@/config/database';
import { redis } from '@/config/redis';
import { initializeSocket } from '@/sockets/socket.handler';
import { initializeJobs } from '@/jobs';

const PORT = env.PORT || 3000;

async function bootstrap() {
  try {
    // 1. Test database connection
    await testConnection();

    // 2. Create HTTP Server
    const server = http.createServer(app);

    // 3. Initialize Sockets
    initializeSocket(server);
    logger.info('Socket.IO initialized successfully');

    // 4. Initialize Background Jobs
    initializeJobs();

    // 5. Start listening
    server.listen(PORT, () => {
      logger.info(`==================================================`);
      logger.info(`  Naforo Backend Server started on port ${PORT}  `);
      logger.info(`  Environment: ${process.env.NODE_ENV}            `);
      logger.info(`  API Base Path: ${env.APP_URL}${env.API_PREFIX}  `);
      logger.info(`==================================================`);
    });

    // 6. Graceful Shutdown handlers
    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}. Starting graceful shutdown...`);

      // Close HTTP server
      server.close(() => {
        logger.info('HTTP server closed.');
      });

      // Disconnect Redis
      try {
        await redis.quit();
        logger.info('Redis connection closed.');
      } catch (err) {
        logger.error('Error during Redis disconnection', err);
      }

      // Disconnect Prisma
      try {
        await prisma.$disconnect();
        logger.info('Database connection closed via Prisma Client.');
      } catch (err) {
        logger.error('Error during Prisma disconnection', err);
      }

      logger.info('Graceful shutdown completed. Exiting process.');
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

  } catch (error) {
    logger.error('Bootstrap process failed', error);
    process.exit(1);
  }
}

bootstrap();

