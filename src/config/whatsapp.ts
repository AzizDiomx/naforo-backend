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
 * Gère notamment les numéros ivoiriens à 10 chiffres (01, 05, 07) et les formats internationaux.
 */
export function formatWhatsAppNumber(phone: string): { internationalWithPlus: string; cleanDigits: string } {
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

  // Format local ivoirien (10 chiffres commençant par 01, 05, 07, etc.)
  if (/^0[157]\d{8}$/.test(cleaned)) {
    const digits = `225${cleaned}`;
    return {
      internationalWithPlus: `+${digits}`,
      cleanDigits: digits,
    };
  }

  // Si commence déjà par l'indicatif 225
  if (cleaned.startsWith('225')) {
    return {
      internationalWithPlus: `+${cleaned}`,
      cleanDigits: cleaned,
    };
  }

  // Fallback: supposer Côte d'Ivoire par défaut si 8 ou 10 chiffres
  const digits = cleaned.length <= 10 ? `225${cleaned}` : cleaned;
  return {
    internationalWithPlus: `+${digits}`,
    cleanDigits: digits,
  };
}

/**
 * Génère le lien direct WhatsApp (wa.me) utilisable en 1 clic
 * depuis le navigateur ou l'application mobile sans configuration payante.
 */
export function generateWhatsAppLink(phone: string, message: string): string {
  const { cleanDigits } = formatWhatsAppNumber(phone);
  return `https://wa.me/${cleanDigits}?text=${encodeURIComponent(message)}`;
}

export interface SendWhatsAppResult {
  success: boolean;
  messageId?: string;
  directWhatsAppUrl: string;
  provider: 'twilio' | 'fallback_direct_link';
  error?: string;
}

/**
 * Envoie un message WhatsApp via l'API Twilio WhatsApp si configurée,
 * sinon génère le lien direct wa.me et journalise l'opération.
 */
export async function sendWhatsAppMessage(
  to: string,
  message: string
): Promise<SendWhatsAppResult> {
  const { internationalWithPlus, cleanDigits } = formatWhatsAppNumber(to);
  const directLink = `https://wa.me/${cleanDigits}?text=${encodeURIComponent(message)}`;
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

  // Mode Fallback / Gratuit : Journalisation et mise à disposition immédiate du lien wa.me
  logger.info(`
================================================================================
📱 [WHATSAPP DIRECT DISPATCH - Naforo]
Destinataire: ${internationalWithPlus}
Lien direct: ${directLink}
--------------------------------------------------------------------------------
Message:
${message}
================================================================================
  `);

  return {
    success: true,
    directWhatsAppUrl: directLink,
    provider: 'fallback_direct_link',
  };
}

/**
 * Modèle de message de relance de facture de loyer
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
  paymentMethods?: string;
  portalUrl?: string;
}): string {
  const amountStr = new Intl.NumberFormat('fr-FR').format(data.amountXof) + ' FCFA';
  const prefix = data.isOverdue ? '⚠️ *RAPPEL DE PAIEMENT - ÉCHÉANCE DÉPASSÉE*' : '🔔 *AVIS D\'ÉCHÉANCE DE LOYER*';
  
  let header = `${prefix}\n\nBonjour *${data.tenantName}*,\n\n`;
  header += `Votre gestionnaire *${data.agencyName}* vous informe des détails de votre loyer pour le bien :\n`;
  header += `🏠 *${data.propertyName}*\n`;
  header += `📄 Facture N° : *${data.invoiceNumber}*\n`;
  header += `🗓️ Période : *${data.periodLabel}*\n`;
  header += `💰 Montant net à régler : *${amountStr}*\n`;
  header += `⏰ Date limite : *${data.dueDate}*\n`;

  if (data.isOverdue && data.daysOverdue && data.daysOverdue > 0) {
    header += `🚨 Retard constaté : *+${data.daysOverdue} jour(s)*\n`;
  }

  header += `\n💳 *Modes de paiement acceptés :*\n`;
  header += `• Wave / Orange Money / MTN MoMo\n`;
  header += `• Virement bancaire ou paiement en agence\n`;

  if (data.portalUrl) {
    header += `\n👉 Consultez votre facture et quittance : ${data.portalUrl}\n`;
  }

  header += `\nMerci pour votre confiance.\n_Service Gestion Locative - ${data.agencyName}_`;

  return header;
}

/**
 * Modèle de confirmation de réception de paiement
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
  let message = `✅ *CONFIRMATION DE PAIEMENT & QUITTANCE*\n\n`;
  message += `Bonjour *${data.tenantName}*,\n\n`;
  message += `Nous vous confirmons la bonne réception de votre règlement de loyer pour :\n`;
  message += `🏠 *${data.propertyName}*\n`;
  message += `🧾 Quittance N° : *${data.receiptNumber}*\n`;
  message += `💰 Montant réglé : *${amountStr}*\n`;
  message += `🗓️ Période acquittée : *${data.periodLabel}*\n`;

  if (data.receiptUrl) {
    message += `\n📥 Télécharger votre quittance certifiée : ${data.receiptUrl}\n`;
  }

  message += `\nMerci de votre ponctualité.\n_L'équipe ${data.agencyName}_`;
  return message;
}
