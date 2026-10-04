import nodemailer from 'nodemailer';
import { env } from '@/config/env';
import { logger } from '@/config/logger';

// ---------------------------------------------------------------------------
// Hostinger Service Aliases Mapping
// ---------------------------------------------------------------------------
export type EmailServiceType = 'admin' | 'contact' | 'support' | 'info';

export interface EmailSenderConfig {
  email: string;
  name: string;
  description: string;
}

export const EMAIL_SERVICES: Record<EmailServiceType, EmailSenderConfig> = {
  admin: {
    email: 'admin@naforo.company',
    name: 'Naforo Administration',
    description: 'Sécurité, validation des abonnements, OTP et gestion de plateforme',
  },
  contact: {
    email: 'contact@naforo.company',
    name: 'Naforo Commercial',
    description: 'Bienvenue, création de compte agence, onboarding et relations commerciales',
  },
  support: {
    email: 'support@naforo.company',
    name: 'Naforo Support',
    description: 'Assistance technique, gestion des pannes/incidents et aide locataires/agences',
  },
  info: {
    email: 'info@naforo.company',
    name: 'Naforo Notifications',
    description: 'Avis d\'échéance, quittances de loyer, factures et suivi des règlements',
  },
};

export function getSenderForService(service?: EmailServiceType, customFrom?: string): { from: string; replyTo: string; service: EmailServiceType } {
  if (customFrom) {
    return { from: customFrom, replyTo: customFrom, service: service || 'info' };
  }
  const targetService: EmailServiceType = service || 'info';
  const cfg = EMAIL_SERVICES[targetService] || EMAIL_SERVICES.info;
  return {
    from: `"${cfg.name}" <${cfg.email}>`,
    replyTo: cfg.email,
    service: targetService,
  };
}

export function detectServiceFromContent(subject: string, html: string): EmailServiceType {
  const text = `${subject} ${html}`.toLowerCase();
  if (
    text.includes('mot de passe') ||
    text.includes('réinitialisation') ||
    text.includes('otp') ||
    text.includes('abonnement') ||
    text.includes('souscription') ||
    text.includes('sécurité') ||
    text.includes('audit')
  ) {
    return 'admin';
  }
  if (
    text.includes('bienvenue') ||
    text.includes('inscription') ||
    text.includes('agence') ||
    text.includes('onboarding') ||
    text.includes('commercial')
  ) {
    return 'contact';
  }
  if (
    text.includes('incident') ||
    text.includes('panne') ||
    text.includes('artisan') ||
    text.includes('intervention') ||
    text.includes('support') ||
    text.includes('rejet') ||
    text.includes('rejeté')
  ) {
    return 'support';
  }
  return 'info';
}

// ---------------------------------------------------------------------------
// Transporter (Serveur Hostinger naforo.company)
// ---------------------------------------------------------------------------
const smtpUser = env.SMTP_USER || process.env.MAIL_USER || 'aziz.diomande@naforo.company';
const smtpPass = env.SMTP_PASS || process.env.MAIL_PASS;
const isSecure = env.SMTP_SECURE !== undefined ? env.SMTP_SECURE : (env.SMTP_PORT === 465);

const transporter = nodemailer.createTransport({
  host: env.SMTP_HOST || 'smtp.hostinger.com',
  port: env.SMTP_PORT || 465,
  secure: isSecure,
  auth: smtpUser && smtpPass ? { user: smtpUser, pass: smtpPass } : undefined,
  pool: true,
  maxConnections: 5,
  maxMessages: 100,
});

// ---------------------------------------------------------------------------
// Verify connection on startup
// ---------------------------------------------------------------------------
if (env.NODE_ENV !== 'test') {
  transporter.verify((error) => {
    if (error) {
      logger.warn('Mailer Hostinger transporter verification failed (Vérifiez les identifiants SMTP Hostinger)', { error: error.message });
    } else {
      logger.info('Mailer Hostinger opérationnel pour aziz.diomande@naforo.company et ses alias (admin, contact, support, info)', {
        host: env.SMTP_HOST || 'smtp.hostinger.com',
        port: env.SMTP_PORT || 465,
        user: smtpUser,
        aliases: Object.values(EMAIL_SERVICES).map(s => s.email),
      });
    }
  });
}

export interface MailAttachment {
  filename: string;
  path?: string;
  content?: Buffer | string;
  contentType?: string;
}

export interface SendMailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  attachments?: MailAttachment[];
  service?: EmailServiceType;
  from?: string;
  replyTo?: string;
}

// ---------------------------------------------------------------------------
// Base email sender avec routage automatique par service
// ---------------------------------------------------------------------------
export async function sendMail(
  toOrOptions: string | string[] | SendMailOptions,
  subjectParam?: string,
  htmlParam?: string,
  textParam?: string,
  attachmentsParam?: MailAttachment[],
  serviceParam?: EmailServiceType
): Promise<boolean> {
  let to: string | string[];
  let subject: string;
  let html: string;
  let text: string | undefined;
  let attachments: MailAttachment[] | undefined;
  let service: EmailServiceType | undefined;
  let customFrom: string | undefined;
  let customReplyTo: string | undefined;

  if (typeof toOrOptions === 'object' && !Array.isArray(toOrOptions) && 'to' in toOrOptions) {
    to = toOrOptions.to;
    subject = toOrOptions.subject;
    html = toOrOptions.html;
    text = toOrOptions.text;
    attachments = toOrOptions.attachments;
    service = toOrOptions.service;
    customFrom = toOrOptions.from;
    customReplyTo = toOrOptions.replyTo;
  } else {
    to = toOrOptions as string | string[];
    subject = subjectParam || '';
    html = htmlParam || '';
    text = textParam;
    attachments = attachmentsParam;
    service = serviceParam;
  }

  // Résoudre le service (alias Hostinger) : spécifié ou détecté automatiquement
  const resolvedService: EmailServiceType = service || detectServiceFromContent(subject, html);
  const sender = getSenderForService(resolvedService, customFrom);

  try {
    await transporter.sendMail({
      from: sender.from,
      replyTo: customReplyTo || sender.replyTo,
      to: Array.isArray(to) ? to.join(', ') : to,
      subject,
      html,
      text: text ?? html.replace(/<[^>]*>/g, ''),
      attachments,
    });
    logger.info(`[Email Envoyé - ${resolvedService.toUpperCase()}] Destinataire: ${Array.isArray(to) ? to.join(', ') : to} | Expéditeur: ${sender.from} | Sujet: ${subject}`);
    return true;
  } catch (error: any) {
    logger.warn(`[ECHEC EMAIL SMTP Hostinger - ${resolvedService}] Impossible d'envoyer l'email à ${to} via ${sender.from}: ${error.message}`);
    logger.info(`
================================================================================
📧 [FALLBACK EMAIL LOG - Naforo Hostinger (${resolvedService.toUpperCase()})]
Expéditeur: ${sender.from}
Destinataire: ${Array.isArray(to) ? to.join(', ') : to}
Sujet: ${subject}
Pièces jointes: ${attachments?.map(a => a.filename).join(', ') || 'Aucune'}
--------------------------------------------------------------------------------
Contenu Texte:
${text ?? html.replace(/<[^>]*>/g, '')}
================================================================================
    `);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Base HTML layout - Official Naforo SaaS Design
// ---------------------------------------------------------------------------
function baseLayout(title: string, content: string): string {
  return `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f1f5f9; color: #1e293b; -webkit-font-smoothing: antialiased; }
    .wrapper { max-width: 600px; margin: 30px auto; background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); }
    .header { background: #013E37; padding: 32px 30px; text-align: center; border-bottom: 3px solid #059669; }
    .logo { font-size: 26px; font-weight: 800; color: #ffffff; letter-spacing: 2px; text-transform: uppercase; }
    .logo span { color: #34d399; }
    .tagline { font-size: 11px; color: #99f6e4; margin-top: 6px; letter-spacing: 1.5px; text-transform: uppercase; font-weight: 500; }
    .body { padding: 36px 32px; background: #ffffff; }
    .title { font-size: 20px; font-weight: 700; color: #0f172a; margin-bottom: 16px; }
    .text { font-size: 14px; color: #475569; line-height: 1.65; margin-bottom: 16px; }
    .highlight-box { background: #f8fafc; border: 1px solid #e2e8f0; padding: 18px 20px; border-radius: 8px; margin: 20px 0; }
    .highlight-box .label { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; margin-bottom: 4px; }
    .highlight-box .value { font-size: 20px; font-weight: 700; color: #013E37; }
    .info-grid { display: table; width: 100%; border-collapse: collapse; margin: 18px 0; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0; }
    .info-row { display: table-row; }
    .info-cell { display: table-cell; padding: 10px 14px; border-bottom: 1px solid #e2e8f0; font-size: 13px; }
    .info-row:last-child .info-cell { border-bottom: none; }
    .info-cell.label { color: #64748b; width: 42%; font-weight: 500; }
    .info-cell.value { color: #0f172a; font-weight: 600; }
    .btn { display: inline-block; background: #013E37; color: #ffffff !important; padding: 13px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px; margin: 20px 0; }
    .btn:hover { background: #012d28; }
    .status-badge { display: inline-block; padding: 4px 10px; border-radius: 9999px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
    .status-success { background: #ecfdf5; color: #059669; border: 1px solid #a7f3d0; }
    .status-pending { background: #fffbeb; color: #d97706; border: 1px solid #fde68a; }
    .status-danger { background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; }
    .attachment-notice { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 14px 18px; margin: 20px 0; font-size: 13px; color: #166534; line-height: 1.5; }
    .divider { border: none; border-top: 1px solid #e2e8f0; margin: 24px 0; }
    .footer { background: #f8fafc; padding: 24px 30px; text-align: center; border-top: 1px solid #e2e8f0; }
    .footer p { font-size: 11px; color: #64748b; line-height: 1.7; }
    .footer a { color: #013E37; font-weight: 600; text-decoration: none; }
    .otp { font-size: 32px; font-weight: 800; color: #013E37; letter-spacing: 8px; text-align: center; padding: 18px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; margin: 20px 0; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <div class="logo">NAFO<span>RO</span></div>
      <div class="tagline">Plateforme Intelligente de Gestion Locative</div>
    </div>
    <div class="body">
      ${content}
    </div>
    <div class="footer">
      <p>
        &copy; ${new Date().getFullYear()} NAFORO Technologies &mdash; Tous droits réservés.<br/>
        Abidjan, Côte d'Ivoire &bull; <a href="${env.FRONTEND_URL}">${env.FRONTEND_URL}</a><br/>
        Support : <a href="mailto:support@naforo.company">support@naforo.company</a> &bull; Commercial : <a href="mailto:contact@naforo.company">contact@naforo.company</a><br/>
        Ceci est une notification automatique sécurisée relative à votre compte organisation.
      </p>
    </div>
  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Email templates
// ---------------------------------------------------------------------------

export interface PaymentDeclaredParams {
  tenantName: string;
  amount: string;
  reference: string;
  method: string;
  propertyName: string;
  period: string;
}

export function paymentDeclared(params: PaymentDeclaredParams): string {
  return baseLayout('Paiement Déclaré - Naforo', `
    <div class="title">Paiement reçu et en attente de validation</div>
    <p class="text">Bonjour <strong>${params.tenantName}</strong>,</p>
    <p class="text">Votre paiement a bien été enregistré sur Naforo. Il sera validé par votre gestionnaire dans les plus brefs délais.</p>
    <div class="highlight-box">
      <div class="label">Montant</div>
      <div class="value">${params.amount}</div>
    </div>
    <div class="info-grid">
      <div class="info-row">
        <div class="info-cell label">Référence</div>
        <div class="info-cell value">${params.reference}</div>
      </div>
      <div class="info-row">
        <div class="info-cell label">Mode de paiement</div>
        <div class="info-cell value">${params.method}</div>
      </div>
      <div class="info-row">
        <div class="info-cell label">Propriété</div>
        <div class="info-cell value">${params.propertyName}</div>
      </div>
      <div class="info-row">
        <div class="info-cell label">Période</div>
        <div class="info-cell value">${params.period}</div>
      </div>
      <div class="info-row">
        <div class="info-cell label">Statut</div>
        <div class="info-cell value"><span class="status-badge status-pending">En attente</span></div>
      </div>
    </div>
    <p class="text">Vous recevrez une notification dès que votre paiement sera validé et votre quittance émise.</p>
  `);
}

export interface PaymentValidatedParams {
  tenantName: string;
  amount: string;
  reference: string;
  propertyName: string;
  period: string;
  receiptUrl?: string;
}

export function paymentValidated(params: PaymentValidatedParams): string {
  return baseLayout('Paiement Validé ✓ - Naforo', `
    <div class="title">✅ Votre paiement a été validé</div>
    <p class="text">Bonjour <strong>${params.tenantName}</strong>,</p>
    <p class="text">Excellente nouvelle ! Votre paiement a été validé avec succès. Votre quittance de loyer est disponible.</p>
    <div class="highlight-box">
      <div class="label">Montant validé</div>
      <div class="value">${params.amount}</div>
    </div>
    <div class="info-grid">
      <div class="info-row">
        <div class="info-cell label">Référence</div>
        <div class="info-cell value">${params.reference}</div>
      </div>
      <div class="info-row">
        <div class="info-cell label">Propriété</div>
        <div class="info-cell value">${params.propertyName}</div>
      </div>
      <div class="info-row">
        <div class="info-cell label">Période</div>
        <div class="info-cell value">${params.period}</div>
      </div>
      <div class="info-row">
        <div class="info-cell label">Statut</div>
        <div class="info-cell value"><span class="status-badge status-success">Validé</span></div>
      </div>
    </div>
    ${params.receiptUrl ? `<a href="${params.receiptUrl}" class="btn">📄 Télécharger la quittance</a>` : ''}
  `);
}

export interface PaymentRejectedParams {
  tenantName: string;
  amount: string;
  reference: string;
  reason: string;
}

export function paymentRejected(params: PaymentRejectedParams): string {
  return baseLayout('Paiement Rejeté - Naforo', `
    <div class="title">⚠️ Votre paiement a été rejeté</div>
    <p class="text">Bonjour <strong>${params.tenantName}</strong>,</p>
    <p class="text">Nous vous informons que votre paiement a été rejeté par votre gestionnaire.</p>
    <div class="highlight-box">
      <div class="label">Montant</div>
      <div class="value">${params.amount}</div>
    </div>
    <div class="info-grid">
      <div class="info-row">
        <div class="info-cell label">Référence</div>
        <div class="info-cell value">${params.reference}</div>
      </div>
      <div class="info-row">
        <div class="info-cell label">Motif du rejet</div>
        <div class="info-cell value" style="color:#f87171;">${params.reason}</div>
      </div>
      <div class="info-row">
        <div class="info-cell label">Statut</div>
        <div class="info-cell value"><span class="status-badge status-danger">Rejeté</span></div>
      </div>
    </div>
    <p class="text">Veuillez vous connecter à l'application pour soumettre à nouveau votre paiement avec les informations correctes.</p>
    <a href="${env.FRONTEND_URL}" class="btn">🔁 Soumettre un nouveau paiement</a>
  `);
}

export interface InvoiceGeneratedParams {
  tenantName: string;
  invoiceNumber: string;
  amount: string;
  dueDate: string;
  propertyName: string;
  period: string;
  invoiceUrl?: string;
}

export function invoiceGenerated(params: InvoiceGeneratedParams): string {
  return baseLayout(`Facture ${params.invoiceNumber} - Naforo`, `
    <div class="title">📋 Nouvelle facture disponible</div>
    <p class="text">Bonjour <strong>${params.tenantName}</strong>,</p>
    <p class="text">Votre facture de loyer pour la période <strong>${params.period}</strong> est disponible.</p>
    <div class="highlight-box">
      <div class="label">Montant à payer</div>
      <div class="value">${params.amount}</div>
    </div>
    <div class="info-grid">
      <div class="info-row">
        <div class="info-cell label">N° Facture</div>
        <div class="info-cell value">${params.invoiceNumber}</div>
      </div>
      <div class="info-row">
        <div class="info-cell label">Propriété</div>
        <div class="info-cell value">${params.propertyName}</div>
      </div>
      <div class="info-row">
        <div class="info-cell label">Période</div>
        <div class="info-cell value">${params.period}</div>
      </div>
      <div class="info-row">
        <div class="info-cell label">Date d'échéance</div>
        <div class="info-cell value" style="color:#fbbf24;">${params.dueDate}</div>
      </div>
    </div>
    ${params.invoiceUrl ? `<a href="${params.invoiceUrl}" class="btn">📥 Télécharger la facture</a>` : ''}
    <p class="text">Veuillez effectuer votre paiement avant la date d'échéance pour éviter les pénalités.</p>
  `);
}

export interface ReminderParams {
  tenantName: string;
  amount: string;
  dueDate: string;
  daysRemaining: number;
  propertyName: string;
  isOverdue?: boolean;
  daysOverdue?: number;
}

export function reminder(params: ReminderParams): string {
  const isLate = params.isOverdue;
  const titleText = isLate
    ? `⚠️ Loyer en retard - ${params.daysOverdue} jour(s) de retard`
    : `🔔 Rappel de paiement - Échéance dans ${params.daysRemaining} jour(s)`;

  return baseLayout(`Rappel de loyer - Naforo`, `
    <div class="title">${titleText}</div>
    <p class="text">Bonjour <strong>${params.tenantName}</strong>,</p>
    <p class="text">${isLate
      ? `Votre loyer est en retard de <strong style="color:#f87171;">${params.daysOverdue} jour(s)</strong>. Merci d'effectuer votre paiement dès que possible.`
      : `Votre loyer est dû dans <strong style="color:#fbbf24;">${params.daysRemaining} jour(s)</strong>. Pensez à effectuer votre paiement à temps.`
    }</p>
    <div class="highlight-box">
      <div class="label">Montant dû</div>
      <div class="value">${params.amount}</div>
    </div>
    <div class="info-grid">
      <div class="info-row">
        <div class="info-cell label">Propriété</div>
        <div class="info-cell value">${params.propertyName}</div>
      </div>
      <div class="info-row">
        <div class="info-cell label">Date d'échéance</div>
        <div class="info-cell value" style="color:${isLate ? '#f87171' : '#fbbf24'};">${params.dueDate}</div>
      </div>
    </div>
    <a href="${env.FRONTEND_URL}" class="btn">💳 Effectuer le paiement</a>
  `);
}

export interface WelcomeParams {
  firstName: string;
  email: string;
  role: string;
  loginUrl?: string;
  tempPassword?: string;
}

export function welcome(params: WelcomeParams): string {
  return baseLayout('Bienvenue sur Naforo !', `
    <div class="title">🎉 Bienvenue sur Naforo !</div>
    <p class="text">Bonjour <strong>${params.firstName}</strong>,</p>
    <p class="text">Votre compte Naforo a été créé avec succès. Vous pouvez maintenant accéder à votre espace de gestion locative.</p>
    <div class="info-grid">
      <div class="info-row">
        <div class="info-cell label">Email</div>
        <div class="info-cell value">${params.email}</div>
      </div>
      <div class="info-row">
        <div class="info-cell label">Rôle</div>
        <div class="info-cell value">${params.role}</div>
      </div>
      ${params.tempPassword ? `
      <div class="info-row">
        <div class="info-cell label">Mot de passe temporaire</div>
        <div class="info-cell value" style="color:#fbbf24;">${params.tempPassword}</div>
      </div>` : ''}
    </div>
    <p class="text" style="color:#6b7280; font-size:13px;">Pour votre sécurité, veuillez changer votre mot de passe lors de votre première connexion.</p>
    <a href="${params.loginUrl ?? env.FRONTEND_URL}" class="btn">🚀 Se connecter</a>
  `);
}

export interface PasswordResetParams {
  firstName: string;
  otp: string;
  expiresInMinutes: number;
}

export function passwordReset(params: PasswordResetParams): string {
  return baseLayout('Réinitialisation de mot de passe - Naforo', `
    <div class="title">🔐 Réinitialisation de mot de passe</div>
    <p class="text">Bonjour <strong>${params.firstName}</strong>,</p>
    <p class="text">Vous avez demandé à réinitialiser votre mot de passe Naforo. Utilisez le code suivant :</p>
    <div class="otp">${params.otp}</div>
    <p class="text" style="text-align:center; color:#6b7280;">Ce code est valable pendant <strong style="color:#fbbf24;">${params.expiresInMinutes} minutes</strong>.</p>
    <hr class="divider" />
    <p class="text" style="font-size:13px; color:#4b5563;">Si vous n'avez pas fait cette demande, ignorez cet e-mail. Votre mot de passe ne sera pas modifié.</p>
  `);
}

export interface SubscriptionApprovedParams {
  orgName: string;
  recipientName?: string;
  planName: string;
  billingCycle: string;
  amount: string;
  reference: string;
  paymentMethod: string;
  transactionNumber?: string | null;
  startDate: string;
  endDate: string;
  dashboardUrl?: string;
}

export function subscriptionPaymentApproved(params: SubscriptionApprovedParams): string {
  return baseLayout(`Facture d'Abonnement Naforo - Réf ${params.reference}`, `
    <div style="text-align: center; margin-bottom: 24px;">
      <span class="status-badge status-success" style="font-size: 12px; padding: 6px 16px;">
        ✓ Abonnement Activé & Facture Émise
      </span>
    </div>
    
    <div class="title" style="text-align: center; margin-bottom: 8px;">
      Félicitations ! Votre souscription est validée
    </div>
    <p class="text" style="text-align: center; margin-bottom: 24px;">
      Bonjour <strong>${params.recipientName || params.orgName}</strong>, nous vous confirmons que votre règlement pour l'organisation <strong>${params.orgName}</strong> a été validé avec succès par la direction de la plateforme.
    </p>

    <div class="highlight-box" style="text-align: center;">
      <div class="label">Montant Total Réglé</div>
      <div class="value">${params.amount}</div>
    </div>

    <div class="info-grid">
      <div class="info-row">
        <div class="info-cell label">Offre souscrite</div>
        <div class="info-cell value">Naforo ${params.planName}</div>
      </div>
      <div class="info-row">
        <div class="info-cell label">Cycle de facturation</div>
        <div class="info-cell value">${params.billingCycle}</div>
      </div>
      <div class="info-row">
        <div class="info-cell label">Période de validité</div>
        <div class="info-cell value">Du ${params.startDate} au ${params.endDate}</div>
      </div>
      <div class="info-row">
        <div class="info-cell label">Mode de règlement</div>
        <div class="info-cell value">${params.paymentMethod}</div>
      </div>
      ${params.transactionNumber ? `
      <div class="info-row">
        <div class="info-cell label">N° Transaction Opérateur</div>
        <div class="info-cell value">${params.transactionNumber}</div>
      </div>` : ''}
      <div class="info-row">
        <div class="info-cell label">Réf. Document / Facture</div>
        <div class="info-cell value" style="color: #013E37; font-weight: 700;">${params.reference}</div>
      </div>
    </div>

    <div class="attachment-notice">
      📎 <strong>Facture Officielle Jointe :</strong> Votre facture acquittée certifiée au format PDF est attachée à ce message (<em>Facture-Naforo-${params.reference}.pdf</em>). Elle fait office de reçu officiel et de pièce comptable justificative.
    </div>

    <div style="text-align: center; margin-top: 28px;">
      <a href="${params.dashboardUrl ?? env.FRONTEND_URL}" class="btn">
        🚀 Accéder à mon Espace Naforo
      </a>
    </div>

    <p class="text" style="font-size: 12px; color: #64748b; text-align: center; margin-top: 16px;">
      Besoin d'aide ou d'une question concernant votre compte ? Contactez notre support à <a href="mailto:support@naforo.company" style="color: #013E37; font-weight: 600;">support@naforo.company</a>.
    </p>
  `);
}



