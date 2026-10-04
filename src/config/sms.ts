import { env } from '@/config/env';
import { logger } from '@/config/logger';

let twilioClient: any = null;

if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN) {
  try {
    const twilio = require('twilio');
    twilioClient = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
    logger.info('Twilio SMS Client initialized successfully.');
  } catch (err) {
    logger.warn('Twilio module missing or failed to initialize.', err);
  }
}

export interface SendSMSOptions {
  to: string;
  message: string;
}

export async function sendSMS(to: string, message: string): Promise<boolean> {
  const formattedPhone = to.startsWith('+') ? to : `+225${to.replace(/\s+/g, '')}`;

  if (twilioClient && env.TWILIO_PHONE_NUMBER) {
    try {
      const res = await twilioClient.messages.create({
        body: message,
        from: env.TWILIO_PHONE_NUMBER,
        to: formattedPhone,
      });
      logger.info(`[SMS TRANSMIS VIA TWILIO] SID: ${res.sid} -> ${formattedPhone}`);
      return true;
    } catch (error: any) {
      logger.error(`[ECHEC SMS TWILIO] Impossible d'envoyer l'un SMS à ${formattedPhone}:`, error.message);
    }
  }

  // FALLBACK LOGGING FOR SMS IN DEV / DEMO ENVIRONMENT
  logger.info(`
================================================================================
📱 [FALLBACK SMS DISPATCH - Naforo]
Destinataire: ${formattedPhone}
Horodatage: ${new Date().toISOString()}
--------------------------------------------------------------------------------
Contenu du SMS:
${message}
================================================================================
  `);

  return true;
}

