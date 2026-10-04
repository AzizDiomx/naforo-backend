import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import * as path from 'path';
import { env } from '@/config/env';

// ---------------------------------------------------------------------------
// Environment detection
// ---------------------------------------------------------------------------
// CHANGED: sur Vercel (et AWS Lambda), le FS est en lecture seule
const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const enableFileLogs = env.NODE_ENV !== 'test' && !isServerless;

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

// CHANGED: en serverless, on sort du JSON sur stdout (lisible et filtrable
// dans l'onglet Logs de Vercel), sans couleurs ANSI
const consoleTransportFormat = isServerless
  ? fileFormat
  : combine(
      errors({ stack: true }),
      timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      colorize({ all: true }),
      consoleFormat
    );

// ---------------------------------------------------------------------------
// Transports
// ---------------------------------------------------------------------------
const transports: winston.transport[] = [];

// Console transport (always active)
transports.push(
  new winston.transports.Console({
    level: env.LOG_LEVEL,
    format: consoleTransportFormat,
    silent: env.NODE_ENV === 'test',
  })
);

// File transports (local / VPS / Docker uniquement)
// CHANGED: condition enrichie avec !isServerless
if (enableFileLogs) {
  const logDir = path.resolve(env.LOG_DIR);

  transports.push(
    new DailyRotateFile({
      level: 'info',
      filename: path.join(logDir, 'combined-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '14d',
      format: fileFormat,
    }),
    new DailyRotateFile({
      level: 'error',
      filename: path.join(logDir, 'error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '30d',
      format: fileFormat,
    }),
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