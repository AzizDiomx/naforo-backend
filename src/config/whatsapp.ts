import { env } from '@/config/env';
import { logger } from '@/config/logger';

let twilioClient: any = null;

if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN) {
  try {
    const twilio = require('twilio');
    twilioClient = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
    logger.info('Twilio WhatsApp Client initialized successfully.');
  } catch (err) {
    logger.warn('Twilio module missing or failed to initialize for WhatsApp.', err);
  }
}

/**
 * Nettoie et formate le numéro de téléphone pour WhatsApp.
 * Gère les numéros ivoiriens à 10 chiffres (01, 05, 07) et les formats internationaux.
 */
export function formatWhatsAppNumber(phone: string): {
  internationalWithPlus: string;
  cleanDigits: string;
} {
  let cleaned = phone.trim().replace(/[\s\-\.\(\)]/g, '');

  if (cleaned.startsWith('00')) {
    cleaned = cleaned.substring(2);
  }

  if (cleaned.startsWith('+')) {
    const digits = cleaned.substring(1);
    return {
      internationalWithPlus: `+${digits}`,
      cleanDigits: digits,
    };
  }

  if (/^0[157]\d{8}$/.test(cleaned)) {
    const digits = `225${cleaned}`;
    return {
      internationalWithPlus: `+${digits}`,
      cleanDigits: digits,
    };
  }

  if (cleaned.startsWith('225')) {
    return {
      internationalWithPlus: `+${cleaned}`,
      cleanDigits: cleaned,
    };
  }

  const digits = cleaned.length <= 10 ? `225${cleaned}` : cleaned;
  return {
    internationalWithPlus: `+${digits}`,
    cleanDigits: digits,
  };
}

export function generateWhatsAppLink(phone: string, message: string): string {
  const { cleanDigits } = formatWhatsAppNumber(phone);
  return `https://wa.me/${cleanDigits}?text=${encodeURIComponent(message)}`;
}

export type WhatsAppProvider = 'meta_cloud' | 'twilio' | 'fallback_direct_link';

export interface SendWhatsAppResult {
  success: boolean;
  messageId?: string;
  directWhatsAppUrl: string;
  provider: WhatsAppProvider;
  error?: string;
}

export function getConfiguredWhatsAppProvider(): WhatsAppProvider {
  if (process.env.WHATSAPP_CLOUD_ACCESS_TOKEN && process.env.WHATSAPP_CLOUD_PHONE_ID) {
    return 'meta_cloud';
  }
  const senderNumber = env.TWILIO_WHATSAPP_NUMBER || env.TWILIO_PHONE_NUMBER;
  if (twilioClient && senderNumber) {
    return 'twilio';
  }
  return 'fallback_direct_link';
}

/**
 * Envoie un message WhatsApp :
 * 1. Meta WhatsApp Cloud API (si WHATSAPP_CLOUD_ACCESS_TOKEN & WHATSAPP_CLOUD_PHONE_ID sont définis)
 * 2. Twilio WhatsApp API (si TWILIO_ACCOUNT_SID & TWILIO_AUTH_TOKEN sont définis)
 * 3. Lien direct 1-clic wa.me (fallback universel sans coût par message)
 */
export async function sendWhatsAppMessage(
  to: string,
  message: string
): Promise<SendWhatsAppResult> {
  const { internationalWithPlus, cleanDigits } = formatWhatsAppNumber(to);
  const directLink = `https://wa.me/${cleanDigits}?text=${encodeURIComponent(message)}`;

  const metaToken = process.env.WHATSAPP_CLOUD_ACCESS_TOKEN;
  const metaPhoneId = process.env.WHATSAPP_CLOUD_PHONE_ID;

  // 1. Meta WhatsApp Cloud API officielle
  if (metaToken && metaPhoneId) {
    try {
      const response = await fetch(
        `https://graph.facebook.com/v20.0/${metaPhoneId}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${metaToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: cleanDigits,
            type: 'text',
            text: { preview_url: true, body: message },
          }),
        }
      );

      const data: any = await response.json().catch(() => ({}));
      if (response.ok && data?.messages?.[0]?.id) {
        logger.info(`[WHATSAPP META CLOUD] ID: ${data.messages[0].id} -> +${cleanDigits}`);
        return {
          success: true,
          messageId: data.messages[0].id,
          directWhatsAppUrl: directLink,
          provider: 'meta_cloud',
        };
      }
      logger.warn(
        `[WHATSAPP META CLOUD WARN] ${data?.error?.message || response.statusText}. Bascule sur fallback.`
      );
    } catch (err: any) {
      logger.warn(`[WHATSAPP META CLOUD ERROR] ${err.message}. Bascule sur fallback.`);
    }
  }

  // 2. Twilio WhatsApp API
  const senderNumber = env.TWILIO_WHATSAPP_NUMBER || env.TWILIO_PHONE_NUMBER;
  if (twilioClient && senderNumber) {
    try {
      const fromNumber = senderNumber.startsWith('whatsapp:')
        ? senderNumber
        : `whatsapp:${senderNumber.startsWith('+') ? senderNumber : `+${senderNumber}`}`;
      const toNumber = `whatsapp:${internationalWithPlus}`;

      const res = await twilioClient.messages.create({
        body: message,
        from: fromNumber,
        to: toNumber,
      });

      logger.info(`[WHATSAPP TWILIO DISPATCH] SID: ${res.sid} -> ${toNumber}`);
      return {
        success: true,
        messageId: res.sid,
        directWhatsAppUrl: directLink,
        provider: 'twilio',
      };
    } catch (error: any) {
      logger.warn(`[TWILIO WHATSAPP ERROR] ${error.message}. Bascule sur le lien direct wa.me`);
      return {
        success: false,
        directWhatsAppUrl: directLink,
        provider: 'fallback_direct_link',
        error: error.message,
      };
    }
  }

  // 3. Mode 1-Clic wa.me
  logger.info(`[WHATSAPP DIRECT LINK] Destinataire: ${internationalWithPlus}`);
  return {
    success: true,
    directWhatsAppUrl: directLink,
    provider: 'fallback_direct_link',
  };
}

/**
 * Modèle sobre et structuré de relance de facture de loyer
 */
export function buildInvoiceReminderTemplate(data: {
  tenantName: string;
  agencyName: string;
  propertyName: string;
  invoiceNumber: string;
  amountXof: number;
  periodLabel: string;
  dueDate: string;
  isOverdue?: boolean;
  daysOverdue?: number;
  portalUrl?: string;
}): string {
  const amountStr = new Intl.NumberFormat('fr-FR').format(data.amountXof) + ' FCFA';
  const title = data.isOverdue
    ? '*RAPPEL DE LOYER — ÉCHÉANCE DÉPASSÉE*'
    : "*AVIS D'ÉCHÉANCE DE LOYER*";

  const lines: string[] = [
    title,
    '',
    `Bonjour *${data.tenantName}*,`,
    '',
    `Votre gestionnaire *${data.agencyName}* vous transmet le récapitulatif de votre loyer :`,
    `• Bien : *${data.propertyName}*`,
    `• Période : *${data.periodLabel}*`,
    `• Référence : *${data.invoiceNumber}*`,
    `• Montant à régler : *${amountStr}*`,
    `• Échéance : *${data.dueDate}*`,
  ];

  if (data.isOverdue && data.daysOverdue && data.daysOverdue > 0) {
    lines.push(`• Retard constaté : *+${data.daysOverdue} jour(s)*`);
  }

  lines.push(
    '',
    '*Modes de règlement :* Wave, Orange Money, MTN MoMo ou virement.'
  );

  if (data.portalUrl) {
    lines.push('', `Votre espace locataire : ${data.portalUrl}`);
  }

  lines.push('', `Cordialement,`, `_${data.agencyName}_`);
  return lines.join('\n');
}

/**
 * Modèle sobre de confirmation de paiement & quittance certifiée
 */
export function buildReceiptWhatsAppTemplate(data: {
  tenantName: string;
  agencyName: string;
  propertyName: string;
  receiptNumber: string;
  amountPaidXof: number;
  periodLabel: string;
  receiptUrl?: string;
}): string {
  const amountStr = new Intl.NumberFormat('fr-FR').format(data.amountPaidXof) + ' FCFA';
  const lines: string[] = [
    '*CONFIRMATION DE PAIEMENT & QUITTANCE*',
    '',
    `Bonjour *${data.tenantName}*,`,
    '',
    `Nous vous confirmons la bonne réception de votre règlement de loyer :`,
    `• Bien : *${data.propertyName}*`,
    `• Quittance N° : *${data.receiptNumber}*`,
    `• Montant : *${amountStr}*`,
    `• Période acquittée : *${data.periodLabel}*`,
  ];

  if (data.receiptUrl) {
    lines.push('', `Télécharger votre quittance certifiée : ${data.receiptUrl}`);
  }

  lines.push('', `Merci pour votre ponctualité.`, `_${data.agencyName}_`);
  return lines.join('\n');
}
