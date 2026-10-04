import { chatRepository } from './chat.repository';
import { prisma } from '@/config/database';
import { NotFoundError, ForbiddenError } from '@/shared/errors/AppError';
import { emitToUser, emitToOrg, emitToThread } from '@/sockets/socket.handler';
import { dispatchNotification } from '@/shared/helpers/notification';

export class ChatService {
  async getThreads(userId: string, role: string, organizationId?: string) {
    return chatRepository.getThreadsForUser(userId, role, organizationId);
  }

  async getOrCreateLandlordThread(organizationId: string, tenantProfileId: string, propertyId?: string) {
    const tenant = await prisma.tenantProfile.findFirst({
      where: { id: tenantProfileId, organizationId },
    });
    if (!tenant) throw new NotFoundError("Locataire introuvable dans cette organisation.");

    const activeContract = await prisma.contract.findFirst({
      where: { tenantProfileId, status: 'active' },
    });

    return chatRepository.getOrCreateThread(
      organizationId,
      tenantProfileId,
      propertyId || activeContract?.propertyId || undefined,
      activeContract?.id || undefined
    );
  }

  async getOrCreateTenantThread(userId: string, organizationId?: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundError("Utilisateur introuvable.");

    let profile = await prisma.tenantProfile.findFirst({
      where: {
        OR: [
          { userId },
          { email: user.email },
          { phone: user.phone || '' }
        ]
      }
    });

    if (!profile) {
      throw new NotFoundError("Aucun profil locataire associé à ce compte.");
    }

    // Auto-link userId to tenantProfile if unlinked
    if (!profile.userId) {
      profile = await prisma.tenantProfile.update({
        where: { id: profile.id },
        data: { userId }
      });
    }

    const activeContract = await prisma.contract.findFirst({
      where: { tenantProfileId: profile.id, status: 'active' },
    });

    const orgId = organizationId || profile.organizationId;
    return chatRepository.getOrCreateThread(
      orgId,
      profile.id,
      activeContract?.propertyId,
      activeContract?.id
    );
  }

  async getMessages(threadId: string, userId: string, role: string, organizationId?: string) {
    const thread = await prisma.chatThread.findUnique({
      where: { id: threadId },
      include: { tenantProfile: true },
    });

    if (!thread) {
      throw new NotFoundError("Conversation introuvable.");
    }

    // Access control check
    if (role === 'tenant') {
      const userTenantProfile = await prisma.tenantProfile.findFirst({
        where: {
          OR: [
            { userId },
            { id: thread.tenantProfileId }
          ]
        }
      });

      if (!userTenantProfile || userTenantProfile.id !== thread.tenantProfileId) {
        throw new ForbiddenError("Accès non autorisé à cette conversation.");
      }
    } else {
      if (role !== 'super_admin' && thread.organizationId !== organizationId) {
        throw new ForbiddenError("Accès non autorisé à cette conversation.");
      }
    }

    // Mark unread messages as read
    await chatRepository.markAsRead(threadId, userId);

    return chatRepository.getThreadMessages(threadId);
  }

  async sendMessage(
    threadId: string,
    senderId: string,
    senderRole: string,
    content: string,
    attachments?: any,
    organizationId?: string
  ) {
    const thread = await prisma.chatThread.findUnique({
      where: { id: threadId },
      include: {
        tenantProfile: { include: { user: true } },
        organization: true,
      },
    });

    if (!thread) {
      throw new NotFoundError("Conversation introuvable.");
    }

    // Access control check
    if (senderRole === 'tenant') {
      const userTenantProfile = await prisma.tenantProfile.findFirst({
        where: {
          OR: [
            { userId: senderId },
            { id: thread.tenantProfileId }
          ]
        }
      });

      if (!userTenantProfile || userTenantProfile.id !== thread.tenantProfileId) {
        throw new ForbiddenError("Accès non autorisé à cette conversation.");
      }
    } else {
      if (senderRole !== 'super_admin' && thread.organizationId !== organizationId) {
        throw new ForbiddenError("Accès non autorisé à cette conversation.");
      }
    }

    const message = await chatRepository.createMessage({
      threadId,
      senderId,
      senderRole,
      content,
      attachments,
    });

    // ─── Real-Time WebSocket & Offline Notifications ────────────────────────

    // Broadcast ONCE to thread room (all connected clients in thread receive it)
    emitToThread(threadId, 'chat:message', { threadId, message });

    if (senderRole === 'tenant') {
      // Send offline notifications to Organization Admins / Managers
      const orgAdmins = await prisma.user.findMany({
        where: { organizationId: thread.organizationId, role: { in: ['admin', 'manager', 'owner'] } },
      });

      for (const admin of orgAdmins) {
        await dispatchNotification({
          organizationId: thread.organizationId,
          userId: admin.id,
          type: 'CHAT_MESSAGE',
          title: `Nouveau message de ${thread.tenantProfile.firstName} ${thread.tenantProfile.lastName}`,
          emailSubject: `Nouveau message locataire - Naforo`,
          emailHtml: `<p>Bonjour ${admin.firstName}, vous avez reçu un message de votre locataire <strong>${thread.tenantProfile.firstName} ${thread.tenantProfile.lastName}</strong> :</p><blockquote>${content}</blockquote>`,
          smsText: `Nouveau message de ${thread.tenantProfile.firstName} : "${content.slice(0, 50)}..."`,
          data: { threadId, messageId: message.id },
        }).catch(() => {});
      }
    } else {
      // Send offline notification to Tenant
      const tenantUserId = thread.tenantProfile.userId || thread.tenantProfile.user?.id;
      if (tenantUserId) {
        await dispatchNotification({
          organizationId: thread.organizationId,
          userId: tenantUserId,
          email: thread.tenantProfile.email || thread.tenantProfile.user?.email,
          phone: thread.tenantProfile.phone,
          type: 'CHAT_MESSAGE',
          title: `Nouveau message de votre gestionnaire`,
          emailSubject: `Réponse de votre gestionnaire - Naforo`,
          emailHtml: `<p>Bonjour ${thread.tenantProfile.firstName}, votre gestionnaire vous a envoyé un message :</p><blockquote>${content}</blockquote>`,
          smsText: `Message de votre gestionnaire : "${content.slice(0, 50)}..."`,
          data: { threadId, messageId: message.id },
        }).catch(() => {});
      }
    }

    return message;
  }

  async updateMessage(messageId: string, senderId: string, content: string) {
    const message = await chatRepository.getMessageById(messageId);
    if (!message) throw new NotFoundError("Message introuvable.");

    if (message.senderId !== senderId) {
      throw new ForbiddenError("Vous ne pouvez modifier que vos propres messages.");
    }

    const updated = await chatRepository.updateMessage(messageId, content);
    emitToThread(message.threadId, 'chat:message_updated', { messageId, content: updated.content });
    return updated;
  }

  async deleteMessage(messageId: string, senderId: string) {
    const message = await chatRepository.getMessageById(messageId);
    if (!message) throw new NotFoundError("Message introuvable.");

    if (message.senderId !== senderId) {
      throw new ForbiddenError("Vous ne pouvez supprimer que vos propres messages.");
    }

    await chatRepository.deleteMessage(messageId);
    emitToThread(message.threadId, 'chat:message_deleted', { messageId });
  }
}

export const chatService = new ChatService();

