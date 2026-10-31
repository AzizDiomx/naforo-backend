import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import path from 'path';
import os from 'os';
import fs from 'fs';
import cookieParser from 'cookie-parser';
import { env } from '@/config/env';
import { prisma } from '@/config/database';
import { logger } from '@/config/logger';
import { errorMiddleware } from '@/shared/middlewares/error.middleware';
import router from '@/routes';
import { resolveOrRegenerateUpload } from '@/shared/helpers/file-storage';

const app: Express = express();

// Trust reverse proxy (Indispensable sur Vercel, AWS, Cloudflare, etc. pour X-Forwarded-For et rate-limiting)
app.set('trust proxy', 1);

// 1. Basic security & optimization middlewares
app.use(helmet());
app.use(cookieParser());
app.use(compression());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// 2. Logging with Morgan
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// 3. CORS configuration (Robuste & dynamique pour tous les sous-domaines naforo.company et Vercel)
const defaultAllowedOrigins = [
  'https://backend.naforo.company',
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
    // Autoriser les déploiements preview Vercel du projet uniquement
    if (
      url.hostname.endsWith('.vercel.app') &&
      (url.hostname.includes('naforo') || url.hostname.includes('home'))
    ) {
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
app.use(`${env.API_PREFIX}/auth/reset-password`, authLimiter);
app.use(`${env.API_PREFIX}/auth/verify-email`, authLimiter);

// Anti-force brute sur la signature électronique OTP des baux (10 essais / 15 min / IP)
const signOtpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  message: {
    success: false,
    message: 'Trop de tentatives de signature OTP depuis cette adresse IP. Veuillez patienter 15 minutes.',
  },
});
app.post(`${env.API_PREFIX}/contracts/:id/sign-otp`, signOtpLimiter);

//5. Static uploads directory serving & On-demand file/PDF recovery (Résilience Serverless / Conteneurs)
const staticUploadsDirLocal = path.join(process.cwd(), env.UPLOAD_DIR || 'uploads');
const staticUploadsDirTmp = path.join(os.tmpdir(), env.UPLOAD_DIR || 'uploads');

// En-têtes de sécurité anti-sniffing sur tous les fichiers servis depuis /uploads
app.use('/uploads', (req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});

// Servez d'abord les fichiers statiques physiques déjà existants
app.use('/uploads', express.static(staticUploadsDirLocal, { maxAge: '1d' }));
app.use('/uploads', express.static(staticUploadsDirTmp, { maxAge: '1d' }));

const serveResolvedUpload = async (req: Request, res: Response, next: NextFunction, subfolder?: string) => {
  const filename = req.params.filename;
  if (!filename) return next();

  try {
    const resolved = await resolveOrRegenerateUpload(filename, subfolder);
    if (resolved) {
      res.setHeader('Content-Type', resolved.mimeType);
      res.setHeader('Content-Disposition', `inline; filename="${resolved.downloadName}"`);
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      if (resolved.filePath && fs.existsSync(resolved.filePath)) {
        return res.sendFile(resolved.filePath);
      }
      if (resolved.buffer) {
        return res.status(200).send(resolved.buffer);
      }
    }
  } catch (err) {
    logger.error(`Erreur récupération/régénération fichier upload (${filename}):`, err);
  }

  return next();
};

// Gestionnaire dynamique des sous-dossiers (/uploads/receipts/:filename, /uploads/invoices/:filename, /uploads/contracts/:filename, /uploads/crg/:filename, etc.)
app.get('/uploads/:subfolder/:filename', (req: Request, res: Response, next: NextFunction) =>
  serveResolvedUpload(req, res, next, req.params.subfolder)
);

// Gestionnaire dynamique à la racine de /uploads/:filename (Documents GED, Preuves de paiement, Logos, Cachets, PDFs UUID)
app.get('/uploads/:filename', (req: Request, res: Response, next: NextFunction) =>
  serveResolvedUpload(req, res, next)
);

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
