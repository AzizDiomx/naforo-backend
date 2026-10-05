import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import path from 'path';
import os from 'os';
import cookieParser from 'cookie-parser';
import { env } from '@/config/env';
import { errorMiddleware } from '@/shared/middlewares/error.middleware';
import router from '@/routes';

const app: Express = express();

// Trust reverse proxy (Indispensable sur Vercel, AWS, Cloudflare, etc. pour X-Forwarded-For et rate-limiting)
app.set('trust proxy', 1);

// 1. Basic security & optimization middlewares
app.use(helmet());
app.use(cookieParser());
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 2. Logging with Morgan
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// 3. CORS configuration (Robuste & dynamique pour tous les sous-domaines naforo.company et Vercel)
const defaultAllowedOrigins = [
  'https://backoffice.naforo.company',
  'https://tenant.naforo.company',
  'https://naforo.company',
  'https://www.naforo.company',
  'https://eagence.naforo.company',
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3002',
  'http://localhost:3003',
  'http://localhost:3004',
];

const configuredOrigins = env.CORS_ORIGINS
  ? env.CORS_ORIGINS.split(',').map((o) => o.trim().replace(/\/$/, '')).filter(Boolean)
  : [];

const allowedOriginsSet = new Set([...defaultAllowedOrigins, ...configuredOrigins]);

function isOriginAllowed(origin: string): boolean {
  const normalized = origin.replace(/\/$/, '');
  if (allowedOriginsSet.has(normalized)) return true;

  try {
    const url = new URL(normalized);
    // Autoriser tous les sous-domaines officiels *.naforo.company
    if (url.hostname === 'naforo.company' || url.hostname.endsWith('.naforo.company')) {
      return true;
    }
    // Autoriser les déploiements preview Vercel (*.vercel.app)
    if (url.hostname.endsWith('.vercel.app')) {
      return true;
    }
    // Environnements locaux
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
      return true;
    }
  } catch (_) {}

  return false;
}

const corsMiddleware = cors({
  origin: (origin, callback) => {
    // Requêtes serveur-à-serveur, mobile, healthchecks (pas d'en-tête Origin)
    if (!origin) {
      return callback(null, true);
    }

    if (isOriginAllowed(origin) || process.env.NODE_ENV === 'development') {
      return callback(null, true);
    }

    // Refus standard sans lever d'erreur 500
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin', 'x-auth-token'],
  exposedHeaders: ['Content-Range', 'X-Content-Range', 'Set-Cookie'],
  maxAge: 86400,
});

app.use(corsMiddleware);
app.options('*', corsMiddleware);

// 4. Rate Limiters
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // limit each IP to 1000 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  message: 'Trop de requêtes effectuées depuis cette IP, veuillez réessayer après 15 minutes.',
});
app.use(globalLimiter);

// Specific brute-force protection for Auth routes (Login, Register, Password Reset)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // max 10 requests per 15 minutes per IP
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  message: {
    success: false,
    message: 'Trop de tentatives de connexion ou d\'accès depuis cette adresse IP. Veuillez patienter 15 minutes.'
  },
});

app.use(`${env.API_PREFIX}/auth/login`, authLimiter);
app.use(`${env.API_PREFIX}/auth/register`, authLimiter);
app.use(`${env.API_PREFIX}/auth/forgot-password`, authLimiter);

// 5. Static uploads directory serving
const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const staticUploadsDir = isServerless
  ? path.join(os.tmpdir(), env.UPLOAD_DIR || 'uploads')
  : path.join(process.cwd(), env.UPLOAD_DIR || 'uploads');
app.use('/uploads', express.static(staticUploadsDir));

// 6. Mount central router
app.use(env.API_PREFIX, router);

// 7. Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV,
    version: '1.0.0',
  });
});

// 8. 404 Handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    message: `Ressource introuvable : ${req.method} ${req.originalUrl}`,
  });
});

// 9. Error Handler (Last)
app.use(errorMiddleware);

export default app;
