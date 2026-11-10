import { prisma } from '@/config/database';
import { BadRequestError, NotFoundError } from '@/shared/errors/AppError';
import {
  sendWhatsAppMessage,
  generateWhatsAppLink,
  buildInvoiceReminderTemplate,
  formatWhatsAppNumber,
} from '@/config/whatsapp';
import { whatsappRepository, WhatsAppLogQueryOptions } from './whatsapp.repository';

const FRENCH_MONTHS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

export const whatsappService = {
  /**
   * Envoie une relance WhatsApp pour une facture donnée et génère le lien direct 1-clic wa.me
   */
  async remindInvoice(
    invoiceId: string,
    organizationId: string,
    sentById?: string,
    options?: { customNote?: string; forceApi?: boolean }
  ) {
    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, organizationId },
      include: {
        tenantProfile: true,
        property: true,
        organization: true,
        payments: {
          where: { status: 'validated' },
        },
      },
    });

    if (!invoice) {
      throw new NotFoundError('Facture introuvable.');
    }

    const tenant = invoice.tenantProfile;
    const phone = tenant?.phone;

    if (!phone) {
      throw new BadRequestError(
        `Le locataire (${tenant ? `${tenant.firstName} ${tenant.lastName}` : 'Inconnu'}) n'a aucun numéro de téléphone renseigné.`
      );
    }

    const tenantFullName = tenant ? `${tenant.firstName} ${tenant.lastName}`.trim() : 'Locataire';
    const agencyName = invoice.organization?.name || 'Votre Gestionnaire Immobilier';
    const propertyName = invoice.property ? `${invoice.property.name} (${invoice.property.address})` : 'Bien loué';
    
    const dueDate = new Date(invoice.dueDate);
    const now = new Date();
    const isOverdue = invoice.status === 'overdue' || (invoice.status === 'pending' && now > dueDate);
    const daysOverdue = isOverdue
      ? Math.max(1, Math.floor((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24)))
      : 0;

    const totalInvoiceAmount = Number(invoice.totalAmount);
    const totalPaid = (invoice.payments || []).reduce((acc: number, p: any) => acc + Number(p.amount), 0);
    const remainingAmountXof = Math.max(0, totalInvoiceAmount - totalPaid);

    const monthIndex = Math.max(0, Math.min(11, (invoice.periodMonth || 1) - 1));
    const periodLabel = `${FRENCH_MONTHS[monthIndex]} ${invoice.periodYear || dueDate.getFullYear()}`;
    const formattedDueDate = `${String(dueDate.getDate()).padStart(2, '0')}/${String(dueDate.getMonth() + 1).padStart(2, '0')}/${dueDate.getFullYear()}`;

    let message = buildInvoiceReminderTemplate({
      tenantName: tenantFullName,
      agencyName,
      propertyName,
      invoiceNumber: invoice.invoiceNumber,
      amountXof: remainingAmountXof,
      periodLabel,
      dueDate: formattedDueDate,
      isOverdue,
      daysOverdue,
    });

    if (options?.customNote?.trim()) {
      message += `\n\n💬 *Note du gestionnaire :*\n${options.customNote.trim()}`;
    }

    // Envoi via Twilio ou génération du lien wa.me
    const sendResult = await sendWhatsAppMessage(phone, message);
    const logStatus = sendResult.provider === 'twilio' && sendResult.success ? 'sent' : 'direct_link_opened';

    // Journalisation dans la table whatsapp_logs
    const log = await whatsappRepository.createLog({
      organizationId,
      recipientPhone: phone,
      recipientName: tenantFullName,
      templateType: isOverdue ? 'overdue_reminder' : 'invoice_due',
      messageContent: message,
      status: logStatus,
      relatedEntity: 'invoice',
      relatedId: invoice.id,
      sentById: sentById || null,
    });

    return {
      success: true,
      logId: log.id,
      recipientName: tenantFullName,
      recipientPhone: phone,
      invoiceNumber: invoice.invoiceNumber,
      amountRemainingXof: remainingAmountXof,
      isOverdue,
      messageContent: message,
      directWhatsAppUrl: sendResult.directWhatsAppUrl,
      provider: sendResult.provider,
      status: logStatus,
    };
  },

  /**
   * Envoie un message WhatsApp direct ou génère le lien wa.me personnalisé
   */
  async sendCustomWhatsApp(data: {
    organizationId: string;
    recipientPhone: string;
    recipientName?: string;
    message: string;
    relatedEntity?: string;
    relatedId?: string;
    sentById?: string;
  }) {
    if (!data.recipientPhone || !data.message) {
      throw new BadRequestError('Numéro de téléphone et message obligatoires.');
    }

    const sendResult = await sendWhatsAppMessage(data.recipientPhone, data.message);
    const logStatus = sendResult.provider === 'twilio' && sendResult.success ? 'sent' : 'direct_link_opened';

    const log = await whatsappRepository.createLog({
      organizationId: data.organizationId,
      recipientPhone: data.recipientPhone,
      recipientName: data.recipientName,
      templateType: 'custom',
      messageContent: data.message,
      status: logStatus,
      relatedEntity: data.relatedEntity,
      relatedId: data.relatedId,
      sentById: data.sentById || null,
    });

    return {
      success: true,
      logId: log.id,
      directWhatsAppUrl: sendResult.directWhatsAppUrl,
      provider: sendResult.provider,
      status: logStatus,
    };
  },

  async getLogs(organizationId: string, options: WhatsAppLogQueryOptions) {
    return whatsappRepository.findLogs(organizationId, options);
  },

  async getStats(organizationId: string) {
    return whatsappRepository.getStats(organizationId);
  },
};
