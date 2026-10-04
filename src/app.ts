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

// 3. CORS configuration
const corsOrigins = env.CORS_ORIGINS.split(',');
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || corsOrigins.indexOf(origin) !== -1 || process.env.NODE_ENV === 'development') {
        callback(null, true);
      } else {
        callback(new Error('Non autorisé par CORS'));
      }
    },
    credentials: true,
  })
);

// 4. Rate Limiters
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // limit each IP to 1000 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Trop de requêtes effectuées depuis cette IP, veuillez réessayer après 15 minutes.',
});
app.use(globalLimiter);

// Specific brute-force protection for Auth routes (Login, Register, Password Reset)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // max 10 requests per 15 minutes per IP
  standardHeaders: true,
  legacyHeaders: false,
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
