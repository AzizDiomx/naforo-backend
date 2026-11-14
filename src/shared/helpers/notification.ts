import { sendMail, EmailServiceType } from '@/config/mailer';
import { sendSMS } from '@/config/sms';
import { prisma } from '@/config/database';
import { logger } from '@/config/logger';
import { getOrganizationPlanContext, planIncludesFeature } from '@/shared/helpers/plan-policy';

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
  service?: EmailServiceType;
}

/**
 * Smart Multi-Channel Dispatcher: Email -> SMS Fallback -> DB Notification Log
 */
export async function dispatchNotification(opts: DispatchNotificationOptions): Promise<{ sentEmail: boolean; sentSMS: boolean }> {
  let sentEmail = false;
  let sentSMS = false;

  // 0. Charger les préférences de notification de l'utilisateur si ciblé
  let userPrefs: { emailEnabled: boolean; smsEnabled: boolean; reminderEnabled: boolean } | null = null;
  if (opts.userId) {
    try {
      userPrefs = await prisma.notificationPreference.findUnique({
        where: { userId: opts.userId },
        select: { emailEnabled: true, smsEnabled: true, reminderEnabled: true },
      });
    } catch {}
  }

  const upperType = (opts.type || '').toUpperCase();
  const isSecurityOrCritical = upperType.includes('PASSWORD') || upperType.includes('SECURITY') || upperType.includes('WELCOME');
  const isReminder = upperType.includes('REMINDER') || upperType.includes('OVERDUE');

  if (userPrefs && !userPrefs.reminderEnabled && isReminder) {
    logger.debug(`[Préférences] Rappels désactivés pour l'utilisateur ${opts.userId}, notification ignorée.`);
    return { sentEmail: false, sentSMS: false };
  }

  // 1. Try sending Email if email is provided and allowed by user preferences
  const canSendEmail = isSecurityOrCritical || !userPrefs || userPrefs.emailEnabled;
  if (opts.email && canSendEmail) {
    try {
      let serviceType: EmailServiceType = opts.service || 'info';
      if (!opts.service) {
        if (upperType.includes('PASSWORD') || upperType.includes('SUBSCRIPTION') || upperType.includes('SECURITY') || upperType.includes('ADMIN')) {
          serviceType = 'admin';
        } else if (upperType.includes('WELCOME') || upperType.includes('REGISTER') || upperType.includes('ONBOARDING')) {
          serviceType = 'contact';
        } else if (upperType.includes('INCIDENT') || upperType.includes('SUPPORT') || upperType.includes('REJECTED')) {
          serviceType = 'support';
        } else {
          serviceType = 'info';
        }
      }

      sentEmail = await sendMail(opts.email, opts.emailSubject, opts.emailHtml, undefined, undefined, serviceType);
    } catch (err) {
      logger.warn(`Dispatch email error for ${opts.email}:`, err);
    }
  }

  // 2. Vérification stricte de l'option SMS selon le forfait en base (sms_whatsapp)
  let allowSMS = false;
  if (opts.organizationId) {
    try {
      const ctx = await getOrganizationPlanContext(opts.organizationId);
      allowSMS = planIncludesFeature(ctx.planCode, ctx.features, 'sms_whatsapp');
    } catch {
      allowSMS = false;
    }
  }

  // 3. Déclenchement du SMS si le forfait l'autorise (en repli si l'email échoue, ou si smsEnabled est activé)
  const shouldSendSms = allowSMS && opts.phone && (!sentEmail || userPrefs?.smsEnabled);
  if (shouldSendSms) {
    if (!sentEmail) {
      logger.info(`[RELAIS SMS ACTIF] L'email n'a pas pu être transmis à ${opts.email || 'N/A'}. Bascule automatique sur l'envoi SMS à ${opts.phone}...`);
    }
    try {
      sentSMS = await sendSMS(opts.phone!, opts.smsText);
    } catch (smsErr) {
      logger.error(`Dispatch SMS error for ${opts.phone}:`, smsErr);
    }
  } else if (!allowSMS && opts.phone) {
    logger.debug(`[SMS Non Autorisé] Organisation ${opts.organizationId} sans option sms_whatsapp incluse.`);
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

    // 4. Instant WebSocket Real-time Broadcast (ciblé utilisateur si userId, sinon organisation)
    try {
      const { emitToOrg, emitToUser } = require('@/sockets/socket.handler');
      if (opts.userId) {
        emitToUser(opts.userId, 'notification:new', createdNotif);
      } else if (opts.organizationId) {
        emitToOrg(opts.organizationId, 'notification:new', createdNotif);
      }
    } catch (wsErr) {}

  } catch (dbErr) {
    logger.warn('Failed to record notification in DB table:', dbErr);
  }

  return { sentEmail, sentSMS };
}
