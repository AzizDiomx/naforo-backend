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
import { receiptsService } from '@/modules/receipts/receipts.service';
import { invoicesService } from '@/modules/invoices/invoices.service';
import { generateSubscriptionInvoicePdf } from '@/modules/subscriptions/pdf.generator';
import { convertAmountXof } from '@/modules/accounting/accounting.repository';

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

// 5. Static uploads directory serving & On-demand PDF recovery (Résilience Serverless / Vercel)
const staticUploadsDirLocal = path.join(process.cwd(), env.UPLOAD_DIR || 'uploads');
const staticUploadsDirTmp = path.join(os.tmpdir(), env.UPLOAD_DIR || 'uploads');

// Servez d'abord les fichiers statiques physiques déjà existants
app.use('/uploads', express.static(staticUploadsDirLocal, { maxAge: '1d' }));
app.use('/uploads', express.static(staticUploadsDirTmp, { maxAge: '1d' }));

// Gestionnaire dynamique de Quittances / Reçus (Régénération à la volée en cas de cold start / fichier éphémère)
app.get('/uploads/receipts/:filename', async (req: Request, res: Response, next: NextFunction) => {
  const filename = req.params.filename;
  if (!filename.endsWith('.pdf')) return next();

  const candidates = [
    path.join(staticUploadsDirTmp, 'receipts', filename),
    path.join(staticUploadsDirLocal, 'receipts', filename),
    path.join(os.tmpdir(), filename),
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
      return res.sendFile(p);
    }
  }

  try {
    const receiptNumber = filename.replace(/\.pdf$/i, '');
    const receipt = await prisma.receipt.findFirst({
      where: {
        OR: [
          { receiptNumber },
          { pdfUrl: { endsWith: filename } },
          { pdfUrl: { contains: receiptNumber } },
        ],
      },
    });

    if (receipt) {
      await receiptsService.generateReceiptPDF(receipt.id, false);
      for (const p of candidates) {
        if (fs.existsSync(p)) {
          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
          return res.sendFile(p);
        }
      }
    }
  } catch (err) {
    logger.error(`Erreur génération quittance à la volée (${filename}):`, err);
  }

  next();
});

// Gestionnaire dynamique de Factures locatives (Régénération à la volée)
app.get('/uploads/invoices/:filename', async (req: Request, res: Response, next: NextFunction) => {
  const filename = req.params.filename;
  if (!filename.endsWith('.pdf')) return next();

  const candidates = [
    path.join(staticUploadsDirTmp, 'invoices', filename),
    path.join(staticUploadsDirLocal, 'invoices', filename),
    path.join(os.tmpdir(), filename),
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
      return res.sendFile(p);
    }
  }

  try {
    const invoiceNumber = filename.replace(/\.pdf$/i, '');
    const invoice = await prisma.invoice.findFirst({
      where: {
        OR: [
          { invoiceNumber },
          { pdfUrl: { endsWith: filename } },
          { pdfUrl: { contains: invoiceNumber } },
        ],
      },
    });

    if (invoice) {
      await invoicesService.generateInvoicePDF(invoice.id);
      for (const p of candidates) {
        if (fs.existsSync(p)) {
          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
          return res.sendFile(p);
        }
      }
    }
  } catch (err) {
    logger.error(`Erreur génération facture à la volée (${filename}):`, err);
  }

  next();
});

// Gestionnaire dynamique de Factures d'Abonnement SaaS Naforo (Régénération à la volée)
app.get('/uploads/subscription-invoices/:filename', async (req: Request, res: Response, next: NextFunction) => {
  const filename = req.params.filename;
  if (!filename.endsWith('.pdf')) return next();

  const candidates = [
    path.join(staticUploadsDirTmp, 'subscription-invoices', filename),
    path.join(staticUploadsDirLocal, 'subscription-invoices', filename),
    path.join(os.tmpdir(), filename),
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
      return res.sendFile(p);
    }
  }

  try {
    const ref = filename.replace(/\.pdf$/i, '');
    const payment = await prisma.subscriptionPayment.findFirst({
      where: {
        OR: [
          { paymentReference: ref },
          { pdfUrl: { endsWith: filename } },
          { pdfUrl: { contains: ref } },
        ],
      },
      include: {
        organization: true,
        subscription: { include: { plan: true } },
      },
    });

    if (payment) {
      const convertedAmounts = await convertAmountXof(Number(payment.amountXof));
      const docParams = {
        paymentReference: payment.paymentReference,
        amountXof: Number(payment.amountXof),
        paymentMethod: payment.paymentMethod,
        transactionNumber: payment.transactionNumber,
        paymentDate: payment.paymentDate,
        billingCycle: payment.billingCycle || 'monthly',
        organization: {
          name: payment.organization?.name || 'Organisation',
          email: payment.organization?.email || null,
          phone: payment.organization?.phone || null,
          address: payment.organization?.address || null,
          city: payment.organization?.city || null,
        },
        subscription: {
          startDate: payment.subscription?.startDate || payment.paymentDate,
          endDate: payment.subscription?.endDate || payment.paymentDate,
          plan: {
            name: payment.subscription?.plan?.name || 'Plan Naforo',
            code: payment.subscription?.plan?.code,
            description: payment.subscription?.plan?.description,
            maxProperties: payment.subscription?.plan?.maxProperties,
            maxTenants: payment.subscription?.plan?.maxTenants,
            features: payment.subscription?.plan?.features,
          },
        },
      };
      await generateSubscriptionInvoicePdf(docParams as any, convertedAmounts);
      for (const p of candidates) {
        if (fs.existsSync(p)) {
          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
          return res.sendFile(p);
        }
      }
    }
  } catch (err) {
    logger.error(`Erreur génération facture abonnement à la volée (${filename}):`, err);
  }

  next();
});

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
