import * as admin from 'firebase-admin';
import { env } from '@/config/env';
import { logger } from '@/config/logger';

// ---------------------------------------------------------------------------
// Initialize Firebase Admin SDK
// ---------------------------------------------------------------------------
let firebaseApp: admin.app.App | null = null;

function initFirebase(): admin.app.App | null {
  if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_PRIVATE_KEY || !env.FIREBASE_CLIENT_EMAIL) {
    logger.warn('Firebase credentials not configured – push notifications disabled');
    return null;
  }

  if (admin.apps.length > 0) {
    return admin.apps[0] ?? null;
  }

  try {
    const app = admin.initializeApp({
      credential: admin.credential.cert({
        projectId: env.FIREBASE_PROJECT_ID,
        privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        clientEmail: env.FIREBASE_CLIENT_EMAIL,
      }),
    });

    logger.info('Firebase Admin SDK initialized', {
      projectId: env.FIREBASE_PROJECT_ID,
    });

    return app;
  } catch (error) {
    logger.error('Failed to initialize Firebase Admin SDK', {
      error: error instanceof Error ? error.message : error,
    });
    return null;
  }
}

firebaseApp = initFirebase();

// ---------------------------------------------------------------------------
// Send Push Notification
// ---------------------------------------------------------------------------
export async function sendPushNotification(
  token: string,
  title: string,
  body: string,
  data?: Record<string, string>
): Promise<string | null> {
  if (!firebaseApp) {
    logger.warn('Push notification skipped – Firebase not configured', { title });
    return null;
  }

  if (!token || token.trim() === '') {
    logger.warn('Push notification skipped – empty FCM token', { title });
    return null;
  }

  try {
    const message: admin.messaging.Message = {
      token,
      notification: { title, body },
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          channelId: 'bailflow_default',
          clickAction: 'FLUTTER_NOTIFICATION_CLICK',
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
          },
        },
      },
      data: data ?? {},
    };

    const messageId = await admin.messaging(firebaseApp).send(message);
    logger.info('Push notification sent', { messageId, title });
    return messageId;
  } catch (error) {
    logger.error('Failed to send push notification', {
      error: error instanceof Error ? error.message : error,
      title,
    });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Send multicast push notification (to multiple tokens)
// ---------------------------------------------------------------------------
export async function sendMulticastPushNotification(
  tokens: string[],
  title: string,
  body: string,
  data?: Record<string, string>
): Promise<admin.messaging.BatchResponse | null> {
  if (!firebaseApp) {
    logger.warn('Multicast push notification skipped – Firebase not configured', { title });
    return null;
  }

  const validTokens = tokens.filter((t) => t && t.trim() !== '');
  if (validTokens.length === 0) {
    logger.warn('Multicast push notification skipped – no valid FCM tokens');
    return null;
  }

  try {
    const message: admin.messaging.MulticastMessage = {
      tokens: validTokens,
      notification: { title, body },
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          channelId: 'bailflow_default',
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
          },
        },
      },
      data: data ?? {},
    };

    const response = await admin.messaging(firebaseApp).sendEachForMulticast(message);
    logger.info('Multicast push notification sent', {
      successCount: response.successCount,
      failureCount: response.failureCount,
      title,
    });
    return response;
  } catch (error) {
    logger.error('Failed to send multicast push notification', {
      error: error instanceof Error ? error.message : error,
      title,
    });
    return null;
  }
}

