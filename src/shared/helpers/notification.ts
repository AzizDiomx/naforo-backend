import { sendMail } from '@/config/mailer';
import { sendSMS } from '@/config/sms';
import { prisma } from '@/config/database';
import { logger } from '@/config/logger';

export interface DispatchNotificationOptions {
  organizationId?: string;
  userId?: string;
  email?: string | null;
  phone?: string | null;
  type: string;
  title: string;
  emailSubject: string;
  emailHtml: string;
  smsText: string;
  data?: any;
}

/**
 * Smart Multi-Channel Dispatcher: Email -> SMS Fallback -> DB Notification Log
 */
export async function dispatchNotification(opts: DispatchNotificationOptions): Promise<{ sentEmail: boolean; sentSMS: boolean }> {
  let sentEmail = false;
  let sentSMS = false;

  // 1. Try sending Email if email is provided
  if (opts.email) {
    try {
      sentEmail = await sendMail(opts.email, opts.emailSubject, opts.emailHtml);
    } catch (err) {
      logger.warn(`Dispatch email error for ${opts.email}:`, err);
    }
  }

  // 2. Vérification de l'option SMS selon la formule d'abonnement (sms_whatsapp)
  let allowSMS = false;
  if (opts.organizationId) {
    try {
      const activeSub = await prisma.subscription.findFirst({
        where: { organizationId: opts.organizationId },
        include: { plan: true },
        orderBy: { endDate: 'desc' },
      });

      let features: string[] = [];
      try {
        features = typeof activeSub?.plan.features === 'string'
          ? JSON.parse(activeSub.plan.features)
          : (activeSub?.plan.features as string[]) || [];
      } catch {
        features = [];
      }

      allowSMS = features.includes('sms_whatsapp') || (activeSub?.plan.code || '').includes('pro') || (activeSub?.plan.code || '').includes('expert');
    } catch (subErr) {
      allowSMS = false;
    }
  }

  // 3. Déclenchement du SMS uniquement si la formule de l'organisation l'autorise
  if (allowSMS && opts.phone) {
    if (!sentEmail) {
      logger.info(`[RELAIS SMS ACTIF] L'email n'a pas pu être transmis à ${opts.email || 'N/A'}. Bascule automatique sur l'envoi SMS à ${opts.phone}...`);
      try {
        sentSMS = await sendSMS(opts.phone, opts.smsText);
      } catch (smsErr) {
        logger.error(`Dispatch SMS error for ${opts.phone}:`, smsErr);
      }
    } else {
      try {
        sentSMS = await sendSMS(opts.phone, opts.smsText);
      } catch (e) {}
    }
  } else if (!allowSMS && opts.phone) {
    logger.debug(`[SMS Non Autorisé] Organisation ${opts.organizationId} sans option SMS incluse (réservée Pro/Expert).`);
  }

  // 3. Save notification record in Database table 'notifications' & Broadcast WebSocket
  try {
    const createdNotif = await prisma.notification.create({
      data: {
        organizationId: opts.organizationId,
        userId: opts.userId,
        type: opts.type,
        title: opts.title,
        message: opts.smsText,
        data: opts.data || {},
        channels: [sentEmail ? 'email' : null, sentSMS ? 'sms' : null].filter(Boolean) as string[],
        sentEmail,
        sentSms: sentSMS,
        sentAt: new Date(),
      },
    });

    // 4. Instant WebSocket Real-time Broadcast (0ms)
    try {
      const { emitToOrg, emitToUser } = require('@/sockets/socket.handler');
      if (opts.userId) {
        emitToUser(opts.userId, 'notification:new', createdNotif);
      }
      if (opts.organizationId) {
        emitToOrg(opts.organizationId, 'notification:new', createdNotif);
      }
    } catch (wsErr) {}

  } catch (dbErr) {
    logger.warn('Failed to record notification in DB table:', dbErr);
  }

  return { sentEmail, sentSMS };
}
