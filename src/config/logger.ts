import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import * as path from 'path';
import { env } from '@/config/env';

// ---------------------------------------------------------------------------
// Custom log formats
// ---------------------------------------------------------------------------
const { combine, timestamp, colorize, printf, json, errors } = winston.format;

const consoleFormat = printf(({ level, message, timestamp: ts, stack, ...meta }) => {
  const metaStr = Object.keys(meta).length ? `\n${JSON.stringify(meta, null, 2)}` : '';
  const stackStr = stack ? `\n${stack}` : '';
  return `${ts} [${level}]: ${message}${stackStr}${metaStr}`;
});

const fileFormat = combine(
  errors({ stack: true }),
  timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
  json()
);

// ---------------------------------------------------------------------------
// Transports
// ---------------------------------------------------------------------------
const transports: winston.transport[] = [];

// Console transport (always active)
transports.push(
  new winston.transports.Console({
    level: env.LOG_LEVEL,
    format: combine(
      errors({ stack: true }),
      timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      colorize({ all: true }),
      consoleFormat
    ),
    silent: env.NODE_ENV === 'test',
  })
);

// File transports (production & development)
if (env.NODE_ENV !== 'test') {
  const logDir = path.resolve(env.LOG_DIR);

  // Combined log (all levels)
  transports.push(
    new DailyRotateFile({
      level: 'info',
      filename: path.join(logDir, 'combined-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '14d',
      format: fileFormat,
    })
  );

  // Error log (errors only)
  transports.push(
    new DailyRotateFile({
      level: 'error',
      filename: path.join(logDir, 'error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '30d',
      format: fileFormat,
    })
  );

  // HTTP access log
  transports.push(
    new DailyRotateFile({
      level: 'http',
      filename: path.join(logDir, 'access-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '50m',
      maxFiles: '7d',
      format: fileFormat,
    })
  );
}

// ---------------------------------------------------------------------------
// Logger instance
// ---------------------------------------------------------------------------
export const logger = winston.createLogger({
  level: env.LOG_LEVEL,
  defaultMeta: {
    service: 'naforo-api',
    env: env.NODE_ENV,
  },
  transports,
  exitOnError: false,
});

// ---------------------------------------------------------------------------
// Morgan stream for HTTP request logging
// ---------------------------------------------------------------------------
export const morganStream = {
  write: (message: string) => {
    logger.http(message.trim());
  },
};

