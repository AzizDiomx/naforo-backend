import { Server as HTTPServer } from 'http';
import { Server as SocketServer, Socket } from 'socket.io';
import * as jwt from 'jsonwebtoken';
import { env } from '@/config/env';
import { logger } from '@/config/logger';
import { prisma } from '@/config/database';
import { redis } from '@/config/redis';
import { JwtPayload } from '@/shared/types';

let io: SocketServer;

/**
 * Même politique CORS que l'API HTTP (app.ts) : domaines officiels *.naforo.company,
 * previews Vercel du projet, et environnements locaux.
 */
function isSocketOriginAllowed(origin: string, allowedOrigins: string[]): boolean {
  const normalized = origin.replace(/\/$/, '');
  if (allowedOrigins.includes(normalized)) return true;
  try {
    const url = new URL(normalized);
    if (url.hostname === 'naforo.company' || url.hostname.endsWith('.naforo.company')) return true;
    if (url.hostname.endsWith('.vercel.app') && (url.hostname.includes('naforo') || url.hostname.includes('home'))) return true;
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return true;
  } catch (_) {}
  return false;
}

/**
 * Vérifie qu'un utilisateur a le droit de rejoindre un fil de discussion :
 * - super_admin : toujours
 * - locataire : uniquement ses propres fils
 * - personnel de l'agence : uniquement les fils de son organisation
 */
async function canJoinThread(user: JwtPayload, threadId: string): Promise<boolean> {
  if (user.role === 'super_admin') return true;
  const thread = await prisma.chatThread.findUnique({
    where: { id: threadId },
    select: { organizationId: true, tenantProfile: { select: { userId: true } } },
  });
  if (!thread) return false;
  if (user.role === 'tenant') {
    return thread.tenantProfile?.userId === user.userId;
  }
  return Boolean(user.organizationId) && thread.organizationId === user.organizationId;
}

export function initializeSocket(httpServer: HTTPServer): SocketServer {
  const allowedOrigins = (env.CORS_ORIGINS ? env.CORS_ORIGINS.split(',') : ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002'])
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean);

  io = new SocketServer(httpServer, {
    cors: {
      origin: (origin, callback) => {
        // Applications mobiles / serveur-à-serveur (pas d'en-tête Origin) ou origine autorisée
        if (!origin || isSocketOriginAllowed(origin, allowedOrigins) || process.env.NODE_ENV === 'development') {
          callback(null, true);
        } else {
          callback(null, false);
        }
      },
      methods: ['GET', 'POST'],
      credentials: true,
    },
    pingTimeout: 60000,
  });

  // Authentication middleware for socket connections
  io.use(async (socket, next) => {
    const token = socket.handshake.auth.token || socket.handshake.headers['x-auth-token'];
    
    if (!token) {
      return next(new Error('Authentication required'));
    }

    // Refuser les jetons révoqués (déconnexion)
    try {
      const isBlacklisted = await redis.get(`blacklist:${token}`);
      if (isBlacklisted) {
        return next(new Error('Session revoked'));
      }
    } catch (_) {}
    
    try {
      const payload = jwt.verify(token as string, env.JWT_ACCESS_SECRET) as JwtPayload;
      (socket as any).user = payload;
      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const user = (socket as any).user as JwtPayload;
    logger.debug(`Socket client connected: ${socket.id} (user: ${user.userId})`);

    // 1. Join user-specific notification channel
    socket.join(`user:${user.userId}`);
    
    // 2. Join organization-specific notification channel
    if (user.organizationId) {
      socket.join(`org:${user.organizationId}`);
      
      // Auto-join dashboard channel if admin/manager/accountant
      if (['super_admin', 'admin', 'manager', 'accountant'].includes(user.role)) {
        socket.join(`dashboard:${user.organizationId}`);
      }
    }

    // 3. Join specific chat thread room for instant messaging
    socket.on('chat:join_thread', async (threadId: string) => {
      if (!threadId || typeof threadId !== 'string') return;
      try {
        const allowed = await canJoinThread(user, threadId);
        if (!allowed) {
          logger.warn(`Socket ${socket.id} (user: ${user.userId}) refused access to thread:${threadId}`);
          socket.emit('chat:error', { threadId, message: 'Accès refusé à cette conversation.' });
          return;
        }
        socket.join(`thread:${threadId}`);
        logger.debug(`Socket ${socket.id} joined thread:${threadId}`);
      } catch (err) {
        logger.error(`Erreur de vérification d'accès au fil ${threadId}`, err);
      }
    });

    socket.on('chat:leave_thread', (threadId: string) => {
      if (threadId) {
        socket.leave(`thread:${threadId}`);
      }
    });

    socket.on('disconnect', () => {
      logger.debug(`Socket client disconnected: ${socket.id}`);
    });
  });

  return io;
}

export function getIO(): SocketServer {
  if (!io) {
    throw new Error('Socket.IO is not initialized');
  }
  return io;
}

/**
 * Emit real-time event to a specific user
 */
export function emitToUser(userId: string, event: string, data: any): void {
  try {
    getIO().to(`user:${userId}`).emit(event, data);
  } catch (error) {
    logger.error(`Failed to emit event '${event}' to user:${userId}`, error);
  }
}

/**
 * Emit real-time event to a specific chat thread room
 */
export function emitToThread(threadId: string, event: string, data: any): void {
  try {
    getIO().to(`thread:${threadId}`).emit(event, data);
  } catch (error) {
    logger.error(`Failed to emit event '${event}' to thread:${threadId}`, error);
  }
}

/**
 * Emit real-time event to an entire organization
 */
export function emitToOrg(organizationId: string, event: string, data: any): void {
  try {
    getIO().to(`org:${organizationId}`).emit(event, data);
  } catch (error) {
    logger.error(`Failed to emit event '${event}' to org:${organizationId}`, error);
  }
}

/**
 * Emit real-time updates specifically to organization dashboards
 */
export function emitToDashboard(organizationId: string, event: string, data: any): void {
  try {
    getIO().to(`dashboard:${organizationId}`).emit(event, data);
  } catch (error) {
    logger.error(`Failed to emit dashboard event '${event}' to org:${organizationId}`, error);
  }
}
