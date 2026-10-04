import { prisma } from '@/config/database';
import { Prisma, User, Organization, OtpToken } from '@prisma/client';

export class AuthRepository {
  async findByEmail(email: string): Promise<(User & { organization: Organization | null }) | null> {
    const cleanEmail = email.trim();
    const user = await prisma.user.findUnique({
      where: { email: cleanEmail },
      include: { organization: true },
    });
    if (user) return user;
    return prisma.user.findFirst({
      where: { email: { equals: cleanEmail, mode: 'insensitive' } },
      include: { organization: true },
    });
  }

  async findById(id: string): Promise<User | null> {
    return prisma.user.findUnique({
      where: { id },
    });
  }

  async createOrganization(data: Prisma.OrganizationCreateInput): Promise<Organization> {
    return prisma.organization.create({
      data,
    });
  }

  async createUser(data: Prisma.UserUncheckedCreateInput): Promise<User> {
    return prisma.user.create({
      data,
    });
  }

  async updateUser(id: string, data: Prisma.UserUncheckedUpdateInput): Promise<User> {
    return prisma.user.update({
      where: { id },
      data,
    });
  }

  async createOTP(userId: string, token: string, type: string, expiresAt: Date): Promise<OtpToken> {
    return prisma.otpToken.create({
      data: {
        userId,
        token,
        type,
        expiresAt,
      },
    });
  }

  async findValidOTP(email: string, token: string, type: string): Promise<OtpToken | null> {
    const cleanEmail = email.trim();
    return prisma.otpToken.findFirst({
      where: {
        token,
        type,
        usedAt: null,
        expiresAt: { gt: new Date() },
        user: { email: { equals: cleanEmail, mode: 'insensitive' } },
      },
    });
  }

  async markOTPUsed(id: string): Promise<OtpToken> {
    return prisma.otpToken.update({
      where: { id },
      data: { usedAt: new Date() },
    });
  }

  async createNotificationPreferences(userId: string): Promise<void> {
    await prisma.notificationPreference.create({
      data: {
        userId,
        emailEnabled: true,
        smsEnabled: false,
        pushEnabled: true,
        reminderEnabled: true,
      },
    });
  }

  async updateLastLogin(userId: string): Promise<void> {
    await prisma.user.update({
      where: { id: userId },
      data: { lastLoginAt: new Date() },
    });
  }
}

export const authRepository = new AuthRepository();
