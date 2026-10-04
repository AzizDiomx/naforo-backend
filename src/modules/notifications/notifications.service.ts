import { notificationsRepository } from './notifications.repository';
import { Notification } from '@prisma/client';
import { PaginationQuery } from '@/shared/types';
import { prisma } from '@/config/database';
import { dispatchNotification } from '@/shared/helpers/notification';
import { formatDate, formatCurrency, getMonthName } from '@/shared/helpers/date';
import { logger } from '@/config/logger';

export class NotificationsService {
  async getUserNotifications(userId: string, userRole: string, organizationId?: string, query?: PaginationQuery): Promise<{ notifications: Notification[]; total: number; unreadCount: number }> {
    if (userRole === 'super_admin') {
      return notificationsRepository.findSuperAdminNotifications();
    }
    return notificationsRepository.findByUser(userId, organizationId, query);
  }

  async markAsRead(id: string): Promise<Notification> {
    return notificationsRepository.markAsRead(id);
  }

  async markAllAsRead(userId: string, organizationId?: string): Promise<void> {
    return notificationsRepository.markAllAsRead(userId, organizationId);
  }

  async getPreferences(userId: string) {
    return notificationsRepository.getPreferences(userId);
  }

  async updatePreferences(userId: string, data: any) {
    return notificationsRepository.updatePreferences(userId, data);
  }

  async sendPaymentReminder(contract: any, invoice: any, daysOffset: number): Promise<void> {
    const tenantUser = await prisma.user.findFirst({
      where: {
        OR: [
          { id: contract.tenantProfile.userId || '' },
          { email: contract.tenantProfile.email || '' },
          { phone: contract.tenantProfile.phone || '' }
        ]
      }
    });

    const periodName = getMonthName(invoice.periodMonth, invoice.periodYear);
    const amountStr = formatCurrency(Number(invoice.totalAmount));

    let title = '';
    let message = '';
    let type = 'PAYMENT_REMINDER';

    if (daysOffset < 0) {
      const days = Math.abs(daysOffset);
      title = `Avis d'échéance - Loyer ${periodName}`;
      message = `Bonjour ${contract.tenantProfile.firstName}, votre loyer de ${amountStr} pour le bien ${contract.property.name} arrive à échéance dans ${days} jour(s) (${formatDate(invoice.dueDate)}).`;
    } else if (daysOffset === 0) {
      title = `Jour d'échéance - Loyer ${periodName}`;
      message = `Bonjour ${contract.tenantProfile.firstName}, votre loyer de ${amountStr} pour le bien ${contract.property.name} est dû aujourd'hui. Veuillez déclarer votre paiement sur votre espace locataire.`;
    } else {
      title = `Relance d'impayé - Loyer ${periodName}`;
      message = `Bonjour ${contract.tenantProfile.firstName}, votre loyer de ${amountStr} pour le bien ${contract.property.name} accuse un retard de ${daysOffset} jour(s). Merci de régulariser votre situation rapidement.`;
      type = 'PAYMENT_OVERDUE_ALERT';
    }

    const emailHtml = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
        <h2 style="color: #2563eb;">${title}</h2>
        <p>${message}</p>
        <div style="background-color: #f8fafc; padding: 15px; border-radius: 6px; margin: 20px 0;">
          <table style="width: 100%; font-size: 14px;">
            <tr><td><strong>Bien concerné :</strong></td><td style="text-align: right;">${contract.property.name}</td></tr>
            <tr><td><strong>Période :</strong></td><td style="text-align: right;">${periodName}</td></tr>
            <tr><td><strong>Montant du Loyer :</strong></td><td style="text-align: right; font-weight: bold; color: #0f172a;">${amountStr}</td></tr>
            <tr><td><strong>Date limite :</strong></td><td style="text-align: right; color: #ef4444; font-weight: bold;">${formatDate(invoice.dueDate)}</td></tr>
          </table>
        </div>
        <p>Connectez-vous sur votre Espace Locataire Naforo pour effectuer votre déclaration de règlement.</p>
      </div>
    `;

    await dispatchNotification({
      organizationId: contract.organizationId,
      userId: tenantUser?.id,
      email: contract.tenantProfile.email,
      phone: contract.tenantProfile.phone,
      type,
      title,
      emailSubject: `${title} - Naforo`,
      emailHtml,
      smsText: message,
      data: {
        contractId: contract.id,
        invoiceId: invoice.id,
        amount: invoice.totalAmount,
        daysOffset
      }
    });

    logger.info(`Sent payment reminder (offset ${daysOffset}d) to tenant ${contract.tenantProfile.firstName} ${contract.tenantProfile.lastName}`);
  }
}

export const notificationsService = new NotificationsService();


