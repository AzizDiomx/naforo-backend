import { prisma } from '@/config/database';
import { Notification } from '@prisma/client';
import { PaginationQuery } from '@/shared/types';

export class NotificationsRepository {
  async findByUser(userId: string, organizationId?: string, query?: PaginationQuery): Promise<{ notifications: Notification[]; total: number; unreadCount: number }> {
    const page = query?.page || 1;
    const limit = query?.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = {
      OR: [
        { userId },
        ...(organizationId ? [{ organizationId, userId: null }] : []),
      ],
    };

    const [notifications, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { ...where, isRead: false } }),
    ]);

    return { notifications, total, unreadCount };
  }

  async findSuperAdminNotifications(): Promise<{ notifications: Notification[]; total: number; unreadCount: number }> {
    const where: any = {
      type: { in: ['NEW_ORGANIZATION', 'SYSTEM_ALERT', 'PAYMENT_VALIDATED_SUPERADMIN'] },
    };

    const [notifications, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { ...where, isRead: false } }),
    ]);

    return { notifications, total, unreadCount };
  }

  async markAsRead(id: string): Promise<Notification> {
    return prisma.notification.update({
      where: { id },
      data: { isRead: true },
    });
  }

  async markAllAsRead(userId: string, organizationId?: string): Promise<void> {
    const where: any = {
      OR: [
        { userId },
        ...(organizationId ? [{ organizationId, userId: null }] : []),
      ],
      isRead: false,
    };

    await prisma.notification.updateMany({
      where,
      data: { isRead: true },
    });
  }

  async getPreferences(userId: string) {
    let prefs = await prisma.notificationPreference.findUnique({
      where: { userId }
    });
    if (!prefs) {
      prefs = await prisma.notificationPreference.create({
        data: {
          userId,
          emailEnabled: true,
          smsEnabled: false,
          pushEnabled: true,
          reminderEnabled: true,
        }
      });
    }
    return prefs;
  }

  async updatePreferences(userId: string, data: any) {
    const { emailEnabled, smsEnabled, pushEnabled, reminderEnabled, reminderDaysBefore, reminderDaysAfter } = data;
    return prisma.notificationPreference.upsert({
      where: { userId },
      create: {
        userId,
        emailEnabled: emailEnabled ?? true,
        smsEnabled: smsEnabled ?? false,
        pushEnabled: pushEnabled ?? true,
        reminderEnabled: reminderEnabled ?? true,
        reminderDaysBefore,
        reminderDaysAfter
      },
      update: {
        ...(emailEnabled !== undefined && { emailEnabled }),
        ...(smsEnabled !== undefined && { smsEnabled }),
        ...(pushEnabled !== undefined && { pushEnabled }),
        ...(reminderEnabled !== undefined && { reminderEnabled }),
        ...(reminderDaysBefore !== undefined && { reminderDaysBefore }),
        ...(reminderDaysAfter !== undefined && { reminderDaysAfter }),
      }
    });
  }
}

export const notificationsRepository = new NotificationsRepository();
export default notificationsRepository;
