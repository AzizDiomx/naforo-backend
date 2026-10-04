import { Server as HTTPServer } from 'http';
import { Server as SocketServer, Socket } from 'socket.io';
import * as jwt from 'jsonwebtoken';
import { env } from '@/config/env';
import { logger } from '@/config/logger';
import { JwtPayload } from '@/shared/types';

let io: SocketServer;

export function initializeSocket(httpServer: HTTPServer): SocketServer {
  const allowedOrigins = env.CORS_ORIGINS ? env.CORS_ORIGINS.split(',') : ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002'];

  io = new SocketServer(httpServer, {
    cors: {
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin) || process.env.NODE_ENV === 'development') {
          callback(null, true);
        } else {
          callback(null, true);
        }
      },
      methods: ['GET', 'POST'],
      credentials: true,
    },
    pingTimeout: 60000,
  });

  // Authentication middleware for socket connections
  io.use((socket, next) => {
    const token = socket.handshake.auth.token || socket.handshake.headers['x-auth-token'];
    
    if (!token) {
      return next(new Error('Authentication required'));
    }
    
    try {
      const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as JwtPayload;
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
    socket.on('chat:join_thread', (threadId: string) => {
      if (threadId) {
        socket.join(`thread:${threadId}`);
        logger.debug(`Socket ${socket.id} joined thread:${threadId}`);
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
