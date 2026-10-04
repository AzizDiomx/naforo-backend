import { prisma } from '@/config/database';
import { encryptChatMessage, decryptChatMessage } from '@/shared/helpers/chat.crypto';

export class ChatRepository {
  /**
   * Find or create chat thread between TenantProfile and Organization (Landlord/Manager)
   */
  async getOrCreateThread(organizationId: string, tenantProfileId: string, propertyId?: string, contractId?: string) {
    let thread = await prisma.chatThread.findFirst({
      where: {
        organizationId,
        tenantProfileId,
        ...(propertyId && { propertyId }),
      },
      include: {
        tenantProfile: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, avatarUrl: true } },
        property: { select: { id: true, name: true, address: true } },
        contract: { select: { id: true, contractNumber: true } },
      },
    });

    if (!thread) {
      thread = await prisma.chatThread.create({
        data: {
          organizationId,
          tenantProfileId,
          propertyId,
          contractId,
        },
        include: {
          tenantProfile: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, avatarUrl: true } },
          property: { select: { id: true, name: true, address: true } },
          contract: { select: { id: true, contractNumber: true } },
        },
      });
    }

    return thread;
  }

  /**
   * Get all chat threads for a user (Filtered by tenantProfile for tenant, or by org for landlord)
   */
  async getThreadsForUser(userId: string, role: string, organizationId?: string) {
    if (role === 'tenant') {
      const profile = await prisma.tenantProfile.findFirst({ where: { userId } });
      if (!profile) return [];

      const threads = await prisma.chatThread.findMany({
        where: { tenantProfileId: profile.id },
        include: {
          property: { select: { id: true, name: true } },
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
        orderBy: { lastMessageAt: 'desc' },
      });

      return threads.map(t => ({
        ...t,
        messages: t.messages.map(m => ({ ...m, content: decryptChatMessage(m.content) })),
      }));
    }

    // Landlord / Admin / Manager
    if (!organizationId) return [];

    const threads = await prisma.chatThread.findMany({
      where: { organizationId },
      include: {
        tenantProfile: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, avatarUrl: true } },
        property: { select: { id: true, name: true } },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { lastMessageAt: 'desc' },
    });

    return threads.map(t => ({
      ...t,
      messages: t.messages.map(m => ({ ...m, content: decryptChatMessage(m.content) })),
    }));
  }

  /**
   * Get messages for a thread with decryption
   */
  async getThreadMessages(threadId: string, page = 1, limit = 50) {
    const messages = await prisma.chatMessage.findMany({
      where: { threadId },
      orderBy: { createdAt: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return messages.map(m => ({
      ...m,
      content: decryptChatMessage(m.content),
    }));
  }

  /**
   * Create & Encrypt Chat Message
   */
  async createMessage(data: {
    threadId: string;
    senderId: string;
    senderRole: string;
    content: string;
    attachments?: any;
  }) {
    const encryptedContent = encryptChatMessage(data.content);

    const message = await prisma.chatMessage.create({
      data: {
        threadId: data.threadId,
        senderId: data.senderId,
        senderRole: data.senderRole,
        content: encryptedContent,
        attachments: data.attachments || [],
      },
    });

    // Update lastMessageAt on thread
    await prisma.chatThread.update({
      where: { id: data.threadId },
      data: { lastMessageAt: new Date() },
    });

    return {
      ...message,
      content: data.content, // Return decrypted to caller
    };
  }

  /**
   * Mark messages in a thread as read
   */
  async markAsRead(threadId: string, currentUserId: string) {
    await prisma.chatMessage.updateMany({
      where: {
        threadId,
        senderId: { not: currentUserId },
        isRead: false,
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });
  }

  /**
   * Get message by id
   */
  async getMessageById(messageId: string) {
    const message = await prisma.chatMessage.findUnique({
      where: { id: messageId },
    });
    if (!message) return null;
    return {
      ...message,
      content: decryptChatMessage(message.content),
    };
  }

  /**
   * Update message content
   */
  async updateMessage(messageId: string, content: string) {
    const encryptedContent = encryptChatMessage(content);
    const message = await prisma.chatMessage.update({
      where: { id: messageId },
      data: { content: encryptedContent },
    });
    return {
      ...message,
      content,
    };
  }

  /**
   * Delete message physically
   */
  async deleteMessage(messageId: string) {
    await prisma.chatMessage.delete({
      where: { id: messageId },
    });
  }
}

export const chatRepository = new ChatRepository();
