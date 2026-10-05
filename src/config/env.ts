import { z } from 'zod';
import * as dotenv from 'dotenv';

dotenv.config();

// ---------------------------------------------------------------------------
// Helper to coerce string booleans
// ---------------------------------------------------------------------------
const booleanString = z
  .string()
  .transform((val) => val === 'true' || val === '1')
  .or(z.boolean());

const numberString = (defaultVal?: number) =>
  z
    .string()
    .transform((val) => parseInt(val, 10))
    .refine((val) => !isNaN(val), { message: 'Must be a valid number' })
    .or(z.number())
    .default(defaultVal !== undefined ? String(defaultVal) : undefined as unknown as string);

// ---------------------------------------------------------------------------
// Environment schema
// ---------------------------------------------------------------------------
const envSchema = z.object({
  // Application
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z
    .string()
    .transform((v) => parseInt(v, 10))
    .default('3000'),
  API_PREFIX: z.string().default('/api/v1'),
  CORS_ORIGINS: z.string().default('https://backoffice.naforo.company,https://tenant.naforo.company,https://naforo.company,http://localhost:3000,http://localhost:3001,http://localhost:3002,http://localhost:3003,http://localhost:3004'),

  // Database
  DATABASE_URL: z.string().optional(),
  DB_HOST: z.string().default('localhost'),
  DB_PORT: z
    .string()
    .transform((v) => parseInt(v, 10))
    .default('5432'),
  DB_NAME: z.string().default('Naforo'),
  DB_USER: z.string().default('Naforo'),
  DB_PASSWORD: z.string().default('naforo_secret'),
  DB_SSL: booleanString.default('false'),
  DB_POOL_MAX: z
    .string()
    .transform((v) => parseInt(v, 10))
    .default('10'),

  // Redis
  REDIS_URL: z.string().optional(),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z
    .string()
    .transform((v) => parseInt(v, 10))
    .default('6379'),
  REDIS_PASSWORD: z.string().optional(),

  // JWT
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  // Security
  BCRYPT_ROUNDS: z
    .string()
    .transform((v) => parseInt(v, 10))
    .default('12'),

  // Email (SMTP - Hostinger naforo.company)
  SMTP_HOST: z.string().default('smtp.hostinger.com'),
  SMTP_PORT: z
    .string()
    .transform((v) => parseInt(v, 10))
    .default('465'),
  SMTP_SECURE: booleanString.default('true'),
  SMTP_USER: z.string().optional().transform((v) => v || process.env.MAIL_USER || 'aziz.diomande@naforo.company'),
  SMTP_PASS: z.string().optional().transform((v) => v || process.env.MAIL_PASS),
  SMTP_FROM_NAME: z.string().default('Naforo'),
  SMTP_FROM_EMAIL: z.string().email().default('info@naforo.company'),

  // Email Fallback (SMTP Secours - Google Gmail)
  GMAIL_SMTP_HOST: z.string().default('smtp.gmail.com'),
  GMAIL_SMTP_PORT: z
    .string()
    .transform((v) => parseInt(v, 10))
    .default('587'),
  GMAIL_SMTP_SECURE: booleanString.default('false'),
  GMAIL_USER: z.string().optional().transform((v) => v || process.env.GOOGLE_MAIL_USER || 'ismaeldiom70@gmail.com'),
  GMAIL_PASS: z.string().optional().transform((v) => v || process.env.GOOGLE_MAIL_PASS || 'umzf ceuy wgad xutw'),

  // Twilio
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_PHONE_NUMBER: z.string().optional(),

  // Firebase
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_PRIVATE_KEY: z.string().optional(),
  FIREBASE_CLIENT_EMAIL: z.string().optional(),

  // File Upload
  UPLOAD_DIR: z.string().default('uploads'),
  UPLOAD_MAX_SIZE: z
    .string()
    .transform((v) => parseInt(v, 10))
    .default('10485760'),
  UPLOAD_ALLOWED_TYPES: z
    .string()
    .default('image/jpeg,image/png,image/webp,application/pdf'),

  // URLs
  APP_URL: z.string().url().default('http://localhost:3000'),
  FRONTEND_URL: z.string().url().default('http://localhost:3001'),
  BACKOFFICE_URL: z.string().url().default('http://localhost:3002'),

  // Logging
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly']).default('debug'),
  LOG_DIR: z.string().default('logs'),

  // Super Admin
  SUPER_ADMIN_EMAIL: z.string().email().optional(),
  SUPER_ADMIN_PASSWORD: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Parse and export
// ---------------------------------------------------------------------------
const _parsed = envSchema.safeParse(process.env);

if (!_parsed.success) {
  console.error('❌ Invalid environment variables:');
  const errors = _parsed.error.flatten().fieldErrors;
  Object.entries(errors).forEach(([key, messages]) => {
    console.error(`  • ${key}: ${messages?.join(', ')}`);
  });
  process.exit(1);
}

export const env = _parsed.data;

export type Env = typeof env;


