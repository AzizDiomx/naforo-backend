import { prisma } from '@/config/database';
import { BadRequestError, ForbiddenError, NotFoundError } from '@/shared/errors/AppError';
import { getOrganizationPlanContext, getPlanExtendedQuotas } from '@/shared/helpers/plan-policy';
import {
  sendWhatsAppMessage,
  buildInvoiceReminderTemplate,
  getConfiguredWhatsAppProvider,
} from '@/config/whatsapp';
import { whatsappRepository, WhatsAppLogQueryOptions } from './whatsapp.repository';

const FRENCH_MONTHS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

async function getMonthlyWhatsappUsage(organizationId: string) {
  const ctx = await getOrganizationPlanContext(organizationId);
  const { maxWhatsappMonthly } = getPlanExtendedQuotas(ctx.planCode, ctx.features);
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const usedThisMonth = await prisma.whatsAppLog.count({
    where: { organizationId, createdAt: { gte: monthStart } },
  });

  return {
    usedThisMonth,
    maxWhatsappMonthly,
    planName: ctx.planName,
    planCode: ctx.planCode,
  };
}

async function assertWhatsappQuota(organizationId: string, countNeeded = 1) {
  const usage = await getMonthlyWhatsappUsage(organizationId);
  if (usage.maxWhatsappMonthly < 9999 && usage.usedThisMonth + countNeeded > usage.maxWhatsappMonthly) {
    throw new ForbiddenError(
      `Quota mensuel WhatsApp atteint (${usage.usedThisMonth}/${usage.maxWhatsappMonthly}) pour votre forfait ${usage.planName}.`
    );
  }
  return usage;
}

export const whatsappService = {
  /**
   * Envoie une relance WhatsApp pour une facture donnée et génère le lien direct 1-clic wa.me
   */
  async remindInvoice(
    invoiceId: string,
    organizationId: string,
    sentById?: string,
    options?: { customNote?: string; forceApi?: boolean; userRole?: string }
  ) {
    await assertWhatsappQuota(organizationId, 1);

    const invoice = await prisma.invoice.findFirst({
      where: {
        id: invoiceId,
        organizationId,
        ...(options?.userRole === 'manager' && sentById
          ? {
              property: {
                OR: [{ managerId: sentById }, { parent: { managerId: sentById } }],
              },
            }
          : {}),
      },
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
      throw new NotFoundError('Facture introuvable ou hors de votre portefeuille.');
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
    const propertyName = invoice.property
      ? `${invoice.property.name} (${invoice.property.address})`
      : 'Bien loué';

    const dueDate = new Date(invoice.dueDate);
    const now = new Date();
    const isOverdue =
      invoice.status === 'overdue' || (invoice.status === 'pending' && now > dueDate);
    const daysOverdue = isOverdue
      ? Math.max(1, Math.floor((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24)))
      : 0;

    const totalInvoiceAmount = Number(invoice.totalAmount);
    const totalPaid = (invoice.payments || []).reduce(
      (acc: number, p: any) => acc + Number(p.amount),
      0
    );
    const remainingAmountXof = Math.max(0, totalInvoiceAmount - totalPaid);

    const monthIndex = Math.max(0, Math.min(11, (invoice.periodMonth || 1) - 1));
    const periodLabel = `${FRENCH_MONTHS[monthIndex]} ${invoice.periodYear || dueDate.getFullYear()}`;
    const formattedDueDate = `${String(dueDate.getDate()).padStart(2, '0')}/${String(
      dueDate.getMonth() + 1
    ).padStart(2, '0')}/${dueDate.getFullYear()}`;

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
      message += `\n\n*Note du gestionnaire :*\n${options.customNote.trim()}`;
    }

    const sendResult = await sendWhatsAppMessage(phone, message);
    const logStatus =
      (sendResult.provider === 'twilio' || sendResult.provider === 'meta_cloud') &&
      sendResult.success
        ? 'sent'
        : 'direct_link_opened';

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
   * Relance groupée de plusieurs factures impayées / en attente
   */
  async bulkRemindInvoices(input: {
    organizationId: string;
    invoiceIds: string[];
    sentById?: string;
    userRole?: string;
    customNote?: string;
  }) {
    const cleanIds = Array.from(new Set((input.invoiceIds || []).filter(Boolean))).slice(0, 50);
    if (cleanIds.length === 0) {
      throw new BadRequestError('Veuillez sélectionner au moins une facture à relancer.');
    }

    await assertWhatsappQuota(input.organizationId, cleanIds.length);

    const results: Array<{
      invoiceId: string;
      invoiceNumber?: string;
      recipientName?: string;
      directWhatsAppUrl?: string;
      status: 'ok' | 'skipped';
      reason?: string;
    }> = [];

    for (const invId of cleanIds) {
      try {
        const res = await this.remindInvoice(invId, input.organizationId, input.sentById, {
          customNote: input.customNote,
          userRole: input.userRole,
        });
        results.push({
          invoiceId: invId,
          invoiceNumber: res.invoiceNumber,
          recipientName: res.recipientName,
          directWhatsAppUrl: res.directWhatsAppUrl,
          status: 'ok',
        });
      } catch (err: any) {
        results.push({
          invoiceId: invId,
          status: 'skipped',
          reason: err?.message || 'Ignorée',
        });
      }
    }

    return {
      totalRequested: cleanIds.length,
      sentCount: results.filter((r) => r.status === 'ok').length,
      skippedCount: results.filter((r) => r.status === 'skipped').length,
      results,
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
    templateType?: string;
    relatedEntity?: string;
    relatedId?: string;
    sentById?: string;
  }) {
    if (!data.recipientPhone || !data.message) {
      throw new BadRequestError('Numéro de téléphone et message obligatoires.');
    }

    await assertWhatsappQuota(data.organizationId, 1);

    const sendResult = await sendWhatsAppMessage(data.recipientPhone, data.message);
    const logStatus =
      (sendResult.provider === 'twilio' || sendResult.provider === 'meta_cloud') &&
      sendResult.success
        ? 'sent'
        : 'direct_link_opened';

    const log = await whatsappRepository.createLog({
      organizationId: data.organizationId,
      recipientPhone: data.recipientPhone,
      recipientName: data.recipientName,
      templateType: data.templateType || 'custom',
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
    const [baseStats, quotaUsage] = await Promise.all([
      whatsappRepository.getStats(organizationId),
      getMonthlyWhatsappUsage(organizationId),
    ]);

    return {
      ...baseStats,
      ...quotaUsage,
      providerMode: getConfiguredWhatsAppProvider(),
    };
  },
};
